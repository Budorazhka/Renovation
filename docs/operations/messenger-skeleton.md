# Messenger: каркас диалогов без транспорта (этап 10, не начат по DoD)

> 13.09.2026: транспорт для Telegram закрыт, см.
> [telegram-transport](telegram-transport.md) (N-12). Остальное содержимое
> файла — снапшот состояния на 11.09, сохранён как история.

Дата: 11.09.2026. Код — `80534a3` (10.09), коммит подписан «production-grade»;
честные статусы и own-scope на запись — N-02 и отдельный проход (11.09).
Статус: каркас. Модель диалогов, прав и привязки к CRM есть. Сообщения никуда не
уходят и ниоткуда не приходят, и с 11.09 API этого больше не скрывает: исходящее
остаётся `queued`, новый аккаунт — `pending`. Own-scope теперь действует и на
запись, не только на чтение.

## Что сделано

- Модуль `apps/api/src/modules/messenger`: аккаунты (Telegram-бот, WhatsApp),
  диалоги, сообщения, привязка диалога к лиду, контакту или сделке, задача из
  диалога, отметка прочтения.
- Маршруты под `/messenger`: `accounts` (список, подключение бота, подключение
  WhatsApp, удаление), `dialogs` (список, карточка, сообщения, отправка текста и
  медиа, `read`, `link-crm`, `create-task`).
- Все запросы фильтруются по организации. Аудит на операциях с аккаунтами и
  `link-crm`, outbox в транзакции, `Idempotency-Key`, ответы с `id`.
- Права — permission-matrix §1.6.

## Почему это не этап 10

Этап 10 мастер-плана: «серверное подключение каналов и безопасное хранение
provider credentials», модель доставки, in-app и Telegram-уведомления, realtime.
Ничего из этого нет:

- `MessengerMessageSent` стоял в `ACKNOWLEDGED_ONLY_EVENT_TYPES` воркера
  (`apps/worker/src/handlers/handlers.module.ts`): событие подтверждалось без
  исполнения. До 11.09 сообщение при этом сразу получало `status: 'sent'`:
  система говорила «отправлено», хотя отправки не было. Исправлено 11.09
  (честный статус), реальная отправка через Telegram — 13.09, см.
  [telegram-transport](telegram-transport.md) (N-12).
- Входящих не было: вебхуков не было, `dialogRepository.create` не вызывался
  ни одним путём. Закрыто 13.09 для Telegram, см.
  [telegram-transport](telegram-transport.md) (N-12).
- Токен бота не проверялся через Telegram, у WhatsApp учётных данных нет
  вовсе. До 11.09 аккаунт при этом сразу получал `authStatus: 'authenticated'`
  и `lastSyncAt`. Честный статус исправлен 11.09, проверка токена у Telegram —
  13.09, см. [telegram-transport](telegram-transport.md) (N-12). WhatsApp
  остаётся не поддержан.
- ERP-экран чатов (`apps/erp-web/src/pages/modules/ChatsPage.tsx`) ходит в старый
  отдельный сервис через `messengerApi.ts` и `MESSENGERS_API_URL`. Новый API к
  интерфейсу не подключён.

## Исправлено 11.09 (N-02): статус не опережает факт

- В `MessageStatus` добавлен `queued`: сообщение принято платформой, в канал не
  отправлено. Отправка текста и медиа пишет `queued`, умолчание схемы и
  репозитория для исходящего тоже `queued`. `sent` должен ставить будущий
  транспорт после ответа провайдера. `sentAt` — время приёма платформой, это
  записано в схеме и в OpenAPI.
- Новый аккаунт создаётся `pending` и без `lastSyncAt`. `authenticated` должно
  появляться после проверки у провайдера (для бота — `getMe`).
- OpenAPI: `MessengerMessage.status` — `[queued, sent, delivered, read]` с
  описанием, `packages/api-client` перегенерирован.
- Тесты: `messenger.service.spec.ts` (текст и медиа уходят `queued`),
  `repository/messenger-honest-status.spec.ts` (умолчания репозиториев).
- Старых записей с `sent` и `authenticated` переносить не нужно: боевых данных у
  модуля нет, оба значения остаются допустимыми в схеме.
- Видимую пометку в интерфейсе ставить некуда: ERP-экран чатов к этому API не
  подключён (см. выше).

## Исправлено 11.09: own-scope действует и на запись

`messenger_message.send` и `messenger_dialog.link_crm` — единственные два
messenger-права со scope `own` (только у роли manager, см.
`default-role-grants.ts`). До этого коммита `ownerFilterForAction` вызывался
только для чтения (`listDialogs`/`getDialog`/`listMessages`/`markDialogRead`)
— `sendTextMessage`, `sendMediaMessage`, `linkDialogToCrm` и
`createTaskFromDialog` own-scope не проверяли вовсе: `@RequirePermission`
проверяет только факт наличия гранта, не то, что действие применяется к
диалогу, назначенному именно этой позиции. Менеджер мог писать в чужой
диалог своей организации, перепривязывать его к другому лиду/сделке и
создавать задачу из него.

- `MessengerController.ownerFilterForAction` обобщён на любой resource (был
  жёстко зашит `messenger_dialog`) — own-scope у `messenger_message.send`
  свой, отдельный от `messenger_dialog.read`.
- `MessengerService.assertDialogOwnership` — общая проверка (был отдельный
  инлайн-код только в `getDialog`), теперь вызывается в каждом из четырёх
  методов сразу после чтения диалога. Диалог без `assignedPositionId` (ещё не
  взят в работу) own-scope не блокирует — тот же принцип, что у непринятого
  лида. Чужой диалог даёт тот же `NotFoundException`, что диалог из чужой
  организации — non-disclosure, не отдельный 403.
- Проверено на настоящей MongoDB и настоящем HTTP
  (`test/integration/messenger-own-scope-http.integration-spec.ts`, 6
  тестов): менеджер Б получает 404 на диалог менеджера А по всем четырём
  операциям, ничего не создаётся и не меняется; менеджер пишет в свой диалог
  и в диалог без назначения; владелец (organization-scope) — в любой диалог
  организации. Плюс юнит-тесты `messenger.service.spec.ts`.
- Карточка диалога без `assignedPositionId` по-прежнему открыта любому
  менеджеру на чтение и теперь на запись — это НЕ регрессия, тот же принцип,
  что у непринятого лида: свободные записи открыты, пока их не взяли в
  работу. Останется так, пока не будет решения владельца обратное.

## Исправлено 11.09: `botToken` не попадает в обычное чтение

Поле не имело `select: false` — попадало в любой `find()`/`findOne()` по
умолчанию. `toAccountReadModel` его и так не отдавал наружу (единственное
место, что читает документ), но структурной защиты не было: дамп базы, лог
документа целиком или будущий код, не учитывающий это явно, утекли бы
токеном. Тот же принцип, что `Identity.passwordHash`/`legacyPasswordHash`.
Ничего в кодовой базе `.botToken` с уже загруженного документа не читает
(транспорта нет), поэтому это чистое ужесточение без побочных эффектов.
Проверено на настоящей MongoDB
(`test/integration/messenger-bot-token-hidden.integration-spec.ts`, 2 теста):
обычные `find`/`findOne` и `findByIdForOrganization` не возвращают поле,
явный `.select('+botToken')` — возвращает.

## Исправлено 11.09: `link-crm` проверяет принадлежность лида/контакта/сделки организации

Раньше `leadId`/`contactId`/`dealId` из тела запроса писались в диалог как
есть — сервис проверял только формат `ObjectId` (DTO-валидация), но не то, что
запись вообще существует и принадлежит организации вызывающего. Диалог можно
было привязать к CRM-записи чужой организации, подобрав произвольный
`ObjectId`. `MessengerService.linkDialogToCrm` теперь перед записью вызывает
`CrmService.getLeadForOrganization`/`getContactForOrganization`/
`getDealForOrganization` (те же cross-module accessor'ы module-boundary, что
уже использует `getDialog`-путь для чтения диалогов) — каждый бросает
`NotFoundException`, если запись не найдена в организации вызывающего.
`getDealForOrganization` — новый метод `CrmService`, зеркалит
`getLeadForOrganization`/`getContactForOrganization` один в один.

Own-scope самой записи (например лид, назначенный другому менеджеру) и
`expectedVersion` этой правкой намеренно не закрыты — см. пункт 2 ниже.

Юнит: `messenger.service.spec.ts` (4 новых теста — чужой lead/contact/deal
каждый даёт `NotFoundException` и `dialogRepository.linkCrm` не вызывается,
плюс позитивный кейс на своих id). HTTP на настоящей MongoDB (тот же файл, что
own-scope-фикс выше — не дублировали bootstrap):
`test/integration/messenger-own-scope-http.integration-spec.ts`, 4 новых
теста — чужие lead/contact/deal каждый даёт 404 и поле в документе диалога не
проставляется, плюс позитивный кейс: свои id из той же организации дают 201 и
сохраняются.

## Исправлено 11.09: курсор списка диалогов больше не теряет и не дублирует записи

Сортировка — `{pinned: -1, 'lastMessage.sentAt': -1, _id: -1}` (закреплённые
сверху, дальше по свежести последнего сообщения), а курсор фильтровал только
по `_id`. Диалог поднимается в списке при новом сообщении независимо от даты
создания — порядок по `_id` и порядок сортировки расходятся не в редких
случаях, а почти всегда. Итог: закреплённый диалог со старым `_id`
возвращался бы на каждой следующей странице повторно (бесконечно проходит
`_id < cursor`), а диалог с более новым `_id`, но без буста (не закреплён, нет
свежего сообщения) — терялся безвозвратно.

`GET /messenger/dialogs` теперь строит составной seek-курсор из всех трёх
ключей сортировки (`pinned`, `lastMessage.sentAt`, `_id`), закодированный
непрозрачной base64url-строкой; сервер запрашивает `limit+1` записей, чтобы
точно знать, есть ли следующая страница, не полагаясь на условность "вернулось
меньше limit". Голый `ObjectId` по-прежнему принимается как cursor
(legacy-формат, уже описанный в OpenAPI Cursor-параметре) и даёт старое
поведение (фильтр только по `_id`) — только ради обратной совместимости,
новый cursor сервер в таком виде больше не отдаёт. Заодно ответ приведён к
контракту OpenAPI: `{items, nextCursor}` вместо голого массива — но только для
списка диалогов; список сообщений и код ответа `link-crm` остаются
расхождением, см. пункт 4 ниже.

Юнит: `messenger-dialog-cursor.spec.ts` (round-trip кодека, legacy-формат,
мусорный cursor → `BadRequestException`) и `messenger.service.spec.ts`
(`limit+1` → обрезка страницы и `nextCursor`, декодирование входного
cursor). На настоящей MongoDB (семантика `$lt`/`$or`/`$and` против
`null`/missing — не типовая гарантия, реальный запрос):
`test/integration/messenger-dialogs-pagination.integration-spec.ts` —
конкретный сценарий с закреплённым диалогом старого `_id` и диалогом нового
`_id` без буста воспроизводит и подтверждает исправление старого бага (и
потерю, и дубли), плюс отдельный тест на диалог без единого сообщения.

## Исправлено 11.09: `create-task` из диалога больше не делит Idempotency-Key с `POST /tasks`

Оба пути — `POST /tasks` и `POST /messenger/dialogs/:id/create-task` — в итоге
вызывают один и тот же `CrmService.createTask`, а внутри него `record()`
использовал захардкоженный `operation: 'createTask'`. Уникальность записи
идемпотентности — `(identityId, operation, key)`, так что один и тот же
`Idempotency-Key`, отправленный на оба эндпоинта, попадал в одну и ту же
запись: второй вызов видел чужой (с точки зрения этого эндпоинта) сохранённый
`requestHash`, он не совпадал с телом своего запроса (у эндпоинтов разные
наборы полей), и вместо создания второй, полностью независимой задачи клиент
получал `IDEMPOTENCY_KEY_CONFLICT` (409).

`CrmService.createTask` теперь принимает `idempotencyOperation` явным
параметром вместо хардкода — `task.controller.ts` передаёт `'createTask'`
(без изменений для уже существующего эндпоинта), `MessengerService.
createTaskFromDialog` передаёт `'createTaskFromDialog'` (новое имя); ранний
`checkReplay` в `MessengerController.createTaskFromDialog` (до вызова
сервиса) обновлён на то же имя, иначе он и `record()` разошлись бы сами
между собой.

Юнит: `messenger.service.spec.ts` и `task.controller.spec.ts` проверяют, что
каждый вызывающий передаёт своё имя операции. На настоящей MongoDB (полный
HTTP-путь, тот же файл, что own-scope/link-crm фиксы выше):
`messenger-own-scope-http.integration-spec.ts` — один и тот же
`Idempotency-Key` на `POST /tasks` и `POST /messenger/dialogs/:id/create-task`
создаёт две независимые задачи (201 и 201, разные `id`), не 409.

## Исправлено 11.09: `assetId` вложения проверяется на существование и принадлежность организации

`sendMediaMessage` писал `media.assetId` в сообщение как есть — та же дыра,
что была у `link-crm` с `leadId`/`contactId`/`dealId`: можно было приложить к
диалогу asset чужой организации, подобрав `ObjectId`. Теперь при наличии
`assetId` сервис вызывает `MediaService.getAssetForOwnerScope(assetId,
{type: 'organization', organizationId})` — тот же cross-module accessor, что
уже использует `TeamService` для аватара позиции (единственная точка доступа
к `MediaAsset` для внешних модулей, ADR-001/ADR-002): `null` → 404 (не
существует или чужая организация, non-disclosure), `status !== 'verified'` →
400. `url` без `assetId` (внешняя ссылка, не наш загруженный файл) этой
правкой намеренно не проверяется — остаётся открытым вопросом ниже.

Юнит: `messenger.service.spec.ts` (чужой/неподтверждённый/свой-verified
assetId). На настоящей MongoDB (тот же файл, что остальные фиксы этой
сессии): `messenger-own-scope-http.integration-spec.ts` — asset чужой
организации даёт 404, неподтверждённый — 400, свой verified — 201, во всех
трёх случаях сообщение либо не создаётся, либо создаётся ровно один раз.

## Что открыто

1. Транспорт: Telegram закрыт 13.09 ([telegram-transport](telegram-transport.md),
   N-12) — подключение бота с проверкой токена, вебхук, реальная отправка и
   приём. Выбор провайдера WhatsApp остаётся решением владельца.
2. ~~`link-crm` проверяет только принадлежность организации..., но не
   own-scope конкретной записи... и не принимает `expectedVersion`~~ —
   закрыто 14.09.2026, см. раздел ниже.
3. Вложения: `assetId` проверяется на принадлежность организации (см. фикс
   выше), но `url` (вложение без `assetId`, внешняя ссылка) остаётся любой
   строкой без валидации — сейчас ничего её не скачивает и не проксирует на
   сервере (транспорта нет, п.1), так что SSRF не актуален уже сегодня; когда
   появится реальная отправка через Telegram/WhatsApp API, для `url`
   потребуется решение, поддерживается ли вообще внешняя ссылка как класс
   вложений или только `assetId` — отдельный вопрос продукта, не техническая
   валидация формата.
4. Отметка прочтения меняет данные, но защищена правом `read`.
5. Организации, созданные до 10.09, не имеют грантов messenger, пока в окружении
   не запущена доливка `grants:backfill-defaults` (N-06,
   [default-grants-backfill](default-grants-backfill.md)).

## Исправлено 11.09: список сообщений отвечает `{items, nextCursor}`, `link-crm` — 200 вместо 201

Оба расхождения — с уже опубликованным `docs/api/v1-first-vertical-slice.yaml`
(implementation отставала от спеки, не наоборот):

- `GET /dialogs/:id/messages` отдавал голый массив — приведено к
  `MessengerMessageListResponse {items, nextCursor}`, тот же "+1 трюк", что у
  списка диалогов (сервис запрашивает `limit+1`, чтобы точно знать, есть ли
  следующая страница, не полагаясь на условность "вернулось меньше limit").
  Курсор при этом остался прежним — простой `_id`, без составного
  seek-курсора: сортировка `{sentAt: -1, _id: -1}` и `_id` сейчас всегда
  согласованы (`sentAt` выставляется в момент создания, независимой
  простановки даты — импорта/синка с реальной платформы — ещё нет, см. п.1).
  Когда транспорт появится и `sentAt` сможет расходиться с порядком `_id`,
  потребуется тот же составной курсор, что уже есть у списка диалогов.
- `link-crm` отвечал 201 (дефолт Nest для `@Post`) — теперь явный
  `@HttpCode(200)`: эндпоинт обновляет существующий диалог, не создаёт новый
  ресурс.

Юнит: `messenger.service.spec.ts` (`limit+1` → обрезка страницы и
`nextCursor` для списка сообщений). На настоящей MongoDB (тот же файл, что
остальные фиксы этой сессии): `messenger-own-scope-http.integration-spec.ts`
— `GET /dialogs/:id/messages?limit=2` отдаёт `{items, nextCursor}`, вторая
страница по `nextCursor` — оставшееся сообщение и `nextCursor: null`;
`link-crm` на успешный вызов отвечает 200.

## Исправлено 11.09: удаление аккаунта каскадом чистит его диалоги и сообщения

Удалялся только сам аккаунт — диалоги оставались висеть с указателем на уже
несуществующий `accountId`, их сообщения — с указателем на такой диалог (тот
же класс проблемы, что была у community-сидов до чистки N-02).
`MessengerDialogRepository.deleteByAccountId` находит и удаляет диалоги
аккаунта, возвращая их id; `MessengerMessageRepository.deleteByDialogIds`
удаляет их сообщения по этим id. Оба вызова — внутри той же транзакции, что
и удаление аккаунта. Счётчики (`dialogsDeleted`/`messagesDeleted`) попадают в
audit-запись.

Юнит: `messenger.service.spec.ts` (аккаунт без диалогов, аккаунт с
диалогами — счётчики в аудите, аккаунт не найден — каскад не запускается).
На настоящей MongoDB (репозиторный уровень — семантика `$in`/изоляции по
organizationId и accountId, не типовая гарантия):
`test/integration/messenger-account-delete-cascade.integration-spec.ts` —
диалоги и сообщения удалённого аккаунта пропадают, диалог другого аккаунта
той же организации и диалог того же `accountId` в чужой организации не
затрагиваются.

## Исправлено 14.09: `link-crm` — own-scope конкретной записи и `expectedVersion`

Закрывает п.2 "Что открыто" выше. До этой правки `linkDialogToCrm` проверял
только принадлежность лида/контакта/сделки организации вызывающего — этого
хватало против подбора чужого `ObjectId`, но не против того, что manager с
`messenger_dialog.link_crm` scope `own` (default-role-grants.ts) привязывал
диалог к лиду/сделке/контакту **другого** менеджера той же организации:
own-scope самого гранта проверялся только для диалога (`assertDialogOwnership`),
не для привязываемой записи.

- `MessengerController.linkDialogToCrm` передаёт уже вычисленный
  `assignedPositionId` (own-position или `undefined` для organization/global
  scope, `ownerFilterForAction`) третьим аргументом в
  `CrmService.getLeadForOrganization`/`getContactForOrganization`/
  `getDealForOrganization` — тот же паттерн, что `LeadController.
  changeStage` → `CrmService.changeLeadStage` → `LeadRepository.
  findByIdForOrganization(ownerPositionId)`.
- `getLeadForOrganization` уже принимала `ownerPositionId` (просто не
  вызывалась с ним отсюда). `getDealForOrganization` и
  `getContactForOrganization` — новые опциональные параметры:
  `getDealForOrganization` прокидывает его в уже существующий параметр
  `DealRepository.findByIdForOrganization`; `getContactForOrganization`
  получила ту же transitive-scope логику, что уже была в `getContact`
  (own-лиды вызывающей Position → `distinctContactIdsForOwner` →
  `ContactRepository.findByIdForOrganizationScoped`), поскольку у Contact
  нет собственного `ownerPositionId`.
- `expectedVersion` (обязательное поле `LinkDialogCrmDto`, целиком новый
  эндпоинт-потребитель — фронтенда для него ещё нет ни в одном приложении,
  так что сделать поле обязательным сразу безопасно) проверяется дважды:
  явно при чтении диалога (`dialog.version !== expectedVersion` →
  `ConflictException`, до похода в CRM-модуль — не тратим проверки лида/
  сделки/контакта на заведомо устаревший запрос) и атомарно в самом
  update'е (`MessengerDialogRepository.linkCrm` теперь CAS: `{_id,
  organizationId, version: expectedVersion}` в фильтре, `null` в ответе —
  конкурентный вызов между чтением и записью, тот же класс гонки, что уже
  закрыт у Lead `changeStageWithVersionCheck`). Сообщение об ошибке — тот
  же текст, что везде в кодовой базе: "Dialog was modified by another
  request — refresh and retry".

`docs/api/v1-first-vertical-slice.yaml`: `LinkMessengerDialogCrmRequest`
получил обязательный `expectedVersion`, маршрут — `409 VERSION_CONFLICT`.
`packages/api-client/src/schema.ts` перегенерирован, `check:stale` зелёный.

Юнит: `messenger.service.spec.ts` — own-scope прокидывается в вызовы
`crmService` (assertion на третий аргумент), несовпадение `expectedVersion`
даёт `ConflictException` до похода в CRM-модуль, CAS-промах на `linkCrm`
даёт `ConflictException` и не пишет аудит. Own-scope фильтрация в
репозиториях (Lead/Deal/Contact) уже была покрыта их собственными
юнит-тестами до этой правки — здесь добавлена только проверка, что
`assignedPositionId` реально доходит до них. Полный `@baza/api` — 116 test
suites / 1266 тестов зелёные, архитектурные стражи (7 suites / 32 теста)
зелёные.
