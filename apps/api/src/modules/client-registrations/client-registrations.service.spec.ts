import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import {
  ClientRegistrationsService,
  normalizePhone,
  reservationEnd,
} from './client-registrations.service';

const connection = {
  startSession: jest.fn().mockResolvedValue({
    withTransaction: async (work: (session: unknown) => Promise<unknown>) => work({}),
    endSession: jest.fn(),
  }),
};

function buildService(overrides: {
  registrations?: unknown;
  developments?: unknown;
  organizations?: unknown;
  publication?: unknown;
  audit?: unknown;
  idempotency?: unknown;
}) {
  return new ClientRegistrationsService(
    connection as never,
    (overrides.registrations ?? {}) as never,
    (overrides.developments ?? {}) as never,
    (overrides.organizations ?? {}) as never,
    (overrides.publication ?? { findPublishedDevelopmentIdBySlug: jest.fn() }) as never,
    (overrides.audit ?? { append: jest.fn() }) as never,
    (overrides.idempotency ?? { record: jest.fn() }) as never,
  );
}

function registrationDoc(patch: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    developerName: 'Группа ПИК',
    projectName: 'ЖК Солнечный',
    clientName: 'Иванов Иван',
    clientPhone: '+995 555 12-34-56',
    clientPhoneNormalized: '995555123456',
    agentPositionId: new Types.ObjectId(),
    status: 'pending',
    version: 0,
    createdAt: new Date('2026-09-16T10:00:00Z'),
    ...patch,
  };
}

describe('нормализация телефона и срок закрепления', () => {
  it('разделители не делают из одного человека двух', () => {
    expect(normalizePhone('+995 555 12-34-56')).toBe('995555123456');
    expect(normalizePhone('995555123456')).toBe('995555123456');
  });

  it('закрепление длится шесть месяцев от подтверждения', () => {
    expect(reservationEnd(new Date('2026-09-16T10:00:00Z')).toISOString()).toBe('2027-03-16T10:00:00.000Z');
  });
});

describe('ClientRegistrationsService.create', () => {
  it('по ЖК платформы выводит застройщика из комплекса, а не из тела запроса', async () => {
    const developerOrganizationId = new Types.ObjectId();
    const developmentId = new Types.ObjectId();
    const created = registrationDoc({ developerOrganizationId, developmentId, developerName: 'Застройщик Икс' });
    const registrations = { findBlocking: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(created) };
    const developments = {
      getPublishedDevelopmentSummary: jest
        .fn()
        .mockResolvedValue({ id: developmentId, organizationId: developerOrganizationId, name: 'ЖК Солнечный' }),
    };
    const organizations = { getOrganizationById: jest.fn().mockResolvedValue({ name: 'Застройщик Икс' }) };
    const service = buildService({ registrations, developments, organizations });

    const view = await service.create({
      organizationId: new Types.ObjectId(),
      agentPositionId: new Types.ObjectId(),
      input: {
        developmentId: developmentId.toString(),
        // Подставленное клиентом имя чужого застройщика игнорируется.
        developerName: 'Я сам себе застройщик',
        clientName: 'Иванов Иван',
        clientPhone: '+995 555 12-34-56',
      },
      idempotency: { actorIdentityId: new Types.ObjectId(), key: 'key-1', requestBody: {} },
      correlationId: 'corr-1',
    });

    expect(registrations.create).toHaveBeenCalledWith(
      expect.objectContaining({ developerOrganizationId, developmentId, developerName: 'Застройщик Икс' }),
      expect.anything(),
    );
    expect(view.awaitsDeveloper).toBe(true);
  });

  it('клиент, уже закреплённый в этом ЖК, отвечает 409 и не раскрывает агентство', async () => {
    const developmentId = new Types.ObjectId();
    const blocking = registrationDoc({ status: 'active', reservedUntil: new Date('2027-01-01T00:00:00Z') });
    const registrations = { findBlocking: jest.fn().mockResolvedValue(blocking), create: jest.fn() };
    const developments = {
      getPublishedDevelopmentSummary: jest
        .fn()
        .mockResolvedValue({ id: developmentId, organizationId: new Types.ObjectId(), name: 'ЖК Солнечный' }),
    };
    const organizations = { getOrganizationById: jest.fn().mockResolvedValue({ name: 'Застройщик Икс' }) };
    const service = buildService({ registrations, developments, organizations });

    await expect(
      service.create({
        organizationId: new Types.ObjectId(),
        agentPositionId: new Types.ObjectId(),
        input: { developmentId: developmentId.toString(), clientName: 'Иванов Иван', clientPhone: '995555123456' },
        idempotency: { actorIdentityId: new Types.ObjectId(), key: 'key-2', requestBody: {} },
        correlationId: 'corr-2',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLIENT_ALREADY_REGISTERED });
    expect(registrations.create).not.toHaveBeenCalled();
  });

  it('ЖК из каталога витрины находится по адресу карточки, неизвестный адрес — 404', async () => {
    const developmentId = new Types.ObjectId();
    const developerOrganizationId = new Types.ObjectId();
    const created = registrationDoc({ developerOrganizationId, developmentId });
    const registrations = { findBlocking: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(created) };
    const developments = {
      getPublishedDevelopmentSummary: jest
        .fn()
        .mockResolvedValue({ id: developmentId, organizationId: developerOrganizationId, name: 'ЖК Солнечный' }),
    };
    const organizations = { getOrganizationById: jest.fn().mockResolvedValue({ name: 'Застройщик Икс' }) };
    const found = { findPublishedDevelopmentIdBySlug: jest.fn().mockResolvedValue(developmentId) };
    const missing = { findPublishedDevelopmentIdBySlug: jest.fn().mockResolvedValue(null) };
    const input = {
      developmentSlug: 'zhk-solnechnyy-batumi',
      clientName: 'Иванов Иван',
      clientPhone: '995555123456',
    };
    const create = (publication: unknown) =>
      buildService({ registrations, developments, organizations, publication }).create({
        organizationId: new Types.ObjectId(),
        agentPositionId: new Types.ObjectId(),
        input,
        idempotency: { actorIdentityId: new Types.ObjectId(), key: 'key-slug', requestBody: {} },
        correlationId: 'corr-slug',
      });

    await expect(create(found)).resolves.toMatchObject({ awaitsDeveloper: true });
    expect(developments.getPublishedDevelopmentSummary).toHaveBeenCalledWith(developmentId);
    await expect(create(missing)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('без ЖК платформы требует и застройщика, и проект', async () => {
    const service = buildService({ registrations: { create: jest.fn() } });
    await expect(
      service.create({
        organizationId: new Types.ObjectId(),
        agentPositionId: new Types.ObjectId(),
        input: { developerName: 'Группа ПИК', clientName: 'Иванов Иван', clientPhone: '995555123456' },
        idempotency: { actorIdentityId: new Types.ObjectId(), key: 'key-3', requestBody: {} },
        correlationId: 'corr-3',
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('заявка по внешнему застройщику никого не ждёт и проверку закрепления не запускает', async () => {
    const created = registrationDoc();
    const registrations = { findBlocking: jest.fn(), create: jest.fn().mockResolvedValue(created) };
    const service = buildService({ registrations });

    const view = await service.create({
      organizationId: new Types.ObjectId(),
      agentPositionId: new Types.ObjectId(),
      input: {
        developerName: 'Группа ПИК',
        projectName: 'ЖК Солнечный',
        clientName: 'Иванов Иван',
        clientPhone: '995555123456',
      },
      idempotency: { actorIdentityId: new Types.ObjectId(), key: 'key-4', requestBody: {} },
      correlationId: 'corr-4',
    });

    expect(registrations.findBlocking).not.toHaveBeenCalled();
    expect(view.awaitsDeveloper).toBe(false);
  });
});

describe('ClientRegistrationsService: решения', () => {
  it('подтверждение застройщика закрепляет клиента на шесть месяцев', async () => {
    const accepted = registrationDoc({ status: 'active', reservedUntil: new Date('2027-03-16T10:00:00Z'), version: 1 });
    const registrations = { decide: jest.fn().mockResolvedValue(accepted) };
    const audit = { append: jest.fn() };
    const service = buildService({ registrations, audit });

    const view = await service.accept({
      registrationId: accepted._id,
      developerOrganizationId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      decidedByPositionId: new Types.ObjectId(),
      expectedVersion: 0,
      correlationId: 'corr-5',
    });

    expect(view.status).toBe('active');
    expect(registrations.decide).toHaveBeenCalledWith(
      accepted._id,
      expect.objectContaining({ developerOrganizationId: expect.anything() }),
      0,
      ['pending'],
      expect.objectContaining({ reservedUntil: expect.any(Date) }),
      expect.anything(),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client_registration.accept' }),
      expect.anything(),
    );
  });

  it('уже отвеченная заявка отвечает «уже в статусе», а устаревшая версия — конфликтом версий', async () => {
    const id = new Types.ObjectId();
    const developerOrganizationId = new Types.ObjectId();
    const answered = { decide: jest.fn().mockResolvedValue(null), findForDeveloper: jest.fn().mockResolvedValue(registrationDoc({ status: 'rejected' })) };
    const stale = { decide: jest.fn().mockResolvedValue(null), findForDeveloper: jest.fn().mockResolvedValue(registrationDoc({ status: 'pending' })) };
    const decide = (registrations: unknown) =>
      buildService({ registrations }).accept({
        registrationId: id,
        developerOrganizationId,
        actorIdentityId: new Types.ObjectId(),
        decidedByPositionId: new Types.ObjectId(),
        expectedVersion: 0,
        correlationId: 'corr-6',
      });

    await expect(decide(answered)).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(decide(stale)).rejects.toMatchObject({ code: ErrorCode.VERSION_CONFLICT });
  });

  it('чужая заявка для застройщика не существует', async () => {
    const registrations = { decide: jest.fn().mockResolvedValue(null), findForDeveloper: jest.fn().mockResolvedValue(null) };
    const service = buildService({ registrations });
    await expect(
      service.reject({
        registrationId: new Types.ObjectId(),
        developerOrganizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        decidedByPositionId: new Types.ObjectId(),
        expectedVersion: 0,
        reason: 'Клиент уже наш',
        correlationId: 'corr-7',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ручное подтверждение запрещено, когда заявка адресована застройщику на платформе', async () => {
    const existing = registrationDoc({ developerOrganizationId: new Types.ObjectId() });
    const registrations = { findForOrganization: jest.fn().mockResolvedValue(existing), decide: jest.fn() };
    const service = buildService({ registrations });

    await expect(
      service.confirmExternal({
        registrationId: existing._id,
        organizationId: existing.organizationId,
        actorIdentityId: new Types.ObjectId(),
        decidedByPositionId: new Types.ObjectId(),
        expectedVersion: 0,
        correlationId: 'corr-8',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(registrations.decide).not.toHaveBeenCalled();
  });
});

describe('ClientRegistrationsService: чтение', () => {
  it('истёкшее закрепление видно как isExpired, статус в базе остаётся active', async () => {
    const expired = registrationDoc({ status: 'active', reservedUntil: new Date('2026-01-01T00:00:00Z') });
    const service = buildService({ registrations: { listForOrganization: jest.fn().mockResolvedValue([expired]) } });
    const [view] = await service.listForOrganization(new Types.ObjectId(), {});
    expect(view!.status).toBe('active');
    expect(view!.isExpired).toBe(true);
  });

  it('во входящих застройщик видит агентство-заявителя', async () => {
    const developerOrganizationId = new Types.ObjectId();
    const doc = registrationDoc({ developerOrganizationId });
    const service = buildService({ registrations: { listForDeveloper: jest.fn().mockResolvedValue([doc]) } });
    const [view] = await service.listIncoming(developerOrganizationId, {});
    expect(view!.agencyOrganizationId).toBe(doc.organizationId.toString());
  });
});
