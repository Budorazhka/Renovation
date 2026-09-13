import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BuyerRequestsService } from './buyer-requests.service';

describe('BuyerRequestsService', () => {
  it('публичный список возвращает только публичную проекцию и cursor', async () => {
    const first = { _id: new Types.ObjectId(), dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild', title: 'A', comment: 'B', budgetAmount: 1, budgetCurrency: 'USD', budgetPerMonth: false, authorIdentityId: new Types.ObjectId(), createdAt: new Date('2026-09-13T00:00:00Z') };
    const second = { ...first, _id: new Types.ObjectId(), title: 'B' };
    const repository = { listPublic: jest.fn().mockResolvedValue([first, second]) };
    const service = new BuyerRequestsService({} as never, repository as never, {} as never);
    const result = await service.listPublic({ limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('authorIdentityId');
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
    const service = new BuyerRequestsService(connection as never, repository as never, idempotency as never);
    const result = await service.create({
      identityId: new Types.ObjectId(), idempotencyKey: 'key-1',
      data: { dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild', title: 'Нужна квартира', comment: 'В центре', budgetAmount: 100000, budgetCurrency: 'USD', budgetPerMonth: false },
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
    const service = new BuyerRequestsService({} as never, repository as never, {} as never);
    const result = await service.close(id, authorIdentityId);
    expect(result.status).toBe('closed');
  });

  it('закрытие чужого или несуществующего запроса даёт 404', async () => {
    const repository = {
      close: jest.fn().mockResolvedValue(null),
      findByIdForAuthor: jest.fn().mockResolvedValue(null),
    };
    const service = new BuyerRequestsService({} as never, repository as never, {} as never);
    await expect(service.close(new Types.ObjectId(), new Types.ObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listMine возвращает свои запросы всех статусов', async () => {
    const mine = { _id: new Types.ObjectId(), authorIdentityId: new Types.ObjectId(), dealType: 'buy', city: 'Батуми', propertyKind: 'newbuild', title: 'A', comment: 'B', budgetAmount: 1, budgetCurrency: 'USD', budgetPerMonth: false, status: 'closed', createdAt: new Date('2026-09-13T00:00:00Z') };
    const repository = { listForAuthor: jest.fn().mockResolvedValue([mine]) };
    const service = new BuyerRequestsService({} as never, repository as never, {} as never);
    const result = await service.listMine(mine.authorIdentityId);
    expect(result.items).toEqual([expect.objectContaining({ id: mine._id.toString(), status: 'closed' })]);
    expect(repository.listForAuthor).toHaveBeenCalledWith(mine.authorIdentityId);
  });
});
