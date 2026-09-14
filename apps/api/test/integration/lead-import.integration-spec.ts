import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/shared/errors/app-exception.filter';
import { CorrelationIdMiddleware } from '../../src/shared/errors/correlation-id.middleware';
import { TenantContextMiddleware } from '../../src/shared/tenant/tenant-context.middleware';
import { AdminContextMiddleware } from '../../src/shared/admin/admin-context.middleware';
import { AuthService } from '../../src/modules/identity/auth.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * POST /leads/import — та же двухступенчатая проверка прав, что export.run/
 * <entity>.read (export-run.integration-spec.ts): import.run сам по себе не
 * должен становиться обходом lead.create. Против реальной MongoDB и реальных
 * DEFAULT_ROLE_GRANTS — мок показал бы только то, что в него положили.
 */
describe('POST /leads/import — импорт лидов из CSV (real HTTP + real MongoDB)', () => {
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
    await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) =>
      app.get(CorrelationIdMiddleware).use(req, reply, () => {}),
    );
    fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) =>
      app.get(TenantContextMiddleware).use(req, reply, () => {}),
    );
    fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) =>
      app.get(AdminContextMiddleware).use(req, reply, () => {}),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    await fastify.ready();

    connection = moduleRef.get<Connection>(getConnectionToken());
    authService = moduleRef.get(AuthService);
    organizationsService = moduleRef.get(OrganizationsService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    for (const collection of [
      'leads',
      'lead_events',
      'contacts',
      'positions',
      'position_assignments',
      'organizations',
      'permission_grants',
      'identities',
      'sessions',
      'product_accesses',
      'audit_events',
      'idempotency_records',
    ]) {
      await connection.collection(collection).deleteMany({});
    }
  });

  const PASSWORD = 'correct horse battery staple';

  async function seedOwner() {
    const login = `owner-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const { organizationId, positionId } = await organizationsService.createOrganizationWithOwner({
      type: 'agency',
      name: 'Агентство Импорта',
      ownerIdentityId: identityId,
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, organizationId, positionId };
  }

  async function seedMarketerWithGrants(
    organizationId: Types.ObjectId,
    grants: Array<{ resource: string; action: string; scope: string }>,
  ) {
    const login = `marketer-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'marketer' });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: 'marketer',
      actorIdentityId: identityId,
      expectedOrganizationId: organizationId,
      correlationId: 'lead-import-seed',
    });
    // marketer по умолчанию не имеет ни import.run, ни lead.create —
    // добавляем ровно те grants, которые нужны конкретному тест-кейсу,
    // чтобы проверить именно двухступенчатую защиту, не смешение с
    // готовым набором прав какой-то другой роли.
    for (const grant of grants) {
      await connection.collection('permission_grants').insertOne({
        _id: new Types.ObjectId(),
        subjectType: 'position',
        subjectId: positionId,
        resource: grant.resource,
        action: grant.action,
        scope: grant.scope,
        version: 1,
        createdAt: new Date(),
      });
    }
    const session = await authService.login({ login, password: PASSWORD, audience: 'erp' });
    return { cookie: `baza_session=${session.sessionToken}`, positionId };
  }

  function multipartCsvPayload(csv: string, filename = 'leads.csv'): { body: Buffer; contentType: string } {
    const boundary = '----baza-lead-import-test-boundary';
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `${csv}\r\n` +
      `--${boundary}--\r\n`;
    return { body: Buffer.from(body, 'utf8'), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  async function postImport(cookie: string, csv: string, query = '') {
    const { body, contentType } = multipartCsvPayload(csv);
    return app.inject({
      method: 'POST',
      url: `/api/v1/leads/import${query}`,
      headers: { cookie, 'content-type': contentType },
      payload: body,
    });
  }

  it('без сессии — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/leads/import' });
    expect(res.statusCode).toBe(401);
  });

  it('без import.run — 403', async () => {
    const owner = await seedOwner();
    const marketer = await seedMarketerWithGrants(owner.organizationId, []);

    const res = await postImport(marketer.cookie, 'phone,name\n+995500000001,Иван\n');
    expect(res.statusCode).toBe(403);
  });

  it('с import.run, но без lead.create — тоже 403 (import.run НЕ заменяет lead.create)', async () => {
    const owner = await seedOwner();
    const marketer = await seedMarketerWithGrants(owner.organizationId, [
      { resource: 'import', action: 'run', scope: 'organization' },
    ]);

    const res = await postImport(marketer.cookie, 'phone,name\n+995500000001,Иван\n');
    expect(res.statusCode).toBe(403);
    expect(await connection.collection('leads').countDocuments({})).toBe(0);
  });

  it('owner: успешный импорт N строк создаёт N лидов', async () => {
    const owner = await seedOwner();
    const csv = 'phone,name\n+995500000001,Иван\n+995500000002,Пётр\n+995500000003,Мария\n';

    const res = await postImport(owner.cookie, csv);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toMatchObject({ success: true, data: { total: 3, created: 3, failed: 0, errors: [] } });
    expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(3);
    expect(await connection.collection('contacts').countDocuments({ organizationId: owner.organizationId })).toBe(3);
  });

  it('одна невалидная строка (пустой phone) не роняет остальные, попадает в errors', async () => {
    const owner = await seedOwner();
    const csv = 'phone,name\n+995500000001,Иван\n,Без телефона\n+995500000003,Мария\n';

    const res = await postImport(owner.cookie, csv);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.data).toMatchObject({ total: 3, created: 2, failed: 1 });
    expect(parsed.data.errors).toEqual([{ row: 2, message: expect.stringContaining('phone') }]);
    expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(2);
  });

  it('превышение 2000 строк — 400 целиком, ни один лид не создаётся', async () => {
    const owner = await seedOwner();
    const rows = Array.from({ length: 2001 }, (_, i) => `+9955${String(i).padStart(8, '0')},Клиент${i}`);
    const csv = ['phone,name', ...rows].join('\n');

    const res = await postImport(owner.cookie, csv);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_FAILED');
    expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(0);
  }, 30_000);

  it('повторная загрузка ТОГО ЖЕ файла — не создаёт дублей (идемпотентность по строке)', async () => {
    const owner = await seedOwner();
    const csv = 'phone,name\n+995500000001,Иван\n+995500000002,Пётр\n';

    const first = await postImport(owner.cookie, csv);
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).data).toMatchObject({ created: 2, failed: 0 });

    const second = await postImport(owner.cookie, csv);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).data).toMatchObject({ total: 2, created: 2, failed: 0 });

    expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(2);
    expect(await connection.collection('contacts').countDocuments({ organizationId: owner.organizationId })).toBe(2);
  });

  it('импорт фиксируется одним audit-событием на весь файл', async () => {
    const owner = await seedOwner();
    const csv = 'phone,name\n+995500000001,Иван\n+995500000002,Пётр\n';

    await postImport(owner.cookie, csv);

    const auditDocs = await connection.collection('audit_events').find({ action: 'import.run' }).toArray();
    expect(auditDocs).toHaveLength(1);
    expect(auditDocs[0]?.after).toMatchObject({ total: 2, created: 2, failed: 0 });
  });

  it('файл без обязательной колонки phone — 400, ни один лид не создаётся', async () => {
    const owner = await seedOwner();
    const res = await postImport(owner.cookie, 'name\nБез телефона вообще\n');

    expect(res.statusCode).toBe(400);
    expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(0);
  });

  describe('legacy-base-import: whatsapp/telegram/comment/last_contact, ?tag=old_base', () => {
    it('новые колонки попадают в whatsapp/telegram/notes/lastContactAt лида', async () => {
      const owner = await seedOwner();
      const csv =
        'phone,name,telegram,whatsapp,comment,last_contact\n' +
        '+995500000001,Иван,@ivan,+995500000009,Старая заявка,2026-01-15\n';

      const res = await postImport(owner.cookie, csv);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data).toMatchObject({ total: 1, created: 1, failed: 0 });
      const leadDoc = await connection.collection('leads').findOne({ organizationId: owner.organizationId });
      expect(leadDoc).toMatchObject({
        telegram: '@ivan',
        whatsapp: '+995500000009',
        notes: 'Старая заявка',
      });
      expect(new Date(leadDoc!.lastContactAt).toISOString()).toBe('2026-01-15T00:00:00.000Z');
      expect(leadDoc!.source).toMatchObject({ route: 'import' });
    });

    it('?tag=old_base помечает созданные лиды tags:[old_base]', async () => {
      const owner = await seedOwner();
      const csv = 'phone,name\n+995500000001,Иван\n';

      const res = await postImport(owner.cookie, csv, '?tag=old_base');

      expect(res.statusCode).toBe(200);
      const leadDoc = await connection.collection('leads').findOne({ organizationId: owner.organizationId });
      expect(leadDoc!.tags).toEqual(['old_base']);
    });

    it('без tag — tags не проставляется', async () => {
      const owner = await seedOwner();
      const csv = 'phone,name\n+995500000001,Иван\n';

      await postImport(owner.cookie, csv);

      const leadDoc = await connection.collection('leads').findOne({ organizationId: owner.organizationId });
      expect(leadDoc!.tags ?? []).toEqual([]);
    });

    it('?tag=что-то-ещё — 400, ни один лид не создаётся', async () => {
      const owner = await seedOwner();
      const csv = 'phone,name\n+995500000001,Иван\n';

      const res = await postImport(owner.cookie, csv, '?tag=something_else');

      expect(res.statusCode).toBe(400);
      expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(0);
    });

    it('невалидная дата last_contact — ошибка ТОЛЬКО этой строки, остальные создаются', async () => {
      const owner = await seedOwner();
      const csv = 'phone,name,last_contact\n+995500000001,Иван,31.02.2026\n+995500000002,Пётр,15.01.2026\n';

      const res = await postImport(owner.cookie, csv);

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.data).toMatchObject({ total: 2, created: 1, failed: 1 });
      expect(parsed.data.errors).toEqual([{ row: 1, message: expect.stringContaining('дата') }]);
    });

    it('повторная загрузка того же телефона с tag=old_base ПОСЛЕ импорта без tag — не создаёт дубль', async () => {
      const owner = await seedOwner();
      const csvPlain = 'phone,name\n+995500000001,Иван\n';
      const first = await postImport(owner.cookie, csvPlain);
      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body).data).toMatchObject({ created: 1, failed: 0 });

      const csvWithTag = 'phone,name,whatsapp\n+995500000001,Иван,+995500000009\n';
      const second = await postImport(owner.cookie, csvWithTag, '?tag=old_base');
      expect(second.statusCode).toBe(200);

      expect(await connection.collection('leads').countDocuments({ organizationId: owner.organizationId })).toBe(1);
    });
  });
});
