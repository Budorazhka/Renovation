import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CrmService } from './crm.service';
import { parseLeadImportFile, parseImportContactDate, type ParsedLeadImportRow } from './lead-import-file-parser';

/**
 * `import.run` — грант "импорт вообще", а НЕ право заводить лиды.
 * Дублирует ту же двухступенчатую проверку, что ExportService делает для
 * export.run/<entity>.read: сам import.run не должен становиться обходом
 * lead.create — иначе роль без lead.create (в текущей матрице таких нет
 * среди ролей с import.run, но защита не должна опираться на этот факт
 * сегодняшнего состояния default-role-grants.ts, он может измениться).
 */
const IMPORT_LEAD_PERMISSION = { resource: 'lead', action: 'create' } as const;

/**
 * Потолок строк одного импорта. Меньше, чем у export (10 000): создание
 * лида — это транзакция + запись в contacts/leads/lead_events/audit на
 * каждую строку, на порядок тяжелее, чем чтение проекции при выгрузке.
 * Тот же принцип "превышение отклоняется целиком, не обрезается молча",
 * что у ExportService.MAX_EXPORT_ROWS.
 */
const MAX_IMPORT_ROWS = 2000;

/**
 * ВАЖНО: буквально 'createLead' — то же имя операции, что
 * CrmService.createLead жёстко использует в своём внутреннем
 * `idempotencyService.record(...)` вызове (не параметризовано). checkReplay
 * здесь и record внутри createLead обязаны смотреть на одну и ту же
 * (identityId, operation, key) тройку, иначе повторная загрузка файла не
 * находила бы уже созданную запись — второй проход упирался бы в duplicate-
 * key на самой idempotency-записи внутри транзакции createLead, а не в
 * чистый replay.
 */
const IMPORT_OPERATION = 'createLead';

export interface LeadImportRowError {
  row: number;
  message: string;
}

export interface LeadImportResult {
  total: number;
  created: number;
  failed: number;
  errors: LeadImportRowError[];
}

/**
 * D-05 CRM-ядро хвост мастер-плана — "CSV/XLSX import/export как фоновые
 * задания с отчётом ошибок". Реализовано СИНХРОННО в рамках HTTP-запроса,
 * не фоновой задачей: в проекте нет инфраструктуры "загрузил файл → job →
 * опрос статуса" (apps/worker реагирует только на доменные события через
 * outbox, это другой паттерн), а строить очередь ради одного эндпоинта —
 * оверинжиниринг. Потолок в 2000 строк держит синхронную обработку в
 * разумных временных рамках HTTP-запроса. Осознанное отступление от
 * буквальной формулировки мастер-плана, тот же класс решения, что
 * зафиксирован в docs/operations/erp-team-mock-debt-closed.md.
 */
@Injectable()
export class LeadImportService {
  constructor(
    private readonly crmService: CrmService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async importLeads(params: {
    organizationId: Types.ObjectId;
    actorPositionId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
    fileBuffer: Buffer;
    fileName: string;
    mimetype: string | undefined;
    /**
     * `?tag=old_base` — единственное допустимое значение (валидируется DTO
     * `@IsIn(['old_base'])` на контроллере, здесь только используется).
     * Каждый созданный (не replay) лид получает `tags:['old_base']`.
     */
    tag?: 'old_base';
  }): Promise<LeadImportResult> {
    const allowed = await this.policyEvaluator.evaluate({
      subjectType: 'position',
      subjectId: params.actorPositionId,
      resource: IMPORT_LEAD_PERMISSION.resource,
      action: IMPORT_LEAD_PERMISSION.action,
    });
    if (!allowed) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        `Недостаточно прав: ${IMPORT_LEAD_PERMISSION.resource}.${IMPORT_LEAD_PERMISSION.action}`,
      );
    }

    const rows = await parseLeadImportFile(params.fileBuffer, params.fileName, params.mimetype);

    if (rows.length > MAX_IMPORT_ROWS) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `Импорт ограничен ${MAX_IMPORT_ROWS} строками — разделите файл`,
        { limit: MAX_IMPORT_ROWS },
      );
    }

    const errors: LeadImportRowError[] = [];
    let created = 0;

    for (const row of rows) {
      if (!row.phone) {
        errors.push({ row: row.row, message: 'Отсутствует обязательное поле phone' });
        continue;
      }
      if (!isPlausiblePhone(row.phone)) {
        errors.push({ row: row.row, message: `Некорректный телефон: ${row.phone}` });
        continue;
      }

      try {
        await this.importRow(params, row);
        created += 1;
      } catch (error) {
        errors.push({ row: row.row, message: rowErrorMessage(error) });
      }
    }

    // Один audit-batch на весь импорт, не по записи на строку — тот же
    // выбор, что ExportService.buildExport делает для выгрузки: 2000
    // audit-событий на файл были бы шумом, а не полезной историей (тот же
    // принцип, permission-matrix.md разд.4 "Каждый клик не надо" — важны
    // сами факты запуска критических batch-операций, не каждый их шаг).
    await this.auditService.append({
      actor: { type: 'identity', id: params.actorIdentityId },
      action: 'import.run',
      resource: 'lead',
      resourceId: params.organizationId,
      after: { fileName: params.fileName, total: rows.length, created, failed: errors.length },
      correlationId: params.correlationId,
    });

    return { total: rows.length, created, failed: errors.length, errors };
  }

  /**
   * `whatsapp`/`telegram`/`comment`/`last_contact`/`tag` сознательно НЕ
   * входят в `idempotencyRequestBody` (остаётся ровно тем же
   * {organizationId, requesterName, requesterPhone}, что и до этого
   * прохода): типичный сценарий повторной загрузки старой базы — сначала
   * грузят "голый" phone/name, позже более полную версию файла с
   * дополненными колонками для ТЕХ ЖЕ телефонов. Если бы новые поля
   * участвовали в хэше, такой повтор считался бы "другим запросом" и падал
   * в IDEMPOTENCY_KEY_CONFLICT вместо тихого no-op. Дубль лида при этом
   * всё равно не создаётся — checkReplay ниже находит существующую запись
   * по (identityId, operation, key) и возвращает без повторного
   * createLead; новые поля из второго прохода на УЖЕ существующий лид не
   * переносятся (это идемпотентность создания, не upsert/merge).
   */
  private async importRow(
    params: { organizationId: Types.ObjectId; actorPositionId: Types.ObjectId; actorIdentityId: Types.ObjectId; correlationId: string; tag?: 'old_base' },
    row: ParsedLeadImportRow,
  ): Promise<void> {
    const phone = row.phone!;
    const idempotencyKey = rowIdempotencyKey(params.organizationId, phone);
    const idempotencyRequestBody = {
      organizationId: params.organizationId.toString(),
      requesterName: row.name ?? null,
      requesterPhone: phone,
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: params.actorIdentityId,
      operation: IMPORT_OPERATION,
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      // Строка уже была обработана этим же файлом (или предыдущей
      // загрузкой того же файла) — реплей, не повторное создание. Row
      // засчитывается как успешная (лид существует), а не как ошибка.
      return;
    }

    const lastContactAt = row.lastContactAt ? parseImportContactDate(row.lastContactAt) : undefined;

    await this.crmService.createLead({
      organizationId: params.organizationId,
      requesterName: row.name,
      requesterPhone: phone,
      actorPositionId: params.actorPositionId,
      actorIdentityId: params.actorIdentityId,
      correlationId: params.correlationId,
      idempotencyKey,
      idempotencyRequestBody,
      route: 'import',
      telegram: row.telegram,
      whatsapp: row.whatsapp,
      notes: row.comment,
      lastContactAt,
      tags: params.tag === 'old_base' ? ['old_base'] : undefined,
    });
  }
}

/**
 * Идемпотентный ключ строки = sha256(organizationId + '|' + phone).
 * Детерминированность гарантирует: повторная загрузка ТОГО ЖЕ файла (та
 * же организация, тот же телефон в строке) порождает тот же ключ →
 * IdempotencyService.checkReplay находит существующую запись и возвращает
 * её вместо повторного createLead — ADR-006, дубль лида искажает воронку.
 * Row index сознательно НЕ входит в ключ: две строки с одинаковым
 * телефоном внутри одного файла — тот же логический контакт, вторая
 * строка тоже обязана дедуплицироваться, а не породить второй лид только
 * потому что оказалась ниже в таблице.
 */
/**
 * Старые таблицы приходят с мусором в колонке телефона («нет», «см. выше»).
 * Минимальная проверка правдоподобия: только цифры и +()-. и пробелы, не
 * меньше 7 цифр. Формат номера CRM в целом не нормализует — это не валидация
 * номера, а отсев явно не-телефонов при массовой загрузке.
 */
function isPlausiblePhone(phone: string): boolean {
  if (!/^[+\d\s().-]+$/.test(phone)) return false;
  return (phone.match(/\d/g) ?? []).length >= 7;
}

function rowIdempotencyKey(organizationId: Types.ObjectId, phone: string): string {
  return createHash('sha256').update(`${organizationId.toString()}|${phone}`).digest('hex');
}

function rowErrorMessage(error: unknown): string {
  if (error instanceof AppException) return error.message;
  if (error instanceof Error) return error.message;
  return 'Не удалось создать лид';
}
