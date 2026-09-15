import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fastifyCookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/shared/errors/app-exception.filter';
import { CorrelationIdMiddleware } from '../../src/shared/errors/correlation-id.middleware';
import { TenantContextMiddleware } from '../../src/shared/tenant/tenant-context.middleware';
import { AdminContextMiddleware } from '../../src/shared/admin/admin-context.middleware';
import { DevelopmentRepository } from '@baza/development';
import { MarketplacePublicationRepository } from '@baza/publication';
import { ListingRepository, PropertyAssetRepository } from '@baza/property-assets';
import { createRedisMockService } from './support/redis-mock';
import { PublicationRequestedHandler } from '../../../worker/src/handlers/publication-requested.handler';
import { RedisService } from '../../src/shared/redis/redis.service';
import { MediaAssetRepository, MediaStorageService } from '@baza/media-storage';

/**
 * Mirrors listing-reveal-lead.integration-spec.ts for the DEVELOPMENT side
 * (CrmController / crm.service.ts::revealContact) — this endpoint had zero
 * real-HTTP integration coverage before this test: only unit-level mocked
 * assertions existed (crm.service.spec.ts), and lead-management.integration-spec.ts
 * covers lead-stage transitions, not the reveal-contact flow itself. The
 * listings side has a full end-to-end suite; the developments side did not.
 */
describe('Public development lead reveal flow — Integration (real HTTP + real MongoDB transactions)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let developmentRepository: DevelopmentRepository;
  let publicationRepository: MarketplacePublicationRepository;
  let publicationHandler: PublicationRequestedHandler;
  let redisMockService: ReturnType<typeof createRedisMockService>;

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

    // RedisRateLimitGuard (см. её докстринг) требует реальный atomic eval()
    // против Redis — не MongoMemoryReplSet-style in-process сервер (не
    // существует эквивалента для Redis), поэтому DI-override RedisService на
    // ioredis-mock (полноценная эмуляция протокола, включая Lua eval) — тот
    // же принцип подмены инфраструктуры под тестами, что MongoMemoryReplSet
    // делает для MongoDB, адаптированный под то, что реально доступно для Redis.
    redisMockService = createRedisMockService();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(redisMockService)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
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
    developmentRepository = moduleRef.get(DevelopmentRepository);
    publicationRepository = moduleRef.get(MarketplacePublicationRepository);
    publicationHandler = new PublicationRequestedHandler(
      publicationRepository,
      developmentRepository,
      moduleRef.get(ListingRepository),
      moduleRef.get(PropertyAssetRepository),
      moduleRef.get(MediaAssetRepository),
      moduleRef.get(MediaStorageService),
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    for (const collection of [
      'developments',
      'marketplace_publications',
      'outbox_events',
      'idempotency_records',
      'audit_events',
      'permission_grants',
      'sessions',
      'position_assignments',
      'positions',
      'organizations',
      'identities',
      'contacts',
      'leads',
      'lead_events',
      'public_reveal_idempotency_records',
    ]) {
      await connection.collection(collection).deleteMany({});
    }
    // См. listing-reveal-lead.integration-spec.ts — rate-limit счётчики в
    // ioredis-mock должны сбрасываться между тестами так же, как коллекции.
    await redisMockService.client.flushall();
  });

  async function developerOwnerCookie(prefix: string) {
    const login = `${prefix}-${new Types.ObjectId().toString()}@example.test`;
    const password = 'correct horse battery staple';
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login, password } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password, type: 'developer', name: `${prefix} developer` },
    });
    expect(response.statusCode).toBe(201);
    const raw = response.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.match(/baza_session=[^;]+/)?.[0];
    if (!cookie) throw new Error('session cookie missing');
    return { cookie, organizationId: response.json().organizationId as string };
  }

  let counter = 0;
  async function seedPublishedDevelopment(owner: { cookie: string; organizationId: string }) {
    counter += 1;
    const phone = `+995599${String(counter).padStart(6, '0')}`;

    const devRes = await app.inject({
      method: 'POST',
      url: '/api/v1/developments',
      headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: owner.cookie },
      payload: {
        name: `ЖК Тест ${counter}`,
        location: {
          country: 'Georgia',
          city: 'Batumi',
          address: `Sea St ${counter}`,
          geo: { type: 'Point', coordinates: [41.6, 41.64] },
        },
        contact: { phone },
      },
    });
    expect(devRes.statusCode).toBe(201);
    const developmentId = devRes.json()._id;

    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/developments/${developmentId}/publish`,
      headers: { cookie: owner.cookie, 'idempotency-key': `dev-idem-${counter}` },
    });
    expect(publishRes.statusCode).toBe(202);

    const outboxDoc = await connection.collection('outbox_events').findOne({ eventType: 'PublicationRequested' });
    expect(outboxDoc).toBeTruthy();

    await publicationHandler.handle(outboxDoc as never);

    const pubDoc = await connection
      .collection('marketplace_publications')
      .findOne({ sourceType: 'development', sourceId: new Types.ObjectId(developmentId) });
    expect(pubDoc).toBeTruthy();
    expect(pubDoc!.status).toBe('published');

    return {
      developmentId,
      slug: pubDoc!.slug as string,
      publicationId: pubDoc!._id,
      contactPhone: phone,
    };
  }

  let ipCounter = 1;
  function nextIp() {
    ipCounter += 1;
    return `192.168.2.${ipCounter}`;
  }

  it('успешный reveal для опубликованного ЖК создаёт Contact, Lead, LeadEvent, audit и возвращает телефон', async () => {
    const owner = await developerOwnerCookie('dev-reveal-owner');
    const devData = await seedPublishedDevelopment(owner);
    const ip = nextIp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/developments/${devData.slug}/reveal-contact`,
      remoteAddress: ip,
      headers: { referer: 'https://baza.sale/catalogue' },
      payload: {
        requesterName: 'Иван Покупатель',
        requesterPhone: '+995555112244',
        utm: { utm_source: 'google', utm_campaign: 'promo' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.phone).toBe(devData.contactPhone);
    expect(body.leadId).toBeDefined();
    expect(body.organizationId).toBeUndefined();
    expect(body.publisherScope).toBeUndefined();
    expect(body.identityId).toBeUndefined();

    const contact = await connection.collection('contacts').findOne({ phone: '+995555112244' });
    expect(contact).toBeTruthy();
    expect(contact!.organizationId.toString()).toBe(owner.organizationId);

    const lead = await connection.collection('leads').findOne({ _id: new Types.ObjectId(body.leadId) });
    expect(lead).toBeTruthy();
    expect(lead!.organizationId.toString()).toBe(owner.organizationId);
    expect(lead!.contactId.toString()).toBe(contact!._id.toString());
    expect(lead!.productType).toBe('sales');
    expect(lead!.stage).toBe('new');
    expect(lead!.source.route).toBe(`/developments/${devData.slug}`);
    expect(lead!.source.publicationId.toString()).toBe(devData.publicationId.toString());
    expect(lead!.source.referrer).toBe('https://baza.sale/catalogue');
    expect(lead!.source.utm).toEqual({ utm_source: 'google', utm_campaign: 'promo' });

    const leadEvent = await connection.collection('lead_events').findOne({ leadId: lead!._id });
    expect(leadEvent).toBeTruthy();
    expect(leadEvent!.stage).toBe('new');

    const auditEvent = await connection.collection('audit_events').findOne({ resourceId: lead!._id });
    expect(auditEvent).toBeTruthy();
    expect(auditEvent!.action).toBe('lead.create_from_reveal');
  });

  it('повторный reveal тем же телефоном переиспользует Contact, но создаёт новый Lead', async () => {
    const owner = await developerOwnerCookie('dev-repeat-owner');
    const devData = await seedPublishedDevelopment(owner);
    const ip = nextIp();

    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/developments/${devData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: { requesterName: 'Иван', requesterPhone: '+995555998811' },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/developments/${devData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: { requesterName: 'Иван', requesterPhone: '+995555998811' },
    });
    expect(res2.statusCode).toBe(200);

    expect(res1.json().leadId).not.toBe(res2.json().leadId);

    const contactsCount = await connection.collection('contacts').countDocuments({ phone: '+995555998811' });
    expect(contactsCount).toBe(1);

    const leadsCount = await connection
      .collection('leads')
      .countDocuments({ organizationId: new Types.ObjectId(owner.organizationId) });
    expect(leadsCount).toBe(2);
  });

  it('возвращает 404 для неизвестного slug', async () => {
    const ip = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/developments/non-existent-dev-slug/reveal-contact',
      remoteAddress: ip,
      payload: { requesterPhone: '+995555123400' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('возвращает 404 для listing publication через development endpoint', async () => {
    const owner = await developerOwnerCookie('cross-src-owner');
    await connection.collection('marketplace_publications').insertOne({
      sourceType: 'listing',
      sourceId: new Types.ObjectId(),
      publisherScope: { type: 'organization', organizationId: new Types.ObjectId(owner.organizationId) },
      status: 'published',
      slug: 'listing-slug-not-a-dev',
      version: 1,
      denormalizedFields: {},
      searchProjection: {},
    });

    const ip = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/developments/listing-slug-not-a-dev/reveal-contact',
      remoteAddress: ip,
      payload: { requesterPhone: '+995555123400' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('возвращает 404 для неопубликованного (publication_pending) ЖК', async () => {
    const owner = await developerOwnerCookie('dev-unpub-owner');
    const devRes = await app.inject({
      method: 'POST',
      url: '/api/v1/developments',
      headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: owner.cookie },
      payload: {
        name: 'ЖК Черновик',
        location: {
          country: 'Georgia',
          city: 'Batumi',
          address: 'Draft St 1',
          geo: { type: 'Point', coordinates: [41.6, 41.64] },
        },
        contact: { phone: '+995500111333' },
      },
    });
    const developmentId = devRes.json()._id;

    await connection.collection('marketplace_publications').insertOne({
      sourceType: 'development',
      sourceId: new Types.ObjectId(developmentId),
      publisherScope: { type: 'organization', organizationId: new Types.ObjectId(owner.organizationId) },
      status: 'publication_pending',
      slug: 'pending-dev-slug',
      version: 1,
      denormalizedFields: {},
      searchProjection: {},
    });

    const ip = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/developments/pending-dev-slug/reveal-contact',
      remoteAddress: ip,
      payload: { requesterPhone: '+995555123400' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('без телефона посетителя — показывает номер застройщика, лид не создаётся', async () => {
    const owner = await developerOwnerCookie('dev-val-owner');
    const devData = await seedPublishedDevelopment(owner);
    const ip = nextIp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/developments/${devData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ phone: devData.contactPhone });
    expect(
      await connection.collection('leads').countDocuments({ organizationId: new Types.ObjectId(owner.organizationId) }),
    ).toBe(0);
  });

  it('применяет rate-limit (429) при частых запросах — тот же лимит, что у listing-endpoint', async () => {
    const owner = await developerOwnerCookie('dev-rate-owner');
    const devData = await seedPublishedDevelopment(owner);
    const ip = nextIp();

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/developments/${devData.slug}/reveal-contact`,
        remoteAddress: ip,
        payload: { requesterPhone: `+99555501${String(i).padStart(4, '0')}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const blockedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/public/developments/${devData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: { requesterPhone: '+995555019999' },
    });
    expect(blockedRes.statusCode).toBe(429);
    // Retry-After должен реально долетать до HTTP-ответа (не только
    // до внутреннего RateLimitResult) — RedisRateLimitGuard.
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
  });
});
