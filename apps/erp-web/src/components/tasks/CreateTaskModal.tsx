import { useEffect, useMemo, useState, useId } from 'react'
import { Briefcase, MapPin, Paperclip, Plus, ListTodo } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EisenhowerChips } from '@/components/shared/EisenhowerChips'
import { useAuth } from '@/context/AuthContext'
import { MediaUploadError, mediaApiV2 } from '@/services/mediaApiV2'
import { useLeads } from '@/context/LeadsContext'
import { cn } from '@/lib/utils'
import type { Task, TaskPriority, TaskSubtask } from '@/types/tasks'
import { useI18n } from "@/i18n";

const TITLE_MAX = 48

const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 24 * 60, label: 'За 24 часа' },
  { minutes: 6 * 60, label: 'За 6 часов' },
  { minutes: 60, label: 'За 1 час' },
  { minutes: 30, label: 'За 30 минут' },
  { minutes: 15, label: 'За 15 минут' },
]

const COLOR_PRESETS: (string | null)[] = [
  '#60a5fa',
  '#a78bfa',
  '#4ade80',
  '#fbbf24',
  '#f87171',
  'var(--gold)',
  null,
]

function timeSlots(): string[] {
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
}

const TIME_OPTIONS = timeSlots()

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

function eisenhowerToPriority(urgent: boolean, important: boolean): TaskPriority {
  if (urgent && important) return 'critical'
  if (urgent) return 'high'
  if (important) return 'medium'
  return 'low'
}

function eisenhowerLabel(urgent: boolean, important: boolean): string {
  if (urgent && important) return 'Срочно и важно'
  if (urgent) return 'Срочно, не важно'
  if (important) return 'Важно, не срочно'
  return 'Не срочно и не важно'
}

function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0]
}

export interface TaskAssigneeOption {
  /** positionId позиции в организации — именно его ждёт сервер, не id человека. */
  id: string
  name: string
}

export function CreateTaskModal({
  open,
  onOpenChange,
  onCreate,
  assignees,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Сохранение задачи. Асинхронное и может отказать: модалка закрывается
   * только после успеха, иначе пользователь считал бы несозданную задачу
   * созданной.
   */
  onCreate: (task: Task) => void | Promise<void>
  /** Живой состав команды (позиции организации). Пустой список — исполнителя выбрать не из кого. */
  assignees: TaskAssigneeOption[]
}) {
    const { t } = useI18n();
  const formId = useId()
  const { currentUser } = useAuth()
  const { state: leadsState } = useLeads()

  const [title, setTitle] = useState('')
  const [leadQuery, setLeadQuery] = useState('')
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [assigneeId, setAssigneeId] = useState('')
  const [description, setDescription] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [important, setImportant] = useState(true)
  const [category, setCategory] = useState<'work' | 'personal'>('work')
  const [colorHex, setColorHex] = useState<string | null>(null)
  const [reminders, setReminders] = useState<number[]>([60, 15])
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('19:00')
  const [subtaskDrafts, setSubtaskDrafts] = useState<string[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  // Файлы, а не имена: до 02.09.2026 форма выбрасывала тела и отправляла
  // строки — «демо, без загрузки», как честно называл это легаси-тип.
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setLeadQuery('')
    setSelectedLeadId(null)
    setAssigneeId('')
    setDescription('')
    setUrgent(false)
    setImportant(true)
    setCategory('work')
    setColorHex(null)
    setReminders([60, 15])
    const today = todayIsoDate()
    setStartDate(today)
    setStartTime('09:00')
    setEndDate(today)
    setEndTime('19:00')
    setSubtaskDrafts([])
    setNewSubtask('')
    setAttachmentFiles([])
    setError(null)
    setSubmitting(false)
  }, [open, currentUser?.id])

  const selectedLead = useMemo(
    () => (selectedLeadId ? leadsState.leadPool.find(l => l.id === selectedLeadId) ?? null : null),
    [selectedLeadId, leadsState.leadPool],
  )

  /**
   * Исполнители — живой состав команды из Platform API, переданный страницей.
   * Раньше список собирался из менеджеров старой CRM и дополнялся выдуманным
   * `lm-1`, если текущего пользователя там не было: выбранный «исполнитель»
   * мог не существовать ни в одной организации.
   */
  const assigneeOptions = assignees

  /**
   * Исполнитель по умолчанию — сам пользователь, и только если его позиция
   * действительно есть в составе команды. Вычисляется, а не проставляется
   * эффектом: состав приходит с сервера асинхронно, и запись в состояние
   * затирала бы уже сделанный выбор.
   */
  const effectiveAssigneeId = useMemo(() => {
    if (assigneeId) return assigneeId
    const myPositionId = currentUser?.positionId
    if (myPositionId && assigneeOptions.some(option => option.id === myPositionId)) {
      return myPositionId
    }
    return ''
  }, [assigneeId, assigneeOptions, currentUser?.positionId])

  const selectedAssignee = useMemo(
    () => assigneeOptions.find(option => option.id === effectiveAssigneeId) ?? null,
    [effectiveAssigneeId, assigneeOptions],
  )

  const canSubmit =
    title.trim().length > 0 &&
    title.trim().length <= TITLE_MAX &&
    Boolean(startDate) &&
    Boolean(endDate) &&
    Boolean(effectiveAssigneeId) &&
    !submitting

  const leadSuggestions = useMemo(() => {
    const q = leadQuery.trim().toLowerCase()
    const d = digitsOnly(leadQuery)
    if (!q && !d) return leadsState.leadPool.slice(0, 8)
    return leadsState.leadPool.filter(lead => {
      const name = (lead.name ?? '').toLowerCase()
      const id = lead.id.toLowerCase()
      const phoneDigits = digitsOnly(lead.phone ?? '')
      if (q && (name.includes(q) || id.includes(q))) return true
      if (d.length >= 2 && (phoneDigits.includes(d) || id.replace(/\D/g, '').includes(d))) return true
      return false
    }).slice(0, 12)
  }, [leadQuery, leadsState.leadPool])

  function toggleReminder(minutes: number) {
    setReminders(prev =>
      prev.includes(minutes) ? prev.filter(x => x !== minutes) : [...prev, minutes].sort((a, b) => b - a),
    )
  }

  function addSubtaskLine() {
    const t = newSubtask.trim()
    if (!t) return
    setSubtaskDrafts(prev => [...prev, t])
    setNewSubtask('')
  }

  function onFilesPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    setAttachmentFiles(Array.from(files).slice(0, 10))
    e.target.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    const t = title.trim()
    if (!t) {
      setError('Укажите заголовок')
      return
    }
    if (t.length > TITLE_MAX) {
      setError(`Заголовок не длиннее ${TITLE_MAX} символов`)
      return
    }
    if (!startDate) {
      setError('Укажите дату начала')
      return
    }
    if (!endDate.trim()) {
      setError('Укажите срок окончания')
      return
    }
    if (!effectiveAssigneeId || !selectedAssignee) {
      setError('Выберите исполнителя')
      return
    }

    const endD = endDate.trim()
    const endT = endTime || startTime
    const priority = eisenhowerToPriority(urgent, important)

    const subtasks: TaskSubtask[] | undefined =
      subtaskDrafts.length > 0
        ? subtaskDrafts.map((text, i) => ({
            id: `st-${Date.now()}-${i}`,
            title: text,
            done: false,
          }))
        : undefined

    const uname = currentUser?.name ?? 'Пользователь'

    let entityType: Task['entityType'] = 'none'
    let entityId: string | undefined
    let entityLabel: string | undefined
    if (selectedLead) {
      entityType = 'lead'
      entityId = selectedLead.id
      entityLabel = `Лид ${selectedLead.id}${selectedLead.name ? ` (${selectedLead.name})` : ''}`
    }

    const row: Task = {
      id: `task-${Date.now()}`,
      title: t,
      description: description.trim() || undefined,
      status: 'pending',
      priority,
      assignedToId: selectedAssignee.id,
      assignedToName: selectedAssignee.name,
      createdByName: uname,
      dueDate: endD,
      dueTime: endT,
      startDate,
      startTime,
      taskCategory: category,
      colorHex: colorHex ?? undefined,
      reminderOffsetsMinutes: reminders.length ? reminders : undefined,
      subtasks,
      attachmentFileNames: attachmentFiles.length ? attachmentFiles.map(file => file.name) : undefined,
      entityType,
      entityId,
      entityLabel,
      isAutomatic: false,
      createdAt: todayIsoDate(),
    }

    setSubmitting(true)
    setError(null)
    try {
      // Файлы уходят в хранилище до создания задачи: задача ссылается на
      // подтверждённые asset'ы, и сервер отклонит ссылку на файл, которого
      // нет. Сбой любого файла — отказ формы, а не задача «с вложением»,
      // которого не существует.
      const attachments: Array<{ assetId: string; fileName: string }> = []
      for (const file of attachmentFiles) {
        const { assetId } = await mediaApiV2.uploadFile(file, 'task_attachment')
        attachments.push({ assetId, fileName: file.name })
      }
      await onCreate({ ...row, attachments })
      onOpenChange(false)
    } catch (createError) {
      // Отказ сервера остаётся на экране: закрыть модалку значило бы показать
      // пользователю, что задача создана, когда её нет.
      if (createError instanceof MediaUploadError) {
        setError(`Файл «${createError.fileName}» не загружен: ${createError.message}. Задача не создана.`)
      } else {
        setError(createError instanceof Error ? createError.message : 'Задача не создана')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#f5f5f5]">
            <ListTodo className="h-5 w-5 text-[color:var(--theme-accent-heading)]" />
            {t('tasks.createTaskModal.новая_задача')}</DialogTitle>
          <DialogDescription className="text-[color:var(--app-text-muted)]">
            {t('tasks.createTaskModal.заполните_поля_и_сох')}</DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={handleSubmit} className="grid gap-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="task-title" className="text-[color:var(--app-text)]">
              {t('tasks.createTaskModal.заголовок')}<span className="text-rose-400">*</span>
            </Label>
            <Input
              id="task-title"
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, TITLE_MAX))}
              placeholder={t('tasks.createTaskModal.заголовок')}
              className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]"
              maxLength={TITLE_MAX}
            />
            <div className="text-right text-[10px] text-[color:var(--app-text-subtle)]">
              {title.length}/{TITLE_MAX}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[color:var(--app-text)]">{t('tasks.createTaskModal.поиск_лида')}</Label>
            <Input
              value={leadQuery}
              onChange={e => {
                setLeadQuery(e.target.value)
                setSelectedLeadId(null)
              }}
              placeholder={t('tasks.createTaskModal.поиск_лида_по_имени')}
              className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]"
              disabled={!!selectedLead}
            />
            {selectedLead && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[var(--green-deep)] px-2 py-1.5 text-xs">
                <span className="text-[color:var(--theme-accent-heading)]">
                  {selectedLead.name ?? 'Без имени'} · {selectedLead.id}
                </span>
                <button
                  type="button"
                  className="ml-auto text-[color:var(--app-text)]/55 underline hover:text-[color:var(--app-text)]"
                  onClick={() => {
                    setSelectedLeadId(null)
                    setLeadQuery('')
                  }}
                >
                  {t('tasks.createTaskModal.сбросить')}</button>
              </div>
            )}
            {!selectedLead && leadQuery.trim().length > 0 && leadSuggestions.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg border border-[var(--green-border)] bg-[var(--green-deep)] text-xs">
                {leadSuggestions.map(lead => (
                  <li key={lead.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-white/5"
                      onClick={() => {
                        setSelectedLeadId(lead.id)
                        setLeadQuery('')
                      }}
                    >
                      <span className="font-medium text-[color:var(--app-text)]">{lead.name ?? 'Без имени'}</span>
                      <span className="text-[color:var(--app-text)]/50">
                        {lead.id}{lead.phone ? ` · ${lead.phone}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[color:var(--app-text)]">
              {t('tasks.createTaskModal.исполнитель')}<span className="text-rose-400">*</span>
            </Label>
            <Select value={effectiveAssigneeId || undefined} onValueChange={setAssigneeId}>
              <SelectTrigger className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]">
                <SelectValue placeholder={t('tasks.createTaskModal.выберите_исполнителя')} />
              </SelectTrigger>
              <SelectContent className="max-h-72 border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)]">
                {assigneeOptions.map(assignee => (
                  <SelectItem key={assignee.id} value={assignee.id} className="focus:bg-white/10">
                    {assignee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLead && (
              <p className="text-base text-[color:var(--app-text)]/80">
                {t('tasks.createTaskModal.задача_сохранится_бе')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc" className="text-[color:var(--app-text)]">
              {t('tasks.createTaskModal.описание')}</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('tasks.createTaskModal.введите_описание_зад')}
              rows={4}
              className="resize-y border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]"
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-[color:var(--app-text)]">{t('tasks.createTaskModal.срочность_и_важность')}</span>
            <EisenhowerChips
              variant="dark"
              urgent={urgent}
              important={important}
              onChangeUrgent={setUrgent}
              onChangeImportant={setImportant}
            />
            <p className="text-[11px] text-[color:var(--app-text-muted)]">
              {t('tasks.createTaskModal.квадрант_эйзенхауэра')}{' '}
              <span className="font-normal text-[color:var(--theme-accent-heading)]">
                {eisenhowerLabel(urgent, important)}
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-[color:var(--app-text)]">{t('tasks.createTaskModal.категория_задачи')}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCategory('work')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-normal transition-colors',
                  category === 'work'
                    ? 'border-[#4ade80]/45 bg-[#4ade80]/12 text-[#86efac]'
                    : 'border-white/10 bg-transparent text-[color:var(--app-text)]/60 hover:bg-white/5',
                )}
              >
                <Briefcase className="h-3.5 w-3.5" />
                {t('tasks.createTaskModal.рабочая')}</button>
              <button
                type="button"
                onClick={() => setCategory('personal')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-normal transition-colors',
                  category === 'personal'
                    ? 'border-[color:var(--gold)]/45 bg-[var(--gold)]/12 text-[color:var(--theme-accent-heading)]'
                    : 'border-white/10 bg-transparent text-[color:var(--app-text)]/60 hover:bg-white/5',
                )}
              >
                <MapPin className="h-3.5 w-3.5" />
                {t('tasks.createTaskModal.личная')}</button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-[color:var(--app-text)]">{t('tasks.createTaskModal.цветовая_метка')}</span>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_PRESETS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  title={c ?? 'Без цвета'}
                  onClick={() => setColorHex(c)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors',
                    colorHex === c ? 'border-[color:var(--gold)]' : 'border-white/15',
                  )}
                  style={c ? { backgroundColor: c } : undefined}
                >
                  {!c && <span className="text-[10px] text-[color:var(--app-text)]/40">∅</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-[color:var(--app-text)]">{t('tasks.createTaskModal.напоминания')}</span>
            <div className="flex flex-wrap gap-2">
              {REMINDER_PRESETS.map(({ minutes, label }) => {
                const on = reminders.includes(minutes)
                return (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => toggleReminder(minutes)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-[11px] font-normal transition-colors',
                      on
                        ? 'border-[color:var(--gold)]/50 bg-[var(--gold)]/15 text-[color:var(--theme-accent-heading)]'
                        : 'border-white/10 bg-[var(--green-deep)] text-[color:var(--app-text)]/65 hover:bg-white/5',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[color:var(--app-text)]">
                {t('tasks.createTaskModal.срок_начала')}<span className="text-rose-400">*</span>
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]"
              />
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]">
                  <SelectValue placeholder={t('tasks.createTaskModal.время')} />
                </SelectTrigger>
                <SelectContent className="max-h-[min(280px,45vh)] border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)]">
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={t} value={t} className="focus:bg-white/10">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[color:var(--app-text)]">
                {t('tasks.createTaskModal.срок_окончания')}<span className="text-rose-400">*</span>
              </Label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]"
              />
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]">
                  <SelectValue placeholder={t('tasks.createTaskModal.время')} />
                </SelectTrigger>
                <SelectContent className="max-h-[min(280px,45vh)] border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)]">
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={`e-${t}`} value={t} className="focus:bg-white/10">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className="text-xs font-normal text-[color:var(--theme-accent-heading)] hover:underline"
              onClick={addSubtaskLine}
            >
              {t('tasks.createTaskModal.добавить_подзадачу')}</button>
            {subtaskDrafts.length > 0 && (
              <ul className="space-y-1 text-xs text-[color:var(--app-text)]">
                {subtaskDrafts.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 rounded border border-white/10 bg-[var(--green-deep)] px-2 py-1">
                    <span className="flex-1">{s}</span>
                    <button
                      type="button"
                      className="text-rose-400/80 hover:text-rose-400"
                      onClick={() => setSubtaskDrafts(prev => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Input
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSubtaskLine()
                }
              }}
              placeholder={t('tasks.createTaskModal.текст_подзадачи_ente')}
              className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]"
            />
          </div>

          <div className="space-y-1.5">
            <input id={`${formId}-files`} type="file" multiple className="sr-only" onChange={onFilesPick} />
            <label
              htmlFor={`${formId}-files`}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--green-border)] bg-[var(--green-deep)] px-3 py-2 text-xs font-medium text-[color:var(--app-text)] hover:bg-white/5"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {t('tasks.createTaskModal.прикрепить_файлы_мак')}</label>
            {attachmentFiles.length > 0 && (
              <p className="text-base text-[color:var(--app-text)]/80">{t('tasks.createTaskModal.выбрано')}{attachmentFiles.map(file => file.name).join(', ')}</p>
            )}
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </form>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[var(--green-border)] bg-transparent text-[color:var(--app-text)]"
          >
            {t('tasks.createTaskModal.отмена')}</Button>
          <Button
            type="submit"
            form={formId}
            disabled={!canSubmit}
            className="bg-[var(--gold-dark)] text-[#3d2e00] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[rgba(120,98,42,0.45)] disabled:text-[#d9c58b]/45"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t('tasks.createTaskModal.отправить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
