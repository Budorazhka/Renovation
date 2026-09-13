import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  CreditCard,
  Landmark,
  Building2,
  Building,
  MessageCircle,
  GraduationCap,
  Wallet,
  MessagesSquare,
  Factory,
  BarChart3,
  ClipboardList,
} from 'lucide-react'
import type { UserRole } from '@/types/auth'
import type { PermissionMap } from '@/data/personnel-permissions'
import {
  isPathBlockedByModulePermissions,
  railSectionVisibleForPermissions,
  resolveModulePermissions,
} from '@/lib/module-permissions'

export type DashboardRailItem = {
  id: string
  label: string
  to: string
  icon: LucideIcon
  end?: true
  match?: (p: string) => boolean
}

/**
 * Полный список пунктов левого rail по финальному ТЗ.
 * Видимость по ролям — {@link getVisibleDashboardRailItems}.
 */
export const DASHBOARD_RAIL_ITEMS: DashboardRailItem[] = [
  { id: 'desk', label: 'Рабочий стол', to: '/dashboard', icon: LayoutDashboard, end: true },
  {
    id: 'development',
    label: 'Девелопмент',
    to: '/dashboard/development',
    icon: Factory,
    match: (p) => p.startsWith('/dashboard/development'),
  },
  {
    id: 'crm',
    label: 'CRM',
    to: '/dashboard/crm',
    icon: CreditCard,
    match: (p) =>
      p.startsWith('/dashboard/crm') ||
      p.startsWith('/dashboard/leads/poker') ||
      p.startsWith('/dashboard/leads/inbox') ||
      p.startsWith('/dashboard/clients') ||
      p.startsWith('/dashboard/deals') ||
      p.startsWith('/dashboard/tasks'),
  },
  {
    id: 'newbuild',
    label: 'Новостройки',
    to: '/dashboard/new-buildings',
    icon: Landmark,
    match: (p) => p.startsWith('/dashboard/new-buildings') || p.startsWith('/dashboard/bookings'),
  },
  {
    id: 'secondary',
    label: 'Объекты вторичного рынка',
    to: '/dashboard/objects',
    icon: Building2,
    match: (p) => p.startsWith('/dashboard/objects'),
  },
  {
    id: 'chats',
    label: 'Чаты',
    to: '/dashboard/chats',
    icon: MessageCircle,
    match: (p) => p.startsWith('/dashboard/chats'),
  },
  {
    id: 'team',
    label: 'Команда',
    to: '/dashboard/team',
    icon: Building,
    match: (p) => p.startsWith('/dashboard/team'),
  },
  {
    id: 'learning',
    label: 'Обучение и база знаний',
    to: '/dashboard/lms/browse',
    icon: GraduationCap,
    match: (p) => p.startsWith('/dashboard/learning') || p.startsWith('/dashboard/lms'),
  },
  { id: 'finance', label: 'Финансы', to: '/dashboard/finance', icon: Wallet, match: (p) => p.startsWith('/dashboard/finance') },
  {
    id: 'analytics',
    label: 'Аналитика',
    to: '/dashboard/crm/analytics',
    icon: BarChart3,
    match: (p) =>
      p.startsWith('/dashboard/crm/analytics') ||
      p.startsWith('/dashboard/analytics') ||
      p.startsWith('/dashboard/reports/') ||
      p.startsWith('/dashboard/leads/report') ||
      p.startsWith('/dashboard/deals/report') ||
      p.startsWith('/dashboard/objects/report') ||
      p.startsWith('/dashboard/finance/report') ||
      p.startsWith('/dashboard/community/report') ||
      p.startsWith('/dashboard/new-buildings/report'),
  },
  {
    id: 'community',
    label: 'Сообщество',
    to: '/dashboard/community',
    icon: MessagesSquare,
    /** Хаб и все экраны под `/dashboard/partners/*` (в т.ч. MLM и каталог). */
    match: (p) =>
      p.startsWith('/dashboard/community') || p.startsWith('/dashboard/partners'),
  },
  {
    id: 'buyer-requests',
    label: 'Запросы покупателей',
    to: '/dashboard/buyer-requests',
    icon: ClipboardList,
    match: (p) => p.startsWith('/dashboard/buyer-requests'),
  },
]

/**
 * Скрыть пункты rail для роли (id из {@link DASHBOARD_RAIL_ITEMS}).
 * Пусто = видит весь список.
 */
const HIDE_RAIL_IDS_FOR_ROLE: Partial<Record<UserRole, string[]>> = {
  /** Команда —, Обучение —, Финансы —, Запросы покупателей — (нет buyer_request.respond, permission-matrix.md разд.1.1) */
  marketer: ['team', 'learning', 'finance', 'buyer-requests'],
  /** Операционный администратор: без стратегических контуров. */
  administrator: ['learning', 'finance', 'community', 'chats'],
  /** Стажёр: только базовый операционный контур. */
  trainee: ['newbuild', 'chats', 'team', 'learning', 'finance', 'community', 'analytics', 'buyer-requests'],
  /** Лиды —, Команда —, Обучение —, Финансы —, Сообщество — */
  lawyer: ['leads', 'team', 'learning', 'finance', 'community', 'buyer-requests'],
  /** Legacy роль: не должна использоваться в активном контуре финального ТЗ. */
  hr: ['crm', 'leads', 'newbuild', 'secondary', 'chats', 'team', 'learning', 'finance', 'community', 'analytics', 'buyer-requests'],
  /** Legacy роль: не должна использоваться в активном контуре финального ТЗ. */
  partner: ['crm', 'leads', 'newbuild', 'secondary', 'chats', 'team', 'learning', 'finance', 'community', 'analytics', 'buyer-requests'],
  /** Лиды —, Команда —, Обучение —, Сообщество — */
  finance: ['leads', 'team', 'learning', 'community', 'buyer-requests'],
  /** Команда —, Обучение —, Запросы покупателей — (нет buyer_request.respond) */
  procurement_head: ['team', 'learning', 'buyer-requests'],
}

/** Доступ к разделу «Чаты» (видимость пункта rail = тот же флаг, что и у guard по `chats`). */
export function roleHasChatsSectionAccess(role: UserRole): boolean {
  const hide = HIDE_RAIL_IDS_FOR_ROLE[role] ?? []
  return !hide.includes('chats')
}

/** Пункты rail, видимые для роли (без учёта категорийных прав). */
export function getRoleDashboardRailItems(role: UserRole): DashboardRailItem[] {
  const hide = new Set(HIDE_RAIL_IDS_FOR_ROLE[role] ?? [])
  return DASHBOARD_RAIL_ITEMS.filter((item) => {
    if (item.id === 'development' && role !== 'developer') return false
    if (hide.has(item.id)) return false
    return true
  })
}

export type DashboardRailItemWithAccess = DashboardRailItem & { accessible: boolean }

/**
 * Раздел «Команда» доступен только управленческим командным ролям — и
 * ДЕЙСТВИЯ создания (buildings/floors/units в мастере разработки, см.
 * useRolePermissions::isManagementPosition, тот же Set) той же управленческой
 * тройке. `developer` добавлена 27.08.2026 (владелец подтвердил, D-07
 * vertical E2E): owner developer-организации — единственная управляющая
 * позиция в своей организации (Position.fixedRole==='developer'), без неё
 * здесь реальный developer-owner логинится, видит раздел «Девелопмент», но
 * не может создать ни один Building/Floor/Unit — кнопки создания скрыты.
 */
const TEAM_SECTION_TEAM_ROLES: ReadonlySet<string> = new Set(['owner', 'director', 'rop', 'developer'])

/**
 * Доступ к разделу «Команда» по роли занимаемой позиции (teamRole из ensure-self).
 * Фолбэк на аккаунтную роль покрывает демо/мок-сессии, где роль и есть позиция;
 * реальный сотрудник без управленческой позиции (teamRole manager/marketer/…,
 * либо вовсе без позиции — role «agency») раздел не видит.
 */
export function teamSectionAccessible(role: UserRole, teamRole?: UserRole | null): boolean {
  return TEAM_SECTION_TEAM_ROLES.has(teamRole ?? role)
}

/** Все пункты rail для роли + флаг доступа по матрице категорий. */
export function getDashboardRailItemsWithAccess(
  role: UserRole,
  permissionOverrides?: Record<string, string> | null,
  teamRole?: UserRole | null,
): DashboardRailItemWithAccess[] {
  const permissions = resolveModulePermissions(role, permissionOverrides)
  return getRoleDashboardRailItems(role).map((item) => ({
    ...item,
    accessible:
      item.id === 'team'
        ? teamSectionAccessible(role, teamRole)
        : railSectionVisibleForPermissions(item.id, permissions),
  }))
}

/** Только доступные пункты (для виджетов рабочего стола и т.п.). */
export function getVisibleDashboardRailItems(
  role: UserRole,
  permissionOverrides?: Record<string, string> | null,
  teamRole?: UserRole | null,
): DashboardRailItem[] {
  return getDashboardRailItemsWithAccess(role, permissionOverrides, teamRole).filter((item) => item.accessible)
}

export function getDashboardRailLabelBySectionId(sectionId: string | null): string | undefined {
  if (!sectionId) return undefined
  return DASHBOARD_RAIL_ITEMS.find((item) => item.id === sectionId)?.label
}

export function isDashboardRailItemActive(pathname: string, item: DashboardRailItem): boolean {
  if (item.end) {
    return (
      pathname === '/dashboard' ||
      pathname === '/dashboard/' ||
      pathname.startsWith('/dashboard/calendar')
    )
  }
  if (item.match) {
    return item.match(pathname)
  }
  return pathname.startsWith(item.to)
}

/**
 * Какой «раздел rail» соответствует URL.
 * `null` допускается только для действительно служебных маршрутов, иначе маршрут должен быть привязан к разделу.
 */
export function getDashboardSectionIdForPath(pathname: string): string | null {
  if (pathname === '/dashboard' || pathname === '/dashboard/') return 'desk'
  /** Личный отчёт — часть конвета рабочего стола (видимость как у «Рабочий стол»). */
  if (pathname === '/dashboard/my-report' || pathname.startsWith('/dashboard/my-report/')) return 'desk'
  /** Календарь — полный экран с виджета рабочего стола; тот же контур доступа, что «Рабочий стол». */
  if (pathname.startsWith('/dashboard/calendar')) return 'desk'
  if (pathname.startsWith('/dashboard/development')) return 'development'
  if (pathname === '/dashboard/team/kpi' || pathname.startsWith('/dashboard/team/kpi/')) return 'team'
  /** Все отчёты — в контуре «Аналитика». */
  if (pathname.startsWith('/dashboard/crm/analytics')) return 'analytics'
  if (pathname.startsWith('/dashboard/analytics')) return 'analytics'
  if (pathname.startsWith('/dashboard/reports/')) return 'analytics'
  if (pathname.startsWith('/dashboard/leads/report')) return 'analytics'
  if (pathname.startsWith('/dashboard/deals/report')) return 'analytics'
  if (pathname.startsWith('/dashboard/new-buildings/report')) return 'analytics'
  if (pathname.startsWith('/dashboard/objects/report')) return 'analytics'
  if (pathname.startsWith('/dashboard/finance/report')) return 'analytics'
  if (pathname.startsWith('/dashboard/community/report')) return 'analytics'
  if (pathname.startsWith('/dashboard/chats')) return 'chats'

  /** Старые/технические разделы также жестко привязываем к доменам. */
  if (pathname.startsWith('/dashboard/product') || pathname.startsWith('/dashboard/overview')) return 'desk'
  if (pathname.startsWith('/dashboard/personnel')) return 'team'
  if (pathname.startsWith('/dashboard/bookings')) return 'newbuild'
  if (pathname.startsWith('/dashboard/deals') || pathname.startsWith('/dashboard/clients') || pathname.startsWith('/dashboard/tasks')) return 'crm'

  for (const item of DASHBOARD_RAIL_ITEMS) {
    if (item.id === 'desk') continue
    if (item.match?.(pathname)) return item.id
  }
  return null
}

export function isDashboardPathBlockedForRole(
  pathname: string,
  role: UserRole,
  permissionOverrides?: Record<string, string> | null,
  teamRole?: UserRole | null,
): boolean {
  const section = getDashboardSectionIdForPath(pathname)
  if (section === null) return false

  const railItem = getDashboardRailItemsWithAccess(role, permissionOverrides, teamRole).find(
    (item) => item.id === section,
  )
  if (!railItem) return true
  return !railItem.accessible
}

/**
 * Раздел «Инфо» перенесён под `/dashboard/settings/info/*` — доступен всем ролям с доступом к дашборду,
 * не путать со служебным хабом настроек (owner / director / РОП).
 */
export function isDashboardInfoCenterPath(pathname: string): boolean {
  return pathname === '/dashboard/settings/info' || pathname.startsWith('/dashboard/settings/info/')
}

/** Хаб и вложенные страницы настроек (матрица «Настройки»: доступ только owner / director / РОП). */
export function isDashboardSettingsPath(pathname: string): boolean {
  if (isDashboardInfoCenterPath(pathname)) return false
  if (pathname === '/dashboard/settings-hub' || pathname.startsWith('/dashboard/settings-hub/')) return true
  if (pathname === '/dashboard/settings' || pathname.startsWith('/dashboard/settings/')) return true
  return false
}

/** Служебный маршрут после запрета по роли — всегда разрешён авторизованным пользователям. */
export function isDashboardAccessDeniedPath(pathname: string): boolean {
  return pathname === '/dashboard/access-denied'
}

/** Хаб настроек доступен только owner/director/rop. */
export function roleCanAccessSettingsHub(role: UserRole): boolean {
  return role === 'owner' || role === 'director' || role === 'rop' || role === 'developer'
}

/**
 * Проверяет, является ли пользователь «реальным» (не демо и не из списка зашитых моков).
 * Обычно у реальных пользователей login — это email.
 */
export function isRealUserAccount(login?: string): boolean {
  if (!login || login === 'demo') return false
  // Список логинов моковых пользователей из AuthContext.tsx
  const mockLogins = ['owner', 'director', 'rop', 'manager', 'marketer', 'administrator', 'lawyer', 'procurement', 'trainee', 'finance', 'developer']
  return !mockLogins.includes(login.toLowerCase())
}

export function isDashboardRouteForbiddenForRole(
  pathname: string,
  role: UserRole,
  login?: string,
  permissionOverrides?: Record<string, string> | null,
  teamRole?: UserRole | null,
): boolean {
  if (isDashboardAccessDeniedPath(pathname)) return false

  const permissions: PermissionMap = resolveModulePermissions(role, permissionOverrides)

  // Специальное исключение: настройки чатов, личный профиль и хаб настроек
  // доступны всем реальным пользователям (кто вошел через логин, а не через демо-вход).
  const isChatSettings = pathname === '/dashboard/settings/chats' || pathname.startsWith('/dashboard/settings/chats/')
  const isProfileSettings = pathname === '/dashboard/settings/profile' || pathname.startsWith('/dashboard/settings/profile/')
  const isSettingsHub = pathname === '/dashboard/settings-hub' || pathname === '/dashboard/settings-hub/'

  if ((isChatSettings || isProfileSettings || isSettingsHub) && login && login !== 'demo') {
    return false
  }

  if (isDashboardSettingsPath(pathname) && !roleCanAccessSettingsHub(role)) return true
  if (isPathBlockedByModulePermissions(pathname, permissions)) return true
  return isDashboardPathBlockedForRole(pathname, role, permissionOverrides, teamRole)
}

/** Удобная обёртка для UI (кнопки, ссылки): тот же контракт, что у `DashboardRouteGuard`. */
export function isDashboardPathAllowedForRole(
  pathname: string,
  role: UserRole,
  permissionOverrides?: Record<string, string> | null,
  teamRole?: UserRole | null,
): boolean {
  return !isDashboardRouteForbiddenForRole(pathname, role, undefined, permissionOverrides, teamRole)
}
