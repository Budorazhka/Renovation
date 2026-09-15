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
import { ListingRepository, PropertyAssetRepository } from '@baza/property-assets';
import { MarketplacePublicationRepository } from '@baza/publication';
import { DevelopmentRepository } from '@baza/development';
import { createRedisMockService } from './support/redis-mock';
import { PublicationRequestedHandler } from '../../../worker/src/handlers/publication-requested.handler';
import { RedisService } from '../../src/shared/redis/redis.service';
import { MediaAssetRepository, MediaStorageService } from '@baza/media-storage';

describe('Public listing lead reveal flow — Integration (real HTTP + real MongoDB transactions)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let listingRepository: ListingRepository;
  let propertyAssetRepository: PropertyAssetRepository;
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
    listingRepository = moduleRef.get(ListingRepository);
    propertyAssetRepository = moduleRef.get(PropertyAssetRepository);
    publicationRepository = moduleRef.get(MarketplacePublicationRepository);
    publicationHandler = new PublicationRequestedHandler(
      publicationRepository,
      moduleRef.get(DevelopmentRepository),
      listingRepository,
      propertyAssetRepository,
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
      'listings',
      'property_assets',
      'duplicate_candidates',
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
    // Rate-limit счётчики (ratelimit:reveal-contact:ip:*/listing:*) должны
    // сбрасываться между тестами так же, как Mongo-коллекции — иначе тест,
    // исчерпавший лимит для своего IP/slug, "протекает" в следующий тест
    // (ioredis-mock не имеет реального TTL-истечения синхронно с ходом
    // тестов, счётчики живут до explicit flush).
    await redisMockService.client.flushall();
  });

  async function ownerCookie(prefix: string) {
    const login = `${prefix}-${new Types.ObjectId().toString()}@example.test`;
    const password = 'correct horse battery staple';
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { login, password } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: { login, password, type: 'agency', name: `${prefix} agency` },
    });
    expect(response.statusCode).toBe(201);
    const raw = response.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.match(/baza_session=[^;]+/)?.[0];
    if (!cookie) throw new Error('session cookie missing');
    return { cookie, organizationId: response.json().organizationId as string };
  }

  let counter = 0;
  async function seedPublishedListing(owner: { cookie: string; organizationId: string }) {
    counter += 1;
    const assetPayload = {
      propertyType: 'apartment',
      location: {
        country: 'GE',
        city: 'Batumi',
        address: `Rustaveli St ${counter}`,
        geo: { type: 'Point', coordinates: [41.6, 41.64] },
      },
      characteristics: { area: 60, rooms: 2 },
      representativePhone: `+995599${String(counter).padStart(6, '0')}`,
    };

    const assetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/property-assets',
      headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: owner.cookie },
      payload: assetPayload,
    });
    expect(assetRes.statusCode).toBe(201);
    const assetId = assetRes.json()._id;

    const listingRes = await app.inject({
      method: 'POST',
      url: `/api/v1/property-assets/${assetId}/listings`,
      headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: owner.cookie },
      payload: { dealType: 'sale', price: { amountMinorUnits: 8000000, currency: 'USD' } },
    });
    expect(listingRes.statusCode).toBe(201);
    const listingId = listingRes.json()._id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/property-assets/${assetId}/listings/${listingId}/activate`,
      headers: { cookie: owner.cookie },
    });

    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/property-assets/${assetId}/listings/${listingId}/publish`,
      headers: { cookie: owner.cookie, 'idempotency-key': `idem-${counter}` },
    });
    expect(publishRes.statusCode).toBe(202);

    const outboxDoc = await connection.collection('outbox_events').findOne({ eventType: 'PublicationRequested' });
    expect(outboxDoc).toBeTruthy();

    await publicationHandler.handle(outboxDoc as never);

    const pubDoc = await connection
      .collection('marketplace_publications')
      .findOne({ sourceType: 'listing', sourceId: new Types.ObjectId(listingId) });
    expect(pubDoc).toBeTruthy();
    expect(pubDoc!.status).toBe('published');

    return {
      assetId,
      listingId,
      slug: pubDoc!.slug as string,
      publicationId: pubDoc!._id,
      representativePhone: assetPayload.representativePhone,
    };
  }

  let ipCounter = 1;
  function nextIp() {
    ipCounter += 1;
    return `192.168.1.${ipCounter}`;
  }

  it('успешный reveal для опубликованного listing создаёт Contact, Lead, LeadEvent, audit и возвращает телефон', async () => {
    const owner = await ownerCookie('reveal-lead-owner');
    const listingData = await seedPublishedListing(owner);
    const ip = nextIp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
      remoteAddress: ip,
      headers: { referer: 'https://baza.sale/catalogue' },
      payload: {
        requesterName: 'Иван Покупатель',
        requesterPhone: '+995555112233',
        utm: { utm_source: 'google', utm_campaign: 'promo' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.phone).toBe(listingData.representativePhone);
    expect(body.leadId).toBeDefined();
    // Verify no internal fields leaked
    expect(body.organizationId).toBeUndefined();
    expect(body.publisherScope).toBeUndefined();
    expect(body.identityId).toBeUndefined();

    // Verify Contact
    const contact = await connection.collection('contacts').findOne({ phone: '+995555112233' });
    expect(contact).toBeTruthy();
    expect(contact!.organizationId.toString()).toBe(owner.organizationId);
    expect(contact!.name).toBe('Иван Покупатель');

    // Verify Lead
    const lead = await connection.collection('leads').findOne({ _id: new Types.ObjectId(body.leadId) });
    expect(lead).toBeTruthy();
    expect(lead!.organizationId.toString()).toBe(owner.organizationId);
    expect(lead!.contactId.toString()).toBe(contact!._id.toString());
    expect(lead!.stage).toBe('new');
    expect(lead!.source.route).toBe(`/listings/${listingData.slug}`);
    expect(lead!.source.publicationId.toString()).toBe(listingData.publicationId.toString());
    expect(lead!.source.referrer).toBe('https://baza.sale/catalogue');
    expect(lead!.source.utm).toEqual({ utm_source: 'google', utm_campaign: 'promo' });

    // Verify LeadEvent
    const leadEvent = await connection.collection('lead_events').findOne({ leadId: lead!._id });
    expect(leadEvent).toBeTruthy();
    expect(leadEvent!.stage).toBe('new');
    expect(leadEvent!.changedBy).toEqual({ type: 'system' });

    // Verify Audit Event
    const auditEvent = await connection.collection('audit_events').findOne({ resourceId: lead!._id });
    expect(auditEvent).toBeTruthy();
    expect(auditEvent!.action).toBe('lead.create_from_reveal');
    expect(auditEvent!.actor).toEqual({ type: 'system' });
  });

  it('повторный reveal тем же телефоном переиспользует Contact, но создаёт новый Lead', async () => {
    const owner = await ownerCookie('repeat-reveal-owner');
    const listingData = await seedPublishedListing(owner);
    const ip = nextIp();

    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: { requesterName: 'Иван', requesterPhone: '+995555998877' },
    });
    expect(res1.statusCode).toBe(200);
    const leadId1 = res1.json().leadId;

    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: { requesterName: 'Иван', requesterPhone: '+995555998877' },
    });
    expect(res2.statusCode).toBe(200);
    const leadId2 = res2.json().leadId;

    expect(leadId1).not.toBe(leadId2);

    const contactsCount = await connection.collection('contacts').countDocuments({ phone: '+995555998877' });
    expect(contactsCount).toBe(1);

    const leadsCount = await connection.collection('leads').countDocuments({ organizationId: new Types.ObjectId(owner.organizationId) });
    expect(leadsCount).toBe(2);
  });

  it('возвращает 404 для неизвестного slug', async () => {
    const ip = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/listings/non-existent-slug-xyz/reveal-contact',
      remoteAddress: ip,
      payload: { requesterPhone: '+995555123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('возвращает 404 для development publication через listing endpoint', async () => {
    const owner = await ownerCookie('dev-pub-owner');
    const devId = new Types.ObjectId();
    await connection.collection('developments').insertOne({
      _id: devId,
      organizationId: new Types.ObjectId(owner.organizationId),
      name: 'Development Alpha',
      status: 'active',
      location: { country: 'GE', city: 'Batumi', address: 'Sea St 1', geo: { type: 'Point', coordinates: [41.6, 41.64] } },
      contact: { phone: '+995555123456' },
      createdAt: new Date(),
    });

    // Seed published development publication
    await connection.collection('marketplace_publications').insertOne({
      sourceType: 'development',
      sourceId: devId,
      publisherScope: { type: 'organization', organizationId: new Types.ObjectId(owner.organizationId) },
      status: 'published',
      slug: 'dev-alpha-batumi',
      version: 1,
      denormalizedFields: {},
      searchProjection: {},
    });

    const ip = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/listings/dev-alpha-batumi/reveal-contact',
      remoteAddress: ip,
      payload: { requesterPhone: '+995555123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('возвращает 404 для неопубликованного listing', async () => {
    const owner = await ownerCookie('unpub-listing-owner');
    const assetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/property-assets',
      headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: owner.cookie },
      payload: {
        propertyType: 'apartment',
        location: { country: 'GE', city: 'Batumi', address: 'Draft St 1', geo: { type: 'Point', coordinates: [41.6, 41.64] } },
        characteristics: { area: 50 },
        representativePhone: '+995500111222',
      },
    });
    const assetId = assetRes.json()._id;

    const listingRes = await app.inject({
      method: 'POST',
      url: `/api/v1/property-assets/${assetId}/listings`,
      headers: { 'idempotency-key': new Types.ObjectId().toString(), cookie: owner.cookie },
      payload: { dealType: 'sale', price: { amountMinorUnits: 5000000, currency: 'USD' } },
    });
    const listingId = listingRes.json()._id;

    await connection.collection('marketplace_publications').insertOne({
      sourceType: 'listing',
      sourceId: new Types.ObjectId(listingId),
      publisherScope: { type: 'organization', organizationId: new Types.ObjectId(owner.organizationId) },
      status: 'publication_pending',
      slug: 'pending-listing-slug',
      version: 1,
      denormalizedFields: {},
      searchProjection: {},
    });

    const ip = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/listings/pending-listing-slug/reveal-contact',
      remoteAddress: ip,
      payload: { requesterPhone: '+995555123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('без телефона посетителя — показывает номер менеджера объекта, лид не создаётся', async () => {
    const owner = await ownerCookie('val-test-owner');
    const listingData = await seedPublishedListing(owner);
    const ip = nextIp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ phone: listingData.representativePhone });
    expect(
      await connection.collection('leads').countDocuments({ organizationId: new Types.ObjectId(owner.organizationId) }),
    ).toBe(0);
  });

  it('применяет rate-limit (429) при частых запросах', async () => {
    const owner = await ownerCookie('rate-limit-owner');
    const listingData = await seedPublishedListing(owner);
    const ip = nextIp();

    // Limit is 5 per 60s
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        payload: { requesterPhone: `+99555500000${i}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const blockedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
      remoteAddress: ip,
      payload: { requesterPhone: '+995555999999' },
    });
    expect(blockedRes.statusCode).toBe(429);
    // Retry-After должен реально долетать до HTTP-ответа (не только
    // до внутреннего RateLimitResult) — RedisRateLimitGuard.
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
  });

  describe('Idempotency-Key (guest reveal-contact retry/race)', () => {
    it('тот же Idempotency-Key и тот же payload — второй запрос возвращает тот же ответ, не создаёт второй Lead', async () => {
      const owner = await ownerCookie('idem-replay-owner');
      const listingData = await seedPublishedListing(owner);
      const ip = nextIp();
      const payload = { requesterName: 'Иван Повтор', requesterPhone: '+995555700001' };

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        headers: { 'idempotency-key': 'retry-key-1' },
        payload,
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        headers: { 'idempotency-key': 'retry-key-1' },
        payload,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());

      const leadCount = await connection.collection('leads').countDocuments({});
      expect(leadCount).toBe(1);
      const auditCount = await connection
        .collection('audit_events')
        .countDocuments({ action: 'lead.create_from_reveal' });
      expect(auditCount).toBe(1);
    });

    it('тот же Idempotency-Key, другой payload — 409 конфликт, не создаёт второй Lead', async () => {
      const owner = await ownerCookie('idem-conflict-owner');
      const listingData = await seedPublishedListing(owner);
      const ip = nextIp();

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        headers: { 'idempotency-key': 'conflict-key-1' },
        payload: { requesterPhone: '+995555700002' },
      });
      expect(first.statusCode).toBe(200);

      const conflicting = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        headers: { 'idempotency-key': 'conflict-key-1' },
        payload: { requesterPhone: '+995555700003' },
      });
      expect(conflicting.statusCode).toBe(409);

      const leadCount = await connection.collection('leads').countDocuments({});
      expect(leadCount).toBe(1);
    });

    it('параллельные запросы с одним Idempotency-Key и одним payload создают ровно один Lead', async () => {
      const owner = await ownerCookie('idem-race-owner');
      const listingData = await seedPublishedListing(owner);
      const ip = nextIp();
      const payload = { requesterPhone: '+995555700004' };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          app.inject({
            method: 'POST',
            url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
            remoteAddress: ip,
            headers: { 'idempotency-key': 'race-key-1' },
            payload,
          }),
        ),
      );

      for (const res of responses) {
        expect(res.statusCode).toBe(200);
      }
      const leadIds = new Set(responses.map((res) => res.json().leadId));
      expect(leadIds.size).toBe(1);

      const leadCount = await connection.collection('leads').countDocuments({});
      expect(leadCount).toBe(1);
      const auditCount = await connection
        .collection('audit_events')
        .countDocuments({ action: 'lead.create_from_reveal' });
      expect(auditCount).toBe(1);
    });

    it('повтор без Idempotency-Key сохраняет прежнее поведение — каждый запрос создаёт новый Lead', async () => {
      const owner = await ownerCookie('idem-compat-owner');
      const listingData = await seedPublishedListing(owner);
      const ip = nextIp();
      const payload = { requesterPhone: '+995555700005' };

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        payload,
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/public/listings/${listingData.slug}/reveal-contact`,
        remoteAddress: ip,
        payload,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().leadId).not.toBe(first.json().leadId);

      const leadCount = await connection.collection('leads').countDocuments({});
      expect(leadCount).toBe(2);
    });
  });
});
