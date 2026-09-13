# N-13: запросы покупателей и отзывы риэлторов — первый backend-контур

Дата: 13.09.2026. Ревью 13.09.2026 нашло 4 дефекта поведения на боевых
маршрутах в первом инкременте — исправлены тем же днём, см. раздел ниже.

В репозитории появился минимальный серверный контур для двух marketplace-сценариев, которые раньше были демо-данными в React:

- `GET /api/v1/public/requests` — публичная доска опубликованных запросов с фильтрами `dealType`, `city`, `propertyKind` и cursor pagination;
- `GET /api/v1/marketplace/requests` — свои запросы покупателя, все статусы (единственный способ узнать id запроса, чтобы его закрыть, если он потерян со страницы создания);
- `POST /api/v1/marketplace/requests` — создание запроса аккаунтом покупателя с обязательным `Idempotency-Key`;
- `PATCH /api/v1/marketplace/requests/:id/close` — закрытие только автором, идемпотентно (см. ниже);
- `GET /api/v1/public/realtors/:positionId/reviews` — только одобренные отзывы, с опциональным `limit`;
- `POST /api/v1/marketplace/realtor-reviews` — отзыв авторизованного аккаунта с обязательными `realtorPositionId` и `completedDealId`;
- `POST /api/v1/buyer-requests/:id/respond` — ERP-отклик организации на запрос (`buyer_request.respond`);
- `GET /api/v1/buyer-requests/responses` — свои отклики организации.

Запросы принадлежат `identityId`, а отзывы не публикуются сразу: новый отзыв получает статус `pending`. Уникальный индекс не позволяет одному аккаунту создать второй отзыв для той же сделки и риэлтора. Контактные данные в публичной проекции отсутствуют.

Это первый backend-шаг N-13, а не завершение DoD. До полной приёмки остаются:

1. ~~ERP-отклики риэлторов на запрос и назначение запроса организации~~ — сделано 13.09, см. раздел ниже;
2. ~~admin-очередь модерации отзывов с `review.moderate.*`, обязательной причиной и audit~~ — сделано 13.09, см. раздел ниже;
3. ~~CRM-проверка, что `completedDealId` действительно завершён и связан с указанной Position~~ — сделано 13.09, см. раздел ниже;
4. ~~подключение marketplace-web экранов (доска запросов, каталог/профиль риэлторов) к endpoint'ам~~ — сделано 14.09, см. разделы ниже (включая публичный каталог риэлторов, которого раньше не существовало вовсе); ~~admin-web экран модерации отзывов~~ — сделано 14.09; ~~erp-web экран откликов на запросы~~ — сделано 14.09, см. раздел ниже; остаётся только Figma visual compare для новых экранов.

## Исправлено 13.09 (ревью первого инкремента)

- **Гонка на создании отзыва отдавала 500 вместо 409.** `findDuplicate` перед `create` не закрывает окно между двумя параллельными запросами (двойной клик, ретрай) — второй `create` бьётся об уникальный индекс, `MongoServerError code 11000` уходил в `AppExceptionFilter` необработанным. `RealtorReviewsService.submit` теперь оборачивает `create` в try/catch и мапит `code: 11000` в тот же `ConflictException`, что и пред-проверка — тот же паттерн, что `isDuplicateKeyError` в `bookings.service.ts`.
- **Повторное закрытие запроса отдавало 404, хотя первый вызов уже закрыл его.** CAS-фильтр репозитория (`status: 'published'`) корректно не даёт закрыть уже закрытый запрос дважды, но при повторной доставке того же запроса (таймаут ответа, клиентский ретрай) CAS-промах превращался в `NotFoundException`, хотя операция уже выполнена. `BuyerRequestsService.close` теперь при промахе CAS дочитывает документ по `{_id, authorIdentityId}`: если он уже `closed` — возвращает то же состояние 200, если чужой или не существует — честный 404.
- **Публичные маршруты падали в 500 на мусорном id.** `GET /public/realtors/:positionId/reviews` и `PATCH /marketplace/requests/:id/close` строили `new Types.ObjectId(raw)` без валидации пути — невалидная строка бросала необработанный `BSONError`. Оба теперь используют `ParseObjectIdPipe` (тот же принцип, что везде в кодовой базе, D-05B), особенно важно для первого маршрута — он публичный, без аутентификации и rate-limit.
- **`PATCH :id/close` было нечем вызвать.** Публичная проекция доски не содержит признака авторства, а эндпоинта своих запросов не было — покупатель, потерявший id со страницы создания, не мог закрыть свой запрос ничем. Добавлен `GET /marketplace/requests` (свои запросы, все статусы, использует уже существовавший индекс `{authorIdentityId, createdAt}`).
- **Страж tenant-scope был ослаблен на весь файл, а не по методам.** `buyer-request`/`realtor-review` были внесены в `NON_TENANT_REPOSITORIES` целиком — это ослепило бы страж на будущие org-скоупные запросы (ERP-отклики риэлторов, admin-модерация — открытые пункты 1-2 выше). Заменено на точечные записи в `ALLOWED_WITHOUT_ORGANIZATION_ID` по каждому методу, с причиной — тот же принцип, что уже применён к `favorite.repository.ts`/`marketplace-selection.repository.ts`.
- **Индекс доски не совпадал с реальным запросом.** `{status, createdAt, _id}` не может обслужить сортировку `{status, _id: -1}`, которую строит `BuyerRequestRepository.listPublic` — каждая страница доски требовала бы полного скана published-записей. Заменён на `{status: 1, _id: -1}`.
- **Типизация `create()` на границе со схемой была снята до `Record<string, unknown>`** в обоих репозиториях — переименование поля схемы компилировалось бы молча. Заменено на явные интерфейсы `CreateBuyerRequestData`/`CreateRealtorReviewData`.
- **Параметр `limit` публичного списка отзывов был мёртвым** (контроллер его не передавал) — добавлен `ListRealtorReviewsDto` с `@Query()`.

Проверка: focused Jest — 2 suites / **9** tests зелёные (было 3 до ревью); архитектурные стражи (tenant-scope, idempotency-coverage, authorization-coverage, openapi-route-coverage) — 4 suites / 19 tests зелёные; API lint зелёный. Полный typecheck ветки заблокирован старыми integration-import'ами Telegram, которые уже удалены текущим незакоммиченным N-12 переносом в `@baza/messenger`.

## Добавлено 13.09: сделка проверяется у CRM перед созданием отзыва

До этой правки `completedDealId` принимался как есть — любой `ObjectId`,
включая случайный, чужой или сделку на стадии первого показа, давал такой же
`pending`-отзыв, как настоящая закрытая сделка. `RealtorReviewsService.
submit` теперь до создания отзыва проверяет:

1. **Сделка существует и принадлежит той же организации, что и указанный
   `realtorPositionId`** — через `OrganizationsService.
   getPositionOrganizationId` (новый cross-module accessor, ADR-001: другие
   модули не читают `PositionRepository` напрямую) resolve'ит организацию
   риэлтора, затем `CrmService.getDealForOrganization` (тот же паттерн, что
   уже использует `messenger`'s `link-crm`) — `NotFoundException`, если
   позиции или сделки не существует, либо сделка чужой организации.
2. **Сделка принадлежит именно этому риэлтору** — `Deal.ownerPositionId`
   должен совпадать с заявленным `realtorPositionId`, иначе
   `BadRequestException`: указать чужой `completedDealId` рядом с
   произвольным `realtorPositionId` не выйдет.
3. **Сделка дошла хотя бы до подписания договора** — в CRM нет отдельного
   флага "сделка завершена" (единственная терминальная стадия воронки —
   `closed_lost`, то есть сорвалась); стадии `showing`/`deposit` — ранние
   переговоры, `deal`/`golden`/`check_in`/`referral` — договор подписан и
   дальше. Отзыв о риэлторе имеет смысл только начиная со второй группы —
   это решение продукта, закреплённое константой
   `REVIEW_ELIGIBLE_DEAL_STAGES`, не факт из схемы.

**Сознательно НЕ проверяется** (решение владельца 13.09.2026): что автор
отзыва — тот же человек, что клиент по этой сделке в CRM. Аккаунт покупателя
на маркетплейсе (`reviewerIdentityId`) и CRM-карточка клиента
(`Deal.contactId`, которую риэлтор вписывает вручную — просто имя и
телефон) сегодня никак не связаны в базе: это две независимые системы учёта
одного и того же человека, и связать их автоматически без нового
поля/механизма нельзя. Закрывать этот разрыв — отдельное продуктовое
решение (например, подтверждение сделки самим покупателем по персональной
ссылке, или сверка телефона). До этого решения последнюю проверку "это
реально клиент, а не посторонний" выполняет модератор при рассмотрении
pending-отзыва (admin-модерация — см. раздел ниже) — тот же принцип, что уже
применён к рискам, требующим человеческого решения, а не кода.

Юнит: `realtor-reviews.service.spec.ts` — позиция не найдена → 404, сделка
не найдена/чужой организации → 404 (пробрасывается от `CrmService`), сделка
чужого риэлтора → 400, каждая из ранних стадий (`showing`/`deposit`/
`closed_lost`) → 400, каждая из зачётных стадий (`deal`/`golden`/`check_in`/
`referral`) → отзыв создаётся. 14 тестов, все зелёные.

## Добавлено 13.09: admin-очередь модерации отзывов

До этой правки `pending`-отзыв не мог никуда деться: `listApproved` фильтрует
строго `status: 'approved'`, а перевести отзыв в этот статус было нечем —
весь блок отзывов был мёртв end-to-end. Реализовано по тому же паттерну, что
`AdminDuplicateCandidateService`/`AdminComplaintService`:

- `RealtorReviewRepository.listForReview(statuses, {cursor, limit})` — тот
  же `_id`-курсор, что `DuplicateCandidateRepository.listForReview`;
  `moderate(id, {decision, reason, moderatedByAdminId})` — CAS-фильтр
  `status: 'pending'`, `modifiedCount === 0` → `ConflictException`.
- `RealtorReviewsService.listForAdminReview`/`moderate` (сам сервис теперь
  ещё и domain-слой для admin-очереди, ровно как `ComplaintService`) —
  `moderate` в транзакции: читает отзыв, CAS-update, `AuditService.append`
  (`action: 'review.moderate'`, `resource: 'review'`, `after: {status}`).
- `AdminRealtorReviewService`/`AdminRealtorReviewController`
  (`apps/api/src/modules/admin`) — `AdminGuard` на контроллере
  (аутентификация), permission-проверка explicit-вызовом
  (`AdminPolicyService.requireGrant({resource: 'review', action:
  'moderate'})`) внутри сервиса, тот же порядок `requireReason` →
  `requireGrant` → команда, что везде в admin-модуле.
- `GET /admin/realtor-reviews` (без явного `status` — очередь `pending`) и
  `POST /admin/realtor-reviews/:reviewId/moderate` (`{decision: 'approved'
  | 'rejected', reason}`, `reason` ≥ 10 символов).
- Грант `review.moderate` — **global scope**, не city-scoped (в отличие от
  `complaint.resolve`): отзыв о риэлторе не привязан к городу как первичному
  измерению. Как и у всех admin-грантов, привязка к конкретному
  admin-аккаунту — не статичная роль, а `PermissionGrant` с
  `subjectType: 'admin_account'`, выдаётся `AdminAccountService.
  grantPermission` (ADR-009).

Юнит: `realtor-reviews.service.spec.ts` (`listForAdminReview` — дефолт на
pending, limit+1 → nextCursor; `moderate` — отзыв не найден → 404, уже
промодерирован → 409 без перезаписи, approve → CAS-update + аудит с
`action: 'review.moderate'`); `admin-realtor-review.service.spec.ts` —
`requireGrant`/`requireReason` вызываются перед командой, `cursor`
конвертируется в `ObjectId`.

**Не сделано этим проходом:** экран в admin-web (сейчас модерация доступна
только через API) — пункт 4 плана выше. Добавлен 14.09, см. раздел ниже.

## Добавлено 13.09: ERP-отклики организаций на запрос покупателя

До этой правки доска запросов была read-only для организаций — публичный
`GET /public/requests` отдавал полный текст запроса, но откликнуться было
нечем: последний пункт открытого плана N-13.

- `BuyerRequestResponseDocument` (`buyer_request_responses`) —
  `{buyerRequestId, organizationId, respondedByPositionId, message}`.
  Уникальный индекс `{buyerRequestId, organizationId}` — не журнал
  переговоров, а текущее состояние "чем эта организация предлагает помочь";
  `BuyerRequestResponseRepository.upsert` атомарно создаёт-или-обновляет
  запись по этой паре, повторная отправка формы правит текст, не плодит
  второй отклик и не гоняется за уникальным индексом через
  check-then-insert (тот же класс гонки, что уже находили и чинили у
  отзывов, — здесь исключён конструктивно).
- **Много организаций откликаются на один и тот же запрос независимо, без
  эксклюзивного захвата** — решение по аналогии с ответами на бирже MLS
  community-модуля (`CommunityReplyDocument`): плоский many-to-one, каждый
  отклик атрибутирован своей организацией, никто не блокирует запрос для
  других. Явного "назначения запроса организации" как отдельного состояния
  на самой заявке не заведено — сам факт наличия отклика и есть эта связь.
- Отвечать можно только на `published`-запрос — `BuyerRequestsService.
  respond` читает запрос через новый `BuyerRequestRepository.findById`
  (публичная доска не имеет организации-владельца, фильтровать здесь не по
  чему) и отклоняет `closed`/`moderated` заявки `BadRequestException`.
- `POST /buyer-requests/:id/respond` и `GET /buyer-requests/responses`
  (`ErpBuyerRequestsController`) — `TenantGuard`+`PermissionGuard`, право
  `buyer_request.respond` (organization scope, тот же круг ролей, что
  `lead.create`: owner/director/rop/manager/administrator/developer,
  `marketer` не получает). Один грант и на отклик, и на чтение своих
  откликов — тот же принцип экономии, что у `community_reply` (отдельного
  read-гранта нет там, где видимость и так own-scope по вызывающему).
- Идемпотентность обеспечена самим upsert'ом (`POST .../respond` в реестре
  исключений idempotency-coverage), отдельный `Idempotency-Key` не нужен.

**Сознательно НЕ входит в этот backend-инкремент** (см. пункт 4 плана
выше): создание CRM Lead из отклика. `CrmService.createLead` требует
`contactId` либо `requesterPhone`/`requesterName` — у запроса покупателя
есть только `authorIdentityId` (маркетплейс-аккаунт), контактных данных
(телефон/имя) заявка не содержит вовсе, автоматически завести полноценный
лид не из чего. Тот же разрыв, что уже описан у отзывов: связка
"маркетплейс-identity ↔ CRM-контакт" не существует в базе как понятие.
Видимость отклика самому покупателю (кто откликнулся на его запрос) тоже
не входит — по той же логике, что у отзывов и подборок: сначала backend
для стороны, которая действует, экран и вторая сторона — отдельным шагом.

Юнит: `buyer-requests.service.spec.ts` (`respond` — запрос не найден → 404,
`closed`/`moderated` → 400, `published` → upsert; `listMyResponses` —
limit+1 → nextCursor); `erp-buyer-requests.controller.spec.ts`
(`tenantContext` пробрасывается в organizationId/respondedByPositionId,
cursor конвертируется в ObjectId). 6 новых тестов, все зелёные.

## Добавлено 14.09: доска запросов на marketplace-web подключена к реальному API

`RequestsPage.tsx` (`/requests`, MKT-SCR-016, фрейм `2287:35159`) был
демо-страницей: 7 захардкоженных карточек, фильтрация только на клиенте,
кнопки «Позвонить»/«Написать» вели к телефону автора, которого в API нет.
Полностью переписана на реальные вызовы:

- `GET /public/requests` через новый хук `useBuyerRequestsBoard` (тот же
  паттерн, что `useListingsCatalogue`: cursor-пагинация, `AbortController`
  против гонки при быстрой смене фильтра, отдельные `loading`/`empty`/
  `error`/`ready` состояния).
- `POST /marketplace/requests` — создание запроса с `Idempotency-Key`;
  401/403 от бэкенда (гость без сессии) показывает предложение войти, а не
  фиктивный успех — тот же паттерн, что `SelectionsPage.requiresAuth`.
- `GET /public/requests/:id/reveal-phone` — телефон автора запрашивается по
  клику на кнопку «Показать телефон», не приходит в общем списке.

**Часть фильтров макета вырезана, а не подделана**: свободный поиск,
множественный выбор типа недвижимости чекбоксами и фильтр «Актуальность»
(по дате) не имеют опоры в `GET /public/requests` (только один
`dealType`/`city`/`propertyKind` за раз, без full-text search и без
фильтра по дате). Оставлять их означало бы либо фильтровать только уже
загруженную страницу (на следующей странице «показать ещё» появились бы
неотфильтрованные карточки), либо визуально обещать функциональность, для
которой нет API (PRODUCT.md: «никаких визуальных обещаний функций, которых
нет в API»). Тип недвижимости сведён к одиночному select вместо
чекбоксов — ровно то, что поддерживает `propertyKind`.

Тесты: `tests/requestsBoard.test.tsx` переписан на моки `marketplaceApi`/
`publishingApi` (было — проверка захардкоженных данных), 8 тестов: рендер
из API, refetch при смене фильтра, empty/error состояния с retry, реальное
раскрытие телефона по клику, успешное создание запроса, честный
login-prompt вместо фейкового успеха при 401, закрытие диалога по Escape.

## Добавлено 14.09: публичный каталог риэлторов (снят блокер 14.09) + подключение экранов

Блокер из предыдущей ревизии этого документа ("нет публичного бэкенда для
каталога/профиля риэлторов") снят решением владельца 14.09.2026: кто есть
"риэлтор" в публичном каталоге определяется не отдельным
согласием/самообслуживанием профиля, а тем, что уже выбрано при
регистрации организации — `type: 'agency' | 'developer' |
'independent_realtor'` в `POST /organizations/register`. Отдельного флага
`isPublic`/consent на `PositionProfile` не заводилось — он избыточен, раз
поле уже есть.

Критерий публичности (`PositionRepository.listPublicRealtors`/
`findByIdPublicRealtor`): позиция `status: 'occupied'`, `fixedRole` в
`owner | director | rop | manager` (те же клиентские роли, что получают
lead/deal-гранты — `administrator`/`marketer` их не получают и в каталог
не попадают), организация — `type` в `agency | independent_realtor` и
`status: 'active'` (`developer`-организации исключены целиком, `mlsVerified`
как гейт не используется). Публичная проекция берёт только
маркетинговые поля `PositionProfile` (`city`, `aboutMe`, соцсети, аватар
через `MediaService`); HR-поля (`hireDate`, `birthDate`, `department`,
`skills`) в проекцию не попадают.

Новые публичные маршруты (`apps/api/src/modules/public-realtors`):

- `GET /public/realtors` — список, cursor-пагинация, опциональный `city`;
- `GET /public/realtors/:positionId` — карточка (404, если не найден или
  не проходит критерий выше);
- `GET /public/realtors/:positionId/reveal-phone` — телефон по клику,
  тот же паттерн, что у `reveal-phone` запросов покупателей (`IpRateLimitGuard`
  + `@RateLimit`, без побочного эффекта в CRM — в отличие от
  `revealListingContact`, здесь не создаётся Lead).

Средний рейтинг считается по одобренным отзывам
(`RealtorReviewRepository.getApprovedStatsByPositionIds`, `$group`+`$avg`)
и подмешивается в профиль тем же сервисом.

`RealtorsPage.tsx`/`RealtorProfilePage.tsx` полностью переписаны на эти
эндпоинты (было: `MOCK_REALTORS`/`MOCK_REVIEWS`, фейковая форма отзыва,
`demo-notice-banner`). Метрики исходного демо-макета (число закрытых
сделок, стаж, бейджи «ТОП-1 Батуми»/«Проверен BAZA») не перенесены — ни у
одной нет опоры в бэкенде; единственная реальная метрика (средний рейтинг)
честно отсутствует, если отзывов ещё нет, вместо показа «0.0». Свободный
поиск и фильтр по типу недвижимости из макета тоже вырезаны — как и у
доски запросов, `GET /public/realtors` их не поддерживает.

Форма добавления отзыва по-прежнему требует вручную ввести
`completedDealId` («код сделки от риелтора») — это тот же разрыв
"маркетплейс-identity ↔ CRM-контакт", что описан выше у откликов на
запросы: у покупателя нет автоматического способа узнать id своей сделки
в CRM. Поле честно подписано, а не скрыто.

Юнит: `position.repository.spec.ts` (+5 тестов на критерий
публичности/cursor/city), `realtor-review.repository.spec.ts` (новый
файл, 2 теста на `getApprovedStatsByPositionIds`), `public-realtors.
service.spec.ts` (новый файл: композиция профиля, аватар, 404, reveal-phone).
Архитектурные стражи (`tenant-scope`, `authorization-coverage`,
`openapi-route-coverage`, остальные 4) — 7/7 зелёные; полный `@baza/api` —
116 test suites / 1256 тестов зелёные. `tests/realtorsRating.test.tsx`
переписан на моки `marketplaceApi`/`publishingApi` (было — проверка
захардкоженных демо-данных), 9 тестов: рендер каталога из API, refetch по
городу, honest empty/no-reviews-yet состояния, переход в профиль и
реальные отзывы, честный 404 вместо фейкового профиля, раскрытие телефона
по клику, отправка отзыва с pending-сообщением, login-prompt при 401.
Полный `apps/marketplace-web` — 36 test files / 195 тестов зелёные,
production build проходит.

## Добавлено 14.09: admin-web экран модерации отзывов о риэлторах

До этой правки очередь модерации (`GET /admin/realtor-reviews`,
`POST /admin/realtor-reviews/:reviewId/moderate`, см. раздел выше) была
доступна только через API — сделан экран `RealtorReviewsPage`
(`/realtor-reviews`) по образцу уже существующего `ComplaintsPage`
(тот же UX-контракт: два раздельных `useConfirmReasonAction` на
approve/reject, общий `ConfirmReasonDialog` с обязательной причиной ≥10
символов, тот же порог, что `AdminPolicyService.requireReason` на сервере).

- `useAdminRealtorReviews` — тот же discriminated-union + cursor-пагинация
  паттерн, что `useAdminComplaints`; фильтр по статусу по умолчанию —
  `pending`, как и у жалоб.
- Причина модерации не возвращается сервером в ответе `/moderate` (только
  `{id, status}`) — фронтенд прокидывает введённый текст через результат
  `submitAction`, чтобы строка таблицы обновлялась сразу, без ожидания
  повторного `GET`.
- Строгого разделения по городу нет: право `review.moderate` — global
  scope (см. permission-matrix.md), поэтому фильтр здесь только по
  статусу отзыва, без city-фильтра, в отличие от `ComplaintsPage`.
- admin-web не использует i18n (в отличие от marketplace-web) — строки
  на странице захардкожены на русском, как и во всех остальных экранах
  этого приложения.

Юнит: `RealtorReviewsPage.test.tsx` (новый файл, 4 теста: рендер очереди,
фильтр по статусу, approve с реальным POST и обновлением строки, reject
аналогично) + 2 новых теста в `admin-api.test.ts`
(`listRealtorReviews`/`moderateRealtorReview` строят правильный URL/тело
запроса). Полный `apps/admin-web` — 11 test files / 76 тестов зелёные,
production build проходит.

**Не входит в этот проход:** erp-web экран откликов на запросы покупателей
(`POST /buyer-requests/:id/respond`, `GET /buyer-requests/responses`) —
сегодня доступен только через API; Figma visual compare для новых
экранов не проводился. Добавлен 14.09, см. раздел ниже.

## Добавлено 14.09: erp-web экран откликов на запросы покупателей

`/dashboard/buyer-requests` (новый пункт левого rail «Запросы
покупателей») — организация читает ту же публичную доску, что видят
покупатели (`GET /public/requests`), и откликается прямо с карточки
(`POST /buyer-requests/:id/respond`). Отдельного "получить один запрос по
id" эндпоинта нет намеренно (см. докстринг `erp-buyer-requests.
controller.ts`), поэтому ERP не строит свой собственный список запросов —
он использует публичный, ровно как задумано бэкендом.

- `GET /buyer-requests/responses` не возвращает title/city/budget
  исходного запроса (на бэкенде нет join'а) — фронтенд сам сопоставляет
  `buyerRequestId` уже загруженных откликов с id карточек публичной
  доски, чтобы показать пометку «уже откликнулись» и дать отредактировать
  текст (upsert по организации, повторная отправка правит, а не плодит
  второй отклик).
- Телефон автора запроса раскрывается по клику
  (`GET /public/requests/:id/reveal-phone`) — тот же паттерн, что у
  marketplace-web/admin-web, отдельный публичный rate-limited маршрут, не
  требующий сессии организации.
- Видимость пункта rail и его доступность совпадают с ролями, которым
  сервер выдаёт `buyer_request.respond` (permission-matrix.md разд.1.1:
  owner/director/rop/manager/administrator/developer) — marketer/lawyer/
  trainee/hr/partner/finance/procurement_head пункт не видят. Это
  UX-гейт, не защита: реальная проверка — `PermissionGuard` на сервере,
  как и везде в erp-web (см. `mlsApi.ts`'s докстринг про тот же принцип).
- Экран использует уже существующий в erp-web дизайн-токены/паттерн
  `LeadsInboxV2View` (loading/error/empty состояния с `data-testid`,
  DESIGN.md: Montserrat, вес только 400/500, radius ≤8px, без сплошных
  линий), а не forum-специфичный `ForumShell`/`ExchangeBoardPage` —
  последний скроллит собственный левый рельс секций сообщества, для
  отдельной ERP-функции это не подходящий каркас.
- i18n: erp-web поддерживает 5 языков (ru/en/ka/es/tr) с тестом на
  паритет ключей (`i18n-dictionaries.test.ts`) — новый namespace
  `buyerRequests` добавлен во все пять словарей, не только в ru.

Юнит: `buyerRequestsBoardPage.test.ts` (новый файл, 8 тестов: рендер
доски из реального API, refetch по фильтру типа сделки, empty/error
состояния с retry, раскрытие телефона по клику, отправка отклика с
реальным POST и переключением карточки в режим «уже откликнулись»,
честная деградация без своих откликов). Полный `apps/erp-web` — 69 test
files / 458 тестов зелёные (включая обновлённый `i18n-dictionaries.
test.ts` — 3/3), production build проходит.

**Не входит в этот проход:** Figma visual compare для нового экрана (в
Figma-хендоффе erp-web этого экрана не было — правки по макету).
