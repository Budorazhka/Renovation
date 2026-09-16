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
import type { OrganizationType } from '../../src/modules/organizations/schemas/organization.schema';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createRedisMockService } from './support/redis-mock';

/**
 * Реферальная сеть BAZA (N-26, решения владельца 16.09.2026) — HTTP на
 * реальной MongoDB replica set: суперадмин назначает куратора, риэлтор
 * вступает по ссылке, сотрудник чужого агентства не вступает, менеджер BAZA
 * отмечает пришедшую комиссию — куратору 7%, выплата, сторно.
 */
describe('Referral network — HTTP Integration (AppModule)', () => {
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
    for (const middleware of [
      correlationIdMiddleware,
      tenantContextMiddleware,
      adminContextMiddleware,
      marketplaceAccountContextMiddleware,
    ]) {
      fastifyInstance.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        if (isHealthCheckPath(req.url)) return;
        await middleware.use(req, reply, () => {});
      });
    }
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
  });

  afterEach(async () => {
    for (const name of [
      'referral_curators',
      'referral_memberships',
      'referral_requests',
      'curator_accruals',
      'deals',
      'deal_events',
      'contacts',
      'admin_accounts',
      'positions',
      'position_assignments',
      'organizations',
      'permission_grants',
      'identities',
      'sessions',
      'product_accesses',
      'audit_events',
      'outbox_events',
      'idempotency_records',
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

  interface Person {
    identityId: Types.ObjectId;
    login: string;
    organizationId: Types.ObjectId;
    positionId: Types.ObjectId;
    marketplaceCookie: string;
    erpCookie: string;
  }

  /** Владелец своей организации: независимый риэлтор или владелец агентства. */
  async function seedOwner(type: OrganizationType, name: string, displayName: string): Promise<Person> {
    const login = `${type}-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const { organizationId, positionId } = await organizationsService.createOrganizationWithOwner({
      type,
      name,
      ownerIdentityId: identityId,
    });
    await connection.collection('positions').updateOne({ _id: positionId }, { $set: { currentOccupantName: displayName } });
    return sessionsFor({ identityId, login, organizationId, positionId });
  }

  /** Сотрудник существующей организации. */
  async function seedEmployee(organizationId: Types.ObjectId, displayName: string): Promise<Person> {
    const login = `manager-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    await authService.grantErpAccess(identityId);
    const positionId = await organizationsService.createVacantPosition({ organizationId, fixedRole: 'manager' });
    await organizationsService.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: displayName,
      actorIdentityId: identityId,
      expectedOrganizationId: organizationId,
      correlationId: 'referral-integration-seed',
    });
    return sessionsFor({ identityId, login, organizationId, positionId });
  }

  async function sessionsFor(base: Omit<Person, 'marketplaceCookie' | 'erpCookie'>): Promise<Person> {
    const marketplace = await authService.login({ login: base.login, password: PASSWORD, audience: 'marketplace' });
    const erp = await authService.login({ login: base.login, password: PASSWORD, audience: 'erp' });
    return {
      ...base,
      marketplaceCookie: `baza_session=${marketplace.sessionToken}`,
      erpCookie: `baza_session=${erp.sessionToken}`,
    };
  }

  async function seedAdmin(isSuperAdmin: boolean): Promise<{ cookie: string; adminAccountId: Types.ObjectId }> {
    const login = `admin-${new Types.ObjectId().toString()}@example.test`;
    const identityId = await authService.registerIdentity({ login, password: PASSWORD });
    const account = await adminAccountService.createAdminAccount(superAdminContext(), {
      identityId,
      isSuperAdmin,
      correlationId: 'referral-integration-seed',
      idempotency: {
        actorIdentityId: new Types.ObjectId(),
        key: new Types.ObjectId().toString(),
        requestBody: { probe: new Types.ObjectId().toString() },
      },
    });
    const session = await authService.login({ login, password: PASSWORD, audience: 'admin' });
    return { cookie: `baza_session=${session.sessionToken}`, adminAccountId: account._id };
  }

  async function grant(adminAccountId: Types.ObjectId, resource: string, action: string): Promise<void> {
    await adminAccountService.grantPermission(superAdminContext(), {
      adminAccountId,
      resource,
      action,
      scope: 'global',
      correlationId: 'referral-integration-seed',
    });
  }

  async function seedPrimaryDeal(owner: Person, title: string): Promise<Types.ObjectId> {
    const dealId = new Types.ObjectId();
    await connection.collection('deals').insertOne({
      _id: dealId,
      organizationId: owner.organizationId,
      contactId: new Types.ObjectId(),
      ownerPositionId: owner.positionId,
      title,
      stage: 'deal',
      dealType: 'primary',
      participants: [],
      checklistItems: [],
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return dealId;
  }

  function post(url: string, cookie: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload });
  }

  function patch(url: string, cookie: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie }, payload });
  }

  /** Сделка агента настоящим путём ERP: POST /deals, тип — полем сделки. */
  async function createDealViaErp(owner: Person, title: string, dealType?: string): Promise<{ id: string; dealType: string; version: number }> {
    const contactId = new Types.ObjectId();
    await connection.collection('contacts').insertOne({
      _id: contactId,
      organizationId: owner.organizationId,
      name: 'Покупатель Квартиры',
      phone: '+995555112233',
      roles: ['buyer'],
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie: owner.erpCookie, 'idempotency-key': new Types.ObjectId().toString() },
      payload: { contactId: contactId.toString(), title, ...(dealType ? { dealType } : {}) },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  function get(url: string, cookie: string) {
    return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  }

  it('куратор приглашает по ссылке, деньги по сделке первички дают ему 7%, выплата и сторно', async () => {
    const superAdmin = await seedAdmin(true);
    const curator = await seedOwner('independent_realtor', 'ИП Кураторов', 'Анна Кураторова');
    const agent = await seedOwner('independent_realtor', 'ИП Агентов', 'Борис Агентов');

    // Куратора назначает BAZA — это и есть «проверенный BAZA».
    const appointed = await post('/admin/referral-network/curators', superAdmin.cookie, {
      identityId: curator.identityId.toString(),
      reason: 'Проверен, ведёт команду в Батуми',
    });
    expect(appointed.statusCode).toBe(200);
    const inviteCode: string = appointed.json().curators[0].inviteCode;
    expect(inviteCode).toHaveLength(8);

    // До регистрации ссылка показывает только имя куратора.
    const preview = await app.inject({ method: 'GET', url: `/api/v1/public/referral-invites/${inviteCode.toLowerCase()}` });
    expect(preview.json()).toEqual({ curatorName: 'Анна Кураторова' });

    const joined = await post('/marketplace/referral/join', agent.marketplaceCookie, { code: inviteCode });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().role).toBe('member');
    expect(joined.json().membership.curator.name).toBe('Анна Кураторова');

    // Повтор вступления не создаёт второе членство.
    const again = await post('/marketplace/referral/join', agent.marketplaceCookie, { code: inviteCode });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('REFERRAL_ALREADY_IN_TEAM');

    // Агент ведёт сделку в своей CRM. Без типа это вторичка, в «Комиссии» BAZA она не попадает.
    const created = await createDealViaErp(agent, 'Квартира в ЖК Солнечный');
    expect(created.dealType).toBe('secondary');
    const dealId = created.id;
    expect((await get('/admin/commissions', superAdmin.cookie)).json().items.map((d: { id: string }) => d.id)).not.toContain(dealId);

    // Агент отмечает, что это первичка.
    const retyped = await patch(`/deals/${dealId}`, agent.erpCookie, { expectedVersion: 0, dealType: 'primary' });
    expect(retyped.statusCode).toBe(200);
    expect(retyped.json()).toMatchObject({ dealType: 'primary', version: 1 });
    const commissions = await get('/admin/commissions', superAdmin.cookie);
    expect(commissions.json().items.map((d: { id: string }) => d.id)).toContain(dealId);

    const received = await post(`/admin/commissions/${dealId}/received`, superAdmin.cookie, {
      expectedVersion: 1,
      amountMinorUnits: 300_000,
      currency: 'USD',
    });
    expect(received.statusCode).toBe(200);
    expect(received.json().accrual).toMatchObject({
      accrued: true,
      amount: { amountMinorUnits: 21_000, currency: 'USD' },
    });

    // Начисление сделано по первичке — задним числом сделать её вторичкой нельзя.
    const locked = await patch(`/deals/${dealId}`, agent.erpCookie, { expectedVersion: 2, dealType: 'secondary' });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('DEAL_TYPE_LOCKED');
    // Название и прочее по-прежнему правятся.
    const renamed = await patch(`/deals/${dealId}`, agent.erpCookie, { expectedVersion: 2, title: 'Квартира 12, ЖК Солнечный' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().dealType).toBe('primary');

    // Кабинет куратора: команда и деньги.
    const mine = await get('/marketplace/referral/me', curator.marketplaceCookie);
    expect(mine.json().role).toBe('curator');
    expect(mine.json().curator.node.teamSize).toBe(1);
    expect(mine.json().curator.node.teamStatus).toBe('recruiting');
    expect(mine.json().curator.totals.due).toEqual([{ amountMinorUnits: 21_000, currency: 'USD' }]);

    const accruals = await get(`/admin/curator-payouts/${curator.identityId.toString()}/accruals`, superAdmin.cookie);
    const accrualId: string = accruals.json().accruals[0].id;
    const paid = await post(`/admin/curator-payouts/${curator.identityId.toString()}/pay`, superAdmin.cookie, {
      accrualIds: [accrualId],
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().paid).toBe(1);
    expect(paid.json().totals.paid).toEqual([{ amountMinorUnits: 21_000, currency: 'USD' }]);
    expect(paid.json().totals.due).toEqual([]);

    // Менеджер BAZA с правом на комиссии не может сторнировать выплаченное.
    const manager = await seedAdmin(false);
    await grant(manager.adminAccountId, 'commission', 'confirm');
    const cancelByManager = await post(`/admin/commissions/${dealId}/cancel`, manager.cookie, {
      expectedVersion: 3,
      reason: 'Ошибся суммой',
    });
    expect(cancelByManager.statusCode).toBe(409);
    expect(cancelByManager.json().error.code).toBe('CURATOR_ACCRUAL_ALREADY_PAID');

    // Суперадмин может — начисление становится reversed, отметка снимается.
    const cancelBySuper = await post(`/admin/commissions/${dealId}/cancel`, superAdmin.cookie, {
      expectedVersion: 3,
      reason: 'Ошибся суммой',
    });
    expect(cancelBySuper.statusCode).toBe(200);
    expect(cancelBySuper.json().accrualReversed).toBe(true);
    const afterCancel = await get('/marketplace/referral/me', curator.marketplaceCookie);
    expect(afterCancel.json().curator.totals.earned).toEqual([]);
  });

  it('сотрудник агентства не вступает в команду куратора из другой компании, а коллега куратора — вступает', async () => {
    const superAdmin = await seedAdmin(true);
    const agencyOwner = await seedOwner('agency', 'Агентство Один', 'Владелец Первый');
    const curator = await seedEmployee(agencyOwner.organizationId, 'Куратор Агентства');
    const colleague = await seedEmployee(agencyOwner.organizationId, 'Коллега Куратора');
    const otherAgency = await seedOwner('agency', 'Агентство Два', 'Владелец Второй');
    const stranger = await seedEmployee(otherAgency.organizationId, 'Чужой Сотрудник');

    const appointed = await post('/admin/referral-network/curators', superAdmin.cookie, {
      identityId: curator.identityId.toString(),
      reason: 'Лучший менеджер агентства',
    });
    const inviteCode: string = appointed.json().curators[0].inviteCode;

    const blocked = await post('/marketplace/referral/join', stranger.marketplaceCookie, { code: inviteCode });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('REFERRAL_COMPANY_MISMATCH');

    const accepted = await post('/marketplace/referral/join', colleague.marketplaceCookie, { code: inviteCode });
    expect(accepted.statusCode).toBe(200);

    // Руководитель агентства видит команду в ERP, без денег.
    const erpTree = await get('/referral-network/organization', agencyOwner.erpCookie);
    expect(erpTree.statusCode).toBe(200);
    expect(erpTree.json().curators).toHaveLength(1);
    expect(erpTree.json().curators[0].members.map((m: { person: { name: string } }) => m.person.name)).toEqual([
      'Коллега Куратора',
    ]);
    expect(erpTree.json().curators[0]).not.toHaveProperty('totals');

    // Чужое агентство этой команды не видит.
    const foreignTree = await get('/referral-network/organization', otherAgency.erpCookie);
    expect(foreignTree.json().curators).toHaveLength(0);

    // Суперадмин тоже не может нарушить правило компании.
    const forced = await post('/admin/referral-network/members', superAdmin.cookie, {
      memberIdentityId: stranger.identityId.toString(),
      curatorIdentityId: curator.identityId.toString(),
      reason: 'Попытка поставить вручную',
    });
    expect(forced.statusCode).toBe(409);
  });

  it('уход и смена куратора — только заявкой, BAZA решает её в индивидуальном порядке', async () => {
    const superAdmin = await seedAdmin(true);
    const first = await seedOwner('independent_realtor', 'ИП Первый', 'Первый Куратор');
    const second = await seedOwner('independent_realtor', 'ИП Второй', 'Второй Куратор');
    const agent = await seedOwner('independent_realtor', 'ИП Агент', 'Агент Сети');

    const firstCode: string = (
      await post('/admin/referral-network/curators', superAdmin.cookie, { identityId: first.identityId.toString(), reason: 'Проверен' })
    ).json().curators[0].inviteCode;
    const tree = await post('/admin/referral-network/curators', superAdmin.cookie, {
      identityId: second.identityId.toString(),
      reason: 'Проверен',
    });
    const secondCode: string = tree
      .json()
      .curators.find((c: { person: { identityId: string } }) => c.person.identityId === second.identityId.toString()).inviteCode;

    await post('/marketplace/referral/join', agent.marketplaceCookie, { code: firstCode });

    // Сам сменить куратора ссылкой нельзя.
    const direct = await post('/marketplace/referral/join', agent.marketplaceCookie, { code: secondCode });
    expect(direct.statusCode).toBe(409);

    const request = await post('/marketplace/referral/requests', agent.marketplaceCookie, {
      type: 'change_curator',
      reason: 'Работаю в другом районе',
      targetInviteCode: secondCode,
    });
    expect(request.statusCode).toBe(201);

    const duplicate = await post('/marketplace/referral/requests', agent.marketplaceCookie, {
      type: 'change_curator',
      reason: 'Ещё раз',
      targetInviteCode: secondCode,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('REFERRAL_REQUEST_PENDING');

    const decided = await post(`/admin/referral-network/requests/${request.json().id}/decide`, superAdmin.cookie, {
      decision: 'approved',
      comment: 'Одобрено по согласованию с обоими кураторами',
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe('approved');

    const mine = await get('/marketplace/referral/me', agent.marketplaceCookie);
    expect(mine.json().membership.curator.name).toBe('Второй Куратор');

    const history = await get(`/admin/referral-network/people/${agent.identityId.toString()}/history`, superAdmin.cookie);
    expect(history.json().items.map((h: { endReason: string | null }) => h.endReason)).toEqual([null, 'transferred']);
  });

  it('имя после регистрации меняет BAZA в админке: с причиной, в аудит; без гранта — 403, без должности — 409', async () => {
    const superAdmin = await seedAdmin(true);
    const curator = await seedOwner('independent_realtor', 'ИП Кураторов', 'Owner');
    await post('/admin/referral-network/curators', superAdmin.cookie, { identityId: curator.identityId.toString(), reason: 'Проверен' });

    const rename = (cookie: string, identityId: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/v1/admin/people/${identityId}`, headers: { cookie }, payload });

    const renamed = await rename(superAdmin.cookie, curator.identityId.toString(), { name: 'Анна Кураторова', reason: 'Попросила по телефону' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ identityId: curator.identityId.toString(), name: 'Анна Кураторова' });

    const tree = await get('/admin/referral-network', superAdmin.cookie);
    expect(tree.json().curators[0].person.name).toBe('Анна Кураторова');
    const audit = await connection.collection('audit_events').findOne({ action: 'person.rename' });
    expect(audit).toMatchObject({ reason: 'Попросила по телефону', before: { name: 'Owner' }, after: { name: 'Анна Кураторова' } });

    // Причина обязательна.
    expect((await rename(superAdmin.cookie, curator.identityId.toString(), { name: 'Без причины' })).statusCode).toBe(400);

    // Администратор без гранта person.rename — 403, с грантом — может.
    const manager = await seedAdmin(false);
    expect((await rename(manager.cookie, curator.identityId.toString(), { name: 'Кто-то', reason: 'Без права' })).statusCode).toBe(403);
    await grant(manager.adminAccountId, 'person', 'rename');
    expect((await rename(manager.cookie, curator.identityId.toString(), { name: 'Анна К.', reason: 'Опечатка' })).statusCode).toBe(200);

    // Человек только с маркетплейса: должности нет, менять нечего.
    const guestId = await authService.registerIdentity({ login: `guest-${new Types.ObjectId().toString()}@example.test`, password: PASSWORD });
    const guest = await rename(superAdmin.cookie, guestId.toString(), { name: 'Гость', reason: 'Проверка' });
    expect(guest.statusCode).toBe(409);
    expect(guest.json().error.code).toBe('PERSON_WITHOUT_POSITION');
  });

  it('без гранта администратор сеть не видит, а менеджер с правом на комиссии не правит сеть', async () => {
    const admin = await seedAdmin(false);
    expect((await get('/admin/referral-network', admin.cookie)).statusCode).toBe(403);

    await grant(admin.adminAccountId, 'commission', 'confirm');
    expect((await get('/admin/commissions', admin.cookie)).statusCode).toBe(200);

    const person = await seedOwner('independent_realtor', 'ИП Кто-то', 'Кто-то');
    const appoint = await post('/admin/referral-network/curators', admin.cookie, {
      identityId: person.identityId.toString(),
      reason: 'Без права',
    });
    expect(appoint.statusCode).toBe(403);
  });

  it('сделка агента без куратора отмечается без начисления с причиной, повтор и вторичка не проходят', async () => {
    const superAdmin = await seedAdmin(true);
    const agent = await seedOwner('independent_realtor', 'ИП Агент', 'Агент');
    const dealId = await seedPrimaryDeal(agent, 'Квартира');
    // Сделка без куратора: отметка ставится, начисления нет.
    const received = await post(`/admin/commissions/${dealId.toString()}/received`, superAdmin.cookie, {
      expectedVersion: 0,
      amountMinorUnits: 100_000,
      currency: 'GEL',
    });
    expect(received.statusCode).toBe(200);
    expect(received.json().accrual).toEqual({ accrued: false, reason: 'not_in_team' });

    // Повтор отметки не проходит: деньги уже отмечены.
    const twice = await post(`/admin/commissions/${dealId.toString()}/received`, superAdmin.cookie, {
      expectedVersion: 1,
      amountMinorUnits: 100_000,
      currency: 'GEL',
    });
    expect(twice.statusCode).toBe(400);

    const secondary = new Types.ObjectId();
    await connection.collection('deals').insertOne({
      _id: secondary,
      organizationId: agent.organizationId,
      contactId: new Types.ObjectId(),
      ownerPositionId: agent.positionId,
      title: 'Вторичка',
      stage: 'deal',
      dealType: 'secondary',
      participants: [],
      checklistItems: [],
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const secondaryMark = await post(`/admin/commissions/${secondary.toString()}/received`, superAdmin.cookie, {
      expectedVersion: 0,
      amountMinorUnits: 100_000,
      currency: 'GEL',
    });
    expect(secondaryMark.statusCode).toBe(400);
  });
});
