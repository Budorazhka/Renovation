

Указатель по документам репозитория. Заведён 01.09.2026: до него единственным
способом узнать, что где описано, было перечисление каталога `operations/`
(31 файл без группировки).

## С чего начинать

| Документ | Когда нужен |
| --- | --- |
| [../CLAUDE_HANDOFF_TZ.md](../CLAUDE_HANDOFF_TZ.md) | Техзадание владельца. **Обязательно перед любой задачей по marketplace UI:** §5.1 — жёсткий gate по Figma. Перенесён сюда из корня рабочей папки 04.09.2026. |
| [discovery/figma-ui-delivery-gate.md](discovery/figma-ui-delivery-gate.md) | Процедура и Definition of Done для marketplace UI. Каждый UI-пакет изменений обязан добавить сюда запись. |
| [BAZA_MASTER_PLAN.md](BAZA_MASTER_PLAN.md) | Источник объёма работ: решения владельца продукта, целевая модель, план этапов 0–12, бэклог с критериями приёмки, журнал решений. Перенесён сюда из корня рабочей папки 01.09.2026. |
| [roadmap-2026-09.md](roadmap-2026-09.md) | Куда двигаемся дальше: закрытая очередь этапа 7, внеочередные модули, предложение следующей очереди, решения, которые ждут владельца. |
| [architecture.md](architecture.md) | Перед любой задачей. Карта владения кодом, правила зависимостей, чек-лист изменения, правило про три уровня тестов. |
| [progress-report-2026-09-16.md](progress-report-2026-09-16.md) | **Актуальная сверка:** что сделано 14–16.09, готовность по этапам, что работает на настоящих данных, что ещё выдуманное, что нужно от владельца. |
| [progress-report-2026-09-11.md](progress-report-2026-09-11.md) | **Исторический отчёт.** Что вошло в код 09–10.09 вне очереди, что исправлено, статус модулей, поправки к прежним утверждениям. |
| [progress-report-2026-09-07.md](progress-report-2026-09-07.md) | **Исторический отчёт.** Сверка со сводкой Gemini перед очередью этапа 7. |
| [codex/plans/2026-09-07-primary-sales-completion.md](codex/plans/2026-09-07-primary-sales-completion.md) | **Закрытая очередь** этапа 7: девять задач с критериями приёмки и зависимостями. |
| [progress-report-2026-09-05.md](progress-report-2026-09-05.md) | **Исторический отчёт.** Что сделано за 02–05.09, чего нет и что блокирует сдачу UI. |
| [progress-report-2026-09-01.md](progress-report-2026-09-01.md) | Предыдущий срез: **процент готовности по этапам плана** (раздел 2). Знаменатель с тех пор не менялся. |
| [discovery/figma-visual-compare-checklist.md](discovery/figma-visual-compare-checklist.md) | Чек-лист сверки экранов с макетом: строка на экран, ID фреймов, файлы снимков, открытые вопросы к владельцу. |
| [api/conventions.md](api/conventions.md) | Перед добавлением или изменением эндпоинта. |
| [api/error-catalog.md](api/error-catalog.md) | При выборе кода ошибки. |
| [api/v1-first-vertical-slice.yaml](api/v1-first-vertical-slice.yaml) | OpenAPI-контракт. Источник для `packages/api-client`. |

## Документы-основания находятся вне этого репозитория

**Это известный разрыв, а не особенность организации.** Часть исходных решений по
архитектуре платформы остаётся в `BAZA_Renovation/docs/` — снаружи поставляемого
репозитория. Корневая рабочая папка взята под git 04.09.2026, но эти документы всё ещё
не поставляются вместе с репозиторием продукта. Канонический рабочий контекст —
этот каталог docs/; внешние материалы переносятся модульно.

**Переносим модульно**, по мере завершения работ по теме документа (решение
владельца от 01.09.2026, порядок очереди — в
[roadmap-2026-09.md](roadmap-2026-09.md)). Документ, переезжающий вместе с
закрытой работой, приезжает уже выверенным.

Уже здесь:

| Документ | Приехал вместе с |
| --- | --- |
| [BAZA_MASTER_PLAN.md](BAZA_MASTER_PLAN.md) | отчётом о ходе работ и подсчётом готовности |
| [architecture/adr/002-mongodb-tenancy.md](architecture/adr/002-mongodb-tenancy.md) | стражем `tenant-scope`: 18 запросов без `organizationId` разобраны, утечек нет |
| [architecture/adr/006-transactions-outbox-workers.md](architecture/adr/006-transactions-outbox-workers.md) | стражем `idempotency-coverage`: противоречие §4/§8 conventions.md разрешено |
| [security/permission-matrix.md](security/permission-matrix.md) | стражем `permission-grants`: все три мёртвых гранта включены |
| [../CLAUDE_HANDOFF_TZ.md](../CLAUDE_HANDOFF_TZ.md), [discovery/figma-ui-delivery-gate.md](discovery/figma-ui-delivery-gate.md), [discovery/figma-screen-inventory.md](discovery/figma-screen-inventory.md), [discovery/marketplace-screen-build-spec.md](discovery/marketplace-screen-build-spec.md), [discovery/marketplace-gap-matrix.md](discovery/marketplace-gap-matrix.md) | стартом работ по Figma-гейту marketplace (04.09.2026). Разрыв был не теоретический: ТЗ §5.1 требует запись в `docs/discovery/figma-ui-delivery-gate.md` при каждом UI-пакете, а самого файла в этом репозитории не было — исполнитель физически не мог выполнить требование, которое к нему предъявляют |

Ещё снаружи, в `BAZA_Renovation/docs/`:

| Документ | Ждёт |
| --- | --- |
| ADR-005, ADR-008 | чистки тихих подмен данных в ERP |
| `domain-model.md`, `mongodb-schema.md` | закрытия мок-долга CRM |
| `threat-model.md`, ADR-004, ADR-009 | следующего прохода по безопасности |
| ADR-001, 003, 007, 010 | по мере затрагивания своих областей |

Практическое следствие: строка 4 файла `api/conventions.md` заявляет
«Опирается на: все 10 ADR, domain-model.md, mongodb-schema.md,
permission-matrix.md», часть оснований уже перенесена (см. таблицы выше), остальные ещё внешние.
Следовать модульному переносу по решению владельца, без массового удаления
архивов, и разрешать расхождения (одно такое, противоречие §4 и §8 в `conventions.md`, уже
пришлось разрешать вручную).

Там же, в `BAZA_Renovation/docs/operations/`, лежит 41 документ ранней эпохи
проекта (`d01`–`d07`, `team-*`, `prop-001`, `auth-login-*`, `backup-restore`,
`observability`, `environments`). Они описывают фундамент, который здесь уже не
документируется, и с документами ниже почти не пересекаются.

## operations/ — по темам

Каждый документ описывает одну завершённую работу: что сделано, почему так и что
осталось открытым.

### CRM

- [crm-lead-read-path.md](operations/crm-lead-read-path.md) — чтение лидов, курсорная пагинация, фильтры, события.
- [crm-contacts-read-path.md](operations/crm-contacts-read-path.md) — чтение контактов, tenant- и own-скоуп.
- [crm-tasks-next-action.md](operations/crm-tasks-next-action.md) — задачи и индикатор следующего действия.
- [crm-task-events.md](operations/crm-task-events.md) — outbox-события жизненного цикла задачи.
- [erp-tasks-live-api.md](operations/erp-tasks-live-api.md) — реестр задач ERP снят с мока: чтение, завершение и создание через Platform API.
- [erp-tasks-mock-debt-closed.md](operations/erp-tasks-mock-debt-closed.md) — статус «В работе» стал достижим, виджет дашборда снят с мока, `hasOpenNextAction` перестал гаснуть при взятии задачи в работу.
- [erp-tasks-actions-parity.md](operations/erp-tasks-actions-parity.md) — экран догнал сервер: взять в работу, отметить подзадачу, сменить исполнителя.
- [task-model-audit-followup.md](operations/task-model-audit-followup.md) — четыре вердикта аудита применены: приоритет парой признаков, связь без дубля, провенанс только от сервера; с 11.09 видимость личных задач (`taskCategory`) проверяется на сервере (список, чтение по id, календарь, экспорт), не только клиентом.
- [task-attachments-media-assets.md](operations/task-attachments-media-assets.md) — вложения задачи стали файлами: ссылки на подтверждённые `MediaAsset` вместо имён без файлов; с 11.09 их можно скачать.
- [erp-session-context-me.md](operations/erp-session-context-me.md) — `GET /me`: организация, позиция и права одним вызовом; реальный пользователь больше не проваливается в мок-компанию `c1`; с 11.09 `companyName` из `/me` больше не перетирается заголовком публичной карточки застройщика.
- [erp-team-mock-debt-closed.md](operations/erp-team-mock-debt-closed.md) — реестр команды (TEAM-001) снят с мока: write-операции чинят битый маршрут на CRM-backend, localStorage и мок-массив убраны, KPI-контур и лиды осознанно оставлены как есть.
- [crm-pipeline-activity-timeline.md](operations/crm-pipeline-activity-timeline.md) — таймлайн активности, детект залипших лидов.
- [crm-deal-core.md](operations/crm-deal-core.md) — ядро сделок, оптимистическая блокировка.
- [deal-client-reassign.md](operations/deal-client-reassign.md) — передача сделки, включение гранта `client.reassign`.
- [lead-create-manual.md](operations/lead-create-manual.md) — ручное создание лида.
- [export-run.md](operations/export-run.md) — `GET /exports/:entity`, грант `export.run`.
- [crm-library.md](operations/crm-library.md) — библиотека материалов: общие материалы организации по продукту воронки и личная библиотека с папками; вложение лида хранит настоящее имя файла.
- [plans.md](operations/plans.md) — месячные планы позиций: руководитель ставит план сотруднику, сотрудник может себе; выполнение считается из лидов, сделок, задач и показов.
- [news.md](operations/news.md) — лента новостей ERP: новости платформы из админки и новости компании из ERP, картинки, правка с версией, рассылка на почту и в Telegram, бот уведомлений и настройки сотрудника.

### Marketplace и публичный контур

- [frontend-marketplace-vertical.md](operations/frontend-marketplace-vertical.md) — сквозная вертикаль публичного каталога.
- [marketplace-publishing-wizard.md](operations/marketplace-publishing-wizard.md) — мастер публикации листинга.
- [marketplace-map.md](operations/marketplace-map.md) — карта, публичные гео-точки, конфигурация стиля.
- [marketplace-figma-parity.md](operations/marketplace-figma-parity.md) — соответствие макету.
- [marketplace-functional-acceptance.md](operations/marketplace-functional-acceptance.md) — функциональная приёмка.
- [marketplace-public-api-gap-closure.md](operations/marketplace-public-api-gap-closure.md) — закрытие расхождений публичного API.
- [marketplace-operational-hardening-runbook.md](operations/marketplace-operational-hardening-runbook.md) — runbook эксплуатации.
- [marketplace-favorites.md](operations/marketplace-favorites.md) — избранное покупателя: сердечко перестало быть декорацией, появился backend.
- [marketplace-listing-edit.md](operations/marketplace-listing-edit.md) — редактирование объявления владельцем: чего не было в модели данных, что можно менять и почему адрес нельзя; кабинет снят с фикстур.
- [marketplace-publisher-filter.md](operations/marketplace-publisher-filter.md) — клик по застройщику и агентству ведёт в отфильтрованный каталог; отдельных страниц компаний нет по решению владельца.
- [public-listing-leads.md](operations/public-listing-leads.md) — раскрытие контакта и создание лида.
- [property-asset-media.md](operations/property-asset-media.md) — загрузка медиа и публичная галерея.
- [media-upload-grant.md](operations/media-upload-grant.md) — грант `media_asset.upload` проверялся, но не был выдан никому; плюс страж `permission-grants`.

### Брони

- [book-001-atomic-booking.md](operations/book-001-atomic-booking.md) — атомарная бронь юнита.
- [book-001-decision-memo-2026-08-31.md](operations/book-001-decision-memo-2026-08-31.md) — разбор принятых решений по BOOK-001.
- [booking-expiry.md](operations/booking-expiry.md) — просроченная бронь истекает и освобождает юнит по расписанию; отмена и резервирование больше не оставляют юнит в неверном статусе при гонке.

### Админ-контур

- [admin-control-plane.md](operations/admin-control-plane.md) — панель: аккаунты, гранты, аудит.
- [admin-duplicate-candidates-review.md](operations/admin-duplicate-candidates-review.md) — очередь модерации дублей.
- [first-super-admin-bootstrap.md](operations/first-super-admin-bootstrap.md) — создание первого супер-админа.
- [team-user-atomicity.md](operations/team-user-atomicity.md) — создание сотрудника: позиция, гранты, назначение и профиль одной транзакцией; invite-flow (assignOccupantByEmail) — назначение и Invitation тоже одной транзакцией.
- [legacy-migration.md](operations/legacy-migration.md) — перенос со старой системы: пока только лиды и заготовка (поля старых id, вход по старому паролю с перехешем); ждёт копию старой базы.
- [default-grants-backfill.md](operations/default-grants-backfill.md) — разовая команда доливает стартовые гранты ролей в существующие должности; отозванное вручную и суженное не трогает. Запускать после релиза с новыми грантами и после переноса организаций.

### ЖК и шахматка

- [chessboard-export.md](operations/chessboard-export.md) — выгрузка шахматки в XLSX, грант `chessboard.export`.

### Этапы 9–11 (начаты 09–10.09 вне очереди)

- [billing-manual-subscriptions.md](operations/billing-manual-subscriptions.md) — тарифы, подписка, журнал, ручная активация админом с грантом; с 11.09 обзор биллинга в админке тоже требует гранта (`manual_ledger.read`), первая подписка получает trial-план своего типа организации (не всегда agency), журнал отвечает `id` вместо сырого `_id`, admin-web больше не держит свою копию каталога тарифов (новый `GET /admin/billing/plans`); лимиты и заморозка пока ничего не ограничивают.
- [messenger-skeleton.md](operations/messenger-skeleton.md) — каркас диалогов и привязки к CRM без транспорта: сообщения никуда не уходят и ниоткуда не приходят; с 11.09 исходящее остаётся `queued`, новый аккаунт `pending`, own-scope менеджера действует и на запись (не только на чтение), токен бота не попадает в обычное чтение, `link-crm` проверяет принадлежность лида/контакта/сделки организации вызывающего, список диалогов пагинируется составным курсором и не теряет/дублирует записи, `create-task` из диалога больше не делит Idempotency-Key с `POST /tasks`, вложение по `assetId` проверяется на принадлежность организации, удаление аккаунта каскадом чистит его диалоги и сообщения, список сообщений отвечает `{items, nextCursor}` и `link-crm` — 200 вместо 201.
- [lms-knowledge-base.md](operations/lms-knowledge-base.md) — материалы, курсы и прогресс в пределах организации; с 11.09 прохождение теста проверяет сервер, а не клиент, и ERP-клиент больше не подменяет отказ сервера фикстурами. Правильные ответы всё ещё видны читающему тест.
- [community-forum-exchange.md](operations/community-forum-exchange.md) — межорганизационный форум и биржа MLS; модерация своей организации; с 11.09 стартует пустым, выдуманный засев вычищается из баз при старте, тема/ответ подписываются реальным автором, ERP показывает полный текст, время и реакции; toggle реакций/участия — атомарный, гонка конкурентных обновлений не теряет данные.

### CI, сборка, эксплуатация

- [p0-01-contract-quality-gate.md](operations/p0-01-contract-quality-gate.md) — клиент синхронизирован, исправлены запуск admin-тестов и lint тестовых doubles; 55/55 локальных задач без кеша, границы проверки явно указаны.

- [ci-quality-gate.md](operations/ci-quality-gate.md) — быстрый гейт: typecheck и lint.
- [ci-integration-gate.md](operations/ci-integration-gate.md) — интеграционный гейт на `mongodb-memory-server`.
- [runtime-release-gate.md](operations/runtime-release-gate.md) — воспроизводимый релизный гейт.
- [d07-runtime-e2e-gate.md](operations/d07-runtime-e2e-gate.md) — Playwright против живых HTTP-процессов.
- [nest11-fastify5-migration.md](operations/nest11-fastify5-migration.md) — миграция Nest 10→11 и Fastify 4→5, уязвимости 19 → 0.
- [openapi-route-coverage.md](operations/openapi-route-coverage.md) — страж соответствия контракта маршрутам: 132 маршрута против 81 пути в спеке, 49 пробелов измерены и закреплены.
- [marketplace-contract-gap-closed.md](operations/marketplace-contract-gap-closed.md) — marketplace-контур объектов описан зеркалом ERP-контура: пробелов 49 → 30.

### Асинхронный контур

- [outbox-dead-letter-noise.md](operations/outbox-dead-letter-noise.md) — семь типов событий уходили в `dead_letter` без единой попытки; обработчик подтверждаемых событий и страж покрытия.
- [actuality-expire-schedule.md](operations/actuality-expire-schedule.md) — протухание актуальности получило расписание: команда была вызываема, но её никто не вызывал ни в одном окружении.

### Сверки состояния

- [current-state-reconciliation-2026-08-31.md](operations/current-state-reconciliation-2026-08-31.md) — что реально реализовано в CRM на 31.08.
- [current-state-reconciliation-2026-09-02.md](operations/current-state-reconciliation-2026-09-02.md) — сверка на конец 02.09: стражей 4 → 7, пробелов контракта 49 → 30, задачи ERP без мока.
- Датированные сверки с 01.09 лежат в корне `docs/`: [01.09](progress-report-2026-09-01.md), [05.09](progress-report-2026-09-05.md), [07.09](progress-report-2026-09-07.md), [11.09](progress-report-2026-09-11.md).
- [consolidation-2026-08-31.md](operations/consolidation-2026-08-31.md) — сведение веток в `codex/integration`.

## Прочее

- [architecture/screen-as-spec-boundary-audit-2026-09-02.md](architecture/screen-as-spec-boundary-audit-2026-09-02.md) — аудит правила «экран — спецификация»: где граница между контрактом чтения и схемой хранения, вердикты по двенадцати полям задачи, предсказания к 02.11.

- [discovery/figma-local-handoff.md](discovery/figma-local-handoff.md) — передача макетов.
- [discovery/figma-ui-delivery-gate.md](discovery/figma-ui-delivery-gate.md) — процедура сдачи marketplace UI и реестр реализации экранов.
- [discovery/figma-screen-inventory.md](discovery/figma-screen-inventory.md) — инвентарь фреймов Figma: node ID, состояния, пометки `(не используется)`.
- [discovery/marketplace-screen-build-spec.md](discovery/marketplace-screen-build-spec.md) — спецификация сборки экранов marketplace.
- [discovery/marketplace-gap-matrix.md](discovery/marketplace-gap-matrix.md) — матрица расхождений marketplace между Figma, старым сайтом и реализацией.
- [discovery/figma-owner-decisions-stage2.md](discovery/figma-owner-decisions-stage2.md) — шесть решений владельца по Figma с готовыми вариантами и ценой отказа. Ждёт ответа.
- [discovery/screenshots/](discovery/screenshots/) — снимки экранов marketplace в габаритах Figma (1920 и 375) для visual compare, плюс разбор того, что видно уже по ним.
- [codex/plans/](codex/plans/) — планы отдельных работ, писавшиеся до реализации.

## Правило пополнения

Завершённая работа документируется одним файлом в `operations/` и одной строкой
в разделе выше. Документ отвечает на три вопроса: что сделано, почему выбран
такой путь, что осталось открытым. Третий пункт обязателен: документ без раздела
об открытых вопросах обычно означает, что их не искали.
