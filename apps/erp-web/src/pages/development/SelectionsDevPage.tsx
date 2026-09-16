import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Check, ClipboardCopy, ExternalLink, Heart, HelpCircle,
  FileText, Layers, MessageSquarePlus, Plus, ThumbsDown, Trash2, User, X,
} from 'lucide-react'

import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { useCoreStore } from '@/store/useCoreStore'
import { openDevSelectionPdf } from '@/lib/dev-selection-pdf'
import { DEV_SELECTION_STATUS_LABELS, DEV_SELECTION_STATUS_COLORS, isNewbuildSelection } from '@/types/dev-selection'
import type { DevSelection } from '@/types/dev-selection'
import { SelectionCustomizationPanel } from '@/components/selections/SelectionCustomizationPanel'
import { DEV_CUSTOMIZATION_GROUPS, resolveDevCustomization } from '@/config/dev-selection-customization'
import { buildSelectionShareHash, buildSelectionShareUrl } from '@/lib/selection-share'
import { useTheme } from '@/context/ThemeContext'
import { useI18n } from "@/i18n";

function fmt(n: number | undefined) {
  if (!n) return '—'
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}

// ─── Selection list card ──────────────────────────────────────────────────────

function SelectionRow({ sel, onClick }: { sel: DevSelection; onClick: () => void }) {
    const { t } = useI18n();
  const allUnits = useCoreStore((s) => s.allUnits)
  const unitCount = sel.items.length
  const likedCount = sel.items.filter((i) => i.reaction === 'liked').length
  const questionCount = sel.items.filter((i) => i.reaction === 'question').length

  const preview = useMemo(() => {
    return sel.items
      .slice(0, 3)
      .map((item) => allUnits.find((u) => u._id === item.unitId))
      .filter(Boolean)
  }, [sel.items, allUnits])

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-md border border-[rgba(242,207,141,0.12)] bg-[rgba(0,0,0,0.2)] p-4 text-left transition-all hover:border-[rgba(242,207,141,0.3)] hover:bg-[rgba(0,0,0,0.35)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[16px] font-normal text-[#fcecc8]">{sel.title}</span>
            <span
              className="shrink-0 rounded-sm border px-2 py-0.5 text-[16px] font-normal"
              style={{
                borderColor: `${DEV_SELECTION_STATUS_COLORS[sel.status]}50`,
                color: DEV_SELECTION_STATUS_COLORS[sel.status],
                background: `${DEV_SELECTION_STATUS_COLORS[sel.status]}15`,
              }}
            >
              {DEV_SELECTION_STATUS_LABELS[sel.status]}
            </span>
          </div>

          {sel.clientName && (
            <div className="mt-0.5 flex items-center gap-1 text-[16px] text-[rgba(242,207,141,0.72)]">
              <User size={10} />
              {sel.clientName}
              {sel.clientPhone && <span className="text-[rgba(242,207,141,0.72)]">· {sel.clientPhone}</span>}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right text-[16px] text-[rgba(242,207,141,0.72)]">
          <div>{timeAgo(sel.createdAt)}</div>
          {sel.viewCount > 0 && (
            <div className="text-amber-400">{sel.viewCount}{t('development.selectionsDevPage.просмотр')}</div>
          )}
        </div>
      </div>

      {/* Preview images + stats */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex -space-x-2">
          {preview.map((unit) => (
            <div
              key={unit!._id}
              className="h-10 w-10 overflow-hidden rounded-lg border-2 border-[#07120a] bg-[rgba(0,0,0,0.4)]"
            >
              {unit!.layoutImageUrl ? (
                <img src={unit!.layoutImageUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Layers size={12} className="text-[rgba(242,207,141,0.2)]" />
                </div>
              )}
            </div>
          ))}
          {unitCount > 3 && (
            <div className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-[#07120a] bg-[rgba(0,0,0,0.5)] text-[16px] font-normal text-[rgba(242,207,141,0.72)]">
              +{unitCount - 3}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-[16px] text-[rgba(242,207,141,0.72)]">
          <span>{unitCount} {t('development.selectionsDevPage.кв')}</span>
          {likedCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Heart size={11} className="fill-emerald-400" />
              {likedCount}
            </span>
          )}
          {questionCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <HelpCircle size={11} />
              {questionCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function SelectionDetail({ sel, onBack }: { sel: DevSelection; onBack: () => void }) {
    const { t } = useI18n();
  const allUnits = useCoreStore((s) => s.allUnits)
  const allBuildings = useCoreStore((s) => s.allBuildings)
  const projects = useCoreStore((s) => s.projects)
  const setStatus = useDevSelectionsStore((s) => s.setStatus)
  const removeItem = useDevSelectionsStore((s) => s.removeItem)
  const updateItemNote = useDevSelectionsStore((s) => s.updateItemNote)
  const updateSel = useDevSelectionsStore((s) => s.update)
  const removeSel = useDevSelectionsStore((s) => s.remove)
  const { isLightTheme } = useTheme()

  const [copied, setCopied] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteVal, setNoteVal] = useState('')
  const customization = resolveDevCustomization(sel.customization)

  const publicUrl = buildSelectionShareUrl(sel)

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
    if (sel.status === 'draft') setStatus(sel.id, 'sent')
  }

  const handleDelete = () => {
    if (!window.confirm('Удалить подборку?')) return
    removeSel(sel.id)
    onBack()
  }

  const items = useMemo(() => sel.items.map((item) => {
    const unit = allUnits.find((u) => u._id === item.unitId)
    const building = unit ? allBuildings.find((b) => b._id === unit.building) : undefined
    const project = building ? projects.find((p) => p._id === building.project) : undefined
    return { item, unit, building, project }
  }).filter((e) => e.unit), [sel.items, allUnits, allBuildings, projects])

  const handleOpenPdf = () => {
    const opened = openDevSelectionPdf({
      selection: sel,
      customization,
      items: items.map(({ item, unit, building, project }) => ({
        unit: unit!,
        building,
        project,
        agentNote: item.agentNote,
      })),
    })

    if (!opened) {
      window.alert('Браузер заблокировал окно PDF. Разрешите всплывающие окна для сайта и повторите действие.')
    }
  }

  const likedCount = sel.items.filter((i) => i.reaction === 'liked').length
  const questionCount = sel.items.filter((i) => i.reaction === 'question').length
  const dislikedCount = sel.items.filter((i) => i.reaction === 'disliked').length

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack} className="mt-1 rounded-md p-1 text-[rgba(242,207,141,0.72)] hover:text-[#fcecc8]">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-normal text-[#fcecc8] truncate">{sel.title}</h2>
            <span
              className="shrink-0 rounded-sm border px-2.5 py-0.5 text-[16px] font-normal"
              style={{
                borderColor: `${DEV_SELECTION_STATUS_COLORS[sel.status]}50`,
                color: DEV_SELECTION_STATUS_COLORS[sel.status],
                background: `${DEV_SELECTION_STATUS_COLORS[sel.status]}15`,
              }}
            >
              {DEV_SELECTION_STATUS_LABELS[sel.status]}
            </span>
          </div>
          {sel.clientName && (
            <div className="mt-0.5 text-[16px] text-[rgba(242,207,141,0.72)]">
              {sel.clientName} {sel.clientPhone && `· ${sel.clientPhone}`}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="shrink-0 rounded-md p-1.5 text-[rgba(242,207,141,0.72)] hover:text-[#ffb4ab]"
          title={t('development.selectionsDevPage.удалить_подборку')}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Share link */}
      <div className="rounded-md border border-[rgba(242,207,141,0.15)] bg-[rgba(0,0,0,0.25)] p-4">
        <p className="mb-2 text-[16px] font-normal uppercase tracking-wide text-[rgba(242,207,141,0.72)]">{t('development.selectionsDevPage.ссылка_для_клиента')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-[rgba(0,0,0,0.3)] px-3 py-2 text-[16px] text-[rgba(242,207,141,0.8)]">
            {publicUrl}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className={`shrink-0 flex items-center gap-1.5 rounded-md px-3 py-2 text-[16px] font-normal transition-colors ${
              copied ? 'bg-[rgba(208,232,223,0.18)] text-[#d0e8df]' : 'bg-[#c9a84c] text-[#0a1f12] hover:bg-[#e2c97e]'
            }`}
          >
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          <a
            href={buildSelectionShareHash(sel)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-[rgba(242,207,141,0.2)] px-3 py-2 text-[16px] text-[rgba(242,207,141,0.72)] hover:text-[#fcecc8]"
          >
            <ExternalLink size={13} />
            {t('development.selectionsDevPage.открыть')}</a>
          <button
            type="button"
            onClick={handleOpenPdf}
            disabled={items.length === 0}
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-[rgba(242,207,141,0.2)] px-3 py-2 text-[16px] text-[rgba(242,207,141,0.72)] hover:text-[#fcecc8] disabled:cursor-not-allowed disabled:opacity-75"
          >
            <FileText size={13} />
            PDF
          </button>
        </div>
      </div>

      {/* Кастомизация */}
      <SelectionCustomizationPanel
        value={customization}
        groups={DEV_CUSTOMIZATION_GROUPS}
        variant={isLightTheme ? 'light' : 'dark'}
        onChange={(next) => updateSel(sel.id, { customization: resolveDevCustomization({ ...customization, ...next }) })}
      />

      {/* Analytics row */}
      {(sel.viewCount > 0 || likedCount > 0 || questionCount > 0 || dislikedCount > 0) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Просмотров', value: sel.viewCount, color: 'text-[#fcecc8]' },
            { label: 'Нравится', value: likedCount, color: 'text-[#d0e8df]', icon: <Heart size={14} className="fill-[#d0e8df]" /> },
            { label: 'Вопросы', value: questionCount, color: 'text-amber-400', icon: <HelpCircle size={14} /> },
            { label: 'Не подходит', value: dislikedCount, color: 'text-[#ffb4ab]', icon: <ThumbsDown size={14} /> },
          ].map(({ label, value, color, icon }) => (
            <div key={label} className="rounded-md border border-[rgba(242,207,141,0.1)] bg-[rgba(0,0,0,0.2)] px-4 py-3 text-center">
              <div className={`flex items-center justify-center gap-1.5 text-xl font-normal ${color}`}>
                {icon}
                {value}
              </div>
              <div className="mt-0.5 text-[16px] text-[rgba(242,207,141,0.72)]">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Unit list */}
      <div className="flex flex-col gap-3">
        <p className="text-[16px] font-normal uppercase tracking-wide text-[rgba(242,207,141,0.72)]">
          {t('development.selectionsDevPage.квартиры_в_подборке')}{items.length}
        </p>
        {items.map(({ item, unit, building }) => {
          if (!unit) return null
          const price = unit.price ?? (unit.pricePerSqm && unit.area ? Math.round(unit.pricePerSqm * unit.area) : undefined)
          const REACTION_ICON = {
            liked: <Heart size={12} className="fill-emerald-400 text-emerald-400" />,
            question: <HelpCircle size={12} className="text-amber-400" />,
            disliked: <ThumbsDown size={12} className="text-[#ffb4ab]" />,
          }
          return (
            <div
              key={item.unitId!}
              className="flex items-center gap-3 rounded-md border border-[rgba(242,207,141,0.1)] bg-[rgba(0,0,0,0.18)] p-3"
            >
              {/* Miniature plan */}
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[rgba(0,0,0,0.4)]">
                {unit.layoutImageUrl ? (
                  <img src={unit.layoutImageUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Layers size={16} className="text-[rgba(242,207,141,0.72)]" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-normal text-[#fcecc8]">{unit.number}</span>
                  {item.reaction && REACTION_ICON[item.reaction]}
                </div>
                <div className="text-[16px] text-[rgba(242,207,141,0.72)]">
                  {[building?.name, unit.rooms, unit.area != null && `${unit.area} м²`, unit.floor && `${unit.floor} эт`].filter(Boolean).join(' · ')}
                </div>
                {price && <div className="text-[16px] font-normal text-[#c9a84c]">{fmt(price)}</div>}

                {/* Note */}
                {editingNote === item.unitId ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={noteVal}
                      onChange={(e) => setNoteVal(e.target.value)}
                      placeholder={t('development.selectionsDevPage.комментарий_агента')}
                      className="flex-1 rounded-md border border-[rgba(242,207,141,0.2)] bg-[rgba(0,0,0,0.3)] px-2 py-1 text-[16px] text-[#fcecc8] outline-none focus:border-[#c9a84c]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { updateItemNote(sel.id, item.unitId!, noteVal); setEditingNote(null) }
                        if (e.key === 'Escape') setEditingNote(null)
                      }}
                    />
                    <button type="button" onClick={() => { updateItemNote(sel.id, item.unitId!, noteVal); setEditingNote(null) }}
                      className="rounded p-1 text-[#d0e8df] hover:bg-[rgba(208,232,223,0.12)]">
                      <Check size={13} />
                    </button>
                    <button type="button" onClick={() => setEditingNote(null)}
                      className="rounded p-1 text-[rgba(242,207,141,0.72)] hover:text-[#fcecc8]">
                      <X size={13} />
                    </button>
                  </div>
                ) : item.agentNote ? (
                  <button type="button" onClick={() => { setEditingNote(item.unitId!); setNoteVal(item.agentNote ?? '') }}
                    className="mt-1 text-left text-[16px] italic text-[rgba(242,207,141,0.72)] hover:text-[rgba(242,207,141,0.8)]">
                    «{item.agentNote}»
                  </button>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title={t('development.selectionsDevPage.добавить_комментарий')}
                  onClick={() => { setEditingNote(item.unitId!); setNoteVal(item.agentNote ?? '') }}
                  className="rounded-md p-1.5 text-[rgba(242,207,141,0.72)] hover:text-[rgba(242,207,141,0.8)]"
                >
                  <MessageSquarePlus size={14} />
                </button>
                <button
                  type="button"
                  title={t('development.selectionsDevPage.удалить_из_подборки')}
                  onClick={() => removeItem(sel.id, item.unitId!)}
                  className="rounded-md p-1.5 text-[rgba(242,207,141,0.72)] hover:text-[#ffb4ab]"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Status change */}
      {sel.status !== 'archived' && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-[rgba(242,207,141,0.08)]">
          {sel.status === 'viewed' && (
            <button type="button" onClick={() => setStatus(sel.id, 'archived')}
              className="rounded-md border border-[rgba(242,207,141,0.15)] px-4 py-2 text-[16px] font-normal text-[rgba(242,207,141,0.72)] hover:text-[rgba(242,207,141,0.8)]">
              {t('development.selectionsDevPage.в_архив')}</button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SelectionsDevPage() {
    const { t } = useI18n();
  const allSelections = useDevSelectionsStore((s) => s.selections)
  const selections = useMemo(() => allSelections.filter(isNewbuildSelection), [allSelections])
  const fetchAll = useDevSelectionsStore((s) => s.fetchAll)
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname } = location
  const [activeId, setActiveId] = useState<string | null>(
    (location.state as { activeId?: string } | null)?.activeId || null
  )

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  /** Одна и та же страница используется и в Девелопменте, и в Новостройках — шахматку открываем в текущем контуре. */
  const chessboardPath = pathname.startsWith('/dashboard/new-buildings')
    ? '/dashboard/new-buildings/chessboard'
    : '/dashboard/development/chessboard'
  // ?pick=1 — открыть шахматку сразу в режиме выбора лотов с подсказкой.
  const chessboardPickPath = `${chessboardPath}?pick=1`

  const active = useMemo(() => selections.find((s) => s.id === activeId), [selections, activeId])

  return (
    <div className="w-full max-w-3xl">
      {active ? (
        <SelectionDetail sel={active} onBack={() => setActiveId(null)} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-normal text-[#fcecc8]">{t('development.selectionsDevPage.подборки')}</h1>
            <button
              type="button"
              onClick={() => navigate(chessboardPickPath)}
              className="flex items-center gap-1.5 rounded-md bg-[#c9a84c] px-4 py-2 text-[16px] font-normal text-[#0a1f12] hover:bg-[#e2c97e]"
            >
              <Plus size={15} />
              {t('development.selectionsDevPage.создать_подборку')}</button>
          </div>

          {selections.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-[rgba(242,207,141,0.15)] py-16 text-center">
              <Layers size={40} className="text-[rgba(242,207,141,0.72)]" />
              <div>
                <p className="text-[16px] font-normal text-[rgba(242,207,141,0.72)]">{t('development.selectionsDevPage.подборок_пока_нет')}</p>
                <p className="mt-1 text-[16px] text-[rgba(242,207,141,0.72)]">
                  {t('development.selectionsDevPage.выберите_квартиры_в')}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate(chessboardPickPath)}
                className="flex items-center gap-1.5 rounded-md bg-[#c9a84c] px-5 py-2.5 text-[16px] font-normal text-[#0a1f12] hover:bg-[#e2c97e]"
              >
                <Plus size={14} />
                {t('development.selectionsDevPage.перейти_в_шахматку')}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {selections.map((sel) => (
                <SelectionRow key={sel.id} sel={sel} onClick={() => setActiveId(sel.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
