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
import type { OrganizationType } from '../../src/modules/organizations/schemas/organization.schema';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * Фиксация клиента у застройщика (N-26) — HTTP-интеграция на реальной
 * MongoDB replica set: заявка агентства, подтверждение и отказ застройщика,
 * закрепление клиента на шесть месяцев, защита от второй заявки на того же
 * человека и от чужого решения.
 */
describe('Client registrations — HTTP Integration (AppModule)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let authService: AuthService;
  let organizationsService: OrganizationsService;

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
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    for (const name of [
      'client_registrations',
      'developments',
      'idempotency_records',
      'positions',
      'position_assignments',
      'organizations',
      'permission_grants',
      'identities',
      'sessions',
      'product_accesses',
      'audit_events',
      'outbox_events',
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  const PASSWORD = 'correct horse battery staple';

  async function seedOwnerSession(
    type: OrganizationType,
    name: string,
  ): Promise<{ cookie: string; organizationId: Types.ObjectId }> {
    const login = `owner-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const { organizationId } = await organizationsService.createOrganizationWithOwner({
      type,
      name,
      ownerIdentityId: identityId,
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, organizationId };
  }

  async function seedPublishedDevelopment(organizationId: Types.ObjectId, name: string): Promise<Types.ObjectId> {
    const developmentId = new Types.ObjectId();
    await connection.collection('developments').insertOne({
      _id: developmentId,
      organizationId,
      name,
      status: 'active',
      location: { country: 'Georgia', city: 'Batumi', geo: { type: 'Point', coordinates: [41.6, 41.6] } },
      contact: { phone: '+995500000000' },
      version: 0,
      createdAt: new Date(),
    });
    return developmentId;
  }

  const client = { clientName: 'Иванов Иван', clientPhone: '+995 555 12-34-56' };

  function createRegistration(cookie: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/client-registrations',
      headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: body,
    });
  }

  it('заявка агентства приходит застройщику, подтверждение закрепляет клиента на шесть месяцев', async () => {
    const developer = await seedOwnerSession('developer', 'Застройщик Икс');
    const agency = await seedOwnerSession('agency', 'Агентство Один');
    const developmentId = await seedPublishedDevelopment(developer.organizationId, 'ЖК Солнечный');

    const created = await createRegistration(agency.cookie, { ...client, developmentId: developmentId.toString() });
    expect(created.statusCode).toBe(201);
    const registration = created.json();
    expect(registration.status).toBe('pending');
    expect(registration.awaitsDeveloper).toBe(true);
    // Имя застройщика и название проекта сервер берёт из ЖК, а не из тела запроса.
    expect(registration.developerName).toBe('Застройщик Икс');
    expect(registration.projectName).toBe('ЖК Солнечный');

    const incoming = await app.inject({
      method: 'GET',
      url: '/api/v1/client-registrations/incoming',
      headers: { cookie: developer.cookie },
    });
    expect(incoming.statusCode).toBe(200);
    expect(incoming.json().items).toHaveLength(1);
    expect(incoming.json().items[0].agencyOrganizationId).toBe(agency.organizationId.toString());

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${registration.id}/accept`,
      headers: { cookie: developer.cookie },
      payload: { expectedVersion: registration.version },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('active');

    const reservedUntil = new Date(accepted.json().reservedUntil);
    const decidedAt = new Date(accepted.json().decidedAt);
    const expected = new Date(decidedAt.getTime());
    expected.setMonth(expected.getMonth() + 6);
    expect(reservedUntil.toISOString()).toBe(expected.toISOString());

    const registry = await app.inject({
      method: 'GET',
      url: '/api/v1/client-registrations',
      headers: { cookie: agency.cookie },
    });
    expect(registry.json().items[0].status).toBe('active');
    expect(registry.json().items[0].isExpired).toBe(false);
  });

  it('второе агентство не может зафиксировать того же клиента в том же ЖК, пока закрепление живо', async () => {
    const developer = await seedOwnerSession('developer', 'Застройщик Икс');
    const first = await seedOwnerSession('agency', 'Агентство Один');
    const second = await seedOwnerSession('agency', 'Агентство Два');
    const developmentId = await seedPublishedDevelopment(developer.organizationId, 'ЖК Солнечный');

    const created = await createRegistration(first.cookie, { ...client, developmentId: developmentId.toString() });
    expect(created.statusCode).toBe(201);

    // Тот же человек, записанный другим форматом номера.
    const blocked = await createRegistration(second.cookie, {
      clientName: 'Иванов И.И.',
      clientPhone: '995555123456',
      developmentId: developmentId.toString(),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('CLIENT_ALREADY_REGISTERED');
    // Название агентства-конкурента наружу не уходит.
    expect(JSON.stringify(blocked.json())).not.toContain('Агентство Один');

    // После снятия заявки клиент свободен.
    const registration = created.json();
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${registration.id}/cancel`,
      headers: { cookie: first.cookie },
      payload: { expectedVersion: registration.version },
    });
    expect(cancelled.statusCode).toBe(200);

    const retry = await createRegistration(second.cookie, {
      clientName: 'Иванов И.И.',
      clientPhone: '995555123456',
      developmentId: developmentId.toString(),
    });
    expect(retry.statusCode).toBe(201);
  });

  it('чужой застройщик не видит и не решает заявку, а отказ приходит с причиной', async () => {
    const developer = await seedOwnerSession('developer', 'Застройщик Икс');
    const stranger = await seedOwnerSession('developer', 'Застройщик Игрек');
    const agency = await seedOwnerSession('agency', 'Агентство Один');
    const developmentId = await seedPublishedDevelopment(developer.organizationId, 'ЖК Солнечный');

    const registration = (await createRegistration(agency.cookie, { ...client, developmentId: developmentId.toString() })).json();

    const strangerIncoming = await app.inject({
      method: 'GET',
      url: '/api/v1/client-registrations/incoming',
      headers: { cookie: stranger.cookie },
    });
    expect(strangerIncoming.json().items).toHaveLength(0);

    const strangerDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${registration.id}/accept`,
      headers: { cookie: stranger.cookie },
      payload: { expectedVersion: registration.version },
    });
    expect(strangerDecision.statusCode).toBe(404);

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${registration.id}/reject`,
      headers: { cookie: developer.cookie },
      payload: { expectedVersion: registration.version, reason: 'Клиент пришёл к нам сам месяц назад' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('rejected');
    expect(rejected.json().decisionNote).toBe('Клиент пришёл к нам сам месяц назад');

    // Повтор того же решения упирается в статус, а не создаёт второй эффект.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${registration.id}/accept`,
      headers: { cookie: developer.cookie },
      payload: { expectedVersion: registration.version },
    });
    expect(again.statusCode).toBe(400);
  });

  it('заявку по застройщику вне платформы агентство подтверждает само, а по ЖК платформы — нет', async () => {
    const developer = await seedOwnerSession('developer', 'Застройщик Икс');
    const agency = await seedOwnerSession('agency', 'Агентство Один');
    const developmentId = await seedPublishedDevelopment(developer.organizationId, 'ЖК Солнечный');

    const external = (
      await createRegistration(agency.cookie, {
        ...client,
        developerName: 'Застройщик вне платформы',
        projectName: 'ЖК Приморский',
      })
    ).json();
    expect(external.awaitsDeveloper).toBe(false);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${external.id}/confirm-external`,
      headers: { cookie: agency.cookie },
      payload: { expectedVersion: external.version },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('active');
    expect(confirmed.json().reservedUntil).not.toBeNull();

    const onPlatform = (
      await createRegistration(agency.cookie, {
        clientName: 'Петров Пётр',
        clientPhone: '+995 555 99-88-77',
        developmentId: developmentId.toString(),
      })
    ).json();
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/client-registrations/${onPlatform.id}/confirm-external`,
      headers: { cookie: agency.cookie },
      payload: { expectedVersion: onPlatform.version },
    });
    expect(forbidden.statusCode).toBe(400);
  });

  it('без ключа идемпотентности заявка не создаётся, повтор с тем же ключом не создаёт вторую', async () => {
    const agency = await seedOwnerSession('agency', 'Агентство Один');
    const body = { ...client, developerName: 'Застройщик вне платформы', projectName: 'ЖК Приморский' };

    const noKey = await app.inject({
      method: 'POST',
      url: '/api/v1/client-registrations',
      headers: { cookie: agency.cookie },
      payload: body,
    });
    expect(noKey.statusCode).toBe(400);

    const key = new Types.ObjectId().toString();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/client-registrations',
      headers: { cookie: agency.cookie, 'idempotency-key': key },
      payload: body,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/client-registrations',
      headers: { cookie: agency.cookie, 'idempotency-key': key },
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(await connection.collection('client_registrations').countDocuments({})).toBe(1);
  });

  it('заявка чужой организации не читается и не правится', async () => {
    const agency = await seedOwnerSession('agency', 'Агентство Один');
    const other = await seedOwnerSession('agency', 'Агентство Два');
    const registration = (
      await createRegistration(agency.cookie, {
        ...client,
        developerName: 'Застройщик вне платформы',
        projectName: 'ЖК Приморский',
      })
    ).json();

    const foreignRegistry = await app.inject({
      method: 'GET',
      url: '/api/v1/client-registrations',
      headers: { cookie: other.cookie },
    });
    expect(foreignRegistry.json().items).toHaveLength(0);

    const foreignEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/client-registrations/${registration.id}`,
      headers: { cookie: other.cookie },
      payload: { expectedVersion: registration.version, notes: 'Чужая заметка' },
    });
    expect(foreignEdit.statusCode).toBe(404);

    const ownEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/client-registrations/${registration.id}`,
      headers: { cookie: agency.cookie },
      payload: { expectedVersion: registration.version, notes: 'Клиент ждёт звонка в пятницу' },
    });
    expect(ownEdit.statusCode).toBe(200);
    expect(ownEdit.json().notes).toBe('Клиент ждёт звонка в пятницу');

    // Повтор с той же версией — конфликт, вторая правка не применяется.
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/v1/client-registrations/${registration.id}`,
      headers: { cookie: agency.cookie },
      payload: { expectedVersion: registration.version, notes: 'Ещё одна заметка' },
    });
    expect(stale.statusCode).toBe(409);
  });
});
