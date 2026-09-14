# Личный блокнот менеджера (CRM notes)

Дата: 14.09.2026. Статус: сделано.

## Что это

Во фронте ERP есть легаси-блок «Заметки», унаследованный от чужого продукта —
раньше он писал в чужой сервер, которого у нас нет. Владелец продукта решил
завести заметки у нас: отдельный модуль `apps/api/src/modules/notes`,
самостоятельный от CRM (`crm`), не расширяющий его.

## Контракт (кратко)

Глобальный префикс `/api/v1`, cookie-сессия, `TenantGuard` + `PermissionGuard`.

- `GET /notes?leadId=&cursor=&limit=` — список своих заметок, newest-first,
  cursor-paginated (тот же паттерн, что `/tasks`).
- `GET /notes/:noteId` — своя заметка по id.
- `POST /notes` — создание, требует `Idempotency-Key`.
- `PATCH /notes/:noteId` — CAS-обновление по `expectedVersion`
  (conventions.md разд.5), `Idempotency-Key` не требуется.
- `DELETE /notes/:noteId` — удаление по id, идемпотентно (повтор на уже
  удалённой заметке — 404), `Idempotency-Key` не требуется.
- `GET /notes/:noteId/attachments/:assetId/download` — presigned URL
  вложения, тот же паттерн, что у задач.

`NoteView`: `{id, organizationId, authorPositionId, title, content, isPinned,
category: 'personal'|'work', leadId, attachments, version, createdAt,
updatedAt}`.

Полная спецификация — `docs/api/v1-first-vertical-slice.yaml`, раздел `/notes`.

## Изоляция

ВСЕ запросы (чтение и запись) фильтруются по `{organizationId,
authorPositionId}`. В отличие от Task (где org-scope роль видит все рабочие
задачи организации), у заметки нет organization-wide видимости вообще —
это личный блокнот, и даже owner/director организации не видит чужую заметку.
`NoteRepository` — единственная точка доступа к коллекции `notes`, каждый
метод содержит оба поля прямо в Mongo-фильтре (tenant-scope.test.ts).

## Привязка к лиду

`leadId` в `POST`/`PATCH` проверяется через публичный
`CrmService.getLeadForOrganization` (не через `LeadRepository` напрямую —
ADR-001, module-boundaries.test.ts). Scope вычисляется в контроллере тем же
способом, что `TaskController.ownerFilterForAction`: если у вызывающей
позиции есть `lead.read` со scope `organization`/`global` — можно привязать
любой лид организации; если только `own` — только свой лид; если гранта
`lead.read` нет вовсе — `403`.

## Вложения

Тот же паттерн, что у Task-вложений (`CrmService.createTask`):
`MediaService.getAssetsForOwnerScope` проверяет принадлежность организации и
статус `verified`; purpose при привязке не проверяется (та же практика, что
у задач и лидов). Новый purpose `note_attachment: 'private'` добавлен в
`MEDIA_PURPOSE_BUCKET` (`apps/api/src/modules/media/media.constants.ts`).
Лимит — 10 вложений на заметку.

## Почему без аудита

`docs/security/permission-matrix.md` §4 требует audit-запись только для
критических действий (блокировки/редактуры, влияющие на отчётность или
других пользователей). Личная заметка видна и меняется только своим
автором — тот же прецедент, что подборки клиента (`selections`), у которых
аудита тоже нет. Outbox-события не пишутся по той же причине — воркеров,
которым нужно на них реагировать, нет.

## Права

`note.read`/`note.create`/`note.update`/`note.delete`, scope `own` у всех
семи ролей без исключения (`docs/security/permission-matrix.md` разд.1.9,
`default-role-grants.ts`).

**После выкладки этого коммита нужно запустить**
`pnpm --filter @baza/api run grants:backfill-defaults` (сначала
`-- --dry-run`) для организаций, созданных ДО него — иначе позиции без
доливки получат `403` на все `/notes`-эндпоинты. См.
[default-grants-backfill.md](default-grants-backfill.md).

## Проверено

- Unit: `note.repository.spec.ts`, `notes.service.spec.ts`,
  `notes.controller.spec.ts`.
- Integration: `test/integration/notes.integration-spec.ts` (MongoMemoryReplSet).
- Архитектурные стражи: `tenant-scope`, `authorization-coverage`,
  `idempotency-coverage`, `permission-grants`, `openapi-route-coverage`,
  `module-boundaries`.
