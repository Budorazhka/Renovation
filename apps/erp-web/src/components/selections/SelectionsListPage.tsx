import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSelectionsBasePath } from '@/hooks/useSelectionsBasePath'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import {
  isSecondarySelection,
  type DevSelectionStatus,
  DEV_SELECTION_STATUS_LABELS,
  DEV_SELECTION_STATUS_COLORS,
} from '@/types/dev-selection'
import {
  Plus,
  Search,
  ChevronRight,
  FileText,
} from 'lucide-react'
import { useI18n } from "@/i18n";

const STATUS_FILTERS: { value: DevSelectionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'sent', label: 'Отправлены' },
  { value: 'viewed', label: 'Просмотрены' },
  { value: 'archived', label: 'Архив' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function SelectionsListPage() {
    const { t } = useI18n();
  const navigate = useNavigate()
  const selectionsBase = useSelectionsBasePath()
  const allSelections = useDevSelectionsStore((s) => s.selections)
  const fetchAll = useDevSelectionsStore((s) => s.fetchAll)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<DevSelectionStatus | 'all'>('all')

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const scoped = useMemo(() => allSelections.filter(isSecondarySelection), [allSelections])

  const filtered = useMemo(() => {
    return scoped.filter(sel => {
      if (statusFilter !== 'all' && sel.status !== statusFilter) return false
      if (query.trim().length >= 2) {
        const q = query.toLowerCase()
        if (!sel.title.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [scoped, query, statusFilter])

  return (
    <DashboardShell hideSidebar>
      <div
        style={{
          padding: '16px 20px',
          minHeight: '100%',
          fontFamily: "'Montserrat', sans-serif",
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          background: 'var(--app-bg)',
        }}
      >

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 26, fontWeight: 400, color: 'var(--app-text)', letterSpacing: '0.02em' }}>
            {t('selections.selectionsListPage.подборки')}<span style={{ marginLeft: 12, fontSize: 16, color: 'var(--app-text-subtle)', letterSpacing: '0.06em' }}>
              {filtered.length}/{scoped.length}
            </span>
          </div>
          <button
            type="button"
            className="alphabase-section-primary"
            onClick={() => navigate(`${selectionsBase}/new`)}
          >
            <Plus size={16} strokeWidth={2.5} />
            {t('selections.selectionsListPage.новая')}</button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--green-deep)', border: '1px solid var(--green-border)',
            borderRadius: 6, padding: '0 12px', height: 40, width: 280,
          }}>
            <Search size={16} color="var(--app-text-subtle)" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('selections.selectionsListPage.поиск')}
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                fontSize: 16, color: 'var(--app-text)', fontFamily: 'inherit', flex: 1,
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                style={{
                  padding: '8px 14px', borderRadius: 4, fontSize: 16, fontWeight: 400,
                  cursor: 'pointer', border: '1px solid',
                  background: statusFilter === f.value ? 'var(--nav-item-bg-active)' : 'transparent',
                  borderColor: statusFilter === f.value ? 'var(--hub-card-border-hover)' : 'var(--green-border)',
                  color: statusFilter === f.value ? 'var(--theme-accent-heading)' : 'var(--app-text-subtle)',
                  transition: 'all 0.15s',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--app-text-subtle)', padding: '40px 0', fontSize: 16 }}>
              {t('selections.selectionsListPage.подборок_не_найдено')}</div>
          )}
          {filtered.map(sel => {
            const statusColor = DEV_SELECTION_STATUS_COLORS[sel.status]

            return (
              <div
                key={sel.id}
                onClick={() => navigate(`${selectionsBase}/${sel.id}`)}
                style={{
                  background: 'var(--hub-card-bg)',
                  border: '1px solid var(--hub-card-border)',
                  borderRadius: 6,
                  padding: '16px 20px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  minHeight: 64,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--hub-card-border-hover)'
                  e.currentTarget.style.background = 'var(--hub-card-bg-hover)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--hub-card-border)'
                  e.currentTarget.style.background = 'var(--hub-card-bg)'
                }}
              >
                {/* Status dot */}
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: statusColor,
                }} title={DEV_SELECTION_STATUS_LABELS[sel.status]} />

                {/* Title — занимает основное пространство */}
                <span style={{
                  fontSize: 18, fontWeight: 400, color: 'var(--app-text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: '1 1 0', minWidth: 0,
                }}>
                  {sel.title}
                </span>

                {/* Кол-во объектов */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 16, color: 'var(--app-text-muted)' }}>
                  <FileText size={16} color="var(--app-text-subtle)" />
                  {sel.items.length}
                </div>

                {/* Date */}
                <span style={{
                  fontSize: 16, color: 'var(--app-text-subtle)',
                  flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  {formatDate(sel.sentAt || sel.createdAt)}
                </span>

                <ChevronRight size={18} color="var(--app-text-subtle)" style={{ flexShrink: 0 }} />
              </div>
            )
          })}
        </div>
      </div>
    </DashboardShell>
  )
}
