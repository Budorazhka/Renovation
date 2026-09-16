import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/shared/errors/app-exception.filter';
import { CorrelationIdMiddleware } from '../../src/shared/errors/correlation-id.middleware';
import { TenantContextMiddleware } from '../../src/shared/tenant/tenant-context.middleware';
import { AdminContextMiddleware } from '../../src/shared/admin/admin-context.middleware';
import { MarketplaceAccountContextMiddleware } from '../../src/shared/marketplace-account/marketplace-account-context.middleware';
import { AuthService } from '../../src/modules/identity/auth.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { UnitRepository } from '../../src/modules/developments/repository/unit.repository';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * POST/GET/PATCH/DELETE /selections + GET /public/selections/:token —
 * HTTP-уровневый integration-тест против ПОЛНОГО AppModule (тот же
 * bootstrap-паттерн, что lead-read-path-http.integration-spec.ts) —
 * закрывает TenantGuard/PermissionGuard/own-scope/Idempotency-Key/
 * expectedVersion CAS на реальном HTTP-пути, плюс публичный контур без
 * какой-либо аутентификации.
 */
describe('Selections (dev selections) — HTTP integration (полный AppModule)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let authService: AuthService;
  let organizationsService: OrganizationsService;
  let unitRepository: UnitRepository;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    process.env.MONGO_URI = replSet.getUri();
    process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY ??= 'test-access-key';
    process.env.MINIO_SECRET_KEY ??= 'test-secret-key';
    process.env.MINIO_BUCKET_PRIVATE ??= 'test-private';
    process.env.MINIO_BUCKET_PUBLIC ??= 'test-public';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(createRedisMockService())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    await app.register(fastifyCookie);
    const fastifyInstance = app.getHttpAdapter().getInstance();
    const correlationIdMiddleware = app.get(CorrelationIdMiddleware);
    const tenantContextMiddleware = app.get(TenantContextMiddleware);
    const adminContextMiddleware = app.get(AdminContextMiddleware);
    const marketplaceAccountContextMiddleware = app.get(MarketplaceAccountContextMiddleware);
    const isHealthCheckPath = (url: string): boolean => url === '/health' || url === '/health/ready';
    fastifyInstance.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (isHealthCheckPath(req.url)) return;
      await correlationIdMiddleware.use(req, reply, () => {});
    });
    fastifyInstance.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (isHealthCheckPath(req.url)) return;
      await tenantContextMiddleware.use(req, reply, () => {});
    });
    fastifyInstance.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (isHealthCheckPath(req.url)) return;
      await adminContextMiddleware.use(req, reply, () => {});
    });
    fastifyInstance.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (isHealthCheckPath(req.url)) return;
      await marketplaceAccountContextMiddleware.use(req, reply, () => {});
    });
    app.useGlobalFilters(new AppExceptionFilter());
    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    connection = moduleRef.get<Connection>(getConnectionToken());
    authService = moduleRef.get(AuthService);
    organizationsService = moduleRef.get(OrganizationsService);
    unitRepository = moduleRef.get(UnitRepository);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    for (const collection of [
      'dev_selections',
      'units',
      'property_assets',
      'listings',
      'positions',
      'position_assignments',
      'organizations',
      'permission_grants',
      'identities',
      'sessions',
      'product_accesses',
      'idempotency_records',
    ]) {
      await connection.collection(collection).deleteMany({});
    }
  });

  const PASSWORD = 'correct horse battery staple';

  async function seedOwnerSession(): Promise<{ cookie: string; organizationId: Types.ObjectId }> {
    const login = `owner-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const { organizationId } = await organizationsService.createOrganizationWithOwner({
      type: 'agency',
      name: 'Интеграционное агентство',
      ownerIdentityId: identityId,
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, organizationId };
  }

  async function seedManagerSession(
    organizationId: Types.ObjectId,
  ): Promise<{ cookie: string; positionId: Types.ObjectId }> {
    const login = `manager-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'manager' });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: 'Интеграционный менеджер',
      actorIdentityId: identityId,
      expectedOrganizationId: organizationId,
      correlationId: 'dev-selections-integration-seed',
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, positionId };
  }

  async function seedAdministratorSession(organizationId: Types.ObjectId): Promise<{ cookie: string }> {
    const login = `admin-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'administrator' });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: 'Интеграционный администратор',
      actorIdentityId: identityId,
      expectedOrganizationId: organizationId,
      correlationId: 'dev-selections-integration-seed',
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}` };
  }

  async function seedUnit(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const unit = await unitRepository.create({
      buildingId: new Types.ObjectId(),
      floorId: new Types.ObjectId(),
      organizationId,
      number: 'A-101',
      kind: 'apartment',
      area: 42,
      price: { amountMinorUnits: 100_000, currency: 'USD' },
    });
    return unit._id;
  }

  /** N-27: объявление вторички своей организации — прямая вставка (пакет property-assets не даёт HTTP-независимого сидера). */
  async function seedListing(
    organizationId: Types.ObjectId,
    overrides?: { city?: string; address?: string },
  ): Promise<{ propertyAssetId: Types.ObjectId; listingId: Types.ObjectId }> {
    const propertyAssetId = new Types.ObjectId();
    await connection.collection('property_assets').insertOne({
      _id: propertyAssetId,
      publisherScope: { type: 'organization', organizationId },
      propertyType: 'apartment',
      location: {
        country: 'GE',
        city: overrides?.city ?? 'Батуми',
        address: overrides?.address ?? 'ул. Руставели, 7',
        geo: { type: 'Point', coordinates: [41.64, 41.64] },
      },
      characteristics: { area: 65, rooms: 2, floor: 7 },
      representativePhone: '+995555000000',
      media: [],
      version: 0,
      createdAt: new Date(),
    });
    const listingId = new Types.ObjectId();
    await connection.collection('listings').insertOne({
      _id: listingId,
      propertyAssetId,
      publisherScope: { type: 'organization', organizationId },
      dealType: 'sale',
      price: { amountMinorUnits: 12_000_000, currency: 'USD' },
      status: 'active',
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { propertyAssetId, listingId };
  }

  describe('аутентификация/авторизация', () => {
    it('POST /selections без cookie — 401 AUTH_NO_SESSION', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/selections', payload: { title: 'x', unitIds: [] } });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe('AUTH_NO_SESSION');
    });

    it('POST /selections без Idempotency-Key — 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const unitId = await seedUnit(organizationId);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie },
        payload: { title: 'Подборка', unitIds: [unitId.toString()] },
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('administrator (без dev_selection.* грантов) — 403 на POST /selections', async () => {
      const { organizationId } = await seedOwnerSession();
      const { cookie } = await seedAdministratorSession(organizationId);
      const unitId = await seedUnit(organizationId);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
        payload: { title: 'Подборка', unitIds: [unitId.toString()] },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('CRUD (owner, organization-scope)', () => {
    it('создаёт, читает, обновляет (CAS), удаляет подборку', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const unitId = await seedUnit(organizationId);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'create-key-1' },
        payload: { title: 'Для Анны', unitIds: [unitId.toString()], clientName: 'Анна' },
      });
      expect(createResponse.statusCode).toBe(201);
      const created = JSON.parse(createResponse.body);
      expect(created.title).toBe('Для Анны');
      expect(created.status).toBe('draft');
      expect(created.version).toBe(0);
      expect(typeof created.publicToken).toBe('string');
      expect(created.publicToken.length).toBeGreaterThanOrEqual(32);

      const listResponse = await app.inject({ method: 'GET', url: '/api/v1/selections', headers: { cookie } });
      expect(listResponse.statusCode).toBe(200);
      expect(JSON.parse(listResponse.body).items).toHaveLength(1);

      const getResponse = await app.inject({ method: 'GET', url: `/api/v1/selections/${created.id}`, headers: { cookie } });
      expect(getResponse.statusCode).toBe(200);

      const updateResponse = await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}`,
        headers: { cookie, 'idempotency-key': 'update-key-1' },
        payload: { expectedVersion: 0, title: 'Для Анны (уточнено)' },
      });
      expect(updateResponse.statusCode).toBe(200);
      expect(JSON.parse(updateResponse.body).title).toBe('Для Анны (уточнено)');
      expect(JSON.parse(updateResponse.body).version).toBe(1);

      // Устаревшая версия -> 409 VERSION_CONFLICT
      const conflictResponse = await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}`,
        headers: { cookie, 'idempotency-key': 'update-key-conflict' },
        payload: { expectedVersion: 0, title: 'Конфликт' },
      });
      expect(conflictResponse.statusCode).toBe(409);

      const statusResponse = await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}/status`,
        headers: { cookie, 'idempotency-key': 'status-key-1' },
        payload: { expectedVersion: 1, status: 'sent' },
      });
      expect(statusResponse.statusCode).toBe(200);
      const sent = JSON.parse(statusResponse.body);
      expect(sent.status).toBe('sent');
      expect(sent.sentAt).toBeDefined();

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/v1/selections/${created.id}?expectedVersion=2`,
        headers: { cookie, 'idempotency-key': 'delete-key-1' },
      });
      expect(deleteResponse.statusCode).toBe(204);

      const afterDelete = await app.inject({ method: 'GET', url: `/api/v1/selections/${created.id}`, headers: { cookie } });
      expect(afterDelete.statusCode).toBe(404);
    });

    it('отклоняет создание с несуществующим unitId — 404', async () => {
      const { cookie } = await seedOwnerSession();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'create-key-missing-unit' },
        payload: { title: 'Подборка', unitIds: [new Types.ObjectId().toString()] },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it('организация B не видит и не может получить подборку организации A — 404', async () => {
      const { cookie: cookieA, organizationId: orgA } = await seedOwnerSession();
      const { cookie: cookieB } = await seedOwnerSession();
      const unitId = await seedUnit(orgA);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie: cookieA, 'idempotency-key': 'tenant-a-key' },
        payload: { title: 'Подборка A', unitIds: [unitId.toString()] },
      });
      const created = JSON.parse(createResponse.body);

      const listB = await app.inject({ method: 'GET', url: '/api/v1/selections', headers: { cookie: cookieB } });
      expect(JSON.parse(listB.body).items).toHaveLength(0);

      const getB = await app.inject({ method: 'GET', url: `/api/v1/selections/${created.id}`, headers: { cookie: cookieB } });
      expect(getB.statusCode).toBe(404);
    });
  });

  describe('own-scope (manager)', () => {
    it('manager видит только созданные им подборки, чужую подборку не видит (404)', async () => {
      const { organizationId } = await seedOwnerSession();
      const { cookie: managerACookie } = await seedManagerSession(organizationId);
      const { cookie: managerBCookie } = await seedManagerSession(organizationId);
      const unitId = await seedUnit(organizationId);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie: managerACookie, 'idempotency-key': 'manager-a-key' },
        payload: { title: 'Подборка менеджера A', unitIds: [unitId.toString()] },
      });
      expect(createResponse.statusCode).toBe(201);
      const created = JSON.parse(createResponse.body);

      const listA = await app.inject({ method: 'GET', url: '/api/v1/selections', headers: { cookie: managerACookie } });
      expect(JSON.parse(listA.body).items).toHaveLength(1);

      const listB = await app.inject({ method: 'GET', url: '/api/v1/selections', headers: { cookie: managerBCookie } });
      expect(JSON.parse(listB.body).items).toHaveLength(0);

      const getB = await app.inject({
        method: 'GET',
        url: `/api/v1/selections/${created.id}`,
        headers: { cookie: managerBCookie },
      });
      expect(getB.statusCode).toBe(404);
    });
  });

  describe('публичная сторона — GET /public/selections/:token', () => {
    it('200 без какой-либо аутентификации, whitelist-проекция, инкремент viewCount, sent->viewed, без утечки приватного телефона', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const unitId = await seedUnit(organizationId);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'public-flow-create' },
        payload: {
          title: 'Публичная подборка',
          unitIds: [unitId.toString()],
          clientName: 'Клиент',
          clientPhone: '+995 599 99 99 99',
        },
      });
      const created = JSON.parse(createResponse.body);

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}/status`,
        headers: { cookie, 'idempotency-key': 'public-flow-status' },
        payload: { expectedVersion: 0, status: 'sent' },
      });

      const publicResponse = await app.inject({ method: 'GET', url: `/api/v1/public/selections/${created.publicToken}` });
      expect(publicResponse.statusCode).toBe(200);
      const body = JSON.parse(publicResponse.body);
      expect(body.title).toBe('Публичная подборка');
      expect(body.status).toBe('viewed');
      expect(body.viewCount).toBe(1);
      expect(body).not.toHaveProperty('organizationId');
      expect(body).not.toHaveProperty('createdByPositionId');
      expect(body).not.toHaveProperty('publicToken');
      expect(body).not.toHaveProperty('version');
      expect(body).not.toHaveProperty('clientPhone');

      const secondOpen = await app.inject({ method: 'GET', url: `/api/v1/public/selections/${created.publicToken}` });
      expect(JSON.parse(secondOpen.body).viewCount).toBe(2);
      expect(JSON.parse(secondOpen.body).status).toBe('viewed');
    });

    it('404 для отозванной / архивированной подборки', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const unitId = await seedUnit(organizationId);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'public-flow-archived-create' },
        payload: { title: 'Архивная подборка', unitIds: [unitId.toString()] },
      });
      const created = JSON.parse(createResponse.body);

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}/status`,
        headers: { cookie, 'idempotency-key': 'public-flow-archived-status' },
        payload: { expectedVersion: 0, status: 'archived' },
      });

      const response = await app.inject({ method: 'GET', url: `/api/v1/public/selections/${created.publicToken}` });
      expect(response.statusCode).toBe(404);
    });

    it('404 для несуществующего токена', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/public/selections/nonexistent-token' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('N-27: объявления вторички в подборке наравне с юнитами', () => {
    it('создаёт подборку из listingIds, приватный GET отдаёт targetType/listingId без денормализации', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const { listingId } = await seedListing(organizationId);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'listing-create-1' },
        payload: { title: 'Вторичка для Бориса', listingIds: [listingId.toString()] },
      });
      expect(createResponse.statusCode).toBe(201);
      const created = JSON.parse(createResponse.body);
      expect(created.items).toEqual([{ targetType: 'listing', listingId: listingId.toString() }]);
    });

    it('отклоняет создание с несуществующим listingId — 404', async () => {
      const { cookie } = await seedOwnerSession();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'listing-create-missing' },
        payload: { title: 'Попытка', listingIds: [new Types.ObjectId().toString()] },
      });
      expect(response.statusCode).toBe(404);
    });

    it('ни unitIds, ни listingIds — 400 VALIDATION_FAILED', async () => {
      const { cookie } = await seedOwnerSession();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/selections',
        headers: { cookie, 'idempotency-key': 'listing-create-empty' },
        payload: { title: 'Пустая подборка' },
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_FAILED');
    });

    it('POST /items со listingIds добавляет объявление в уже созданную подборку юнитов', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const unitId = await seedUnit(organizationId);
      const { listingId } = await seedListing(organizationId);

      const created = JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/selections',
            headers: { cookie, 'idempotency-key': 'mixed-create' },
            payload: { title: 'Смешанная подборка', unitIds: [unitId.toString()] },
          })
        ).body,
      );

      const addResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/selections/${created.id}/items`,
        headers: { cookie, 'idempotency-key': 'mixed-add-listing' },
        payload: { expectedVersion: 0, listingIds: [listingId.toString()] },
      });
      expect(addResponse.statusCode).toBe(201);
      const updated = JSON.parse(addResponse.body);
      expect(updated.items).toHaveLength(2);
      expect(updated.items.some((item: { targetType: string; listingId?: string }) => item.targetType === 'listing' && item.listingId === listingId.toString())).toBe(true);
    });

    it('DELETE и PATCH /items/:itemId работают по id объявления так же, как по id юнита', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const { listingId } = await seedListing(organizationId);

      const created = JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/selections',
            headers: { cookie, 'idempotency-key': 'itemid-create' },
            payload: { title: 'Для правки', listingIds: [listingId.toString()] },
          })
        ).body,
      );

      const patchResponse = await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}/items/${listingId.toString()}`,
        headers: { cookie, 'idempotency-key': 'itemid-patch' },
        payload: { expectedVersion: 0, agentNote: 'Хороший вид на море' },
      });
      expect(patchResponse.statusCode).toBe(200);
      const patched = JSON.parse(patchResponse.body);
      expect(patched.items[0]).toMatchObject({ listingId: listingId.toString(), agentNote: 'Хороший вид на море' });

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/v1/selections/${created.id}/items/${listingId.toString()}?expectedVersion=1`,
        headers: { cookie, 'idempotency-key': 'itemid-delete' },
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(JSON.parse(deleteResponse.body).items).toHaveLength(0);
    });

    it('публичная сторона денормализует объявление: адрес, площадь, цена, без приватного телефона', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const { listingId } = await seedListing(organizationId, { city: 'Тбилиси', address: 'пр. Руставели, 12' });

      const created = JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/selections',
            headers: { cookie, 'idempotency-key': 'public-listing-create' },
            payload: { title: 'Публичная вторичка', listingIds: [listingId.toString()], clientPhone: '+995500000001' },
          })
        ).body,
      );
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/selections/${created.id}/status`,
        headers: { cookie, 'idempotency-key': 'public-listing-status' },
        payload: { expectedVersion: 0, status: 'sent' },
      });

      const response = await app.inject({ method: 'GET', url: `/api/v1/public/selections/${created.publicToken}` });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items[0]).toMatchObject({
        targetType: 'listing',
        listingId: listingId.toString(),
        listing: {
          propertyType: 'apartment',
          city: 'Тбилиси',
          address: 'пр. Руставели, 12',
          area: 65,
          rooms: 2,
          floor: 7,
          dealType: 'sale',
          price: { amountMinorUnits: 12_000_000, currency: 'USD' },
          status: 'active',
        },
      });
      expect(response.body).not.toMatch(/\+995500000001/);
    });
  });
});
