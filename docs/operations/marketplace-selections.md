# Подборки покупателя живут на сервере (N-11)

Работа очереди, открытой решениями владельца 11.09.2026
([roadmap](../roadmap-2026-09.md)). Дата: 13.09.2026.

## Решение владельца

Подборки покупателя на витрине — на сервере, у аккаунта покупателя (не у
организации, вопрос закрыт 07.09.2026 в общем списке решений).

## Что было

`SelectionsPage.tsx` хранила подборки в `localStorage`
(`baza:marketplace:selections`). Кнопки «Ссылка для клиента» и «Витрина»
вели на `/selections/:slug` с выдуманным на клиенте slug'ом — тот же
маршрут, что читает CRM-подборки агента (`apps/api/src/modules/selections`,
organization-scoped) по настоящему `publicToken`. Backend для подборок
покупателя не существовал вовсе (зафиксировано в
[p1-06-selections-and-demo-sections.md](p1-06-selections-and-demo-sections.md)
10.09.2026), поэтому обе ссылки были мёртвыми, а список не переживал смену
браузера или устройства. Кнопка «Создать подборку из избранного» на
`FavoritesPage.tsx` тоже была декорацией: показывала «✓ Подборка создана!»
на 3 секунды и не делала ничего.

## Что сделано

### Backend: `apps/api/src/modules/marketplace-selections`

Новый модуль, отдельный от `selections` (CRM-подборки агента) — тот же
module-boundary принцип, что `favorites` отдельно от `selections`:
подборка покупателя принадлежит `identityId`, не организации.

- `MarketplaceSelectionDocument` (`marketplace_selections`): `identityId`,
  `title`, `items: [{targetType, slug, addedAt}]`, `publicToken` (256 бит
  энтропии, не хешируется — тот же принцип и то же обоснование, что
  `DevSelectionDocument.publicToken`). Элемент — slug публикации, тот же
  принцип, что `FavoriteDocument`: подборка не хранит копию карточки,
  витрина дочитывает объект публичными эндпоинтами каталога.
- `MarketplaceSelectionsController` (`/marketplace/selections`, под
  `MarketplaceAccountGuard`): list/create/rename/delete/addItem/removeItem.
  Создание — единственная НЕ идемпотентная по построению операция (в
  отличие от `favorites/add` — каждый вызов заводит новую подборку),
  поэтому единственная из всех, что требует `Idempotency-Key`
  (ADR-006-флоу, тот же паттерн, что `CommunityService.createThread`).
  Остальные — идемпотентны по построению (rename тем же title, delete уже
  удалённого, addItem/removeItem — условный push/pull), как и `favorites`.
- `PublicMarketplaceSelectionsController` (`/public/marketplace-selections/
  :token`, без guard'а совсем) — «открывается по ссылке» из решения
  владельца. В отличие от `PublicSelectionsController` (агентские
  подборки) нет `markViewed`/`sent->viewed`: у подборки покупателя нет
  получателя-клиента, чей просмотр нужно отследить агенту — владелец
  делится ссылкой добровольно (с партнёром/семьёй).

### Frontend: `apps/marketplace-web`

- `SelectionsPage.tsx` переписана на `publishingApi.listSelections/
  createSelection/renameSelection/deleteSelection`, тот же load/
  requiresAuth паттерн, что `FavoritesPage.tsx`. Переименование сохраняется
  по `blur`, не на каждую букву — PATCH на каждый keystroke был бы лишней
  нагрузкой и источником гонки (последний ответ сервера не обязательно
  соответствует последнему введённому символу).
- Новый маршрут `/my-selection/:token` (`MySelectionDetailPage.tsx`) —
  ОТДЕЛЬНЫЙ от `/selections/:slug` (`SelectionDetailPage.tsx`, агентские
  CRM-подборки) во избежание коллизии, в которую страница покупателя упиралась
  раньше. Резолвит объекты публичным каталогом, тот же принцип, что
  `FavoritesPage`.
- Общий resolver `lib/resolveMarketplaceTarget.ts` — извлечён из
  `FavoritesPage.tsx` (была локальная `resolveFavorite`), переиспользуется
  `SelectionsPage`/`MySelectionDetailPage`: обе страницы хранят только
  `{targetType, slug}` и дочитывают карточку одним и тем же способом.
- `FavoritesPage.tsx`: кнопка «Создать подборку из избранного» теперь
  реально создаёт подборку через API и добавляет в неё все текущие
  избранные объекты (последовательно, не `Promise.all` — порядок объектов
  в подборке остаётся предсказуемым, как в самом избранном).

## Проверки

- [marketplace-selections.integration-spec.ts](../../apps/api/test/integration/marketplace-selections.integration-spec.ts)
  — 8 сценариев на настоящей MongoDB: создание с Idempotency-Key не
  дублирует; владелец/чужая учётка; двойное добавление одного объекта не
  дублирует его; снятие отсутствующего объекта не ошибка; чужая учётка не
  может переименовать/добавить/удалить (`NOT_FOUND`); публичная ссылка
  отдаёт проекцию без `identityId`; несуществующий токен — `NOT_FOUND`;
  удаление реально удаляет документ.
- `marketplace-selections.service.spec.ts` — юнит-покрытие тех же веток на
  моках (идемпотентный replay создания, идемпотентное повторное добавление
  элемента).
- `apps/marketplace-web/tests/favoritesAndSelections.test.tsx` — 17
  сценариев: управление подборками через сервер (не `localStorage`),
  честный пустой список, `requiresAuth`, ссылка «Витрина» ведёт на
  `/my-selection/:token`, публичная страница подборки резолвит объекты
  каталогом и переживает пропавший объект.

## Что осталось за скобками

- **Добавление объекта в подборку из карточки каталога.** UI-путь
  «добавить в подборку» есть только один — «Создать подборку из
  избранного» на `FavoritesPage`. Точечное добавление одного объекта в
  конкретную (в т.ч. уже существующую) подборку прямо с карточки каталога
  backend поддерживает (`POST .../items`), но UI для выбора «в какую
  подборку» не строился — самостоятельная фича, не часть этой работы.
- **Публичный бейдж/статус MLS** (мастер-план §2.3) подборок не касается,
  это отдельная линия работ (N-10).
