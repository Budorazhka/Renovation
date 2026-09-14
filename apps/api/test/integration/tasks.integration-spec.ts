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
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * CRM-003: Backend vertical slice CRM tasks / Next Action.
 * Full Fastify HTTP integration test against real MongoDB replica set.
 */
describe('CRM Tasks / Next Action — HTTP Integration (AppModule)', () => {
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
    await connection.collection('tasks').deleteMany({});
    await connection.collection('leads').deleteMany({});
    await connection.collection('lead_events').deleteMany({});
    await connection.collection('contacts').deleteMany({});
    await connection.collection('positions').deleteMany({});
    await connection.collection('position_assignments').deleteMany({});
    await connection.collection('organizations').deleteMany({});
    await connection.collection('audit_events').deleteMany({});
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

  async function seedManagerSession(
    organizationId: Types.ObjectId,
  ): Promise<{ cookie: string; positionId: Types.ObjectId; identityId: Types.ObjectId }> {
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
      correlationId: 'http-integration-test-seed',
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, positionId, identityId };
  }

  async function seedAdministratorSession(
    organizationId: Types.ObjectId,
  ): Promise<{ cookie: string; positionId: Types.ObjectId; identityId: Types.ObjectId }> {
    const login = `administrator-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'administrator' });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: 'Интеграционный администратор',
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

  /**
   * version:0 обязателен — прямая вставка через native driver (не Mongoose)
   * не применяет schema default:0 автоматически, а PATCH/complete/reassign
   * фильтруют по version:expectedVersion атомарно (без $exists-fallback,
   * см. TaskRepository.updateTask докстринг — Task новая схема, легаси-
   * документов без version не существует, значит тест не должен их
   * симулировать без явного version:0).
   */
  async function seedTask(
    organizationId: Types.ObjectId,
    overrides?: {
      title?: string;
      status?: string;
      assignedPositionId?: Types.ObjectId;
      leadId?: Types.ObjectId;
      taskCategory?: 'work' | 'personal';
    },
  ): Promise<Types.ObjectId> {
    const taskId = new Types.ObjectId();
    await connection.collection('tasks').insertOne({
      _id: taskId,
      organizationId,
      title: overrides?.title ?? 'Задача',
      status: overrides?.status ?? 'open',
      assignedPositionId: overrides?.assignedPositionId,
      leadId: overrides?.leadId,
      taskCategory: overrides?.taskCategory ?? 'work',
      version: 0,
      createdAt: new Date(),
    });
    return taskId;
  }

  describe('Authentication & Authorization Guards', () => {
    it('GET /tasks without cookie returns 401 AUTH_NO_SESSION', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/tasks' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe('AUTH_NO_SESSION');
    });

    it('POST /tasks without cookie returns 401 AUTH_NO_SESSION', async () => {
      const res = await app.inject({ headers: { 'idempotency-key': new Types.ObjectId().toString() },
        method: 'POST',
        url: '/api/v1/tasks',
        payload: { title: 'Call client' },
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe('AUTH_NO_SESSION');
    });
  });

  describe('POST /tasks — Task creation, Lead/Contact linkage, Audit', () => {
    it('creates task with automatic contactId linkage from lead and writes audit_events', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie },
        payload: {
          title: 'Подготовить презентацию ЖК',
          description: 'Отправить подборку квартир на WhatsApp',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          assignedPositionId: positionId.toString(),
          leadId: leadId.toString(),
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('Подготовить презентацию ЖК');
      expect(body.description).toBe('Отправить подборку квартир на WhatsApp');
      expect(body.status).toBe('open');
      expect(body.assignedPositionId).toBe(positionId.toString());
      expect(body.leadId).toBe(leadId.toString());
      expect(body.contactId).toBe(contactId.toString()); // Auto-populated from lead!

      // Check audit event
      const audit = await connection.collection('audit_events').findOne({
        action: 'task.create',
        resource: 'task',
        resourceId: new Types.ObjectId(body.id),
      });
      expect(audit).not.toBeNull();
      expect(audit?.after?.title).toBe('Подготовить презентацию ЖК');
    });

    it('провенанс не принимается от клиента: isAutomatic в теле — 400, а не «автозадача»', async () => {
      const { cookie } = await seedOwnerSession();

      // Каждое поле отдельным запросом: вместе они прятали бы друг друга —
      // 400 от одного маскировал бы принятие другого.
      for (const payload of [
        { title: 'Подделка автозадачи', isAutomatic: true },
        { title: 'Подделка правила', triggerType: 'new_lead_sla' },
      ]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/tasks',
          headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
          payload,
        });

        // forbidNonWhitelisted: поле вне DTO — ошибка, а не молчаливый пропуск.
        expect(res.statusCode).toBe(400);
      }
    });

    it('приоритет хранится парой признаков и отдаётся квадрантом', async () => {
      const { cookie } = await seedOwnerSession();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Срочно, не важно', isUrgent: true, isImportant: false },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.isUrgent).toBe(true);
      expect(body.isImportant).toBe(false);
      expect(body.priority).toBe('high');

      // Старой порядковой шкалы в контракте больше нет.
      const legacy = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Старое поле', priority: 'high' },
      });
      expect(legacy.statusCode).toBe(400);
    });

    it('связь с лидом отдаётся одной парой, выведенной из leadId', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Перезвонить', leadId: leadId.toString() },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.entityType).toBe('lead');
      expect(body.entityId).toBe(leadId.toString());
    });

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
        purpose: 'task_attachment',
        createdAt: new Date(),
      });
      return assetId;
    }

    it('вложение — ссылка на подтверждённый asset организации, имя выводится в модель чтения', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const assetId = await seedAsset(organizationId, 'verified');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Собрать документы', attachments: [{ assetId: assetId.toString(), fileName: 'договор.pdf' }] },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.attachments).toEqual([{ assetId: assetId.toString(), fileName: 'договор.pdf' }]);
      expect(body.attachmentFileNames).toEqual(['договор.pdf']);

      const stored = await connection.collection('tasks').findOne({ _id: new Types.ObjectId(body.id as string) });
      expect(stored?.attachments?.[0]?.assetId?.toString()).toBe(assetId.toString());
      // Имена больше не хранятся отдельным полем.
      expect(stored).not.toHaveProperty('attachmentFileNames');
    });

    it('неподтверждённый asset не принимается — обещание файла, которого ещё нет', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const assetId = await seedAsset(organizationId, 'pending');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Собрать документы', attachments: [{ assetId: assetId.toString(), fileName: 'договор.pdf' }] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('asset чужой организации не принимается — тот же 404, что для чужого лида', async () => {
      const { cookie } = await seedOwnerSession();
      const foreignAssetId = await seedAsset(new Types.ObjectId(), 'verified');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Чужой файл', attachments: [{ assetId: foreignAssetId.toString(), fileName: 'секрет.pdf' }] },
      });

      expect(res.statusCode).toBe(404);
    });

    it('имена файлов без файлов больше не принимаются', async () => {
      const { cookie } = await seedOwnerSession();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Демо-вложение', attachmentFileNames: ['договор.pdf'] },
      });

      expect(res.statusCode).toBe(400);
    });

    describe('GET /tasks/:taskId/attachments/:assetId/download', () => {
      async function createTaskWithAttachment(cookie: string, organizationId: Types.ObjectId) {
        const assetId = await seedAsset(organizationId, 'verified');
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/tasks',
          headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
          payload: { title: 'Собрать документы', attachments: [{ assetId: assetId.toString(), fileName: 'договор.pdf' }] },
        });
        expect(res.statusCode).toBe(201);
        const taskId = (JSON.parse(res.body) as { id: string }).id;
        return { taskId, assetId };
      }

      it('отдаёт подписанную ссылку и имя файла для настоящего вложения', async () => {
        const { cookie, organizationId } = await seedOwnerSession();
        const { taskId, assetId } = await createTaskWithAttachment(cookie, organizationId);

        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/tasks/${taskId}/attachments/${assetId.toString()}/download`,
          headers: { cookie },
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { url: string; fileName: string };
        expect(body.fileName).toBe('договор.pdf');
        expect(typeof body.url).toBe('string');
        expect(body.url.length).toBeGreaterThan(0);
      });

      it('assetId, не входящий в attachments этой задачи, — 404', async () => {
        const { cookie, organizationId } = await seedOwnerSession();
        const { taskId } = await createTaskWithAttachment(cookie, organizationId);
        // Настоящий, подтверждённый asset той же организации — просто не привязан к этой задаче.
        const otherAssetId = await seedAsset(organizationId, 'verified');

        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/tasks/${taskId}/attachments/${otherAssetId.toString()}/download`,
          headers: { cookie },
        });

        expect(res.statusCode).toBe(404);
      });

      it('чужая/несуществующая задача — 404, тот же non-disclosure, что у GET /tasks/:taskId', async () => {
        const { cookie } = await seedOwnerSession();
        const foreignAssetId = await seedAsset(new Types.ObjectId(), 'verified');

        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/tasks/${new Types.ObjectId().toString()}/attachments/${foreignAssetId.toString()}/download`,
          headers: { cookie },
        });

        expect(res.statusCode).toBe(404);
      });
    });

    it('returns 404 when associating with non-existent or foreign lead', async () => {
      const { cookie } = await seedOwnerSession();
      const foreignLeadId = new Types.ObjectId();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie },
        payload: {
          title: 'Follow up',
          leadId: foreignLeadId.toString(),
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('manager can create task assigned to themselves', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager = await seedManagerSession(organizationId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: manager.cookie },
        payload: {
          title: 'Звонок после просмотра',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.assignedPositionId).toBe(manager.positionId.toString());
    });
  });

  describe('GET /tasks & GET /tasks/:taskId — Scope enforcement and pagination', () => {
    it('cursor pagination, status filter, and newest-first order', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();

      // Create 3 tasks with 10ms gap
      for (let i = 1; i <= 3; i++) {
        await connection.collection('tasks').insertOne({
          organizationId,
          title: `Task #${i}`,
          status: i === 3 ? 'completed' : 'open',
          assignedPositionId: positionId,
          version: 0,
          createdAt: new Date(Date.now() + i * 100),
        });
      }

      // Query open tasks with limit 2
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?status=open&limit=1',
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].title).toBe('Task #2');
      expect(data.nextCursor).not.toBeNull();

      // Second page
      const res2 = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks?status=open&limit=1&cursor=${data.nextCursor}`,
        headers: { cookie },
      });
      const data2 = JSON.parse(res2.body);
      expect(data2.items).toHaveLength(1);
      expect(data2.items[0].title).toBe('Task #1');
      expect(data2.nextCursor).toBeNull();
    });

    it('manager with own-scope can only see their own tasks', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager1 = await seedManagerSession(organizationId);
      const manager2 = await seedManagerSession(organizationId);

      // Task for Manager 1
      await seedTask(organizationId, { title: 'Manager 1 task', assignedPositionId: manager1.positionId });

      // Task for Manager 2
      const task2Id = await seedTask(organizationId, { title: 'Manager 2 task', assignedPositionId: manager2.positionId });

      // Manager 1 lists tasks
      const m1List = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
        headers: { cookie: manager1.cookie },
      });
      expect(m1List.statusCode).toBe(200);
      const m1Items = JSON.parse(m1List.body).items;
      expect(m1Items).toHaveLength(1);
      expect(m1Items[0].title).toBe('Manager 1 task');

      // Manager 1 cannot get Manager 2 task -> 404 (non-disclosure)
      const m1GetM2 = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${task2Id.toString()}`,
        headers: { cookie: manager1.cookie },
      });
      expect(m1GetM2.statusCode).toBe(404);

      // Manager 1 cannot query assignedPositionId of Manager 2 -> 400
      const m1FilterMismatch = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks?assignedPositionId=${manager2.positionId.toString()}`,
        headers: { cookie: manager1.cookie },
      });
      expect(m1FilterMismatch.statusCode).toBe(400);
    });

    it('multi-tenant isolation: Tenant A cannot access Tenant B task', async () => {
      const orgA = await seedOwnerSession();
      const orgB = await seedOwnerSession();

      const taskBId = await seedTask(orgB.organizationId, { title: 'Org B Secret Task' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskBId.toString()}`,
        headers: { cookie: orgA.cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /tasks/:taskId & POST /tasks/:taskId/complete', () => {
    it('updates task attributes and writes audit record', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { title: 'Initial title', assignedPositionId: positionId });

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: {
          expectedVersion: 0,
          title: 'Updated title',
          description: 'Updated notes',
          status: 'cancelled',
        },
      });

      expect(patchRes.statusCode).toBe(200);
      const body = JSON.parse(patchRes.body);
      expect(body.title).toBe('Updated title');
      expect(body.description).toBe('Updated notes');
      expect(body.status).toBe('cancelled');

      // Check audit
      const audit = await connection.collection('audit_events').findOne({
        action: 'task.update',
        resourceId: taskId,
      });
      expect(audit).not.toBeNull();
      expect(audit?.before?.status).toBe('open');
      expect(audit?.after?.status).toBe('cancelled');
    });

    it('переводит задачу в in_progress — статус, который экран показывает как «В работе»', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { title: 'Позвонить клиенту', assignedPositionId: positionId });

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, status: 'in_progress' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.body).status).toBe('in_progress');
    });

    it('взятая в работу задача завершается штатной командой complete', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { title: 'Подготовить договор', assignedPositionId: positionId });

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, status: 'in_progress' },
      });

      const completeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId.toString()}/complete`,
        headers: { cookie },
        payload: { expectedVersion: 1 },
      });

      expect(completeRes.statusCode).toBe(200);
      const body = JSON.parse(completeRes.body);
      expect(body.status).toBe('completed');
      expect(body.completedAt).not.toBeNull();
    });

    it('отмечает подзадачу выполненной — экран показывает чекбоксы, и они сохраняются', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { title: 'Собрать документы', assignedPositionId: positionId });

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: {
          expectedVersion: 0,
          subtasks: [
            { id: 'st-1', title: 'Паспорт', done: true },
            { id: 'st-2', title: 'Выписка ЕГРН', done: false },
          ],
        },
      });

      expect(patchRes.statusCode).toBe(200);
      const body = JSON.parse(patchRes.body);
      expect(body.subtasks).toEqual([
        { id: 'st-1', title: 'Паспорт', done: true },
        { id: 'st-2', title: 'Выписка ЕГРН', done: false },
      ]);

      // Список заменяется целиком: подзадачи не существуют вне своей задачи,
      // и экран всегда отправляет их все.
      const replaceRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 1, subtasks: [{ id: 'st-1', title: 'Паспорт', done: false }] },
      });

      expect(replaceRes.statusCode).toBe(200);
      expect(JSON.parse(replaceRes.body).subtasks).toEqual([{ id: 'st-1', title: 'Паспорт', done: false }]);
    });

    it('PATCH не завершает задачу: completed ставит только команда complete', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { title: 'Отправить подборку', assignedPositionId: positionId });

      // Второй путь завершения не писал бы ни completedAt, ни
      // completedByPositionId, ни событие TaskCompleted — поэтому его нет.
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, status: 'completed' },
      });

      expect(patchRes.statusCode).toBe(400);
    });

    it('completes task via POST /tasks/:taskId/complete and sets completedBy and timestamp', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager = await seedManagerSession(organizationId);

      const taskId = await seedTask(organizationId, {
        title: 'Conduct phone interview',
        assignedPositionId: manager.positionId,
      });

      const completeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId.toString()}/complete`,
        headers: { cookie: manager.cookie },
        payload: { expectedVersion: 0 },
      });

      expect(completeRes.statusCode).toBe(200);
      const body = JSON.parse(completeRes.body);
      expect(body.status).toBe('completed');
      expect(body.completedAt).not.toBeNull();
      expect(body.completedByPositionId).toBe(manager.positionId.toString());

      // Cannot edit a completed task (returns 400)
      const editCompleted = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie: manager.cookie },
        payload: { expectedVersion: 1, title: 'New title after done' },
      });
      expect(editCompleted.statusCode).toBe(400);
    });

    it('manager cannot complete a task belonging to another manager', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager1 = await seedManagerSession(organizationId);
      const manager2 = await seedManagerSession(organizationId);

      const task2Id = await seedTask(organizationId, { title: 'Manager 2 task', assignedPositionId: manager2.positionId });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task2Id.toString()}/complete`,
        headers: { cookie: manager1.cookie },
        payload: { expectedVersion: 0 },
      });
      expect(res.statusCode).toBe(404);
    });

    it('stale expectedVersion on an open task — 409 CONFLICT, does not modify the task', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 99, title: 'Should not apply' },
      });

      expect(res.statusCode).toBe(409);
      const taskDoc = await connection.collection('tasks').findOne({ _id: taskId });
      expect(taskDoc?.title).toBe('Задача');
    });

    it('complete is idempotent: repeated call after completion returns 200 with the same state, ignoring stale expectedVersion', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId.toString()}/complete`,
        headers: { cookie },
        payload: { expectedVersion: 0 },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId.toString()}/complete`,
        headers: { cookie },
        payload: { expectedVersion: 0 },
      });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body).status).toBe('completed');
    });
  });

  describe('PATCH /tasks/:taskId — матрица Эйзенхауэра, taskType, colorHex, leadId, вложения', () => {
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
        purpose: 'task_attachment',
        createdAt: new Date(),
      });
      return assetId;
    }

    it('isUrgent/isImportant меняют priority в ответе', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, isUrgent: true, isImportant: true },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.isUrgent).toBe(true);
      expect(body.isImportant).toBe(true);
      expect(body.priority).toBe('critical');
    });

    it('taskType создаётся со значением по умолчанию и меняется PATCH', async () => {
      const { cookie } = await seedOwnerSession();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Обычная задача' },
      });
      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body);
      expect(created.taskType).toBe('standard');

      const createCallRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, 'idempotency-key': `key-${new Types.ObjectId().toString()}` },
        payload: { title: 'Позвонить клиенту', taskType: 'call' },
      });
      expect(createCallRes.statusCode).toBe(201);
      expect(JSON.parse(createCallRes.body).taskType).toBe('call');

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${created.id}`,
        headers: { cookie },
        payload: { expectedVersion: 0, taskType: 'meeting' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.body).taskType).toBe('meeting');
    });

    it('colorHex: null снимает метку', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const setRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, colorHex: '#ff00aa' },
      });
      expect(setRes.statusCode).toBe(200);
      expect(JSON.parse(setRes.body).colorHex).toBe('#ff00aa');

      const unsetRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 1, colorHex: null },
      });
      expect(unsetRes.statusCode).toBe(200);
      expect(JSON.parse(unsetRes.body).colorHex).toBeNull();
    });

    it('leadId: привязка ставит contactId лида, отвязка (null) снимает оба, entityType становится none', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const linkRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, leadId: leadId.toString() },
      });
      expect(linkRes.statusCode).toBe(200);
      const linked = JSON.parse(linkRes.body);
      expect(linked.leadId).toBe(leadId.toString());
      expect(linked.contactId).toBe(contactId.toString());
      expect(linked.entityType).toBe('lead');

      const unlinkRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 1, leadId: null },
      });
      expect(unlinkRes.statusCode).toBe(200);
      const unlinked = JSON.parse(unlinkRes.body);
      expect(unlinked.leadId).toBeNull();
      expect(unlinked.contactId).toBeNull();
      expect(unlinked.entityType).toBe('none');
    });

    it('leadId чужой организации — 404, задача не меняется', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });
      const foreignLeadId = new Types.ObjectId();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, leadId: foreignLeadId.toString() },
      });

      expect(res.statusCode).toBe(404);
      const taskDoc = await connection.collection('tasks').findOne({ _id: taskId });
      // Native driver сериализует непереданный undefined-параметр как BSON null.
      expect(taskDoc?.leadId).toBeNull();
    });

    it('startAt/dueAt: null снимает срок и плановое начало', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const setRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: {
          expectedVersion: 0,
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          startAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      expect(setRes.statusCode).toBe(200);
      const set = JSON.parse(setRes.body);
      expect(set.dueAt).not.toBeNull();
      expect(set.startAt).not.toBeNull();

      const unsetRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 1, dueAt: null, startAt: null },
      });
      expect(unsetRes.statusCode).toBe(200);
      const unset = JSON.parse(unsetRes.body);
      expect(unset.dueAt).toBeNull();
      expect(unset.startAt).toBeNull();
    });

    it('attachments: PATCH заменяет список целиком', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });
      const assetId = await seedAsset(organizationId, 'verified');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: {
          expectedVersion: 0,
          attachments: [{ assetId: assetId.toString(), fileName: 'договор.pdf' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.attachments).toEqual([{ assetId: assetId.toString(), fileName: 'договор.pdf' }]);
    });

    it('attachments: неверифицированный/чужой asset — 400/404, задача не меняется', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });
      const pendingAsset = await seedAsset(organizationId, 'pending');

      const pendingRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, attachments: [{ assetId: pendingAsset.toString(), fileName: 'x.pdf' }] },
      });
      expect(pendingRes.statusCode).toBe(400);

      const foreignAsset = await seedAsset(new Types.ObjectId(), 'verified');
      const foreignRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, attachments: [{ assetId: foreignAsset.toString(), fileName: 'x.pdf' }] },
      });
      expect(foreignRes.statusCode).toBe(404);

      const taskDoc = await connection.collection('tasks').findOne({ _id: taskId });
      expect(taskDoc?.attachments ?? []).toHaveLength(0);
    });

    it('устаревшая версия — 409, ни одно из новых полей не применяется', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 5, isUrgent: true, colorHex: '#ff0000', taskType: 'call' },
      });

      expect(res.statusCode).toBe(409);
      const taskDoc = await connection.collection('tasks').findOne({ _id: taskId });
      expect(taskDoc?.isUrgent).toBeUndefined();
      expect(taskDoc?.colorHex).toBeUndefined();
      expect(taskDoc?.taskType).toBeUndefined();
    });
  });

  describe('PATCH /tasks/:taskId/reassign — task.reassign (отдельный от task.edit)', () => {
    it('owner переназначает задачу на другую Position, пишет audit task.reassign', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const oldAssignee = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'manager' });
      const newAssignee = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'manager' });
      const taskId = await seedTask(organizationId, { assignedPositionId: oldAssignee });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}/reassign`,
        headers: { cookie },
        payload: { expectedVersion: 0, assignedPositionId: newAssignee.toString() },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).assignedPositionId).toBe(newAssignee.toString());

      const audit = await connection.collection('audit_events').findOne({ action: 'task.reassign', resourceId: taskId });
      expect(audit).not.toBeNull();
      expect(audit?.before?.assignedPositionId).toBe(oldAssignee.toString());
      expect(audit?.after?.assignedPositionId).toBe(newAssignee.toString());
    });

    it('manager (own-scope, task.reassign нет гранта) — 403 FORBIDDEN', async () => {
      const { organizationId } = await seedOwnerSession();
      const manager = await seedManagerSession(organizationId);
      const taskId = await seedTask(organizationId, { assignedPositionId: manager.positionId });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}/reassign`,
        headers: { cookie: manager.cookie },
        payload: { expectedVersion: 0, assignedPositionId: manager.positionId.toString() },
      });

      expect(res.statusCode).toBe(403);
    });

    it('PATCH /tasks/:taskId (task.edit) больше НЕ принимает assignedPositionId — поле игнорируется/отклоняется ValidationPipe (whitelist)', async () => {
      const { cookie, organizationId, positionId } = await seedOwnerSession();
      const otherPosition = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'manager' });
      const taskId = await seedTask(organizationId, { assignedPositionId: positionId });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie },
        payload: { expectedVersion: 0, assignedPositionId: otherPosition.toString() },
      });

      // whitelist:true + forbidNonWhitelisted:true (main.api.ts ValidationPipe) —
      // неизвестное для UpdateTaskDto поле assignedPositionId отклоняется 400,
      // не молча игнорируется — тот же контракт, что остальные DTO этого API.
      expect(res.statusCode).toBe(400);
    });
  });

  describe('administrator role — task.complete grant (owner-подтверждено 30.08.2026)', () => {
    it('administrator может завершить любую задачу организации', async () => {
      const { organizationId } = await seedOwnerSession();
      const admin = await seedAdministratorSession(organizationId);
      const managerSession = await seedManagerSession(organizationId);
      const taskId = await seedTask(organizationId, { assignedPositionId: managerSession.positionId });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId.toString()}/complete`,
        headers: { cookie: admin.cookie },
        payload: { expectedVersion: 0 },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe('completed');
    });

    it('administrator НЕ имеет task.edit/task.reassign — 403 FORBIDDEN', async () => {
      const { organizationId } = await seedOwnerSession();
      const admin = await seedAdministratorSession(organizationId);
      const taskId = await seedTask(organizationId);

      const editRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}`,
        headers: { cookie: admin.cookie },
        payload: { expectedVersion: 0, title: 'x' },
      });
      expect(editRes.statusCode).toBe(403);

      const reassignRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId.toString()}/reassign`,
        headers: { cookie: admin.cookie },
        payload: { expectedVersion: 0 },
      });
      expect(reassignRes.statusCode).toBe(403);
    });
  });

  describe('CRM-003: hasOpenNextAction в GET /leads и GET /leads/:leadId (мягкое правило)', () => {
    it('активный лид (new) с открытой задачей — hasOpenNextAction:true в GET /leads/:leadId', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);
      await seedTask(organizationId, { leadId, status: 'open' });

      const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${leadId.toString()}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).hasOpenNextAction).toBe(true);
    });

    it('активный лид (new) БЕЗ задач — hasOpenNextAction:false', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);

      const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${leadId.toString()}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).hasOpenNextAction).toBe(false);
    });

    it('активный лид, у которого единственная задача cancelled (не open) — hasOpenNextAction:false', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);
      await seedTask(organizationId, { leadId, status: 'cancelled' });

      const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${leadId.toString()}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).hasOpenNextAction).toBe(false);
    });

    it('задача, взятая в работу, остаётся следующим действием лида', async () => {
      // Иначе признак гас бы ровно в тот момент, когда за задачу взялись:
      // «следующее действие есть» превращалось бы в «его нет».
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadId = await seedLead(organizationId, contactId);
      await seedTask(organizationId, { leadId, status: 'in_progress' });

      const res = await app.inject({ method: 'GET', url: `/api/v1/leads/${leadId.toString()}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).hasOpenNextAction).toBe(true);
    });

    it('в списке лидов задача в работе тоже считается следующим действием', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadInProgress = await seedLead(organizationId, contactId);
      const leadCompleted = await seedLead(organizationId, contactId);
      await seedTask(organizationId, { leadId: leadInProgress, status: 'in_progress' });
      await seedTask(organizationId, { leadId: leadCompleted, status: 'completed' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/leads', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const items = JSON.parse(res.body).items as Array<{ id: string; hasOpenNextAction: boolean }>;
      const byId = new Map(items.map((item) => [item.id, item.hasOpenNextAction]));
      expect(byId.get(leadInProgress.toString())).toBe(true);
      expect(byId.get(leadCompleted.toString())).toBe(false);
    });

    it('GET /leads (список) отражает hasOpenNextAction по каждому лиду независимо, одним батч-запросом', async () => {
      const { cookie, organizationId } = await seedOwnerSession();
      const contactId = await seedContact(organizationId);
      const leadWithTask = await seedLead(organizationId, contactId);
      const leadWithoutTask = await seedLead(organizationId, contactId);
      await seedTask(organizationId, { leadId: leadWithTask, status: 'open' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/leads', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const items = JSON.parse(res.body).items as Array<{ id: string; hasOpenNextAction: boolean }>;
      const byId = new Map(items.map((item) => [item.id, item.hasOpenNextAction]));
      expect(byId.get(leadWithTask.toString())).toBe(true);
      expect(byId.get(leadWithoutTask.toString())).toBe(false);
    });
  });

  /**
   * ИСПРАВЛЕНО 11.09.2026 (task-model-audit-followup.md, седьмое наблюдение
   * аудита): видимость личных задач (taskCategory:'personal') держал
   * только клиент — сервер отдавал их целиком любому organization-scope
   * гранту (owner/administrator). Полный HTTP-путь на настоящей MongoDB —
   * реальные PermissionGrant-документы (manager: task.read own-scope,
   * owner: organization-scope), не моки.
   */
  describe('taskCategory: видимость личных задач — сервер, не только клиент', () => {
    it('GET /tasks: owner (organization-scope) не видит личную задачу менеджера, но видит его рабочую', async () => {
      const { cookie: ownerCookie, organizationId } = await seedOwnerSession();
      const { positionId: managerPositionId } = await seedManagerSession(organizationId);
      const personalTask = await seedTask(organizationId, {
        title: 'Личное — купить подарок',
        assignedPositionId: managerPositionId,
        taskCategory: 'personal',
      });
      const workTask = await seedTask(organizationId, {
        title: 'Позвонить клиенту',
        assignedPositionId: managerPositionId,
        taskCategory: 'work',
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/tasks', headers: { cookie: ownerCookie } });

      expect(res.statusCode).toBe(200);
      const ids = (JSON.parse(res.body).items as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(workTask.toString());
      expect(ids).not.toContain(personalTask.toString());
    });

    it('GET /tasks: менеджер (own-scope) видит свою личную задачу', async () => {
      const { organizationId } = await seedOwnerSession();
      const { cookie: managerCookie, positionId: managerPositionId } = await seedManagerSession(organizationId);
      const personalTask = await seedTask(organizationId, {
        title: 'Личное — купить подарок',
        assignedPositionId: managerPositionId,
        taskCategory: 'personal',
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/tasks', headers: { cookie: managerCookie } });

      expect(res.statusCode).toBe(200);
      const ids = (JSON.parse(res.body).items as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(personalTask.toString());
    });

    it('GET /tasks/:taskId: owner напрямую по id не читает чужую личную задачу — 404, не раскрывает существование', async () => {
      const { cookie: ownerCookie, organizationId } = await seedOwnerSession();
      const { positionId: managerPositionId } = await seedManagerSession(organizationId);
      const personalTask = await seedTask(organizationId, {
        assignedPositionId: managerPositionId,
        taskCategory: 'personal',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${personalTask.toString()}`,
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(404);
    });

    it('GET /tasks/:taskId: менеджер по id читает свою личную задачу — 200', async () => {
      const { organizationId } = await seedOwnerSession();
      const { cookie: managerCookie, positionId: managerPositionId } = await seedManagerSession(organizationId);
      const personalTask = await seedTask(organizationId, {
        assignedPositionId: managerPositionId,
        taskCategory: 'personal',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${personalTask.toString()}`,
        headers: { cookie: managerCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).id).toBe(personalTask.toString());
    });
  });
});
