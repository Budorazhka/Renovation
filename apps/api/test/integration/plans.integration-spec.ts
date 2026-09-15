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
import type { FixedRole } from '../../src/modules/organizations/schemas/position.schema';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * Планы сотрудников (модуль `plans`) — HTTP-интеграция на реальной MongoDB
 * replica set: права руководителя и сотрудника, CAS по версии, факт по плану.
 */
describe('Plans — HTTP Integration (AppModule)', () => {
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
      'plans',
      'tasks',
      'lead_events',
      'leads',
      'contacts',
      'media_assets',
      'positions',
      'position_assignments',
      'organizations',
      'permission_grants',
      'identities',
      'sessions',
      'product_accesses',
      'audit_events',
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  const PASSWORD = 'correct horse battery staple';

  async function seedOwnerSession(): Promise<{ cookie: string; organizationId: Types.ObjectId; positionId: Types.ObjectId }> {
    const login = `owner-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const { organizationId, positionId } = await organizationsService.createOrganizationWithOwner({
      type: 'agency',
      name: 'Интеграционное агентство',
      ownerIdentityId: identityId,
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, organizationId, positionId };
  }

  async function seedPositionSession(
    organizationId: Types.ObjectId,
    fixedRole: FixedRole,
  ): Promise<{ cookie: string; positionId: Types.ObjectId }> {
    const login = `${fixedRole}-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: `Интеграционный ${fixedRole}`,
      actorIdentityId: identityId,
      expectedOrganizationId: organizationId,
      correlationId: 'http-integration-test-seed',
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, positionId };
  }

  const period = new Date().toISOString().slice(0, 7);
  const targets = {
    revenueTargetMinorUnits: 500000,
    currency: 'USD',
    leadsTarget: 20,
    dealsTarget: 2,
    callsTarget: 60,
    meetingsTarget: 10,
    showingsTarget: 6,
  };

  function putPlan(cookie: string, positionId: Types.ObjectId, payload: Record<string, unknown>) {
    return app.inject({ method: 'PUT', url: `/api/v1/plans/${positionId.toString()}/${period}`, headers: { cookie }, payload });
  }

  it('без сессии — 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/plans?period=${period}` });
    expect(res.statusCode).toBe(401);
  });

  it('руководитель ставит план менеджеру, менеджер видит только свой и не трогает чужие', async () => {
    const owner = await seedOwnerSession();
    const manager = await seedPositionSession(owner.organizationId, 'manager');

    const created = await putPlan(owner.cookie, manager.positionId, targets);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual(
      expect.objectContaining({ positionId: manager.positionId.toString(), leadsTarget: 20, version: 0 }),
    );

    expect((await putPlan(owner.cookie, owner.positionId, { ...targets, leadsTarget: 5 })).statusCode).toBe(200);

    const managerList = await app.inject({ method: 'GET', url: `/api/v1/plans?period=${period}`, headers: { cookie: manager.cookie } });
    expect(managerList.json()).toEqual({
      items: [expect.objectContaining({ positionId: manager.positionId.toString() })],
      canManageTeam: false,
    });

    const ownerList = await app.inject({ method: 'GET', url: `/api/v1/plans?period=${period}`, headers: { cookie: owner.cookie } });
    expect(ownerList.json().items).toHaveLength(2);
    expect(ownerList.json().canManageTeam).toBe(true);

    expect((await putPlan(manager.cookie, owner.positionId, targets)).statusCode).toBe(403);
  });

  it('сотрудник меняет свой план только с актуальной версией', async () => {
    const owner = await seedOwnerSession();
    const manager = await seedPositionSession(owner.organizationId, 'manager');

    expect((await putPlan(manager.cookie, manager.positionId, targets)).statusCode).toBe(200);
    expect((await putPlan(manager.cookie, manager.positionId, { ...targets, callsTarget: 80 })).statusCode).toBe(409);
    const updated = await putPlan(manager.cookie, manager.positionId, { ...targets, callsTarget: 80, expectedVersion: 0 });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual(expect.objectContaining({ callsTarget: 80, version: 1 }));
    expect(await connection.collection('audit_events').countDocuments({ action: 'plan.update' })).toBe(2);
  });

  it('позиция другой организации — 404', async () => {
    const owner = await seedOwnerSession();
    const stranger = await seedOwnerSession();
    expect((await putPlan(owner.cookie, stranger.positionId, targets)).statusCode).toBe(404);
  });

  it('прогресс: факт менеджера — лиды, закрытые звонки и показы; чужой прогресс сотруднику недоступен', async () => {
    const owner = await seedOwnerSession();
    const manager = await seedPositionSession(owner.organizationId, 'manager');
    await putPlan(owner.cookie, manager.positionId, targets);

    const now = new Date();
    const leadId = new Types.ObjectId();
    await connection.collection('leads').insertOne({
      _id: leadId,
      organizationId: owner.organizationId,
      contactId: new Types.ObjectId(),
      ownerPositionId: manager.positionId,
      productType: 'sales',
      stage: 'showing',
      version: 0,
      source: { route: 'manual' },
      createdAt: now,
    });
    await connection.collection('lead_events').insertOne({
      leadId,
      organizationId: owner.organizationId,
      stage: 'showing',
      changedBy: { type: 'position', positionId: manager.positionId },
      changedAt: now,
    });
    await connection.collection('tasks').insertOne({
      organizationId: owner.organizationId,
      title: 'Позвонить',
      status: 'completed',
      taskType: 'call',
      assignedPositionId: manager.positionId,
      completedAt: now,
      createdAt: now,
      version: 1,
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/plans/progress?period=${period}`, headers: { cookie: manager.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workingDays).toBeGreaterThan(0);
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0]).toEqual(
      expect.objectContaining({
        positionId: manager.positionId.toString(),
        plan: expect.objectContaining({ leadsTarget: 20 }),
        month: expect.objectContaining({ leads: 1, calls: 1, showings: 1, meetings: 0 }),
        today: expect.objectContaining({ leads: 1, calls: 1, showings: 1 }),
      }),
    );

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/progress?period=${period}&positionId=${owner.positionId.toString()}`,
      headers: { cookie: manager.cookie },
    });
    expect(foreign.statusCode).toBe(403);
  });
});
