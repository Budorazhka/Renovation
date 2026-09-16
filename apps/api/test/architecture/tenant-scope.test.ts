import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-002: в tenant-коллекциях `organizationId` — ЧАСТЬ Mongo-фильтра, а не
 * проверка после выборки. Нарушение этого правила означает чтение или
 * запись через границу организаций, то есть худший класс бага в этом
 * проекте.
 *
 * Тест находит запросы репозиториев, в фильтре которых organizationId нет,
 * и сверяет их с явным списком исключений ниже. Каждое исключение проверено
 * вручную 01.09.2026 и снабжено причиной; НОВЫЙ запрос без organizationId
 * роняет тест, и автор обязан либо добавить фильтр, либо осознанно внести
 * запись сюда.
 *
 * Смысл не в том, чтобы запретить такие запросы — часть из них законна и
 * необходима, — а в том, чтобы каждый был решением, а не случайностью.
 *
 * Четвёртый страж такого рода после module-boundaries, permission-grants и
 * idempotency-coverage.
 */

const REPO_ROOT = join(__dirname, '../../../..');
const SCAN_ROOTS = [join(REPO_ROOT, 'apps/api/src'), join(REPO_ROOT, 'packages')];

/**
 * Коллекции, не привязанные к организации по своей природе: аккаунты
 * платформы, идентити, сессии, аудит (у него своё скоупирование),
 * гранты (по subjectId), outbox, записи идемпотентности, публикации
 * маркетплейса (публичный каталог, скоуп — publisherScope) и booking-lock
 * (ключ — unitId).
 */
const NON_TENANT_REPOSITORIES = [
  'admin-account',
  'audit-event',
  'permission-grant',
  'identity',
  'session',
  'product-access',
  'idempotency-record',
  'public-reveal-idempotency-record',
  'outbox-event',
  'marketplace-publication',
  'booking-lock',
  'subscription-plan',
  'community-section',
  'community-thread',
  'community-reply',
  'community-event',
  // Уведомления (@baza/notifications): адресат — человек (identity), не
  // организация. Настройки и Telegram-привязка одни на все организации
  // человека, доставка несёт identityId, организацию — сама новость.
  'notification-settings',
  'telegram-link-code',
  'notification-delivery',
  'telegram-bot-state',
];

/** `<файл>#<метод>` → почему запрос без organizationId здесь корректен. */
const ALLOWED_WITHOUT_ORGANIZATION_ID: Record<string, string> = {
  'invitation.repository.ts#findByTokenHash':
    'Поиск по самому токену: он и есть предъявляемый секрет, глобально уникален. ' +
    'Организация приглашения читается ИЗ найденной записи, а не задаётся вызывающим.',
  'position-assignment.repository.ts#findActiveByIdentity':
    'Поиск СВОЕГО назначения по identity — из него и строится TenantContext. ' +
    'Фильтровать по организации здесь нечем: она ещё не известна.',
  'position-profile.repository.ts#findByPositionId':
    'Профиль позиции; владение позицией проверено вызывающим (TeamService) до вызова.',
  'position-profile.repository.ts#findByPositionIds':
    'Batched-вариант того же: positionIds приходят из уже отфильтрованного по организации списка позиций ' +
    '(TeamService строит команду через listForOrganization), а не из запроса пользователя.',
  'position-assignment.repository.ts#findActiveByPosition':
    'Оба вызывающих (OrganizationsService.vacate, TeamService) непосредственно перед этим получают позицию ' +
    'через findByIdForOrganization/findAssignablePosition и падают 404, если она чужая.',
  'listing.repository.ts#findActiveListingsConfirmedBefore':
    'Фоновая задача протухания актуальности (ActualityService.expireOverdueListings, cron-точка входа): ' +
    'намеренно проходит по всем организациям, tenant-контекста у неё нет по определению.',
  'booking.repository.ts#findOverdueActive':
    'Фоновая задача истечения броней (BookingsService.expireOverdueBookings, cron-точка входа): ' +
    'намеренно проходит по всем организациям. Сам перевод в expired (expireIfOverdue) уже фильтрует ' +
    'по organizationId, взятому из найденной брони.',
  'position.repository.ts#setAvatarAsset':
    'Запись по positionId, владение проверено вызывающим до вызова.',
  'position.repository.ts#listNotClosedPage':
    'Доливка стартовых грантов ролей (DefaultGrantsBackfillService, CLI-команда grants-backfill): ' +
    'намеренно проходит по позициям всех организаций, tenant-контекста у неё нет по определению. ' +
    'Гранты пишутся по _id найденной позиции, в аудит уходит её organizationId.',
  'media-asset.repository.ts#findByIds':
    'Медиа скоупится не организацией, а ownerScope. Вызывающий MediaService.' +
    'getAssetsForOwnerScope отбрасывает чужие через ownerScopesEqual; воркер работает ' +
    'вне tenant-контекста по id из события.',
  'media-asset.repository.ts#appendVariant': 'Воркер дописывает вариант по id обрабатываемого события, вне tenant-контекста.',
  'media-asset.repository.ts#deletePermanently': 'Фоновая очистка media-cleanup по id, вне tenant-контекста.',
  'duplicate-candidate.repository.ts#upsertDetected':
    'Кандидат дубля по своей природе связывает активы ДВУХ организаций — одной organizationId у записи нет.',
  'duplicate-candidate.repository.ts#findByPair': 'То же: пара активов из разных организаций.',
  'duplicate-candidate.repository.ts#findById': 'Скоуп проверяется в DedupeService по владению обоими активами пары.',
  'duplicate-candidate.repository.ts#listForReview': 'Админская очередь модерации — намеренно поверх всех организаций.',
  'listing.repository.ts#findById':
    'Вызывается по id, взятому из уже разрешённой сущности (публикация, актив), либо воркером вне tenant-контекста.',
  'property-asset.repository.ts#findById':
    'То же: id приходит из уже проверенной сущности (listing.propertyAssetId, свой только что созданный актив) ' +
    'либо из воркера.',
  'property-asset.repository.ts#mutateMedia':
    'Докстринг метода фиксирует контракт: id уже проверен на владение вызывающим, ретраи перечитывают по _id, ' +
    'потому что владение не может смениться посреди операции. Проверено: все 10 мест вызова получают asset ' +
    'через getAsset(assetId, organizationId) либо getAsset(assetId, identityId).',
  'favorite.repository.ts#listForIdentity':
    'Избранное принадлежит человеку, а не организации: фильтр по identityId — это и есть его скоуп. ' +
    'organizationId здесь не существует как понятие (покупатель может вообще не состоять ни в какой ' +
    'организации), тот же принцип, что publisherScope.marketplace_account у объявлений владельцев-физлиц.',
  'favorite.repository.ts#remove':
    'То же: удаление всегда идёт по паре identityId + slug из сессии вызывающего, чужую запись этот фильтр ' +
    'достать не может.',
  'marketplace-selection.repository.ts#listForIdentity':
    'Подборка покупателя (N-11) принадлежит человеку, не организации — тот же принцип, что ' +
    'favorite.repository.ts#listForIdentity выше.',
  'marketplace-selection.repository.ts#findByIdForIdentity':
    'То же: фильтр {_id, identityId} из сессии вызывающего, чужую подборку так не достать.',
  'marketplace-selection.repository.ts#rename':
    'То же: findOneAndUpdate по {_id, identityId} — переименовать чужую подборку этот фильтр не позволяет.',
  'marketplace-selection.repository.ts#remove':
    'То же: удаление всегда идёт по паре {_id, identityId} из сессии вызывающего.',
  'marketplace-selection.repository.ts#findByPublicToken':
    'ПУБЛИЧНЫЙ путь — единственный ключ доступа это сам publicToken (256 бит энтропии), тот же принцип, ' +
    'что DevSelectionRepository.markViewedByPublicToken: у анонимного посетителя ссылки нет ни ' +
    'organizationId, ни identityId вообще.',
  'complaint.repository.ts#findById':
    'Скоуп проверяется вызывающим (ComplaintService/AdminComplaintService) — admin-резолюция сверяет ' +
    'complaint.scopeCity против грантов complaint.resolve.city(X), не organizationId ответчика.',
  'complaint.repository.ts#listForReview':
    'Админская очередь модерации жалоб — намеренно поверх всех организаций, сужается по scopeCity ' +
    '(города, куда у admin есть грант complaint.resolve.city), тот же принцип, что duplicate-candidate listForReview.',
  'listing-revision.repository.ts#listForAsset':
    'Скоупится propertyAssetId, не organizationId напрямую — PropertyAssetsService.listRevisions вызывает ' +
    'getAsset(assetId, organizationId) до этого запроса, тот же контракт, что mutateMedia выше.',
  'dev-selection.repository.ts#findByPublicToken':
    'Публичная сторона (PublicSelectionsController, без TenantGuard) — единственный ключ доступа это сам ' +
    'publicToken (256 бит случайности, SelectionsService.generatePublicToken), organizationId у анонимного ' +
    'посетителя ссылки физически нет. Тот же принцип, что invitation.repository.ts#findByTokenHash выше.',
  'unit.repository.ts#listByBuildingIds':
    'Worker-side вызов для сборки публичной проекции ЖК (PublicationRequestedHandler): ' +
    'buildingIds получены из уже загруженного Development, worker работает как system actor вне tenant-контекста.',
  'lms-item.repository.ts#seedSystemItemsIfEmpty':
    'Системный сид базовых материалов платформы (isSystem: true, organizationId: null) — выполняется при старте модуля.',
  'lms-course.repository.ts#seedSystemCoursesIfEmpty':
    'Системный сид базовых курсов платформы (isSystem: true, organizationId: null) — выполняется при старте модуля.',
  'messenger-message.repository.ts#findByExternalMessageId':
    'N-12: дедуп входящих Telegram-апдейтов при at-least-once доставке — ключ поиска {dialogId, ' +
    'externalMessageId}, dialogId уже найден/создан в той же транзакции по organizationId из аккаунта.',
  'buyer-request.repository.ts#listPublic':
    'N-13: публичная доска — запрос покупателя принадлежит его личному identityId (аккаунт покупателя ' +
    'маркетплейса), не организации; тот же принцип, что favorite.repository.ts#listForIdentity.',
  'buyer-request.repository.ts#listForAuthor':
    'N-13: список своих запросов покупателя — фильтр {authorIdentityId} из сессии вызывающего, тот же принцип, ' +
    'что marketplace-selection.repository.ts#listForIdentity.',
  'buyer-request.repository.ts#findByIdForAuthor':
    'N-13: фильтр {_id, authorIdentityId} из сессии вызывающего — чужой запрос так не достать.',
  'buyer-request.repository.ts#close':
    'N-13: CAS-закрытие фильтром {_id, authorIdentityId, status: published} — тот же принцип, что ' +
    'marketplace-selection.repository.ts#rename.',
  'realtor-review.repository.ts#listApproved':
    'N-13: публичный список одобренных отзывов о риэлторе — realtorPositionId, не организация автора отзыва ' +
    'или организация риэлтора; отзыв принадлежит связке покупатель-риэлтор-сделка, не тенанту.',
  'realtor-review.repository.ts#findDuplicate':
    'N-13: проверка уникальности по {reviewerIdentityId, completedDealId, realtorPositionId} — тот же тройной ' +
    'ключ, что уникальный индекс схемы; организации здесь нет как понятия для отзыва конкретного покупателя.',
  'realtor-review.repository.ts#listForReview':
    'N-13: admin-очередь модерации отзывов (review.moderate, global scope) — намеренно поверх всех организаций, ' +
    'тот же принцип, что DuplicateCandidateRepository.listForReview/complaint.repository.ts#listForReview.',
  'realtor-review.repository.ts#getApprovedStatsByPositionIds':
    'N-13: агрегат рейтинга для публичного каталога риэлторов — по positionIds пачкой, поверх всех организаций ' +
    'намеренно (тот же вызывающий код уже прошёл фильтр организации-типа через PositionRepository.listPublicRealtors).',
  'position.repository.ts#listPublicRealtors':
    'N-13 (owner decision 14.09.2026): публичный каталог риэлторов — намеренно поверх ВСЕХ организаций типа ' +
    'agency/independent_realtor, фильтр по типу организации через $lookup внутри самого метода, не по одной ' +
    'organizationId вызывающего — тот же принцип, что listPublicOrganizations.',
  'position.repository.ts#findByIdPublicRealtor':
    'N-13: то же самое для одной позиции — публичный профиль риэлтора не имеет tenant-контекста вызывающего.',
  'position-assignment.repository.ts#findActiveIdentityIds':
    'Получатели рассылки новости платформы (OrganizationsService.listAllActiveOccupantIdentityIds): намеренно ' +
    'все организации — новость платформы адресована сотрудникам всех компаний. Отдаёт только identityId.',
  'news-article.repository.ts#listPlatform':
    'Новости платформы (source: platform) ничьи: organizationId у них нет, их ведёт админка под грантом ' +
    'news.publish. Лента сотрудника (listFeed) фильтрует новости компаний по organizationId.',
  'news-article.repository.ts#deletePlatform':
    'То же: удаление новости платформы администратором, фильтр {_id, source: platform} — новость компании ' +
    'этим путём не удалить.',
  'news-article.repository.ts#findPlatform':
    'То же: чтение новости платформы администратором перед правкой, фильтр {_id, source: platform}.',
  'news-article.repository.ts#updatePlatform':
    'То же: CAS-правка новости платформы администратором, фильтр {_id, source: platform, version}.',
};

const QUERY = /this\.model\.(find|findOne|findOneAndUpdate|updateOne|updateMany|deleteOne|deleteMany|countDocuments|aggregate|distinct)\b/;
const METHOD_START = /^\s{2}(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\(/;

function listRepositories(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') files.push(...listRepositories(full));
      continue;
    }
    if (entry.endsWith('.repository.ts') && !entry.endsWith('.spec.ts')) files.push(full);
  }
  return files;
}

/** `<файл>#<метод>` для каждого запроса, в теле метода которого нет organizationId. */
function collectUnscopedQueries(): Set<string> {
  const found = new Set<string>();

  for (const root of SCAN_ROOTS) {
    for (const file of listRepositories(root)) {
      const fileName = file.split(/[\\/]/).pop()!;
      if (NON_TENANT_REPOSITORIES.includes(fileName.replace('.repository.ts', ''))) continue;

      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!QUERY.test(line)) return;

        let start = index;
        let method = '<unknown>';
        while (start > 0) {
          const m = lines[start]!.match(METHOD_START);
          if (m) {
            method = m[1]!;
            break;
          }
          start -= 1;
        }

        // Сигнатуру пропускаем НАМЕРЕННО: `organizationId` в списке
        // параметров ничего не доказывает. Самая вероятная форма этого бага
        // — параметр принимается, но в фильтр не попадает; поиск по всему
        // методу такую правку пропускал (проверено: удаление organizationId
        // из фильтра findByIdForOrganization тест не ловил).
        let bodyStart = start;
        while (bodyStart < index && !/\)\s*(?::[^{]*)?\{\s*$/.test(lines[bodyStart]!)) {
          bodyStart += 1;
        }

        // Вперёд смотрим лишь на несколько строк — ровно чтобы захватить
        // многострочный inline-фильтр вида `.findOne({\n _id,\n
        // organizationId,\n })` — и обрываемся на начале следующего метода.
        // Без этой границы окно залезало в соседний метод и находило там
        // чужой organizationId (проверено: так тест не ловил удаление
        // фильтра из findByIdForOrganization).
        let bodyEnd = index + 1;
        const maxLookahead = Math.min(index + 5, lines.length);
        while (bodyEnd < maxLookahead && !METHOD_START.test(lines[bodyEnd]!)) {
          bodyEnd += 1;
        }

        const body = lines.slice(bodyStart + 1, bodyEnd).join(' ');
        if (!/organizationId/.test(body)) {
          found.add(`${fileName}#${method}`);
        }
      });
    }
  }

  return found;
}

describe('ADR-002: organizationId в фильтре tenant-запросов', () => {
  const unscoped = collectUnscopedQueries();
  const allowed = new Set(Object.keys(ALLOWED_WITHOUT_ORGANIZATION_ID));

  it('нет НОВЫХ запросов без organizationId вне явного списка исключений', () => {
    const unexpected = [...unscoped].filter((key) => !allowed.has(key)).sort();

    expect(unexpected).toEqual([]);
  });

  it('список исключений не протух — каждая запись всё ещё соответствует коду', () => {
    const stale = [...allowed].filter((key) => !unscoped.has(key)).sort();

    expect(stale).toEqual([]);
  });

  it('у каждого исключения записана причина', () => {
    for (const reason of Object.values(ALLOWED_WITHOUT_ORGANIZATION_ID)) {
      expect(reason.length).toBeGreaterThan(30);
    }
  });

  it('сверка что-то нашла — защита от молчаливо сломанного разбора', () => {
    expect(unscoped.size).toBeGreaterThan(0);
  });
});
