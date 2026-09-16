import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlarmClock, Briefcase, Check, Plus, RotateCcw, Trash2, UserRound } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { calendarApiV2, newIdempotencyKey, type CalendarEventV2 } from '@/services/calendarApiV2'
import {
  fromDateTimeLocal,
  isOpenReminder,
  matchesDue,
  matchesLink,
  matchesTab,
  reminderEndTime,
  reminderState,
  reminderWindow,
  sortReminders,
  toDateTimeLocal,
  type ReminderDueFilter,
  type ReminderLinkFilter,
  type ReminderState,
  type ReminderTab,
} from '@/lib/reminders'
import { useI18n } from '@/i18n'

const MUTED = 'text-[color:var(--app-text-muted)]'
const FIELD =
  'h-10 rounded-sm bg-[var(--workspace-row-bg)] px-3 text-[16px] text-[color:var(--app-text)] outline-none'
const GOLD_BTN =
  'rounded-sm bg-[var(--gold)] px-3 py-1.5 text-[16px] font-medium text-[color:var(--gold-btn-text)] disabled:opacity-60'
const QUIET_BTN = `rounded-sm px-3 py-1.5 text-[16px] ${MUTED} hover:text-[color:var(--app-text)] disabled:opacity-60`

/** Через сколько минут после срока просроченное перестаёт быть «только что». */
const MINUTE = 60_000

/**
 * Экран напоминаний. Работает с событиями календаря типа `reminder` — тем же
 * источником, из которого напоминания видны на рабочем столе и в календаре.
 * Раньше показывал шесть вшитых примеров: отметки «выполнено» и добавленные
 * напоминания жили до перезагрузки страницы и никому, кроме этой вкладки, не
 * были видны.
 */
export function RemindersPage() {
  const { t, formatDate } = useI18n()
  const [events, setEvents] = useState<CalendarEventV2[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [rescheduleId, setRescheduleId] = useState<string | null>(null)
  const [rescheduleDraft, setRescheduleDraft] = useState('')

  const [tab, setTab] = useState<ReminderTab>('open')
  const [dueFilter, setDueFilter] = useState<ReminderDueFilter>('all')
  const [linkFilter, setLinkFilter] = useState<ReminderLinkFilter>('all')

  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Срок — величина относительная: без пересчёта «через 2 часа» висит на экране
  // весь день. Минуты хватает, чаще дёргать список незачем.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE)
    return () => clearInterval(timer)
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const { startDate, endDate } = reminderWindow(new Date())
      const response = await calendarApiV2.list({ startDate, endDate, type: 'reminder' })
      setEvents(response.items)
      setStatus('ready')
    } catch {
      setEvents([])
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Любой отказ сервера — отказ: список перечитывается, чтобы на экране не
   * осталась отметка, которой нет в базе. 409 значит, что напоминание уже
   * изменили в другом месте, и это отдельное сообщение, а не «ошибка».
   */
  const runAction = useCallback(
    async (id: string, action: () => Promise<void>) => {
      setBusyId(id)
      setActionError(null)
      try {
        await action()
      } catch (error) {
        const code = (error as { response?: { status?: number } }).response?.status
        setActionError(code === 409 ? t('reminders.conflict') : t('reminders.actionFailed'))
        await load()
      } finally {
        setBusyId(null)
      }
    },
    [load, t],
  )

  const setStatusOf = (event: CalendarEventV2, next: 'completed' | 'scheduled') =>
    runAction(event.id, async () => {
      const updated = await calendarApiV2.update(event.id, { expectedVersion: event.version, status: next })
      setEvents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    })

  const remove = (event: CalendarEventV2) =>
    runAction(event.id, async () => {
      await calendarApiV2.remove(event.id)
      setEvents((prev) => prev.filter((item) => item.id !== event.id))
      setConfirmDeleteId(null)
    })

  const reschedule = (event: CalendarEventV2) =>
    runAction(event.id, async () => {
      const newStartTime = fromDateTimeLocal(rescheduleDraft)
      const updated = await calendarApiV2.move(event.id, {
        expectedVersion: event.version,
        newStartTime,
        newEndTime: reminderEndTime(newStartTime),
      })
      setEvents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setRescheduleId(null)
    })

  const create = async () => {
    if (!newTitle.trim() || !newDue) return
    setSaving(true)
    setActionError(null)
    try {
      const startTime = fromDateTimeLocal(newDue)
      const created = await calendarApiV2.create(
        {
          title: newTitle.trim(),
          description: newNote.trim() || undefined,
          startTime,
          endTime: reminderEndTime(startTime),
          type: 'reminder',
        },
        newIdempotencyKey(),
      )
      setEvents((prev) => [...prev, created])
      setNewTitle('')
      setNewDue('')
      setNewNote('')
      setShowAdd(false)
    } catch {
      setActionError(t('reminders.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  const visible = useMemo(
    () =>
      sortReminders(
        events.filter((event) => {
          const state = reminderState(event, now)
          return matchesTab(state, tab) && matchesDue(event, state, dueFilter, now) && matchesLink(event, linkFilter)
        }),
        now,
      ),
    [dueFilter, events, linkFilter, now, tab],
  )

  const counts = useMemo(() => {
    const states = events.map((event) => reminderState(event, now))
    return {
      open: states.filter(isOpenReminder).length,
      overdue: states.filter((state) => state === 'overdue').length,
      today: states.filter((state) => state === 'today').length,
      done: states.filter((state) => state === 'done').length,
    }
  }, [events, now])

  const TABS: { key: ReminderTab; label: string }[] = [
    { key: 'open', label: t('reminders.tabs.open', { count: counts.open }) },
    { key: 'done', label: t('reminders.tabs.done') },
    { key: 'all', label: t('reminders.tabs.all') },
  ]

  return (
    <DashboardShell>
      <div className="flex w-full max-w-[960px] flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[30px] font-normal leading-tight text-[color:var(--theme-accent-heading)]">
              {t('reminders.title')}
            </h1>
            <p className={`mt-1 text-[17px] ${MUTED}`}>
              {counts.overdue > 0
                ? t('reminders.subtitleOverdue', { overdue: counts.overdue, open: counts.open })
                : t('reminders.subtitle', { open: counts.open })}
            </p>
          </div>
          <button type="button" onClick={() => setShowAdd((value) => !value)} className={GOLD_BTN}>
            <span className="flex items-center gap-2">
              <Plus className="size-4" aria-hidden /> {t('reminders.add')}
            </span>
          </button>
        </header>

        {showAdd ? (
          <section className="flex flex-col gap-3 rounded-md bg-[var(--hub-card-bg)] p-4">
            <input
              autoFocus
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={t('reminders.titlePlaceholder')}
              aria-label={t('reminders.titlePlaceholder')}
              className={FIELD}
            />
            <input
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              placeholder={t('reminders.notePlaceholder')}
              aria-label={t('reminders.notePlaceholder')}
              className={FIELD}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className={`flex items-center gap-2 text-[16px] ${MUTED}`}>
                {t('reminders.dueLabel')}
                <input
                  type="datetime-local"
                  value={newDue}
                  onChange={(event) => setNewDue(event.target.value)}
                  className={FIELD}
                />
              </label>
              <button type="button" onClick={() => void create()} disabled={!newTitle.trim() || !newDue || saving} className={GOLD_BTN}>
                {saving ? t('reminders.saving') : t('reminders.save')}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className={QUIET_BTN}>
                {t('reminders.cancel')}
              </button>
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-pressed={tab === item.key}
                className={`rounded-sm px-3 py-1.5 text-[16px] ${
                  tab === item.key
                    ? 'bg-[var(--gold)] font-medium text-[color:var(--gold-btn-text)]'
                    : `${MUTED} hover:text-[color:var(--app-text)]`
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <select
            value={dueFilter}
            onChange={(event) => setDueFilter(event.target.value as ReminderDueFilter)}
            aria-label={t('reminders.filters.dueLabel')}
            className={FIELD}
          >
            <option value="all">{t('reminders.filters.due.all')}</option>
            <option value="overdue">{t('reminders.filters.due.overdue')}</option>
            <option value="today">{t('reminders.filters.due.today')}</option>
            <option value="week">{t('reminders.filters.due.week')}</option>
          </select>
          <select
            value={linkFilter}
            onChange={(event) => setLinkFilter(event.target.value as ReminderLinkFilter)}
            aria-label={t('reminders.filters.linkLabel')}
            className={FIELD}
          >
            <option value="all">{t('reminders.filters.link.all')}</option>
            <option value="deal">{t('reminders.filters.link.deal')}</option>
            <option value="lead">{t('reminders.filters.link.lead')}</option>
            <option value="none">{t('reminders.filters.link.none')}</option>
          </select>
        </div>

        {actionError ? (
          <p role="alert" className="text-[17px] text-[#ffb4ab]">
            {actionError}
          </p>
        ) : null}

        {status === 'loading' ? <p className={`text-[17px] ${MUTED}`}>{t('common.loading')}</p> : null}
        {status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[17px] text-[#ffb4ab]">
            {t('reminders.loadFailed')}
            <button type="button" onClick={() => void load()} className={GOLD_BTN}>
              {t('reminders.retry')}
            </button>
          </div>
        ) : null}

        {status === 'ready' && visible.length === 0 ? (
          <p className={`text-[17px] ${MUTED}`}>{t('reminders.empty')}</p>
        ) : null}

        <section className="flex flex-col gap-2">
          {visible.map((event) => {
            const state = reminderState(event, now)
            const open = isOpenReminder(state)
            const busy = busyId === event.id
            return (
              <article key={event.id} className="flex flex-col gap-2 rounded-md bg-[var(--hub-card-bg)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[200px] flex-1">
                    <h2 className={`text-[17px] ${open ? '' : MUTED}`}>{event.title}</h2>
                    {event.description ? <p className={`mt-1 text-[16px] ${MUTED}`}>{event.description}</p> : null}
                    <p className="mt-2 flex flex-wrap items-center gap-3 text-[16px]">
                      <span className={state === 'overdue' ? 'text-[#ffb4ab]' : MUTED}>
                        <AlarmClock className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                        {formatDate(event.startTime, {
                          day: 'numeric',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className={stateTone(state)}>{t(`reminders.state.${state}`)}</span>
                      {event.dealId ? (
                        <span className={MUTED}>
                          <Briefcase className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                          {t('reminders.linkDeal')}
                        </span>
                      ) : null}
                      {event.leadId ? (
                        <span className={MUTED}>
                          <UserRound className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                          {t('reminders.linkLead')}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {open ? (
                      <button type="button" onClick={() => void setStatusOf(event, 'completed')} disabled={busy} className={GOLD_BTN}>
                        <span className="flex items-center gap-2">
                          <Check className="size-4" aria-hidden /> {t('reminders.actions.done')}
                        </span>
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setStatusOf(event, 'scheduled')} disabled={busy} className={QUIET_BTN}>
                        <span className="flex items-center gap-2">
                          <RotateCcw className="size-4" aria-hidden /> {t('reminders.actions.reopen')}
                        </span>
                      </button>
                    )}
                    {open ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRescheduleId(rescheduleId === event.id ? null : event.id)
                          setRescheduleDraft(toDateTimeLocal(event.startTime))
                        }}
                        disabled={busy}
                        className={QUIET_BTN}
                      >
                        {t('reminders.actions.reschedule')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(confirmDeleteId === event.id ? null : event.id)}
                      disabled={busy}
                      aria-label={t('reminders.actions.delete')}
                      className={QUIET_BTN}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>

                {rescheduleId === event.id ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="datetime-local"
                      value={rescheduleDraft}
                      onChange={(input) => setRescheduleDraft(input.target.value)}
                      aria-label={t('reminders.actions.reschedule')}
                      className={FIELD}
                    />
                    <button type="button" onClick={() => void reschedule(event)} disabled={!rescheduleDraft || busy} className={GOLD_BTN}>
                      {t('reminders.save')}
                    </button>
                    <button type="button" onClick={() => setRescheduleId(null)} className={QUIET_BTN}>
                      {t('reminders.cancel')}
                    </button>
                  </div>
                ) : null}

                {confirmDeleteId === event.id ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[16px]">{t('reminders.confirmDelete')}</span>
                    <button type="button" onClick={() => void remove(event)} disabled={busy} className={GOLD_BTN}>
                      {t('reminders.actions.delete')}
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)} className={QUIET_BTN}>
                      {t('reminders.cancel')}
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      </div>
    </DashboardShell>
  )
}

function stateTone(state: ReminderState): string {
  if (state === 'overdue') return 'text-[#ffb4ab]'
  if (state === 'today') return 'text-[color:var(--gold)]'
  return MUTED
}
