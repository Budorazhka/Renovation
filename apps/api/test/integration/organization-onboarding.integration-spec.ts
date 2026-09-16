import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/shared/errors/app-exception.filter';
import { CorrelationIdMiddleware } from '../../src/shared/errors/correlation-id.middleware';
import { TenantContextMiddleware } from '../../src/shared/tenant/tenant-context.middleware';
import { AdminContextMiddleware } from '../../src/shared/admin/admin-context.middleware';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * POST /organizations/register — реальный сетевой HTTP-путь через
 * app.inject() (Fastify, тот же адаптер, что main.api.ts), не unit-мок.
 *
 * Закрывает найденный E2E-прогоном D-07 gap: OrganizationsService.
 * createOrganizationWithOwner раньше вызывался ТОЛЬКО из unit-тестов, не
 * было ни одного HTTP-пути создать организацию — тест воспроизводит полный
 * реальный flow нового пользователя: POST /auth/register (Identity без
 * организации) → POST /organizations/register (org+owner+сессия) →
 * защищённый ERP-запрос той же cookie, что вернул register (доказывает, что
 * TenantGuard реально резолвит созданный tenant context, не просто что
 * запись появилась в MongoDB).
 *
 * Полный AppModule (не только OrganizationsModule) — тот же подход, что
 * publish-idempotency-race.integration-spec.ts: register проходит через
 * реальные onRequest hooks (TenantContextMiddleware/AdminContextMiddleware/
 * CorrelationIdMiddleware — NestMiddleware не долетает до Guards на
 * FastifyAdapter, GitHub issue nestjs/nest#8837), плюс нужен полный DI-граф
 * для последующего /team-users/ensure-self через TenantGuard+PermissionGuard.
 */
describe('POST /organizations/register — organization onboarding (real HTTP flow)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;

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
    fastifyInstance.addHook('onRequest', async (req, reply) => {
      await correlationIdMiddleware.use(req, reply, () => {});
    });
    fastifyInstance.addHook('onRequest', async (req, reply) => {
      await tenantContextMiddleware.use(req, reply, () => {});
    });
    fastifyInstance.addHook('onRequest', async (req, reply) => {
      await adminContextMiddleware.use(req, reply, () => {});
    });

    app.useGlobalFilters(new AppExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    connection = moduleRef.get<Connection>(getConnectionToken());
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('identities').deleteMany({});
    await connection.collection('organizations').deleteMany({});
    await connection.collection('positions').deleteMany({});
    await connection.collection('position_assignments').deleteMany({});
    await connection.collection('product_accesses').deleteMany({});
    await connection.collection('permission_grants').deleteMany({});
    await connection.collection('sessions').deleteMany({});
  });

  function extractSessionCookie(response: { headers: Record<string, unknown> }): string {
    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string') throw new Error('No set-cookie header in response');
    const match = header.match(/baza_session=[^;]+/);
    if (!match) throw new Error(`set-cookie header did not contain baza_session: ${header}`);
    return match[0];
  }

  it('developer-организация: register → login-free session cookie → fixedRole:developer → реальный ERP-запрос проходит TenantGuard', async () => {
    const login = `dev-owner-${new Types.ObjectId().toString()}@example.test`;
    const password = 'correct horse battery staple';

    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { login, password },
    });
    expect(registerRes.statusCode).toBe(201);
    const { identityId } = registerRes.json();
    expect(identityId).toBeTruthy();

    const orgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password, type: 'developer', name: 'E2E Developer Org' },
    });

    expect(orgRes.statusCode).toBe(201);
    const body = orgRes.json();
    expect(body.organizationId).toBeTruthy();
    expect(body.positionId).toBeTruthy();
    expect(body.identityId).toBe(identityId);

    // Согласованная роль (ADR-016): developer-организация получает owner-позицию
    // с fixedRole:'developer', не 'owner' — иначе dashboard-rail.tsx (фронтенд)
    // не пустит реального владельца в раздел «Девелопмент».
    const positionDoc = await connection.collection('positions').findOne({ _id: new Types.ObjectId(body.positionId) });
    expect(positionDoc?.fixedRole).toBe('developer');

    // Default grants реально созданы для fixedRole:'developer' (не пустой набор).
    const grantsCount = await connection
      .collection('permission_grants')
      .countDocuments({ subjectId: new Types.ObjectId(body.positionId) });
    expect(grantsCount).toBeGreaterThan(0);
    const hasDevelopmentEdit = await connection.collection('permission_grants').findOne({
      subjectId: new Types.ObjectId(body.positionId),
      resource: 'development',
      action: 'edit',
    });
    expect(hasDevelopmentEdit).toBeTruthy();

    // register уже вернул рабочую сессию — не нужен отдельный POST /auth/login.
    const cookie = extractSessionCookie(orgRes);

    const ensureSelfRes = await app.inject({
      method: 'POST',
      url: '/api/v1/team-users/ensure-self',
      headers: { cookie },
    });
    expect(ensureSelfRes.statusCode).toBe(201);
    const ensureSelfBody = ensureSelfRes.json();
    expect(ensureSelfBody.data.role).toBe('developer');
    expect(ensureSelfBody.data.teamId).toBe(body.organizationId);
  });

  it('agency-организация: register → fixedRole:owner (поведение до фикса не изменилось)', async () => {
    const login = `agency-owner-${Date.now()}@example.test`;
    const password = 'correct horse battery staple';

    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login, password } });

    const orgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password, type: 'agency', name: 'E2E Agency' },
    });

    expect(orgRes.statusCode).toBe(201);
    const body = orgRes.json();
    const positionDoc = await connection
      .collection('positions')
      .findOne({ _id: new Types.ObjectId(body.positionId) });
    expect(positionDoc?.fixedRole).toBe('owner');
  });

  it('имя владельца из регистрации — в команде; без имени независимый риэлтор виден по названию организации, а не «Owner»', async () => {
    const password = 'correct horse battery staple';

    async function registerOwner(type: string, name: string, ownerName?: string) {
      const login = `named-owner-${new Types.ObjectId().toString()}@example.test`;
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login, password } });
      const orgRes = await app.inject({
        method: 'POST',
        url: '/api/v1/organizations/register',
        payload: { login, password, type, name, ...(ownerName ? { ownerName } : {}) },
      });
      expect(orgRes.statusCode).toBe(201);
      const self = await app.inject({
        method: 'POST',
        url: '/api/v1/team-users/ensure-self',
        headers: { cookie: extractSessionCookie(orgRes) },
      });
      return self.json().data.name as string;
    }

    expect(await registerOwner('agency', 'Агентство Batumi Home', 'Лаша Гогиберидзе')).toBe('Лаша Гогиберидзе');
    expect(await registerOwner('independent_realtor', 'Нино Беридзе')).toBe('Нино Беридзе');
    // Старое поведение для агентства без имени не ломается: заглушка остаётся, пока владелец её не сменит.
    expect(await registerOwner('agency', 'Агентство без имени')).toBe('Owner');
  });

  it('неверный пароль — AUTH_INVALID_CREDENTIALS, организация не создаётся', async () => {
    const login = `wrong-pw-${Date.now()}@example.test`;
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login, password: 'correct horse battery staple' } });

    const orgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password: 'wrong password entirely', type: 'developer', name: 'Should Not Exist' },
    });

    expect(orgRes.statusCode).toBe(401);
    const orgCount = await connection.collection('organizations').countDocuments({ name: 'Should Not Exist' });
    expect(orgCount).toBe(0);
  });

  it('повторная регистрация организации той же уже-организованной identity — ConflictException, вторая организация не создаётся', async () => {
    const login = `double-register-${Date.now()}@example.test`;
    const password = 'correct horse battery staple';
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login, password } });

    const firstRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password, type: 'developer', name: 'First Org' },
    });
    expect(firstRes.statusCode).toBe(201);

    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password, type: 'agency', name: 'Second Org — should be rejected' },
    });
    expect(secondRes.statusCode).toBe(409);

    const secondOrgCount = await connection.collection('organizations').countDocuments({ name: 'Second Org — should be rejected' });
    expect(secondOrgCount).toBe(0);
  });
});
