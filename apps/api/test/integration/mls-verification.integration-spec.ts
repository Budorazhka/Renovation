import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { OrganizationsModule } from '../../src/modules/organizations/organizations.module';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { OrganizationRepository } from '../../src/modules/organizations/repository/organization.repository';
import { CommunityModule } from '../../src/modules/community/community.module';
import { CommunityService } from '../../src/modules/community/community.service';
import { ErrorCode } from '../../src/shared/errors/error-codes';

/**
 * N-10 (roadmap-2026-09.md, решение владельца 11.09.2026): биржа MLS
 * (`community` type:'exchange') видна и доступна для публикации только
 * проверенным агентствам и риэлторам. Застройщик не видит её вообще,
 * независимо от верификации.
 *
 * Проверяется на настоящей MongoDB: до этой работы биржу видели все
 * организации, включая застройщиков, а верификации не существовало вовсе
 * (community-forum-exchange.md, открытый пункт 4).
 */
describe('N-10: верификация MLS — доступ к бирже (real MongoDB)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let organizationsService: OrganizationsService;
  let organizationRepository: OrganizationRepository;
  let communityService: CommunityService;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();

    process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY ??= 'test-access-key';
    process.env.MINIO_SECRET_KEY ??= 'test-secret-key';
    process.env.MINIO_BUCKET_PRIVATE ??= 'test-private';
    process.env.MINIO_BUCKET_PUBLIC ??= 'test-public';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(replSet.getUri()),
        OrganizationsModule,
        CommunityModule,
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    organizationsService = moduleRef.get(OrganizationsService);
    organizationRepository = moduleRef.get(OrganizationRepository);
    communityService = moduleRef.get(CommunityService);
    // `.compile()` не запускает onModuleInit (нужен полноценный `.init()`
    // приложения) — секция 'exchange' иначе не была бы засеяна, тот же
    // приём, что в community-author-snapshot.integration-spec.ts.
    await communityService.seedDefaultsIfEmpty();
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    // community_sections не трогаем: засеяны один раз в beforeAll, тесты их
    // только читают (createThread ищет sectionId 'exchange').
    await connection.collection('organizations').deleteMany({});
    await connection.collection('community_threads').deleteMany({});
    await connection.collection('community_replies').deleteMany({});
    await connection.collection('audit_events').deleteMany({});
    await connection.collection('idempotency_records').deleteMany({});
  });

  async function seedOrganization(type: 'agency' | 'developer' | 'independent_realtor', name: string) {
    const organizationId = new Types.ObjectId();
    await connection.collection('organizations').insertOne({
      _id: organizationId,
      type,
      name,
      status: 'active',
      mlsVerified: false,
      createdAt: new Date(),
    });
    return organizationId;
  }

  function idempotency(key: string) {
    return { identityId: new Types.ObjectId(), operation: 'createCommunityThread', key, requestBody: { key } };
  }

  async function createExchangeThread(organizationId: Types.ObjectId, key: string) {
    return communityService.createThread({
      organizationId,
      positionId: new Types.ObjectId(),
      identityId: new Types.ObjectId(),
      idempotencyKey: key,
      data: {
        type: 'exchange',
        sectionId: 'exchange',
        title: 'Ищу клиента под аренду',
        excerpt: 'Ищу клиента',
        body: 'Ищу клиента под аренду в центре',
        exchange: {
          intent: 'client_handover',
          side: 'supply',
          dealKind: 'rent',
          location: 'Batumi',
          amount: '500 USD',
        },
      },
    });
  }

  it('adminVerifyMls отклоняет застройщика — верифицировать нечего, биржу он не увидит в любом случае', async () => {
    const developerId = await seedOrganization('developer', 'Застройщик Прайм');

    await expect(
      organizationsService.adminVerifyMls({
        id: developerId,
        reason: 'Ошибочная заявка на верификацию застройщика',
        actorId: new Types.ObjectId(),
        correlationId: 'mls-dev-1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

    const organization = await organizationRepository.findById(developerId);
    expect(organization?.mlsVerified).toBe(false);
  });

  it('adminVerifyMls/adminRevokeMlsVerification меняют флаг и пишут аудит', async () => {
    const agencyId = await seedOrganization('agency', 'Агентство Верное');
    const actorId = new Types.ObjectId();

    await organizationsService.adminVerifyMls({
      id: agencyId,
      reason: 'Проверено по телефону и документам агентства',
      actorId,
      correlationId: 'mls-verify-1',
    });

    let organization = await organizationRepository.findById(agencyId);
    expect(organization?.mlsVerified).toBe(true);
    const verifyAudit = await connection
      .collection('audit_events')
      .findOne({ action: 'organization.mls_verify', resourceId: agencyId });
    expect(verifyAudit?.after).toMatchObject({ mlsVerified: true });

    await organizationsService.adminRevokeMlsVerification({
      id: agencyId,
      reason: 'Документы агентства больше не действительны',
      actorId,
      correlationId: 'mls-revoke-1',
    });

    organization = await organizationRepository.findById(agencyId);
    expect(organization?.mlsVerified).toBe(false);
    const revokeAudit = await connection
      .collection('audit_events')
      .findOne({ action: 'organization.mls_revoke', resourceId: agencyId });
    expect(revokeAudit?.after).toMatchObject({ mlsVerified: false });
  });

  it('неверифицированное агентство не может создать заявку биржи', async () => {
    const agencyId = await seedOrganization('agency', 'Агентство Новичок');

    await expect(createExchangeThread(agencyId, 'ex-unverified-1')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });

    expect(await connection.collection('community_threads').countDocuments({})).toBe(0);
  });

  it('застройщик не может создать заявку биржи, даже будучи mlsVerified в БД напрямую', async () => {
    const developerId = await seedOrganization('developer', 'Застройщик Обходчик');
    await connection.collection('organizations').updateOne({ _id: developerId }, { $set: { mlsVerified: true } });

    await expect(createExchangeThread(developerId, 'ex-developer-1')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('верифицированное агентство создаёт заявку, видит её в списке и по id; неверифицированное и застройщик — нет', async () => {
    const verifiedAgencyId = await seedOrganization('agency', 'Агентство Проверенное');
    await organizationsService.adminVerifyMls({
      id: verifiedAgencyId,
      reason: 'Проверено по телефону и документам агентства',
      actorId: new Types.ObjectId(),
      correlationId: 'mls-verify-2',
    });
    const unverifiedAgencyId = await seedOrganization('agency', 'Агентство Непроверенное');
    const developerId = await seedOrganization('developer', 'Застройщик Сторонний');
    const realtorId = await seedOrganization('independent_realtor', 'Риэлтор Верный');
    await organizationsService.adminVerifyMls({
      id: realtorId,
      reason: 'Проверено по телефону и документам риэлтора',
      actorId: new Types.ObjectId(),
      correlationId: 'mls-verify-3',
    });

    const created = (await createExchangeThread(verifiedAgencyId, 'ex-verified-1')) as { id: string };

    // Владелец заявки и другой верифицированный участник биржи видят её.
    const seenByOwner = await communityService.getThread(created.id, verifiedAgencyId);
    expect(seenByOwner.id).toBe(created.id);
    const seenByPeer = await communityService.getThread(created.id, realtorId);
    expect(seenByPeer.id).toBe(created.id);

    // Неверифицированное агентство и застройщик получают тот же NOT_FOUND,
    // что и для реально несуществующей темы — не должны отличить "скрыто"
    // от "не существует".
    await expect(communityService.getThread(created.id, unverifiedAgencyId)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(communityService.getThread(created.id, developerId)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    // Список биржи: видна верифицированным, пуста для остальных.
    const listForOwner = await communityService.listExchangeDeals({}, verifiedAgencyId);
    expect(listForOwner.items.map((t) => t.id)).toContain(created.id);

    const listForUnverified = await communityService.listExchangeDeals({}, unverifiedAgencyId);
    expect(listForUnverified.items).toHaveLength(0);

    const listForDeveloper = await communityService.listExchangeDeals({}, developerId);
    expect(listForDeveloper.items).toHaveLength(0);

    // Общий список тем (без явного type=exchange) тоже не протаскивает
    // биржу мимо фильтра для неподходящей организации.
    const mixedListForUnverified = await communityService.listThreads({}, unverifiedAgencyId);
    expect(mixedListForUnverified.items.map((t) => t.id)).not.toContain(created.id);
  });

  it('неверифицированный участник не может ответить на заявку биржи, даже зная её id', async () => {
    const verifiedAgencyId = await seedOrganization('agency', 'Агентство Проверенное-2');
    await organizationsService.adminVerifyMls({
      id: verifiedAgencyId,
      reason: 'Проверено по телефону и документам агентства',
      actorId: new Types.ObjectId(),
      correlationId: 'mls-verify-4',
    });
    const unverifiedAgencyId = await seedOrganization('agency', 'Агентство Непроверенное-2');

    const created = (await createExchangeThread(verifiedAgencyId, 'ex-reply-1')) as { id: string };

    await expect(
      communityService.createReply({
        threadId: created.id,
        organizationId: unverifiedAgencyId,
        positionId: new Types.ObjectId(),
        identityId: new Types.ObjectId(),
        idempotencyKey: 'reply-unverified-1',
        data: { body: 'Мне интересно' },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    expect(await connection.collection('community_replies').countDocuments({})).toBe(0);
  });
});
