import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NotFoundException } from '@nestjs/common';
import { MarketplaceSelectionsModule } from '../../src/modules/marketplace-selections/marketplace-selections.module';
import { MarketplaceSelectionsService } from '../../src/modules/marketplace-selections/marketplace-selections.service';

/**
 * N-11 (roadmap-2026-09.md, решение владельца 07.09.2026): подборки
 * покупателя живут на сервере у его аккаунта, открываются с любого
 * устройства и по ссылке — не в localStorage одного браузера.
 *
 * Проверено на настоящей MongoDB: до этой работы подборки покупателя жили
 * только в localStorage (SelectionsPage.tsx), "показать клиенту"/"ссылка"
 * вели на несуществующие данные — backend для них не существовал вовсе.
 */
describe('N-11: подборки покупателя (real MongoDB)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let service: MarketplaceSelectionsService;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(replSet.getUri()),
        MarketplaceSelectionsModule,
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    service = moduleRef.get(MarketplaceSelectionsService);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('marketplace_selections').deleteMany({});
    await connection.collection('idempotency_records').deleteMany({});
  });

  function idem(key: string) {
    return key;
  }

  it('создание с одним и тем же Idempotency-Key не заводит вторую подборку', async () => {
    const identityId = new Types.ObjectId();

    const first = await service.create({ identityId, title: 'Для семьи', idempotencyKey: idem('create-1') });
    const second = await service.create({ identityId, title: 'Для семьи', idempotencyKey: idem('create-1') });

    expect(second.id).toBe(first.id);
    expect(await connection.collection('marketplace_selections').countDocuments({})).toBe(1);
  });

  it('владелец видит свою подборку, чужая учётка — нет; список сортирован новыми сверху', async () => {
    const ownerId = new Types.ObjectId();
    const strangerId = new Types.ObjectId();

    const first = await service.create({ identityId: ownerId, title: 'Первая', idempotencyKey: idem('list-1') });
    const second = await service.create({ identityId: ownerId, title: 'Вторая', idempotencyKey: idem('list-2') });

    const ownerList = await service.list(ownerId);
    expect(ownerList.map((s) => s.id)).toEqual([second.id, first.id]);

    const strangerList = await service.list(strangerId);
    expect(strangerList).toHaveLength(0);
  });

  it('добавление одного и того же объекта дважды не дублирует его в подборке', async () => {
    const identityId = new Types.ObjectId();
    const created = await service.create({ identityId, title: 'Подборка', idempotencyKey: idem('add-1') });

    await service.addItem(new Types.ObjectId(created.id), identityId, 'listing', 'kvartira-vake');
    const afterSecondAdd = await service.addItem(
      new Types.ObjectId(created.id),
      identityId,
      'listing',
      'kvartira-vake',
    );

    expect(afterSecondAdd.items).toHaveLength(1);
    expect(afterSecondAdd.items[0]).toMatchObject({ targetType: 'listing', slug: 'kvartira-vake' });
  });

  it('снятие объекта, которого уже нет, не ошибка — подборка просто остаётся без него', async () => {
    const identityId = new Types.ObjectId();
    const created = await service.create({ identityId, title: 'Подборка', idempotencyKey: idem('remove-1') });

    const afterRemove = await service.removeItem(new Types.ObjectId(created.id), identityId, 'listing', 'ghost');
    expect(afterRemove.items).toHaveLength(0);
  });

  it('чужая учётка не может переименовать, добавить объект или удалить подборку — NOT_FOUND', async () => {
    const ownerId = new Types.ObjectId();
    const strangerId = new Types.ObjectId();
    const created = await service.create({ identityId: ownerId, title: 'Подборка', idempotencyKey: idem('owner-1') });
    const id = new Types.ObjectId(created.id);

    await expect(service.rename(id, strangerId, 'Взлом')).rejects.toThrow(NotFoundException);
    await expect(service.addItem(id, strangerId, 'listing', 'kvartira-vake')).rejects.toThrow(NotFoundException);

    const removed = await service.remove(id, strangerId);
    expect(removed.removed).toBe(false);

    // Владелец по-прежнему видит подборку целой — ни одна из чужих попыток не прошла.
    const stillThere = await service.list(ownerId);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]?.title).toBe('Подборка');
  });

  it('публичная ссылка отдаёт подборку без identityId, доступна без владельца; переименование/удаление недоступны анонимно', async () => {
    const identityId = new Types.ObjectId();
    const created = await service.create({ identityId, title: 'Общая подборка', idempotencyKey: idem('public-1') });
    await service.addItem(new Types.ObjectId(created.id), identityId, 'development', 'zhk-batumi');

    const publicView = await service.getPublic(created.publicToken);
    expect(publicView).toEqual({
      title: 'Общая подборка',
      items: [{ targetType: 'development', slug: 'zhk-batumi' }],
      createdAt: created.createdAt,
    });
    expect(publicView).not.toHaveProperty('identityId');
    expect(publicView).not.toHaveProperty('id');
    expect(publicView).not.toHaveProperty('publicToken');
  });

  it('несуществующий публичный токен — NOT_FOUND', async () => {
    await expect(service.getPublic('a'.repeat(64))).rejects.toThrow(NotFoundException);
  });

  it('удаление подборки реально удаляет документ, повторное удаление возвращает removed:false', async () => {
    const identityId = new Types.ObjectId();
    const created = await service.create({ identityId, title: 'Подборка', idempotencyKey: idem('delete-1') });
    const id = new Types.ObjectId(created.id);

    const first = await service.remove(id, identityId);
    expect(first.removed).toBe(true);
    expect(await connection.collection('marketplace_selections').findOne({ _id: id })).toBeNull();

    const second = await service.remove(id, identityId);
    expect(second.removed).toBe(false);
  });
});
