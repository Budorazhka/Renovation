import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Требует ли каждая изменяющая состояние команда `Idempotency-Key`.
 *
 * ПОЧЕМУ ТЕСТ УСТРОЕН ИМЕННО ТАК. Первая редакция сравнивала «маршруты, которые
 * бросают IDEMPOTENCY_KEY_REQUIRED» со списком-константой. Такая сверка ловила
 * снятие ключа с известного маршрута, но НЕ ловила ровно ту регрессию, ради
 * которой заводилась: новая критическая команда, добавленная без проверки
 * ключа, не попадала ни в найденное, ни в ожидаемое — и тест проходил. Дыра
 * подтверждена диверсией: добавленный `POST /bookings/sabotage-transfer` без
 * идемпотентности прошёл стража насквозь.
 *
 * Поэтому источник перечня маршрутов теперь НЕЗАВИСИМ от их поведения: список
 * берётся из самих контроллеров (все не-GET маршруты), а решение по каждому
 * обязано быть записано в одной из двух таблиц ниже. Новый изменяющий маршрут
 * не попадает никуда и роняет тест — автор обязан принять решение, а не
 * промолчать.
 *
 * Третий страж такого рода после module-boundaries и permission-grants;
 * ADR-006 и conventions.md §4/§8 — источник правил.
 */

const SRC_ROOT = join(__dirname, '../../src');

/** Маршрут → почему ключ обязателен. Проверяется, что он ДЕЙСТВИТЕЛЬНО требуется. */
const REQUIRE_IDEMPOTENCY_KEY: Record<string, string> = {
  'POST /bookings': 'book — создаёт новую бронь, дубль занял бы юнит дважды',
  'POST /bookings/:bookingId/cancel': 'cancel — ADR-006 прямо перечисляет',
  'POST /bookings/:bookingId/confirm': 'follow-up команда брони (book-001)',
  'POST /bookings/:bookingId/extend': 'follow-up команда брони (book-001)',
  'POST /bookings/:bookingId/convert-to-deal': 'конвертация брони в сделку — повтор создал бы дубликат сделки',
  'POST /developments/:developmentId/publish': 'publish — ADR-006 прямо перечисляет',
  'POST /property-assets/:assetId/listings/:listingId/publish': 'publish листинга',
  'POST /marketplace/property-assets/:assetId/listings/:listingId/publish':
    'publish листинга в marketplace-потоке',
  'POST /leads': 'дубль лида искажает воронку и отчётность по менеджерам — данные, по которым принимают решения',
  'PATCH /leads/:leadId/stage':
    'стадия лида напрямую участвует в отчётах по воронке и метриках менеджеров — повтор (клиентский таймаут+ретрай) не должен применить смену дважды и задвоить историю переходов',
  'POST /deals': 'дубль сделки удваивает ожидаемую комиссию в отчётах',
  'POST /tasks': 'дубль задачи засоряет список следующих действий менеджера',
  'POST /calendar/events': 'дубль встречи/звонка в календаре — тот же класс риска, что дубль задачи (ADR-006)',
  'POST /marketplace/property-assets': 'дубль объекта в мастере публикации — клиент шлёт стабильный ключ на повтор шага',
  'POST /marketplace/property-assets/:assetId/listings': 'дубль листинга на том же объекте',
  'POST /property-assets': 'дубль объекта в ERP — клиент шлёт стабильный ключ на повтор формы',
  'POST /property-assets/:assetId/listings': 'дубль листинга на том же объекте (ERP)',
  'POST /developments': 'дубль ЖК — клиент шлёт стабильный ключ на повтор формы мастера',
  'POST /developments/:developmentId/buildings': 'дубль корпуса',
  'POST /buildings/:buildingId/sections': 'дубль секции',
  'POST /buildings/:buildingId/floors': 'дубль этажа',
  'POST /buildings/:buildingId/floor-plans': 'дубль планировки',
  'POST /floors/:floorId/units': 'дубль юнита — шахматка показала бы несуществующий лот',
  'POST /buildings/:buildingId/chessboard/generate': 'массовая генерация сетки юнитов — повтор создал бы дубликаты лотов',
  'POST /buildings/:buildingId/units/batch': 'пакетный импорт юнитов — повтор создал бы дубликаты лотов',
  'POST /developments/:developmentId/units/batch-price-update': 'массовое изменение цен с Idempotency-Key',
  'POST /admin/accounts': 'дубль админ-аккаунта: второй аккаунт с админ-доступом на ту же identity',
  'POST /admin/organizations/:organizationId/billing/activate':
    'ручная активация/продление тарифа — повтор (ретрай/двойной клик) продлил бы подписку дважды и задвоил бы запись в billing ledger',
  'POST /developments/:developmentId/installment-plans': 'создание плана рассрочки — дубль создал бы дублирующий план',
  'POST /marketplace/selections':
    'N-11: создаёт новую подборку покупателя — в отличие от favorites/add это НЕ upsert, повтор ' +
    '(двойной клик) завёл бы вторую пустую подборку',
  'PATCH /developments/:developmentId/installment-plans/:id': 'обновление плана рассрочки с Idempotency-Key и expectedVersion',
  'DELETE /developments/:developmentId/installment-plans/:id': 'удаление плана рассрочки с Idempotency-Key и expectedVersion',
  'POST /selections': 'дубль подборки для клиента — повтор формы создал бы вторую подборку с той же публичной ссылкой-намерением',
  'PATCH /selections/:id': 'обновление подборки с Idempotency-Key и expectedVersion',
  'PATCH /selections/:id/status': 'смена статуса подборки с Idempotency-Key и expectedVersion',
  'DELETE /selections/:id': 'удаление подборки с Idempotency-Key и expectedVersion',
  'POST /selections/:id/items': 'добавление лотов в подборку с Idempotency-Key и expectedVersion',
  'DELETE /selections/:id/items/:unitId': 'удаление лота из подборки с Idempotency-Key и expectedVersion',
  'PATCH /selections/:id/items/:unitId': 'заметка/реакция агента на лот в подборке с Idempotency-Key и expectedVersion',
  'POST /messenger/accounts/telegram/bot': 'создание бота в организации — дубль создал бы дубликат канала',
  'POST /messenger/accounts/whatsapp': 'создание WA аккаунта — дубль создал бы дубликат канала',
  'POST /messenger/dialogs/:dialogId/messages': 'отправка сообщения — дубль отправил бы клиенту два одинаковых сообщения',
  'POST /messenger/dialogs/:dialogId/messages/media': 'отправка медиа сообщения — дубль отправил бы клиенту два одинаковых файла',
  'POST /messenger/dialogs/:dialogId/create-task': 'создание задачи из диалога — дубль создал бы дублирующую задачу в CRM',
  'POST /lms/items': 'создание обучающего материала библиотеки — дубль создал бы дубликат статьи/скрипта',
  'POST /lms/courses': 'создание обучающего курса — повтор создал бы дубликат курса',
  'POST /community/threads': 'создание темы форума — повтор создал бы дубликат обсуждения',
  'POST /community/threads/:threadId/replies': 'создание ответа в треде — повтор создал бы дублирующий ответ',
  'POST /marketplace/requests': 'N-13: создание запроса требует Idempotency-Key, повтор не должен создать второй публичный запрос',
};

/**
 * Маршрут → почему ключ НЕ требуется. Проверяется, что он и правда не требуется.
 *
 * Причина, начинающаяся с `ПРОБЕЛ:`, означает осознанно принятый риск, а не
 * безопасность: повтор такого запроса создаёт вторую сущность, КОТОРАЯ
 * ОСТАЁТСЯ И ВВОДИТ В ЗАБЛУЖДЕНИЕ. Само по себе «создаёт вторую запись» ещё
 * не пробел: если дубль недолговечен и убирается сам (см. три upload-intent
 * ниже), риска он не несёт, а формальная идемпотентность там даже вредна.
 * Число пробелов закреплено отдельной проверкой — молча вырасти не может.
 */
const NO_IDEMPOTENCY_KEY_NEEDED: Record<string, string> = {
  // --- Аутентификация ---
  'POST /auth/login': 'выдаёт сессию; повтор даёт новую сессию, а не дубль ресурса',
  'POST /auth/logout': 'идемпотентен по природе: повтор на закрытой сессии ничего не меняет',
  'POST /auth/register': 'повтор отклоняется уникальностью email на уровне БД',
  'POST /organizations/register':
    'НЕ пробел, проверено 02.09.2026: повтор отклоняется уникальным частичным индексом ' +
    '{identityId} where endedAt not exists на position_assignments — второй активный assignment ' +
    'для той же identity невозможен на уровне БД. Вся регистрация идёт одной транзакцией ' +
    '(createOrganizationWithOwner), поэтому отклонённый дубль не оставляет висячей организации. ' +
    'Ключ здесь был бы к тому же сломан: повтор вернул бы тело, но не поставил session-cookie.',

  // --- Команда и позиции ---
  'POST /team-users':
    'НЕ пробел, проверено 02.09.2026: первый же шаг createOccupiedPosition — registerIdentity — ' +
    'падает на уникальном индексе normalizedLogin (11000 -> ConflictException), поэтому повтор ' +
    'с тем же телом вторую позицию создать не может. ОТДЕЛЬНО: сама операция НЕ атомарна ' +
    '(четыре шага без общей транзакции) — это настоящий дефект, но другого рода, и ключом ' +
    'он не лечится. См. docs/api/conventions.md §8.',
  'POST /team-users/ensure-self': 'upsert по identity: повтор возвращает ту же позицию',
  'POST /team-users/ensure-team': 'upsert по организации: повтор возвращает ту же команду',
  'POST /team-users/invite/:token/activate': 'токен одноразовый, повтор отклоняется',
  'POST /team-users/positions':
    'дубль — вторая вакантная позиция без occupant, не искажённые отчётные данные (в отличие от ' +
    'lead/deal/task): видна в списке команды, тривиально удаляется тем же DELETE /team-users/positions/:id, ' +
    'который уже идемпотентен',
  'POST /team-users/positions/:positionId/assign': 'условный update позиции',
  'POST /team-users/positions/:positionId/vacate': 'условный update: повтор на свободной позиции — 409',
  'PATCH /team-users/positions/:positionId': 'обновление по id, повтор идемпотентен',
  'PATCH /team-users/positions/:positionId/avatar': 'перезапись ссылки на аватар',
  'PATCH /team-users/positions/:positionId/move': 'перемещение по id, повтор идемпотентен',
  'PATCH /team-users/positions/:positionId/status': 'установка статуса, повтор идемпотентен',
  'DELETE /team-users/positions/:positionId': 'удаление по id идемпотентно',
  'POST /organizations/:organizationId/positions/:positionId/assign': 'условный update позиции',
  'POST /organizations/:organizationId/positions/:positionId/grants':
    'грант идемпотентен по паре (subject, resource+action)',

  // --- Девелопмент ---
  'PATCH /developments/:developmentId': 'expectedVersion (CAS) не даст применить дважды',
  'PATCH /units/:unitId/price': 'expectedVersion (CAS)',
  'PATCH /units/:unitId/status': 'expectedVersion (CAS)',

  // --- Объекты и листинги (ERP-поток) ---
  'POST /property-assets/:assetId/listings/:listingId/unpublish':
    'условный update: modifiedCount === 0 → 409 (conventions.md §8)',
  'PATCH /property-assets/:assetId/listings/:listingId/activate': 'условный update по статусу',
  'PATCH /property-assets/:assetId/listings/:listingId/confirm-actuality':
    'проставляет отметку времени, повтор безвреден',
  'POST /property-assets/:assetId/media/upload-intent':
    'НЕ пробел, разобрано 02.09.2026: ключ здесь навредил бы. Ответ содержит presigned URL со сроком жизни 5 минут (PRESIGNED_UPLOAD_TTL_SECONDS), а запись идемпотентности живёт несопоставимо дольше — повтор вернул бы МЁРТВУЮ ссылку, и клиент не смог бы загрузить файл. Дубль же самоустраняется: неподтверждённый media asset удаляет media-cleanup через 24 часа.',
  'POST /property-assets/:assetId/media/:mediaAssetId/confirm': 'подтверждение по id, идемпотентно',
  'PATCH /property-assets/:assetId/media/:mediaAssetId': 'обновление по id, идемпотентно',
  'DELETE /property-assets/:assetId/media/:mediaAssetId': 'удаление по id идемпотентно',
  'PUT /property-assets/:assetId/media/order': 'полная замена порядка, идемпотентна',
  'POST /property-assets/duplicate-candidates/:duplicateCandidateId/override':
    'условный update кандидата, пишется audit',

  // --- Объекты и листинги (marketplace-поток, те же правила) ---
  'POST /marketplace/property-assets/:assetId/listings/:listingId/unpublish':
    'условный update: modifiedCount === 0 → 409',
  'POST /marketplace/favorites':
    'добавление в избранное идемпотентно по построению: уникальный индекс {identityId, targetType, slug} ' +
    'плюс upsert, повторное нажатие сердечка не создаёт вторую запись и не считается ошибкой',
  'DELETE /marketplace/favorites':
    'снятие уже снятого даёт тот же итог; ключ защищал бы от дубля ресурса, а дубля тут возникнуть не может',
  'PATCH /marketplace/property-assets/:assetId/listings/:listingId':
    'правка объявления: повтор с тем же телом приводит объявление в то же состояние, дубля ресурса ' +
    'не создаёт. От гонки двух правок защищает не ключ, а CAS по version — второй запрос со ' +
    'старой версией получает 409, а не молча затирает чужую правку.',
  'PATCH /marketplace/property-assets/:assetId/listings/:listingId/activate': 'условный update по статусу',
  'PATCH /marketplace/property-assets/:assetId/listings/:listingId/confirm-actuality':
    'проставляет отметку времени, повтор безвреден',
  'POST /marketplace/property-assets/:assetId/media/upload-intent':
    'НЕ пробел, разобрано 02.09.2026: ключ здесь навредил бы. Ответ содержит presigned URL со сроком жизни 5 минут (PRESIGNED_UPLOAD_TTL_SECONDS), а запись идемпотентности живёт несопоставимо дольше — повтор вернул бы МЁРТВУЮ ссылку, и клиент не смог бы загрузить файл. Дубль же самоустраняется: неподтверждённый media asset удаляет media-cleanup через 24 часа.',
  'POST /marketplace/property-assets/:assetId/media/:mediaAssetId/confirm': 'подтверждение по id',
  'PATCH /marketplace/property-assets/:assetId/media/:mediaAssetId': 'обновление по id',
  'DELETE /marketplace/property-assets/:assetId/media/:mediaAssetId': 'удаление по id идемпотентно',
  'PUT /marketplace/property-assets/:assetId/media/order': 'полная замена порядка',
  'POST /marketplace/property-assets/duplicate-candidates/:duplicateCandidateId/override':
    'условный update кандидата, пишется audit',

  // --- Медиа ---
  'POST /media/upload-intent':
    'НЕ пробел, разобрано 02.09.2026: ключ здесь навредил бы. Ответ содержит presigned URL со сроком жизни 5 минут (PRESIGNED_UPLOAD_TTL_SECONDS), а запись идемпотентности живёт несопоставимо дольше — повтор вернул бы МЁРТВУЮ ссылку, и клиент не смог бы загрузить файл. Дубль же самоустраняется: неподтверждённый media asset удаляет media-cleanup через 24 часа.',
  'POST /media/:assetId/confirm': 'подтверждение по id, идемпотентно',

  // --- CRM ---
  'POST /leads/import':
    'НЕ клиентский Idempotency-Key: LeadImportService сам вычисляет детерминированный ключ на КАЖДУЮ строку файла (sha256 от organizationId+phone) и делает per-row checkReplay/record через тот же IdempotencyService, что и POST /leads — заголовок здесь бессмысленен (одна HTTP-команда = много логических createLead), защита от дублей есть, просто не на уровне заголовка запроса.',
  'POST /leads/:leadId/assign': 'условный update владельца',
  'POST /leads/:leadId/unassign': 'условный update владельца (обратное действие assign, тот же принцип)',
  'PATCH /leads/:leadId':
    '`[phase 3]` обновление сопутствующих полей по id, идемпотентно — повтор с тем же телом применяет тот же $set повторно, без побочного дублирования (stage сюда не входит, тот путь — PATCH /leads/:leadId/stage, уже в списке обязательных выше)',
  'DELETE /leads/:leadId':
    '`[phase 3]` soft delete по id идемпотентно — повторный вызов на уже удалённом лиде получает 404 (LeadRepository.softDelete фильтрует status:{$ne:\'deleted\'}), не второй side-effect',
  'POST /leads/:leadId/files':
    '`[phase 3]` LeadRepository.addAttachedAsset — $addToSet, повторное прикрепление ТОГО ЖЕ assetId не создаёт дубль ссылки',
  'DELETE /leads/:leadId/files/:assetId':
    '`[phase 3]` LeadRepository.removeAttachedAsset — $pull, удаление по id идемпотентно, повтор безвреден',
  'POST /leads/:leadId/contact-actions':
    '`[phase 3]` append-only лог факта звонка/чата (AuditService.append, без session/CAS) — повтор (клиентский таймаут+ретрай) создаёт вторую audit-запись lead.contact, искажая только вторичный счётчик обращений в аналитике (getContactActionsStats), не основную CRM-воронку/lead/deal/task отчётность — тот же класс приемлемого риска, что POST /public/listings/:slug/complaints ниже',
  'PATCH /deals/:dealId': 'expectedVersion (CAS)',
  'PATCH /deals/:dealId/stage': 'expectedVersion (CAS)',
  'PATCH /deals/:dealId/checklist': 'expectedVersion (CAS)',
  'PATCH /deals/:dealId/reassign': 'expectedVersion (CAS) — см. conventions.md §8',
  'POST /deals/:dealId/participants': 'участник уникален по contactId в рамках сделки',
  'DELETE /deals/:dealId/participants/:contactId': 'удаление по id идемпотентно',
  'PATCH /tasks/:taskId': 'expectedVersion (CAS)',
  'PATCH /tasks/:taskId/reassign': 'expectedVersion (CAS)',
  'POST /tasks/:taskId/complete': 'повторное завершение намеренно идемпотентно',
  'PATCH /calendar/events/:eventId': 'expectedVersion (CAS)',
  'PATCH /calendar/events/:eventId/move': 'expectedVersion (CAS)',
  'DELETE /calendar/events/:eventId': 'soft delete по id идемпотентно, тот же принцип, что DELETE /leads/:leadId',

  // --- Публичный контур ---
  'POST /public/developments/:slug/reveal-contact':
    'своя запись идемпотентности (public-reveal-idempotency-record)',
  'POST /public/listings/:slug/reveal-contact': 'своя запись идемпотентности',
  'POST /public/listings/:slug/complaints':
    'анонимная non-critical подача, защищена IpRateLimitGuard; повторная отправка создаёт вторую запись pending-жалобы, но не искажает CRM-отчётность (в отличие от leads/deals/tasks) — admin резолюцирует каждую независимо, дубль не вводит в заблуждение о состоянии listing',
  'POST /public/messenger/telegram/:accountId':
    'вызывающий — серверы Telegram, не наш аутентифицированный клиент, Idempotency-Key header не оттуда взять; ' +
    'естественная идемпотентность через findByExternalMessageId (дедуп по {dialogId, externalMessageId}, ' +
    'MessengerService.handleTelegramUpdate) — at-least-once повтор апдейта не создаёт дублирующее сообщение',

  // --- Админ ---
  'POST /admin/accounts/:adminAccountId/deactivate': 'условный update по статусу',
  'POST /admin/accounts/:adminAccountId/reactivate': 'условный update по статусу',
  'POST /admin/accounts/:adminAccountId/grants': 'грант идемпотентен по (account, resource+action)',
  'POST /admin/accounts/:adminAccountId/grants/:grantId/revoke': 'условный update гранта',
  'POST /admin/duplicate-candidates/:duplicateCandidateId/confirm': 'условный update кандидата',
  'POST /admin/publications/:publicationId/unpublish': 'условный update (conventions.md §8)',
  'POST /admin/complaints/:complaintId/resolve': 'условный update по status:pending (CAS), повтор с уже резолюцированной жалобой — 409',
  'POST /admin/organizations/:organizationId/freeze': 'условный update по статусу (заморозка организации)',
  'POST /admin/organizations/:organizationId/unfreeze': 'условный update по статусу (разморозка организации)',
  'POST /admin/organizations/:organizationId/verify-mls': 'условный update по булеву флагу mlsVerified (N-10), тот же принцип, что freeze/unfreeze',
  'POST /admin/organizations/:organizationId/revoke-mls-verification': 'условный update по булеву флагу mlsVerified (N-10)',

  // --- Мессенджеры и чаты ---
  'DELETE /messenger/accounts/:accountId': 'удаление аккаунта мессенджера по id идемпотентно',
  'POST /messenger/dialogs/:dialogId/read': 'отметка прочтения диалога идемпотентна по природе (unreadCount -> 0)',
  'POST /messenger/dialogs/:dialogId/link-crm': 'связывание диалога с CRM-сущностями (leadId/contactId/dealId) идемпотентно перезаписывает ссылки',

  // --- LMS & База знаний ---
  'PATCH /lms/items/:id': 'обновление материала библиотеки по уникальному id',
  'DELETE /lms/items/:id': 'удаление материала библиотеки по id',
  'PATCH /lms/courses/:id': 'обновление курса по уникальному id',
  'DELETE /lms/courses/:id': 'удаление курса по id',
  'PUT /lms/progress/:courseId': 'upsert прогресса обучения ученика — идемпотентен по courseId',
  'DELETE /lms/progress/:courseId': 'сброс прогресса курса — повтор не меняет состояние',

  // --- Сообщество, форум и MLS биржа ---
  'PATCH /community/threads/:threadId': 'обновление темы по уникальному id треда',
  'DELETE /community/threads/:threadId': 'удаление темы по уникальному id треда',
  'POST /community/threads/:threadId/like': 'toggle реакции на тред идемпотентен по identityId',
  'PATCH /community/threads/:threadId/pin': 'закрепление темы по уникальному id треда',
  'PATCH /community/replies/:replyId': 'обновление ответа по уникальному id',
  'DELETE /community/replies/:replyId': 'удаление ответа по уникальному id',
  'POST /community/replies/:replyId/like': 'toggle реакции на ответ идемпотентен по identityId',
  'PATCH /community/replies/:replyId/accept': 'принятие ответа как решения идемпотентно перезаписывает isBest',
  'PATCH /community/exchange/:threadId/status': 'смена статуса заявки биржи MLS по уникальному id треда',
  'POST /community/events/:eventId/attend': 'toggle участия в мероприятии идемпотентен по identityId',
  'PATCH /marketplace/requests/:id/close': 'N-13: условное закрытие только опубликованного запроса автора; повтор приводит к тому же закрытому состоянию',
  'POST /marketplace/realtor-reviews': 'N-13: уникальный индекс (reviewerIdentityId, completedDealId, realtorPositionId) блокирует повторный отзыв',

  // --- Подборки покупателя (N-11) ---
  'PATCH /marketplace/selections/:id': 'переименование — повтор с тем же title приводит к тому же итогу',
  'DELETE /marketplace/selections/:id': 'удаление уже удалённой подборки — тот же итог, не ошибка',
  'POST /marketplace/selections/:id/items':
    'добавление элемента идемпотентно по построению: условный push с фильтром "элемента ещё нет", ' +
    'тот же принцип, что POST /marketplace/favorites',
  'DELETE /marketplace/selections/:id/items': 'снятие уже снятого элемента — тот же итог, не ошибка',
};

/** Сколько записей помечено `ПРОБЕЛ:`. Рост числа обязан быть осознанным. */
const KNOWN_GAPS = 0;

interface RouteInfo {
  key: string;
  enforcesKey: boolean;
}

function listControllers(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...listControllers(fullPath));
    else if (entry.endsWith('.controller.ts')) files.push(fullPath);
  }
  return files;
}

/**
 * Все изменяющие состояние маршруты (не-GET) и признак того, требует ли
 * обработчик `Idempotency-Key`. Перечень маршрутов НЕ зависит от наличия
 * проверки — в этом весь смысл: иначе незащищённый маршрут был бы невидим.
 */
function collectMutatingRoutes(): RouteInfo[] {
  const routes = new Map<string, boolean>();

  for (const file of listControllers(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    const controllerBase = source.match(/@Controller\(\s*'([^']*)'\s*\)/)?.[1] ?? '';
    const lines = source.split(/\r?\n/);

    let current: string | null = null;
    for (const line of lines) {
      const route = line.match(/@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/);
      if (route) {
        const method = route[1]!.toUpperCase();
        if (method === 'GET') {
          current = null;
          continue;
        }
        const path = '/' + [controllerBase, route[2] ?? ''].filter(Boolean).join('/');
        current = `${method} ${path}`;
        if (!routes.has(current)) routes.set(current, false);
        continue;
      }
      if (current && line.includes('IDEMPOTENCY_KEY_REQUIRED')) {
        routes.set(current, true);
        current = null;
      }
    }
  }

  return [...routes].map(([key, enforcesKey]) => ({ key, enforcesKey })).sort((a, b) => a.key.localeCompare(b.key));
}

describe('Покрытие изменяющих команд Idempotency-Key', () => {
  const routes = collectMutatingRoutes();
  const required = new Set(Object.keys(REQUIRE_IDEMPOTENCY_KEY));
  const exempt = new Set(Object.keys(NO_IDEMPOTENCY_KEY_NEEDED));

  it('разбор контроллеров что-то нашёл — защита от молчаливо сломанного парсера', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('каждый изменяющий маршрут классифицирован: требует ключ либо явно освобождён', () => {
    const unclassified = routes
      .map((r) => r.key)
      .filter((key) => !required.has(key) && !exempt.has(key));

    expect(unclassified).toEqual([]);
  });

  it('маршруты из списка обязательных действительно требуют ключ', () => {
    const declaredButNotEnforced = routes
      .filter((r) => required.has(r.key) && !r.enforcesKey)
      .map((r) => r.key);

    expect(declaredButNotEnforced).toEqual([]);
  });

  it('освобождённые маршруты ключ не требуют — иначе список разошёлся с кодом', () => {
    const exemptButEnforcing = routes
      .filter((r) => exempt.has(r.key) && r.enforcesKey)
      .map((r) => r.key);

    expect(exemptButEnforcing).toEqual([]);
  });

  it('в списках нет маршрутов, которых больше нет в коде', () => {
    const live = new Set(routes.map((r) => r.key));
    const stale = [...required, ...exempt].filter((key) => !live.has(key)).sort();

    expect(stale).toEqual([]);
  });

  it('число осознанно принятых пробелов не выросло молча', () => {
    const gaps = Object.values(NO_IDEMPOTENCY_KEY_NEEDED).filter((r) => r.startsWith('ПРОБЕЛ:'));

    expect(gaps.length).toBe(KNOWN_GAPS);
  });

  it('у каждой записи есть причина и корректный формат маршрута', () => {
    for (const [endpoint, reason] of Object.entries({
      ...REQUIRE_IDEMPOTENCY_KEY,
      ...NO_IDEMPOTENCY_KEY_NEEDED,
    })) {
      expect(reason.length).toBeGreaterThan(10);
      expect(endpoint).toMatch(/^(POST|PATCH|PUT|DELETE) \//);
    }
  });
});
