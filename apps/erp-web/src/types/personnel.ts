/**
 * Типы сотрудника-карточки экрана «Команда» и справочные таблицы ролей.
 *
 * Вынесены из `data/personnel-mock.ts` (03.09.2026, TEAM-001): там же жили
 * фиктивные `MOCK_EMPLOYEES`, из-за чего продуктовый код (PersonnelPage,
 * teamApi) был вынужден импортировать «мок»-файл ради одних только типов.
 * `personnel-mock.ts` реэкспортирует эти типы для обратной совместимости с
 * KPI/отчётным контуром (MyReportPage, SetPlansModal), который по-прежнему
 * работает на моке —
 * см. docs/progress-report-2026-09-01.md, KPI и отчёты backend не реализует.
 */

export type EmployeeRole = 'owner' | 'director' | 'rop' | 'marketer' | 'administrator' | 'manager'

export interface Employee {
  id: string
  name: string
  role: EmployeeRole
  position: string
  managerId: string | null
  phone?: string
  email?: string
  hireDate?: string
  avatarUrl?: string
  /** Дата рождения (ISO) */
  birthDate?: string
  /** Подразделение / отдел */
  department?: string
  /** Город / офис */
  city?: string
  /** Telegram (@username) */
  telegram?: string
  /** О себе — свободный текст */
  aboutMe?: string
  /** Навыки и компетенции */
  skills?: string[]
  /** WhatsApp (номер) */
  whatsapp?: string
  /** Профиль ВКонтакте (ссылка) */
  vk?: string
  /** Профиль Instagram (ссылка или @ник) */
  instagram?: string
  /** Личный сайт / портфолио */
  website?: string
  /** Email для входа (platform-аккаунт) */
  loginEmail?: string
  /** ID platform-пользователя */
  platformUserId?: string
  /** Статус аккаунта */
  status?: 'active' | 'blocked' | 'invited'
  /** Персональные overrides категорий доступа */
  permissionOverrides?: Record<string, string>

  /* ── Модель позиций (Stage A, фронт): запись = позиция + её занимающий ── */
  /** Стабильный id позиции (не меняется при смене человека). */
  positionId?: string
  /** Позиция-родитель в структуре. */
  parentPositionId?: string | null
  /** Позиция свободна (занимающего нет; клиенты и доступы остаются на позиции). */
  vacant?: boolean
  /** История занятости позиции. */
  occupancyHistory?: import('@/types/team').OccupancyEntry[]
  /** Абсолютный профиль доступа позиции (сериализованный). */
  accessProfile?: Record<string, string>
  /** Персональные дельты доступа сотрудника поверх профиля позиции. */
  personalAccess?: Record<string, string>
}

export const ROLE_LABELS: Record<EmployeeRole, string> = {
  owner: 'Собственник',
  director: 'Директор',
  rop: 'РОП',
  marketer: 'Маркетолог',
  administrator: 'Администратор',
  manager: 'Менеджер',
}

export const ROLE_COLORS: Record<EmployeeRole, { bg: string; text: string; border: string }> = {
  owner:    { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-200' },
  director: { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-200' },
  rop:      { bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-200' },
  marketer: { bg: 'bg-emerald-100',text: 'text-emerald-800',border: 'border-emerald-200' },
  administrator: { bg: 'bg-emerald-100',text: 'text-emerald-800',border: 'border-emerald-200' },
  manager:  { bg: 'bg-emerald-100',text: 'text-emerald-800',border: 'border-emerald-200' },
}
