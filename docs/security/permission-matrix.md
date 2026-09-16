# Permission matrix — BAZA.sale

**Статус**: Proposed (первый цельный проход, 25.08.2026)
**Опирается на**: ADR-002 (TenantContext), ADR-003 (Position/Assignment), ADR-009 (Admin grants model), domain-model.md Модуль 3 (PermissionGrant).
**Формат**: `resource.action.scope` — единая тройка для ERP-organization grants и Admin grants (ADR-009), реализуется через `PermissionGrant`-коллекцию (mongodb-schema.md).

Deny-by-default: отсутствие явного grant означает отказ. Скрытая кнопка на frontend не считается защитой (master plan разд.5.4) — каждая строка ниже проверяется сервером на каждый вызов, не только определяет видимость UI.

---

## 1. Базовые роли организации (ERP) — default grant sets

Шесть фиксированных ролей (ADR-003, ADR-008 Accepted в исходном журнале решений master plan; `marketer` добавлена 25.08.2026 — `[technical decision]`, не owner decision, см. примечание ниже раздела 1.2): **owner, director, rop, manager, administrator, marketer**. Роль на `Position` задаёт **стартовый** набор grants при создании позиции — далее super_admin организации (owner) может донастроить конкретные grants индивидуально через `accessProfile` (Position, Module 2 domain-model.md) или `personalAccess` (override поверх позиции для конкретного человека — уже частично специфицировано в ERP-коде как паттерн, `teamApi.ts`).

**Седьмая роль `developer`** (27.08.2026, D-07, подтверждена владельцем) есть в `apps/api/src/modules/organizations/default-role-grants.ts`: набор уровня owner для организации-застройщика, которая публикует свои ЖК и ведёт лиды с витрины. Разделы 1.1–1.6 её не показывают, разделы 1.7–1.8 показывают.

**Сверка 1.1–1.6 с кодом проведена 14.09.2026** (закрывает открытый пункт от 11.09.2026): построчное сравнение `developer` с owner-набором нашло один пробел — отсутствовал `client.reassign.organization` (разд.1.1, единственный грант `PATCH /deals/:id/reassign`), при том что owner/director/rop его уже имели и D-07 прямо требовал у `developer` "тот же набор, что у agency owner". Добавлен в код и покрыт regression-тестом (`default-role-grants.spec.ts`). Остальные строки разделов 1.1–1.6 у `developer` совпадают с owner-уровнем корректно, включая намеренное отсутствие `manual_ledger.read.organization` (разд.1.5 — owner-only по дизайну, не пробел).

**Доливка в существующие должности (с 11.09.2026).** Набор применяется при создании должности. Должностям, созданным раньше новой записи, её доливает разовая команда `pnpm --filter @baza/api run grants:backfill-defaults` (сначала `-- --dry-run`). Её нужно запустить после выкладки, добавившей грант, и после переноса организаций. Доливаются только отсутствующие пары resource+action; отозванное вручную и суженное по scope не трогается, смена scope уже выданной пары не переносится. См. [operations/default-grants-backfill.md](../operations/default-grants-backfill.md). До запуска организации, созданные раньше гранта, получают 403.

### 1.1. CRM / Leads / Contacts / Deals

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `lead.read.own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `lead.read.team` | ✓ | ✓ | ✓ | — | — | — |
| `lead.read.organization` | ✓ | ✓ | ✓ | — | ✓ | — |
| `lead.create.organization` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `lead.assign.organization` | ✓ | ✓ | ✓ | — | — | — |
| `lead.reassign.team` | — | ✓ | ✓ (только среди своих) | — | — | — |
| `contact.read.own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `contact.read.organization` | ✓ | ✓ | ✓ | — | ✓ | — |
| `client.reassign.organization` | ✓ | ✓ | ✓ | — | — | — |
| `crm.stages.configure.organization` | — | — | — | — | — | — |
| `buyer_request.respond.organization` | ✓ | ✓ | ✓ | ✓ | ✓ | — |

**`crm.stages.configure.organization` — ни у кого нет по умолчанию** (`[owner decision — xlsx #108]`: «НЕТ», организации не настраивают этапы CRM самостоятельно — воронка фиксированная на уровне платформы, не per-tenant кастомизация).

**`buyer_request.respond.organization`** (N-13, 13.09.2026) — ERP-отклик на публичную доску запросов покупателей (`docs/operations/buyer-requests-and-reviews.md`). Ровно тот же круг ролей, что `lead.create.organization`: отклик — команда создания записи, own-scope здесь так же не нужен, как и у создания лида. `developer` тоже получает (§1.7/1.8 круг, тот же принцип, что `lead.create`).

**`lead.reassign.team` для rop**: «Напиши систему чтобы роп мог между своими передавать. Диретор все и собственник все» (`[owner decision — xlsx #115]`) — rop передаёт лид/клиента только среди менеджеров своей команды (`scope: 'team'`), director/owner — вся организация (`scope: 'organization'`).

### 1.2. Development / Chessboard / Units

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `development.read.organization` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `development.edit.organization` | ✓ | ✓ | — | — | — | — |
| `unit.price.update.project` | ✓ | ✓ | ✓ | ⚙ toggle | ✓ | — |
| `unit.status.update.project` | ✓ | ✓ | ✓ | ⚙ toggle | ✓ | — |
| `chessboard.export.organization` | ✓ | ✓ | ✓ | — | ✓ | ✓ |

**`unit.price.update.project` / `unit.status.update.project` для manager**: `⚙ toggle` означает — **не default grant**, но explicit per-position включаемое право (`[owner decision — xlsx #53]`, дословно: «Из пользователей ЕРП собственник, директор, РОП, Администратор + менеджер ПРИ УСЛОВИИ ЧТО У НЕГО ЕСТЬ ТАКОЕ ПРАВО включенное в разделе команда. Там тумблер есть»). Технически: у manager-позиции по умолчанию `unit.price.update.project` **отсутствует** в `accessProfile`, но owner/director может добавить этот конкретный grant точечно через UI "тумблер" в разделе Команда — это явное подтверждение уже спроектированного паттерна ("тумблер" уже упоминается владельцем как существующий UX-концепт), не новая идея этого документа.

**`marketer` роль**: `[technical decision — 25.08.2026]`, НЕ owner decision. `TeamUserRole` во фронтенд-коде (`apps/erp-web/src/types/team.ts`) уже включает `'marketer'` как шестую позицию оргструктуры (mock-сид данные, `src/services/teamApi.ts`, содержит демо-запись "Маркетолог") — фронтенд уже спроектирован с этой ролью, backend `FixedRole` (ADR-003, изначально пять значений) расширен до шести, чтобы соответствовать. Grants для marketer в этой матрице — минимальный, консервативный набор first-pass предположений (read-доступ к каталогу и export для маркетинговых материалов, НЕ price/status/finance/position-management), не подтверждённое владельцем решение о полном объёме прав этой роли — требует явного подтверждения при первом реальном использовании раздела "Команда" с marketer-позицией.

### 1.3. Bookings

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `booking.create.own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `booking.confirm.own` | ✓ | ✓ | ✓ | ✓ (только свой лид) | — | — |
| `booking.cancel.organization` | ✓ | ✓ | ✓ | — | — | — |
| `booking.extend.organization` | ✓ | ✓ | ✓ | — | — | — |

**`booking.confirm.own` для manager**: «менеджер и все кто выше. Ну тот чей лид» (`[owner decision — xlsx #118]`) — manager подтверждает/отменяет бронь **только по своему лиду** (`scope: 'own'`), эскалация выше (rop+) не ограничена конкретным лидом.

### 1.4. Team / Positions

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `position.create.organization` | ✓ | ✓ | — | — | ✓ (⚙, `[owner decision — xlsx #24]`) | — |
| `position.assign_occupant.organization` | ✓ | ✓ | — | — | ✓ (⚙) | — |
| `position.vacate.organization` | ✓ | ✓ | — | — | ✓ (⚙) | — |
| `personal_access.grant.position` | ✓ | ✓ | — | — | — | — |

**`administrator`-роль в Team-разделе**: `[owner decision — xlsx #24]` явно запросил роль «Администратор который правами доступа и прочей хуйней занимается» — это отражено как ⚙ (не default, но естественная область ответственности этой роли, включаемая owner/director при создании позиции с `fixedRole: 'administrator'`).

### 1.5. Finance / Export

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `finance.read.organization` | ✓ | ✓ | — | — | — | — |
| `manual_ledger.read.organization` | ✓ | — | — | — | — | — |
| `export.organization` | ✓ | ✓ | ✓ | — | ✓ | — |
| `import.organization` | ✓ | ✓ | ✓ | ✓ | ✓ | — |

**`manual_ledger.read.organization` только owner**: биллинговая история — самая чувствительная финансовая информация организации, не расширяется на director по умолчанию (может быть добавлено индивидуальным grant, если владелец организации явно решит).

**`import.organization` (03.09.2026, POST /leads/import)** — CSV/XLSX импорт лидов построчным отчётом об ошибках, `[technical decision]` по прямой аналогии с `export.organization`: сам грант не даёт права заводить лиды, дополнительно требуется `lead.create` (та же двухступенчатая проверка, что у export/read — см. раздел 1.5 выше и докстринг `ExportService.buildExport`). Выдан ровно тем ролям, у которых уже есть `lead.create.organization` (owner/director/rop/manager/administrator), включая `manager`, у которого нет `export.organization` — импорт не расширяет реальных возможностей роли, только даёт завести много лидов одним файлом вместо ручной формы по одному. `marketer` не получает — нет `lead.create`.

### 1.6. Messenger & Communications (Этап 10)

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `messenger_account.read.organization` | ✓ | ✓ | ✓ | — | ✓ | — |
| `messenger_account.manage.organization` | ✓ | ✓ | ✓ | — | ✓ | — |
| `messenger_dialog.read.own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `messenger_dialog.read.organization` | ✓ | ✓ | ✓ | — | ✓ | — |
| `messenger_dialog.link_crm.own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `messenger_dialog.link_crm.organization` | ✓ | ✓ | ✓ | — | — | — |
| `messenger_message.send.own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `messenger_message.send.organization` | ✓ | ✓ | ✓ | — | — | — |

**Исправлено 11.09.2026.** `.own` у `messenger_message.send`, `messenger_dialog.link_crm` и у создания задачи из диалога раньше не применялся: контроллер сужал выборку по владельцу только для чтения, менеджер с `.own` мог писать в чужие диалоги своей организации. Проверка объединена и применена ко всем операциям записи. См. [operations/messenger-skeleton.md](../operations/messenger-skeleton.md).

### 1.7. LMS (Этап 11)

`[technical decision — 10.09.2026]`, не owner decision: гранты пришли вместе с модулем (`be0e5f7`) без записи в журнале решений. `org`/`own` — scope гранта в коде.

| Permission | owner | director | rop | manager | administrator | marketer | developer |
|---|---|---|---|---|---|---|---|
| `lms_material.read` | org | org | org | org | org | org | org |
| `lms_material.manage` | org | org | org | — | — | — | org |
| `lms_course.read` | org | org | org | org | org | org | org |
| `lms_course.manage` | org | org | org | — | — | — | org |
| `lms_progress.read` | org | org | org | own | own | own | org |
| `lms_progress.update` | own | own | own | own | own | own | own |

`lms_progress.read` со scope `org` чужой прогресс не открывает: эндпоинт отдаёт только прогресс вызывающей должности, сводки по команде нет. Правильные ответы итогового теста отдаются всем, у кого есть `lms_course.read`, — см. [operations/lms-knowledge-base.md](../operations/lms-knowledge-base.md).

### 1.8. Community и биржа MLS (Этап 11)

`[technical decision — 10.09.2026]`, не owner decision: гранты пришли вместе с модулем (`f91f3d6`) без записи в журнале решений.

| Permission | owner | director | rop | manager | administrator | marketer | developer |
|---|---|---|---|---|---|---|---|
| `community_thread.read` | org | org | org | org | org | org | org |
| `community_thread.create` | org | org | org | own | org | own | org |
| `community_thread.manage` | org | org | org | — | org | — | org |
| `community_reply.create` | org | org | org | own | org | own | org |
| `community_reply.manage` | org | org | org | — | org | — | org |
| `community_exchange.read` | org | org | org | org | org | org | org |
| `community_exchange.create` | org | org | org | own | org | — | org |
| `community_event.read` | org | org | org | org | org | org | org |
| `community_event.attend` | org | org | org | own | org | own | org |

Scope здесь на поведение не влияет: контроллер community проверяет только наличие гранта, а темы, ответы и биржа видны всем организациям по замыслу модуля. `manage` с 10.09.2026 действует только на контент своей организации (`c01688e`); до этого удаление чужих тем было открыто всем, у кого есть `manage`. Модерации всей площадки нет — это admin-контур, раздел 2. Кто видит биржу и нужна ли верификация участников (master plan §2.3) — решение владельца, см. [operations/community-forum-exchange.md](../operations/community-forum-exchange.md).

---

### 1.9. Личные заметки менеджера (CRM notes)

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `note.read.own` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `note.create.own` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `note.update.own` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `note.delete.own` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`developer` — тот же набор (`own`), как и у остальных шести ролей.

**14.09.2026, техническое решение, не owner decision.** Личный блокнот
(легаси-блок «Заметки» в ERP — раньше писал в старый сервер чужого продукта,
которого у нас нет) — единственный ресурс в этой матрице, где `own` выдан
абсолютно всем ролям без исключения, включая `owner`/`director`: заметка не
организационный CRM-ресурс вроде Lead/Task/Deal, а личный инструмент
конкретного человека, поэтому `organization`/`team`-scope здесь не имеет
смысла в принципе — владелец организации так же не видит чужую заметку, как
не видит чужой пароль. См. [operations/crm-notes.md](../operations/crm-notes.md).

### 1.10. Библиотека материалов CRM (CRM library)

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `library_item.read.organization` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `library_item.create.organization` | ✓ | ✓ | ✓ | — | — | — |
| `library_item.create.own` | — | — | — | ✓ | — | — |
| `library_item.delete.organization` | ✓ | ✓ | ✓ | — | — | — |
| `library_item.delete.own` | — | — | — | ✓ | — | — |

`developer` — как `owner`/`director`/`rop` (scope `organization`).

**15.09.2026, техническое решение, не owner decision.** Библиотека состоит из
двух разделов (легаси-блок «Библиотека» и файлы чек-листа стадии лида):

- **Общие материалы организации** по продукту воронки — видят все
  сотрудники; добавлять и удалять может только scope `organization`
  (`create`/`delete`). Scope `own` на общие материалы не действует.
- **Личная библиотека** с папками — видна и меняется только своим
  владельцем при любом scope, как личная заметка (§1.9); owner организации
  чужую личную библиотеку не видит.

`administrator` и `marketer` получают только чтение: у них нет
`media_asset.upload`, загрузить файл им нечем. Расширять загрузку ради
библиотеки не стали — это решение владельца продукта. См.
[operations/crm-library.md](../operations/crm-library.md).

### 1.11. Планы сотрудников (plans)

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `plan.read.organization` | ✓ | ✓ | ✓ | — | — | — |
| `plan.read.own` | — | — | — | ✓ | ✓ | ✓ |
| `plan.update.organization` | ✓ | ✓ | ✓ | — | — | — |
| `plan.update.own` | — | — | — | ✓ | ✓ | ✓ |

`developer` — как `owner`/`director`/`rop` (scope `organization`).

**15.09.2026, owner decision.** Месячный план ставит руководитель любой
позиции своей организации или сотрудник сам себе. Правка плана пишется в
журнал (`plan.update`), потому что влияет на оценку сотрудника (§4). См.
[operations/plans.md](../operations/plans.md).

### 1.12. Лента новостей (news)

| Permission | owner | director | rop | manager | administrator | marketer |
|---|---|---|---|---|---|---|
| `news.read.organization` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `news.create.organization` | ✓ | ✓ | — | — | — | — |
| `news.update.organization` | ✓ | ✓ | — | — | — | — |
| `news.delete.organization` | ✓ | ✓ | — | — | — | — |

`developer` — как `owner`/`director` (scope `organization`).

**15.09.2026, техническое решение по схеме, предложенной владельцу.** Лента
сотрудника — новости платформы BAZA и новости своей компании. Новость
компании публикует, правит и удаляет руководитель (`news.create`/
`news.update`/`news.delete`), видят все сотрудники этой организации.
Новость платформы ведёт админка (грант администратора `news.publish`, §2.2);
из ERP её не изменить и не удалить. Публикация, правка и удаление пишутся в
журнал (`news.publish`/`news.update`/`news.delete`). Рассылку на почту и в
Telegram выбирает публикующий; свои настройки уведомлений
(`/me/notifications`) меняет только сам сотрудник, отдельного права не
нужно. См. [operations/news.md](../operations/news.md).

## 2. Системные admin actors

*(ADR-009)*

### 2.1. super_admin

Полный доступ ко всей системе без ограничений scope — не перечисляется построчно (единственный actor с implicit `*.* .global`), enforced на уровне отдельной проверки `adminAccount.role == 'super_admin'` в authorization-слое, не через `PermissionGrant`-записи (иначе потребовалось бы явно перечислять сотни строк, что не масштабируется и не нужно — super_admin по определению).

### 2.2. admin с индивидуальными grants

Формируется исключительно через `PermissionGrant` с `subjectType: 'admin_account'` — не hardcoded роль. Примеры типовых композиций (не enum-значения, просто иллюстрация, как выглядит реальный набор grants на практике):

| Пример композиции | Grants |
|---|---|
| «Модератор вторички Батуми» (замещает legacy `mls_admin`-подобную демо-роль без hardcode) | `listing.moderate.city(batumi)`, `duplicate_candidate.resolve.city(batumi)`, `complaint.resolve.city(batumi)` |
| «Админ новостроек» (замещает legacy `developers_admin`) | `development.moderate.domain(newbuilds)`, `unit.price.override.domain(newbuilds)` (только для критичных корректировок, не рутинного редактирования — то остаётся у ERP-ролей организации) |
| «Модератор отзывов» | `review.moderate.global`, `review.rating_adjust.global` |
| «Редактор новостей платформы» | `news.publish.global` — список, публикация и удаление новостей платформы (`/admin/news`) |

**`[owner decision — xlsx #134]`**: «да суперадмином» (индивидуальная настройка) — только super_admin создаёт/меняет grants (ADR-009 self-escalation prevention, уже enforced на уровне архитектуры, не только этой матрицы).

---

## 3. Обязательные scopes и их конкретный смысл в этой системе

| Scope | Используется где | Смысл |
|---|---|---|
| `own` | lead, contact, booking (manager-уровень) | только записи, где текущая Position — явный владелец/ответственный |
| `position` | personal_access grants | относится к конкретной Position, не ко всей команде |
| `team` | lead.reassign (rop) | подчинённые Position текущей Position (через `parentPositionId`) |
| `organization` | большинство ERP grants | вся текущая организация (TenantContext.organizationId) |
| `project` | unit.price/status.update | конкретный Development (не вся организация — застройщик с несколькими ЖК может ограничить право конкретным проектом, деталь для будущей гранулярности, не обязательна на MVP) |
| `city` | admin grants (модерация) | конкретный город (`scopeValue: 'batumi' | 'tbilisi'`) |
| `global` | super_admin-подобные admin grants, owner-only finance | вся платформа/вся организация без сужения |
| `assigned` | *(зарезервирован, явного use case в MVP-объёме не найдено — не используется ни одной строкой этой матрицы; scope существует в перечне master plan разд.5.4, оставлен как валидный тип на будущее, не удалён из enum)* | — |
| `domain` | admin grants (newbuilds/secondary/mls) | предметная область, не географическая (замещает legacy hardcoded domain-роли, ADR-009) |

---

## 4. Critical actions — обязательный reason + audit

*(master plan разд.5.4/7.2, traceability matrix QA-002)*

| Critical action | Кто может (permission) | Обязательные условия |
|---|---|---|
| **Price update** (единичное) | `unit.price.update.project` | audit before/after, без обязательного reason (рутинная операция) |
| **Bulk price update** | `unit.price.update.project` + explicit bulk-подтверждение | audit с полным списком затронутых unit'ов, count-подтверждение перед применением (preview, master plan разд.5.4 «массовые операции с предварительным просмотром») |
| **Booking cancel/extend** | `booking.cancel.organization` / `booking.extend.organization` | audit before/after |
| **Lead reassignment** | `lead.assign.organization` / `lead.reassign.team` | audit (actor, from-position, to-position) |
| **Listing unpublish** (владелец/риэлтор) | владелец listing или иерархия (owner/director/rop) | audit, reason опционален (не Admin-действие) |
| **Listing unpublish** (Admin) | Admin grant `listing.unpublish.city/domain/global` | **обязательный reason**, audit (ADR-005 unpublish, master plan D-06) |
| **Rating adjustment** (Admin) | `review.rating_adjust.*` | **обязательный reason** (`[owner decision — xlsx #142]`: «Для админов» — только Admin, не сама организация может корректировать чужой рейтинг) |
| **Manual ledger change** | Admin grant `manual_ledger.write.*` | **обязательный reason**, append-only (никогда update, только новая компенсирующая запись, domain-model.md). Для активации тарифа проверяется с 10.09.2026 (`9925a5b`); до этого хватало входа администратора |
| **Manual ledger read** (Admin billing overview) | Admin grant `manual_ledger.read.*` | обзор тарифа/подписки/журнала организации в админке — финансовые данные, не тривиальное чтение. Проверяется с 11.09.2026; до этого хватало входа администратора (тот же класс дыры, что была у change до 10.09.2026) |
| **Impersonation** | super_admin или explicit Admin grant `impersonation.start.*` | обязательная причина, короткий TTL, заметная UI-плашка, запрет ряда критических действий во время impersonation-сессии, полный audit (master plan разд.5.4) |
| **Export** (bulk data) | `export.organization` (ERP) / соответствующий Admin grant | audit с указанием объёма/типа экспортируемых данных |
| **Import** (bulk lead create) | `import.organization` + `lead.create.organization` | один audit-batch на весь файл (actor, filename, total/created/failed), не построчно — тот же принцип "каждый клик не надо" |

**Общий принцип для audit-требований** (`[owner decision — xlsx #139]`): «Важные типо блокировок и редактур. Каждый клик не надо» — audit-событие пишется на перечисленные выше critical actions и на изменения статуса/прав/блокировок, **не** на каждое чтение или тривиальное UI-действие (навигация, открытие карточки для просмотра).

---

## 5. Не рассмотрено в этом первом проходе (явно, не молча)

- Гранулярная детализация Admin-grants для полного покрытия всех 25 разделов Admin (admin-functional-map.md) — этот документ покрывает разделы, прямо упомянутые в xlsx-ответах и critical actions traceability matrix; полная построчная admin permission matrix по каждому из 25 разделов — отдельная более мелкая задача, не блокирующая переход к API conventions (B-05), может быть дополнена по мере проектирования конкретных Admin-экранов в Этапе 8.
- `project`-scope (ограничение права конкретным Development застройщика, не всей организацией) — введён в перечне scopes как валидный тип, но ни одна строка ERP-матрицы выше явно им не пользуется на MVP-уровне (все project-relevant права даны на уровне `organization`) — оставлено для будущей гранулярности, если застройщик с несколькими ЖК запросит разделение прав по конкретным проектам.
