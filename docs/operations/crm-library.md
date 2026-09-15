# Библиотека материалов CRM (CRM library)

Дата: 15.09.2026. Статус: сделано.

## Что это

В классическом виде CRM есть легаси-блок «Библиотека» и вкладка файлов в
чек-листе стадии лида. Оба писали в чужой сервер (`/crm/files/base`,
`/crm/files/library`), которого у нас нет. Библиотека заведена у нас
отдельным модулем `apps/api/src/modules/library`.

Два раздела:

- **Общие материалы организации** (легаси «Общие файлы»): презентации,
  регламенты, КП по продукту воронки (`sales`/`network`/`owner`/`agent`)
  или для всех продуктов сразу. Видят все сотрудники.
- **Личная библиотека** (легаси «Моя библиотека»): файлы сотрудника с
  папками. Видит и меняет только владелец.

## Контракт (кратко)

Глобальный префикс `/api/v1`, cookie-сессия, `TenantGuard` + `PermissionGuard`.

- `GET /library/items?scope=organization&productType=` — общие материалы;
  с `productType` — материалы продукта плюс материалы для всех продуктов.
- `GET /library/items?scope=personal&folderId=` — личные материалы в папке
  (без `folderId` — корень).
- `POST /library/items` — добавить материал, требует `Idempotency-Key`.
- `DELETE /library/items/:itemId` — удалить материал (MediaAsset остаётся).
- `GET /library/items/:itemId/download` — presigned URL файла.
- `GET /library/folders?parentId=`, `POST /library/folders`
  (`Idempotency-Key`), `DELETE /library/folders/:folderId` — папки личной
  библиотеки; непустая папка — `409 LIBRARY_FOLDER_NOT_EMPTY`.

Ответ списка — `{items, canUpload}`: `canUpload` говорит фронту, показывать
ли загрузку в этом разделе. Выдача не постраничная, потолок 500 записей —
библиотека это десятки файлов.

Полная спецификация — `docs/api/v1-first-vertical-slice.yaml`, раздел
`/library`.

## Загрузка файла

Как у заметок и задач: `POST /media/upload-intent` с purpose `library_file`
(приватный бакет), загрузка по presigned URL, `POST /media/:assetId/confirm`,
затем `POST /library/items` со ссылкой на asset и именем файла. Сервер
берёт MIME и размер из проверенного asset, а не из запроса.

Ограничения медиа-модуля действуют и здесь: JPEG/PNG/WebP/PDF до 20 МБ
(`media.constants.ts`). Легаси принимал любые файлы до 100 МБ; Word, Excel
и видео в библиотеку сейчас не загрузить. Расширение allowlist —
отдельное решение по безопасности (ADR-008), в этот проход не входило.

## Прикрепление к лиду

Отдельной операции «attach-library» нет: материал прикрепляется к лиду
тем же `POST /leads/:leadId/files`, что и обычный файл, с `assetId`
материала и его `fileName`.

Заодно исправлены два старых пробела файлов лида:

- имя файла теперь хранится (`LeadDocument.attachedFileNames`), раньше
  каждый файл показывался как `original.pdf`;
- `GET /leads/:leadId/files/:assetId/download` отдаёт presigned URL.
  Раньше у PDF и файлов приватного бакета ссылки не было вовсе.

## Изоляция и права

Все запросы фильтруются по `organizationId`; личные материалы и папки — ещё
и по `ownerPositionId` (tenant-scope.test.ts). Чужой личный материал —
`404`, не `403`.

`library_item.read` scope `organization` у всех ролей;
`create`/`delete` scope `organization` у owner/director/rop/developer
(общие материалы), scope `own` у manager (только личная библиотека).
administrator и marketer — только чтение: у них нет `media_asset.upload`.
См. `docs/security/permission-matrix.md` разд.1.10.

**После выкладки нужно запустить**
`pnpm --filter @baza/api run grants:backfill-defaults` (сначала
`-- --dry-run`) для организаций, созданных до неё, иначе их позиции
получат `403` на все `/library`-эндпоинты. См.
[default-grants-backfill.md](default-grants-backfill.md).

## Почему без аудита

Тот же прецедент, что личные заметки: материалы не влияют на отчётность и
доступы других пользователей (`permission-matrix.md` §4).

## Известное ограничение

Удаление папки проверяет пустоту и удаляет папку двумя запросами без
блокировки. Если в ту же секунду в папку загрузят файл, он останется без
папки и не будет виден в интерфейсе. Для десятков файлов на человека риск
принят.

## Проверено

- Unit: `library.service.spec.ts`, `library.controller.spec.ts`,
  `library-item.repository.spec.ts`, тесты файлов лида в
  `crm.service.spec.ts`.
- Integration: `test/integration/library.integration-spec.ts`
  (MongoMemoryReplSet).
- Архитектурные стражи: `tenant-scope`, `authorization-coverage`,
  `idempotency-coverage`, `permission-grants`, `openapi-route-coverage`,
  `module-boundaries`.
