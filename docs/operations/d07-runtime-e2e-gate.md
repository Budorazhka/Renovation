# D-07: Playwright runtime E2E gate

Детальный runbook для `apps/e2e-runtime` — Playwright-suite, управляющий
реальным браузером против реально запущенных HTTP-процессов (api,
marketplace-web, admin-web, backed by real MongoDB/Redis/MinIO). Это НЕ
`mongodb-memory-server`-based unit/integration тесты из `apps/api/test/` —
те проверяют бизнес-логику в изоляции, этот gate проверяет, что реальные
собранные артефакты реально работают вместе через реальную сеть.

Этот документ дополняет `docs/operations/runtime-release-gate.md` (общее
описание Docker Compose runtime-стека) — читайте оба.

## Зачем отдельный gate, а не просто integration-тесты

`apps/api/test/integration` гоняется против `MongoMemoryReplSet` — быстрая,
детерминированная проверка бизнес-логики, но она никогда не проходит через
реальный nginx-прокси, реальный CORS, реальные cookie между разными
origin/портами, реальный MinIO presigned URL, реальный worker outbox poll с
реальной задержкой. D-07 закрывает именно этот класс рисков.

## Обязательные переменные окружения

Все переопределяемы, дефолты рассчитаны на `compose.runtime.yml`:

| Переменная | Дефолт | Назначение |
| --- | --- | --- |
| `RUNTIME_API_URL` | `http://localhost:3000` | Origin API-процесса |
| `RUNTIME_API_BASE_PATH` | `/api/v1` | Префикс API-путей |
| `RUNTIME_MARKETPLACE_URL` | `http://localhost:4173` | marketplace-web origin, также `baseURL` для `page.goto('/')` |
| `RUNTIME_MARKETPLACE_ORIGIN` | = `RUNTIME_MARKETPLACE_URL` | Значение `Origin`-заголовка для marketplace-audience запросов (ADR-004 — сервер резолвит audience по Origin, не по полю в теле) |
| `RUNTIME_ADMIN_URL` | `http://localhost:4174` | admin-web origin |
| `RUNTIME_ADMIN_ORIGIN` | = `RUNTIME_ADMIN_URL` | `Origin` для admin-audience запросов |
| `RUNTIME_MONGO_URI` | `mongodb://localhost:27017/baza?replicaSet=rs0` | Прямое Mongo-подключение для seed-скрипта (`fixtures/seed-admin.ts`) и preflight TCP-проверки |
| `RUNTIME_MONGO_HOST` / `RUNTIME_MONGO_PORT` | `localhost` / `27017` | Preflight TCP-проверка отдельно от полного URI |
| `RUNTIME_REDIS_HOST` / `RUNTIME_REDIS_PORT` | `localhost` / `6379` | Preflight PING-проверка |
| `REDIS_PASSWORD` | `dev_redis_password` | Preflight Redis AUTH (тот же дефолт, что `compose.runtime.yml`) |
| `RUNTIME_MINIO_URL` | `http://localhost:9000` | Preflight `/minio/health/live` проверка |

Для сценария с загрузкой медиа через браузер compose должен получать два
адреса MinIO, доступных с хоста: `MINIO_ENDPOINT` (presigned upload) и
`MINIO_PUBLIC_BASE_URL` (URL derivative-файлов, возвращаемый API). Например,
при занятом стандартном порту:

```powershell
$env:MINIO_ENDPOINT='http://host.docker.internal:9100'
$env:MINIO_PUBLIC_BASE_URL='http://localhost:9100/baza-public'
```

Первый адрес виден из контейнеров и браузера, второй — именно из браузера;
это разные роли и намеренно не объединяются в одну переменную.

Одного адреса мало: публичный бакет должен быть открыт на чтение, иначе MinIO
отвечает 403 на любую публичную ссылку и в браузере не видно ни фото объектов,
ни аватаров, ни картинок новостей. С 16.09.2026 это делает сам `minio-init`
(`mc anonymous set download`), отдельных действий не нужно. Приватный бакет
остаётся закрытым: его файлы отдаются только по временной подписанной ссылке.

Переменные для самих web/api-процессов (`CORS_ALLOWED_ORIGIN_MARKETPLACE`,
`CORS_ALLOWED_ORIGIN_ADMIN`, `VITE_API_BASE_URL`, Mongo/Redis/MinIO
credentials) — см. `.env.runtime.example` и
`docs/operations/runtime-release-gate.md`.

## Локальный запуск

### Путь 1 (основной): `compose.runtime.yml`, всё в Docker

```powershell
Copy-Item .env.runtime.example .env
pnpm runtime:up
pnpm runtime:preflight
pnpm runtime:e2e
```

`pnpm runtime:e2e` эквивалентен `pnpm --filter @baza/e2e-runtime test:e2e`
= `playwright test` внутри `apps/e2e-runtime`. Playwright's `globalSetup`
(`apps/e2e-runtime/src/global-setup.ts`) сам запускает тот же
`runPreflight()`, что и `pnpm runtime:preflight` — отдельный ручной прогон
preflight выше не обязателен для самого гейта, но полезен для быстрой
диагностики ДО того, как запускать более медленный Playwright.

### Путь 2 (лёгкий, для быстрой итерации): `compose.dev.yml` + `pnpm dev`

Поднимает только data-services в Docker, а api/marketplace-web/admin-web —
как обычные Node/Vite процессы на хосте (быстрее пересобираются на каждое
изменение кода, чем полный Docker image rebuild).

```powershell
Copy-Item .env.runtime.example .env
docker compose -f infrastructure/compose/compose.dev.yml up -d
pnpm --filter api dev
```

В отдельных терминалах — ни у marketplace-web, ни у admin-web нет
настроенного Vite dev-прокси (`server.proxy`), поэтому `VITE_API_BASE_URL`
должен явно указывать на bare `apps/api` origin, а не относительный
`/api/v1` (без nginx впереди относительный путь резолвился бы в сам
Vite dev-server, не в API):

```powershell
$env:VITE_API_BASE_URL="http://localhost:3000/api/v1"; pnpm --filter marketplace-web dev -- --port 4173
```

```powershell
$env:VITE_API_BASE_URL="http://localhost:3000/api/v1"; pnpm --filter admin-web dev -- --port 4175
```

Порт admin-web намеренно **4175**, не 4174, в этом пути — оба Vite-приложения
по умолчанию слушают 5173, явные разные порты обязательны для одновременного
запуска; 4174 зарезервирован под compose.runtime.yml's nginx-fronted
admin-web, чтобы не путать два способа запуска одним и тем же портом. Тогда
`RUNTIME_ADMIN_URL=http://localhost:4175` при запуске Playwright этим путём.

Также нужен реальный CORS origin на API-стороне для порта 4175, если он
отличается от `.env`'s `CORS_ALLOWED_ORIGIN_ADMIN` — либо переопределить
`CORS_ALLOWED_ORIGIN_ADMIN=http://localhost:4175` в окружении процесса
`api dev`, либо запускать admin-web dev-сервер на 4174 (том же порту, что
уже настроен в `.env.runtime.example`) — тогда переопределять ничего не
нужно, но `compose.runtime.yml`'s admin-web (если он тоже поднят) будет
конфликтовать за порт. Не запускайте оба пути одновременно на одних портах.

```powershell
pnpm --filter @baza/e2e-runtime test:e2e
```

### CI

Workflow `.github/workflows/runtime-release-gate.yml` запускает тот же gate на
чистом `ubuntu-latest`: frozen install, typecheck, unit/integration tests,
build, Chromium с system dependencies, Compose runtime, preflight и реальный
Playwright. Он срабатывает на каждый pull request, а также на push в `main` и
`codex/integration`. При ошибке сохраняются Playwright report/trace/video и
логи Compose; в любом исходе job останавливает только свой runtime stack.

Ключевые команды workflow:

```bash
pnpm install --frozen-lockfile
pnpm runtime:up
pnpm runtime:preflight
pnpm --filter @baza/e2e-runtime exec playwright install --with-deps chromium
pnpm runtime:e2e
pnpm runtime:down
```

CI намеренно задаёт `MINIO_ENDPOINT=http://host.docker.internal:9000` для
presigned upload из контейнеров и `MINIO_PUBLIC_BASE_URL=http://localhost:9000/baza-public`
для браузера. Credentials в workflow — только локальные тестовые значения и не
являются production secrets.

Чтобы это имя резолвилось, нужны ДВЕ вещи, а не одна:

1. `extra_hosts: host.docker.internal:host-gateway` в `compose.runtime.yml` —
   резолв **внутри контейнеров** (api, worker).
2. Запись `127.0.0.1 host.docker.internal` в `/etc/hosts` **самого раннера** —
   резолв у **браузера**, который на Linux работает на хосте, а не в контейнере.
   Это отдельный шаг workflow.

Второй пункт был описан в плане (`docs/codex/plans/2026-08-30-runtime-ci-gate.md`,
задача №3), но не реализован, а этот документ утверждал, что одного
host-gateway mapping достаточно. Из-за расхождения тест
`03-publishing-wizard` падал на КАЖДОМ прогоне гейта с 30.08.2026: API
подписывал ссылку на `host.docker.internal`, браузер её не резолвил, PUT в
MinIO не уходил, `confirm` не наступал, тест умирал по таймауту. Исправлено
01.09.2026.

## Оркестрация: почему именно так

`playwright.config.ts` НЕ содержит `webServer`-блок и не запускает процессы
сам — оркестрация процессов целиком делегирована `docker compose`
(Путь 1) или `pnpm --filter <app> dev` (Путь 2), оба уже умеют это
надёжно (healthchecks, restart policies, логирование). Playwright's
единственная ответственность здесь — `globalSetup`, который ТОЛЬКО проверяет
готовность (через `scripts/runtime/preflight.mjs`) и отказывается запускать
suite при любом пробеле; он не пытается сам поднимать инфраструктуру.
Это осознанный выбор: `webServer` в Playwright умеет управлять одним
процессом неплохо, но здесь нужно координировать шесть сервисов с
зависимостями между ними (Mongo replSet init → API readiness → web-контейнеры)
— то, что `docker compose`'s `depends_on: condition: service_healthy`
уже решает лучше, чем переизобретение того же в Playwright-конфиге.

## Размещение пакета и почему

`apps/e2e-runtime/` — новый workspace-пакет, покрыт уже существующим
`pnpm-workspace.yaml`'s `apps/*` glob (изменение `pnpm-workspace.yaml` не
понадобилось). Кросс-приложенческий suite (marketplace-web + admin-web +
api) логически не принадлежит ни одному конкретному app-пакету, но и не
является общей библиотекой (`packages/*`) — `apps/*` точнее отражает, что
это исполняемый артефакт (Playwright suite запускается, не импортируется).

## Seed-скрипт для первого super_admin

`apps/e2e-runtime/src/fixtures/seed-admin.ts` — **test/e2e fixture only,
никогда не запускать против реальной production базы**. Подробное
обоснование в докблоке самого файла; кратко: `AdminAccountService.
createAdminAccount()` (apps/api) всегда требует уже аутентифицированный
super_admin `AdminContext` — честный дизайн (ADR-009, self-escalation
prevention), но означает, что окружение с нулём admin-аккаунтов не имеет
HTTP-пути создать первый. Скрипт подключается напрямую к MongoDB и
вставляет `identities` + `admin_accounts` + `product_accesses` документы,
зеркалящие ровно то, что создал бы `AdminAccountService.createAdminAccount`
+ `AuthService.registerIdentity` + `AuthService.grantAdminAccess` вместе,
включая ТОТ ЖЕ механизм хеширования пароля (`argon2`, тот же пакет, что
`apps/api`), поэтому засеянный админ реально логинится через настоящий
`POST /auth/login`, а не в обход логина.

Ручной запуск (для отладки вне Playwright):

```powershell
node apps/e2e-runtime/src/fixtures/seed-admin.ts my-admin@example.com "SomePassword1!" superadmin
```

(четвёртый аргумент — что угодно, кроме литерала `scoped`, для
`isSuperAdmin: true`; `scoped` — для `isSuperAdmin: false`).

## Покрытые сценарии (зеркало файлов specs/)

- `00-smoke.spec.ts` — baseline regression: каталог открывается, API
  отвечает, register+login работает. НЕ новое покрытие, просто гарантия,
  что остальной gate ничего не сломал.
- `01-catalogue.spec.ts` — открытие каталога, переключение
  developments/listings, city/dealType/sort фильтры, cursor-пагинация
  ("Показать ещё"), переход на detail-страницы.
- `02-reveal-contact.spec.ts` — реальный reveal-contact на listing
  detail-странице: реальный `{phone, leadId}` из ответа, non-disclosure
  (никаких `organizationId`/`contactId`/`propertyAssetId` в браузерном
  ответе), а также повтор запроса с тем же `Idempotency-Key` без создания
  второго Lead.
- `03-publishing-wizard.spec.ts` — полный wizard: register/login →
  property asset → listing → 3-фазная загрузка реального JPEG-фикстура →
  activate → publish с реальным `Idempotency-Key` → поллинг
  `publication-status` до `published` → проверка, что объявление реально
  появилось в публичном каталоге.
- `04-logout.spec.ts` — реальная очистка cookie (`context.cookies()`),
  реальная server-side ревокация (повторный `/auth/session` →
  `authenticated:false`), реальный 401 на защищённый endpoint после
  logout, идемпотентность повторного logout, logout через UI wizard'а.
- `05-admin-panel.spec.ts` — вход super_admin, разница scoped admin vs
  super_admin (скрытая nav-ссылка + реальный 403
  `SELF_ESCALATION_BLOCKED` на создание аккаунта), деактивация/
  реактивация admin-аккаунта, revoke granta (409 на устаревший
  `expectedVersion`, 200 на верный), audit trail по реальным событиям,
  реальный 401 `AUTH_NO_SESSION` после logout.

## Известные ограничения

- **Нет HTTP bootstrap для первого super_admin.** Решение: прямой
  Mongo seed-скрипт (`fixtures/seed-admin.ts`), задокументированный выше и
  в самом файле. Это НЕ обходит `/auth/login` — только обходит
  отсутствующий HTTP-путь СОЗДАНИЯ первого аккаунта.
- **Проверка зависит от Docker daemon.** Если daemon, base images или
  обязательные сервисы недоступны, `runtime:preflight` возвращает
  `BLOCKED_INFRASTRUCTURE`, а `globalSetup` завершает Playwright hard-failure
  (не skip и не тихий partial-pass). Это проверено отдельным негативным
  прогоном при разработке gate.

  После исправления runtime-окружения полный положительный прогон подтверждён
  локально: `pnpm runtime:preflight` — READY, Playwright — **23 passed, 1
  skipped** из 25. Единственный ожидаемый skip — detail-тест при пустом
  каталоге. Поэтому список тестов сам по себе по-прежнему не считается
  доказательством прохождения — нужен реальный запуск.

- **`mongodb (tcp)`/`marketplace-web (root)` preflight-проверки могут
  ложно-PASS**, если ЛЮБОЙ процесс (не обязательно из
  `compose.runtime.yml`) слушает порт 27017/4173 на хосте — TCP
  connect/HTTP GET сами по себе не различают "правильный сервис" от
  "что-то другое на этом порту". Наблюдалось в этой самой среде разработки
  во время написания гейта (сторонний процесс на 27017/4173 от параллельной
  worktree-сессии). `mongodb`-проверка сознательно осталась TCP-only (не
  протокольная, см. preflight.mjs докблок) — сильная защита от этого
  конкретного false-positive обеспечивается ВТОРЫМ, более строгим слоем:
  seed-скрипт делает настоящий `mongoose.connect()` + запись документа,
  что упадёт, если порт занят не-MongoDB процессом.

## Откат / очистка

```powershell
pnpm runtime:down
```

Останавливает и удаляет контейнеры `compose.runtime.yml` (именованные
volumes сохраняются — см. `docs/operations/runtime-release-gate.md` про
полную очистку данных).

Очистка тестовых данных, созданных этим suite'ом: **не требуется**.
Property assets/listings/leads/публикации не имеют DELETE-эндпоинта
(append-only/soft-lifecycle дизайн — не пробел этого гейта, дизайн
домена), поэтому каждый тест использует run-scoped уникальные
идентификаторы (`fixtures/test-data.ts`) вместо удаления — оставшиеся
записи предыдущего прогона инертны и никогда не сталкиваются со
следующим прогоном. Admin-аккаунты/granты, у которых РЕАЛЬНО есть
деактивация/revoke-команда, деактивируются/отзываются самим сценарием как
часть проверки (это и есть assertion), не отдельным teardown-шагом.

Очистка Playwright-артефактов (`trace`/`screenshot`/`video`, только при
failure по конфигу):

```powershell
Remove-Item -Recurse -Force apps/e2e-runtime/test-results, apps/e2e-runtime/playwright-report -ErrorAction SilentlyContinue
```

(оба каталога уже в `.gitignore`, не коммитятся).
