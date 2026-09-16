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
import { AdminAccountService } from '../../src/modules/admin/admin-account.service';
import type { AdminContext } from '../../src/shared/admin/admin-context';
import type { FixedRole } from '../../src/modules/organizations/schemas/position.schema';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * Лента новостей (модуль `news`) — HTTP-интеграция на реальной MongoDB
 * replica set: новости компании видит только своя организация, новости
 * платформы из админки — все; права руководителя, сотрудника и
 * администратора; идемпотентность публикации.
 */
const NOTIFY_ENV: Record<string, string> = {
  SMTP_HOST: 'smtp.example.test',
  MAIL_FROM: 'BAZA <news@example.test>',
  TELEGRAM_NOTIFY_BOT_TOKEN: '123:test',
  TELEGRAM_NOTIFY_BOT_USERNAME: 'baza_notify_test_bot',
};
const previousEnv: Record<string, string | undefined> = {};

describe('News — HTTP Integration (AppModule)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let authService: AuthService;
  let organizationsService: OrganizationsService;
  let adminAccountService: AdminAccountService;

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
    process.env.MINIO_PUBLIC_BASE_URL ??= 'https://cdn.example.test/baza-public';
    // Каналы рассылки «настроены»: API только ставит доставки в очередь, писем в тесте никто не шлёт.
    for (const [key, value] of Object.entries(NOTIFY_ENV)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }

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
    adminAccountService = moduleRef.get(AdminAccountService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterEach(async () => {
    for (const name of [
      'news_articles',
      'media_assets',
      'notification_deliveries',
      'notification_settings',
      'telegram_link_codes',
      'outbox_events',
      'idempotency_records',
      'admin_accounts',
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
  const superAdminContext = (): AdminContext => ({
    identityId: new Types.ObjectId().toString(),
    adminAccountId: new Types.ObjectId().toString(),
    isSuperAdmin: true,
  });

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

  async function seedPositionSession(organizationId: Types.ObjectId, fixedRole: FixedRole): Promise<{ cookie: string }> {
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
    return { cookie: `baza_session=${session.sessionToken}` };
  }

  async function seedAdmin(isSuperAdmin: boolean): Promise<{ cookie: string; adminAccountId: Types.ObjectId }> {
    const login = `admin-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const account = await adminAccountService.createAdminAccount(superAdminContext(), {
      identityId,
      isSuperAdmin,
      correlationId: 'http-integration-test',
      idempotency: {
        actorIdentityId: new Types.ObjectId(),
        key: new Types.ObjectId().toString(),
        requestBody: { probe: new Types.ObjectId().toString() },
      },
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'admin' });
    return { cookie: `baza_session=${session.sessionToken}`, adminAccountId: account._id };
  }

  const article = { title: 'Новый регламент по лидам', body: 'Квалификация за 30 минут', category: 'company' };

  function post(url: string, cookie: string, payload: Record<string, unknown>, key = new Types.ObjectId().toString()) {
    return app.inject({ method: 'POST', url, headers: { cookie, 'idempotency-key': key }, payload });
  }

  function feed(cookie: string) {
    return app.inject({ method: 'GET', url: '/api/v1/news', headers: { cookie } });
  }

  it('без сессии — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/news' })).statusCode).toBe(401);
  });

  it('директор публикует новость компании: видят свои сотрудники, не видит чужая организация; повтор ключа не дублирует', async () => {
    const owner = await seedOwnerSession();
    const director = await seedPositionSession(owner.organizationId, 'director');
    const manager = await seedPositionSession(owner.organizationId, 'manager');
    const stranger = await seedOwnerSession();

    const created = await post('/api/v1/news', director.cookie, { ...article, pinned: true }, 'news-key-1');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(
      expect.objectContaining({ source: 'organization', pinned: true, authorName: 'Интеграционный director', linkUrl: null }),
    );
    const replay = await post('/api/v1/news', director.cookie, { ...article, pinned: true }, 'news-key-1');
    expect(replay.json().id).toBe(created.json().id);
    expect(await connection.collection('news_articles').countDocuments({})).toBe(1);

    const managerFeed = await feed(manager.cookie);
    expect(managerFeed.statusCode).toBe(200);
    expect(managerFeed.json()).toEqual({
      items: [expect.objectContaining({ id: created.json().id, delivery: null })],
      canPublish: false,
      channels: { email: true, telegram: true },
    });
    expect((await feed(director.cookie)).json().canPublish).toBe(true);
    expect((await feed(stranger.cookie)).json().items).toEqual([]);

    expect((await post('/api/v1/news', manager.cookie, article)).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/news/${created.json().id}`, headers: { cookie: stranger.cookie } }))
        .statusCode,
    ).toBe(404);
  });

  it('ссылка только http(s): javascript: — 400', async () => {
    const owner = await seedOwnerSession();
    const res = await post('/api/v1/news', owner.cookie, { ...article, linkUrl: 'javascript:alert(1)' });
    expect(res.statusCode).toBe(400);
  });

  it('новость платформы из админки видна всем организациям; из ERP её не удалить', async () => {
    const first = await seedOwnerSession();
    const second = await seedOwnerSession();
    const admin = await seedAdmin(true);

    const created = await post('/api/v1/admin/news', admin.cookie, {
      title: 'Обновление BAZA',
      body: 'В CRM появились планы сотрудников',
      category: 'market',
      linkUrl: 'https://baza.sale',
      linkLabel: 'Подробнее',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(expect.objectContaining({ source: 'platform', authorName: null, linkLabel: 'Подробнее' }));

    for (const cookie of [first.cookie, second.cookie]) {
      expect((await feed(cookie)).json().items).toEqual([expect.objectContaining({ id: created.json().id, source: 'platform' })]);
    }
    const adminList = await app.inject({ method: 'GET', url: '/api/v1/admin/news', headers: { cookie: admin.cookie } });
    expect(adminList.json().items).toHaveLength(1);

    const erpDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/news/${created.json().id}`,
      headers: { cookie: first.cookie },
    });
    expect(erpDelete.statusCode).toBe(404);

    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/news/${created.json().id}`,
      headers: { cookie: admin.cookie },
    });
    expect(adminDelete.statusCode).toBe(204);
    expect((await feed(first.cookie)).json().items).toEqual([]);
    expect(await connection.collection('audit_events').countDocuments({ action: { $in: ['news.publish', 'news.delete'] } })).toBe(2);
  });

  it('администратор без гранта news.publish — 403; с грантом — может', async () => {
    const admin = await seedAdmin(false);
    const list = () => app.inject({ method: 'GET', url: '/api/v1/admin/news', headers: { cookie: admin.cookie } });

    expect((await list()).statusCode).toBe(403);
    expect((await post('/api/v1/admin/news', admin.cookie, article)).statusCode).toBe(403);

    await adminAccountService.grantPermission(superAdminContext(), {
      adminAccountId: admin.adminAccountId,
      resource: 'news',
      action: 'publish',
      scope: 'global',
      correlationId: 'http-integration-test',
    });
    expect((await list()).statusCode).toBe(200);
    expect((await post('/api/v1/admin/news', admin.cookie, article)).statusCode).toBe(201);
  });

  function put(url: string, cookie: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'PUT', url, headers: { cookie }, payload });
  }

  it('правка: версия обязательна, чужая правка между чтением и сохранением — 409, новость платформы из ERP не править', async () => {
    const owner = await seedOwnerSession();
    const admin = await seedAdmin(true);
    const created = (await post('/api/v1/news', owner.cookie, article)).json();

    const edited = await put(`/api/v1/news/${created.id}`, owner.cookie, {
      ...article,
      title: 'Регламент по лидам, редакция 2',
      linkUrl: 'https://baza.sale/rules',
      expectedVersion: 0,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toEqual(
      expect.objectContaining({ title: 'Регламент по лидам, редакция 2', version: 1, linkUrl: 'https://baza.sale/rules' }),
    );
    expect(edited.json().editedAt).not.toBeNull();

    const stale = await put(`/api/v1/news/${created.id}`, owner.cookie, { ...article, expectedVersion: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');

    // Новость, опубликованная до появления поля version, правится с версией 0.
    const legacyId = new Types.ObjectId();
    await connection.collection('news_articles').insertOne({
      _id: legacyId,
      source: 'organization',
      organizationId: owner.organizationId,
      title: 'Старая новость',
      body: 'Без поля version',
      category: 'company',
      pinned: false,
      publishedAt: new Date(),
    });
    const legacyEdit = await put(`/api/v1/news/${legacyId.toString()}`, owner.cookie, { ...article, expectedVersion: 0 });
    expect(legacyEdit.statusCode).toBe(200);
    expect(legacyEdit.json().version).toBe(1);

    const platform = (await post('/api/v1/admin/news', admin.cookie, { ...article, category: 'market' })).json();
    expect((await put(`/api/v1/news/${platform.id}`, owner.cookie, { ...article, expectedVersion: 0 })).statusCode).toBe(404);
    expect((await put(`/api/v1/admin/news/${platform.id}`, admin.cookie, { ...article, expectedVersion: 0 })).statusCode).toBe(200);
    expect(await connection.collection('audit_events').countDocuments({ action: 'news.update' })).toBe(3);
  });

  it('картинка: своя подтверждённая news_image прикрепляется и попадает в ленту ссылкой, чужая — 404', async () => {
    const owner = await seedOwnerSession();
    const stranger = await seedOwnerSession();
    const asset = async (organizationId: Types.ObjectId, purpose = 'news_image') => {
      const _id = new Types.ObjectId();
      await connection.collection('media_assets').insertOne({
        _id,
        ownerScope: { type: 'organization', organizationId },
        status: 'verified',
        declaredMimeType: 'image/png',
        verifiedMimeType: 'image/png',
        sizeBytes: 1024,
        bucket: purpose === 'news_image' ? 'public' : 'private',
        originalPath: `${_id.toString()}/original.png`,
        variants: [],
        purpose,
        createdAt: new Date(),
      });
      return _id.toString();
    };

    const own = await asset(owner.organizationId);
    const expectedUrl = `${process.env.MINIO_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${own}/original.png`;
    const created = await post('/api/v1/news', owner.cookie, { ...article, imageAssetId: own });
    expect(created.statusCode).toBe(201);
    expect(created.json().imageUrl).toBe(expectedUrl);
    expect((await feed(owner.cookie)).json().items[0].imageUrl).toBe(expectedUrl);

    const foreign = await asset(stranger.organizationId);
    expect((await post('/api/v1/news', owner.cookie, { ...article, imageAssetId: foreign })).statusCode).toBe(404);
    const privateFile = await asset(owner.organizationId, 'library_file');
    expect((await post('/api/v1/news', owner.cookie, { ...article, imageAssetId: privateFile })).statusCode).toBe(400);
  });

  it('рассылка: письма ставятся сотрудникам с почтой кроме автора, событие уходит в outbox, автор видит сводку', async () => {
    const owner = await seedOwnerSession();
    const director = await seedPositionSession(owner.organizationId, 'director');
    await seedPositionSession(owner.organizationId, 'manager');
    const stranger = await seedOwnerSession();

    const created = await post('/api/v1/news', director.cookie, { ...article, sendEmail: true, sendTelegram: true });
    expect(created.statusCode).toBe(201);
    expect(created.json().delivery.email.pending).toBe(2);

    const deliveries = await connection.collection('notification_deliveries').find({ refId: new Types.ObjectId(created.json().id) }).toArray();
    // Владелец и менеджер — да; директор-автор — нет; чужая организация — нет; Telegram никто не привязал.
    expect(deliveries.map((d) => d.channel)).toEqual(['email', 'email']);
    expect(deliveries.every((d) => d.status === 'pending' && String(d.address).endsWith('@example.test'))).toBe(true);
    expect(deliveries[0]!.subject).toBe('Интеграционное агентство: Новый регламент по лидам');
    expect(await connection.collection('outbox_events').countDocuments({ eventType: 'NotificationDeliveriesQueued' })).toBe(1);

    const directorFeed = (await feed(director.cookie)).json();
    expect(directorFeed.channels).toEqual({ email: true, telegram: true });
    expect(directorFeed.items[0].delivery.email).toEqual({ pending: 2, sent: 0, failed: 0, skipped: 0 });
    expect((await feed(stranger.cookie)).json().items).toEqual([]);
  });

  it('настройки уведомлений: по умолчанию всё включено, выключение сохраняется, ссылка Telegram одноразовая', async () => {
    const owner = await seedOwnerSession();
    const me = () => app.inject({ method: 'GET', url: '/api/v1/me/notifications', headers: { cookie: owner.cookie } });

    const initial = (await me()).json();
    expect(initial.email).toEqual(expect.objectContaining({ news: true, configured: true }));
    expect(initial.email.address).toMatch(/@example\.test$/);
    expect(initial.telegram).toEqual({ linked: false, username: null, news: true, configured: true });

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/notifications',
      headers: { cookie: owner.cookie },
      payload: { newsEmail: false },
    });
    expect(updated.json().email.news).toBe(false);
    expect((await me()).json().telegram.news).toBe(true);

    const link = await app.inject({ method: 'POST', url: '/api/v1/me/notifications/telegram-link', headers: { cookie: owner.cookie } });
    expect(link.statusCode).toBe(201);
    expect(link.json().url).toMatch(/^https:\/\/t\.me\/baza_notify_test_bot\?start=[A-Za-z0-9_-]+$/);
    expect(await connection.collection('telegram_link_codes').countDocuments({})).toBe(1);
    await app.inject({ method: 'POST', url: '/api/v1/me/notifications/telegram-link', headers: { cookie: owner.cookie } });
    expect(await connection.collection('telegram_link_codes').countDocuments({})).toBe(1);

    expect((await app.inject({ method: 'GET', url: '/api/v1/me/notifications' })).statusCode).toBe(401);
  });
});
