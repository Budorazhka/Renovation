# Error catalog — BAZA.sale

**Статус**: Proposed (первый цельный проход, 25.08.2026)
**Формат ответа**: см. `conventions.md` раздел 3.

Каждый код — стабилен (не переименовывается между релизами; переименование = breaking change для клиентов, ловится через тот же OpenAPI CI-гейт, что и остальные breaking changes). HTTP-статус — за пределами этой таблицы (per-endpoint в OpenAPI-спеке), здесь фиксируется только code+смысл+когда возникает.

---

## Auth / Session (ADR-004)

| Code | Смысл | Когда |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | Неверный логин/пароль | `POST /auth/login` |
| `AUTH_SESSION_EXPIRED` | Сессия истекла | Любой authenticated-запрос с истёкшим TTL |
| `AUTH_SESSION_REVOKED` | Сессия отозвана (logout, vacate position, admin block) | Любой authenticated-запрос |
| `AUTH_AUDIENCE_MISMATCH` | Сессия другого продукта (ERP-cookie на Admin и т.п.) | Любой authenticated-запрос, ADR-004 audience check |
| `AUTH_2FA_REQUIRED` | Требуется второй фактор | `POST /auth/login`, если включён `twoFactorMethod` |
| `AUTH_RATE_LIMITED` | Превышен лимит попыток логина | `POST /auth/login`, brute-force защита |

## Authorization / Tenant (ADR-002, ADR-009)

| Code | Смысл | Когда |
|---|---|---|
| `FORBIDDEN` | Permission отсутствует для этого resource.action.scope | Любой endpoint, permission-matrix.md проверка провалена |
| `NOT_FOUND` | Запись не существует **или** принадлежит другой организации (намеренно один код — не раскрывает cross-tenant существование, ADR-002 security impact) | Tenant-scoped GET/PATCH/DELETE на чужой organizationId |
| `ADMIN_SCOPE_INSUFFICIENT` | Admin-grant есть, но scope (city/domain) не покрывает запрошенный ресурс | `/admin/*` endpoints |
| `ADMIN_REASON_REQUIRED` | Critical action без обязательного `reason` в теле | Unpublish/rating-adjust/manual-ledger по permission-matrix.md разд.4 |
| `SELF_ESCALATION_BLOCKED` | AdminAccount пытается изменить собственные grants (структурно невозможно, но явный код на случай попытки) | `PATCH /admin/admin-accounts/:id/grants` |

## Idempotency / Concurrency (ADR-006)

| Code | Смысл | Когда |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | Critical command без `Idempotency-Key` header | publish/book/cancel/manual-ledger |
| `IDEMPOTENCY_KEY_CONFLICT` | Тот же ключ, другое тело запроса (`requestHash` не совпадает) | Повтор critical command |
| `VERSION_CONFLICT` | `If-Match`/`version` не совпадает с текущим серверным значением | Параллельное редактирование Unit/Development/Deal |

## Booking (ADR-006)

| Code | Смысл | Когда |
|---|---|---|
| `BOOKING_OVERLAP` | Пересекающаяся активная бронь на этот unit | `POST /bookings` |
| `BOOKING_NOT_FOUND` | Бронь не существует или не в scope actor'а | confirm/cancel/extend booking |
| `BOOKING_INVALID_STATE_TRANSITION` | Попытка перехода статуса, невозможного из текущего (например, cancel уже `paid` брони) | confirm/cancel/extend |

## Publication (ADR-005)

| Code | Смысл | Когда |
|---|---|---|
| `PUBLICATION_SOURCE_NOT_READY` | Canonical-сущность не в статусе, допускающем публикацию (например, Development не `active`) | `POST /developments/:id/publish` |
| `PUBLICATION_BUILD_FAILED` | Worker не смог построить проекцию (маппинг/валидация) — статус `build_failed` | Асинхронный результат publish, отражается в GET-статусе публикации, не в синхронном ответе на publish |
| `PUBLICATION_NOT_FOUND` | Slug/id публикации не существует или `unpublished` | Публичный GET карточки |

## Duplicate / Moderation (domain-model.md Module 6)

| Code | Смысл | Когда |
|---|---|---|
| `DUPLICATE_DETECTED` | Явный дубль обнаружен, публикация заблокирована | `POST /listings/:id/publish` |
| `DUPLICATE_OVERRIDE_REQUIRED` | То же, но с указанием, что доступен explicit override с логированием | Тот же endpoint, `details` содержит `duplicateCandidateId` |

## CRM / Contact

| Code | Смысл | Когда |
|---|---|---|
| `CONTACT_PHONE_TAKEN` | Новый телефон в PATCH /leads/:leadId уже принадлежит ДРУГОМУ контакту этой организации | `PATCH /leads/:leadId` (name/phone/email правка контакта) |
| `LIBRARY_FOLDER_NOT_EMPTY` | В папке личной библиотеки ещё есть файлы или подпапки | `DELETE /library/folders/:folderId` (сначала удалить содержимое) |

## Validation

| Code | Смысл | Когда |
|---|---|---|
| `VALIDATION_FAILED` | Общая ошибка валидации тела запроса | Любой endpoint, `details.fields` — список невалидных полей (без raw exception) |
| `MONEY_INVALID_CURRENCY` | Валюта не входит в `USD | GEL | RUB` | Любое поле типа `MoneyAmount` |
| `MONEY_CURRENCY_MISMATCH` | Валюта не совпадает с валютой, уже принятой в этом ЖК (решение владельца 11.09.2026: одна валюта на комплекс) | `POST /buildings/:id/units`, `PATCH /units/:id/price`, batch-создание юнитов, генератор шахматки |
| `MEDIA_MIME_MISMATCH` | Magic-byte проверка не совпала с заявленным типом (ADR-008) | `POST /media/:id/confirm` |
| `MEDIA_NOT_VERIFIED` | Попытка использовать media asset до прохождения verification | Attach фото к Unit/Listing до `status: 'verified'` |

## Rate limiting

| Code | Смысл | Когда |
|---|---|---|
| `RATE_LIMITED` | Общий rate-limit код (auth — отдельный `AUTH_RATE_LIMITED` выше) | Contact reveal, search, public forms, reviews (master plan разд.10.2) |

## Server-side

| Code | Смысл | Когда |
|---|---|---|
| `INTERNAL_ERROR` | Необработанная серверная ошибка | Fallback — `message` намеренно generic ("Что-то пошло не так, обратитесь в поддержку"), `requestId` обязателен для разбора через логи, `details` пуст |

---

## Не входит в первый проход (явно, не молча)

Полный error-каталог для Admin-модулей (модерация/complaints/MLS-verification специфичные коды), Messaging-модуля, Subscriptions/Billing-модуля — не проработаны детально в этом первом проходе, поскольку эти домены не входят в первую вертикаль D-01…D-07 (кроме уже покрытых Booking/Publication/Duplicate выше, которые входят). Дополняется по мере проектирования соответствующих OpenAPI-срезов.
