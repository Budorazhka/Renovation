import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fastifyCookie from '@fastify/cookie';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/shared/errors/app-exception.filter';
import { CorrelationIdMiddleware } from '../../src/shared/errors/correlation-id.middleware';
import { TenantContextMiddleware } from '../../src/shared/tenant/tenant-context.middleware';
import { AdminContextMiddleware } from '../../src/shared/admin/admin-context.middleware';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';
import {
  DevelopmentRepository,
  BuildingRepository,
  UnitRepository,
  FloorPlanRepository,
} from '@baza/development';
import { MarketplacePublicationRepository } from '@baza/publication';
import { PropertyAssetRepository, ListingRepository } from '@baza/property-assets';
import type { OutboxEventDocument } from '@baza/domain-events';
import { AuthService } from '../../src/modules/identity/auth.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { DevelopmentsService } from '../../src/modules/developments/developments.service';
import { CrmService } from '../../src/modules/crm/crm.service';
import { DealRepository } from '../../src/modules/crm/repository/deal.repository';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { BookingRepository } from '../../src/modules/bookings/repository/booking.repository';
import type { BookingDocument } from '../../src/modules/bookings/schemas/booking.schema';
import { PublicationRequestedHandler } from '../../../worker/src/handlers/publication-requested.handler';
import { UnitStatusChangedHandler } from '../../../worker/src/handlers/unit-status-changed.handler';
import { MediaAssetRepository, MediaStorageService } from '@baza/media-storage';

describe('P1-05: Полный пользовательский путь продаж первички («ЖК → шахматка → цена → публикация → витрина → лид → бронь → сделка»)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let authService: AuthService;
  let organizationsService: OrganizationsService;
  let developmentsService: DevelopmentsService;
  let crmService: CrmService;
  let dealRepository: DealRepository;
  let bookingsService: BookingsService;
  let bookingRepository: BookingRepository;
  let developmentRepository: DevelopmentRepository;
  let buildingRepository: BuildingRepository;
  let unitRepository: UnitRepository;
  let publicationRepository: MarketplacePublicationRepository;
  let publicationHandler: PublicationRequestedHandler;
  let unitStatusHandler: UnitStatusChangedHandler;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    process.env.MONGO_URI = replSet.getUri();

    process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY ??= 'test-access-key';
    process.env.MINIO_SECRET_KEY ??= 'test-secret-key';
    process.env.MINIO_BUCKET_PRIVATE ??= 'test-private';
    process.env.MINIO_BUCKET_PUBLIC ??= 'test-public';

    const redisMock = createRedisMockService();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AppExceptionFilter());
    await app.register(fastifyCookie);

    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => app.get(CorrelationIdMiddleware).use(req, reply, () => {}));
    fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => app.get(TenantContextMiddleware).use(req, reply, () => {}));
    fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => app.get(AdminContextMiddleware).use(req, reply, () => {}));

    await app.init();
    await fastify.ready();

    connection = moduleRef.get<Connection>(getConnectionToken());
    authService = moduleRef.get(AuthService);
    organizationsService = moduleRef.get(OrganizationsService);
    developmentsService = moduleRef.get(DevelopmentsService);
    crmService = moduleRef.get(CrmService);
    dealRepository = moduleRef.get(DealRepository);
    bookingsService = moduleRef.get(BookingsService);
    bookingRepository = moduleRef.get(BookingRepository);
    developmentRepository = moduleRef.get(DevelopmentRepository);
    buildingRepository = moduleRef.get(BuildingRepository);
    unitRepository = moduleRef.get(UnitRepository);
    publicationRepository = moduleRef.get(MarketplacePublicationRepository);

    const mediaAssetRepo = moduleRef.get(MediaAssetRepository);
    const mediaStorageService = moduleRef.get(MediaStorageService);

    publicationHandler = new PublicationRequestedHandler(
      publicationRepository,
      developmentRepository,
      moduleRef.get(ListingRepository),
      moduleRef.get(PropertyAssetRepository),
      mediaAssetRepo,
      mediaStorageService,
      buildingRepository,
      unitRepository,
      moduleRef.get(FloorPlanRepository),
    );

    unitStatusHandler = new UnitStatusChangedHandler(
      unitRepository,
      buildingRepository,
      publicationRepository,
      developmentRepository,
    );
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (connection) await connection.close();
    if (replSet) await replSet.stop();
  });

  it('выполняет полный путь: регистрация девелопера -> ЖК -> шахматка -> пакетная цена -> публикация -> витрина -> лид -> бронь -> сделка -> изоляция', async () => {
    // 1. Регистрация двух пользователей и организаций: Застройщик A и Застройщик B
    const loginA = `dev_owner_a_${Date.now()}`;
    const passwordA = 'StrongPassword123!';
    await authService.registerIdentity({ login: loginA, password: passwordA });

    const devOrgA = await organizationsService.registerOrganizationOwner({
      login: loginA,
      password: passwordA,
      name: 'Batumi Development Group',
      type: 'developer',
      ipAddress: '127.0.0.1',
    });
    const orgIdA = new Types.ObjectId(devOrgA.organizationId);
    const posIdA = new Types.ObjectId(devOrgA.positionId);
    const identIdA = new Types.ObjectId(devOrgA.identityId);

    const loginB = `dev_owner_b_${Date.now()}`;
    const passwordB = 'StrongPassword123!';
    await authService.registerIdentity({ login: loginB, password: passwordB });

    const devOrgB = await organizationsService.registerOrganizationOwner({
      login: loginB,
      password: passwordB,
      name: 'Tbilisi Towers Ltd',
      type: 'developer',
      ipAddress: '127.0.0.1',
    });
    const orgIdB = new Types.ObjectId(devOrgB.organizationId);
    const identIdB = new Types.ObjectId(devOrgB.identityId);

    // 2. Создание ЖК в организации A
    const dev = await developmentsService.createDevelopment({
      organizationId: orgIdA,
      name: 'Batumi Sea Horizon',
      location: {
        country: 'Georgia',
        city: 'Batumi',
        address: 'Rustaveli Ave, 15',
        geo: { type: 'Point', coordinates: [41.64, 41.64] },
      },
      contact: {
        phone: '+995555112233',
        whatsapp: '+995555112233',
        telegram: '@batumi_horizon',
      },
      description: 'Премиальный жилой комплекс на первой линии.',
      idempotency: {
        identityId: identIdA,
        operation: 'devCreateDevelopment',
        key: `dev-create-${Date.now()}`,
        requestBody: { name: 'Batumi Sea Horizon' },
      },
    });
    expect(dev).toBeDefined();
    expect(dev.name).toBe('Batumi Sea Horizon');
    const devId = dev._id;

    // 3. Создание корпуса
    const building = await developmentsService.createBuilding({
      developmentId: devId,
      organizationId: orgIdA,
      name: 'Block A',
      floorsCount: 5,
      idempotency: {
        identityId: identIdA,
        operation: 'devCreateBuilding',
        key: `bld-create-${Date.now()}`,
        requestBody: { name: 'Block A' },
      },
    });
    expect(building).toBeDefined();
    const buildingId = building._id;

    // 4. Генерация шахматки (5 этажей, по 4 квартиры = 20 квартир по 50 000 USD)
    const chessboardResult = await developmentsService.generateChessboard({
      buildingId,
      organizationId: orgIdA,
      fromFloor: 1,
      toFloor: 5,
      unitsPerFloor: 4,
      numberingScheme: 'floor_prefix',
      defaultKind: 'apartment',
      rooms: 2,
      defaultArea: 50,
      defaultPrice: { amountMinorUnits: 5000000, currency: 'USD' },
      actorIdentityId: identIdA,
      correlationId: 'journey-generate-chessboard-corr-id',
      idempotency: {
        identityId: identIdA,
        operation: 'devGenerateChessboard',
        key: `chess-generate-${Date.now()}`,
        requestBody: { buildingId: buildingId.toString() },
      },
    });
    expect(chessboardResult.units).toHaveLength(20);
    expect(chessboardResult.units[0]!.price.amountMinorUnits).toBe(5000000);

    // 5. Пакетное обновление цен: наценка 10% на все квартиры в корпусе
    const batchResult = await developmentsService.batchUpdatePrices({
      developmentId: devId,
      organizationId: orgIdA,
      buildingId,
      operationType: 'percentage',
      value: 10,
      reason: 'Плановое повышение цен перед стартом продаж',
      actorIdentityId: identIdA,
      actorPositionId: posIdA,
      correlationId: 'journey-batch-pricing-corr-id',
      idempotency: {
        identityId: identIdA,
        operation: 'devBatchUpdatePrices',
        key: `batch-price-${Date.now()}`,
        requestBody: { developmentId: devId.toString(), buildingId: buildingId.toString() },
      },
    });
    expect(batchResult.updatedCount).toBe(20);

    // Проверяем, что цена квартир стала 55 000 USD (5 500 000 minor units)
    const unitsAfterBatch = await developmentsService.listUnitsForBuilding(
      buildingId,
      orgIdA,
      { limit: 50 },
    );
    expect(unitsAfterBatch).toHaveLength(20);
    for (const u of unitsAfterBatch) {
      expect(u.price.amountMinorUnits).toBe(5500000);
      expect(u.status).toBe('available');
    }

    // 6. Публикация ЖК на витрину
    await developmentsService.publishDevelopment({
      id: devId,
      organizationId: orgIdA,
      idempotencyKey: `publish-key-${Date.now()}`,
      actorIdentityId: identIdA,
      correlationId: 'journey-publish-corr-id',
    });

    const pendingPub = await publicationRepository.findBySource('development', devId);
    expect(pendingPub).toBeDefined();

    // Обработка outbox-события воркером публикации
    await publicationHandler.handle({
      aggregateType: 'development',
      aggregateId: devId,
      eventType: 'PublicationRequested',
      payload: {
        publicationId: pendingPub!._id.toString(),
        sourceType: 'development',
        sourceId: devId.toString(),
        version: pendingPub!.version,
      },
    } as unknown as OutboxEventDocument);

    // Проверяем, что создана публикация ЖК на витрине со статусом published
    const devPub = await publicationRepository.findBySource('development', devId);
    expect(devPub).toBeDefined();
    expect(devPub!.status).toBe('published');
    expect(devPub!.denormalizedFields?.priceFrom).toEqual({
      amountMinorUnits: 5500000,
      currency: 'USD',
    });
    expect((devPub!.denormalizedFields?.units as Array<unknown>).length).toBe(20);

    // 7. Покупатель на витрине: обращение / контактная форма (revealContact)
    const revealResult = await crmService.revealContact({
      slug: devPub!.slug!,
      requesterName: 'Алексей Покупатель',
      requesterPhone: '+995599887766',
      utm: { source: 'google', medium: 'cpc' },
      idempotencyKey: `reveal-${Date.now()}`,
      correlationId: 'journey-reveal-corr-id',
    });
    expect(revealResult.phone).toBe('+995555112233');
    expect(revealResult.leadId).toBeDefined();
    // Заявка с телефоном посетителя всегда создаёт лид (без телефона — только показ номера).
    const leadId = revealResult.leadId!;

    // 8. Менеджер в ERP видит входящий лид в CRM
    const leadsList = await crmService.listLeads({
      organizationId: orgIdA,
      limit: 10,
    });
    expect(leadsList.items.length).toBeGreaterThanOrEqual(1);
    const lead = leadsList.items.find((l) => l.id === leadId.toString());
    expect(lead).toBeDefined();
    expect(lead!.contact?.name).toBe('Алексей Покупатель');

    // 9. Менеджер бронирует выбранную квартиру (например, квартиру 101) под этот лид
    const chosenUnit = unitsAfterBatch[0]!;
    const bookingResult = await bookingsService.book({
      unitId: chosenUnit._id,
      organizationId: orgIdA,
      leadId,
      managerPositionId: posIdA,
      actorIdentityId: identIdA,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      idempotencyKey: `book-unit-${chosenUnit._id.toString()}-${Date.now()}`,
      correlationId: 'journey-book-unit-corr-id',
    });
    expect(bookingResult).toBeDefined();
    expect('status' in bookingResult && bookingResult.status).toBe('pending');
    const booking = bookingResult as BookingDocument;

    // Проверяем, что статус юнита перешел в reserved
    const bookedUnit = await unitRepository.findById(chosenUnit._id);
    expect(bookedUnit!.status).toBe('reserved');

    // Обработка события смены статуса юнита
    await unitStatusHandler.handle({
      aggregateType: 'unit',
      aggregateId: chosenUnit._id,
      eventType: 'UnitStatusChanged',
      payload: {
        unitId: chosenUnit._id.toString(),
        developmentId: devId.toString(),
        previousStatus: 'available',
        newStatus: 'reserved',
        organizationId: orgIdA.toString(),
      },
    } as unknown as OutboxEventDocument);

    // Витрина обновилась: доступных квартир стало 19
    const devPubAfterBooking = await publicationRepository.findBySource('development', devId);
    expect((devPubAfterBooking!.denormalizedFields?.units as Array<unknown>).length).toBe(19);

    // 10. Перевод брони в сделку
    const dealResult = await bookingsService.convertToDeal({
      bookingId: booking._id,
      organizationId: orgIdA,
      actorIdentityId: identIdA,
      managerPositionId: posIdA,
      title: 'Сделка по квартире 101 — Батуми Резиденс',
      expectedCommission: { amountMinorUnits: 165000, currency: 'USD' },
      idempotencyKey: `convert-deal-key-${Date.now()}`,
      correlationId: 'journey-convert-deal-corr-id',
    });
    expect(dealResult).toBeDefined();
    expect('deal' in dealResult && dealResult.deal).toBeDefined();
    const dealDocId = 'deal' in dealResult ? dealResult.deal._id : null;
    expect(dealDocId).toBeDefined();

    // Проверяем статус брони в БД: paid
    const finalBooking = await bookingRepository.findByIdForOrganization(booking._id, orgIdA);
    expect(finalBooking!.status).toBe('paid');

    // Проверяем статус юнита в БД: sold
    const soldUnit = await unitRepository.findById(chosenUnit._id);
    expect(soldUnit!.status).toBe('sold');

    // Проверяем сделку в CRM
    const dealDoc = await dealRepository.findByIdForOrganization(dealDocId!, orgIdA);
    expect(dealDoc).toBeDefined();
    expect(dealDoc!.title).toBe('Сделка по квартире 101 — Батуми Резиденс');
    expect(dealDoc!.unitId?.toString()).toBe(chosenUnit._id.toString());
    expect(dealDoc!.leadId?.toString()).toBe(leadId.toString());

    // 11. Проверка строгой изоляции организаций (Tenant Isolation)
    // Организация B пытается запросить ЖК организации A -> 404
    await expect(
      developmentsService.getDevelopmentForOrganization(devId, orgIdB),
    ).rejects.toThrow();

    // Организация B пытается запросить юниты корпуса организации A -> 404
    await expect(
      developmentsService.listUnitsForBuilding(
        buildingId,
        orgIdB,
        { limit: 50 },
      ),
    ).rejects.toThrow();

    // Организация B пытается запросить сделку организации A -> null / 404
    const orgBDeal = await dealRepository.findByIdForOrganization(dealDocId!, orgIdB);
    expect(orgBDeal).toBeNull();

    // Организация B пытается перевести чужую бронь в сделку -> 404
    await expect(
      bookingsService.convertToDeal({
        bookingId: booking._id,
        organizationId: orgIdB,
        actorIdentityId: identIdB,
        managerPositionId: new Types.ObjectId(),
        idempotencyKey: `intruder-key-${Date.now()}`,
        correlationId: 'journey-intruder-corr-id',
      }),
    ).rejects.toThrow();
  });
});
