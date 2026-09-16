#!/usr/bin/env node
/**
 * Демо-сеть MLM на стенде — только через настоящий HTTP API, как это сделали
 * бы люди: риэлторы регистрируются в ERP, суперадмин BAZA назначает двух
 * кураторов, риэлторы вступают по коду из кабинета маркетплейса, агенты
 * заводят лиды и сделки (первичка и одна вторичка), менеджер BAZA отмечает
 * пришедшие комиссии и выплачивает куратору одно начисление. Ещё — агентство
 * с сотрудником-куратором (его руководитель видит «Кураторы компании» в ERP)
 * и отдельный демо-суперадмин, под которым админку показывают владельцу.
 *
 * Прямых записей в базу нет. Повторный запуск не плодит дублей: занятый
 * логин — вход, уже вступивший — пропуск, сделки ищутся по названию.
 *
 * Запуск (стенд baza-runtime):
 *   DEMO_ADMIN_LOGIN=... DEMO_ADMIN_PASSWORD=... node scripts/demo/seed-referral-network.mjs
 *
 * Переменные:
 *   API_URL             http://localhost:3000/api/v1
 *   ERP_ORIGIN          http://localhost:4175
 *   MARKETPLACE_ORIGIN  http://localhost:4173
 *   ADMIN_ORIGIN        http://localhost:4174
 *   DEMO_ADMIN_LOGIN    действующий суперадмин BAZA, от имени которого засев (обязательно)
 *   DEMO_ADMIN_PASSWORD его пароль (обязательно)
 *   DEMO_PASSWORD       пароль создаваемых риэлторов; без него — только для localhost
 */
import { randomUUID } from 'node:crypto';

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ORIGIN = {
  erp: process.env.ERP_ORIGIN ?? 'http://localhost:4175',
  marketplace: process.env.MARKETPLACE_ORIGIN ?? 'http://localhost:4173',
  admin: process.env.ADMIN_ORIGIN ?? 'http://localhost:4174',
};
const ADMIN_LOGIN = process.env.DEMO_ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD;
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(API_URL);
const PASSWORD = process.env.DEMO_PASSWORD ?? (isLocal ? 'demoPass123' : undefined);

if (!ADMIN_LOGIN || !ADMIN_PASSWORD) fail('Нужны DEMO_ADMIN_LOGIN и DEMO_ADMIN_PASSWORD суперадмина BAZA.');
if (!PASSWORD) fail('Для стенда не на localhost задайте DEMO_PASSWORD для создаваемых риэлторов.');

/** Кураторы и их команды. Независимый риэлтор: название организации — это он сам. */
const NETWORK = [
  {
    curator: { slug: 'nino', name: 'Нино Беридзе' },
    members: [
      { slug: 'giorgi', name: 'Георгий Абашидзе' },
      { slug: 'mariam', name: 'Мариам Кацарава' },
      { slug: 'davit', name: 'Давид Гелашвили' },
      { slug: 'anna', name: 'Анна Смирнова' },
      { slug: 'luka', name: 'Лука Джапаридзе' },
      { slug: 'tamar', name: 'Тамара Чхеидзе' },
    ],
  },
  {
    curator: { slug: 'irakli', name: 'Ираклий Табидзе' },
    members: [
      { slug: 'sofia', name: 'Софья Лебедева' },
      { slug: 'nika', name: 'Ника Долидзе' },
      { slug: 'ekaterina', name: 'Екатерина Орлова' },
    ],
  },
];

/** Сделки агентов: первичка идёт в «Комиссии» BAZA, вторичка — нет. `received` — деньги пришли. */
const DEALS = [
  { agent: 'giorgi', title: 'ЖК Batumi Sunset, кв. 1204', dealType: 'primary', commission: 3_000_00, received: 3_000_00 },
  { agent: 'mariam', title: 'ЖК Orbi City, кв. 2208', dealType: 'primary', commission: 4_500_00, received: 4_200_00 },
  { agent: 'davit', title: 'ЖК Alliance Palace, кв. 905', dealType: 'primary', commission: 2_800_00 },
  { agent: 'anna', title: 'Вторичка, ул. Руставели 12', dealType: 'secondary', commission: 1_500_00 },
  { agent: 'sofia', title: 'ЖК Porta Batumi, кв. 1710', dealType: 'primary', commission: 3_600_00, received: 3_600_00 },
];

/** Агентство: руководитель и сотрудники заводятся им самим в «Команде» ERP; куратор — сотрудник. */
const AGENCY = {
  name: 'Агентство Batumi Home',
  owner: { slug: 'agency-owner', name: 'Лаша Гогиберидзе' },
  curator: { slug: 'david', name: 'Давид Церетели' },
  members: [
    { slug: 'natia', name: 'Натия Квеселава' },
    { slug: 'sandro', name: 'Сандро Микеладзе' },
  ],
};

const DEMO_SUPER_ADMIN = 'demo-superadmin@baza.demo';

const login = (slug) => `demo-mlm-${slug}@baza.demo`;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Один запрос от имени аудитории. Cookie сессии — у каждого актора своя. */
async function call(actor, method, path, body, { idempotent = false, allow = [] } = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const headers = { Origin: ORIGIN[actor.audience], 'Content-Type': 'application/json' };
    if (actor.cookie) headers.Cookie = actor.cookie;
    if (idempotent) headers['Idempotency-Key'] = randomUUID();
    const response = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = response.headers.get('set-cookie');
    const session = setCookie?.match(/baza_session=([^;]+)/)?.[1];
    if (session) actor.cookie = `baza_session=${session}`;
    if (response.status === 429) {
      // Регистрация и вход ограничены по IP окном в минуту — ждём окно, а не падаем.
      process.stdout.write('  … лимит запросов, ждём 20 секунд\n');
      await sleep(20_000);
      continue;
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok && !allow.includes(response.status)) {
      fail(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
    }
    return { status: response.status, body: json };
  }
  fail(`${method} ${path}: лимит запросов не отпустил`);
}

async function signIn(audience, userLogin, password) {
  const actor = { audience, cookie: null };
  const res = await call(actor, 'POST', '/auth/login', { login: userLogin, password }, { allow: [401] });
  if (res.status !== 200) return null;
  if (res.body?.requires2fa) fail(`${userLogin}: вход требует 2FA — демо-сценарий такой аккаунт не использует.`);
  actor.identityId = res.body.identityId;
  return actor;
}

/** Риэлтор: регистрация в ERP (Identity + организация «независимый риэлтор»), при повторе — вход. */
async function ensureRealtor(person) {
  const userLogin = login(person.slug);
  const existing = await signIn('erp', userLogin, PASSWORD);
  if (existing) return { ...person, login: userLogin, identityId: existing.identityId, erp: existing };
  const erp = { audience: 'erp', cookie: null };
  await call(erp, 'POST', '/auth/register', { login: userLogin, password: PASSWORD });
  const org = await call(
    erp,
    'POST',
    '/organizations/register',
    { login: userLogin, password: PASSWORD, type: 'independent_realtor', name: person.name, ownerName: person.name },
    { idempotent: true },
  );
  console.log(`  + ${person.name} (${userLogin})`);
  return { ...person, login: userLogin, identityId: org.body.identityId, erp };
}

/** Сотрудник агентства: руководитель создаёт должность с логином (POST /team-users), как в «Команде» ERP. */
async function ensureEmployee(owner, person) {
  const userLogin = login(person.slug);
  let erp = await signIn('erp', userLogin, PASSWORD);
  if (!erp) {
    await call(owner.erp, 'POST', '/team-users', { name: person.name, role: 'manager', loginEmail: userLogin, password: PASSWORD });
    erp = await signIn('erp', userLogin, PASSWORD);
    if (!erp) fail(`${userLogin}: сотрудник создан, но не входит в ERP`);
    console.log(`  + ${person.name} (${userLogin}), сотрудник агентства`);
  }
  return { ...person, login: userLogin, identityId: erp.identityId, erp };
}

/** Демо-суперадмин: Identity регистрируется, админ-аккаунт выдаёт действующий суперадмин (POST /admin/accounts). */
async function ensureDemoSuperAdmin(admin) {
  if (await signIn('admin', DEMO_SUPER_ADMIN, PASSWORD)) return;
  const guest = { audience: 'admin', cookie: null };
  const registered = await call(guest, 'POST', '/auth/register', { login: DEMO_SUPER_ADMIN, password: PASSWORD }, { allow: [409] });
  let identityId = registered.body?.identityId;
  if (!identityId) {
    const found = await call(admin, 'GET', `/admin/referral-network/people?login=${encodeURIComponent(DEMO_SUPER_ADMIN)}`);
    identityId = found.body.person.identityId;
  }
  await call(admin, 'POST', '/admin/accounts', { identityId, isSuperAdmin: true }, { idempotent: true });
  console.log(`  + суперадмин ${DEMO_SUPER_ADMIN}`);
}

async function main() {
  console.log(`Стенд: ${API_URL}`);
  const admin = await signIn('admin', ADMIN_LOGIN, ADMIN_PASSWORD);
  if (!admin) fail('Суперадмин не вошёл: проверьте DEMO_ADMIN_LOGIN и DEMO_ADMIN_PASSWORD.');
  const me = await call(admin, 'GET', '/admin/me');
  if (!me.body?.isSuperAdmin) fail('Аккаунт не суперадмин: назначать кураторов может только суперадмин.');

  console.log('Админка');
  await ensureDemoSuperAdmin(admin);

  console.log('Риэлторы');
  const people = new Map();
  for (const team of NETWORK) {
    for (const person of [team.curator, ...team.members]) people.set(person.slug, await ensureRealtor(person));
  }

  console.log('Агентство');
  const agencyOwnerLogin = login(AGENCY.owner.slug);
  let agencyOwnerErp = await signIn('erp', agencyOwnerLogin, PASSWORD);
  if (!agencyOwnerErp) {
    agencyOwnerErp = { audience: 'erp', cookie: null };
    await call(agencyOwnerErp, 'POST', '/auth/register', { login: agencyOwnerLogin, password: PASSWORD });
    await call(
      agencyOwnerErp,
      'POST',
      '/organizations/register',
      { login: agencyOwnerLogin, password: PASSWORD, type: 'agency', name: AGENCY.name, ownerName: AGENCY.owner.name },
      { idempotent: true },
    );
    console.log(`  + ${AGENCY.name}, руководитель ${agencyOwnerLogin}`);
  }
  const agencyOwner = { login: agencyOwnerLogin, erp: agencyOwnerErp };
  for (const person of [AGENCY.curator, ...AGENCY.members]) people.set(person.slug, await ensureEmployee(agencyOwner, person));

  console.log('Кураторы и команды');
  let tree = await call(admin, 'GET', '/admin/referral-network');
  for (const team of [...NETWORK, { curator: AGENCY.curator, members: AGENCY.members }]) {
    const curator = people.get(team.curator.slug);
    let node = tree.body.curators.find((c) => c.person.identityId === curator.identityId);
    if (!node) {
      tree = await call(admin, 'POST', '/admin/referral-network/curators', {
        identityId: curator.identityId,
        reason: 'Демо: проверенный BAZA риэлтор, ведёт команду в Батуми',
      });
      node = tree.body.curators.find((c) => c.person.identityId === curator.identityId);
      console.log(`  + куратор ${curator.name}, код ${node.inviteCode}`);
    }
    for (const member of team.members) {
      const person = people.get(member.slug);
      const marketplace = await signIn('marketplace', person.login, PASSWORD);
      const joined = await call(marketplace, 'POST', '/marketplace/referral/join', { code: node.inviteCode }, { allow: [409] });
      if (joined.status === 200) console.log(`  + ${person.name} → ${curator.name}`);
    }
  }

  console.log('Сделки агентов');
  const dealIds = new Map();
  for (const deal of DEALS) {
    const agent = people.get(deal.agent);
    const list = await call(agent.erp, 'GET', '/deals?limit=100');
    let found = list.body.items.find((d) => d.title === deal.title);
    if (!found) {
      const lead = await call(
        agent.erp,
        'POST',
        '/leads',
        { requesterName: `Покупатель: ${deal.title}`, requesterPhone: `+99555500${String(DEALS.indexOf(deal) + 1).padStart(4, '0')}` },
        { idempotent: true },
      );
      const created = await call(
        agent.erp,
        'POST',
        '/deals',
        {
          contactId: lead.body.contact.id,
          leadId: lead.body.id,
          title: deal.title,
          stage: 'deal',
          dealType: deal.dealType,
          expectedCommission: { amountMinorUnits: deal.commission, currency: 'USD' },
        },
        { idempotent: true },
      );
      found = created.body;
      console.log(`  + ${agent.name}: ${deal.title} (${deal.dealType})`);
    }
    dealIds.set(deal.title, found);
  }

  console.log('Комиссии BAZA');
  for (const deal of DEALS.filter((d) => d.received)) {
    const current = dealIds.get(deal.title);
    if (current.commissionReceivedAt) continue;
    const res = await call(
      admin,
      'POST',
      `/admin/commissions/${current.id}/received`,
      { expectedVersion: current.version, amountMinorUnits: deal.received, currency: 'USD' },
      { allow: [409] },
    );
    if (res.status === 200) {
      const accrual = res.body.accrual;
      const note = accrual?.accrued
        ? `куратору ${(accrual.amount.amountMinorUnits / 100).toFixed(2)} USD`
        : `без начисления: ${accrual?.reason ?? 'нет куратора'}`;
      console.log(`  ✓ ${deal.title}: пришло ${(deal.received / 100).toFixed(2)} USD, ${note}`);
    }
  }

  console.log('Выплата');
  const firstCurator = people.get(NETWORK[0].curator.slug);
  const accruals = await call(admin, 'GET', `/admin/curator-payouts/${firstCurator.identityId}/accruals`);
  const due = accruals.body.accruals.filter((a) => a.status === 'accrued');
  const alreadyPaid = accruals.body.accruals.some((a) => a.status === 'paid');
  if (!alreadyPaid && due.length > 0) {
    await call(admin, 'POST', `/admin/curator-payouts/${firstCurator.identityId}/pay`, { accrualIds: [due[0].id] });
    console.log(`  ✓ ${firstCurator.name}: выплачено одно начисление, остальное ждёт выплаты`);
  }

  console.log('\nГотово. Кабинеты (пароль у всех — DEMO_PASSWORD, на localhost по умолчанию demoPass123):');
  console.log(`  админка BAZA: ${DEMO_SUPER_ADMIN} — «Сеть», «Комиссии», «Выплаты»`);
  console.log(`  куратор ${firstCurator.name}: ${firstCurator.login} — маркетплейс «Моя команда», ERP «Партнёры → MLM»`);
  console.log(`  агент ${people.get('giorgi').name}: ${people.get('giorgi').login} — ERP, сделка → «Финансы»; маркетплейс «Моя команда»`);
  console.log(`  руководитель агентства: ${agencyOwner.login} — ERP «Партнёры → MLM», кураторы компании`);
  console.log(`  куратор-сотрудник ${people.get('david').name}: ${people.get('david').login}`);
}

main().catch((error) => fail(error.stack ?? String(error)));
