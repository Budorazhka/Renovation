import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import type { Currency, MoneyAmount } from '@baza/contracts';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';

/** Что о чужом опубликованном ЖК знает вторая сторона сделки — не документ целиком. */
export interface PublishedDevelopmentSummary {
  id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
}

/** Параметры идемпотентности создающей команды. */
interface IdempotencyParams {
  identityId: Types.ObjectId;
  operation: string;
  key: string;
  requestBody: Record<string, unknown>;
}

/** Mongoose-документ -> обычный объект для записи идемпотентности. */
function toPlainRecord(doc: unknown): Record<string, unknown> {
  const candidate = doc as { toObject?: () => Record<string, unknown> };
  return typeof candidate?.toObject === 'function' ? candidate.toObject() : (doc as Record<string, unknown>);
}
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { PublicationService } from '../publication/publication.service';
import { MarketplacePublicationRepository } from '@baza/publication';
import { IdempotencyService, type IdempotentReplay } from '../../shared/idempotency/idempotency.service';
import { DevelopmentRepository } from '@baza/development';
import type { DevelopmentDocument, DevelopmentLocation, DevelopmentContact } from '@baza/development';
import { BuildingRepository } from './repository/building.repository';
import { SectionRepository } from './repository/section.repository';
import { FloorRepository } from './repository/floor.repository';
import { FloorPlanRepository } from './repository/floor-plan.repository';
import { UnitRepository } from './repository/unit.repository';
import { InstallmentPlanRepository, type UpdateInstallmentPlanPatch } from './repository/installment-plan.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import type { BuildingDocument, GeoPolygon } from './schemas/building.schema';
import type { SectionDocument } from './schemas/section.schema';
import type { FloorDocument } from './schemas/floor.schema';
import type { FloorPlanDocument, GeoPolygon2D } from './schemas/floor-plan.schema';
import type { UnitDocument, UnitKind, UnitStatus } from './schemas/unit.schema';
import type { BatchUnitItemDto } from './dto/batch-create-units.dto';
import type {
  InstallmentPlanDocument,
  InstallmentApplyTo,
  InstallmentDownPaymentType,
  InstallmentPaymentFrequency,
  InstallmentTermType,
} from './schemas/installment-plan.schema';
import { sortChessboardUnits, type ChessboardUnitInput } from './chessboard-export';

/**
 * Потолок выгрузки шахматки. 20 000 квартир — заведомо больше любого
 * реального ЖК (крупнейшие батумские комплексы — единицы тысяч юнитов),
 * но конечен: без него один HTTP-запрос мог бы прочитать неограниченное
 * число документов в память процесса. Не пагинация (файл по определению
 * отдаётся целиком), а предохранитель.
 */
const MAX_CHESSBOARD_EXPORT_UNITS = 20_000;

/**
 * Явная матрица допустимых переходов статуса Unit (source → allowed targets)
 * — PATCH /units/:id/status без неё позволял бы поставить любой статус при
 * подходящей version (напр. sold→available вручную), что портит остатки/
 * шахматку. hidden — модерационный статус вне продажного цикла, переход в
 * него из available/reserved и обратно не ограничивается здесь намеренно.
 *
 * sold — ТЕРМИНАЛЬНЫЙ статус в этой generic-матрице: нет исходящих
 * переходов вообще, включая sold→hidden. Раньше sold→hidden был разрешён,
 * а hidden→available тоже разрешён — это давало обход прямого запрета
 * sold→available за два обычных PATCH-запроса (продано → скрыто → снова
 * доступно). Отмена продажи — если когда-то понадобится — должна быть
 * отдельной командой с причиной, отдельным правом и audit-записью, а не
 * дырой в универсальном status-патче.
 */
const UNIT_STATUS_TRANSITIONS: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ['reserved', 'sold', 'hidden'],
  reserved: ['available', 'sold', 'hidden'],
  sold: [],
  hidden: ['available', 'reserved', 'sold'],
};

/**
 * Обратный индекс (target → allowed sources) — нужен для атомарного Mongo-
 * фильтра в updateStatusWithVersionCheck: сравнение по source один раз при
 * старте процесса дешевле, чем инвертировать матрицу на каждый запрос.
 */
const UNIT_STATUS_ALLOWED_SOURCES: Record<UnitStatus, readonly UnitStatus[]> = (() => {
  const result = {} as Record<UnitStatus, UnitStatus[]>;
  for (const status of Object.keys(UNIT_STATUS_TRANSITIONS) as UnitStatus[]) result[status] = [];
  for (const [source, targets] of Object.entries(UNIT_STATUS_TRANSITIONS) as [UnitStatus, readonly UnitStatus[]][]) {
    for (const target of targets) result[target].push(source);
  }
  return result;
})();

/**
 * Транзакционный command-слой Developments/Buildings/Sections/Floors/Units/
 * FloorPlans (D-01, domain-model.md Модуль 4). Каждая команда, меняющая
 * более одного документа ИЛИ требующая audit+outbox (critical actions),
 * выполняется в единой MongoDB-транзакции (ADR-006) — тот же паттерн, что
 * уже применён в OrganizationsService/MediaService.
 *
 * Tenant isolation (ADR-002 требование 1): каждая операция над дочерней
 * сущностью (Building→Development, Floor→Building, Unit→Floor/Building)
 * проверяет ФАКТИЧЕСКУЮ organizationId родителя из БД, не доверяет id из
 * URL/body напрямую — тот же принцип, что assignOccupant/confirmUpload
 * (единый NOT_FOUND для "не существует" и "чужая организация").
 */
@Injectable()
export class DevelopmentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly developmentRepository: DevelopmentRepository,
    private readonly buildingRepository: BuildingRepository,
    private readonly sectionRepository: SectionRepository,
    private readonly floorRepository: FloorRepository,
    private readonly floorPlanRepository: FloorPlanRepository,
    private readonly unitRepository: UnitRepository,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly publicationService: PublicationService,
    private readonly publicationRepository: MarketplacePublicationRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly organizationsService: OrganizationsService,
    private readonly installmentPlanRepository: InstallmentPlanRepository,
  ) {}

  /**
   * permission-matrix.md: только организации-застройщики создают/публикуют
   * ЖК. DEFAULT_ROLE_GRANTS сам по себе этого не проверяет — owner/director
   * ЛЮБОЙ организации (включая agency/independent_realtor) получает
   * development.edit одинаково, PermissionGuard/PolicyEvaluatorService не
   * знают о domain-атрибутах ресурса (см. PolicyEvaluatorService.evaluate
   * docstring: "конкретное сужение — ответственность вызывающего command
   * handler'а"). Тот же паттерн, что AdminAccountService.requireSuperAdmin —
   * доменное правило проверяется в сервисе, не в generic guard'е.
   *
   * Через OrganizationsService, НЕ через OrganizationRepository напрямую —
   * ADR-001 модульная граница (test/architecture/module-boundaries.test.ts
   * запрещает прямой cross-module импорт *.repository.ts, поймано этим же
   * тестом при первой попытке).
   */
  private async requireDeveloperOrganization(organizationId: Types.ObjectId): Promise<void> {
    const organization = await this.organizationsService.getOrganizationById(organizationId);
    if (!organization || organization.type !== 'developer') {
      throw new AppException(
        ErrorCode.DEVELOPMENT_REQUIRES_DEVELOPER_ORGANIZATION,
        'Только организации типа developer могут создавать и публиковать ЖК',
      );
    }
  }


  /**
   * Общая обвязка идемпотентности для создающих команд девелопмента.
   *
   * ADR-006: отметка идемпотентности пишется В ТОЙ ЖЕ транзакции, что и сама
   * сущность. Иначе возможен разрыв — корпус создан, отметка потеряна, и
   * повтор создаёт второй. Вынесено в один метод, чтобы шесть команд не
   * повторяли эту обвязку каждая по-своему.
   */
  private async createIdempotently<T>(
    idempotency: IdempotencyParams,
    create: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.connection, async (session) => {
      const created = await create(session);
      await this.idempotencyService.record(
        {
          identityId: idempotency.identityId,
          operation: idempotency.operation,
          key: idempotency.key,
          requestBody: idempotency.requestBody,
          responseStatus: 201,
          responseBody: toPlainRecord(created),
        },
        session,
      );
      return created;
    });
  }

  /** Проверка повтора до транзакции — как в property-assets. */
  checkCreateReplay(
    identityId: Types.ObjectId,
    operation: string,
    key: string,
    requestBody: Record<string, unknown>,
  ): Promise<IdempotentReplay | null> {
    return this.idempotencyService.checkReplay({ identityId, operation, key, requestBody });
  }

  async createDevelopment(params: {
    organizationId: Types.ObjectId;
    name: string;
    location: DevelopmentLocation;
    contact: DevelopmentContact;
    classType?: string;
    startDate?: Date;
    completionDate?: Date;
    description?: string;
    idempotency: IdempotencyParams;
  }): Promise<DevelopmentDocument> {
    await this.requireDeveloperOrganization(params.organizationId);
    return this.createIdempotently(params.idempotency, (session) =>
      this.developmentRepository.create(params, session),
    );
  }

  async getDevelopmentForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<DevelopmentDocument> {
    const development = await this.developmentRepository.findByIdForOrganization(id, organizationId);
    if (!development) {
      throw new NotFoundException('Development not found');
    }
    return development;
  }

  async listDevelopmentsForOrganization(
    organizationId: Types.ObjectId,
    params: { cursor?: Types.ObjectId; limit: number },
  ): Promise<DevelopmentDocument[]> {
    return this.developmentRepository.listForOrganization(organizationId, params);
  }

  /**
   * Краткая карточка опубликованного ЖК для ВТОРОЙ стороны сделки: агентство
   * фиксирует клиента у чужого застройщика (ClientRegistrationsService) и
   * обязано увидеть имя комплекса и организацию-владельца. Неопубликованный
   * комплекс отвечает 404 — по id нельзя узнавать о чужих черновиках.
   *
   * ADR-001: cross-module связь идёт через сервис, а не через чужой
   * репозиторий; наружу отдаются три поля, а не документ целиком.
   */
  async getPublishedDevelopmentSummary(id: Types.ObjectId): Promise<PublishedDevelopmentSummary> {
    const development = await this.developmentRepository.findPublishedById(id);
    if (!development) {
      throw new NotFoundException('Development not found');
    }
    return {
      id: development._id,
      organizationId: development.organizationId,
      name: development.name,
    };
  }

  /**
   * conventions.md разд.5 optimistic concurrency: expectedVersion не
   * совпал с текущим → VERSION_CONFLICT (ConflictException, 409) — не
   * NotFoundException, запись реально существует, просто клиент работал
   * со устаревшей версией (D-01 test requirement: "optimistic conflict").
   *
   * D-03 rebuild (ИЗМЕНЕНО 26.08.2026, owner decision + second-opinion
   * fix): если MarketplacePublication для этого Development сейчас в
   * status:published, update транзакционно перевыпускает
   * PublicationRequested — публичная витрина не должна оставаться со
   * старыми данными до следующего явного publish. Триггер — ТЕКУЩИЙ
   * СТАТУС ПУБЛИКАЦИИ, не canonical Development.status: если публикация
   * unpublished/build_failed/никогда не существовала, rebuild НЕ
   * срабатывает — update не должен молча обходить явный admin unpublish
   * своим следующим шагом. rebuildIfCurrentlyPublished — атомарный
   * condition-update (findOneAndUpdate с status:'published' в фильтре),
   * НЕ read-then-write — первая версия (isCurrentlyPublished read +
   * отдельный requestPublication write) несла TOCTOU-гонку с конкурентным
   * admin unpublish, найдено second-opinion (Gemini) ревью, исправлено
   * тем же днём.
   */
  async updateDevelopment(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    correlationId: string;
    changes: Partial<{
      name: string;
      location: DevelopmentLocation;
      contact: DevelopmentContact;
      classType: string;
      startDate: Date;
      completionDate: Date;
      description: string;
    }>;
  }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const { modifiedCount } = await this.developmentRepository.updateWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        params.changes,
        session,
      );
      if (modifiedCount === 0) {
        const stillExists = await this.developmentRepository.findByIdForOrganization(
          params.id,
          params.organizationId,
        );
        if (!stillExists) {
          throw new NotFoundException('Development not found');
        }
        throw new ConflictException('Development was modified by another request — refresh and retry');
      }

      await this.publicationService.rebuildIfCurrentlyPublished(
        {
          sourceType: 'development',
          sourceId: params.id,
          publisherScope: { type: 'organization', organizationId: params.organizationId },
          correlationId: params.correlationId,
        },
        session,
      );
    });
  }

  /**
   * ADR-005/ADR-006: транзакционно (1) переводит Development draft→active
   * и (2) вызывает PublicationService.requestPublication (upsert
   * MarketplacePublication:publication_pending + outbox PublicationRequested)
   * — оба шага в ОДНОЙ MongoDB-транзакции. Только draft может быть
   * опубликован (archived/уже active — конфликт, не тихий no-op).
   *
   * Idempotency-Key (ADR-006, ИЗМЕНЕНО 26.08.2026 — механизм реализован,
   * honest gap закрыт): replay-проверка (IdempotencyService.checkReplay)
   * выполняется ВЫЗЫВАЮЩИМ кодом (DevelopmentsController) ДО вызова этого
   * метода — контроллер решает, возвращать ли сохранённый ответ, не
   * начиная транзакцию заново. Запись результата — ВНУТРИ этой же
   * транзакции, последним шагом, после успешного requestPublication (ADR-006:
   * "запись создаётся в той же транзакции, что и сама бизнес-операция").
   *
   * ИСПРАВЛЕНО 26.08.2026 (гонка двух параллельных publish с одним
   * Idempotency-Key, найдено integration-тестом через реальный HTTP + два
   * параллельных app.inject()): controller'ский checkReplay ДО транзакции
   * не ловит гонку — оба запроса могут пройти его одновременно (record ещё
   * не написан). Два independent-фикса понадобились вместе, один без
   * другого не закрывал гонку:
   *   1. DevelopmentRepository.updateStatus раньше матчил только
   *      {_id, organizationId}, БЕЗ условия на текущий status — не был
   *      настоящим compare-and-swap. Обе конкурентные транзакции проходили
   *      его успешно, обе пытались писать idempotency record с одним и тем
   *      же (identityId, operation, key) → duplicate key error наружу как
   *      unhandled 500. Добавлен fromStatus в фильтр (см. её докстринг).
   *   2. С исправленным CAS одна из транзакций либо получает
   *      modifiedCount:0 (проиграла updateOne), либо (при WriteConflict,
   *      если её updateOne столкнулся с ещё не закоммиченной записью
   *      конкурента) withTransaction ретраит весь callback — на ретрае
   *      findByIdForOrganization уже видит status:'active' конкурента,
   *      выполнение попадает в "status !== draft" ветку НАЧАЛА функции, не
   *      в modifiedCount:0 ветку. Обе ветки поэтому теперь одинаково делают
   *      checkOwnReplay() ПЕРЕД тем как бросить ConflictException — если
   *      найден record с ЭТИМ ЖЕ (identity, operation, key), это replay
   *      своей же попытки, не независимый конфликт; если записи нет — это
   *      действительно другой конфликт (напр. чужая публикация или админ
   *      вручную сменил статус) — ConflictException как раньше.
   */
  async publishDevelopment(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ publicationId: Types.ObjectId; status: string; replay?: IdempotentReplay }> {
    // ДО транзакции и ДО idempotency-бухгалтерии — organization.type
    // отклоняет запрос целиком, нет смысла открывать транзакцию/писать
    // idempotency record для попытки, которая в принципе не может пройти.
    await this.requireDeveloperOrganization(params.organizationId);

    return runInTransaction(this.connection, async (session) => {
      // Общий helper для ОБЕИХ conflict-веток ниже: MongoDB транзакция,
      // проигравшая гонку конкурентному publish, не обязательно видит
      // modifiedCount:0 — если её updateOne реально столкнулся с записью
      // конкурента (WriteConflict), withTransaction ретраит весь callback
      // целиком; на ретрае findByIdForOrganization УЖЕ видит status:'active'
      // (конкурент успел закоммититься между ретраями), значит выполнение
      // никогда не доходит до updateStatus вообще — попадает в "status !==
      // draft" ветку, которая раньше безусловно бросала ConflictException,
      // даже когда "другая" публикация — это ЭТА ЖЕ попытка (тот же
      // Idempotency-Key), просто увиденная после ретрая. Обе ветки поэтому
      // должны одинаково сначала проверить, не является ли "конфликт"
      // replay'ем собственной попытки.
      const checkOwnReplay = () =>
        this.idempotencyService.checkReplay({
          identityId: params.actorIdentityId,
          operation: 'publishDevelopment',
          key: params.idempotencyKey,
          requestBody: { developmentId: params.id.toString() },
        });

      const development = await this.developmentRepository.findByIdForOrganization(
        params.id,
        params.organizationId,
      );
      if (!development) {
        throw new NotFoundException('Development not found');
      }
      if (development.status !== 'draft') {
        const replay = await checkOwnReplay();
        if (replay) {
          return { publicationId: params.id, status: development.status, replay };
        }
        throw new ConflictException(
          `Development status is '${development.status}', only 'draft' can be published`,
        );
      }

      const { modifiedCount } = await this.developmentRepository.updateStatus(
        params.id,
        params.organizationId,
        'draft',
        'active',
        session,
      );
      if (modifiedCount === 0) {
        // Гонка с параллельным идентичным publish (см. docstring выше): если
        // конкурент с ТЕМ ЖЕ (identity, operation, key) уже закоммитил и
        // записал idempotency record, это replay ЭТОЙ попытки, не конфликт.
        const replay = await checkOwnReplay();
        if (replay) {
          return { publicationId: params.id, status: development.status, replay };
        }
        // Конкурентный publish/update изменил статус между findByIdForOrganization
        // выше и этим updateOne — реальная гонка, не гипотетическая (та же
        // категория, что уже проверялась для confirmUpload через Promise.all
        // в integration-тесте).
        throw new ConflictException('Development was modified by another request — refresh and retry');
      }

      const publication = await this.publicationService.requestPublication(
        {
          sourceType: 'development',
          sourceId: params.id,
          publisherScope: { type: 'organization', organizationId: params.organizationId },
          correlationId: params.correlationId,
        },
        session,
      );

      const result = { publicationId: publication._id, status: publication.status };

      await this.idempotencyService.record(
        {
          identityId: params.actorIdentityId,
          operation: 'publishDevelopment',
          key: params.idempotencyKey,
          requestBody: { developmentId: params.id.toString() },
          responseStatus: 202,
          responseBody: {
            id: result.publicationId.toString(),
            sourceType: 'development',
            sourceId: params.id.toString(),
            status: result.status,
          },
        },
        session,
      );

      return result;
    });
  }

  async createBuilding(params: {
    developmentId: Types.ObjectId;
    organizationId: Types.ObjectId;
    name: string;
    floorsCount: number;
    startDate?: Date;
    completionDate?: Date;
    polygon?: GeoPolygon;
    idempotency: IdempotencyParams;
  }): Promise<BuildingDocument> {
    const development = await this.developmentRepository.findByIdForOrganization(
      params.developmentId,
      params.organizationId,
    );
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    return this.createIdempotently(params.idempotency, (session) =>
      this.buildingRepository.create(
        {
          developmentId: params.developmentId,
          organizationId: params.organizationId,
          name: params.name,
          floorsCount: params.floorsCount,
          startDate: params.startDate,
          completionDate: params.completionDate,
          polygon: params.polygon,
        },
        session,
      ),
    );
  }

  /**
   * НЕ в узкой OpenAPI-спеке (v1-first-vertical-slice.yaml не специфицирует
   * Section create endpoint — опциональна по domain-model.md, "vertical
   * slice до publish не требует секций явно"). Repository (`SectionRepository`)
   * уже был готов с D-01, service-метод/HTTP-endpoint не были подключены —
   * честный пробел из d01-development-aggregate.md "Не покрыто", закрывается
   * здесь.
   */
  async createSection(params: {
    buildingId: Types.ObjectId;
    organizationId: Types.ObjectId;
    name: string;
    idempotency: IdempotencyParams;
  }) {
    const building = await this.buildingRepository.findByIdForOrganization(
      params.buildingId,
      params.organizationId,
    );
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    return this.createIdempotently(params.idempotency, (session) =>
      this.sectionRepository.create(
        { buildingId: params.buildingId, organizationId: params.organizationId, name: params.name },
        session,
      ),
    );
  }

  async createFloor(params: {
    buildingId: Types.ObjectId;
    sectionId?: Types.ObjectId;
    organizationId: Types.ObjectId;
    floorNumber: number;
    floorType?: string;
    idempotency: IdempotencyParams;
  }): Promise<FloorDocument> {
    const building = await this.buildingRepository.findByIdForOrganization(
      params.buildingId,
      params.organizationId,
    );
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    if (params.sectionId) {
      const section = await this.sectionRepository.findByIdForOrganization(
        params.sectionId,
        params.organizationId,
      );
      // Section, если передана, обязана принадлежать ТОМУ ЖЕ building —
      // не просто существовать в организации (иначе можно было бы
      // прикрепить этаж к секции чужого корпуса той же организации).
      if (!section || !section.buildingId.equals(params.buildingId)) {
        throw new NotFoundException('Section not found');
      }
    }

    return this.createIdempotently(params.idempotency, (session) =>
      this.floorRepository.create(
        {
          buildingId: params.buildingId,
          sectionId: params.sectionId,
          organizationId: params.organizationId,
          floorNumber: params.floorNumber,
          floorType: params.floorType,
        },
        session,
      ),
    );
  }

  /**
   * НЕ в узкой OpenAPI-спеке — repository/service были готовы с D-01
   * (d01-development-aggregate.md "Не покрыто": "HTTP endpoint не
   * специфицирован узкой OpenAPI-спекой"), не подключён к HTTP до этого
   * прохода.
   */
  async createFloorPlan(params: {
    buildingId: Types.ObjectId;
    organizationId: Types.ObjectId;
    name: string;
    rooms: number;
    area: number;
    isEuro?: boolean;
    imageAssetId?: Types.ObjectId;
    tags?: string[];
    polygon?: GeoPolygon2D;
    idempotency: IdempotencyParams;
  }): Promise<FloorPlanDocument> {
    const building = await this.buildingRepository.findByIdForOrganization(
      params.buildingId,
      params.organizationId,
    );
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    return this.createIdempotently(params.idempotency, (session) =>
      this.floorPlanRepository.create(params, session),
    );
  }

  async getBuildingForOrganization(id: Types.ObjectId, organizationId: Types.ObjectId): Promise<BuildingDocument> {
    const building = await this.buildingRepository.findByIdForOrganization(id, organizationId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return building;
  }

  async updateUnitStatusInSession(
    unitId: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    status: UnitStatus,
    fromStatuses: readonly UnitStatus[],
    session: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    return this.unitRepository.updateStatusWithVersionCheck(
      unitId,
      organizationId,
      expectedVersion,
      status,
      fromStatuses,
      session,
    );
  }

  async getUnitForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<UnitDocument> {
    const unit = await this.unitRepository.findByIdForOrganization(id, organizationId, session);
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    return unit;
  }

  /**
   * Решение владельца 11.09.2026: валюта выбирается один раз на весь ЖК,
   * разные валюты внутри комплекса запрещены. Первый юнит задаёт валюту,
   * остальные обязаны её повторить.
   *
   * Правило живёт на сервере, а не в форме ERP, потому что цена приходит
   * и из batch-создания, и из генератора шахматки, и из пакетной смены цен.
   * Причина правила прикладная: `computeDevelopmentPriceFrom` (worker) при
   * смешанных валютах честно отдаёт `null`, и цена «от» пропадает с
   * витрины у всего комплекса.
   *
   * `excludeUnitId` — при смене цены существующего юнита он сам из
   * сравнения исключается, иначе запретил бы собственную операцию.
   */
  /**
   * ИСПРАВЛЕНО 13.09.2026: раньше проверка читала распределение валют по
   * юнитам ДО открытия транзакции — два параллельных запроса с разными
   * валютами оба видели пустой/непротиворечивый ЖК в своём собственном
   * снимке и оба успешно писали юнит дальше (запись новых unit-документов
   * друг с другом не конфликтует, TOCTOU). Теперь первой записью
   * ТРАНЗАКЦИИ идёт CAS `DevelopmentRepository.lockCurrency` на сам
   * Development-документ — тот же принцип, что BookingLockRepository
   * .bumpForUnit (apps/api/.../booking-lock.repository.ts): конкурентная
   * транзакция, пытающаяся записать в тот же документ, получает от
   * MongoDB write conflict и повторяется автоматически (withTransaction
   * retry, run-in-transaction.ts), поэтому проигравшая сторона на повторе
   * увидит уже установленную первой стороной валюту, а не независимо
   * пустое состояние.
   *
   * `excludeUnitId` (смена цены/валюты существующего юнита) — залоченную
   * валюту мог держать только сам этот юнит; сканом oставшихся юнитов
   * (исключая его) проверяем, вправду ли он единственный держатель, и
   * если да — переносим лок на новую валюту той же атомарной CAS-записью.
   * Вызывающий обязан передать session уже ОТКРЫТОЙ транзакции и вызвать
   * этот метод первым — до любых других записей в ней.
   */
  private async assertSingleCurrencyWithinDevelopment(params: {
    buildingId: Types.ObjectId;
    organizationId: Types.ObjectId;
    currencies: Currency[];
    excludeUnitId?: Types.ObjectId;
    session: ClientSession;
  }): Promise<void> {
    const incoming = new Set(params.currencies);
    if (incoming.size > 1) {
      throw new AppException(
        ErrorCode.MONEY_CURRENCY_MISMATCH,
        `Units in one development must share a currency, got: ${[...incoming].sort().join(', ')}`,
      );
    }

    const requested = params.currencies[0];
    if (!requested) {
      return;
    }

    const building = await this.buildingRepository.findByIdForOrganization(
      params.buildingId,
      params.organizationId,
    );
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    const lock = await this.developmentRepository.lockCurrency(
      building.developmentId,
      params.organizationId,
      requested,
      params.session,
    );
    if (lock.ok) {
      return;
    }

    const developmentBuildings = await this.buildingRepository.listByDevelopmentId(building.developmentId);
    const existingElsewhere = await this.unitRepository.listDistinctCurrenciesForBuildings(
      developmentBuildings.map((b) => b._id),
      params.organizationId,
      { excludeUnitId: params.excludeUnitId, session: params.session },
    );
    if (existingElsewhere.some((currency) => currency !== requested)) {
      throw new AppException(
        ErrorCode.MONEY_CURRENCY_MISMATCH,
        `Development already uses ${lock.currentCurrency}, cannot add ${requested}`,
      );
    }

    const reassigned = await this.developmentRepository.lockCurrency(
      building.developmentId,
      params.organizationId,
      requested,
      params.session,
      { allowReplacing: lock.currentCurrency },
    );
    if (!reassigned.ok) {
      throw new AppException(
        ErrorCode.MONEY_CURRENCY_MISMATCH,
        `Development already uses ${reassigned.currentCurrency}, cannot add ${requested}`,
      );
    }
  }

  async createUnit(params: {
    buildingId: Types.ObjectId;
    floorId: Types.ObjectId;
    organizationId: Types.ObjectId;
    number: string;
    kind: UnitKind;
    rooms?: number;
    area: number;
    areaLiving?: number;
    areaBalcony?: number;
    price: MoneyAmount;
    floorPlanId?: Types.ObjectId;
    idempotency: IdempotencyParams;
  }): Promise<UnitDocument> {
    const floor = await this.floorRepository.findByIdForOrganization(params.floorId, params.organizationId);
    // floor.buildingId должен совпадать с переданным buildingId — тот же
    // принцип, что Section↔Floor выше: floorId сам по себе принадлежит
    // организации, но может относиться к ДРУГОМУ building той же организации.
    if (!floor || !floor.buildingId.equals(params.buildingId)) {
      throw new NotFoundException('Floor not found');
    }

    if (params.floorPlanId) {
      const floorPlan = await this.floorPlanRepository.findByIdForOrganization(
        params.floorPlanId,
        params.organizationId,
      );
      if (!floorPlan || !floorPlan.buildingId.equals(params.buildingId)) {
        throw new NotFoundException('FloorPlan not found');
      }
    }

    return this.createIdempotently(params.idempotency, async (session) => {
      await this.assertSingleCurrencyWithinDevelopment({
        buildingId: params.buildingId,
        organizationId: params.organizationId,
        currencies: [params.price.currency],
        session,
      });

      return this.unitRepository.create(
        {
          buildingId: params.buildingId,
          floorId: params.floorId,
          // sectionId серверный, из уже проверенного floor — клиент его не
          // передаёт и не может подделать (CreateUnitDto не содержит sectionId).
          sectionId: floor.sectionId,
          organizationId: params.organizationId,
          number: params.number,
          kind: params.kind,
          rooms: params.rooms,
          area: params.area,
          areaLiving: params.areaLiving,
          areaBalcony: params.areaBalcony,
          price: params.price,
          floorPlanId: params.floorPlanId,
        },
        session,
      );
    });
  }

  /**
   * updateUnitPrice (domain-model.md Модуль 4, permission-matrix.md
   * `unit.price.update.project` — critical action, permission-matrix.md
   * раздел 4 требует audit). Транзакционно: price+priceHistory (уже
   * атомарны в одном updateOne на уровне repository) + audit + outbox
   * UnitPriceChanged — всё в одной MongoDB-транзакции.
   */
  async updateUnitPrice(params: {
    unitId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    price: MoneyAmount;
    actorIdentityId: Types.ObjectId;
    actorPositionId: Types.ObjectId;
    correlationId: string;
  }): Promise<void> {
    const unit = await this.unitRepository.findByIdForOrganization(params.unitId, params.organizationId);
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }

    return runInTransaction(this.connection, async (session) => {
      await this.assertSingleCurrencyWithinDevelopment({
        buildingId: unit.buildingId,
        organizationId: params.organizationId,
        currencies: [params.price.currency],
        excludeUnitId: params.unitId,
        session,
      });

      const { modifiedCount } = await this.unitRepository.updatePriceWithVersionCheck(
        params.unitId,
        params.organizationId,
        params.expectedVersion,
        { price: params.price, changedBy: params.actorPositionId },
        session,
      );

      if (modifiedCount === 0) {
        const stillExists = await this.unitRepository.findByIdForOrganization(
          params.unitId,
          params.organizationId,
        );
        if (!stillExists) {
          throw new NotFoundException('Unit not found');
        }
        throw new ConflictException('Unit was modified by another request — refresh and retry');
      }

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'unit.price.update',
          resource: 'unit',
          resourceId: params.unitId,
          after: {
            amountMinorUnits: params.price.amountMinorUnits,
            currency: params.price.currency,
          },
          correlationId: params.correlationId,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'UnitPriceChanged',
          aggregateType: 'unit',
          aggregateId: params.unitId,
          payload: {
            amountMinorUnits: params.price.amountMinorUnits,
            currency: params.price.currency,
          },
          // Каждое изменение цены — отдельное событие, не "одно событие на
          // юнит" — явный ключ с версией (после инкремента) гарантирует,
          // что повторные изменения цены того же юнита не схлопываются
          // друг с другом под одним default-ключом.
          deduplicationKey: `unit:${params.unitId.toString()}:UnitPriceChanged:v${params.expectedVersion + 1}`,
        },
        session,
      );
    });
  }

  /**
   * updateUnitStatus (permission-matrix.md `unit.status.update.project`).
   * reserveUnit/releaseUnit (domain-model.md commands) — тонкие обёртки
   * поверх этого метода с фиксированным целевым статусом, не отдельная
   * реализация: reserve = available→reserved, release = reserved→available,
   * оба — частные случаи "сменить статус с audit+outbox".
   */
  async updateUnitStatus(params: {
    unitId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    status: UnitStatus;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<void> {
    return runInTransaction(this.connection, async (session) => {
      const allowedFrom = UNIT_STATUS_ALLOWED_SOURCES[params.status];

      const { modifiedCount } = await this.unitRepository.updateStatusWithVersionCheck(
        params.unitId,
        params.organizationId,
        params.expectedVersion,
        params.status,
        allowedFrom,
        session,
      );

      if (modifiedCount === 0) {
        const current = await this.unitRepository.findByIdForOrganization(
          params.unitId,
          params.organizationId,
        );
        if (!current) {
          throw new NotFoundException('Unit not found');
        }
        // matrix.md: различаем "версия устарела" (ретрай после refresh
        // валиден) от "переход запрещён" (ретрай с той же version не
        // поможет — статус в принципе не может уйти current→target).
        if (!UNIT_STATUS_TRANSITIONS[current.status].includes(params.status)) {
          throw new AppException(
            ErrorCode.UNIT_INVALID_STATUS_TRANSITION,
            `Cannot transition unit status from "${current.status}" to "${params.status}"`,
            { from: current.status, to: params.status },
          );
        }
        throw new ConflictException('Unit was modified by another request — refresh and retry');
      }

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'unit.status.update',
          resource: 'unit',
          resourceId: params.unitId,
          after: { status: params.status },
          correlationId: params.correlationId,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'UnitStatusChanged',
          aggregateType: 'unit',
          aggregateId: params.unitId,
          payload: { status: params.status },
          deduplicationKey: `unit:${params.unitId.toString()}:UnitStatusChanged:v${params.expectedVersion + 1}`,
        },
        session,
      );
    });
  }

  async reserveUnit(params: {
    unitId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<void> {
    return this.updateUnitStatus({ ...params, status: 'reserved' });
  }

  async releaseUnit(params: {
    unitId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<void> {
    return this.updateUnitStatus({ ...params, status: 'available' });
  }

  /**
   * D-02 COMPLETE: read-side дочерней иерархии — тот же принцип tenant
   * isolation, что write-команды выше: parent проверяется по фактической
   * organizationId из БД перед возвратом списка дочерних сущностей (единый
   * NOT_FOUND и для "не существует", и для "чужая организация"). Без
   * transaction/audit/outbox — это read, не write.
   */
  async listBuildingsForDevelopment(
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<BuildingDocument[]> {
    const development = await this.developmentRepository.findByIdForOrganization(developmentId, organizationId);
    if (!development) {
      throw new NotFoundException('Development not found');
    }
    return this.buildingRepository.listForDevelopment(developmentId, organizationId);
  }

  async listSectionsForBuilding(
    buildingId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<SectionDocument[]> {
    const building = await this.buildingRepository.findByIdForOrganization(buildingId, organizationId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return this.sectionRepository.listForBuilding(buildingId, organizationId);
  }

  async listFloorsForBuilding(
    buildingId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<FloorDocument[]> {
    const building = await this.buildingRepository.findByIdForOrganization(buildingId, organizationId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return this.floorRepository.listForBuilding(buildingId, organizationId);
  }

  async listFloorPlansForBuilding(
    buildingId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<FloorPlanDocument[]> {
    const building = await this.buildingRepository.findByIdForOrganization(buildingId, organizationId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return this.floorPlanRepository.listForBuilding(buildingId, organizationId);
  }

  async listUnitsForBuilding(
    buildingId: Types.ObjectId,
    organizationId: Types.ObjectId,
    filter: { kind?: UnitKind; status?: UnitStatus; limit: number },
  ): Promise<UnitDocument[]> {
    const building = await this.buildingRepository.findByIdForOrganization(buildingId, organizationId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return this.unitRepository.listForBuilding(buildingId, organizationId, filter);
  }

  /**
   * BOOK-002 (GET /bookings developmentId/buildingId фильтры): Booking
   * хранит только unitId (schemas/booking.schema.ts), не buildingId/
   * developmentId напрямую — BookingsService не может отфильтровать по ним
   * без похода через Development-агрегат. UnitRepository — единственная
   * точка доступа к коллекции units (ADR-002 требование 2), поэтому
   * bookings-модуль идёт через этот публичный метод, а не напрямую в
   * репозиторий (граница модуля, тот же принцип, что
   * CrmService.getLeadForOrganization в BookingsService.book).
   * listForBuildings (не listForBuilding) — тот же unbounded-read, что
   * buildChessboardExport: список нужен целиком для корректной фильтрации,
   * урезанный лимитом список молча терял бы брони на юнитах, не попавших
   * в страницу.
   */
  async listUnitIdsForBuilding(buildingId: Types.ObjectId, organizationId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const building = await this.buildingRepository.findByIdForOrganization(buildingId, organizationId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    const units = await this.unitRepository.listForBuildings([buildingId], organizationId);
    return units.map((unit) => unit._id);
  }

  /** BOOK-002 — тот же принцип, что listUnitIdsForBuilding, для все корпуса ЖК сразу. */
  async listUnitIdsForDevelopment(
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const buildings = await this.listBuildingsForDevelopment(developmentId, organizationId);
    const buildingIds = buildings.map((building) => building._id);
    const units = await this.unitRepository.listForBuildings(buildingIds, organizationId);
    return units.map((unit) => unit._id);
  }

  /**
   * chessboard.export: собирает строки шахматки по ВСЕМУ ЖК (все корпуса
   * сразу — владелец подтвердил 31.08.2026: один файл на ЖК, корпус
   * отдельной колонкой). Только kind:'apartment' — паркинги/кладовые/
   * коммерция в шахматочную выгрузку не попадают (владелец, 31.08.2026),
   * иначе любой подсчёт по файлу (средняя цена м², остатки) смешивает
   * несопоставимые типы.
   *
   * Валюта: MoneyAmount хранится ПО-ЮНИТНО, а в формате выгрузки символ
   * валюты стоит в ЗАГОЛОВКЕ колонки (наследие оригинала, где валюта —
   * свойство проекта целиком). Если в одном ЖК встретились разные валюты,
   * единый заголовок неизбежно соврал бы про часть строк — поэтому это
   * явная ошибка 400, а не молчаливая выгрузка с неверной подписью.
   *
   * Потолок MAX_CHESSBOARD_EXPORT_UNITS проверяется ДО чтения самих
   * юнитов (countDocuments, не длина уже прочитанного массива) — иначе
   * защита от неограниченного чтения срабатывала бы уже после того, как
   * весь массив оказался в памяти процесса.
   */
  async buildChessboardExport(
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<{ developmentName: string; currency: Currency; units: ChessboardUnitInput[] }> {
    const development = await this.developmentRepository.findByIdForOrganization(developmentId, organizationId);
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    const buildings = await this.buildingRepository.listForDevelopment(developmentId, organizationId);
    const buildingIds = buildings.map((building) => building._id);

    const unitCount = await this.unitRepository.countForBuildings(buildingIds, organizationId, {
      kind: 'apartment',
    });
    if (unitCount > MAX_CHESSBOARD_EXPORT_UNITS) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `Chessboard export is limited to ${MAX_CHESSBOARD_EXPORT_UNITS} units, this development has ${unitCount}`,
        { unitCount, limit: MAX_CHESSBOARD_EXPORT_UNITS },
      );
    }

    const [units, floors] = await Promise.all([
      this.unitRepository.listForBuildings(buildingIds, organizationId, { kind: 'apartment' }),
      this.floorRepository.listForBuildings(buildingIds, organizationId),
    ]);

    const currencies = new Set(units.map((unit) => unit.price.currency));
    if (currencies.size > 1) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Chessboard export requires a single currency across the development',
        { currencies: [...currencies] },
      );
    }

    const buildingNameById = new Map(buildings.map((building) => [building._id.toString(), building.name]));
    const floorNumberById = new Map(floors.map((floor) => [floor._id.toString(), floor.floorNumber]));

    const rows: ChessboardUnitInput[] = units.map((unit) => ({
      buildingName: buildingNameById.get(unit.buildingId.toString()) ?? '',
      floorNumber: floorNumberById.get(unit.floorId.toString()) ?? 0,
      number: unit.number,
      rooms: unit.rooms,
      area: unit.area,
      priceMinorUnits: unit.price.amountMinorUnits,
      status: unit.status,
      promotion: unit.promotion,
    }));

    return {
      developmentName: development.name,
      currency: [...currencies][0] ?? 'USD',
      units: sortChessboardUnits(rows),
    };
  }

  /**
   * D-03: read-status для ERP polling после publish. Development.status
   * (draft/active/archived) меняется СИНХРОННО в publishDevelopment, ДО
   * того как worker вообще начал строить проекцию — не отражает готовность
   * marketplace-проекции. Этот метод читает РЕАЛЬНЫЙ MarketplacePublication.
   * status (publication_pending/published/unpublished/build_failed), тот
   * же принцип tenant isolation, что остальные read-методы: parent
   * (Development) проверяется по фактической organizationId из БД ПЕРЕД
   * чтением дочерней публикации, единый 404 и для "Development не
   * существует/чужой", и для "публикация никогда не запускалась" (publish
   * ни разу не вызывался — Development всё ещё draft).
   *
   * buildError — константный безопасный текст, не реальная причина сборки:
   * MarketplacePublication физически не хранит текст ошибки (только
   * status:'build_failed'), соответствует требованию "ошибка записывается
   * безопасно и не содержит секретов" буквально — нечему утечь, раз
   * реального текста нигде нет.
   */
  async getPublicationStatus(
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<{
    publicationId: string;
    status: 'publication_pending' | 'published' | 'unpublished' | 'build_failed';
    slug?: string;
    version: number;
    publishedAt?: string;
    unpublishedAt?: string;
    buildError?: string;
  }> {
    const development = await this.developmentRepository.findByIdForOrganization(developmentId, organizationId);
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    const publication = await this.publicationRepository.findBySource('development', developmentId);
    if (!publication) {
      throw new AppException(ErrorCode.PUBLICATION_NOT_FOUND, 'Publication not found for this development');
    }

    return {
      publicationId: publication._id.toString(),
      status: publication.status,
      slug: publication.slug,
      version: publication.version,
      publishedAt: publication.publishedAt?.toISOString(),
      unpublishedAt: publication.unpublishedAt?.toISOString(),
      buildError: publication.status === 'build_failed' ? 'Не удалось опубликовать. Обратитесь в поддержку.' : undefined,
    };
  }

  async createInstallmentPlan(params: {
    developmentId: Types.ObjectId;
    organizationId: Types.ObjectId;
    unitId?: Types.ObjectId;
    title: string;
    isActive?: boolean;
    applyTo?: InstallmentApplyTo;
    downPaymentType: InstallmentDownPaymentType;
    downPaymentValue: number;
    termType: InstallmentTermType;
    termMonths?: number;
    endDate?: string;
    paymentFrequency: InstallmentPaymentFrequency;
    useDiscount?: boolean;
    discountFromDownPayment?: boolean;
    discountPercent?: number;
    description?: string;
    sortOrder?: number;
    idempotency: IdempotencyParams;
  }): Promise<InstallmentPlanDocument> {
    const development = await this.developmentRepository.findByIdForOrganization(
      params.developmentId,
      params.organizationId,
    );
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    if (params.unitId) {
      const unit = await this.unitRepository.findByIdForOrganization(
        params.unitId,
        params.organizationId,
      );
      if (!unit) {
        throw new NotFoundException('Unit not found');
      }
    }

    return this.createIdempotently(params.idempotency, (session) =>
      this.installmentPlanRepository.create(
        {
          organizationId: params.organizationId,
          developmentId: params.developmentId,
          unitId: params.unitId,
          title: params.title,
          isActive: params.isActive,
          applyTo: params.applyTo,
          downPaymentType: params.downPaymentType,
          downPaymentValue: params.downPaymentValue,
          termType: params.termType,
          termMonths: params.termMonths,
          endDate: params.endDate,
          paymentFrequency: params.paymentFrequency,
          useDiscount: params.useDiscount,
          discountFromDownPayment: params.discountFromDownPayment,
          discountPercent: params.discountPercent,
          description: params.description,
          sortOrder: params.sortOrder,
        },
        session,
      ),
    );
  }

  async listInstallmentPlans(
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
    filter: { unitId?: Types.ObjectId } = {},
  ): Promise<InstallmentPlanDocument[]> {
    const development = await this.developmentRepository.findByIdForOrganization(
      developmentId,
      organizationId,
    );
    if (!development) {
      throw new NotFoundException('Development not found');
    }
    return this.installmentPlanRepository.listForDevelopment(developmentId, organizationId, filter);
  }

  async getInstallmentPlanForOrganization(
    id: Types.ObjectId,
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<InstallmentPlanDocument> {
    const plan = await this.installmentPlanRepository.findByIdForOrganization(id, organizationId);
    if (!plan || !plan.developmentId.equals(developmentId)) {
      throw new NotFoundException('Installment plan not found');
    }
    return plan;
  }

  async updateInstallmentPlan(params: {
    id: Types.ObjectId;
    developmentId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    patch: UpdateInstallmentPlanPatch;
    idempotency: IdempotencyParams;
  }): Promise<InstallmentPlanDocument> {
    const development = await this.developmentRepository.findByIdForOrganization(
      params.developmentId,
      params.organizationId,
    );
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    const existing = await this.installmentPlanRepository.findByIdForOrganization(
      params.id,
      params.organizationId,
    );
    if (!existing || !existing.developmentId.equals(params.developmentId)) {
      throw new NotFoundException('Installment plan not found');
    }

    if (params.patch.unitId) {
      const unit = await this.unitRepository.findByIdForOrganization(
        params.patch.unitId,
        params.organizationId,
      );
      if (!unit) {
        throw new NotFoundException('Unit not found');
      }
    }

    return runInTransaction(this.connection, async (session) => {
      const updated = await this.installmentPlanRepository.updateWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        params.patch,
        session,
      );
      if (!updated) {
        throw new ConflictException('Installment plan was modified by another request (version conflict)');
      }

      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 200,
          responseBody: toPlainRecord(updated),
        },
        session,
      );

      return updated;
    });
  }

  async deleteInstallmentPlan(params: {
    id: Types.ObjectId;
    developmentId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    idempotency: IdempotencyParams;
  }): Promise<void> {
    const development = await this.developmentRepository.findByIdForOrganization(
      params.developmentId,
      params.organizationId,
    );
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    const existing = await this.installmentPlanRepository.findByIdForOrganization(
      params.id,
      params.organizationId,
    );
    if (!existing || !existing.developmentId.equals(params.developmentId)) {
      throw new NotFoundException('Installment plan not found');
    }

    await runInTransaction(this.connection, async (session) => {
      const deleted = await this.installmentPlanRepository.deleteWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        session,
      );
      if (!deleted) {
        throw new ConflictException('Installment plan was modified by another request (version conflict)');
      }

      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 204,
          responseBody: {},
        },
        session,
      );
    });
  }

  /**
   * Пакетная генерация шахматки по этажам и стоякам.
   */
  async generateChessboard(params: {
    buildingId: Types.ObjectId;
    organizationId: Types.ObjectId;
    sectionId?: Types.ObjectId;
    fromFloor: number;
    toFloor: number;
    unitsPerFloor: number;
    numberingScheme?: 'floor_prefix' | 'sequential';
    defaultKind?: UnitKind;
    rooms?: number;
    defaultArea: number;
    defaultAreaLiving?: number;
    defaultAreaBalcony?: number;
    defaultPrice: MoneyAmount;
    floorPlanId?: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
    idempotency: IdempotencyParams;
  }): Promise<{ generatedFloors: number; generatedUnits: number; units: UnitDocument[] }> {
    if (params.fromFloor > params.toFloor) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'fromFloor must be <= toFloor');
    }

    const building = await this.buildingRepository.findByIdForOrganization(
      params.buildingId,
      params.organizationId,
    );
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    if (params.sectionId) {
      const section = await this.sectionRepository.findByIdForOrganization(
        params.sectionId,
        params.organizationId,
      );
      if (!section || !section.buildingId.equals(params.buildingId)) {
        throw new NotFoundException('Section not found');
      }
    }

    if (params.floorPlanId) {
      const floorPlan = await this.floorPlanRepository.findByIdForOrganization(
        params.floorPlanId,
        params.organizationId,
      );
      if (!floorPlan || !floorPlan.buildingId.equals(params.buildingId)) {
        throw new NotFoundException('FloorPlan not found');
      }
    }

    return runInTransaction(this.connection, async (session) => {
      await this.assertSingleCurrencyWithinDevelopment({
        buildingId: params.buildingId,
        organizationId: params.organizationId,
        currencies: [params.defaultPrice.currency],
        session,
      });

      let generatedFloors = 0;
      const floorMap = new Map<number, FloorDocument>();

      for (let f = params.fromFloor; f <= params.toFloor; f++) {
        let floor = await this.floorRepository.findByBuildingAndNumber(
          params.buildingId,
          f,
          params.organizationId,
        );
        if (!floor) {
          floor = await this.floorRepository.create(
            {
              buildingId: params.buildingId,
              sectionId: params.sectionId,
              organizationId: params.organizationId,
              floorNumber: f,
            },
            session,
          );
          generatedFloors++;
        }
        floorMap.set(f, floor);
      }

      const existingUnits = await this.unitRepository.listForBuilding(
        params.buildingId,
        params.organizationId,
        { limit: 10000 },
      );
      const existingNumbers = new Set(existingUnits.map((u) => u.number));

      const unitsToCreate: Array<{
        buildingId: Types.ObjectId;
        floorId: Types.ObjectId;
        sectionId?: Types.ObjectId;
        organizationId: Types.ObjectId;
        number: string;
        kind: UnitKind;
        rooms?: number;
        area: number;
        areaLiving?: number;
        areaBalcony?: number;
        price: MoneyAmount;
        floorPlanId?: Types.ObjectId;
      }> = [];

      let seq = 1;
      for (let f = params.fromFloor; f <= params.toFloor; f++) {
        const floor = floorMap.get(f)!;
        for (let u = 1; u <= params.unitsPerFloor; u++) {
          let unitNumber: string;
          if (params.numberingScheme === 'sequential') {
            unitNumber = String(seq++);
          } else {
            const pad = u < 10 ? `0${u}` : `${u}`;
            unitNumber = `${f}${pad}`;
          }

          if (!existingNumbers.has(unitNumber)) {
            existingNumbers.add(unitNumber);
            unitsToCreate.push({
              buildingId: params.buildingId,
              floorId: floor._id,
              sectionId: params.sectionId ?? floor.sectionId,
              organizationId: params.organizationId,
              number: unitNumber,
              kind: params.defaultKind ?? 'apartment',
              rooms: params.rooms,
              area: params.defaultArea,
              areaLiving: params.defaultAreaLiving,
              areaBalcony: params.defaultAreaBalcony,
              price: params.defaultPrice,
              floorPlanId: params.floorPlanId,
            });
          }
        }
      }

      const createdUnits = await this.unitRepository.createMany(unitsToCreate, session);

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'development.chessboard_generate',
          resource: 'building',
          resourceId: params.buildingId,
          correlationId: params.correlationId,
          after: {
            generatedFloors,
            generatedUnits: createdUnits.length,
            fromFloor: params.fromFloor,
            toFloor: params.toFloor,
            unitsPerFloor: params.unitsPerFloor,
          },
        },
        session,
      );

      const result = {
        generatedFloors,
        generatedUnits: createdUnits.length,
        units: createdUnits,
      };
      // ИСПРАВЛЕНО 10.09.2026: запись идемпотентности в той же транзакции,
      // что и создание юнитов — см. createIdempotently выше, тот же принцип
      // ADR-006, здесь не переиспользован буквально из-за пред-транзакционных
      // проверок (building/section/floorPlan) выше по методу.
      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 201,
          responseBody: JSON.parse(JSON.stringify(result)),
        },
        session,
      );
      return result;
    });
  }

  /**
   * Пакетный импорт/создание юнитов.
   */
  async batchCreateUnits(params: {
    buildingId: Types.ObjectId;
    organizationId: Types.ObjectId;
    units: BatchUnitItemDto[];
    actorIdentityId: Types.ObjectId;
    correlationId: string;
    idempotency: IdempotencyParams;
  }): Promise<{ createdCount: number; units: UnitDocument[] }> {
    const building = await this.buildingRepository.findByIdForOrganization(
      params.buildingId,
      params.organizationId,
    );
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    return runInTransaction(this.connection, async (session) => {
      await this.assertSingleCurrencyWithinDevelopment({
        buildingId: params.buildingId,
        organizationId: params.organizationId,
        currencies: params.units.map((u) => u.price.currency),
        session,
      });

      const floorNumbers = Array.from(new Set(params.units.map((u) => u.floorNumber)));
      const floorMap = new Map<number, FloorDocument>();

      for (const fn of floorNumbers) {
        let floor = await this.floorRepository.findByBuildingAndNumber(
          params.buildingId,
          fn,
          params.organizationId,
        );
        if (!floor) {
          floor = await this.floorRepository.create(
            {
              buildingId: params.buildingId,
              organizationId: params.organizationId,
              floorNumber: fn,
            },
            session,
          );
        }
        floorMap.set(fn, floor);
      }

      const unitsToCreate: Array<{
        buildingId: Types.ObjectId;
        floorId: Types.ObjectId;
        sectionId?: Types.ObjectId;
        organizationId: Types.ObjectId;
        number: string;
        kind: UnitKind;
        rooms?: number;
        area: number;
        areaLiving?: number;
        areaBalcony?: number;
        price: MoneyAmount;
        floorPlanId?: Types.ObjectId;
      }> = [];

      for (const item of params.units) {
        const floor = floorMap.get(item.floorNumber)!;
        unitsToCreate.push({
          buildingId: params.buildingId,
          floorId: floor._id,
          sectionId: item.sectionId ? new Types.ObjectId(item.sectionId) : floor.sectionId,
          organizationId: params.organizationId,
          number: item.number,
          kind: item.kind,
          rooms: item.rooms,
          area: item.area,
          areaLiving: item.areaLiving,
          areaBalcony: item.areaBalcony,
          price: item.price,
          floorPlanId: item.floorPlanId ? new Types.ObjectId(item.floorPlanId) : undefined,
        });
      }

      const createdUnits = await this.unitRepository.createMany(unitsToCreate, session);

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'development.units_batch_create',
          resource: 'building',
          resourceId: params.buildingId,
          correlationId: params.correlationId,
          after: {
            createdCount: createdUnits.length,
          },
        },
        session,
      );

      const result = {
        createdCount: createdUnits.length,
        units: createdUnits,
      };
      // ИСПРАВЛЕНО 10.09.2026: без записи повтор плодил дублирующиеся юниты.
      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 201,
          responseBody: JSON.parse(JSON.stringify(result)),
        },
        session,
      );
      return result;
    });
  }

  /**
   * Массовое обновление цен на юниты с аудитом и outbox-событиями.
   */
  async batchUpdatePrices(params: {
    developmentId: Types.ObjectId;
    organizationId: Types.ObjectId;
    buildingId?: Types.ObjectId;
    floorMin?: number;
    floorMax?: number;
    kind?: UnitKind;
    unitIds?: Types.ObjectId[];
    operationType: 'percentage' | 'delta_per_sqm' | 'fixed_price_per_sqm' | 'fixed_total';
    value: number;
    reason?: string;
    actorIdentityId: Types.ObjectId;
    actorPositionId: Types.ObjectId;
    correlationId: string;
    idempotency: IdempotencyParams;
  }): Promise<{ updatedCount: number; affectedUnitIds: string[] }> {
    const development = await this.developmentRepository.findByIdForOrganization(
      params.developmentId,
      params.organizationId,
    );
    if (!development) {
      throw new NotFoundException('Development not found');
    }

    const buildings = await this.buildingRepository.listForDevelopment(
      params.developmentId,
      params.organizationId,
    );
    let targetBuildingIds = buildings.map((b) => b._id);

    if (params.buildingId) {
      if (!targetBuildingIds.some((bId) => bId.equals(params.buildingId!))) {
        throw new NotFoundException('Building not found in development');
      }
      targetBuildingIds = [params.buildingId];
    }

    const floors = await this.floorRepository.listForBuildings(
      targetBuildingIds,
      params.organizationId,
    );
    const floorMap = new Map<string, number>();
    for (const f of floors) {
      floorMap.set(f._id.toString(), f.floorNumber);
    }

    const allUnits = await this.unitRepository.listForBuildings(
      targetBuildingIds,
      params.organizationId,
      params.kind ? { kind: params.kind } : {},
    );

    const explicitUnitIdSet = params.unitIds ? new Set(params.unitIds.map((id) => id.toString())) : null;

    const candidateUnits = allUnits.filter((u) => {
      if (explicitUnitIdSet && !explicitUnitIdSet.has(u._id.toString())) {
        return false;
      }
      const floorNum = floorMap.get(u.floorId.toString());
      if (params.floorMin !== undefined && (floorNum === undefined || floorNum < params.floorMin)) {
        return false;
      }
      if (params.floorMax !== undefined && (floorNum === undefined || floorNum > params.floorMax)) {
        return false;
      }
      return true;
    });

    if (candidateUnits.length === 0) {
      return { updatedCount: 0, affectedUnitIds: [] };
    }

    return runInTransaction(this.connection, async (session) => {
      const affectedUnitIds: string[] = [];

      for (const unit of candidateUnits) {
        const oldMinor = unit.price.amountMinorUnits;
        let newMinor: number;

        switch (params.operationType) {
          case 'percentage':
            newMinor = Math.round(oldMinor * (1 + params.value / 100));
            break;
          case 'delta_per_sqm':
            newMinor = oldMinor + Math.round(params.value * unit.area * 100);
            break;
          case 'fixed_price_per_sqm':
            newMinor = Math.round(params.value * unit.area * 100);
            break;
          case 'fixed_total':
            newMinor = Math.round(params.value * 100);
            break;
        }

        if (newMinor <= 0) {
          throw new AppException(
            ErrorCode.VALIDATION_FAILED,
            `Price calculation for unit ${unit.number} resulted in non-positive value (${newMinor})`,
          );
        }

        const newPrice: MoneyAmount = {
          amountMinorUnits: newMinor,
          currency: unit.price.currency,
        };

        const { modifiedCount } = await this.unitRepository.updatePriceWithVersionCheck(
          unit._id,
          params.organizationId,
          unit.version,
          { price: newPrice, changedBy: params.actorPositionId },
          session,
        );

        if (modifiedCount === 0) {
          throw new ConflictException(`Unit ${unit.number} was modified by another request — refresh and retry`);
        }

        await this.outboxService.publish(
          {
            eventType: 'UnitPriceChanged',
            aggregateType: 'unit',
            aggregateId: unit._id,
            payload: {
              amountMinorUnits: newPrice.amountMinorUnits,
              currency: newPrice.currency,
            },
            deduplicationKey: `unit:${unit._id.toString()}:UnitPriceChanged:v${unit.version + 1}`,
          },
          session,
        );

        affectedUnitIds.push(unit._id.toString());
      }

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'development.batch_price_update',
          resource: 'development',
          resourceId: params.developmentId,
          correlationId: params.correlationId,
          after: {
            updatedCount: affectedUnitIds.length,
            operationType: params.operationType,
            value: params.value,
            reason: params.reason ?? null,
            affectedUnitIds,
          },
        },
        session,
      );

      const result = {
        updatedCount: affectedUnitIds.length,
        affectedUnitIds,
      };
      // ИСПРАВЛЕНО 10.09.2026: без записи повторный запрос (ретрай/двойной
      // клик по "+10%") применял процентную наценку второй раз.
      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 200,
          responseBody: JSON.parse(JSON.stringify(result)),
        },
        session,
      );
      return result;
    });
  }
}
