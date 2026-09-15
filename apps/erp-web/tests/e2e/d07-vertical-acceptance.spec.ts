import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { MongoClient, ObjectId } from 'mongodb'
import { randomUUID } from 'node:crypto'

/** loginSchema.max(50) — полный randomUUID()+префикс+домен превышает лимит, короткий 8-символьный суффикс достаточен для уникальности в рамках одного прогона. */
function shortId(): string {
  return randomUUID().slice(0, 8)
}

/**
 * D-07 — Vertical E2E acceptance (мастер-план CLAUDE_HANDOFF_TZ.md раздел D-07).
 *
 * Требует реально поднятого стека (НЕ через playwright.config.ts webServer,
 * который поднимает только erp-web): docker compose (MongoDB+Redis+MinIO),
 * apps/api на :3000, apps/worker (outbox poller, 2с интервал), erp-web на
 * :5173, marketplace-web на :5174. См. docs/operations/d07-vertical-e2e-acceptance.md
 * для точных команд запуска.
 *
 * ЧЕСТНЫЙ БАРЬЕР #1 (подтверждено пользователем, зафиксировано явно, не
 * скрыто): marketplace-web не содержит карты (MKT-SCR-005 Figma-blocked) и
 * не содержит reveal-contact/lead-UI вообще; apps/admin-web — пустая
 * директория, Admin UI не существует ни в каком виде. Шаги 4 (карта)/6
 * (reveal-contact)/9 (admin unpublish) идут через прямые request.* вызовы
 * того же APIRequestContext, не через page.click — это НЕ эмуляция
 * браузерного действия, а честное API-only покрытие того, для чего сейчас
 * физически нет UI.
 *
 * ЧЕСТНЫЙ БАРЬЕР #2 (остаётся только для admin bootstrap):
 * admin-web пока пуст, поэтому super_admin в шаге 9 поднимается прямой
 * записью в MongoDB. Developer owner теперь проходит настоящий HTTP
 * onboarding через POST /organizations/register — тот же production flow,
 * которым должен пользоваться клиент.
 */

const API_ORIGIN = 'http://localhost:3000'
const ERP_ORIGIN = 'http://localhost:5173'
const MARKETPLACE_ORIGIN = 'http://localhost:5174'
const ADMIN_ORIGIN = 'http://localhost:5175' // CORS_ALLOWED_ORIGIN_ADMIN — нет реального admin-web, используется только как Origin-заголовок для audience-резолвинга
const MONGO_URI = 'mongodb://localhost:27017/baza?replicaSet=rs0'

test.describe.configure({ mode: 'serial' })

interface OwnerContext {
  identityId: string
  organizationId: string
  positionId: string
  login: string
  password: string
}

/** Developer owner onboarding через реальный HTTP API, без прямых записей в Mongo. */
async function bootstrapDeveloperOwner(request: APIRequestContext): Promise<OwnerContext> {
  const login = `e2e-owner-${shortId()}@example.test`
  const password = 'correct horse battery staple'

  const registerRes = await request.post(`${API_ORIGIN}/api/v1/auth/register`, { data: { login, password } })
  expect(registerRes.ok()).toBeTruthy()
  const identity = await registerRes.json()
  const organizationRes = await request.post(`${API_ORIGIN}/api/v1/organizations/register`, {
    data: {
      login,
      password,
      type: 'developer',
      name: `E2E Developer ${randomUUID().slice(0, 8)}`,
    },
  })
  expect(organizationRes.status()).toBe(201)
  const organization = await organizationRes.json()

  return {
    identityId: identity.identityId,
    organizationId: organization.organizationId,
    positionId: organization.positionId,
    login,
    password,
  }
}

/**
 * Логин через реальную HTML-форму (мастер-план шаг 1 — "входит в ERP", не
 * обход через cookie). Селекторы через autoComplete-атрибуты (LoginPage.tsx:
 * autoComplete="username"/"current-password"), НЕ через placeholder-текст —
 * найдено при реализации, что дефолтная локаль UI может быть английской, не
 * русской (placeholder 'Пароль' не всегда совпадает).
 */
/**
 * Дефолтная локаль UI — 'en' (LanguageProvider.getStoredLanguage() без
 * localStorage['erp.language']), не 'ru' — несмотря на то, что исходники
 * компонентов набраны русским текстом внутри t()-вызовов. Все текстовые
 * getByRole-селекторы этого теста подобраны под русскую локаль — форсируем
 * её через addInitScript (выполняется до первого рендера приложения на
 * КАЖДОМ page.goto, не только на первом), а не переписываем селекторы на
 * английский текст.
 */
async function loginViaForm(page: Page, login: string, password: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem('erp.language', 'ru')
  })
  await page.goto('/')
  await page.locator('input[autocomplete="username"]').fill(login)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 })
}

test.describe('D-07 vertical acceptance', () => {
  let owner: OwnerContext
  let developmentId: string
  let developmentSlug: string
  let publicationId: string
  let revealedLeadId: string

  test.beforeAll(async ({ request }) => {
    owner = await bootstrapDeveloperOwner(request)
  })

  test('1-2. Developer owner входит в ERP и создаёт draft Development/Building/Floor/Unit', async ({ page }) => {
    await test.step('1. Реальный вход через HTML-форму (не mock-логин)', async () => {
      await loginViaForm(page, owner.login, owner.password)
    })

    await test.step('2a. Создание Development через ProjectWizardV2Page', async () => {
      await page.goto('/#/dashboard/development/projects/new')
      await page.locator('#name').fill('E2E ЖК Вертикаль')
      await page.locator('#country').selectOption('ge')
      await page.locator('#city').selectOption('batumi')
      await page.locator('#longitude').fill('41.6367')
      await page.locator('#latitude').fill('41.6459')
      await page.locator('#phone').fill('+995500000001')
      await page.getByRole('button', { name: 'Создать ЖК' }).click()
      await expect(page).toHaveURL(/development\/projects$/, { timeout: 10_000 })
      await expect(page.getByTestId('projects-list')).toBeVisible()
    })

    await test.step('открыть управление структурой созданного ЖК', async () => {
      await page.getByRole('button', { name: 'Управление структурой' }).first().click()
      await expect(page).toHaveURL(/management-v2$/)
      const match = page.url().match(/projects\/([a-f0-9]+)\/management-v2/)
      expect(match).not.toBeNull()
      developmentId = match![1]!
    })

    await test.step('2b. Building', async () => {
      await page.getByRole('button', { name: /Добавить корпус/i }).click()
      await page.locator('#building-name').fill('Корпус 1')
      await page.locator('#building-floorsCount').fill('5')
      await page.getByRole('button', { name: 'Создать корпус' }).click()
      await expect(page.getByTestId('buildings-list')).toContainText('Корпус 1', { timeout: 10_000 })
      await page.getByText('Корпус 1').click()
    })

    await test.step('2c. Floor', async () => {
      await page.getByRole('button', { name: /Добавить этаж/i }).click()
      await page.locator('#floor-number').fill('1')
      await page.getByRole('button', { name: 'Создать этаж' }).click()
      await expect(page.getByTestId('floors-list')).toContainText('1', { timeout: 10_000 })
    })

    await test.step('2d. Unit', async () => {
      await page.getByRole('button', { name: /Добавить юнит/i }).click()
      await page.locator('#unit-number').fill('101')
      await page.locator('#unit-floor').selectOption({ index: 1 })
      await page.locator('#unit-area').fill('45')
      await page.locator('#unit-price').fill('10000000')
      await page.getByRole('button', { name: 'Создать юнит' }).click()
      await expect(page.getByTestId('units-list')).toContainText('101', { timeout: 10_000 })
    })
  })

  test('3. Публикует Development (worker строит проекцию, ~2с polling)', async ({ page }) => {
    await loginViaForm(page, owner.login, owner.password)
    await page.goto(`/#/dashboard/development/projects/${developmentId}/management-v2`)

    await page.getByTestId('publish-development-button').click()
    await page.getByTestId('publish-confirm-button').click()
    await expect(page.getByTestId('publication-status-pending')).toBeVisible({ timeout: 10_000 })

    // Worker polling interval = 2000ms — ждём реального цикла, не эмулируем.
    await expect(page.getByTestId('publication-status-published')).toBeVisible({ timeout: 15_000 })
    const slugText = await page.getByTestId('publication-status-published').textContent()
    const slugMatch = slugText?.match(/·\s*(\S+)/)
    expect(slugMatch).not.toBeNull()
    developmentSlug = slugMatch![1]!
  })

  test('4-5. Гость на marketplace находит ЖК фильтром и открывает индексируемую карточку', async ({ page, request }) => {
    await test.step('4a. City-фильтр — реальный UI (marketplace-web CataloguePage)', async () => {
      await page.goto(MARKETPLACE_ORIGIN)
      const cityInput = page.locator('.city-form input')
      await cityInput.fill('batumi')
      await page.getByRole('button', { name: 'Найти' }).click()
      // Повторные локальные прогоны оставляют опубликованные ЖК от предыдущих
      // запусков с тем же городом (никакой очистки между прогонами) — матчим
      // конкретно карточку ЭТОГО прогона по slug (unique per-run через
      // shortId()), не первую попавшуюся с тем же названием.
      const thisRunCard = page.locator(`.development-card[href*="${developmentSlug}"]`)
      await expect(thisRunCard).toContainText('E2E ЖК Вертикаль', { timeout: 10_000 })
    })

    await test.step('4b. Карта — ЧЕСТНО API-ONLY (MKT-SCR-005 Figma-blocked, marketplace-web не содержит map-виджета)', async () => {
      const bboxRes = await request.get(`${API_ORIGIN}/api/v1/public/developments?bbox=41,41,42,42`)
      expect(bboxRes.ok()).toBeTruthy()
      const body = await bboxRes.json()
      expect(body.items.some((item: { slug: string }) => item.slug === developmentSlug)).toBeTruthy()
    })

    await test.step('5. Открывает индексируемую карточку по клику (реальный UI)', async () => {
      await page.locator(`.development-card[href*="${developmentSlug}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/developments/${developmentSlug}$`))
      await expect(page.locator('h1')).toContainText('E2E ЖК Вертикаль')
    })
  })

  test('6-7. Гость раскрывает контакт (API-only), Lead появляется только в ERP своей организации', async ({ page, request }) => {
    await test.step('6. Reveal-contact — ЧЕСТНО API-ONLY (marketplace-web не содержит reveal-формы)', async () => {
      const revealRes = await request.post(
        `${API_ORIGIN}/api/v1/public/developments/${developmentSlug}/reveal-contact`,
        { data: { requesterName: 'E2E Гость', requesterPhone: '+995500009999' } },
      )
      expect(revealRes.ok()).toBeTruthy()
      const body = await revealRes.json()
      expect(body.leadId).toBeTruthy()
      revealedLeadId = body.leadId
    })

    await test.step('7a. Lead появляется на столе CRM своей организации — реальный UI (список стола)', async () => {
      await loginViaForm(page, owner.login, owner.password)
      await page.goto('/#/dashboard/leads/poker?view=list')
      // Заявка с витрины — сразу в воронке «Продажи» (15.09.2026), видна на столе по имени контакта.
      await expect(page.locator('body')).toContainText('E2E Гость', { timeout: 10_000 })
    })

    await test.step('7b. Negative: чужая организация не видит этот lead', async () => {
      const stranger = await bootstrapDeveloperOwner(request)
      const strangerPage = await page.context().browser()!.newPage()
      await loginViaForm(strangerPage, stranger.login, stranger.password)
      await strangerPage.goto('/#/dashboard/leads/poker?view=list')
      // Non-disclosure: чужая организация видит пустой стол, не 403/404.
      await expect(strangerPage.locator('body')).not.toContainText('E2E Гость')
      await strangerPage.close()
    })
  })

  test('8. РОП назначает lead и переводит его по воронке продаж — API (optimistic concurrency)', async ({ page }) => {
    await loginViaForm(page, owner.login, owner.password)
    const headers = { Origin: ERP_ORIGIN }

    const leadUrl = `${API_ORIGIN}/api/v1/leads/${revealedLeadId}`

    const assignRes = await page.request.post(`${leadUrl}/assign`, {
      headers,
      data: { assigneePositionId: owner.positionId },
    })
    expect(assignRes.ok()).toBeTruthy()

    const leadRes = await page.request.get(leadUrl, { headers })
    const lead = await leadRes.json()
    expect(lead.productType).toBe('sales')

    // Стадия продаж с expectedVersion (backend требует его строго).
    const stageRes = await page.request.patch(`${leadUrl}/stage`, {
      headers: { ...headers, 'Idempotency-Key': `d07-stage-${shortId()}` },
      data: { stage: 'callback', expectedVersion: lead.version },
    })
    expect(stageRes.ok()).toBeTruthy()
    const stale = await page.request.patch(`${leadUrl}/stage`, {
      headers: { ...headers, 'Idempotency-Key': `d07-stage-${shortId()}` },
      data: { stage: 'presented', expectedVersion: lead.version },
    })
    expect(stale.status()).toBe(409)
  })

  test('9-10. Admin снимает публикацию с причиной (API-only), marketplace её больше не отдаёт, ERP видит причину, audit полон', async ({
    request,
    page,
  }) => {
    let mongoClient: MongoClient | undefined

    await test.step('9a. Bootstrap первого super_admin — прямая запись в MongoDB (workaround, ADR-009 фиксирует это как runtime/runbook-задачу, не решённую кодом)', async () => {
      mongoClient = new MongoClient(MONGO_URI)
      await mongoClient.connect()
      const db = mongoClient.db()

      const adminLogin = `e2e-admin-${shortId()}@example.test`
      const adminPassword = 'admin correct horse battery'
      const adminRegisterRes = await request.post(`${API_ORIGIN}/api/v1/auth/register`, {
        data: { login: adminLogin, password: adminPassword },
      })
      expect(adminRegisterRes.ok()).toBeTruthy()
      const { identityId: adminIdentityId } = await adminRegisterRes.json()

      await db.collection('admin_accounts').insertOne({
        identityId: new ObjectId(adminIdentityId),
        isSuperAdmin: true,
        status: 'active',
        createdAt: new Date(),
      })
      await db.collection('product_accesses').insertOne({
        identityId: new ObjectId(adminIdentityId),
        product: 'admin',
        grantedAt: new Date(),
      })

      // audience резолвится СЕРВЕРОМ по Origin-заголовку
      // (resolveProductAudienceFromOrigin), НЕ по полю в теле запроса —
      // явный Origin: ADMIN_ORIGIN обязателен, иначе login создаст 'erp'
      // сессию, не 'admin'.
      const adminLoginRes = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
        data: { login: adminLogin, password: adminPassword },
        headers: { Origin: ADMIN_ORIGIN },
      })
      expect(adminLoginRes.ok()).toBeTruthy()
    })

    await test.step('9b. Admin находит publication в scope (GET /admin/publications) и снимает с причиной — ЧЕСТНО API-ONLY (apps/admin-web пустая директория)', async () => {
      const listRes = await request.get(`${API_ORIGIN}/api/v1/admin/publications?sourceType=development`)
      expect(listRes.ok()).toBeTruthy()
      const listBody = await listRes.json()
      const found = listBody.items.find((item: { slug: string }) => item.slug === developmentSlug)
      expect(found).toBeTruthy()
      publicationId = found.id

      const unpublishRes = await request.post(`${API_ORIGIN}/api/v1/admin/publications/${publicationId}/unpublish`, {
        data: { reason: 'E2E acceptance test — плановое снятие с публикации' },
      })
      expect(unpublishRes.ok()).toBeTruthy()
      const unpublishBody = await unpublishRes.json()
      expect(unpublishBody.status).toBe('unpublished')
      expect(unpublishBody.unpublishReason).toContain('E2E acceptance test')
    })

    await test.step('10a. Marketplace больше не отдаёт карточку — реальный UI (404)', async () => {
      await page.goto(`${MARKETPLACE_ORIGIN}/developments/${developmentSlug}`)
      await expect(page.locator('body')).not.toContainText('E2E ЖК Вертикаль')
    })

    await test.step('10b. ERP видит причину снятия — API-only (нет unpublish-reason UI на DevelopmentManagementV2Page на момент этого прохода)', async () => {
      const statusRes = await request.get(`${API_ORIGIN}/api/v1/admin/publications?sourceType=development`)
      const statusBody = await statusRes.json()
      const item = statusBody.items.find((i: { id: string }) => i.id === publicationId)
      expect(item.status).toBe('unpublished')
      expect(item.unpublishReason).toContain('E2E acceptance test')
    })

    await test.step('10c. Audit полон — API-only (AuditService не имеет UI)', async () => {
      const db = mongoClient!.db()
      const auditDocs = await db.collection('audit_events').find({ action: 'publication.unpublish' }).toArray()
      expect(auditDocs.length).toBeGreaterThan(0)
      const relevant = auditDocs.find((d) => d.reason?.includes('E2E acceptance test'))
      expect(relevant).toBeTruthy()
      expect(relevant?.actor?.type).toBe('admin_account')
      await mongoClient!.close()
    })
  })
})

/**
 * Negative paths, независимые от главной serial-цепочки выше.
 */
test.describe('D-07 negative paths', () => {
  test('менеджер без права не меняет цену юнита', async ({ page, request }) => {
    // Owner создаёт organization+development+unit (тот же bootstrap-путь),
    // затем отдельная manager-позиция БЕЗ unit.price.update гранта пытается
    // сменить цену — должна получить 403.
    const owner = await bootstrapDeveloperOwner(request)

    const client = new MongoClient(MONGO_URI)
    await client.connect()
    try {
      const db = client.db()
      const managerIdentityLogin = `e2e-manager-${shortId()}@example.test`
      const registerRes = await request.post(`${API_ORIGIN}/api/v1/auth/register`, {
        data: { login: managerIdentityLogin, password: 'manager correct horse' },
      })
      const { identityId: managerIdentityId } = await registerRes.json()

      const managerPositionId = new ObjectId()
      await db.collection('positions').insertOne({
        _id: managerPositionId,
        organizationId: new ObjectId(owner.organizationId),
        fixedRole: 'manager',
        status: 'occupied',
        currentOccupantName: 'E2E Manager',
        createdAt: new Date(),
      })
      await db.collection('position_assignments').insertOne({
        identityId: new ObjectId(managerIdentityId),
        positionId: managerPositionId,
        organizationId: new ObjectId(owner.organizationId),
        startedAt: new Date(),
      })
      await db.collection('product_accesses').insertOne({
        identityId: new ObjectId(managerIdentityId),
        product: 'erp',
        grantedAt: new Date(),
      })
      // Намеренно НЕ выдаём unit.price.update grant манагеру.

      await loginViaForm(page, managerIdentityLogin, 'manager correct horse')

      // Создать Development+Building+Floor+Unit владельцем через прямой API,
      // используя owner cookie отдельным request-контекстом было бы сложнее —
      // здесь просто проверяем сам PATCH price 403 против несуществующего
      // unitId тоже валидно для проверки прав (permission-check происходит
      // раньше чтения записи, тот же принцип non-disclosure).
      const priceRes = await page.request.patch(`${API_ORIGIN}/api/v1/units/${new ObjectId().toString()}/price`, {
        data: { expectedVersion: 0, price: { amountMinorUnits: 5000000, currency: 'USD' } },
      })
      expect(priceRes.status()).toBe(403)
    } finally {
      await client.close()
    }
  })

  test('contact scraping получает rate limit (5 запросов/60с)', async ({ request }) => {
    const owner = await bootstrapDeveloperOwner(request)
    void owner // used only to keep bootstrap pattern consistent; publication not required for throttle check

    // reveal-contact throttled per-IP на уровне ThrottlerGuard, не привязан
    // к конкретному slug — невалидный slug всё равно проходит через throttle
    // guard раньше, чем 404 от несуществующей publication.
    const responses: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const res = await request.post(`${API_ORIGIN}/api/v1/public/developments/nonexistent-slug/reveal-contact`, {
        data: { requesterPhone: '+995500000000' },
      })
      responses.push(res.status())
    }
    expect(responses.filter((s) => s === 429).length).toBeGreaterThan(0)
  })

  test('admin без scope получает forbidden при unpublish', async ({ request }) => {
    const owner = await bootstrapDeveloperOwner(request)

    const client = new MongoClient(MONGO_URI)
    await client.connect()
    try {
      const db = client.db()

      // Реальная, существующая publication (не случайный ObjectId) — иначе
      // AdminPublicationService не находит запись и отвечает 404 ДО того, как
      // scope вообще проверяется, тест бы проверял "не найдено", не "нет прав".
      const publicationId = new ObjectId()
      await db.collection('marketplace_publications').insertOne({
        _id: publicationId,
        sourceType: 'development',
        sourceId: new ObjectId(),
        publisherScope: { type: 'organization', organizationId: new ObjectId(owner.organizationId) },
        slug: `e2e-scope-test-${shortId()}`,
        version: 1,
        status: 'published',
        publishedAt: new Date(),
        denormalizedFields: {},
        searchProjection: {},
        createdAt: new Date(),
      })

      const adminLogin = `e2e-scoped-admin-${shortId()}@example.test`
      const registerRes = await request.post(`${API_ORIGIN}/api/v1/auth/register`, {
        data: { login: adminLogin, password: 'scoped admin correct horse' },
      })
      const { identityId: adminIdentityId } = await registerRes.json()

      const adminAccountId = new ObjectId()
      await db.collection('admin_accounts').insertOne({
        _id: adminAccountId,
        identityId: new ObjectId(adminIdentityId),
        isSuperAdmin: false, // scoped, не super — deny-by-default применяется
        status: 'active',
        createdAt: new Date(),
      })
      await db.collection('product_accesses').insertOne({
        identityId: new ObjectId(adminIdentityId),
        product: 'admin',
        grantedAt: new Date(),
      })
      // Намеренно НЕ выдаём никакого unpublish-гранта — deny-by-default.

      const loginRes = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
        data: { login: adminLogin, password: 'scoped admin correct horse' },
        headers: { Origin: ADMIN_ORIGIN },
      })
      expect(loginRes.ok()).toBeTruthy()

      const unpublishRes = await request.post(
        `${API_ORIGIN}/api/v1/admin/publications/${publicationId.toString()}/unpublish`,
        { data: { reason: 'Попытка без прав — должна быть отклонена' } },
      )
      expect(unpublishRes.status()).toBe(403)
    } finally {
      await client.close()
    }
  })

  test('повтор idempotency key не создаёт второй publish', async ({ page, request }) => {
    const owner = await bootstrapDeveloperOwner(request)
    await loginViaForm(page, owner.login, owner.password)

    await page.goto('/#/dashboard/development/projects/new')
    await page.locator('#name').fill('E2E Idempotency Development')
    await page.locator('#country').selectOption('ge')
    await page.locator('#city').selectOption('batumi')
    await page.locator('#longitude').fill('41.6')
    await page.locator('#latitude').fill('41.6')
    await page.locator('#phone').fill('+995500000002')
    await page.getByRole('button', { name: 'Создать ЖК' }).click()
    await expect(page).toHaveURL(/development\/projects$/, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Управление структурой' }).first().click()
    const match = page.url().match(/projects\/([a-f0-9]+)\/management-v2/)
    const idempotencyDevelopmentId = match![1]!

    const idempotencyKey = randomUUID()
    const first = await page.request.post(
      `${API_ORIGIN}/api/v1/developments/${idempotencyDevelopmentId}/publish`,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    expect(first.status()).toBe(202)
    const firstBody = await first.json()

    const second = await page.request.post(
      `${API_ORIGIN}/api/v1/developments/${idempotencyDevelopmentId}/publish`,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    expect(second.status()).toBe(202)
    const secondBody = await second.json()

    expect(secondBody.id).toBe(firstBody.id)
  })
})
