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
 * Личный блокнот менеджера (модуль `notes`) — HTTP-интеграция на реальной
 * MongoDB replica set. Тот же стиль, что tasks.integration-spec.ts.
 */
describe('CRM Notes — HTTP Integration (AppModule)', () => {
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
    await connection.collection('notes').deleteMany({});
    await connection.collection('leads').deleteMany({});
    await connection.collection('contacts').deleteMany({});
    await connection.collection('media_assets').deleteMany({});
    await connection.collection('positions').deleteMany({});
    await connection.collection('position_assignments').deleteMany({});
    await connection.collection('organizations').deleteMany({});
    await connection.collection('permission_grants').deleteMany({});
    await connection.collection('identities').deleteMany({});
    await connection.collection('sessions').deleteMany({});
    await connection.collection('product_accesses').deleteMany({});
  });

  const PASSWORD = 'correct horse battery staple';

  async function seedOwnerSession(): Promise<{
    cookie: string;
    organizationId: Types.ObjectId;
    positionId: Types.ObjectId;
    identityId: Types.ObjectId;
  }> {
    const login = `owner-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const { organizationId, positionId } = await organizationsService.createOrganizationWithOwner({
      type: 'agency',
      name: 'Интеграционное агентство',
      ownerIdentityId: identityId,
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, organizationId, positionId, identityId };
  }

  async function seedPositionSession(
    organizationId: Types.ObjectId,
    fixedRole: FixedRole,
  ): Promise<{ cookie: string; positionId: Types.ObjectId; identityId: Types.ObjectId }> {
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
    return { cookie: `baza_session=${session.sessionToken}`, positionId, identityId };
  }

  async function seedContact(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const contactId = new Types.ObjectId();
    await connection.collection('contacts').insertOne({
      _id: contactId,
      organizationId,
      name: 'Петр Клиент',
      phone: '+79991112233',
      roles: ['buyer'],
      createdAt: new Date(),
    });
    return contactId;
  }

  async function seedLead(organizationId: Types.ObjectId, contactId: Types.ObjectId): Promise<Types.ObjectId> {
    const leadId = new Types.ObjectId();
    await connection.collection('leads').insertOne({
      _id: leadId,
      organizationId,
      contactId,
      stage: 'new',
      version: 0,
      source: { route: '/developments/test' },
      createdAt: new Date(),
    });
    return leadId;
  }

  async function seedAsset(organizationId: Types.ObjectId, status: 'verified' | 'pending'): Promise<Types.ObjectId> {
    const assetId = new Types.ObjectId();
    await connection.collection('media_assets').insertOne({
      _id: assetId,
      ownerScope: { type: 'organization', organizationId },
      status,
      declaredMimeType: 'application/pdf',
      sizeBytes: 1000,
      bucket: 'private',
      originalPath: `${assetId.toString()}/original.pdf`,
      variants: [],
      purpose: 'note_attachment',
      createdAt: new Date(),
    });
    return assetId;
  }

  async function seedNote(
    organizationId: Types.ObjectId,
    authorPositionId: Types.ObjectId,
    overrides?: { title?: string; leadId?: Types.ObjectId },
  ): Promise<Types.ObjectId> {
    const noteId = new Types.ObjectId();
    await connection.collection('notes').insertOne({
      _id: noteId,
      organizationId,
      authorPositionId,
      title: overrides?.title ?? 'Заметка',
      content: '',
      isPinned: false,
      category: 'personal',
      leadId: overrides?.leadId,
      attachments: [],
      version: 0,
      createdAt: new Date(),
    });
    return noteId;
  }

  describe('Authentication guard', () => {
    it('GET /notes without cookie returns 401 AUTH_NO_SESSION', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/notes' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe('AUTH_NO_SESSION');
    });

    it('POST /notes without cookie returns 401 AUTH_NO_SESSION', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { 'idempotency-key': new Types.ObjectId().toString() },
        payload: { title: 'x' },
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe('AUTH_NO_SESSION');
    });
  });

  describe('POST /notes — создание', () => {
    it('без Idempotency-Key — 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const { cookie } = await seedOwnerSession();

      const res = await app.inject({ method: 'POST', url: '/api/v1/notes', headers: { cookie }, payload: { title: 'x' } });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('создаёт заметку с дефолтами (content, isPinned, category)', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Позвонить клиенту' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('Позвонить клиенту');
      expect(body.content).toBe('');
      expect(body.isPinned).toBe(false);
      expect(body.category).toBe('personal');
      expect(body.leadId).toBeNull();
      expect(body.attachments).toEqual([]);
      expect(body.version).toBe(0);
      expect(body.organizationId).toBe(organizationId.toString());
      expect(body.authorPositionId).toBe(positionId.toString());
      expect(typeof body.updatedAt).toBe('string');
    });

    it('привязка к своему лиду — успех', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'С лидом', leadId: leadId.toString() },
      });

      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).leadId).toBe(leadId.toString());
    });

    it('привязка к лиду чужой организации — 404', async () => {
      const { cookie } = await seedOwnerSession();
      const foreignOrg = await seedOwnerSession();
      const foreignContactId = await seedContact(foreignOrg.organizationId);
      const foreignLeadId = await seedLead(foreignOrg.organizationId, foreignContactId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'x', leadId: foreignLeadId.toString() },
      });

      expect(res.statusCode).toBe(404);
    });

    it('роль без lead.read (marketer) не может привязать лид — 403', async () => {
      const { organizationId } = await seedOwnerSession();
      const marketer = await seedPositionSession(organizationId, 'marketer');
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie: marketer.cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'x', leadId: leadId.toString() },
      });

      expect(res.statusCode).toBe(403);
    });

    it('вложение — подтверждённый asset организации, имя выводится в модель чтения', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const assetId = await seedAsset(organizationId, 'verified');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'С вложением', attachments: [{ assetId: assetId.toString(), fileName: 'договор.pdf' }] },
      });

      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).attachments).toEqual([{ assetId: assetId.toString(), fileName: 'договор.pdf' }]);
    });

    it('неподтверждённое вложение — 400', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const assetId = await seedAsset(organizationId, 'pending');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'x', attachments: [{ assetId: assetId.toString(), fileName: 'a.pdf' }] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('вложение чужой организации — 404', async () => {
      const { cookie } = await seedOwnerSession();
      const foreignAssetId = await seedAsset(new Types.ObjectId(), 'verified');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'x', attachments: [{ assetId: foreignAssetId.toString(), fileName: 'a.pdf' }] },
      });

      expect(res.statusCode).toBe(404);
    });

    it('больше 10 вложений — 400', async () => {
      const { cookie } = await seedOwnerSession();
      const attachments = Array.from({ length: 11 }, () => ({
        assetId: new Types.ObjectId().toString(),
        fileName: 'a.pdf',
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'x', attachments },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /notes & GET /notes/:noteId — изоляция и пагинация', () => {
    it('видит только свои заметки, newest-first, cursor pagination', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const note1 = await seedNote(organizationId, positionId, { title: 'Первая' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const note2 = await seedNote(organizationId, positionId, { title: 'Вторая' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/notes?limit=1', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].id).toBe(note2.toString());
      expect(data.nextCursor).not.toBeNull();

      const res2 = await app.inject({
        method: 'GET',
        url: `/api/v1/notes?limit=1&cursor=${data.nextCursor}`,
        headers: { cookie },
      });
      const data2 = JSON.parse(res2.body);
      expect(data2.items).toHaveLength(1);
      expect(data2.items[0].id).toBe(note1.toString());
      expect(data2.nextCursor).toBeNull();
    });

    it('другая позиция той же организации не видит чужую заметку в списке', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager1 = await seedPositionSession(organizationId, 'manager');
      const manager2 = await seedPositionSession(organizationId, 'manager');
      await seedNote(organizationId, manager2.positionId, { title: 'Заметка менеджера 2' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/notes', headers: { cookie: manager1.cookie } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).items).toEqual([]);
    });

    it('owner (организационная роль) не видит заметку менеджера — 404 на прямое чтение, даже не в списке организации', async () => {
      const { cookie: ownerCookie, organizationId } = await seedOwnerSession();
      const manager = await seedPositionSession(organizationId, 'manager');
      const managerNoteId = await seedNote(organizationId, manager.positionId);

      const listRes = await app.inject({ method: 'GET', url: '/api/v1/notes', headers: { cookie: ownerCookie } });
      expect(JSON.parse(listRes.body).items).toEqual([]);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/notes/${managerNoteId.toString()}`,
        headers: { cookie: ownerCookie },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('чужая организация — 404', async () => {
      const orgA = await seedOwnerSession();
      const orgB = await seedOwnerSession();
      const noteBId = await seedNote(orgB.organizationId, orgB.positionId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/notes/${noteBId.toString()}`,
        headers: { cookie: orgA.cookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('leadId фильтр сужает список', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);
      await seedNote(organizationId, positionId, { title: 'Без лида' });
      const withLead = await seedNote(organizationId, positionId, { title: 'С лидом', leadId });

      const res = await app.inject({ method: 'GET', url: `/api/v1/notes?leadId=${leadId.toString()}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const items = JSON.parse(res.body).items as Array<{ id: string }>;
      expect(items.map((item) => item.id)).toEqual([withLead.toString()]);
    });
  });

  describe('PATCH /notes/:noteId — CAS-обновление', () => {
    it('обновляет поля и инкрементирует version', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const noteId = await seedNote(organizationId, positionId, { title: 'Старое' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notes/${noteId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, title: 'Новое', content: 'Текст', isPinned: true, category: 'work' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('Новое');
      expect(body.content).toBe('Текст');
      expect(body.isPinned).toBe(true);
      expect(body.category).toBe('work');
      expect(body.version).toBe(1);
    });

    it('устаревший expectedVersion — 409, документ не меняется', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const noteId = await seedNote(organizationId, positionId, { title: 'Исходное' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notes/${noteId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 99, title: 'Не применится' },
      });

      expect(res.statusCode).toBe(409);
      const doc = await connection.collection('notes').findOne({ _id: noteId });
      expect(doc?.title).toBe('Исходное');
    });

    it('чужая заметка (другая позиция той же организации) — 404', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager1 = await seedPositionSession(organizationId, 'manager');
      const manager2 = await seedPositionSession(organizationId, 'manager');
      const noteId = await seedNote(organizationId, manager2.positionId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notes/${noteId.toString()}`,
        headers: { cookie: manager1.cookie },
        payload: { expectedVersion: 0, title: 'Попытка чужой правки' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('leadId:null отвязывает лид', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);
      const noteId = await seedNote(organizationId, positionId, { leadId });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notes/${noteId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, leadId: null },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).leadId).toBeNull();
    });
  });

  describe('DELETE /notes/:noteId', () => {
    it('удаляет свою заметку, повтор — 404', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const noteId = await seedNote(organizationId, positionId);

      const res = await app.inject({ method: 'DELETE', url: `/api/v1/notes/${noteId.toString()}`, headers: { cookie } });
      expect(res.statusCode).toBe(204);

      const repeat = await app.inject({ method: 'DELETE', url: `/api/v1/notes/${noteId.toString()}`, headers: { cookie } });
      expect(repeat.statusCode).toBe(404);
    });

    it('чужая заметка — 404, не удаляется', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager1 = await seedPositionSession(organizationId, 'manager');
      const manager2 = await seedPositionSession(organizationId, 'manager');
      const noteId = await seedNote(organizationId, manager2.positionId);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notes/${noteId.toString()}`,
        headers: { cookie: manager1.cookie },
      });
      expect(res.statusCode).toBe(404);

      const doc = await connection.collection('notes').findOne({ _id: noteId });
      expect(doc).not.toBeNull();
    });
  });

  describe('GET /notes/:noteId/attachments/:assetId/download', () => {
    async function createNoteWithAttachment(cookie: string, organizationId: Types.ObjectId) {
      const assetId = await seedAsset(organizationId, 'verified');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'С вложением', attachments: [{ assetId: assetId.toString(), fileName: 'договор.pdf' }] },
      });
      expect(res.statusCode).toBe(201);
      const noteId = (JSON.parse(res.body) as { id: string }).id;
      return { noteId, assetId };
    }

    it('отдаёт подписанную ссылку и имя файла для настоящего вложения', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const { noteId, assetId } = await createNoteWithAttachment(cookie, organizationId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/notes/${noteId}/attachments/${assetId.toString()}/download`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { url: string; fileName: string };
      expect(body.fileName).toBe('договор.pdf');
      expect(typeof body.url).toBe('string');
      expect(body.url.length).toBeGreaterThan(0);
    });

    it('assetId, не входящий во вложения этой заметки, — 404', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const { noteId } = await createNoteWithAttachment(cookie, organizationId);
      const otherAssetId = await seedAsset(organizationId, 'verified');

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/notes/${noteId}/attachments/${otherAssetId.toString()}/download`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(404);
    });

    it('чужая заметка — 404', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager1 = await seedPositionSession(organizationId, 'manager');
      const manager2 = await seedPositionSession(organizationId, 'manager');
      const { assetId } = await createNoteWithAttachment(manager2.cookie, organizationId);
      const noteId = await seedNote(organizationId, manager2.positionId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/notes/${noteId.toString()}/attachments/${assetId.toString()}/download`,
        headers: { cookie: manager1.cookie },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
