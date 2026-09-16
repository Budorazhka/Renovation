import type { CalendarEventV2 } from '@/services/calendarApiV2'

/**
 * Напоминание = событие календаря типа `reminder`. Отдельной сущности
 * «напоминание» на сервере нет и заводить её незачем: это событие с одним
 * моментом времени, и так оно видно и в календаре, и в напоминаниях на
 * рабочем столе — создал в одном месте, увидел во всех.
 */

/** Сколько минут занимает напоминание в календаре. Точка во времени, а не встреча. */
export const REMINDER_DURATION_MINUTES = 15

/** Назад — чтобы просроченное не исчезало; вперёд — чтобы были видны планы. */
export const REMINDER_WINDOW_DAYS_BACK = 60
export const REMINDER_WINDOW_DAYS_AHEAD = 180

/** Окно чтения календаря для экрана напоминаний. */
export function reminderWindow(now: Date): { startDate: string; endDate: string } {
  const start = new Date(now.getTime() - REMINDER_WINDOW_DAYS_BACK * 86_400_000)
  const end = new Date(now.getTime() + REMINDER_WINDOW_DAYS_AHEAD * 86_400_000)
  return { startDate: start.toISOString(), endDate: end.toISOString() }
}

/** Конец напоминания: серверу нужен endTime, для точки во времени он формальный. */
export function reminderEndTime(startIso: string, minutes = REMINDER_DURATION_MINUTES): string {
  return new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString()
}

export type ReminderState = 'overdue' | 'today' | 'upcoming' | 'done' | 'cancelled'

/**
 * Состояние напоминания. Просрочка — производная от времени и статуса, а не
 * отдельное поле: хранить её значило бы держать второй ответ на тот же вопрос.
 */
export function reminderState(event: CalendarEventV2, now: Date): ReminderState {
  if (event.status === 'completed') return 'done'
  if (event.status === 'cancelled' || event.status === 'no_show') return 'cancelled'
  const due = new Date(event.startTime)
  if (due.getTime() < now.getTime()) return 'overdue'
  return isSameLocalDay(due, now) ? 'today' : 'upcoming'
}

export function isOpenReminder(state: ReminderState): boolean {
  return state === 'overdue' || state === 'today' || state === 'upcoming'
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

export type ReminderTab = 'open' | 'done' | 'all'
export type ReminderDueFilter = 'all' | 'overdue' | 'today' | 'week'
export type ReminderLinkFilter = 'all' | 'deal' | 'lead' | 'none'

export function matchesTab(state: ReminderState, tab: ReminderTab): boolean {
  if (tab === 'all') return true
  if (tab === 'done') return state === 'done' || state === 'cancelled'
  return isOpenReminder(state)
}

export function matchesDue(event: CalendarEventV2, state: ReminderState, filter: ReminderDueFilter, now: Date): boolean {
  if (filter === 'all') return true
  if (filter === 'overdue') return state === 'overdue'
  if (filter === 'today') return state === 'today'
  const due = new Date(event.startTime).getTime()
  return due >= now.getTime() && due <= now.getTime() + 7 * 86_400_000
}

export function matchesLink(event: CalendarEventV2, filter: ReminderLinkFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'deal') return event.dealId !== null
  if (filter === 'lead') return event.leadId !== null
  return event.dealId === null && event.leadId === null
}

/**
 * Порядок: сначала открытые по возрастанию срока (просроченное — вверху, оно
 * раньше всех по времени), закрытые — в конце, свежие первыми.
 */
export function sortReminders(events: CalendarEventV2[], now: Date): CalendarEventV2[] {
  return [...events].sort((a, b) => {
    const openA = isOpenReminder(reminderState(a, now))
    const openB = isOpenReminder(reminderState(b, now))
    if (openA !== openB) return openA ? -1 : 1
    const diff = new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    return openA ? diff : -diff
  })
}

/** Значение для input[type=datetime-local] из ISO-момента. */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Обратный перевод: локальное время формы → ISO-момент для сервера. */
export function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString()
}
