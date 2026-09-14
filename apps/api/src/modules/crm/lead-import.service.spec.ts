import { Types } from 'mongoose';
import { LeadImportService } from './lead-import.service';
import type { CrmService } from './crm.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import type { AuditService } from '../audit/audit.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';

const organizationId = new Types.ObjectId();
const actorPositionId = new Types.ObjectId();
const actorIdentityId = new Types.ObjectId();

function csvBuffer(rows: string[]): Buffer {
  return Buffer.from(['phone,name', ...rows].join('\n'), 'utf8');
}

function makeService(overrides: {
  allowed?: boolean;
  createLead?: jest.Mock;
  checkReplay?: jest.Mock;
} = {}) {
  const evaluate = jest.fn().mockResolvedValue(overrides.allowed ?? true);
  const append = jest.fn().mockResolvedValue(undefined);
  const checkReplay = overrides.checkReplay ?? jest.fn().mockResolvedValue(null);
  const record = jest.fn().mockResolvedValue(undefined);
  const createLead =
    overrides.createLead ?? jest.fn().mockResolvedValue({ id: new Types.ObjectId().toString(), stage: 'new' });

  const service = new LeadImportService(
    { createLead } as unknown as CrmService,
    { evaluate } as unknown as PolicyEvaluatorService,
    { append } as unknown as AuditService,
    { checkReplay, record } as unknown as IdempotencyService,
  );

  return { service, evaluate, append, checkReplay, record, createLead };
}

const baseParams = {
  organizationId,
  actorPositionId,
  actorIdentityId,
  correlationId: 'corr-import-1',
};

describe('LeadImportService — import.run НЕ заменяет lead.create', () => {
  it('без lead.create отказывает всему импорту, ничего не парсит и не создаёт', async () => {
    const { service, createLead } = makeService({ allowed: false });

    await expect(
      service.importLeads({ ...baseParams, fileBuffer: csvBuffer(['+995500000001,Иван']), fileName: 'l.csv', mimetype: 'text/csv' }),
    ).rejects.toThrow('Недостаточно прав: lead.create');
    expect(createLead).not.toHaveBeenCalled();
  });
});

describe('LeadImportService — построчная обработка', () => {
  it('N валидных строк — N вызовов createLead, отчёт created=N, failed=0', async () => {
    const { service, createLead } = makeService();
    const buffer = csvBuffer(['+995500000001,Иван', '+995500000002,Пётр']);

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(createLead).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ total: 2, created: 2, failed: 0, errors: [] });
  });

  it('строка без phone не роняет импорт, попадает в errors с правильным row', async () => {
    const { service, createLead } = makeService();
    const buffer = csvBuffer(['+995500000001,Иван', ',Без телефона', '+995500000003,Пётр']);

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(result.total).toBe(3);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ row: 2, message: expect.stringContaining('phone') }]);
    expect(createLead).toHaveBeenCalledTimes(2);
  });

  it('явно не-телефон («нет», короткий номер) — ошибка строки, лид не создаётся', async () => {
    const { service, createLead } = makeService();
    const buffer = csvBuffer(['+995 (555) 000-001,Иван', 'нет,Без номера', '12345,Короткий']);

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      { row: 2, message: 'Некорректный телефон: нет' },
      { row: 3, message: 'Некорректный телефон: 12345' },
    ]);
    expect(createLead).toHaveBeenCalledTimes(1);
  });

  it('createLead бросает ошибку на одной строке — остальные всё равно обрабатываются', async () => {
    const createLead = jest
      .fn()
      .mockResolvedValueOnce({ id: '1', stage: 'new' })
      .mockRejectedValueOnce(new AppException(ErrorCode.VALIDATION_FAILED, 'что-то не так'))
      .mockResolvedValueOnce({ id: '3', stage: 'new' });
    const { service } = makeService({ createLead });
    const buffer = csvBuffer(['+995500000001,А', '+995500000002,Б', '+995500000003,В']);

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(result).toMatchObject({ total: 3, created: 2, failed: 1 });
    expect(result.errors).toEqual([{ row: 2, message: 'что-то не так' }]);
  });

  it('превышение потолка 2000 строк отклоняется целиком, createLead не вызывается вовсе', async () => {
    const { service, createLead } = makeService();
    const rows = Array.from({ length: 2001 }, (_, i) => `+99550000${String(i).padStart(4, '0')},Клиент${i}`);

    await expect(
      service.importLeads({ ...baseParams, fileBuffer: csvBuffer(rows), fileName: 'l.csv', mimetype: 'text/csv' }),
    ).rejects.toThrow(/2000/);
    expect(createLead).not.toHaveBeenCalled();
  });

  it('пишет ровно один audit-batch на весь импорт, не по записи на строку', async () => {
    const { service, append } = makeService();
    const buffer = csvBuffer(['+995500000001,А', '+995500000002,Б']);

    await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import.run',
        resource: 'lead',
        after: expect.objectContaining({ fileName: 'l.csv', total: 2, created: 2, failed: 0 }),
      }),
    );
  });
});

describe('LeadImportService — идемпотентность строки', () => {
  it('replay для строки — не вызывает createLead повторно, засчитывается как success', async () => {
    const checkReplay = jest.fn().mockResolvedValue({ responseStatus: 201, responseBody: { id: 'existing' } });
    const { service, createLead } = makeService({ checkReplay });
    const buffer = csvBuffer(['+995500000001,Иван']);

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(createLead).not.toHaveBeenCalled();
    expect(result).toMatchObject({ total: 1, created: 1, failed: 0 });
  });

  it('один и тот же phone дважды в одном файле — второе вхождение дедуплицируется тем же ключом', async () => {
    const { service, checkReplay } = makeService();
    const buffer = csvBuffer(['+995500000001,Иван', '+995500000001,Иван']);

    await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    const keys = checkReplay.mock.calls.map((call) => call[0].key);
    expect(keys[0]).toBe(keys[1]);
  });

  it('конфликт идемпотентности (тот же ключ, другое тело) — попадает в errors, не роняет импорт', async () => {
    const checkReplay = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new AppException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT, 'конфликт идемпотентности'));
    const { service, createLead } = makeService({ checkReplay });
    const buffer = csvBuffer(['+995500000001,Иван', '+995500000001,Другое Имя']);

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(createLead).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ total: 2, created: 1, failed: 1 });
    expect(result.errors).toEqual([{ row: 2, message: 'конфликт идемпотентности' }]);
  });
});

describe('LeadImportService — legacy-base-import колонки и tag', () => {
  it('tag=old_base — createLead получает route:import, tags:[old_base] и route не зависит от идемпотентности', async () => {
    const { service, createLead } = makeService();
    const buffer = csvBuffer(['+995500000001,Иван']);

    await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv', tag: 'old_base' });

    expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'import', tags: ['old_base'] }),
    );
  });

  it('без tag — createLead получает route:import, но tags не проставляется', async () => {
    const { service, createLead } = makeService();
    const buffer = csvBuffer(['+995500000001,Иван']);

    await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ route: 'import', tags: undefined }));
  });

  it('whatsapp/telegram/comment/last_contact колонки — передаются в createLead как whatsapp/telegram/notes/lastContactAt', async () => {
    const { service, createLead } = makeService();
    const buffer = Buffer.from(
      'phone,name,telegram,whatsapp,comment,last_contact\n+995500000001,Иван,@ivan,+995500000009,Старая заявка,2026-01-15\n',
      'utf8',
    );

    await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        telegram: '@ivan',
        whatsapp: '+995500000009',
        notes: 'Старая заявка',
        lastContactAt: new Date('2026-01-15T00:00:00.000Z'),
      }),
    );
  });

  it('невалидная дата last_contact — ошибка ТОЛЬКО этой строки, остальные создаются', async () => {
    const { service, createLead } = makeService();
    const buffer = Buffer.from(
      'phone,name,last_contact\n+995500000001,Иван,31.02.2026\n+995500000002,Пётр,15.01.2026\n',
      'utf8',
    );

    const result = await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv' });

    expect(result).toMatchObject({ total: 2, created: 1, failed: 1 });
    expect(result.errors).toEqual([{ row: 1, message: expect.stringContaining('Некорректная дата') }]);
    expect(createLead).toHaveBeenCalledTimes(1);
  });

  it('идемпотентность строки НЕ зависит от tag/новых колонок — requestBody остаётся {organizationId,requesterName,requesterPhone}', async () => {
    const { service, checkReplay } = makeService();
    const buffer = Buffer.from('phone,name,whatsapp\n+995500000001,Иван,+995500000009\n', 'utf8');

    await service.importLeads({ ...baseParams, fileBuffer: buffer, fileName: 'l.csv', mimetype: 'text/csv', tag: 'old_base' });

    expect(checkReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { organizationId: organizationId.toString(), requesterName: 'Иван', requesterPhone: '+995500000001' },
      }),
    );
  });
});
