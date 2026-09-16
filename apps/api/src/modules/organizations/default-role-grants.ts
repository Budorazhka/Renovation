import type { FixedRole } from './schemas/position.schema';
import type { PermissionScope } from '../authorization/schemas/permission-grant.schema';

export interface DefaultGrant {
  resource: string;
  action: string;
  scope: PermissionScope;
}

/**
 * permission-matrix.md разд.1 "Роль на Position задаёт СТАРТОВЫЙ набор
 * grants при создании позиции" — единственный источник истины для того,
 * какие PermissionGrant документы создаются автоматически при создании
 * Position с данным fixedRole.
 *
 * resource/action здесь — БУКВАЛЬНО те же строки, что используются в
 * @RequirePermission(...) декораторах контроллеров (не permission-matrix.md
 * `resource.action.scope` нотация целиком — там `.own`/`.team`/
 * `.organization` суффикс на action кодирует scope текстом для читаемости
 * документа, но реальный PolicyEvaluatorService.evaluate() сравнивает
 * action СТРОГО буквально с тем, что стоит в декораторе на HTTP-методе,
 * scope — отдельное поле grant'а, не часть action-строки). Например
 * permission-matrix.md `lead.read.organization` → здесь
 * {resource:'lead', action:'read', scope:'organization'}, ПОТОМУ ЧТО
 * реальный контроллер (когда появится) будет объявлен как
 * @RequirePermission('lead', 'read'), не ('lead', 'read.organization').
 * Уже подтверждено сверкой со всеми существующими @RequirePermission
 * вызовами в кодовой базе (development/edit, development/read, unit/
 * price.update, unit/status.update, lead/assign, position/assign_occupant
 * — везде action БЕЗ scope-суффикса).
 *
 * Несколько разных scope на один и тот же resource.action (например
 * lead.read у own/team/organization) физически не могут сосуществовать
 * как отдельные grant-записи с одинаковым action — deny-by-default
 * evaluate() ищет ПЕРВОЕ совпадение resource+action и проверяет scope
 * этого гранта, не "любой из нескольких". Взят САМЫЙ ШИРОКИЙ scope,
 * доступный роли (например owner: 'lead read' - берём 'organization',
 * не 'own', поскольку 'organization' scope покрывает `own`/`team` case
 * тоже на уровне бизнес-логики: как только сервис возвращает ORG-wide
 * список, эта запись включает подмножество "свои" автоматически). Для
 * manager (только own, без organization/team) — берём именно 'own'.
 *
 * `⚙`-помеченные в матрице права (unit.price.update для manager,
 * position.*.organization для administrator) НАМЕРЕННО НЕ включены —
 * explicit per-position toggle (owner decision xlsx #53/#24), не default.
 * `crm.stages.configure` намеренно отсутствует у всех ролей (xlsx #108).
 *
 * `lead.changeStage` (D-05B) — НОВЫЙ resource.action, отсутствует в
 * permission-matrix.md как отдельная строка (техническое решение, не owner
 * decision, подтверждено владельцем явно в диалоге при реализации D-05B:
 * "конечно менеджер может менять стадию своих лидов"). Раньше PATCH
 * /leads/:id/stage переиспользовал `lead.assign` (только owner/director/
 * rop, organization-wide) — это физически не позволяло manager'у менять
 * стадию даже собственного лида. Новый грант со scope 'own' у manager
 * закрывает это, не добавляя новую роль/fixedRole — только новое действие
 * в уже существующей ролевой модели.
 *
 * Найдено реальным E2E-прогоном (не гипотетически): без этого маппинга ни
 * один PermissionGrant никогда не создаётся ни для одной Position — deny-
 * by-default PolicyEvaluatorService отклоняет ЛЮБОЙ authenticated ERP-запрос
 * даже для только что созданного owner, поскольку grants-таблица пуста.
 *
 * `position.read` (все роли, scope 'organization') — security review
 * 31.08.2026: GET /team-users и POST /team-users/ensure-team не имели
 * НИКАКОГО PermissionGuard (только TenantGuard), возвращая HR-PII
 * (loginEmail/phone/birthDate/department/telegram/whatsapp/vk/instagram/
 * website) всех сотрудников организации без проверки прав вызывающего —
 * технический фикс deny-by-default разрыва, не новое бизнес-решение
 * владельца об ограничении видимости команды: сохраняет текущее поведение
 * (любой залогиненный сотрудник организации видит список команды), просто
 * делает его explicit grant'ом, а не отсутствием guard'а по умолчанию.
 *
 * Доливка в существующие позиции (11.09.2026). Этот набор применяется при
 * создании Position; позиции, созданные ДО появления записи, её не имеют.
 * После выкладки, добавившей сюда записи, запускается
 * `pnpm --filter @baza/api run grants:backfill-defaults` (сначала
 * `-- --dry-run`) — DefaultGrantsBackfillService доливает отсутствующие пары
 * resource+action, не трогая отозванные вручную и суженные по scope.
 * Смену scope у уже выданной пары и удаление записи отсюда доливка НЕ
 * переносит: это отдельные решения о правах.
 *
 * `media_asset.upload` (01.09.2026) — обратный случай ко всем остальным
 * записям этого файла: право не «выдано и не используется», а НАОБОРОТ
 * проверялось в коде (@RequirePermission('media_asset','upload') на
 * POST /media/upload-intent и POST /media/:assetId/confirm), но не было
 * выдано НИ ОДНОЙ роли. То есть оба эндпоинта отвечали 403 всем и всегда.
 *
 * Автор MediaController это предвидел и записал в его докстринге:
 * "permission-matrix.md не специфицирует media-права явно... при следующем
 * ревью этот раздел должен быть добавлен туда как источник истины, а не
 * только жить в коде". Ревью не случилось, дыра осталась.
 *
 * Почему это не мёртвый код, который можно удалить: из пяти назначений
 * загрузки (MEDIA_PURPOSE_BUCKET) только property_photo закрыт отдельным
 * путём property-assets со своим правом property_asset.edit. Плана этажа
 * (floor_plan), фото юнита (unit_photo), документа агентства
 * (agency_document) и аватара (profile_avatar) загрузить было НЕЛЬЗЯ
 * никак — другого пути для них нет.
 *
 * Выдано ровно тем ролям, у которых уже есть property_asset.edit
 * (owner/director/rop/manager/developer): они и так грузят медиа через
 * путь property-assets, поэтому грант не расширяет ничьих реальных
 * возможностей — он разблокирует остальные назначения. administrator и
 * marketer не получают: у них нет ни property_asset.edit, ни
 * development.edit, с медиа объектов они не работают.
 *
 * `import.run` (03.09.2026, POST /leads/import) — по прямой аналогии с
 * `export.run`: право "импортировать вообще", не право заводить лиды само
 * по себе (LeadImportService дополнительно проверяет lead.create на каждую
 * строку, тот же принцип "две ступени", что у export.run/<entity>.read).
 * Выдано всем ролям, у которых уже есть `lead.create`
 * (owner/director/rop/manager/administrator/developer) — импорт не
 * расширяет ничьих реальных возможностей, лишь даёт завести много лидов
 * за один запрос вместо ручной формы по одному. `marketer` не получает —
 * у него нет lead.create.
 *
 * `calendar_event.*` (04.09.2026, CalendarEventController расширяет CRM-модуль)
 * — тот же принцип, что `task.*`: own-scope у manager (событие видно/
 * редактируемо, если сам participant ИЛИ createdBy — см.
 * CalendarEventRepository.scopeFilter), organization-scope у
 * owner/director/rop/developer. В отличие от Task (без DELETE-эндпоинта
 * вовсе) и Lead (`lead.delete` только organization, БЕЗ manager — удаление
 * лида разрушительно для общей воронки), `calendar_event.delete` выдан
 * И manager'у own-scope: календарное событие — личный инструмент
 * координации создателя/участника, не общий pipeline-ресурс, удаление
 * своей же встречи/звонка не требует эскалации до руководителя (тот же
 * принцип, что легаси `deleteCalendarEvent` не ограничивал по роли, только
 * по `userId` вызывающего). `administrator`/`marketer` не получают — тот
 * же круг, что `deal.*` (администратор ведёт задачи, но не CRM-воронку и
 * не расписание встреч; маркетолог не работает с CRM вовсе).
 *
 * `lead.update`/`lead.delete` (`[phase 3 — 03.09.2026]`, детальная карточка
 * лида, backend-часть) — тот же прецедент, что `lead.changeStage` (D-05B):
 * PATCH /leads/:leadId (сопутствующие поля — city/notes/tags/dealValue/
 * budgetValue/budgetCurrency/expectedCloseDate/rejectionReason/
 * rejectionComment/telegram/country/realtorStage/curatorStage, никогда
 * `stage`) и POST /leads/:leadId/files, DELETE /leads/:leadId/files/:assetId,
 * POST /leads/:leadId/contact-actions переиспользуют `lead.update`.
 * `lead.update` — та же scope-модель, что `lead.changeStage`: `own` у
 * manager (ведёт сопутствующие поля СВОИХ лидов), `organization` у
 * owner/director/rop/developer. `lead.delete` — отдельный грант (удаление
 * разрушительнее правки полей), тот же круг ролей, что `lead.assign`
 * (owner/director/rop/developer, organization-wide, БЕЗ manager — менеджер
 * не должен мочь удалить лид из воронки, только вести его).
 *
 * `crm_report.read` (04.09.2026, GET /crm/reports/lead-funnel, GET
 * /crm/reports/positions — CrmReportController расширяет CRM-модуль) —
 * новый resource, отдельный от `lead.read`/`deal.read`: агрегирующий отчёт
 * по ВСЕЙ организации (в том числе по позициям других сотрудников), только
 * `organization` scope, только тем ролям, у которых уже есть
 * organization-wide `deal.read` (owner/director/rop/developer) — тот же
 * круг, что `deal.*`. `manager` НЕ получает: у него `lead.read`/`deal.read`
 * только со scope `own`, отчёт по чужим позициям ему видеть не положено (и
 * это не пересекается с TEAM-001/MyReportPage — та работа отложена отдельным
 * эпиком, см. её докстринг). `administrator`/`marketer` не получают —
 * тот же круг, что `calendar_event.*`.
 *
 * `booking.read` (BOOK-002, 04.09.2026, GET /bookings) — до этого коммита
 * GET-эндпоинта для списка броней не было вообще, только create/confirm/
 * cancel/extend. `organization` scope у owner/director/rop/developer —
 * тот же круг ролей, что уже имеет `booking.cancel`/`booking.extend`
 * (organization, не own): если роль может отменить/продлить ЛЮБУЮ бронь
 * организации, она обязана и видеть список этих броней, иначе cancel/
 * extend UI неоткуда получить bookingId. `manager` получает `own` (не
 * organization) — Booking.manager (schemas/booking.schema.ts) это ИМЕННО
 * Position, создавшая/владеющая бронью (см. booking.schema.ts докстринг:
 * "the Position that created/owns the booking"), а manager уже имеет
 * `booking.confirm` со scope `own` — без `booking.read.own` он не смог бы
 * увидеть даже свои pending-брони, которые сам же должен подтверждать.
 * `administrator`/`marketer` не получают — у них нет вообще ни одного
 * booking.*-гранта (booking-workflow вне их круга обязанностей, тот же
 * принцип, что `calendar_event.*`/`crm_report.read`).
 *
 * `dev_selection.*` (04.09.2026, миграция подборок для клиента с localStorage
 * на backend, модуль `selections`) — тот же паттерн scope, что `booking.*`:
 * `own` у manager (SelectionsController.ownerFilterForAction сужает до
 * createdByPositionId === своя Position — агент составляет подборку из
 * лотов для СВОЕГО клиента, не должен видеть/менять чужие), `organization`
 * у owner/director/rop/developer (тот же круг, что `installment_plan.*`).
 * `administrator`/`marketer` не получают — вне их круга обязанностей (тот
 * же принцип, что `booking.*`/`calendar_event.*`).
 *
 * `buyer_request.respond` (N-13, 13.09.2026, ERP-отклик организации на
 * публичную доску запросов покупателя) — `organization` scope у ровно того
 * же круга ролей, что уже имеет `lead.create` (owner/director/rop/manager/
 * administrator/developer): отклик — это команда создания записи, а не
 * чтение/изменение уже существующей ownerPositionId-принадлежащей сущности,
 * поэтому own-scope здесь так же не нужен manager'у, как он не нужен ему у
 * `lead.create` (own-scope имеет смысл только после того, как запись уже
 * существует и у неё есть владелец). `marketer` не получает — тот же круг,
 * что у `lead.create` (маркетинг не ведёт клиентов).
 *
 * `plan.read`/`plan.update` (15.09.2026, модуль `plans` — месячные планы
 * сотрудников): scope `organization` у owner/director/rop/developer — видят и
 * ставят планы всей организации; scope `own` у manager/administrator/marketer —
 * свой план (сотрудник может выставить план сам себе). permission-matrix.md
 * разд.1.11.
 *
 * `news.*` (15.09.2026, модуль `news` — лента новостей ERP). `read` scope
 * `organization` у всех семи ролей: новости платформы и своей компании видит
 * каждый сотрудник. `create`/`update`/`delete` scope `organization` у
 * owner/director/developer — руководитель компании публикует, правит и
 * удаляет новости для своих сотрудников. Новости платформы ведёт админка (грант администратора
 * `news.publish`), не роли организации. permission-matrix.md разд.1.12.
 *
 * `library_item.*` (15.09.2026, модуль `library` — библиотека материалов CRM,
 * легаси-блок «Библиотека» и файлы чек-листа стадии лида). `read` scope
 * `organization` у всех семи ролей: общие материалы организации видит каждый
 * сотрудник. `create`/`delete` scope `organization` у owner/director/rop/
 * developer — могут менять общие материалы; manager получает scope `own` —
 * только своя личная библиотека. administrator и marketer — только чтение:
 * у них нет `media_asset.upload`, загрузить файл им нечем. Личная библиотека
 * видна только владельцу при любом scope, как заметка (permission-matrix.md
 * разд.1.10).
 *
 * `note.*` (14.09.2026, модуль `notes` — личный блокнот менеджера, легаси-блок
 * «Заметки» на фронте ERP) — ЕДИНСТВЕННЫЙ resource в этом файле со scope
 * `own` у ВСЕХ семи ролей без исключения, включая `owner`/`director`: заметка
 * — личный инструмент автора, не организационный CRM-ресурс вроде Task/Lead,
 * и даже владелец организации чужую заметку не видит и не редактирует
 * (permission-matrix.md разд.1.9). `organization`/`team`-scope здесь не имеет
 * смысла в принципе — не "сужение до своего", а единственно возможный режим.
 *
 * `client.reassign` у `developer` (14.09.2026) — permission-matrix.md разд.1
 * помечал сверку разделов 1.1–1.6 для `developer` открытым пунктом с
 * 11.09.2026; сверка нашла один реальный пробел: `developer` имел
 * organization-wide `deal.edit`/`deal.read`/`deal.changeStage` и управляет
 * командой (`position.create`/`assign_occupant`/`vacate`), но не имел
 * `client.reassign` — единственного гранта, которым `PATCH /deals/:id/
 * reassign` (deal.controller.ts) переносит сделку на другую Position. Без
 * него у developer-организации не было способа передать сделки
 * освободившегося сотрудника кому-то ещё, хотя D-07 (27.08.2026) прямо
 * требовал "тот же набор, что у agency owner", а owner/director/rop этот
 * грант уже имели (permission-matrix.md разд.1.1). Остальные разделы 1.1–1.6
 * при той же построчной сверке совпали с owner-уровнем корректно, включая
 * намеренное отсутствие `manual_ledger.read` (разд.1.5: owner-only по
 * дизайну, не пробел).
 */
export const DEFAULT_ROLE_GRANTS: Record<FixedRole, DefaultGrant[]> = {
  owner: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'create', scope: 'organization' },
    { resource: 'buyer_request', action: 'respond', scope: 'organization' },
    { resource: 'lead', action: 'assign', scope: 'organization' },
    { resource: 'lead', action: 'changeStage', scope: 'organization' },
    { resource: 'lead', action: 'update', scope: 'organization' },
    { resource: 'lead', action: 'delete', scope: 'organization' },
    { resource: 'contact', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'create', scope: 'organization' },
    { resource: 'task', action: 'edit', scope: 'organization' },
    { resource: 'task', action: 'complete', scope: 'organization' },
    { resource: 'deal', action: 'read', scope: 'organization' },
    { resource: 'deal', action: 'create', scope: 'organization' },
    { resource: 'deal', action: 'edit', scope: 'organization' },
    { resource: 'deal', action: 'changeStage', scope: 'organization' },
    { resource: 'task', action: 'reassign', scope: 'organization' },
    { resource: 'client', action: 'reassign', scope: 'organization' },
    { resource: 'calendar_event', action: 'read', scope: 'organization' },
    { resource: 'calendar_event', action: 'create', scope: 'organization' },
    { resource: 'calendar_event', action: 'update', scope: 'organization' },
    { resource: 'calendar_event', action: 'delete', scope: 'organization' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'development', action: 'edit', scope: 'organization' },
    { resource: 'property_asset', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'create', scope: 'organization' },
    { resource: 'property_asset', action: 'edit', scope: 'organization' },
    { resource: 'media_asset', action: 'upload', scope: 'organization' },
    { resource: 'listing', action: 'read', scope: 'organization' },
    { resource: 'listing', action: 'create', scope: 'organization' },
    { resource: 'listing', action: 'edit', scope: 'organization' },
    { resource: 'unit', action: 'price.update', scope: 'organization' },
    { resource: 'unit', action: 'status.update', scope: 'organization' },
    { resource: 'chessboard', action: 'export', scope: 'organization' },
    { resource: 'booking', action: 'create', scope: 'own' },
    { resource: 'booking', action: 'read', scope: 'organization' },
    { resource: 'booking', action: 'confirm', scope: 'own' },
    { resource: 'booking', action: 'cancel', scope: 'organization' },
    { resource: 'booking', action: 'extend', scope: 'organization' },
    { resource: 'position', action: 'create', scope: 'organization' },
    { resource: 'position', action: 'assign_occupant', scope: 'organization' },
    { resource: 'position', action: 'vacate', scope: 'organization' },
    { resource: 'personal_access', action: 'grant', scope: 'position' },
    { resource: 'finance', action: 'read', scope: 'organization' },
    { resource: 'manual_ledger', action: 'read', scope: 'organization' },
    { resource: 'export', action: 'run', scope: 'organization' },
    { resource: 'import', action: 'run', scope: 'organization' },
    { resource: 'crm_report', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'create', scope: 'organization' },
    { resource: 'installment_plan', action: 'update', scope: 'organization' },
    { resource: 'installment_plan', action: 'delete', scope: 'organization' },
    { resource: 'dev_selection', action: 'read', scope: 'organization' },
    { resource: 'dev_selection', action: 'create', scope: 'organization' },
    { resource: 'dev_selection', action: 'update', scope: 'organization' },
    { resource: 'dev_selection', action: 'delete', scope: 'organization' },
    { resource: 'messenger_account', action: 'read', scope: 'organization' },
    { resource: 'messenger_account', action: 'manage', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'read', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'link_crm', scope: 'organization' },
    { resource: 'messenger_message', action: 'send', scope: 'organization' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_material', action: 'manage', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'manage', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'organization' },
    { resource: 'community_thread', action: 'manage', scope: 'organization' },
    { resource: 'community_reply', action: 'create', scope: 'organization' },
    { resource: 'community_reply', action: 'manage', scope: 'organization' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_exchange', action: 'create', scope: 'organization' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'organization' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'read', scope: 'organization' },
    { resource: 'news', action: 'create', scope: 'organization' },
    { resource: 'news', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'delete', scope: 'organization' },
    { resource: 'library_item', action: 'create', scope: 'organization' },
    { resource: 'library_item', action: 'delete', scope: 'organization' },
  ],
  director: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'create', scope: 'organization' },
    { resource: 'buyer_request', action: 'respond', scope: 'organization' },
    { resource: 'lead', action: 'assign', scope: 'organization' },
    { resource: 'lead', action: 'changeStage', scope: 'organization' },
    { resource: 'lead', action: 'update', scope: 'organization' },
    { resource: 'lead', action: 'delete', scope: 'organization' },
    { resource: 'lead', action: 'reassign', scope: 'organization' },
    { resource: 'contact', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'create', scope: 'organization' },
    { resource: 'task', action: 'edit', scope: 'organization' },
    { resource: 'task', action: 'complete', scope: 'organization' },
    { resource: 'deal', action: 'read', scope: 'organization' },
    { resource: 'deal', action: 'create', scope: 'organization' },
    { resource: 'deal', action: 'edit', scope: 'organization' },
    { resource: 'deal', action: 'changeStage', scope: 'organization' },
    { resource: 'task', action: 'reassign', scope: 'organization' },
    { resource: 'client', action: 'reassign', scope: 'organization' },
    { resource: 'calendar_event', action: 'read', scope: 'organization' },
    { resource: 'calendar_event', action: 'create', scope: 'organization' },
    { resource: 'calendar_event', action: 'update', scope: 'organization' },
    { resource: 'calendar_event', action: 'delete', scope: 'organization' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'development', action: 'edit', scope: 'organization' },
    { resource: 'property_asset', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'create', scope: 'organization' },
    { resource: 'property_asset', action: 'edit', scope: 'organization' },
    { resource: 'media_asset', action: 'upload', scope: 'organization' },
    { resource: 'listing', action: 'read', scope: 'organization' },
    { resource: 'listing', action: 'create', scope: 'organization' },
    { resource: 'listing', action: 'edit', scope: 'organization' },
    { resource: 'unit', action: 'price.update', scope: 'organization' },
    { resource: 'unit', action: 'status.update', scope: 'organization' },
    { resource: 'chessboard', action: 'export', scope: 'organization' },
    { resource: 'booking', action: 'create', scope: 'own' },
    { resource: 'booking', action: 'read', scope: 'organization' },
    { resource: 'booking', action: 'confirm', scope: 'own' },
    { resource: 'booking', action: 'cancel', scope: 'organization' },
    { resource: 'booking', action: 'extend', scope: 'organization' },
    { resource: 'position', action: 'create', scope: 'organization' },
    { resource: 'position', action: 'assign_occupant', scope: 'organization' },
    { resource: 'position', action: 'vacate', scope: 'organization' },
    { resource: 'personal_access', action: 'grant', scope: 'position' },
    { resource: 'finance', action: 'read', scope: 'organization' },
    { resource: 'export', action: 'run', scope: 'organization' },
    { resource: 'import', action: 'run', scope: 'organization' },
    { resource: 'crm_report', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'create', scope: 'organization' },
    { resource: 'installment_plan', action: 'update', scope: 'organization' },
    { resource: 'installment_plan', action: 'delete', scope: 'organization' },
    { resource: 'dev_selection', action: 'read', scope: 'organization' },
    { resource: 'dev_selection', action: 'create', scope: 'organization' },
    { resource: 'dev_selection', action: 'update', scope: 'organization' },
    { resource: 'dev_selection', action: 'delete', scope: 'organization' },
    { resource: 'messenger_account', action: 'read', scope: 'organization' },
    { resource: 'messenger_account', action: 'manage', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'read', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'link_crm', scope: 'organization' },
    { resource: 'messenger_message', action: 'send', scope: 'organization' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_material', action: 'manage', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'manage', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'organization' },
    { resource: 'community_thread', action: 'manage', scope: 'organization' },
    { resource: 'community_reply', action: 'create', scope: 'organization' },
    { resource: 'community_reply', action: 'manage', scope: 'organization' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_exchange', action: 'create', scope: 'organization' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'organization' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'read', scope: 'organization' },
    { resource: 'news', action: 'create', scope: 'organization' },
    { resource: 'news', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'delete', scope: 'organization' },
    { resource: 'library_item', action: 'create', scope: 'organization' },
    { resource: 'library_item', action: 'delete', scope: 'organization' },
  ],
  rop: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'create', scope: 'organization' },
    { resource: 'buyer_request', action: 'respond', scope: 'organization' },
    { resource: 'lead', action: 'assign', scope: 'organization' },
    { resource: 'lead', action: 'changeStage', scope: 'organization' },
    { resource: 'lead', action: 'update', scope: 'organization' },
    { resource: 'lead', action: 'delete', scope: 'organization' },
    { resource: 'lead', action: 'reassign', scope: 'team' },
    { resource: 'contact', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'create', scope: 'organization' },
    { resource: 'task', action: 'edit', scope: 'organization' },
    { resource: 'task', action: 'complete', scope: 'organization' },
    { resource: 'deal', action: 'read', scope: 'organization' },
    { resource: 'deal', action: 'create', scope: 'organization' },
    { resource: 'deal', action: 'edit', scope: 'organization' },
    { resource: 'deal', action: 'changeStage', scope: 'organization' },
    // rop.task.reassign — 'organization', не 'team': PermissionScope 'team'
    // существует в enum, но не имеет реальной реализации сужения нигде в
    // кодовой базе (нет модели подчинённости/иерархии Position) — тот же
    // выбор, что уже сделан для lead.reassign у rop НЕ применяется здесь
    // буквально (там team ИСПОЛЬЗУЕТСЯ, хоть и без реального сужения);
    // для task.reassign явно взят organization по решению владельца
    // (30.08.2026) — team для task отложен до появления модели команды.
    { resource: 'task', action: 'reassign', scope: 'organization' },
    { resource: 'client', action: 'reassign', scope: 'organization' },
    { resource: 'calendar_event', action: 'read', scope: 'organization' },
    { resource: 'calendar_event', action: 'create', scope: 'organization' },
    { resource: 'calendar_event', action: 'update', scope: 'organization' },
    { resource: 'calendar_event', action: 'delete', scope: 'organization' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'create', scope: 'organization' },
    { resource: 'property_asset', action: 'edit', scope: 'organization' },
    { resource: 'media_asset', action: 'upload', scope: 'organization' },
    { resource: 'listing', action: 'read', scope: 'organization' },
    { resource: 'listing', action: 'create', scope: 'organization' },
    { resource: 'listing', action: 'edit', scope: 'organization' },
    { resource: 'unit', action: 'price.update', scope: 'organization' },
    { resource: 'unit', action: 'status.update', scope: 'organization' },
    { resource: 'chessboard', action: 'export', scope: 'organization' },
    { resource: 'booking', action: 'create', scope: 'own' },
    { resource: 'booking', action: 'read', scope: 'organization' },
    { resource: 'booking', action: 'confirm', scope: 'own' },
    { resource: 'booking', action: 'cancel', scope: 'organization' },
    { resource: 'booking', action: 'extend', scope: 'organization' },
    { resource: 'export', action: 'run', scope: 'organization' },
    { resource: 'import', action: 'run', scope: 'organization' },
    { resource: 'crm_report', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'create', scope: 'organization' },
    { resource: 'installment_plan', action: 'update', scope: 'organization' },
    { resource: 'installment_plan', action: 'delete', scope: 'organization' },
    { resource: 'dev_selection', action: 'read', scope: 'organization' },
    { resource: 'dev_selection', action: 'create', scope: 'organization' },
    { resource: 'dev_selection', action: 'update', scope: 'organization' },
    { resource: 'dev_selection', action: 'delete', scope: 'organization' },
    { resource: 'messenger_account', action: 'read', scope: 'organization' },
    { resource: 'messenger_account', action: 'manage', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'read', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'link_crm', scope: 'organization' },
    { resource: 'messenger_message', action: 'send', scope: 'organization' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_material', action: 'manage', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'manage', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'organization' },
    { resource: 'community_thread', action: 'manage', scope: 'organization' },
    { resource: 'community_reply', action: 'create', scope: 'organization' },
    { resource: 'community_reply', action: 'manage', scope: 'organization' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_exchange', action: 'create', scope: 'organization' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'organization' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'read', scope: 'organization' },
    { resource: 'library_item', action: 'create', scope: 'organization' },
    { resource: 'library_item', action: 'delete', scope: 'organization' },
  ],
  manager: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'read', scope: 'own' },
    { resource: 'lead', action: 'create', scope: 'organization' },
    { resource: 'buyer_request', action: 'respond', scope: 'organization' },
    // import.run (03.09.2026, POST /leads/import) — manager не имеет
    // export.run (нет доступа к bulk-выгрузке чужих данных organization-wide
    // через файл), но lead.create у него уже есть, а import — ровно тот же
    // способ завести лид, что и ручная форма, просто много строк за один
    // запрос. LeadImportService дополнительно требует lead.create на каждую
    // строку — этот грант сам по себе доступа не расширяет.
    { resource: 'import', action: 'run', scope: 'organization' },
    // D-05B: manager ведёт своих лидов по воронке — очевидная возможность,
    // scope 'own' сужает до лидов, где ownerPositionId === своя Position
    // (ownerFilterForAction в LeadController, не автоматически — deny-by-
    // default guard проверяет только наличие гранта, не scope).
    { resource: 'lead', action: 'changeStage', scope: 'own' },
    // `[phase 3]` lead.update — та же own-scope сужение до "своих" лидов
    // (ownerPositionId === своя Position), что lead.changeStage. Manager
    // НЕ получает lead.delete — удаление остаётся организационным правом.
    { resource: 'lead', action: 'update', scope: 'own' },
    { resource: 'contact', action: 'read', scope: 'own' },
    { resource: 'task', action: 'read', scope: 'own' },
    { resource: 'task', action: 'create', scope: 'organization' },
    { resource: 'task', action: 'edit', scope: 'own' },
    { resource: 'task', action: 'complete', scope: 'own' },
    { resource: 'deal', action: 'read', scope: 'own' },
    { resource: 'deal', action: 'create', scope: 'organization' },
    { resource: 'deal', action: 'edit', scope: 'own' },
    { resource: 'deal', action: 'changeStage', scope: 'own' },
    // own-scope: событие видно/редактируемо, если сам participant ИЛИ
    // createdBy (см. default-role-grants.ts докстринг `calendar_event.*`
    // выше и CalendarEventRepository.scopeFilter) — не равенство одного
    // поля, как у task/deal own-scope.
    { resource: 'calendar_event', action: 'read', scope: 'own' },
    { resource: 'calendar_event', action: 'create', scope: 'own' },
    { resource: 'calendar_event', action: 'update', scope: 'own' },
    { resource: 'calendar_event', action: 'delete', scope: 'own' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'create', scope: 'organization' },
    { resource: 'property_asset', action: 'edit', scope: 'organization' },
    { resource: 'media_asset', action: 'upload', scope: 'organization' },
    { resource: 'listing', action: 'read', scope: 'organization' },
    { resource: 'listing', action: 'create', scope: 'organization' },
    { resource: 'listing', action: 'edit', scope: 'organization' },
    { resource: 'booking', action: 'create', scope: 'own' },
    { resource: 'booking', action: 'read', scope: 'own' },
    { resource: 'booking', action: 'confirm', scope: 'own' },
    { resource: 'dev_selection', action: 'read', scope: 'own' },
    { resource: 'dev_selection', action: 'create', scope: 'own' },
    { resource: 'dev_selection', action: 'update', scope: 'own' },
    { resource: 'dev_selection', action: 'delete', scope: 'own' },
    { resource: 'messenger_dialog', action: 'read', scope: 'own' },
    { resource: 'messenger_dialog', action: 'link_crm', scope: 'own' },
    { resource: 'messenger_message', action: 'send', scope: 'own' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'own' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'own' },
    { resource: 'community_reply', action: 'create', scope: 'own' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_exchange', action: 'create', scope: 'own' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'own' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'own' },
    { resource: 'plan', action: 'update', scope: 'own' },
    { resource: 'news', action: 'read', scope: 'organization' },
    { resource: 'library_item', action: 'create', scope: 'own' },
    { resource: 'library_item', action: 'delete', scope: 'own' },
  ],
  administrator: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'create', scope: 'organization' },
    { resource: 'buyer_request', action: 'respond', scope: 'organization' },
    { resource: 'contact', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'create', scope: 'organization' },
    { resource: 'task', action: 'complete', scope: 'organization' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'unit', action: 'price.update', scope: 'organization' },
    { resource: 'unit', action: 'status.update', scope: 'organization' },
    { resource: 'chessboard', action: 'export', scope: 'organization' },
    { resource: 'export', action: 'run', scope: 'organization' },
    { resource: 'import', action: 'run', scope: 'organization' },
    { resource: 'messenger_account', action: 'read', scope: 'organization' },
    { resource: 'messenger_account', action: 'manage', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'read', scope: 'organization' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'own' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'organization' },
    { resource: 'community_thread', action: 'manage', scope: 'organization' },
    { resource: 'community_reply', action: 'create', scope: 'organization' },
    { resource: 'community_reply', action: 'manage', scope: 'organization' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_exchange', action: 'create', scope: 'organization' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'organization' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'own' },
    { resource: 'plan', action: 'update', scope: 'own' },
    { resource: 'news', action: 'read', scope: 'organization' },
  ],
  marketer: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'chessboard', action: 'export', scope: 'organization' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'own' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'own' },
    { resource: 'community_reply', action: 'create', scope: 'own' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'own' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'own' },
    { resource: 'plan', action: 'update', scope: 'own' },
    { resource: 'news', action: 'read', scope: 'organization' },
  ],
  // 27.08.2026 (владелец подтвердил, D-07 vertical E2E): developer-организация
  // публикует свои ЖК на marketplace и получает лиды через reveal-contact на
  // собственные публикации (MarketplaceService создаёт Lead с ownerPositionId
  // = организация публикации) — lead.read/assign/changeStage нужны, чтобы
  // owner+команда developer-организации видели и вели эти лиды в своём ERP,
  // тот же набор, что у agency owner.
  developer: [
    { resource: 'position', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'read', scope: 'organization' },
    { resource: 'lead', action: 'create', scope: 'organization' },
    { resource: 'buyer_request', action: 'respond', scope: 'organization' },
    { resource: 'lead', action: 'assign', scope: 'organization' },
    { resource: 'lead', action: 'changeStage', scope: 'organization' },
    { resource: 'lead', action: 'update', scope: 'organization' },
    { resource: 'lead', action: 'delete', scope: 'organization' },
    { resource: 'contact', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'read', scope: 'organization' },
    { resource: 'task', action: 'create', scope: 'organization' },
    { resource: 'task', action: 'edit', scope: 'organization' },
    { resource: 'task', action: 'complete', scope: 'organization' },
    { resource: 'deal', action: 'read', scope: 'organization' },
    { resource: 'deal', action: 'create', scope: 'organization' },
    { resource: 'deal', action: 'edit', scope: 'organization' },
    { resource: 'deal', action: 'changeStage', scope: 'organization' },
    { resource: 'task', action: 'reassign', scope: 'organization' },
    { resource: 'client', action: 'reassign', scope: 'organization' },
    { resource: 'calendar_event', action: 'read', scope: 'organization' },
    { resource: 'calendar_event', action: 'create', scope: 'organization' },
    { resource: 'calendar_event', action: 'update', scope: 'organization' },
    { resource: 'calendar_event', action: 'delete', scope: 'organization' },
    { resource: 'development', action: 'read', scope: 'organization' },
    { resource: 'development', action: 'edit', scope: 'organization' },
    { resource: 'property_asset', action: 'read', scope: 'organization' },
    { resource: 'property_asset', action: 'create', scope: 'organization' },
    { resource: 'property_asset', action: 'edit', scope: 'organization' },
    { resource: 'media_asset', action: 'upload', scope: 'organization' },
    { resource: 'listing', action: 'read', scope: 'organization' },
    { resource: 'listing', action: 'create', scope: 'organization' },
    { resource: 'listing', action: 'edit', scope: 'organization' },
    { resource: 'unit', action: 'price.update', scope: 'organization' },
    { resource: 'unit', action: 'status.update', scope: 'organization' },
    { resource: 'chessboard', action: 'export', scope: 'organization' },
    { resource: 'booking', action: 'create', scope: 'own' },
    { resource: 'booking', action: 'read', scope: 'organization' },
    { resource: 'booking', action: 'confirm', scope: 'own' },
    { resource: 'booking', action: 'cancel', scope: 'organization' },
    { resource: 'booking', action: 'extend', scope: 'organization' },
    { resource: 'position', action: 'create', scope: 'organization' },
    { resource: 'position', action: 'assign_occupant', scope: 'organization' },
    { resource: 'position', action: 'vacate', scope: 'organization' },
    { resource: 'personal_access', action: 'grant', scope: 'position' },
    { resource: 'finance', action: 'read', scope: 'organization' },
    { resource: 'export', action: 'run', scope: 'organization' },
    { resource: 'import', action: 'run', scope: 'organization' },
    { resource: 'crm_report', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'read', scope: 'organization' },
    { resource: 'installment_plan', action: 'create', scope: 'organization' },
    { resource: 'installment_plan', action: 'update', scope: 'organization' },
    { resource: 'installment_plan', action: 'delete', scope: 'organization' },
    { resource: 'dev_selection', action: 'read', scope: 'organization' },
    { resource: 'dev_selection', action: 'create', scope: 'organization' },
    { resource: 'dev_selection', action: 'update', scope: 'organization' },
    { resource: 'dev_selection', action: 'delete', scope: 'organization' },
    { resource: 'messenger_account', action: 'read', scope: 'organization' },
    { resource: 'messenger_account', action: 'manage', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'read', scope: 'organization' },
    { resource: 'messenger_dialog', action: 'link_crm', scope: 'organization' },
    { resource: 'messenger_message', action: 'send', scope: 'organization' },
    { resource: 'lms_material', action: 'read', scope: 'organization' },
    { resource: 'lms_material', action: 'manage', scope: 'organization' },
    { resource: 'lms_course', action: 'read', scope: 'organization' },
    { resource: 'lms_course', action: 'manage', scope: 'organization' },
    { resource: 'lms_progress', action: 'read', scope: 'organization' },
    { resource: 'lms_progress', action: 'update', scope: 'own' },
    { resource: 'community_thread', action: 'read', scope: 'organization' },
    { resource: 'community_thread', action: 'create', scope: 'organization' },
    { resource: 'community_thread', action: 'manage', scope: 'organization' },
    { resource: 'community_reply', action: 'create', scope: 'organization' },
    { resource: 'community_reply', action: 'manage', scope: 'organization' },
    { resource: 'community_exchange', action: 'read', scope: 'organization' },
    { resource: 'community_exchange', action: 'create', scope: 'organization' },
    { resource: 'community_event', action: 'read', scope: 'organization' },
    { resource: 'community_event', action: 'attend', scope: 'organization' },
    { resource: 'note', action: 'read', scope: 'own' },
    { resource: 'note', action: 'create', scope: 'own' },
    { resource: 'note', action: 'update', scope: 'own' },
    { resource: 'note', action: 'delete', scope: 'own' },
    { resource: 'library_item', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'read', scope: 'organization' },
    { resource: 'plan', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'read', scope: 'organization' },
    { resource: 'news', action: 'create', scope: 'organization' },
    { resource: 'news', action: 'update', scope: 'organization' },
    { resource: 'news', action: 'delete', scope: 'organization' },
    { resource: 'library_item', action: 'create', scope: 'organization' },
    { resource: 'library_item', action: 'delete', scope: 'organization' },
  ],
};
