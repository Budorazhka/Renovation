import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Каждый HTTP-маршрут обязан быть покрыт проверкой прав — либо
 * `@RequirePermission`, либо класс-guard'ом своего контура (`AdminGuard`,
 * `MarketplaceAccountGuard`), либо осознанно внесён в список публичных ниже.
 *
 * ЗАЧЕМ. Такой баг в проекте уже был: `GET /team-users` какое-то время
 * работал вообще без permission-guard (закрыто 31.08.2026, коммит
 * «fix(security): закрыть отсутствие permission-guard на GET /team-users»).
 * Ни typecheck, ни тесты этого не видели: эндпоинт исправно отвечал — просто
 * всем подряд.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ permission-grants. Тот страж сверяет выданные гранты с
 * проверяемыми правами, то есть работает со множеством уже объявленных прав.
 * Эндпоинт, у которого проверки прав нет ВООБЩЕ, не попадает ни в одну из
 * двух его сторон и остаётся невидимым. Ровно эта же слепота была найдена на
 * ревью в idempotency-coverage: перечень нельзя собирать по тому самому
 * признаку, наличие которого проверяешь. Здесь источник независим — все
 * маршруты всех контроллеров.
 *
 * Проверено 01.09.2026: непокрытых маршрутов, кроме перечисленных ниже, нет.
 */

const SRC_ROOT = join(__dirname, '../../src');

/** Guard'ы, покрывающие весь контроллер: свой слой авторизации (ADR-009). */
const CLASS_LEVEL_GUARDS = ['AdminGuard', 'MarketplaceAccountGuard'];

/** Маршрут → почему проверка прав здесь не нужна. */
const INTENTIONALLY_UNAUTHORIZED: Record<string, string> = {
  'GET /health': 'проба живости для оркестратора, данных не отдаёт',
  'GET /health/ready': 'проба готовности для оркестратора',

  'POST /auth/login': 'вход: прав ещё нет по определению, защищён rate-limit',
  'POST /auth/logout': 'выход: работает со своей же сессией',
  'POST /auth/change-password': 'смена своего пароля: identity берётся из своей же сессии, дополнительно требуется текущий пароль; защищено rate-limit по IP',
  'POST /auth/verify-password': 'проверка своего пароля: identity берётся из своей же сессии, ничего не меняет; защищено rate-limit по IP',
  'GET /auth/sessions': 'список своих активных сессий: identity берётся из своей же сессии, отдельного permission-гранта не нужно; защищено rate-limit по IP',
  'POST /auth/sessions/:sessionId/revoke': 'отзыв своей сессии по id: identity берётся из своей же сессии, отзыв дополнительно скопирован фильтром {_id, identityId} в репозитории; защищено rate-limit по IP',
  'POST /auth/register': 'регистрация identity: прав ещё нет, защищена rate-limit',
  'GET /auth/session': 'read-only проверка своей сессии, чужих данных не раскрывает',

  'POST /organizations/register': 'онбординг организации — выполняется ДО того, как у человека появится позиция и права; защищён IpRateLimitGuard',
  'POST /team-users/invite/:token/activate': 'активация приглашения: предъявляемый одноразовый токен и есть аутентификация',
  'POST /team-users/ensure-self': 'работает строго со своей позицией из TenantContext (organizationId + positionId сервера), чужого вернуть не может; класс под TenantGuard',
  'GET /me': 'профиль вошедшего о себе же; под TenantGuard, чужого не отдаёт',
  'GET /me/notifications': 'свои настройки уведомлений: identity только из TenantContext, чужих не отдаёт; под TenantGuard',
  'PUT /me/notifications': 'меняет только свои настройки уведомлений (identity из TenantContext); под TenantGuard',
  'POST /me/notifications/telegram-link': 'ссылка привязки своего Telegram к боту уведомлений: код выдаётся на identity из TenantContext',
  'DELETE /me/notifications/telegram': 'отвязывает свой Telegram (identity из TenantContext), чужую привязку снять нельзя',
  'GET /referral-network/me': 'своя команда или свой куратор в реферальной сети: identity только из TenantContext, чужую сеть не отдаёт; под TenantGuard',
  'GET /public/referral-invites/:code':
    'страница ссылки-приглашения куратора до регистрации — посетитель по определению без аккаунта; отдаётся только имя куратора, перебор кодов ограничен IpRateLimitGuard',

  'GET /public/developments': 'публичный каталог — это его назначение',
  'GET /public/developments/:slug': 'публичная карточка ЖК',
  'GET /public/listings': 'публичный каталог листингов',
  'GET /public/listings/:slug': 'публичная карточка листинга',
  'POST /public/developments/:slug/reveal-contact': 'публичное раскрытие контакта: анонимный посетитель по определению; защищено rate-limit и своей идемпотентностью',
  'POST /public/listings/:slug/reveal-contact': 'то же для листинга: анонимное раскрытие контакта, rate-limit и собственная запись идемпотентности',
  'POST /public/listings/:slug/complaints': 'ADMIN-OPS-001: подача жалобы анонимным посетителем по определению (жалоба сама по себе не даёт прав ни над чем); защищено IpRateLimitGuard',
  'GET /public/requests': 'N-13: публичная доска запросов; отдаёт только published-проекцию без identityId',
  'GET /public/realtors/:positionId/reviews': 'N-13: публичный список только одобренных отзывов, без reviewer identity и внутренних полей',

  'GET /leads/stage-definitions': 'справочник стадий воронки по продуктам — статичные метаданные, не данные лидов; под TenantGuard, требует только валидную tenant-сессию, без специального права',

  'GET /public/selections/:token': 'публичный просмотр подборки клиентом по ссылке — анонимный посетитель по определению (нет аутентификации, единственный ключ доступа это сам publicToken, 256 бит энтропии), whitelist-проекция (toPublicDevSelection) не содержит organizationId/внутренних ID',
  'GET /public/marketplace-selections/:token': 'N-11: публичный просмотр подборки покупателя по ссылке — тот же принцип, что GET /public/selections/:token выше; проекция (toPublicView) не содержит identityId/внутреннего id',
  'GET /public/requests/:id/reveal-phone': 'N-13 (owner decision 14.09.2026): раскрытие телефона автора запроса по клику, тот же принцип, что POST /public/listings/:slug/reveal-contact — анонимный посетитель по определению; защищено IpRateLimitGuard, не проверкой прав',
  'GET /public/realtors': 'N-13 (owner decision 14.09.2026): публичный каталог риэлторов — анонимный посетитель по определению, тот же принцип, что GET /public/developments',
  'GET /public/realtors/:positionId': 'N-13: публичный профиль риэлтора — та же публичность, что список выше',
  'GET /public/realtors/:positionId/reveal-phone': 'N-13: раскрытие телефона риэлтора по клику, тот же принцип, что GET /public/requests/:id/reveal-phone — защищено rate-limit по IP, не проверкой прав',

  'GET /billing/subscription': 'данные о текущей подписке и лимитах своей же организации; под TenantGuard, чужого не отдаёт',
  'GET /billing/plans': 'каталог доступных тарифных планов платформы; под TenantGuard',

  'POST /public/messenger/telegram/:accountId': 'N-12: вызывающий — серверы Telegram, не наш аутентифицированный клиент; подлинность подтверждает секрет вебхука (сверяется внутри MessengerService.handleTelegramUpdate), не проверка прав; защищено рейт-лимитом по IP',
};

function listControllers(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...listControllers(fullPath));
    else if (entry.endsWith('.controller.ts')) files.push(fullPath);
  }
  return files;
}

/** Все маршруты и признак того, покрыт ли маршрут проверкой прав. */
function collectRoutes(): { key: string; authorized: boolean }[] {
  const routes = new Map<string, boolean>();

  for (const file of listControllers(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);
    const base = source.match(/@Controller\(\s*'([^']*)'\s*\)/)?.[1] ?? '';

    // Заголовок класса — всё до первого маршрута; класс-guard действует на все.
    const firstRoute = lines.findIndex((l) => /@(Get|Post|Patch|Put|Delete)\(/.test(l));
    const header = lines.slice(0, firstRoute < 0 ? lines.length : firstRoute).join('\n');
    const classGuarded = CLASS_LEVEL_GUARDS.some((g) => header.includes(g));

    lines.forEach((line, index) => {
      const match = line.match(/@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/);
      if (!match) return;

      const path = '/' + [base, match[2] ?? ''].filter(Boolean).join('/');
      const key = `${match[1]!.toUpperCase()} ${path}`;

      // Берём ТОЛЬКО непрерывный блок декораторов этого маршрута: вверх и
      // вниз, пока строки начинаются с `@`. Окно фиксированной ширины здесь
      // не годится — оно захватывает декораторы соседнего метода, и тогда
      // незащищённый маршрут «наследует» чужой @RequirePermission. Проверено
      // диверсией: с окном в 6 строк назад страж пропускал добавленный
      // GET /deals/sabotage-open без единой проверки прав.
      const isDecorator = (l?: string) => !!l && /^\s*@/.test(l);
      let from = index;
      while (from > 0 && isDecorator(lines[from - 1])) from -= 1;
      let to = index;
      while (to + 1 < lines.length && isDecorator(lines[to + 1])) to += 1;
      const decorators = lines.slice(from, to + 1).join('\n');

      const authorized =
        classGuarded ||
        /@RequirePermission/.test(decorators) ||
        CLASS_LEVEL_GUARDS.some((g) => decorators.includes(g));

      if (!routes.has(key) || !routes.get(key)) routes.set(key, authorized);
    });
  }

  return [...routes].map(([key, authorized]) => ({ key, authorized })).sort((a, b) => a.key.localeCompare(b.key));
}

describe('Покрытие маршрутов проверкой прав', () => {
  const routes = collectRoutes();
  const allowedPublic = new Set(Object.keys(INTENTIONALLY_UNAUTHORIZED));

  it('разбор контроллеров что-то нашёл — защита от молчаливо сломанного парсера', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('нет маршрутов без проверки прав вне явного списка публичных', () => {
    const unprotected = routes
      .filter((r) => !r.authorized && !allowedPublic.has(r.key))
      .map((r) => r.key);

    expect(unprotected).toEqual([]);
  });

  it('маршруты из списка публичных действительно не требуют прав', () => {
    const listedButProtected = routes
      .filter((r) => r.authorized && allowedPublic.has(r.key))
      .map((r) => r.key);

    expect(listedButProtected).toEqual([]);
  });

  it('у каждой записи списка есть причина и корректный формат маршрута', () => {
    for (const [endpoint, reason] of Object.entries(INTENTIONALLY_UNAUTHORIZED)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(endpoint).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \//);
    }
  });

  /**
   * Проверки на протухание списка здесь намеренно НЕТ: устаревшая запись
   * ничего не разрешает в runtime (она лишь освобождает от требования,
   * которого больше не к чему предъявлять), а одна из записей — `GET /me` —
   * покрывает эндпоинт, который сейчас дописывается в параллельной сессии и
   * ещё не закоммичен. Требование «список не протух» ломало бы сборку в
   * зависимости от того, чей рабочий каталог сканируется.
   */
});
