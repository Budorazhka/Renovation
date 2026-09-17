import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fastifyCookie from '@fastify/cookie';
import RedisMock from 'ioredis-mock';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/shared/errors/app-exception.filter';
import { CorrelationIdMiddleware } from '../../src/shared/errors/correlation-id.middleware';
import { SessionService } from '../../src/modules/identity/session.service';
import { AuthService } from '../../src/modules/identity/auth.service';
import { RedisService } from '../../src/shared/redis/redis.service';

const MARKETPLACE_ORIGIN = 'https://marketplace.test.local';
const ERP_ORIGIN = 'https://erp.test.local';
const ADMIN_ORIGIN = 'https://admin.test.local';

describe('GET /auth/session (real HTTP + MongoDB)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let sessionService: SessionService;
  let authService: AuthService;

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
    process.env.CORS_ALLOWED_ORIGIN_MARKETPLACE = MARKETPLACE_ORIGIN;
    process.env.CORS_ALLOWED_ORIGIN_ERP = ERP_ORIGIN;
    process.env.CORS_ALLOWED_ORIGIN_ADMIN = ADMIN_ORIGIN;

    // AppModule now wires the production RedisService for rate limiting and
    // idempotency. Keep this pure Mongo integration suite deterministic: an
    // unrelated Redis process on localhost must not affect its result (and a
    // missing REDIS_URL must not prevent the DI graph from booting).
    const redisMockClient = new RedisMock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue({ client: redisMockClient, onModuleDestroy: async () => {} })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRequest', async (req, reply) => app.get(CorrelationIdMiddleware).use(req, reply, () => {}));
    app.useGlobalFilters(new AppExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    await fastify.ready();

    connection = moduleRef.get<Connection>(getConnectionToken());
    sessionService = moduleRef.get(SessionService);
    authService = moduleRef.get(AuthService);
  }, 120_000);

  afterEach(async () => {
    await connection.collection('sessions').deleteMany({});
    await connection.collection('identities').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  async function createSession(productAudience: 'marketplace' | 'erp' | 'admin') {
    const identityId = new Types.ObjectId();
    const created = await sessionService.createSession({ identityId, productAudience });
    return { identityId, token: created.token };
  }

  it('returns unauthenticated without a cookie and does not create a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { origin: MARKETPLACE_ORIGIN } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
    expect(await connection.collection('sessions').countDocuments()).toBe(0);
  });

  it.each([
    ['marketplace', MARKETPLACE_ORIGIN],
    ['erp', ERP_ORIGIN],
    ['admin', ADMIN_ORIGIN],
  ] as const)('recognizes an active %s session only for its matching audience origin', async (audience, origin) => {
    const session = await createSession(audience);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { origin, cookie: `baza_session=${session.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true });
    expect(response.body).not.toContain(session.identityId.toString());
  });

  it('does not disclose a session when the cookie audience and origin do not match', async () => {
    const session = await createSession('marketplace');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { origin: ERP_ORIGIN, cookie: `baza_session=${session.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });

  it('returns unauthenticated after revoke and for an expired session', async () => {
    const revoked = await createSession('marketplace');
    await sessionService.revokeSession(revoked.token);
    const revokedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { origin: MARKETPLACE_ORIGIN, cookie: `baza_session=${revoked.token}` },
    });
    expect(revokedResponse.json()).toEqual({ authenticated: false });

    const expired = await createSession('marketplace');
    await connection.collection('sessions').updateOne({ identityId: expired.identityId }, { $set: { expiresAt: new Date(0) } });
    const expiredResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { origin: MARKETPLACE_ORIGIN, cookie: `baza_session=${expired.token}` },
    });
    expect(expiredResponse.json()).toEqual({ authenticated: false });
  });

  it('keeps origin validation explicit for this endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_AUDIENCE_MISMATCH');
  });

  describe('POST /auth/change-password', () => {
    const PASSWORD = 'correct horse battery staple';

    async function seedSignedIn() {
      const login = `owner-${new Types.ObjectId().toString()}@example.test`;
      const identityId = await authService.registerIdentity({ login, password: PASSWORD });
      const current = await sessionService.createSession({ identityId, productAudience: 'marketplace' });
      const other = await sessionService.createSession({ identityId, productAudience: 'marketplace' });
      return { login, identityId, current, other };
    }

    function changePassword(cookie: string | undefined, payload: Record<string, unknown>) {
      return app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { origin: MARKETPLACE_ORIGIN, ...(cookie ? { cookie } : {}) },
        payload,
      });
    }

    it('меняет пароль, закрывает прочие сессии и оставляет текущую', async () => {
      const { login, current, other } = await seedSignedIn();

      const response = await changePassword(`baza_session=${current.token}`, {
        currentPassword: PASSWORD,
        newPassword: 'new-password-2026',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ changed: true, revokedSessions: 1 });

      const stillIn = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { origin: MARKETPLACE_ORIGIN, cookie: `baza_session=${current.token}` },
      });
      expect(stillIn.json()).toEqual({ authenticated: true });

      const revoked = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { origin: MARKETPLACE_ORIGIN, cookie: `baza_session=${other.token}` },
      });
      expect(revoked.json()).toEqual({ authenticated: false });

      await expect(authService.login({ login, password: PASSWORD, audience: 'marketplace' })).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
      await expect(
        authService.login({ login, password: 'new-password-2026', audience: 'marketplace' }),
      ).resolves.toEqual(expect.objectContaining({ requires2fa: false }));
    });

    it('без сессии — 401, с неверным текущим паролем — 401, короткий новый — 400', async () => {
      const { current } = await seedSignedIn();

      const noSession = await changePassword(undefined, { currentPassword: PASSWORD, newPassword: 'new-password-2026' });
      expect(noSession.statusCode).toBe(401);
      expect(noSession.json().error.code).toBe('AUTH_NO_SESSION');

      const wrong = await changePassword(`baza_session=${current.token}`, {
        currentPassword: 'not-my-password',
        newPassword: 'new-password-2026',
      });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');

      const short = await changePassword(`baza_session=${current.token}`, { currentPassword: PASSWORD, newPassword: 'short' });
      expect(short.statusCode).toBe(400);
    });
  });

  describe('POST /auth/verify-password', () => {
    const PASSWORD = 'correct horse battery staple';

    async function seedSignedIn() {
      const login = `owner-${new Types.ObjectId().toString()}@example.test`;
      const identityId = await authService.registerIdentity({ login, password: PASSWORD });
      const current = await sessionService.createSession({ identityId, productAudience: 'marketplace' });
      return { login, identityId, current };
    }

    function verifyPassword(cookie: string | undefined, payload: Record<string, unknown>) {
      return app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-password',
        headers: { origin: MARKETPLACE_ORIGIN, ...(cookie ? { cookie } : {}) },
        payload,
      });
    }

    it('верный пароль — valid:true, сессия и пароль не меняются', async () => {
      const { login, current } = await seedSignedIn();

      const response = await verifyPassword(`baza_session=${current.token}`, { password: PASSWORD });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ valid: true });

      const stillIn = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { origin: MARKETPLACE_ORIGIN, cookie: `baza_session=${current.token}` },
      });
      expect(stillIn.json()).toEqual({ authenticated: true });

      await expect(authService.login({ login, password: PASSWORD, audience: 'marketplace' })).resolves.toEqual(
        expect.objectContaining({ requires2fa: false }),
      );
    });

    it('неверный пароль — valid:false, не 401', async () => {
      const { current } = await seedSignedIn();

      const response = await verifyPassword(`baza_session=${current.token}`, { password: 'not-my-password' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ valid: false });
    });

    it('без сессии — 401 AUTH_NO_SESSION', async () => {
      const response = await verifyPassword(undefined, { password: PASSWORD });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_NO_SESSION');
    });
  });

  describe('GET /auth/sessions + POST /auth/sessions/:id/revoke', () => {
    function listSessions(cookie: string | undefined) {
      return app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: { origin: ERP_ORIGIN, ...(cookie ? { cookie } : {}) },
      });
    }

    function revokeSession(cookie: string | undefined, sessionId: string) {
      return app.inject({
        method: 'POST',
        url: `/api/v1/auth/sessions/${sessionId}/revoke`,
        headers: { origin: ERP_ORIGIN, ...(cookie ? { cookie } : {}) },
      });
    }

    it('список показывает только сессии своего audience и помечает текущую current:true', async () => {
      const identityId = new Types.ObjectId();
      const current = await sessionService.createSession({ identityId, productAudience: 'erp' });
      await sessionService.createSession({ identityId, productAudience: 'erp' });
      await sessionService.createSession({ identityId, productAudience: 'marketplace' });

      const response = await listSessions(`baza_session=${current.token}`);

      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: Array<{ id: string; current: boolean }> };
      expect(body.items).toHaveLength(2);
      expect(body.items.filter((item) => item.current)).toHaveLength(1);
    });

    it('без cookie — 401', async () => {
      const response = await listSessions(undefined);

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_NO_SESSION');
    });

    it('отзыв чужой (по id, но identityId другой) сессии — 404, не 200', async () => {
      const owner = await sessionService.createSession({ identityId: new Types.ObjectId(), productAudience: 'erp' });
      const stranger = await sessionService.createSession({ identityId: new Types.ObjectId(), productAudience: 'erp' });
      const strangerSessionId = await resolveSessionId(stranger.token);

      const response = await revokeSession(`baza_session=${owner.token}`, strangerSessionId);

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('невалидный (не ObjectId) sessionId — 400, не 500', async () => {
      const identityId = new Types.ObjectId();
      const current = await sessionService.createSession({ identityId, productAudience: 'erp' });

      const response = await revokeSession(`baza_session=${current.token}`, 'not-an-object-id');

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('отзыв текущей сессии — 400, отклонён', async () => {
      const identityId = new Types.ObjectId();
      const current = await sessionService.createSession({ identityId, productAudience: 'erp' });
      const currentSessionId = await resolveSessionId(current.token);

      const response = await revokeSession(`baza_session=${current.token}`, currentSessionId);

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('после отзыва сессия пропадает из списка и GET /auth/session для её токена возвращает authenticated:false', async () => {
      const identityId = new Types.ObjectId();
      const current = await sessionService.createSession({ identityId, productAudience: 'erp' });
      const other = await sessionService.createSession({ identityId, productAudience: 'erp' });
      const otherSessionId = await resolveSessionId(other.token);

      const revokeResponse = await revokeSession(`baza_session=${current.token}`, otherSessionId);
      expect(revokeResponse.statusCode).toBe(200);
      expect(revokeResponse.json()).toEqual({ revoked: true });

      const afterList = await listSessions(`baza_session=${current.token}`);
      const afterIds = (afterList.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
      expect(afterIds).not.toContain(otherSessionId);

      const sessionCheck = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { origin: ERP_ORIGIN, cookie: `baza_session=${other.token}` },
      });
      expect(sessionCheck.json()).toEqual({ authenticated: false });
    });

    async function resolveSessionId(token: string): Promise<string> {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const doc = await connection.collection('sessions').findOne({ tokenHash });
      return doc!._id.toString();
    }
  });
});
