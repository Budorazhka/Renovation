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
 * Библиотека материалов CRM (модуль `library`) и прикрепление материала к
 * лиду — HTTP-интеграция на реальной MongoDB replica set. Тот же стиль, что
 * notes.integration-spec.ts.
 */
describe('CRM Library — HTTP Integration (AppModule)', () => {
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
      'library_items',
      'library_folders',
      'idempotency_records',
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

  async function seedAsset(organizationId: Types.ObjectId, status: 'verified' | 'pending' = 'verified'): Promise<Types.ObjectId> {
    const assetId = new Types.ObjectId();
    await connection.collection('media_assets').insertOne({
      _id: assetId,
      ownerScope: { type: 'organization', organizationId },
      status,
      declaredMimeType: 'application/pdf',
      verifiedMimeType: status === 'verified' ? 'application/pdf' : undefined,
      sizeBytes: 4096,
      bucket: 'private',
      originalPath: `${assetId.toString()}/original.pdf`,
      variants: [],
      purpose: 'library_file',
      createdAt: new Date(),
    });
    return assetId;
  }

  async function seedLead(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const contactId = new Types.ObjectId();
    await connection.collection('contacts').insertOne({
      _id: contactId,
      organizationId,
      name: 'Петр Клиент',
      phone: '+79991112233',
      roles: ['buyer'],
      createdAt: new Date(),
    });
    const leadId = new Types.ObjectId();
    await connection.collection('leads').insertOne({
      _id: leadId,
      organizationId,
      contactId,
      stage: 'new',
      version: 0,
      source: { route: '/developments/test' },
      attachedAssetIds: [],
      createdAt: new Date(),
    });
    return leadId;
  }

  function createItem(cookie: string, payload: Record<string, unknown>, key = `key-${new Types.ObjectId().toString()}`) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/library/items',
      headers: { cookie, 'idempotency-key': key },
      payload,
    });
  }

  function listItems(cookie: string, query: string) {
    return app.inject({ method: 'GET', url: `/api/v1/library/items?${query}`, headers: { cookie } });
  }

  it('без сессии — 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/library/items?scope=organization' });
    expect(res.statusCode).toBe(401);
  });

  it('общие материалы: владелец добавляет, менеджер видит по своему продукту и не может добавить', async () => {
    const owner = await seedOwnerSession();
    const manager = await seedPositionSession(owner.organizationId, 'manager');

    const forSales = await createItem(owner.cookie, {
      scope: 'organization',
      productType: 'sales',
      assetId: (await seedAsset(owner.organizationId)).toString(),
      fileName: 'Презентация продаж.pdf',
    });
    expect(forSales.statusCode).toBe(201);
    expect(JSON.parse(forSales.body)).toEqual(
      expect.objectContaining({ scope: 'organization', productType: 'sales', fileName: 'Презентация продаж.pdf', mimeType: 'application/pdf', sizeBytes: 4096 }),
    );
    const forAll = await createItem(owner.cookie, {
      scope: 'organization',
      assetId: (await seedAsset(owner.organizationId)).toString(),
      fileName: 'Регламент.pdf',
    });
    expect(forAll.statusCode).toBe(201);

    const networkList = await listItems(manager.cookie, 'scope=organization&productType=network');
    expect(networkList.statusCode).toBe(200);
    const networkBody = JSON.parse(networkList.body);
    expect(networkBody.canUpload).toBe(false);
    expect(networkBody.items.map((i: { fileName: string }) => i.fileName)).toEqual(['Регламент.pdf']);

    const salesList = JSON.parse((await listItems(manager.cookie, 'scope=organization&productType=sales')).body);
    expect(salesList.items).toHaveLength(2);

    const denied = await createItem(manager.cookie, {
      scope: 'organization',
      assetId: (await seedAsset(owner.organizationId)).toString(),
      fileName: 'x.pdf',
    });
    expect(denied.statusCode).toBe(403);

    const deleteDenied = await app.inject({
      method: 'DELETE',
      url: `/api/v1/library/items/${JSON.parse(forAll.body).id}`,
      headers: { cookie: manager.cookie },
    });
    expect(deleteDenied.statusCode).toBe(403);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/library/items/${JSON.parse(forAll.body).id}`,
      headers: { cookie: owner.cookie },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('личная библиотека видна только владельцу, даже owner организации её не видит', async () => {
    const owner = await seedOwnerSession();
    const manager = await seedPositionSession(owner.organizationId, 'manager');

    const created = await createItem(manager.cookie, {
      scope: 'personal',
      assetId: (await seedAsset(owner.organizationId)).toString(),
      fileName: 'Мои скрипты.pdf',
    });
    expect(created.statusCode).toBe(201);
    const itemId = JSON.parse(created.body).id;

    const mine = JSON.parse((await listItems(manager.cookie, 'scope=personal')).body);
    expect(mine.items.map((i: { id: string }) => i.id)).toEqual([itemId]);
    expect(mine.canUpload).toBe(true);

    const ownersView = JSON.parse((await listItems(owner.cookie, 'scope=personal')).body);
    expect(ownersView.items).toEqual([]);

    const foreignDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/library/items/${itemId}/download`,
      headers: { cookie: owner.cookie },
    });
    expect(foreignDownload.statusCode).toBe(404);

    const ownDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/library/items/${itemId}/download`,
      headers: { cookie: manager.cookie },
    });
    expect(ownDownload.statusCode).toBe(200);
    expect(JSON.parse(ownDownload.body)).toEqual({ url: expect.any(String), fileName: 'Мои скрипты.pdf' });
  });

  it('повтор с тем же Idempotency-Key не создаёт второй материал', async () => {
    const owner = await seedOwnerSession();
    const payload = { scope: 'personal', assetId: (await seedAsset(owner.organizationId)).toString(), fileName: 'a.pdf' };

    const first = await createItem(owner.cookie, payload, 'same-key');
    const second = await createItem(owner.cookie, payload, 'same-key');

    expect(first.statusCode).toBe(201);
    expect(JSON.parse(second.body).id).toBe(JSON.parse(first.body).id);
    expect(await connection.collection('library_items').countDocuments({})).toBe(1);
  });

  it('не подтверждённый файл — 400, материал не создаётся', async () => {
    const owner = await seedOwnerSession();
    const res = await createItem(owner.cookie, {
      scope: 'personal',
      assetId: (await seedAsset(owner.organizationId, 'pending')).toString(),
      fileName: 'a.pdf',
    });
    expect(res.statusCode).toBe(400);
    expect(await connection.collection('library_items').countDocuments({})).toBe(0);
  });

  it('папки: вложенность, непустую не удалить (409), пустую — можно', async () => {
    const owner = await seedOwnerSession();
    const folderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/library/folders',
      headers: { cookie: owner.cookie, 'idempotency-key': 'folder-1' },
      payload: { name: 'Договоры' },
    });
    expect(folderRes.statusCode).toBe(201);
    const folderId = JSON.parse(folderRes.body).id;

    const item = await createItem(owner.cookie, {
      scope: 'personal',
      folderId,
      assetId: (await seedAsset(owner.organizationId)).toString(),
      fileName: 'Шаблон договора.pdf',
    });
    expect(item.statusCode).toBe(201);

    const rootItems = JSON.parse((await listItems(owner.cookie, 'scope=personal')).body);
    expect(rootItems.items).toEqual([]);
    const folderItems = JSON.parse((await listItems(owner.cookie, `scope=personal&folderId=${folderId}`)).body);
    expect(folderItems.items).toHaveLength(1);

    const folders = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/library/folders', headers: { cookie: owner.cookie } })).body,
    );
    expect(folders.folders.map((f: { name: string }) => f.name)).toEqual(['Договоры']);

    const notEmpty = await app.inject({ method: 'DELETE', url: `/api/v1/library/folders/${folderId}`, headers: { cookie: owner.cookie } });
    expect(notEmpty.statusCode).toBe(409);
    expect(JSON.parse(notEmpty.body).error.code).toBe('LIBRARY_FOLDER_NOT_EMPTY');

    await app.inject({ method: 'DELETE', url: `/api/v1/library/items/${JSON.parse(item.body).id}`, headers: { cookie: owner.cookie } });
    const emptied = await app.inject({ method: 'DELETE', url: `/api/v1/library/folders/${folderId}`, headers: { cookie: owner.cookie } });
    expect(emptied.statusCode).toBe(204);
  });

  it('материал прикрепляется к лиду со своим именем и скачивается из карточки лида', async () => {
    const owner = await seedOwnerSession();
    const leadId = await seedLead(owner.organizationId);
    const assetId = await seedAsset(owner.organizationId);
    const created = await createItem(owner.cookie, {
      scope: 'organization',
      assetId: assetId.toString(),
      fileName: 'КП ЖК Панорама.pdf',
    });
    const material = JSON.parse(created.body);

    const attach = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${leadId.toString()}/files`,
      headers: { cookie: owner.cookie },
      payload: { assetId: material.assetId, fileName: material.fileName },
    });
    expect(attach.statusCode).toBe(201);
    expect(JSON.parse(attach.body)).toEqual([
      expect.objectContaining({ assetId: assetId.toString(), fileName: 'КП ЖК Панорама.pdf', mimeType: 'application/pdf' }),
    ]);

    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId.toString()}/files/${assetId.toString()}/download`,
      headers: { cookie: owner.cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(JSON.parse(download.body)).toEqual({ url: expect.any(String), fileName: 'КП ЖК Панорама.pdf' });

    const detach = await app.inject({
      method: 'DELETE',
      url: `/api/v1/leads/${leadId.toString()}/files/${assetId.toString()}`,
      headers: { cookie: owner.cookie },
    });
    expect(detach.statusCode).toBe(200);
    const lead = await connection.collection('leads').findOne({ _id: leadId });
    expect(lead?.attachedFileNames?.[assetId.toString()]).toBeUndefined();

    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId.toString()}/files/${assetId.toString()}/download`,
      headers: { cookie: owner.cookie },
    });
    expect(gone.statusCode).toBe(404);
  });
});
