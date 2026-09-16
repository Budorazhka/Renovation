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
});
