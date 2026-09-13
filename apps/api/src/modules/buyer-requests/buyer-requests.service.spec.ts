import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BuyerRequestsService } from './buyer-requests.service';

function buildService(repository: unknown, responseRepository: unknown = {}, idempotency: unknown = {}) {
  return new BuyerRequestsService({} as never, repository as never, responseRepository as never, idempotency as never);
}

describe('BuyerRequestsService', () => {
  it('публичный список возвращает только публичную проекцию и cursor', async () => {
    const first = { _id: new Types.ObjectId(), dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild', title: 'A', comment: 'B', phone: '+995599000001', budgetAmount: 1, budgetCurrency: 'USD', budgetPerMonth: false, authorIdentityId: new Types.ObjectId(), createdAt: new Date('2026-09-13T00:00:00Z') };
    const second = { ...first, _id: new Types.ObjectId(), title: 'B' };
    const repository = { listPublic: jest.fn().mockResolvedValue([first, second]) };
    const service = buildService(repository);
    const result = await service.listPublic({ limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('authorIdentityId');
    expect(result.items[0]).not.toHaveProperty('phone');
    expect(result.nextCursor).toBe(first._id.toString());
    expect(repository.listPublic).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });

  it('создаёт опубликованный запрос и сохраняет идемпотентный ответ', async () => {
    const created = {
      _id: new Types.ObjectId(), dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild',
      title: 'Нужна квартира', comment: 'В центре', budgetAmount: 100000, budgetCurrency: 'USD',
      budgetPerMonth: false, createdAt: new Date('2026-09-13T00:00:00Z'),
    };
    const repository = { create: jest.fn().mockResolvedValue(created) };
    const idempotency = { checkReplay: jest.fn().mockResolvedValue(null), record: jest.fn() };
    const connection = { startSession: jest.fn().mockResolvedValue({ withTransaction: async (work: (session: unknown) => Promise<unknown>) => work({}), endSession: jest.fn() }) };
    const service = new BuyerRequestsService(connection as never, repository as never, {} as never, idempotency as never);
    const result = await service.create({
      identityId: new Types.ObjectId(), idempotencyKey: 'key-1',
      data: { dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild', title: 'Нужна квартира', comment: 'В центре', phone: '+995599000000', budgetAmount: 100000, budgetCurrency: 'USD', budgetPerMonth: false },
    });
    expect(result.id).toBe(created._id.toString());
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }), expect.anything());
  });

  it('повторное закрытие уже закрытого своего запроса возвращает то же состояние, а не 404', async () => {
    const id = new Types.ObjectId();
    const authorIdentityId = new Types.ObjectId();
    const alreadyClosed = {
      _id: id, authorIdentityId, dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild',
      title: 'A', comment: 'B', budgetAmount: 1, budgetCurrency: 'USD', budgetPerMonth: false,
      status: 'closed', createdAt: new Date('2026-09-13T00:00:00Z'),
    };
    const repository = {
      close: jest.fn().mockResolvedValue(null),
      findByIdForAuthor: jest.fn().mockResolvedValue(alreadyClosed),
    };
    const service = buildService(repository);
    const result = await service.close(id, authorIdentityId);
    expect(result.status).toBe('closed');
  });

  it('закрытие чужого или несуществующего запроса даёт 404', async () => {
    const repository = {
      close: jest.fn().mockResolvedValue(null),
      findByIdForAuthor: jest.fn().mockResolvedValue(null),
    };
    const service = buildService(repository);
    await expect(service.close(new Types.ObjectId(), new Types.ObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listMine возвращает свои запросы всех статусов', async () => {
    const mine = { _id: new Types.ObjectId(), authorIdentityId: new Types.ObjectId(), dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild', title: 'A', comment: 'B', budgetAmount: 1, budgetCurrency: 'USD', budgetPerMonth: false, status: 'closed', createdAt: new Date('2026-09-13T00:00:00Z') };
    const repository = { listForAuthor: jest.fn().mockResolvedValue([mine]) };
    const service = buildService(repository);
    const result = await service.listMine(mine.authorIdentityId);
    expect(result.items).toEqual([expect.objectContaining({ id: mine._id.toString(), status: 'closed' })]);
    expect(repository.listForAuthor).toHaveBeenCalledWith(mine.authorIdentityId);
  });

  describe('respond: ERP-отклик организации на запрос (N-13)', () => {
    it('запрос не найден — NotFoundException, отклик не сохраняется', async () => {
      const repository = { findById: jest.fn().mockResolvedValue(null) };
      const responseRepository = { upsert: jest.fn() };
      const service = buildService(repository, responseRepository);
      await expect(service.respond({ buyerRequestId: new Types.ObjectId(), organizationId: new Types.ObjectId(), respondedByPositionId: new Types.ObjectId(), message: 'Поможем с этим' })).rejects.toBeInstanceOf(NotFoundException);
      expect(responseRepository.upsert).not.toHaveBeenCalled();
    });

    it.each(['closed', 'moderated'])('запрос в статусе %s — BadRequestException, отклик не сохраняется', async (status) => {
      const repository = { findById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), status }) };
      const responseRepository = { upsert: jest.fn() };
      const service = buildService(repository, responseRepository);
      await expect(service.respond({ buyerRequestId: new Types.ObjectId(), organizationId: new Types.ObjectId(), respondedByPositionId: new Types.ObjectId(), message: 'X' })).rejects.toBeInstanceOf(BadRequestException);
      expect(responseRepository.upsert).not.toHaveBeenCalled();
    });

    it('published-запрос — отклик сохраняется через upsert', async () => {
      const buyerRequestId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const respondedByPositionId = new Types.ObjectId();
      const repository = { findById: jest.fn().mockResolvedValue({ _id: buyerRequestId, status: 'published' }) };
      const doc = { _id: new Types.ObjectId(), buyerRequestId, message: 'Поможем с этим', updatedAt: new Date('2026-09-13T00:00:00Z') };
      const responseRepository = { upsert: jest.fn().mockResolvedValue(doc) };
      const service = buildService(repository, responseRepository);
      const result = await service.respond({ buyerRequestId, organizationId, respondedByPositionId, message: 'Поможем с этим' });
      expect(responseRepository.upsert).toHaveBeenCalledWith({ buyerRequestId, organizationId, respondedByPositionId, message: 'Поможем с этим' });
      expect(result).toEqual({ id: doc._id.toString(), buyerRequestId: buyerRequestId.toString(), message: 'Поможем с этим', updatedAt: doc.updatedAt.toISOString() });
    });
  });

  describe('listMyResponses: свои отклики организации (N-13)', () => {
    it('limit+1 обрезается в nextCursor, как у публичного списка', async () => {
      const organizationId = new Types.ObjectId();
      const docs = [0, 1].map(() => ({ _id: new Types.ObjectId(), buyerRequestId: new Types.ObjectId(), message: 'X', updatedAt: new Date('2026-09-13T00:00:00Z') }));
      const responseRepository = { listForOrganization: jest.fn().mockResolvedValue(docs) };
      const service = buildService({}, responseRepository);
      const result = await service.listMyResponses(organizationId, { limit: 1 });
      expect(responseRepository.listForOrganization).toHaveBeenCalledWith(organizationId, expect.objectContaining({ limit: 2 }));
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(docs[0]!._id.toString());
    });
  });

  describe('revealPhone: телефон раскрывается только по явному вызову (N-13)', () => {
    it('запрос не найден — NotFoundException', async () => {
      const repository = { findById: jest.fn().mockResolvedValue(null) };
      const service = buildService(repository);
      await expect(service.revealPhone(new Types.ObjectId())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('запрос найден — возвращает только телефон', async () => {
      const id = new Types.ObjectId();
      const repository = { findById: jest.fn().mockResolvedValue({ _id: id, phone: '+995599000001', status: 'published' }) };
      const service = buildService(repository);
      await expect(service.revealPhone(id)).resolves.toEqual({ phone: '+995599000001' });
    });
  });
});
