import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle,
  CheckCircle2,
  Clock,
  Eye,
  Info,
  ListTodo,
  Paperclip,
  Phone,
  Plus,
  Target,
  Users,
  X,
  Zap,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useWorkspaceDeskScreen } from '@/context/WorkspaceDeskScreenContext'
import {
  getVisibleDashboardRailItems,
  isDashboardPathAllowedForRole,
} from '@/config/dashboard-rail'
import { useLeads } from '@/context/LeadsContext'
import { useDeals } from '@/context/DealsContext'
import { cn } from '@/lib/utils'
import { useCrmSync } from '@/features/crm/context/CrmSyncContext'
import { type Reminder } from '@/data/info-mock'
import type { NewsArticle } from '@/services/newsApiV2'
import { useNewsFeed } from '@/context/NewsFeedContext'
import { newsAuthor, newsEmoji } from '@/lib/news'
import { EMPTY_HOME_PROGRESS } from '@/lib/plan-progress'
import { usePlanProgress } from '@/hooks/usePlanProgress'
import { INITIAL_LEAD_MANAGERS } from '@/data/leads-mock'
import { MiniCalendar } from '@/components/dashboard/MiniCalendar'
import {
  WorkspaceDayEventsMenu,
  WorkspaceDayEventsPanel,
} from '@/components/dashboard/WorkspaceDayEventsMenu'
import { ScreenTwo } from '@/components/dashboard/ScreenTwo'
import { SetPlansModal } from '@/components/dashboard/SetPlansModal'
import { STATUS_LABELS, type Task } from '@/types/tasks'
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '@/types/leads'
import { buildDeskBootstrapSeen, useDeskSeenState } from '@/hooks/useDeskSeenState'

/* ── константы ── */



const DESK_PREVIEW = 6
const TASKS_PREVIEW = 12
const LEADS_PREVIEW = 12
const NOTIFS_PREVIEW = 8
/** Единая «лента» уведомлений / напоминаний / новостей: без фикс. высоты — только отступы и ритм текста */
const FEED_ITEM_CLASS =
  'flex items-start gap-2.5 overflow-hidden rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2.5 sm:px-3.5 sm:py-3'
const FEED_TITLE_CLASS =
  'line-clamp-2 text-[13px] font-normal leading-snug text-[color:var(--workspace-text)] sm:text-[14px]'
const FEED_BODY_CLASS =
  'line-clamp-2 text-[12px] font-normal leading-snug text-[color:var(--workspace-text-muted)] sm:text-[13px]'
const FEED_META_CLASS =
  'text-[11px] font-normal leading-snug text-[color:var(--workspace-text-muted)] sm:text-[12px]'
const FEED_STACK_CLASS = 'flex min-w-0 flex-1 flex-col gap-1'

/** Рабочий стол воронки */
const LEADS_POKER_HREF = '/dashboard/leads/poker'

/** Классическая CRM — блок задач */
const CRM_TASKS_HREF = '/dashboard/leads/poker?view=classic'

const DESK_HEADER_LINK_CLASS =
  'text-[13px] font-normal uppercase tracking-wide text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)] sm:text-[14px]'

/* ── переиспользуемые блоки ── */

function HubWidgetShell({
  children,
  className,
  accent,
  dataTestId,
}: {
  children: React.ReactNode
  className?: string
  /** Цвет тонкой верхней обводки (акцент). */
  accent?: string
  dataTestId?: string
}) {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg',
        'bg-[var(--workspace-card-bg)] backdrop-blur-xl',
        'shadow-[inset_0_0_0_1px_var(--workspace-card-ring)]',
        'transition-[background,box-shadow] duration-200',
        'hover:bg-[var(--workspace-card-hover)] hover:shadow-[inset_0_0_0_1px_var(--workspace-card-ring-hover)]',
        className,
      )}
      style={accent ? { borderTop: `2px solid ${accent}` } : undefined}
    >
      {children}
    </div>
  )
}

function WidgetHeader({
  icon,
  title,
  right,
  accentColor,
  layout = 'comfort',
  titleClassName,
}: {
  icon: React.ReactNode
  title?: string | null
  right?: React.ReactNode
  accentColor?: string
  /** comfort — полноразмерные шапки рабочего стола */
  layout?: 'compact' | 'comfort'
  /** Переопределение размера/стиля заголовка (например короче блок рядом с календарём) */
  titleClassName?: string
}) {
  const spacious = layout === 'comfort'
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--workspace-row-border)]',
        spacious ? 'px-3 py-2.5 sm:px-4 sm:py-3' : 'px-3 py-1.5',
      )}
    >
      <div className={cn('flex min-w-0 items-center', spacious ? 'gap-2.5' : 'gap-1.5')}>
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg',
            spacious ? 'size-8 sm:size-9' : 'size-6 rounded-md',
          )}
          style={{
            background: accentColor ? `${accentColor}18` : 'var(--workspace-widget-icon-bg)',
            color: accentColor ?? 'var(--workspace-widget-icon-fg)',
          }}
        >
          {icon}
        </div>
        {title ? (
          <h3
            className={cn(
              'min-w-0 flex-1 line-clamp-2 font-normal leading-snug tracking-tight text-[color:var(--workspace-widget-title)]',
              spacious ? 'text-[14px] font-normal sm:text-[15px]' : 'text-[12px] sm:text-[13px]',
              titleClassName,
            )}
          >
            {title}
          </h3>
        ) : null}
      </div>
      {right != null && <div className="shrink-0">{right}</div>}
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
  badge,
  variant = 'default',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: number
  variant?: 'default' | 'deskMain'
}) {
  const main = variant === 'deskMain'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-0.5 transition-colors',
        main
          ? 'rounded-lg px-2.5 py-1.5 text-[13px] font-normal tracking-tight sm:px-3 sm:text-[14px]'
          : 'rounded-md px-2.5 py-1 text-[13px] font-normal uppercase tracking-wide sm:text-[14px]',
        active
          ? main
            ? 'bg-[color-mix(in_srgb,var(--gold)_24%,transparent)] text-[color:var(--workspace-text)]'
            : 'bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-[color:var(--workspace-text)]'
          : main
            ? 'text-[color:var(--workspace-text-muted)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--workspace-text)]'
            : 'text-[color:var(--workspace-text-muted)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[color:var(--workspace-text)]',
      )}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="flex size-5 items-center justify-center rounded-full bg-[#e11d48] text-[10px] font-normal leading-none text-[#fde8e8]">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

function InfoTabBtn({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex min-h-[2.75rem] min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[12px] font-normal leading-snug transition-colors sm:min-h-[2.5rem] sm:gap-1.5 sm:px-2 sm:py-2 sm:text-[13px]',
        active
          ? 'border-[color:var(--workspace-row-border)] bg-[color-mix(in_srgb,var(--gold)_14%,transparent)] text-[color:var(--workspace-text)] shadow-[inset_0_-2px_0_0_var(--gold)]'
          : 'border-transparent text-[color:var(--workspace-text-muted)] hover:border-[color:var(--workspace-row-border)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[color:var(--workspace-text)]',
      )}
    >
      <span className="min-w-0 flex-1 hyphens-auto text-pretty text-center leading-snug [overflow-wrap:anywhere] line-clamp-2">
        {children}
      </span>
      {badge != null && badge > 0 ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#e11d48] text-[10px] font-normal leading-none text-[#fde8e8]">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  )
}

/* ── вспомогательные функции ── */

function notifIcon(type: string) {
  const s = 'size-3.5 shrink-0'
  switch (type) {
    case 'alert':   return <AlertTriangle className={cn(s, 'text-red-400')} />
    case 'success': return <CheckCircle className={cn(s, 'text-emerald-400')} />
    case 'info':    return <Info className={cn(s, 'text-blue-400')} />
    case 'auto':    return <Zap className={cn(s, 'text-amber-400')} />
    default:        return <Info className={cn(s, 'text-[color:var(--workspace-text-dim)]')} />
  }
}

function formatReminderDue(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function datetimeLocalToDueAt(value: string): string {
  if (!value) return ''
  return value.length === 16 ? `${value}:00` : value
}

function isTaskOverdue(t: Task, todayIso: string): boolean {
  if (t.status === 'done') return false
  if (t.status === 'overdue') return true
  if (!t.dueDate) return false
  return t.dueDate < todayIso
}





function workspaceCalDateInitial() {
  const t = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

/* ── флаги задачи как в карточке классической CRM: 🔴 «Срочно» / 🔖 «Важно» ── */
function TaskUrgentIcon({ title }: { title: string }) {
  return (
    <span title={title} className="inline-flex size-[18px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-[18px]">
        <path d="M19.0723 11.1734C19.0231 11.0678 18.9172 11 18.8005 11H15.2455L18.754 5.46051C18.8125 5.36812 18.8161 5.25112 18.7633 5.15543C18.7105 5.05941 18.6097 5 18.5005 5H13.7005C13.5868 5 13.483 5.0642 13.432 5.1659L8.93202 14.1659C8.88551 14.2586 8.89061 14.369 8.94521 14.4575C9.00012 14.546 9.09642 14.6 9.20051 14.6H12.2854L8.9239 22.5836C8.8666 22.7201 8.91761 22.8785 9.04389 22.9559C9.09248 22.9856 9.14648 23 9.2002 23C9.28629 23 9.3712 22.9631 9.43001 22.8935L19.03 11.4935C19.1053 11.4041 19.1215 11.2793 19.0723 11.1734Z" fill="#FF070B"/>
      </svg>
    </span>
  )
}

function TaskImportantIcon({ title }: { title: string }) {
  return (
    <span title={title} className="inline-flex size-[18px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-[18px]">
        <path d="M18.4582 5H8.59461C7.79129 5 7.08594 5.66085 7.08594 6.44309V21.0343C7.08594 21.2962 7.15881 21.5144 7.27627 21.683C7.41673 21.8846 7.64289 22.0001 7.88541 22C8.1147 22 8.35882 21.8979 8.58427 21.7054L12.9972 17.9585C13.1335 17.8421 13.3293 17.7754 13.5329 17.7754C13.7363 17.7754 13.9317 17.8421 14.0684 17.9589L18.4666 21.7048C18.6929 21.8979 18.9202 22.0001 19.149 22.0001C19.5361 22.0001 19.9134 21.7015 19.9134 21.0344V6.44309C19.9134 5.66085 19.2615 5 18.4582 5Z" fill="#F6B000"/>
      </svg>
    </span>
  )
}

/** Иконки-флаги задачи (срочно/важно/файлы) в стиле карточки CRM */
function TaskFlagIcons({ task }: { task: Task }) {
  const { t } = useI18n()
  const urgent = task.priority === 'high' || task.priority === 'critical'
  const important = task.priority === 'medium' || task.priority === 'critical'
  const hasFiles = (task.attachmentFileNames?.length ?? 0) > 0
  if (!urgent && !important && !hasFiles) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      {hasFiles ? <Paperclip className="size-3.5 text-[color:var(--workspace-text-muted)]" strokeWidth={2} /> : null}
      {urgent ? <TaskUrgentIcon title={t('dashboardWorkspace.urgent')} /> : null}
      {important ? <TaskImportantIcon title={t('dashboardWorkspace.important')} /> : null}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════
   ГЛАВНЫЙ КОМПОНЕНТ
   ════════════════════════════════════════════════════════════════ */

export function DashboardWorkspace() {
  const { t } = useI18n();
  const { currentUser } = useAuth()
  const { activeScreen } = useWorkspaceDeskScreen()
  const { state } = useLeads()
  const { deals } = useDeals()
  const navigate = useNavigate()

  /* ── CRM DATA (from Sync Context) ── */
  const { 
    tasks: crmTasks, 
    notifications: crmNotifications, 
    reminders: crmReminders,
    isLoading: isCrmLoading,
    markNotificationRead,
    archiveReminder: archiveReminderApi
  } = useCrmSync()
  const { articles: crmNews } = useNewsFeed()

  /* ── состояние интерфейса ── */
  const todayLocal = new Date()
  const todayIso = useMemo(() => {
    const y = todayLocal.getFullYear()
    const m = String(todayLocal.getMonth() + 1).padStart(2, '0')
    const d = String(todayLocal.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])

  const [selectedNews, setSelectedNews] = useState<NewsArticle | null>(null)
  const [mainTab, setMainTab] = useState<'tasks' | 'leads'>('tasks')
  const [showSetPlans, setShowSetPlans] = useState(false)
  const [taskMode, setTaskMode] = useState<'all' | 'today' | 'overdue'>('today')
  const [infoTab, setInfoTab] = useState<'notifs' | 'reminders' | 'news'>('notifs')
  const [todayTasksOverlayOpen, setTodayTasksOverlayOpenState] = useState(false)
  const [workspaceEventsOpen, setWorkspaceEventsOpenState] = useState(false)
  const [rescheduleReminder, setRescheduleReminder] = useState<Reminder | null>(null)
  const [rescheduleDraft, setRescheduleDraft] = useState('')

  const deskRole = currentUser?.role ?? 'manager'
  const deskTeamRole = currentUser?.teamRole
  const deskRailIds = useMemo(
    () => new Set(getVisibleDashboardRailItems(deskRole, undefined, deskTeamRole).map((i) => i.id)),
    [deskRole, deskTeamRole],
  )
  const deskShowTasks = isDashboardPathAllowedForRole('/dashboard/tasks', deskRole)
  const deskShowLeads = deskRailIds.has('leads')
  const deskShowCalendar = isDashboardPathAllowedForRole('/dashboard/calendar/personal', deskRole)
  const deskShowInfo = isDashboardPathAllowedForRole('/dashboard/settings/info', deskRole)
  const canOpenMyReport = isDashboardPathAllowedForRole('/dashboard/my-report', deskRole)
  // Планы команды — та же тройка управленческих позиций, что и раздел «Команда»
  // (teamRole реального логина; фолбэк на role покрывает демо-сессии).
  const canAccessTeamPlans = ['owner', 'director', 'rop'].includes(deskTeamRole ?? deskRole)

  const [workspaceCalDate, setWorkspaceCalDate] = useState(() => workspaceCalDateInitial())
  const todayLocalIso = useMemo(() => workspaceCalDateInitial(), [])
  const workspaceCalPrevRef = useRef(workspaceCalDate)
  const isManager = currentUser?.role === 'manager'
  const managerId = isManager ? currentUser?.id ?? null : null

  const [reminderEdits, setReminderEdits] = useState<Record<string, { archived?: boolean; dueAt?: string }>>({})
  const [notifHiddenIds, setNotifHiddenIds] = useState<Set<string>>(() => new Set())

  /* ── подготовка данных ── */

  const pool = useMemo(() => {
    return managerId ? state.leadPool.filter((l) => l.managerId === managerId) : state.leadPool
  }, [managerId, state.leadPool])

  const newLeads = useMemo(() => {
    return [...pool]
      .filter((l) => l.stageId === 'new')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8)
  }, [pool])

  const mineTask = useCallback(
    (t: Task) => {
      if (t.status === 'done') return false
      // Доверяем фильтрации на стороне API
      return true
    },
    [],
  )

  const attentionTasks = useMemo(() => {
    const list = crmTasks.filter(mineTask).filter(
      (t) => isTaskOverdue(t, todayIso) || t.dueDate === todayIso,
    )
    list.sort((a, b) => {
      const ao = isTaskOverdue(a, todayIso) ? 0 : 1
      const bo = isTaskOverdue(b, todayIso) ? 0 : 1
      if (ao !== bo) return ao - bo
      return a.dueDate.localeCompare(b.dueDate)
    })
    return list
  }, [mineTask, todayIso, crmTasks])

  const attentionTaskIds = useMemo(() => attentionTasks.map((t) => t.id), [attentionTasks])

  // Лента уже отсортирована: закреплённые сверху, внутри — новые первыми.
  const newsSorted = crmNews
  const newsIdsOrdered = useMemo(() => newsSorted.map((a) => a.id), [newsSorted])

  const deskRemindersList = useMemo(
    () =>
      crmReminders.filter((r) => !r.done && !reminderEdits[r.id]?.archived).map((r) => ({
        ...r,
        dueAt: reminderEdits[r.id]?.dueAt ?? r.dueAt,
      })),
    [reminderEdits, crmReminders],
  )
  const undoneReminderIds = useMemo(() => deskRemindersList.map((r) => r.id), [deskRemindersList])

  const visibleNotifications = useMemo(
    () => crmNotifications.filter((n) => !notifHiddenIds.has(n.id)),
    [notifHiddenIds, crmNotifications],
  )
  const notifIds = useMemo(() => crmNotifications.map((n) => n.id), [crmNotifications])

  const bootstrapSeen = useMemo(
    () =>
      buildDeskBootstrapSeen({
        leadIdsNewestFirst: newLeads.map((l) => l.id),
        taskAttentionIdsOrdered: attentionTaskIds,
        notifIds,
        reminderIds: undoneReminderIds,
        newsIdsNewestFirst: newsIdsOrdered,
      }),
    [newLeads, attentionTaskIds, notifIds, undoneReminderIds, newsIdsOrdered],
  )

  const { markSeen, unread } = useDeskSeenState(bootstrapSeen)

  useEffect(() => {
    markSeen('tasks', attentionTaskIds)
    markSeen('notifs', notifIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markSeen])

  const setTodayTasksOverlayOpen = useCallback((value: boolean | ((b: boolean) => boolean)) => {
    setTodayTasksOverlayOpenState((prev) => {
      const next = typeof value === 'function' ? (value as (b: boolean) => boolean)(prev) : value
      if (next) setWorkspaceEventsOpenState(false)
      return next
    })
  }, [])

  const setWorkspaceEventsOpen = useCallback((value: boolean | ((b: boolean) => boolean)) => {
    setWorkspaceEventsOpenState((prev) => {
      const next = typeof value === 'function' ? (value as (b: boolean) => boolean)(prev) : value
      if (next) setTodayTasksOverlayOpenState(false)
      return next
    })
  }, [])

  useEffect(() => {
    if (!deskShowCalendar) setWorkspaceEventsOpenState(false)
  }, [deskShowCalendar])

  useEffect(() => {
    if (rescheduleReminder) setRescheduleDraft(isoToDatetimeLocalValue(rescheduleReminder.dueAt))
  }, [rescheduleReminder])

  useEffect(() => {
    if (!deskShowLeads && mainTab === 'leads') setMainTab('tasks')
    if (!deskShowTasks && mainTab === 'tasks' && deskShowLeads) setMainTab('leads')
  }, [deskShowLeads, deskShowTasks, mainTab])

  useEffect(() => {
    if (workspaceCalDate !== todayLocalIso) setTodayTasksOverlayOpen(false)
  }, [workspaceCalDate, todayLocalIso])

  useEffect(() => {
    const prev = workspaceCalPrevRef.current
    workspaceCalPrevRef.current = workspaceCalDate
    if (workspaceCalDate === todayLocalIso && prev !== workspaceCalDate) {
      setTodayTasksOverlayOpen(true)
    }
  }, [workspaceCalDate, todayLocalIso])

  const openMainTab = (tab: 'tasks' | 'leads') => {
    setMainTab(tab)
    if (tab === 'tasks') markSeen('tasks', attentionTaskIds)
    else markSeen('leads', newLeads.map((l) => l.id))
  }

  const openInfoTab = (tab: 'notifs' | 'reminders' | 'news') => {
    setInfoTab(tab)
    if (tab === 'notifs') markSeen('notifs', notifIds)
    if (tab === 'reminders') markSeen('reminders', undoneReminderIds)
    if (tab === 'news') markSeen('news', newsIdsOrdered)
  }

  const filteredTasks = useMemo(() => {
    const base = crmTasks.filter(mineTask)
    if (taskMode === 'today') return base.filter((t) => t.dueDate === todayIso && t.status !== 'done')
    if (taskMode === 'overdue') return base.filter((t) => isTaskOverdue(t, todayIso))
    return base.filter((t) => t.status !== 'done')
  }, [mineTask, taskMode, todayIso, crmTasks])

  filteredTasks.sort((a, b) => {
    const da = `${a.dueDate}T${a.dueTime ?? '00:00'}`
    const db = `${b.dueDate}T${b.dueTime ?? '00:00'}`
    return da.localeCompare(db)
  })

  const todayOverlayTasks = useMemo(() => {
    const base = crmTasks.filter(mineTask).filter((t) => t.dueDate === todayIso && t.status !== 'done')
    const list = [...base]
    list.sort((a, b) => {
      const da = `${a.dueDate}T${a.dueTime ?? '00:00'}`
      const db = `${b.dueDate}T${b.dueTime ?? '00:00'}`
      return da.localeCompare(db)
    })
    return list
  }, [mineTask, todayIso, crmTasks])

  /* ── бейджи ── */
  const leadTabIds = useMemo(() => newLeads.map((l) => l.id), [newLeads])
  const badgeLeads = mainTab === 'tasks' ? unread.leads(leadTabIds) : 0
  const badgeTasks = mainTab === 'leads' ? unread.tasks(attentionTaskIds) : 0

  const remindersPreview = useMemo(() => deskRemindersList.slice(0, DESK_PREVIEW), [deskRemindersList])
  const newsPreview = useMemo(() => newsSorted.slice(0, DESK_PREVIEW), [newsSorted])

  const badgeNotifs = infoTab !== 'notifs' ? unread.notifs(notifIds) : 0
  const badgeReminders = infoTab !== 'reminders' ? unread.reminders(undoneReminderIds) : 0
  const badgeNews = infoTab !== 'news' ? unread.news(newsIdsOrdered) : 0

  /* ── прогресс и показатели ── */
  // План и факт с сервера: руководитель видит сумму по команде, сотрудник — себя.
  const { metrics: planMetrics, reload: reloadPlanProgress } = usePlanProgress('team')
  const progress = planMetrics ?? EMPTY_HOME_PROGRESS
  const dayPlanGapPct = Math.max(0, 100 - progress.dayPlanPercent)
  const focusKpi = useMemo(() => {
    if (!progress.activityKpis.length) return null
    return progress.activityKpis.reduce((worst, kpi) => {
      const worstRatio = worst.plan > 0 ? worst.current / worst.plan : 1
      const ratio = kpi.plan > 0 ? kpi.current / kpi.plan : 1
      return ratio < worstRatio ? kpi : worst
    })
  }, [progress.activityKpis])
  const focusGap = focusKpi ? Math.max(0, focusKpi.plan - focusKpi.current) : 0

  const focusDeskHref =
    focusGap > 0 && deskShowTasks
      ? '/dashboard/tasks'
      : canOpenMyReport
        ? '/dashboard/my-report'
        : null
  const todayActionItems = useMemo(() => {
    const leadGap = Math.max(0, progress.leadsToday.plan - progress.leadsToday.count)
    const overdueTasksCount = crmTasks.filter(mineTask).filter((task) => isTaskOverdue(task, todayIso)).length
    const todayTasksCount = todayOverlayTasks.length
    const focusHref = focusDeskHref ?? (canOpenMyReport ? '/dashboard/my-report' : '/dashboard/tasks')

    return [
      {
        id: 'leads',
        title: t('dashboardWorkspace.leadsToday'),
        current: progress.leadsToday.count,
        plan: progress.leadsToday.plan,
        unit: '',
        color: 'var(--workspace-text)',
        href: deskShowLeads ? '/dashboard/leads/poker' : null,
        badge: leadGap > 0 ? `-${leadGap}` : t('dashboardWorkspace.badgeOk'),
        tone: leadGap > 0 ? 'warning' : 'ok',
      },
      {
        id: 'tasks',
        title: t('dashboardWorkspace.tasksToday'),
        current: todayTasksCount,
        plan: overdueTasksCount > 0 ? 0 : todayTasksCount,
        unit: '',
        color: overdueTasksCount > 0 ? '#f43f5e' : 'var(--workspace-text)',
        href: focusHref,
        badge: overdueTasksCount > 0 ? t('dashboardWorkspace.badgeSla') : t('dashboardWorkspace.day'),
        tone: overdueTasksCount > 0 ? 'danger' : 'ok',
      },
    ]
  }, [canOpenMyReport, focusDeskHref, focusGap, focusKpi, mineTask, progress, todayIso, todayOverlayTasks.length, crmTasks, deskShowLeads])

  const removeNotification = useCallback(async (id: string) => {
    try {
      await markNotificationRead(id)
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
      setNotifHiddenIds((prev) => new Set(prev).add(id))
    }
  }, [markNotificationRead])

  const archiveReminder = useCallback(async (id: string) => {
    try {
      await archiveReminderApi(id)
    } catch (error) {
      console.error('Failed to archive reminder:', error)
      setReminderEdits((prev) => ({ ...prev, [id]: { ...prev[id], archived: true } }))
    }
  }, [archiveReminderApi])

  const applyReschedule = useCallback(() => {
    if (!rescheduleReminder) return
    const next = datetimeLocalToDueAt(rescheduleDraft)
    if (!next) return
    setReminderEdits((prev) => ({
      ...prev,
      [rescheduleReminder.id]: { ...prev[rescheduleReminder.id], dueAt: next },
    }))
    setRescheduleReminder(null)
  }, [rescheduleReminder, rescheduleDraft])

  const feedHoverActionBtnClass =
    'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-card-bg)] text-[color:var(--workspace-text-dim)] shadow-sm transition-colors hover:border-[color:color-mix(in_srgb,var(--gold)_40%,transparent)] hover:text-[color:var(--workspace-text)]'

  /* ═══════════════════ ОТРИСОВКА ═══════════════════ */

  /*
   * Первый экран: 3 колонки в одну строку (stretch по высоте центральной колонки).
   * Второй экран (ниже, прокрутка): 5 контрольных виджетов ТЗ в той же 3-колоночной сетке (2+2+1).
   */

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      {activeScreen === 1 && (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[minmax(240px,1.12fr)_minmax(260px,1.38fr)_minmax(240px,1.12fr)] lg:items-stretch lg:gap-2.5">
      {/* ╔══════════════════════════════════════════╗
         ║  1. ЗАДАЧИ / НОВЫЕ ЛИДЫ  (сверху слева) ║
         ╚══════════════════════════════════════════╝ */}
      <HubWidgetShell accent="color-mix(in srgb, var(--gold) 60%, transparent)" className="order-2 flex h-full min-h-0 flex-col rounded-xl lg:order-2">
        <WidgetHeader
          icon={<ListTodo className="size-5" strokeWidth={2} />}
          title={
            deskShowTasks || deskShowLeads ? t('dashboardWorkspace.tasksAndNewLeads') : t('dashboardWorkspace.desk')
          }
          right={
            deskShowTasks && deskShowLeads ? (
              <div className="flex gap-1 rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] p-1">
                <TabBtn
                  variant="deskMain"
                  active={mainTab === 'tasks'}
                  badge={badgeTasks}
                  onClick={() => openMainTab('tasks')}
                >
                  {t('dashboard.dashboardWorkspace.задачи')}</TabBtn>
                <TabBtn
                  variant="deskMain"
                  active={mainTab === 'leads'}
                  badge={badgeLeads}
                  onClick={() => openMainTab('leads')}
                >{t('dashboardWorkspace.newLeads')}</TabBtn>
              </div>
            ) : deskShowTasks ? (
              <Link to={CRM_TASKS_HREF} className={DESK_HEADER_LINK_CLASS}>{t('dashboardWorkspace.allTasks')}</Link>
            ) : deskShowLeads ? (
              <Link to={LEADS_POKER_HREF} className={DESK_HEADER_LINK_CLASS}>{t('dashboardWorkspace.toDesk')}</Link>
            ) : null
          }
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-3.5">
          {!deskShowTasks && !deskShowLeads ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-1 py-2 text-center">
              <p className="text-[14px] font-normal leading-snug text-[color:var(--workspace-text)]">{t('dashboardWorkspace.roleScope')}</p>
              <p className="text-[13px] leading-relaxed text-[color:var(--workspace-text-muted)]">{t('dashboardWorkspace.tasksAndLeadsUnavailable')}</p>
              <div className="flex flex-col gap-2 sm:mx-auto sm:max-w-[240px]">
                {deskRailIds.has('secondary') && (
                  <Link
                    to="/dashboard/objects"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.secondaryMarketProperties')}</Link>
                )}
                {deskRailIds.has('newbuild') && (
                  <Link
                    to="/dashboard/new-buildings"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.newBuildings')}</Link>
                )}
                {deskRailIds.has('chats') && (
                  <Link
                    to="/dashboard/chats"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.chats')}</Link>
                )}
                {deskRailIds.has('community') && (
                  <Link
                    to="/dashboard/community"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.community')}</Link>
                )}
                {deskRailIds.has('team') && (
                  <Link
                    to="/dashboard/team"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.team')}</Link>
                )}
                {deskRailIds.has('learning') && (
                  <Link
                    to="/dashboard/lms/browse"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.trainingAndKnowledgeBase')}</Link>
                )}
                {deskShowInfo && (
                  <Link
                    to="/dashboard/settings/info"
                    className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-3 text-[14px] font-normal text-[color:var(--workspace-text)] hover:border-[color:var(--theme-accent-link-dim)] sm:px-4 sm:text-[15px]"
                  >{t('dashboardWorkspace.info')}</Link>
                )}
              </div>
            </div>
          ) : mainTab === 'tasks' && deskShowTasks ? (
            <>
              <div className="mb-0.5 flex items-center gap-0.5">
                {([
                  { id: 'all' as const, label: t('dashboardWorkspace.all') },
                  { id: 'today' as const, label: t('dashboardWorkspace.today') },
                  { id: 'overdue' as const, label: t('dashboardWorkspace.overdue') },
                ] as const).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setTaskMode(m.id)}
                    className={cn(
                      'rounded-md px-2 py-1 text-[12px] font-normal uppercase tracking-wide transition-colors sm:text-[13px]',
                      taskMode === m.id
                        ? 'bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] text-[color:var(--workspace-text)]'
                        : 'text-[color:var(--workspace-text-muted)] hover:text-[color:var(--workspace-text)]',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
                <Link
                  to={CRM_TASKS_HREF}
                  className={cn('ml-auto flex items-center gap-1', DESK_HEADER_LINK_CLASS)}
                >
                  <Plus className="size-3.5 sm:size-4" strokeWidth={2.5} />{t('dashboardWorkspace.toTasks')}</Link>
              </div>

              {isCrmLoading ? (
                <div className="flex h-20 items-center justify-center">
                  <div className="size-5 animate-spin rounded-full border-2 border-[color:var(--gold)] border-t-transparent" />
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-[14px] text-[color:var(--workspace-text-muted)] sm:text-[15px]">
                    {taskMode === 'today' ? t('dashboardWorkspace.noTasksToday') : 
                     taskMode === 'overdue' ? t('dashboardWorkspace.noOverdueTasks') : t('dashboardWorkspace.noTasksFound')}
                  </p>
                  {taskMode === 'today' && crmTasks.length > 0 && (
                    <button 
                      onClick={() => setTaskMode('all')}
                      className="mt-1 text-[12px] text-[color:var(--theme-accent-link-dim)] hover:underline"
                    >
                      {t('dashboardWorkspace.showAll').replace('{{count}}', crmTasks.length.toString())}
                    </button>
                  )}
                </div>
              ) : (
                <ul className="min-h-0 flex-1 space-y-1 overflow-hidden">
                  {filteredTasks.slice(0, TASKS_PREVIEW).map((taskItem) => {
                    const overdue = isTaskOverdue(taskItem, todayIso)
                    return (
                      <li
                        key={taskItem.id}
                        onClick={() => navigate(CRM_TASKS_HREF)}
                        title={t('dashboardWorkspace.openInClassicCRM')}
                        className={cn(
                          'cursor-pointer rounded-lg border px-3 py-2 transition-colors hover:border-[color:var(--theme-accent-link-dim)] hover:bg-[var(--workspace-card-hover)]',
                          overdue
                            ? 'border-red-500/25 bg-red-500/[0.06]'
                            : 'border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)]',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-1 text-[15px] font-normal leading-snug text-[color:var(--workspace-text)] sm:text-[16px]">
                            {taskItem.title}
                          </p>
                          <TaskFlagIcons task={taskItem} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] text-[color:var(--workspace-text-muted)] sm:text-[13px]">
                          <span className={cn(overdue && 'font-normal text-red-400')}>
                            {STATUS_LABELS[taskItem.status]}
                          </span>
                          <span className="opacity-40">·</span>
                          <span>{taskItem.dueDate}{taskItem.dueTime ? ` ${taskItem.dueTime}` : ''}</span>
                          {taskItem.entityLabel && (
                            <>
                              <span className="opacity-40">·</span>
                              <span className="truncate text-[color:var(--theme-accent-link-dim)]">{taskItem.entityLabel}</span>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {filteredTasks.length > TASKS_PREVIEW && (
                <p className="mt-0.5 shrink-0 text-[11px] text-[color:var(--workspace-text-muted)]">
                  {t('dashboardWorkspace.moreTasks').replace('{{count}}', (filteredTasks.length - TASKS_PREVIEW).toString())}{' '}
                  <Link to={CRM_TASKS_HREF} className="font-normal text-[color:var(--theme-accent-link-dim)] hover:underline">{t('dashboardWorkspace.goToTasks')}</Link>
                </p>
              )}
            </>
          ) : deskShowLeads ? (
            <>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[14px] font-normal text-[color:var(--workspace-text-muted)] sm:text-[15px]">{t('dashboardWorkspace.queueNewLead')}</p>
                <Link to={LEADS_POKER_HREF} className={cn('flex shrink-0 items-center gap-1', DESK_HEADER_LINK_CLASS)}>
                  <Plus className="size-3.5 sm:size-4" strokeWidth={2.5} />{t('dashboardWorkspace.toDesk')}</Link>
              </div>
              {newLeads.length === 0 ? (
                <p className="py-2 text-center text-[14px] text-[color:var(--workspace-text-muted)] sm:text-[15px]">{t('dashboardWorkspace.noNewLeads')}</p>
              ) : (
                <ul className="min-h-0 flex-1 space-y-1 overflow-hidden">
                  {newLeads.slice(0, LEADS_PREVIEW).map((l) => {
                    const st = l.status ?? 'new'
                    return (
                      <li
                        key={l.id}
                        className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="line-clamp-1 text-[15px] font-normal text-[color:var(--workspace-text)] sm:text-[16px]">
                            {l.name ?? l.id}
                          </p>
                          <span className="shrink-0 rounded px-1 py-px text-[10px] font-normal uppercase text-amber-400/90">
                            {l.taskOverdue ? t('dashboardWorkspace.priorityHigh') : l.hasTask ? t('dashboardWorkspace.priorityMedium') : t('dashboardWorkspace.priorityNormal')}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] text-[color:var(--workspace-text-muted)] sm:text-[13px]">
                          <span>{t(`dashboardWorkspace.${l.source === 'ad_campaigns' ? 'adCampaigns' : l.source}` as any)}</span>
                          <span className="opacity-40">·</span>
                          <span>
                            {new Date(l.createdAt).toLocaleString('ru-RU', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          <span className="opacity-40">·</span>
                          <span className="font-normal" style={{ color: LEAD_STATUS_COLORS[st] }}>
                            {LEAD_STATUS_LABELS[st]}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[12px] text-[color:var(--workspace-text-muted)] sm:text-[13px]">
                          {t('dashboardWorkspace.resp').replace('{{name}}', (!l.managerId ? t('dashboardWorkspace.unassigned') : (INITIAL_LEAD_MANAGERS.find((m) => m.id === l.managerId)?.name ?? l.managerId)) || '')}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {newLeads.length > LEADS_PREVIEW && (
                <p className="mt-0.5 shrink-0 text-[11px] text-[color:var(--workspace-text-muted)]">
                  {t('dashboardWorkspace.moreInQueue').replace('{{count}}', (newLeads.length - LEADS_PREVIEW).toString())}
                </p>
              )}
            </>
          ) : null}
        </div>
      </HubWidgetShell>

      {/* ╔══════════════════════════════════════════╗
         ║  2–4. Центр: календарь + планы (оверлей дел) ║
         ╚══════════════════════════════════════════╝ */}
      <div className="order-3 grid h-full min-h-0 grid-rows-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-1.5 lg:order-3">
      <HubWidgetShell
        dataTestId="workspace-calendar-widget"
        accent="rgba(96,165,250,0.6)"
        className="flex h-full min-h-0 flex-col rounded-xl"
      >
        <WidgetHeader
          icon={<CalendarDays className="size-5" strokeWidth={2} />}
          title={t('dashboardWorkspace.calendar')}
          accentColor="#60a5fa"
          right={
            deskShowCalendar ? (
              <Link
                to="/dashboard/calendar"
                className="text-[12px] font-normal uppercase tracking-wide text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)]"
              >{t('dashboardWorkspace.fullCalendar')}</Link>
            ) : null
          }
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1.5 sm:px-2.5 sm:py-2">
          {deskShowCalendar ? (
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)]/50 px-2 py-1.5 sm:px-2.5 sm:py-2">
                <MiniCalendar
                  variant="workspace"
                  hideFooterLink
                  hideDayPanel
                  selectedDate={workspaceCalDate}
                  onSelectedDateChange={setWorkspaceCalDate}
                  onTodayReactivate={() => setTodayTasksOverlayOpen((o) => !o)}
                />
              </div>
              <div className="mt-0 flex shrink-0 items-center gap-1.5">
                <WorkspaceDayEventsMenu
                  className="min-w-0 flex-1"
                  dateIso={workspaceCalDate}
                  open={workspaceEventsOpen}
                  onOpenChange={setWorkspaceEventsOpen}
                />
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-[color:var(--workspace-text-muted)] sm:text-[12px]">
                  <span className="flex items-center gap-0.5">
                    <Eye className="size-3.5 text-blue-300" />{t('dashboardWorkspace.showing')}</span>
                  <span className="flex items-center gap-0.5">
                    <Phone className="size-3.5 text-violet-300" />{t('dashboardWorkspace.call')}</span>
                  <span className="flex items-center gap-0.5">
                    <Users className="size-3.5 text-[color:var(--workspace-cal-meeting-dot)]" />{t('dashboardWorkspace.meeting')}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)]/40 px-4 py-6 text-center">
              <p className="text-[13px] leading-relaxed text-[color:var(--workspace-text-muted)]">{t('dashboardWorkspace.calendarUnavailable')}</p>
            </div>
          )}
        </div>
      </HubWidgetShell>

      <div className="relative min-h-0">
      {/* ╔══════════════════════════════════════════╗
         ║  4. ПЛАНЫ + СТРИК (нижняя половина центра)  ║
         ╚══════════════════════════════════════════╝ */}
      <HubWidgetShell
        dataTestId="workspace-today-widget"
        accent="rgba(251,146,60,0.6)"
        className="flex h-full min-h-0 flex-col rounded-xl"
      >
        <WidgetHeader
          icon={<Zap className="size-5" strokeWidth={2} />}
          title={t('dashboardWorkspace.myFocusToday')}
          accentColor="#fb923c"
          right={
            canOpenMyReport && (
              <Link to="/dashboard/my-report" className={DESK_HEADER_LINK_CLASS}>{t('dashboardWorkspace.myReport')}</Link>
            )
          }
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-normal text-[color:var(--workspace-text)] sm:text-[14px]">
                  {progress.hasPlan
                    ? t('dashboardWorkspace.dayPlanPct').replace('{{pct}}', progress.dayPlanPercent.toString())
                    : t('planProgress.noPlan')}
                </span>
                {progress.hasPlan && dayPlanGapPct <= 0 && <CheckCircle2 className="size-3.5 text-emerald-400" />}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--workspace-row-bg)]">
                <div
                  className="h-full bg-emerald-500/80 transition-all"
                  style={{ width: `${100 - dayPlanGapPct}%` }}
                />
              </div>
            </div>
            {canAccessTeamPlans && (
              <button
                type="button"
                onClick={() => setShowSetPlans(true)}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-card-bg)] px-2 py-1 text-[11px] font-normal uppercase tracking-wide text-[color:var(--workspace-text-dim)] shadow-sm transition-colors hover:border-[color:color-mix(in_srgb,var(--gold)_40%,transparent)] hover:text-[color:var(--workspace-text)] sm:px-2.5 sm:py-1.5 sm:text-[12px]"
              >{t('dashboardWorkspace.ropPlans')}</button>
            )}
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              {todayActionItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] p-2.5 sm:p-3"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-normal uppercase tracking-wide text-[color:var(--workspace-text-dim)] sm:text-[12px]">
                      {item.title}
                    </span>
                    {item.badge && (
                      <span className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-normal leading-none",
                        item.tone === 'danger'
                          ? "bg-red-500/15 text-[color:var(--badge-danger-text)]"
                          : item.tone === 'warning'
                            ? "bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-[color:var(--gold)]"
                            : "bg-emerald-500/15 text-[color:var(--badge-success-text)]"
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span
                      className="text-[20px] font-normal leading-none sm:text-[24px]"
                      style={{ color: item.color }}
                    >
                      {item.current}
                    </span>
                    {item.plan > 0 && (
                      <span className="text-[13px] font-normal text-[color:var(--workspace-text-muted)] sm:text-[14px]">
                        / {item.plan} {item.unit}
                      </span>
                    )}
                  </div>
                  {item.href && (
                    <Link
                      to={item.href}
                      className="mt-2.5 self-start text-[11px] font-normal text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)] hover:underline"
                    >{t('dashboardWorkspace.open')}</Link>
                  )}
                </div>
              ))}
            </div>

            {/* Фокус/Рекомендация */}
            <div className="mt-auto rounded-lg border border-dashed border-[color:var(--workspace-row-border)] bg-[color-mix(in_srgb,var(--gold)_4%,transparent)] p-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--gold)_20%,transparent)]">
                  <Target className="size-3 text-[color:var(--gold)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-normal uppercase tracking-wide text-[color:var(--workspace-text-muted)] sm:text-[13px]">{t('dashboardWorkspace.recommendation')}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-[color:var(--workspace-text)] sm:text-[14px]">
                    {!progress.hasPlan
                      ? t(canAccessTeamPlans ? 'planProgress.noPlanHintTeam' : 'planProgress.noPlanHintSelf')
                      : focusGap > 0 && focusKpi
                      ? t('dashboardWorkspace.needMoreToPlan').replace('{{gap}}', focusGap.toString()).replace('{{label}}', focusKpi.label)
                      : t('dashboardWorkspace.allMetricsNormal')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </HubWidgetShell>

      {/* Оверлей дел (WorkspaceDayEventsPanel) */}
      {todayTasksOverlayOpen && (
        <div className="absolute inset-x-0 bottom-0 z-10 p-0.5 sm:p-1">
          <WorkspaceDayEventsPanel
            dateIso={workspaceCalDate}
          />
        </div>
      )}
      </div>
      </div>

      {/* ╔══════════════════════════════════════════╗
         ║  3. УВЕДОМЛЕНИЯ / НАПОМИНАНИЯ / НОВОСТИ  ║
         ╚══════════════════════════════════════════╝ */}
      <HubWidgetShell accent="rgba(52,211,153,0.5)" className="order-1 flex h-full min-h-0 flex-col rounded-xl lg:order-1">
        <div className="flex shrink-0 flex-col gap-2 border-b border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)]/30 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9"
              style={{
                background: 'color-mix(in srgb, #34d399 12%, transparent)',
                color: '#34d399',
              }}
            >
              <Bell className="size-5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[14px] font-normal leading-none tracking-tight text-[color:var(--workspace-widget-title)] sm:text-[15px]">{t('dashboardWorkspace.infoCenter')}</h3>
              <p className="mt-1 truncate text-[11px] font-normal text-[color:var(--workspace-text-muted)] sm:text-[12px]">{t('dashboardWorkspace.eventFeedAndNews')}</p>
            </div>
          </div>

          <div
            className="flex gap-1 rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] p-1"
            role="tablist"
            aria-label={t('dashboardWorkspace.feedSections')}
          >
            <InfoTabBtn active={infoTab === 'notifs'} badge={badgeNotifs} onClick={() => openInfoTab('notifs')}>{t('dashboardWorkspace.notifications')}</InfoTabBtn>
            <InfoTabBtn active={infoTab === 'reminders'} badge={badgeReminders} onClick={() => openInfoTab('reminders')}>{t('dashboardWorkspace.reminders')}</InfoTabBtn>
            <InfoTabBtn active={infoTab === 'news'} badge={badgeNews} onClick={() => openInfoTab('news')}>{t('dashboardWorkspace.news')}</InfoTabBtn>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-3.5">
          {isCrmLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="size-6 animate-spin rounded-full border-2 border-[color:var(--gold)] border-t-transparent" />
            </div>
          ) : infoTab === 'notifs' ? (
            <>
              {deskShowInfo ? (
                <Link
                  to="/dashboard/settings/info"
                  className="mb-0.5 shrink-0 self-start text-[12px] font-normal uppercase tracking-wide text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)] sm:text-[13px]"
                >{t('dashboardWorkspace.allNotifications')}</Link>
              ) : null}
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-hidden">
                {visibleNotifications.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-[color:var(--workspace-row-border)] px-3 py-4 text-center text-[13px] text-[color:var(--workspace-text-muted)]">{t('dashboardWorkspace.noNotifications')}</li>
                ) : null}
                {visibleNotifications.slice(0, NOTIFS_PREVIEW).map((n) => (
                  <li key={n.id} className={cn(FEED_ITEM_CLASS, 'group relative pr-1')}>
                    <span className="mt-0.5 shrink-0">{notifIcon(n.type)}</span>
                    <div className={cn(FEED_STACK_CLASS, 'min-w-0 pr-[4.5rem]')}>
                      <p className={FEED_TITLE_CLASS}>{n.title}</p>
                      <p className={FEED_BODY_CLASS}>{n.body}</p>
                      <p className={FEED_META_CLASS}>{n.time}</p>
                    </div>
                    <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        title={t('dashboardWorkspace.done')}
                        aria-label={t('dashboardWorkspace.done')}
                        className={cn(feedHoverActionBtnClass, 'hover:border-emerald-500/35 hover:text-emerald-300')}
                        onClick={() => removeNotification(n.id)}
                      >
                        <Check className="size-3.5" strokeWidth={2.25} />
                      </button>
                      <button
                        type="button"
                        title={t('dashboardWorkspace.delete')}
                        aria-label={t('dashboardWorkspace.delete')}
                        className={cn(feedHoverActionBtnClass, 'hover:border-red-500/35 hover:text-red-300')}
                        onClick={() => removeNotification(n.id)}
                      >
                        <X className="size-3.5" strokeWidth={2.25} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : infoTab === 'reminders' ? (
            <>
              {deskShowInfo ? (
                <Link
                  to="/dashboard/settings/info/reminders"
                  className="mb-0.5 shrink-0 self-start text-[12px] font-normal uppercase tracking-wide text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)] sm:text-[13px]"
                >{t('dashboardWorkspace.allReminders')}</Link>
              ) : null}
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-hidden">
                {remindersPreview.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-[color:var(--workspace-row-border)] px-3 py-4 text-center text-[13px] text-[color:var(--workspace-text-muted)]">{t('dashboardWorkspace.noActiveReminders')}</li>
                ) : null}
                {remindersPreview.map((r) => (
                  <li key={r.id} className={cn(FEED_ITEM_CLASS, 'group relative pr-1')}>
                    <span className="mt-0.5 shrink-0">
                      <Clock className="size-3.5 text-[color:var(--workspace-text-dim)]" />
                    </span>
                    <div className={cn(FEED_STACK_CLASS, 'min-w-0 pr-[4.5rem]')}>
                      <p className={FEED_TITLE_CLASS}>{r.title}</p>
                      {r.body ? <p className={FEED_BODY_CLASS}>{r.body}</p> : null}
                      <p className={FEED_META_CLASS}>
                        {formatReminderDue(r.dueAt)}{r.entityLabel ? ` · ${r.entityLabel}` : ''}
                      </p>
                    </div>
                    <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        title={t('dashboardWorkspace.reschedule')}
                        aria-label={t('dashboardWorkspace.reschedule')}
                        className={feedHoverActionBtnClass}
                        onClick={() => setRescheduleReminder(r)}
                      >
                        <CalendarClock className="size-3.5" strokeWidth={2.25} />
                      </button>
                      <button
                        type="button"
                        title={t('dashboardWorkspace.toArchive')}
                        aria-label={t('dashboardWorkspace.toArchive')}
                        className={feedHoverActionBtnClass}
                        onClick={() => archiveReminder(r.id)}
                      >
                        <Archive className="size-3.5" strokeWidth={2.25} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {deskShowInfo ? (
                <Link
                  to="/dashboard/settings/info/news"
                  className="mb-0.5 shrink-0 self-start text-[12px] font-normal uppercase tracking-wide text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)] sm:text-[13px]"
                >{t('dashboardWorkspace.allNews')}</Link>
              ) : null}
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-hidden">
                {newsPreview.map((a) => (
                  <li
                    key={a.id}
                    className={cn(FEED_ITEM_CLASS, 'cursor-pointer hover:border-[color:color-mix(in_srgb,var(--gold)_40%,transparent)] hover:bg-[rgba(255,255,255,0.04)]')}
                    onClick={() => setSelectedNews(a)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedNews(a) }}
                  >
                    <span className="mt-0.5 shrink-0">
                      <span className="flex size-3.5 items-center justify-center text-[12px] leading-none sm:text-[13px]">
                        {newsEmoji(a.category)}
                      </span>
                    </span>
                    <div className={FEED_STACK_CLASS}>
                      <p className={FEED_TITLE_CLASS}>{a.title}</p>
                      <p className={FEED_BODY_CLASS}>{a.body}</p>
                      <p className={FEED_META_CLASS}>
                        {new Date(a.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · {newsAuthor(a, t('news.company'))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </HubWidgetShell>
      </div>
      )}

      {activeScreen === 2 && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScreenTwo
            role={deskRole}
            accountType={currentUser?.accountType}
            leads={pool}
            allLeads={state.leadPool}
            deals={deals}
            progress={progress}
          />
        </div>
      )}

      {selectedNews && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setSelectedNews(null) }}>
          <DialogContent
            showCloseButton
            className="max-h-[min(90vh,40rem)] max-w-lg overflow-hidden rounded-xl border border-[color:var(--workspace-row-border)] bg-[var(--workspace-card-bg)] p-0 shadow-[0_24px_64px_rgba(0,0,0,0.55)] sm:max-w-2xl"
          >
            {selectedNews.imageUrl ? (
              <div className="max-h-48 w-full overflow-hidden">
                <img src={selectedNews.imageUrl} alt="" className="h-48 w-full object-cover" />
              </div>
            ) : null}
            <div className="flex items-start gap-3 border-b border-[color:var(--workspace-row-border)] px-5 py-4 pr-14">
              <span className="mt-0.5 text-2xl leading-none">{newsEmoji(selectedNews.category)}</span>
              <div className="min-w-0 flex-1">
                <DialogHeader>
                  <DialogTitle className="text-[15px] font-normal leading-snug tracking-tight text-[color:var(--workspace-widget-title)] sm:text-base">
                    {selectedNews.title}
                  </DialogTitle>
                </DialogHeader>
                <p className="mt-1 text-[11px] font-normal text-[color:var(--workspace-text-muted)]">
                  {new Date(selectedNews.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {' · '}{newsAuthor(selectedNews, t('news.company'))}
                </p>
              </div>
            </div>
            <div className="max-h-[min(52vh,24rem)] overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-[14px] font-normal leading-relaxed text-[color:var(--workspace-text)]">
                {selectedNews.body}
              </p>
              {selectedNews.linkUrl && (
                <a
                  href={selectedNews.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-[13px] font-normal text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--theme-accent-link)] hover:underline"
                >
                  {selectedNews.linkLabel ?? t('dashboardWorkspace.details')}
                </a>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={rescheduleReminder != null} onOpenChange={(open) => { if (!open) setRescheduleReminder(null) }}>
        <DialogContent
          showCloseButton
          className="max-w-md gap-0 overflow-hidden rounded-xl border border-[color:var(--workspace-row-border)] bg-[var(--workspace-card-bg)] p-0 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
        >
          <div className="border-b border-[color:var(--workspace-row-border)] px-5 py-4 pr-14">
            <DialogHeader>
              <DialogTitle className="text-[15px] font-normal text-[color:var(--workspace-widget-title)]">{t('dashboardWorkspace.reschedule')}</DialogTitle>
            </DialogHeader>
            {rescheduleReminder ? (
              <p className="mt-2 text-[13px] leading-snug text-[color:var(--workspace-text-muted)]">
                {rescheduleReminder.title}
              </p>
            ) : null}
          </div>
          <div className="space-y-3 px-5 py-4">
            <label className="block space-y-1.5">
              <span className="text-[12px] font-normal text-[color:var(--workspace-text-dim)]">{t('dashboardWorkspace.dateAndTime')}</span>
              <input
                type="datetime-local"
                value={rescheduleDraft}
                onChange={(e) => setRescheduleDraft(e.target.value)}
                className="w-full rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2 text-[14px] font-normal text-[color:var(--workspace-text)] outline-none focus:border-[color:color-mix(in_srgb,var(--gold)_45%,transparent)]"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setRescheduleReminder(null)}>{t('dashboardWorkspace.cancel')}</Button>
              <Button type="button" size="sm" className="bg-[var(--gold)] text-[color:var(--gold-btn-text)] hover:brightness-105" onClick={applyReschedule}>{t('dashboardWorkspace.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SetPlansModal open={showSetPlans} onOpenChange={setShowSetPlans} onSaved={reloadPlanProgress} />
    </div>
  )
}
