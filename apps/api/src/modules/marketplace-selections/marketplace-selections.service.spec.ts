import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MarketplaceSelectionsService } from './marketplace-selections.service';
import type { MarketplaceSelectionRepository } from './repository/marketplace-selection.repository';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeService(overrides: {
  repository?: Partial<MarketplaceSelectionRepository>;
  idempotencyService?: Partial<IdempotencyService>;
}) {
  return new MarketplaceSelectionsService(
    makeMockConnection() as never,
    (overrides.repository ?? {}) as MarketplaceSelectionRepository,
    (overrides.idempotencyService ??
      { checkReplay: jest.fn().mockResolvedValue(null), record: jest.fn().mockResolvedValue(undefined) }) as IdempotencyService,
  );
}

describe('MarketplaceSelectionsService', () => {
  const identityId = new Types.ObjectId();
  const selectionId = new Types.ObjectId();

  describe('list', () => {
    it('отдаёт подборки владельца сессии без внутренних полей', async () => {
      const doc = {
        _id: selectionId,
        title: 'Для семьи',
        items: [{ targetType: 'listing', slug: 'kvartira-vake', addedAt: new Date('2026-09-01T00:00:00.000Z') }],
        publicToken: 'a'.repeat(64),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      };
      const listForIdentity = jest.fn().mockResolvedValue([doc]);
      const service = makeService({ repository: { listForIdentity } });

      const result = await service.list(identityId);

      expect(listForIdentity).toHaveBeenCalledWith(identityId);
      expect(result).toEqual([
        {
          id: selectionId.toString(),
          title: 'Для семьи',
          items: [{ targetType: 'listing', slug: 'kvartira-vake', addedAt: '2026-09-01T00:00:00.000Z' }],
          publicToken: 'a'.repeat(64),
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-02T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('create', () => {
    it('создаёт подборку и записывает идемпотентность', async () => {
      const created = {
        _id: selectionId,
        title: 'Новая подборка',
        items: [],
        publicToken: 'b'.repeat(64),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      };
      const createSpy = jest.fn().mockResolvedValue(created);
      const checkReplay = jest.fn().mockResolvedValue(null);
      const record = jest.fn().mockResolvedValue(undefined);
      const service = makeService({
        repository: { create: createSpy },
        idempotencyService: { checkReplay, record },
      });

      const result = await service.create({ identityId, title: 'Новая подборка', idempotencyKey: 'key-1' });

      expect(checkReplay).toHaveBeenCalledWith(
        expect.objectContaining({ identityId, operation: 'createMarketplaceSelection', key: 'key-1' }),
      );
      expect(createSpy).toHaveBeenCalledWith(identityId, 'Новая подборка', expect.any(String), expect.anything());
      expect(record).toHaveBeenCalled();
      expect(result.title).toBe('Новая подборка');
    });

    it('повтор с тем же ключом возвращает сохранённый ответ, не создаёт вторую подборку', async () => {
      const cached = { id: selectionId.toString(), title: 'Уже создана' };
      const createSpy = jest.fn();
      const checkReplay = jest.fn().mockResolvedValue({ responseStatus: 201, responseBody: cached });
      const service = makeService({
        repository: { create: createSpy },
        idempotencyService: { checkReplay, record: jest.fn() },
      });

      const result = await service.create({ identityId, title: 'Уже создана', idempotencyKey: 'key-1' });

      expect(result).toEqual(cached);
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('бросает NOT_FOUND, если подборка чужая или не существует', async () => {
      const service = makeService({ repository: { rename: jest.fn().mockResolvedValue(null) } });

      await expect(service.rename(selectionId, identityId, 'Новое имя')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('снятие уже удалённой подборки не ошибка: removed:false', async () => {
      const service = makeService({ repository: { remove: jest.fn().mockResolvedValue(false) } });

      await expect(service.remove(selectionId, identityId)).resolves.toEqual({ removed: false });
    });
  });

  describe('addItem', () => {
    it('добавляет элемент и возвращает обновлённую подборку', async () => {
      const updated = {
        _id: selectionId,
        title: 'T',
        items: [{ targetType: 'listing', slug: 'kvartira-vake', addedAt: new Date('2026-09-01T00:00:00.000Z') }],
        publicToken: 'c'.repeat(64),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      };
      const addItem = jest.fn().mockResolvedValue(updated);
      const service = makeService({ repository: { addItem } });

      const result = await service.addItem(selectionId, identityId, 'listing', 'kvartira-vake');

      expect(addItem).toHaveBeenCalledWith(selectionId, identityId, 'listing', 'kvartira-vake');
      expect(result.items).toHaveLength(1);
    });

    it('повторное добавление того же элемента (findOneAndUpdate вернул null) идемпотентно перечитывает подборку', async () => {
      const existing = {
        _id: selectionId,
        title: 'T',
        items: [{ targetType: 'listing', slug: 'kvartira-vake', addedAt: new Date('2026-09-01T00:00:00.000Z') }],
        publicToken: 'd'.repeat(64),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      };
      const addItem = jest.fn().mockResolvedValue(null);
      const findByIdForIdentity = jest.fn().mockResolvedValue(existing);
      const service = makeService({ repository: { addItem, findByIdForIdentity } });

      const result = await service.addItem(selectionId, identityId, 'listing', 'kvartira-vake');

      expect(findByIdForIdentity).toHaveBeenCalledWith(selectionId, identityId);
      expect(result.items).toHaveLength(1);
    });

    it('бросает NOT_FOUND, если подборка чужая или не существует (не просто "элемент уже там")', async () => {
      const service = makeService({
        repository: {
          addItem: jest.fn().mockResolvedValue(null),
          findByIdForIdentity: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(service.addItem(selectionId, identityId, 'listing', 'kvartira-vake')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getPublic', () => {
    it('отдаёт проекцию без identityId/внутреннего id', async () => {
      const found = {
        _id: selectionId,
        identityId,
        title: 'Общая подборка',
        items: [{ targetType: 'development', slug: 'zhk-batumi', addedAt: new Date('2026-09-01T00:00:00.000Z') }],
        publicToken: 'e'.repeat(64),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      };
      const service = makeService({ repository: { findByPublicToken: jest.fn().mockResolvedValue(found) } });

      const result = await service.getPublic('e'.repeat(64));

      expect(result).toEqual({
        title: 'Общая подборка',
        items: [{ targetType: 'development', slug: 'zhk-batumi' }],
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      expect(result).not.toHaveProperty('identityId');
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('publicToken');
    });

    it('токен не найден — NOT_FOUND', async () => {
      const service = makeService({ repository: { findByPublicToken: jest.fn().mockResolvedValue(null) } });

      await expect(service.getPublic('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
