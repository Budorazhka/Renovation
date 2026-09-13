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
import { MessengerDialogRepository, MessengerMessageRepository } from '@baza/messenger';
import { LeadRepository } from '../../src/modules/crm/repository/lead.repository';
import { ContactRepository } from '../../src/modules/crm/repository/contact.repository';
import { DealRepository } from '../../src/modules/crm/repository/deal.repository';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * ИСПРАВЛЕНО 11.09.2026: `messenger_message.send`/`messenger_dialog.link_crm`
 * — единственные два messenger-права со scope `own` (только у manager, см.
 * default-role-grants.ts) — до этого коммита own-scope проверялся ТОЛЬКО на
 * чтение (`ownerFilterForAction` вызывался в listDialogs/getDialog/
 * listMessages/markDialogRead). Отправка сообщения, привязка к CRM и
 * создание задачи из диалога own-scope не сужали вовсе — деймон-гейт
 * `@RequirePermission` проверяет только факт наличия гранта, не владение
 * конкретным диалогом. Полный HTTP-путь (тот же паттерн, что
 * dev-selections.integration-spec.ts): TenantGuard → PermissionGuard →
 * MessengerController.ownerFilterForAction → MessengerService — против
 * реальных PermissionGrant-документов, не моков.
 */
describe('Messenger own-scope — HTTP integration (полный AppModule)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let authService: AuthService;
  let organizationsService: OrganizationsService;
  let dialogRepository: MessengerDialogRepository;
  let messageRepository: MessengerMessageRepository;
  let leadRepository: LeadRepository;
  let contactRepository: ContactRepository;
  let dealRepository: DealRepository;

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
    dialogRepository = moduleRef.get(MessengerDialogRepository);
    messageRepository = moduleRef.get(MessengerMessageRepository);
    leadRepository = moduleRef.get(LeadRepository);
    contactRepository = moduleRef.get(ContactRepository);
    dealRepository = moduleRef.get(DealRepository);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    for (const collection of [
      'messenger_dialogs',
      'messenger_messages',
      'messenger_accounts',
      'leads',
      'contacts',
      'deals',
      'tasks',
      'media_assets',
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

  async function seedOwnerSession(): Promise<{
    cookie: string;
    organizationId: Types.ObjectId;
    positionId: Types.ObjectId;
  }> {
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

  async function seedManagerSession(
    organizationId: Types.ObjectId,
    name: string,
  ): Promise<{ cookie: string; positionId: Types.ObjectId }> {
    const login = `manager-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'manager' });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: name,
      actorIdentityId: identityId,
      expectedOrganizationId: organizationId,
      correlationId: 'messenger-own-scope-integration-seed',
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, positionId };
  }

  async function seedDialog(
    organizationId: Types.ObjectId,
    assignedPositionId: Types.ObjectId | undefined,
  ): Promise<Types.ObjectId> {
    const dialog = await dialogRepository.create({
      organizationId,
      accountId: new Types.ObjectId(),
      assignedPositionId,
      platform: 'telegram',
      externalChatId: `chat-${new Types.ObjectId().toString()}`,
      name: 'Клиент Иван',
    });
    return dialog._id;
  }

  async function seedMessage(organizationId: Types.ObjectId, dialogId: Types.ObjectId, text: string): Promise<Types.ObjectId> {
    const message = await messageRepository.create({ organizationId, dialogId, author: 'agent', text });
    return message._id;
  }

  async function seedContact(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const contact = await contactRepository.create({
      organizationId,
      name: 'Клиент CRM',
      phone: '+995500000000',
      roles: ['buyer'],
    });
    return contact._id;
  }

  async function seedLead(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const contactId = await seedContact(organizationId);
    const lead = await leadRepository.create({
      organizationId,
      contactId,
      source: { route: 'integration-test' },
    });
    return lead._id;
  }

  async function seedDeal(organizationId: Types.ObjectId, ownerPositionId: Types.ObjectId): Promise<Types.ObjectId> {
    const contactId = await seedContact(organizationId);
    const deal = await dealRepository.create({
      organizationId,
      contactId,
      ownerPositionId,
      title: 'Сделка CRM',
    });
    return deal._id;
  }

  // Тот же паттерн прямой вставки, что tasks.integration-spec.ts использует
  // для проверки attachments у POST /tasks — полноценный upload-флоу здесь
  // не нужен, важен только итоговый статус/ownerScope документа.
  async function seedMediaAsset(organizationId: Types.ObjectId, status: 'verified' | 'pending'): Promise<Types.ObjectId> {
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
      purpose: 'messenger_attachment',
      createdAt: new Date(),
    });
    return assetId;
  }

  it('sendTextMessage: менеджер не может писать в диалог, назначенный коллеге — 404, сообщение не создаётся', async () => {
    const { organizationId } = await seedOwnerSession();
    const { positionId: managerA } = await seedManagerSession(organizationId, 'Менеджер А');
    const { cookie: cookieB } = await seedManagerSession(organizationId, 'Менеджер Б');
    const dialogId = await seedDialog(organizationId, managerA);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages`,
      headers: { cookie: cookieB, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { text: 'Попытка обхода own-scope' },
    });

    expect(response.statusCode).toBe(404);
    expect(await connection.collection('messenger_messages').countDocuments({})).toBe(0);
  });

  it('sendTextMessage: менеджер пишет в свой диалог — 201', async () => {
    const { organizationId } = await seedOwnerSession();
    const { cookie: cookieA, positionId: managerA } = await seedManagerSession(organizationId, 'Менеджер А');
    const dialogId = await seedDialog(organizationId, managerA);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages`,
      headers: { cookie: cookieA, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { text: 'Добрый день!' },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).text).toBe('Добрый день!');
  });

  it('sendTextMessage: диалог ещё не взят в работу — own-scope не блокирует (тот же принцип, что у непринятого лида)', async () => {
    const { organizationId } = await seedOwnerSession();
    const { cookie } = await seedManagerSession(organizationId, 'Менеджер А');
    const dialogId = await seedDialog(organizationId, undefined);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages`,
      headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { text: 'Здравствуйте!' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('sendTextMessage: владелец (organization-scope) пишет в любой диалог организации', async () => {
    const { cookie, organizationId } = await seedOwnerSession();
    const { positionId: managerA } = await seedManagerSession(organizationId, 'Менеджер А');
    const dialogId = await seedDialog(organizationId, managerA);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages`,
      headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { text: 'Сообщение от владельца' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('listMessages: отвечает {items, nextCursor} по контракту OpenAPI, не голым массивом', async () => {
    // ИСПРАВЛЕНО 11.09.2026: раньше GET /dialogs/:id/messages отдавал
    // голый массив — расхождение с MessengerMessageListResponse в OpenAPI.
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    await seedMessage(organizationId, dialogId, 'Сообщение 1');
    await seedMessage(organizationId, dialogId, 'Сообщение 2');
    await seedMessage(organizationId, dialogId, 'Сообщение 3');

    const page1 = await app.inject({
      method: 'GET',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages?limit=2`,
      headers: { cookie },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = JSON.parse(page1.body);
    expect(body1.items).toHaveLength(2);
    expect(typeof body1.nextCursor).toBe('string');
    // newest-first: последнее отправленное сообщение — первым в списке.
    expect(body1.items[0].text).toBe('Сообщение 3');

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages?limit=2&cursor=${body1.nextCursor}`,
      headers: { cookie },
    });
    expect(page2.statusCode).toBe(200);
    const body2 = JSON.parse(page2.body);
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].text).toBe('Сообщение 1');
    expect(body2.nextCursor).toBeNull();
  });

  it('linkDialogToCrm: менеджер не может перепривязать чужой диалог — 404, привязка не меняется', async () => {
    const { organizationId } = await seedOwnerSession();
    const { positionId: managerA } = await seedManagerSession(organizationId, 'Менеджер А');
    const { cookie: cookieB } = await seedManagerSession(organizationId, 'Менеджер Б');
    const dialogId = await seedDialog(organizationId, managerA);
    const leadId = new Types.ObjectId();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/link-crm`,
      headers: { cookie: cookieB },
      payload: { leadId: leadId.toString() },
    });

    expect(response.statusCode).toBe(404);
    const dialog = await connection.collection('messenger_dialogs').findOne({ _id: dialogId });
    expect(dialog?.leadId).toBeUndefined();
  });

  it('linkDialogToCrm: leadId из чужой организации — 404, привязка не меняется', async () => {
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const { organizationId: foreignOrgId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const foreignLeadId = await seedLead(foreignOrgId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/link-crm`,
      headers: { cookie },
      payload: { leadId: foreignLeadId.toString() },
    });

    expect(response.statusCode).toBe(404);
    const dialog = await connection.collection('messenger_dialogs').findOne({ _id: dialogId });
    expect(dialog?.leadId).toBeUndefined();
  });

  it('linkDialogToCrm: contactId из чужой организации — 404, привязка не меняется', async () => {
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const { organizationId: foreignOrgId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const foreignContactId = await seedContact(foreignOrgId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/link-crm`,
      headers: { cookie },
      payload: { contactId: foreignContactId.toString() },
    });

    expect(response.statusCode).toBe(404);
    const dialog = await connection.collection('messenger_dialogs').findOne({ _id: dialogId });
    expect(dialog?.contactId).toBeUndefined();
  });

  it('linkDialogToCrm: dealId из чужой организации — 404, привязка не меняется', async () => {
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const { organizationId: foreignOrgId, positionId: foreignPositionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const foreignDealId = await seedDeal(foreignOrgId, foreignPositionId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/link-crm`,
      headers: { cookie },
      payload: { dealId: foreignDealId.toString() },
    });

    expect(response.statusCode).toBe(404);
    const dialog = await connection.collection('messenger_dialogs').findOne({ _id: dialogId });
    expect(dialog?.dealId).toBeUndefined();
  });

  it('linkDialogToCrm: свои leadId/contactId/dealId из той же организации — 200, привязка сохраняется', async () => {
    // ИСПРАВЛЕНО 11.09.2026: было 201 (дефолт Nest для @Post) — link-crm
    // обновляет существующий диалог, не создаёт новый ресурс, поэтому по
    // OpenAPI и REST-конвенции должен быть 200 (см. @HttpCode(200) на
    // linkDialogToCrm в messenger.controller.ts).
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const leadId = await seedLead(organizationId);
    const contactId = await seedContact(organizationId);
    const dealId = await seedDeal(organizationId, positionId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/link-crm`,
      headers: { cookie },
      payload: { leadId: leadId.toString(), contactId: contactId.toString(), dealId: dealId.toString() },
    });

    expect(response.statusCode).toBe(200);
    const dialog = await connection.collection('messenger_dialogs').findOne({ _id: dialogId });
    expect(dialog?.leadId?.toString()).toBe(leadId.toString());
    expect(dialog?.contactId?.toString()).toBe(contactId.toString());
    expect(dialog?.dealId?.toString()).toBe(dealId.toString());
  });

  it('sendMediaMessage: assetId чужой организации — 404, сообщение не создаётся', async () => {
    // ИСПРАВЛЕНО 11.09.2026: assetId писался в сообщение без проверки, что
    // asset вообще существует и принадлежит организации вызывающего.
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const foreignAssetId = await seedMediaAsset(new Types.ObjectId(), 'verified');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages/media`,
      headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { assetId: foreignAssetId.toString(), fileName: 'секрет.pdf' },
    });

    expect(response.statusCode).toBe(404);
    expect(await connection.collection('messenger_messages').countDocuments({})).toBe(0);
  });

  it('sendMediaMessage: assetId существует, но ещё не verified — 400, сообщение не создаётся', async () => {
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const pendingAssetId = await seedMediaAsset(organizationId, 'pending');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages/media`,
      headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { assetId: pendingAssetId.toString(), fileName: 'план.pdf' },
    });

    expect(response.statusCode).toBe(400);
    expect(await connection.collection('messenger_messages').countDocuments({})).toBe(0);
  });

  it('sendMediaMessage: assetId своей организации и verified — 201, сообщение создаётся', async () => {
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const assetId = await seedMediaAsset(organizationId, 'verified');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/messages/media`,
      headers: { cookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { assetId: assetId.toString(), fileName: 'план.pdf' },
    });

    expect(response.statusCode).toBe(201);
    expect(await connection.collection('messenger_messages').countDocuments({})).toBe(1);
  });

  it('createTaskFromDialog: менеджер не может создать задачу из чужого диалога — 404', async () => {
    const { organizationId } = await seedOwnerSession();
    const { positionId: managerA } = await seedManagerSession(organizationId, 'Менеджер А');
    const { cookie: cookieB } = await seedManagerSession(organizationId, 'Менеджер Б');
    const dialogId = await seedDialog(organizationId, managerA);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/create-task`,
      headers: { cookie: cookieB, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { title: 'Попытка обхода' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('createTaskFromDialog: тот же Idempotency-Key, что уже использован на POST /tasks, — не 409, независимая вторая задача', async () => {
    // ИСПРАВЛЕНО 11.09.2026: оба эндпоинта в итоге вызывают CrmService.
    // createTask, и internal record() использовал захардкоженный
    // operation: 'createTask' — один и тот же Idempotency-Key на двух
    // разных HTTP-путях ловил (identityId, 'createTask', key) чужого
    // эндпоинта и давал IDEMPOTENCY_KEY_CONFLICT (409) вместо двух
    // независимых задач, потому что тела запросов у них разные.
    const { cookie, organizationId, positionId } = await seedOwnerSession();
    const dialogId = await seedDialog(organizationId, positionId);
    const sharedKey = new Types.ObjectId().toString();

    const fromTasksEndpoint = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { cookie, 'idempotency-key': sharedKey },
      payload: { title: 'Задача через общий /tasks' },
    });
    expect(fromTasksEndpoint.statusCode).toBe(201);

    const fromDialogEndpoint = await app.inject({
      method: 'POST',
      url: `/api/v1/messenger/dialogs/${dialogId}/create-task`,
      headers: { cookie, 'idempotency-key': sharedKey },
      payload: { title: 'Задача через диалог мессенджера' },
    });

    expect(fromDialogEndpoint.statusCode).toBe(201);
    const taskFromTasks = JSON.parse(fromTasksEndpoint.body);
    const taskFromDialog = JSON.parse(fromDialogEndpoint.body);
    expect(taskFromDialog.id).not.toBe(taskFromTasks.id);
    expect(await connection.collection('tasks').countDocuments({})).toBe(2);
  });
});
