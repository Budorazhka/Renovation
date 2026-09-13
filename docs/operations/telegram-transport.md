# Telegram-транспорт: сообщение уходит в Telegram и возвращается в диалог (N-12)

Работа очереди, открытой решением владельца 11.09.2026
([roadmap](../roadmap-2026-09.md)): «сначала Telegram, WhatsApp через
официального провайдера позже». Дата: 13.09.2026.

## Что было

Messenger-каркас (N-02, [messenger-skeleton](messenger-skeleton.md)) хранил
диалоги, права и статусы честно (`queued`/`pending`), но транспорта не было
вовсе: `MessengerMessageSent` стоял в `ACKNOWLEDGED_ONLY_EVENT_TYPES`
воркера — событие подтверждалось без исполнения, исходящее сообщение
оставалось `queued` навсегда. Входящих не было совсем: вебхуков нет,
`dialogRepository.create` не вызывается ни одним путём. Токен бота не
проверялся Telegram — `POST /messenger/accounts/telegram/bot` принимал любую
строку 10-120 символов.

## Что сделано

### Новый пакет `@baza/messenger`

Схемы, репозитории и `TelegramBotClient` messenger-модуля вынесены из
`apps/api` в `packages/messenger` — тот же module-boundary принцип, что
`@baza/media-storage`: API-процесс подключает бота (`getMe`/`setWebhook`),
worker-процесс реально отправляет сообщения (`sendMessage`), оба вызывают
один и тот же внешний API, значит схемы/репозитории/клиент должны жить в
общем пакете, а не только в `apps/api`, откуда worker структурно не может их
импортировать (отдельный деплоймый артефакт, свой `package.json`).

### Подключение бота: токен проверяется у Telegram до сохранения

`MessengerService.addTelegramBot` вызывает `TelegramBotClient.getMe(token)`
ДО открытия транзакции — невалидный токен даёт `BadRequestException`, аккаунт
не создаётся вовсе (было: сразу `authenticated`, независимо от валидности).
`accountId` генерируется заранее (`new Types.ObjectId()`, валидно для
Mongoose), чтобы webhook URL со включённым id можно было зарегистрировать в
Telegram (`setWebhook`, тоже до транзакции) раньше самой записи: сбой любого
из двух сетевых вызовов не оставляет «недобота» в базе. Успешная верификация
пишет `authStatus: 'authenticated'`, `telegramBotUsername`, `webhookSecret`
(256 бит энтропии, `select: false`, тот же принцип, что `botToken`) и
`lastSyncAt` одной транзакцией.

### Приём входящих: публичный вебхук

`POST /public/messenger/telegram/:accountId`
(`TelegramWebhookController`) — контроллер без `TenantGuard`/
`PermissionGuard` вовсе, тот же принцип, что `PublicComplaintController`:
вызывающий — серверы Telegram, не аутентифицированный клиент платформы.
Подлинность подтверждает не guard, а секрет вебхука в заголовке
`X-Telegram-Bot-Api-Secret-Token`, сверяемый внутри
`MessengerService.handleTelegramUpdate` через `timingSafeEqual` (сравнивать
есть с чем только после чтения аккаунта по `:accountId` из БД, поэтому
проверка не может быть guard'ом до контроллера). Неверный секрет, неизвестный
`accountId` и апдейт без `message.text` (фото/стикер и т.п.) обрабатываются
молча — не ошибка, просто нет побочного эффекта; узкий тип `TelegramUpdate`
(`telegram-update.types.ts`) читает только то, что реально нужно, не полную
Telegram-схему. Маршрут защищён `IpRateLimitGuard` (тот же generic guard, что
`complaint-submit`) — единственная защита от постороннего трафика помимо
секрета, так как у Telegram нет фиксированных IP-диапазонов для allowlist.

Обработчик находит или создаёт диалог по `{organizationId, accountId,
externalChatId}`, дедуплицирует повторную доставку того же апдейта по
`{dialogId, externalMessageId}` (Telegram при таймауте нашего ответа
повторяет апдейт — at-least-once, не exactly-once), создаёт сообщение
(`author: 'client'`) и увеличивает `unreadCount` диалога. Всегда отвечает
`200 {ok: true}` — Telegram трактует не-2xx как «не доставлено» и повторяет
апдейт бесконечно.

### Реальная отправка: `MessengerMessageSentHandler` в воркере

Убран из `ACKNOWLEDGED_ONLY_EVENT_TYPES`. Хендлер (`apps/worker/src/handlers/
messenger-message-sent.handler.ts`) проверяет `status: 'queued'` перед
отправкой (идемпотентность против at-least-once доставки outbox — повтор на
уже `sent`/`failed` сообщении ничего не делает), читает `botToken` аккаунта
(`findByIdWithToken`, system-actor, без tenant-контекста — воркер работает
вне сессии организации), вызывает `TelegramBotClient.sendMessage`. Успех →
`markSent(messageId, externalMessageId)` (CAS: `findOneAndUpdate` меняет
только документы всё ещё в `queued`). `TelegramApiError.permanent` (401, 403,
400 — токен отозван, бот заблокирован, chat_id не существует) →
`markFailed`, событие подтверждено без исключения: повтор не поможет.
Временная ошибка (429, 5xx, сетевой сбой) → исключение пробрасывается дальше,
outbox повторит доставку с задержкой, сообщение остаётся `queued`. WhatsApp
(`platform !== 'telegram'`) — не поддержан вообще, сообщение сразу
`failed`, честный терминальный статус вместо вечного `queued`, тот же принцип
«honest status», что уже применён к `authStatus` аккаунта.

### `deleteAccount`: снимает вебхук у Telegram при удалении аккаунта

Читает `botToken` до транзакции, после успешного удаления best-effort
вызывает `TelegramBotClient.deleteWebhook` — сбой этого вызова логируется
предупреждением и не блокирует удаление аккаунта (Telegram сам перестанет
слать апдейты на несуществующий URL после нескольких неудачных попыток,
снятие вебхука — гигиена, не гарантия).

## Проверки

- `packages/messenger/src/telegram-bot.client.spec.ts` — 8 тестов клиента:
  `getMe` успех/401 permanent/429 transient с `retryAfterSeconds`/400
  permanent, `sendMessage` успех, сетевой сбой retry-then-succeed и
  exhausted-retries, `setWebhook` тело запроса.
- `apps/api/src/modules/messenger/messenger.service.spec.ts` — `addTelegramBot`
  (невалидный токен → `BadRequestException` без записи в базу; `setWebhook`
  падает → то же; успех → `authenticated`/`telegramBotUsername`/
  `webhookSecret`) и `handleTelegramUpdate` (неверный секрет и неизвестный
  `accountId` — молча ничего не делают; апдейт без текста игнорируется; новый
  и существующий диалог; дедуп повторной доставки).
- `apps/worker/src/handlers/messenger-message-sent.handler.spec.ts` — 7
  тестов: сообщение не найдено, replay на уже `sent`, WhatsApp сразу
  `failed`, аккаунт не найден → `failed`, успешная отправка → `sent` с
  `externalMessageId`, постоянная ошибка Telegram → `failed` без исключения,
  временная ошибка → исключение наружу для retry outbox.
- Архитектурные стражи (`apps/api/test/architecture/`): `tenant-scope`,
  `idempotency-coverage`, `authorization-coverage`, `openapi-route-coverage`
  обновлены на новый публичный маршрут и метод дедупа без `organizationId` в
  фильтре — каждое исключение снабжено причиной в реестре стража.

## Что остаётся открытым

- **WhatsApp** — учётных данных провайдера нет вовсе, сообщения этой
  платформы сразу помечаются `failed` (см. выше). Выбор провайдера — решение
  владельца, отдельная задача.
- **Delivery/read receipts от Telegram** реальных нет — `delivered`/`read`
  по-прежнему ставятся эвристически (любое входящее сообщение клиента
  переводит предыдущие исходящие), как и до этой работы.
- **ERP-экран чатов** (`apps/erp-web/src/pages/modules/ChatsPage.tsx`)
  по-прежнему не подключён к этому API — открытый пункт messenger-skeleton,
  этой работой не закрыт.
- **Ретраи webhook-обработки за пределами outbox** не нужны: сама доставка
  входящих не идёт через outbox, обрабатывается синхронно в HTTP-хендлере —
  устойчивость к сбоям обеспечивает то, что Telegram сам повторяет апдейт при
  не-2xx ответе или таймауте.
