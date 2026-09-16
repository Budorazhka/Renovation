import { Types } from 'mongoose';
import { ContactController } from './contact.controller';
import type { CrmService } from './crm.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';

function makeRequest(organizationId: Types.ObjectId, positionId: Types.ObjectId) {
  return {
    tenantContext: {
      organizationId: organizationId.toString(),
      positionId: positionId.toString(),
      identityId: new Types.ObjectId().toString(),
    },
    correlationId: 'test-correlation-id',
  };
}

function fakeIdempotencyService(checkReplayResult: unknown = null): IdempotencyService {
  return {
    checkReplay: jest.fn().mockResolvedValue(checkReplayResult),
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as IdempotencyService;
}

describe('ContactController — GET /contacts', () => {
  it('organization-grant: не сужает — ownerPositionId:undefined в CrmService.listContacts', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const listContacts = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new ContactController(
      { listContacts } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.listContacts(makeRequest(organizationId, positionId) as never, { limit: 20 });

    expect(listContacts).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: undefined,
      q: undefined,
      segment: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it('own-grant: сужает GET /contacts до текущей Position', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const listContacts = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new ContactController(
      { listContacts } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.listContacts(makeRequest(organizationId, positionId) as never, { limit: 20 });

    expect(listContacts).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: positionId,
      q: undefined,
      segment: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it('пробрасывает q, segment и cursor как есть', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const cursor = new Types.ObjectId();
    const listContacts = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new ContactController(
      { listContacts } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.listContacts(makeRequest(organizationId, positionId) as never, {
      q: 'Иван',
      segment: 'golden',
      cursor: cursor.toString(),
      limit: 20,
    });

    expect(listContacts).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: undefined,
      q: 'Иван',
      segment: 'golden',
      cursor,
      limit: 20,
    });
  });
});

describe('ContactController — POST /contacts', () => {
  it('без Idempotency-Key — IDEMPOTENCY_KEY_REQUIRED, сервис не вызывается', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const createContact = jest.fn();
    const controller = new ContactController(
      { createContact } as unknown as CrmService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await expect(
      controller.createContact(makeRequest(organizationId, positionId) as never, {
        name: 'Иван',
        phone: '+995500000000',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(createContact).not.toHaveBeenCalled();
  });

  it('replay найден — возвращает сохранённый ответ, сервис не вызывается', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const createContact = jest.fn();
    const controller = new ContactController(
      { createContact } as unknown as CrmService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService({ responseStatus: 201, responseBody: { id: 'replayed' } }),
    );

    const result = await controller.createContact(
      makeRequest(organizationId, positionId) as never,
      { name: 'Иван', phone: '+995500000000' },
      'idem-key-1',
    );

    expect(result).toEqual({ id: 'replayed' });
    expect(createContact).not.toHaveBeenCalled();
  });

  it('новый запрос — вызывает CrmService.createContact с телом и Idempotency-Key', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const createContact = jest.fn().mockResolvedValue({ id: 'new-contact' });
    const controller = new ContactController(
      { createContact } as unknown as CrmService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(null),
    );

    await controller.createContact(
      makeRequest(organizationId, positionId) as never,
      { name: 'Иван', phone: '+995500000000', roles: ['buyer'] },
      'idem-key-1',
    );

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        name: 'Иван',
        phone: '+995500000000',
        roles: ['buyer'],
        idempotencyKey: 'idem-key-1',
      }),
    );
  });
});

describe('ContactController — PATCH /contacts/:contactId', () => {
  it('own-grant сужает CrmService.updateContact до текущей Position', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const updateContact = jest.fn().mockResolvedValue({ id: contactId.toString() });
    const controller = new ContactController(
      { updateContact } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.updateContact(makeRequest(organizationId, positionId) as never, contactId, { name: 'Новое имя' });

    expect(updateContact).toHaveBeenCalledWith(
      expect.objectContaining({ contactId, organizationId, ownerPositionId: positionId, name: 'Новое имя' }),
    );
  });
});

describe('ContactController — GET /contacts/:contactId', () => {
  it('organization-grant: ownerPositionId:undefined в CrmService.getContact', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const getContact = jest.fn().mockResolvedValue({ id: contactId.toString() });
    const controller = new ContactController(
      { getContact } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.getContact(makeRequest(organizationId, positionId) as never, contactId);

    expect(getContact).toHaveBeenCalledWith({ contactId, organizationId, ownerPositionId: undefined });
  });

  it('own-grant: ownerPositionId сужен до текущей Position в CrmService.getContact', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const getContact = jest.fn().mockResolvedValue({ id: contactId.toString() });
    const controller = new ContactController(
      { getContact } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.getContact(makeRequest(organizationId, positionId) as never, contactId);

    expect(getContact).toHaveBeenCalledWith({ contactId, organizationId, ownerPositionId: positionId });
  });
});

describe('ContactController — GET /contacts/:contactId/timeline', () => {
  it('передаёт параметры запроса в CrmService.getContactTimeline с учётом own-scope', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const getContactTimeline = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new ContactController(
      { getContactTimeline } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      fakeIdempotencyService(),
    );

    await controller.getContactTimeline(makeRequest(organizationId, positionId) as never, contactId, {
      type: 'task_completed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      cursor: 'cursor-456',
      limit: 15,
    });

    expect(getContactTimeline).toHaveBeenCalledWith({
      contactId,
      organizationId,
      ownerPositionId: positionId,
      type: 'task_completed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      cursor: 'cursor-456',
      limit: 15,
    });
  });
});
