import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { DevelopmentRepository } from '@baza/development';
import { DevelopmentsModule } from '../../src/modules/developments/developments.module';
import { DevelopmentsService } from '../../src/modules/developments/developments.service';
import { UnitRepository } from '../../src/modules/developments/repository/unit.repository';
import { BuildingRepository } from '../../src/modules/developments/repository/building.repository';
import { FloorRepository } from '../../src/modules/developments/repository/floor.repository';
import { ErrorCode } from '../../src/shared/errors/error-codes';

/**
 * Решение владельца 11.09.2026: валюта выбирается один раз на весь ЖК,
 * разные валюты внутри комплекса запрещены.
 *
 * Тест против РЕАЛЬНОГО MongoDB (mongodb-memory-server), а не моков:
 * правило читает уже сохранённые юниты через `distinct`, и именно это
 * взаимодействие с базой проверяется. На коде до правила все запреты ниже
 * проходили успешно, а витрина затем теряла цену «от» у всего комплекса
 * (`computeDevelopmentPriceFrom` при смешанных валютах отдаёт null).
 */
describe('Одна валюта на ЖК — integration (real MongoDB)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let developmentsService: DevelopmentsService;
  let developmentRepository: DevelopmentRepository;
  let unitRepository: UnitRepository;
  let buildingRepository: BuildingRepository;
  let floorRepository: FloorRepository;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();

    process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY ??= 'test-access-key';
    process.env.MINIO_SECRET_KEY ??= 'test-secret-key';
    process.env.MINIO_BUCKET_PRIVATE ??= 'test-private';
    process.env.MINIO_BUCKET_PUBLIC ??= 'test-public';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(replSet.getUri()),
        DevelopmentsModule,
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    developmentsService = moduleRef.get(DevelopmentsService);
    developmentRepository = moduleRef.get(DevelopmentRepository);
    unitRepository = moduleRef.get(UnitRepository);
    buildingRepository = moduleRef.get(BuildingRepository);
    floorRepository = moduleRef.get(FloorRepository);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('developments').deleteMany({});
    await connection.collection('buildings').deleteMany({});
    await connection.collection('floors').deleteMany({});
    await connection.collection('units').deleteMany({});
    await connection.collection('audit_events').deleteMany({});
    await connection.collection('outbox_events').deleteMany({});
    await connection.collection('idempotency_records').deleteMany({});
  });

  /** ЖК с двумя корпусами: правило должно охватывать комплекс целиком, не один корпус. */
  async function seedDevelopment(organizationId: Types.ObjectId) {
    const development = await developmentRepository.create({
      organizationId,
      name: 'ЖК Валютный',
      location: { country: 'Georgia', city: 'Batumi', geo: { type: 'Point', coordinates: [41.6, 41.6] } },
      contact: { phone: '+995500000000' },
    });
    const buildingA = await buildingRepository.create({
      developmentId: development._id,
      organizationId,
      name: 'Корпус A',
      floorsCount: 5,
    });
    const buildingB = await buildingRepository.create({
      developmentId: development._id,
      organizationId,
      name: 'Корпус B',
      floorsCount: 5,
    });
    const floorA = await floorRepository.create({ buildingId: buildingA._id, organizationId, floorNumber: 1 });
    const floorB = await floorRepository.create({ buildingId: buildingB._id, organizationId, floorNumber: 1 });
    return { development, buildingA, buildingB, floorA, floorB };
  }

  function idempotency(identityId: Types.ObjectId, key: string) {
    return { identityId, operation: 'createUnit', key, requestBody: { key } };
  }

  it('первый юнит задаёт валюту ЖК, второй в той же валюте создаётся', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA, floorA } = await seedDevelopment(organizationId);

    await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '1',
      kind: 'apartment',
      area: 40,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-1'),
    });

    const second = await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '2',
      kind: 'apartment',
      area: 45,
      price: { amountMinorUnits: 11_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-2'),
    });

    expect(second.price.currency).toBe('USD');
    const currencies = await unitRepository.listDistinctCurrenciesForBuildings(
      [buildingA._id],
      organizationId,
    );
    expect(currencies).toEqual(['USD']);
  });

  it('юнит в другой валюте отклоняется — даже в соседнем корпусе того же ЖК', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA, buildingB, floorA, floorB } = await seedDevelopment(organizationId);

    await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '1',
      kind: 'apartment',
      area: 40,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-usd'),
    });

    await expect(
      developmentsService.createUnit({
        buildingId: buildingB._id,
        floorId: floorB._id,
        organizationId,
        number: '1',
        kind: 'apartment',
        area: 40,
        price: { amountMinorUnits: 25_000_000, currency: 'GEL' },
        idempotency: idempotency(identityId, 'unit-gel'),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MONEY_CURRENCY_MISMATCH });

    const units = await connection.collection('units').countDocuments({});
    expect(units).toBe(1);
  });

  it('смена цены существующего юнита на другую валюту отклоняется, в своей валюте проходит', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA, floorA } = await seedDevelopment(organizationId);

    const unit = await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '1',
      kind: 'apartment',
      area: 40,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-single'),
    });

    await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '2',
      kind: 'apartment',
      area: 40,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-neighbour'),
    });

    await expect(
      developmentsService.updateUnitPrice({
        unitId: unit._id,
        organizationId,
        expectedVersion: 0,
        price: { amountMinorUnits: 26_000_000, currency: 'GEL' },
        actorIdentityId: identityId,
        actorPositionId: new Types.ObjectId(),
        correlationId: 'currency-guard-reject',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MONEY_CURRENCY_MISMATCH });

    // Своя валюта проходит: сам юнит не должен запрещать собственную правку.
    await developmentsService.updateUnitPrice({
      unitId: unit._id,
      organizationId,
      expectedVersion: 0,
      price: { amountMinorUnits: 12_000_000, currency: 'USD' },
      actorIdentityId: identityId,
      actorPositionId: new Types.ObjectId(),
      correlationId: 'currency-guard-allow',
    });

    const stored = await connection.collection('units').findOne({ _id: unit._id });
    expect(stored?.price).toMatchObject({ amountMinorUnits: 12_000_000, currency: 'USD' });
  });

  it('единственный юнит ЖК может сменить валюту: конфликтовать больше не с чем', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA, floorA } = await seedDevelopment(organizationId);

    const unit = await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '1',
      kind: 'apartment',
      area: 40,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-lonely'),
    });

    await developmentsService.updateUnitPrice({
      unitId: unit._id,
      organizationId,
      expectedVersion: 0,
      price: { amountMinorUnits: 26_000_000, currency: 'GEL' },
      actorIdentityId: identityId,
      actorPositionId: new Types.ObjectId(),
      correlationId: 'currency-guard-lonely',
    });

    const stored = await connection.collection('units').findOne({ _id: unit._id });
    expect(stored?.price).toMatchObject({ currency: 'GEL' });
  });

  it('пакетное создание с разными валютами внутри пакета отклоняется целиком', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA } = await seedDevelopment(organizationId);

    await expect(
      developmentsService.batchCreateUnits({
        buildingId: buildingA._id,
        organizationId,
        units: [
          {
            floorNumber: 1,
            number: '101',
            kind: 'apartment',
            area: 40,
            price: { amountMinorUnits: 10_000_000, currency: 'USD' },
          },
          {
            floorNumber: 1,
            number: '102',
            kind: 'apartment',
            area: 40,
            price: { amountMinorUnits: 26_000_000, currency: 'GEL' },
          },
        ],
        actorIdentityId: identityId,
        correlationId: 'batch-mixed-currency',
        idempotency: { identityId, operation: 'batchCreateUnits', key: 'batch-1', requestBody: {} },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MONEY_CURRENCY_MISMATCH });

    expect(await connection.collection('units').countDocuments({})).toBe(0);
  });

  /**
   * ИСПРАВЛЕНО 13.09.2026 (найдено ревью): раньше проверка читала валюты
   * юнитов ДО открытия транзакции — два параллельных createUnit с разными
   * валютами оба видели пустой ЖК в своём снимке и оба успешно писали
   * unit-документ (новые unit-документы друг с другом не конфликтуют).
   * Здесь оба запроса стартуют по-настоящему одновременно (Promise.all,
   * без await между ними) — именно то условие гонки, которое TOCTOU-чек
   * пропускал.
   */
  it('два по-настоящему параллельных createUnit с разными валютами: ровно один проходит', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA, buildingB, floorA, floorB } = await seedDevelopment(organizationId);

    const results = await Promise.allSettled([
      developmentsService.createUnit({
        buildingId: buildingA._id,
        floorId: floorA._id,
        organizationId,
        number: '1',
        kind: 'apartment',
        area: 40,
        price: { amountMinorUnits: 10_000_000, currency: 'USD' },
        idempotency: idempotency(identityId, 'race-usd'),
      }),
      developmentsService.createUnit({
        buildingId: buildingB._id,
        floorId: floorB._id,
        organizationId,
        number: '1',
        kind: 'apartment',
        area: 40,
        price: { amountMinorUnits: 26_000_000, currency: 'GEL' },
        idempotency: idempotency(identityId, 'race-gel'),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: ErrorCode.MONEY_CURRENCY_MISMATCH,
    });

    const currencies = await connection.collection('units').distinct('price.currency', {});
    expect(currencies).toHaveLength(1);
  });

  it('генератор шахматки не может залить корпус валютой, отличной от валюты ЖК', async () => {
    const organizationId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const { buildingA, buildingB, floorA } = await seedDevelopment(organizationId);

    await developmentsService.createUnit({
      buildingId: buildingA._id,
      floorId: floorA._id,
      organizationId,
      number: '1',
      kind: 'apartment',
      area: 40,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idempotency(identityId, 'unit-anchor'),
    });

    await expect(
      developmentsService.generateChessboard({
        buildingId: buildingB._id,
        organizationId,
        fromFloor: 1,
        toFloor: 3,
        unitsPerFloor: 2,
        defaultArea: 50,
        defaultPrice: { amountMinorUnits: 26_000_000, currency: 'GEL' },
        actorIdentityId: identityId,
        correlationId: 'chessboard-mixed-currency',
        idempotency: { identityId, operation: 'generateChessboard', key: 'chess-1', requestBody: {} },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MONEY_CURRENCY_MISMATCH });

    expect(await connection.collection('units').countDocuments({})).toBe(1);
  });
});
