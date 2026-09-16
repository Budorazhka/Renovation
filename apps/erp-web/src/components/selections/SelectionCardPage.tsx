import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { propertyAssetsApi, type PropertyAsset, type Listing } from '@/services/propertyAssetsApi'
import {
  DEV_SELECTION_STATUS_LABELS,
  DEV_SELECTION_STATUS_COLORS,
  type DevSelectionItem,
  type DevSelectionReaction,
} from '@/types/dev-selection'
import {
  ArrowLeft,
  Building2,
  Check,
  ClipboardCopy,
  ExternalLink,
  Heart,
  HelpCircle,
  MessageSquarePlus,
  Sliders,
  ThumbsDown,
  Trash2,
  X,
} from 'lucide-react'
import { formatCurrency } from '@/lib/format-currency'
import { SelectionCustomizationPanel } from '@/components/selections/SelectionCustomizationPanel'
import { SECONDARY_CUSTOMIZATION_GROUPS, resolveDevCustomization } from '@/config/dev-selection-customization'
import { buildSelectionShareHash, buildSelectionShareUrl } from '@/lib/selection-share'
import { useTheme } from '@/context/ThemeContext'
import { useI18n } from "@/i18n";

const DEAL_TYPE_LABEL: Record<Listing['dealType'], string> = {
  sale: 'Продажа',
  rent_long: 'Аренда (длительная)',
  rent_short: 'Аренда (посуточно)',
}

function listingPriceLabel(listing: Listing): string {
  return formatCurrency(listing.price.amountMinorUnits / 100, listing.price.currency)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

const TG_ICON =
  'M9.5 14.5 9 18.5c.4 0 .6-.2.8-.4l2-2 4.1 3c.7.4 1.3.2 1.5-.7l2.7-12.6c.3-1.1-.4-1.6-1.2-1.3L2.7 9.2C1.6 9.6 1.6 10.3 2.5 10.6l4.4 1.4 10.2-6.4c.5-.3.9-.1.5.2L9.5 14.5Z'
const WA_ICON =
  'M16.6 14.2c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.6-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.7s1.2 3.1 1.3 3.3c.2.3 2.4 3.7 5.9 5.2 2.4 1 3.4 1.1 4.6.9.7-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3ZM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.4 5.2L2 22l4.9-1.3c1.5.8 3.2 1.3 5.1 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2Z'

const REACTION_ICON: Record<DevSelectionReaction, ReactElement> = {
  liked: <Heart size={12} className="fill-emerald-400 text-emerald-400" />,
  question: <HelpCircle size={12} className="text-amber-400" />,
  disliked: <ThumbsDown size={12} className="text-[#ffb4ab]" />,
}

interface ResolvedItem {
  item: DevSelectionItem
  asset?: PropertyAsset
  listing?: Listing
}

function PropertyRow({
  entry,
  editingNote,
  noteVal,
  onNoteChange,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onRemove,
}: {
  entry: ResolvedItem
  editingNote: boolean
  noteVal: string
  onNoteChange: (v: string) => void
  onStartEdit: () => void
  onSaveNote: () => void
  onCancelEdit: () => void
  onRemove: () => void
}) {
  const { item, asset, listing } = entry
  if (!asset || !listing) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      background: 'var(--hub-card-bg)',
      border: '1px solid var(--hub-card-border)',
      borderRadius: 8, padding: '12px 14px',
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 6, flexShrink: 0,
        background: 'rgba(201,168,76,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Building2 size={14} color="var(--gold)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <div style={{
            fontSize: 12, fontWeight: 400, color: 'var(--app-text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {asset.location.address}
          </div>
          {item.reaction && REACTION_ICON[item.reaction]}
        </div>
        <div style={{ fontSize: 11, color: 'var(--app-text-muted)' }}>
          {asset.characteristics.rooms ?? '—'}к · {asset.characteristics.area} м²
          {asset.characteristics.floor != null && ` · ${asset.characteristics.floor} эт`} · {DEAL_TYPE_LABEL[listing.dealType]}
        </div>

        {editingNote ? (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              autoFocus
              value={noteVal}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Комментарий агента"
              style={{
                flex: 1, borderRadius: 4, border: '1px solid var(--green-border)',
                background: 'var(--green-deep)', padding: '4px 8px', fontSize: 12,
                color: 'var(--app-text)', outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveNote()
                if (e.key === 'Escape') onCancelEdit()
              }}
            />
            <button type="button" onClick={onSaveNote} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#d0e8df', padding: 2 }}>
              <Check size={13} />
            </button>
            <button type="button" onClick={onCancelEdit} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--app-text-subtle)', padding: 2 }}>
              <X size={13} />
            </button>
          </div>
        ) : item.agentNote ? (
          <button
            type="button"
            onClick={onStartEdit}
            style={{ marginTop: 4, textAlign: 'left', fontSize: 11, fontStyle: 'italic', color: 'var(--app-text-subtle)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            «{item.agentNote}»
          </button>
        ) : null}
      </div>
      <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--app-text)', flexShrink: 0 }}>
        {listingPriceLabel(listing)}
      </div>
      <div style={{ display: 'flex', flexShrink: 0, gap: 2 }}>
        <button
          type="button"
          title="Добавить комментарий"
          onClick={onStartEdit}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--app-text-subtle)', padding: 4 }}
        >
          <MessageSquarePlus size={14} />
        </button>
        <button
          type="button"
          title="Удалить из подборки"
          onClick={onRemove}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--app-text-subtle)', padding: 4 }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export function SelectionCardPage() {
    const { t: tApp } = useI18n();
  const { selectionId } = useParams<{ selectionId: string }>()
  const navigate = useNavigate()
  const { isLightTheme } = useTheme()

  const allSelections = useDevSelectionsStore((s) => s.selections)
  const fetchAll = useDevSelectionsStore((s) => s.fetchAll)
  const setStatus = useDevSelectionsStore((s) => s.setStatus)
  const removeItem = useDevSelectionsStore((s) => s.removeItem)
  const updateItemNote = useDevSelectionsStore((s) => s.updateItemNote)
  const updateSel = useDevSelectionsStore((s) => s.update)
  const removeSel = useDevSelectionsStore((s) => s.remove)

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const [inventory, setInventory] = useState<{ asset: PropertyAsset; listings: Listing[] }[]>([])
  useEffect(() => {
    let cancelled = false
    propertyAssetsApi.listAllAssetsWithListings().then(({ items }) => {
      if (!cancelled) setInventory(items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const listingById = useMemo(() => {
    const map = new Map<string, { asset: PropertyAsset; listing: Listing }>()
    for (const { asset, listings } of inventory) {
      for (const listing of listings) map.set(listing._id, { asset, listing })
    }
    return map
  }, [inventory])

  const selection = useMemo(() => allSelections.find((s) => s.id === selectionId), [allSelections, selectionId])

  const [showCustom, setShowCustom] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null)
  const [noteVal, setNoteVal] = useState('')

  if (!selection) {
    return (
      <DashboardShell hideSidebar>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--app-text-subtle)' }}>
          {tApp('selections.selectionCardPage.подборка_не_найдена')}</div>
      </DashboardShell>
    )
  }

  const customization = resolveDevCustomization(selection.customization)

  const items: ResolvedItem[] = selection.items.map((item) => {
    const resolved = item.listingId ? listingById.get(item.listingId) : undefined
    return { item, asset: resolved?.asset, listing: resolved?.listing }
  })

  const publicUrl = buildSelectionShareUrl(selection)

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
    if (selection.status === 'draft') setStatus(selection.id, 'sent')
  }

  const openMessengerWithLink = (kind: 'tg' | 'wa') => {
    if (selection.status === 'draft') setStatus(selection.id, 'sent')
    if (kind === 'tg') {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(selection.title)}`,
        '_blank',
      )
    } else {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${selection.title}\n${publicUrl}`)}`,
        '_blank',
      )
    }
  }

  const handleDelete = () => {
    if (!window.confirm('Удалить подборку?')) return
    removeSel(selection.id)
    navigate(-1)
  }

  const startEdit = (itemId: string, currentNote: string | undefined) => {
    setEditingItemKey(itemId)
    setNoteVal(currentNote ?? '')
  }
  const saveNote = (itemId: string) => {
    updateItemNote(selection.id, itemId, noteVal)
    setEditingItemKey(null)
  }

  const likedCount = selection.items.filter((i) => i.reaction === 'liked').length
  const questionCount = selection.items.filter((i) => i.reaction === 'question').length
  const dislikedCount = selection.items.filter((i) => i.reaction === 'disliked').length

  return (
    <DashboardShell hideSidebar>
      <div
        style={{
          padding: '20px 24px',
          minHeight: '100%',
          fontFamily: "'Montserrat', sans-serif",
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          background: 'var(--app-bg)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--app-text-subtle)', padding: 4, marginTop: 4,
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 20, fontWeight: 400, color: 'var(--app-text)' }}>
                {selection.title}
              </div>
              <span
                style={{
                  fontSize: 11, fontWeight: 400, padding: '2px 8px', borderRadius: 4,
                  color: DEV_SELECTION_STATUS_COLORS[selection.status],
                  background: `${DEV_SELECTION_STATUS_COLORS[selection.status]}20`,
                  border: `1px solid ${DEV_SELECTION_STATUS_COLORS[selection.status]}50`,
                }}
              >
                {DEV_SELECTION_STATUS_LABELS[selection.status]}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--app-text-subtle)' }}>
              {tApp('selections.selectionCardPage.создана')}{formatDate(selection.createdAt)} · {selection.items.length} {selection.items.length === 1 ? 'объект' : 'объектов'}
              {selection.clientName && ` · ${selection.clientName}`}
            </div>
          </div>
          <button
            type="button"
            onClick={handleDelete}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--app-text-subtle)', padding: 4 }}
            title="Удалить подборку"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={copyLink}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 4,
              background: copied ? 'rgba(208,232,223,0.18)' : 'var(--nav-item-bg-active)',
              border: '1px solid var(--hub-card-border-hover)',
              color: copied ? '#d0e8df' : 'var(--theme-accent-heading)',
              fontSize: 12, fontWeight: 400, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
            {copied ? 'Скопировано' : 'Копировать ссылку'}
          </button>
          <a
            href={buildSelectionShareHash(selection)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 4,
              background: 'var(--hub-tile-icon-bg)',
              border: '1px solid var(--hub-card-border)',
              color: 'var(--app-text-muted)',
              fontSize: 12, fontWeight: 400, cursor: 'pointer',
              fontFamily: 'inherit', textDecoration: 'none',
            }}
          >
            <ExternalLink size={13} />
            {tApp('selections.selectionCardPage.открыть')}
          </a>
          <button
            type="button"
            onClick={() => openMessengerWithLink('tg')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 4,
              background: 'rgba(34,158,217,0.12)',
              border: '1px solid rgba(34,158,217,0.35)',
              color: '#5ab9e8',
              fontSize: 12, fontWeight: 400, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d={TG_ICON} /></svg>
            Telegram
          </button>
          <button
            type="button"
            onClick={() => openMessengerWithLink('wa')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 4,
              background: 'rgba(37,211,102,0.12)',
              border: '1px solid rgba(37,211,102,0.35)',
              color: '#4ad17a',
              fontSize: 12, fontWeight: 400, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d={WA_ICON} /></svg>
            WhatsApp
          </button>
        </div>

        {/* Кастомизация */}
        <div style={{ marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => setShowCustom(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '10px 14px', borderRadius: 6, background: 'rgba(0,0,0,0.22)',
              border: 'none', boxShadow: 'inset 0 0 0 1px rgba(230,195,100,0.18)',
              color: 'var(--app-text-muted)', fontSize: 16, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Sliders size={15} />
            <span style={{ flex: 1, textAlign: 'left' }}>{tApp('selections.selectionCardPage.кастомизация_язык_ва')}</span>
          </button>
          {showCustom && (
            <div style={{ marginTop: 12 }}>
              <SelectionCustomizationPanel
                value={customization}
                groups={SECONDARY_CUSTOMIZATION_GROUPS}
                variant={isLightTheme ? 'light' : 'dark'}
                onChange={(next) => updateSel(selection.id, { customization: resolveDevCustomization({ ...customization, ...next }) })}
              />
            </div>
          )}
        </div>

        {/* Analytics row */}
        {(selection.viewCount > 0 || likedCount > 0 || questionCount > 0 || dislikedCount > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 18 }}>
            {[
              { label: 'Просмотров', value: selection.viewCount, color: 'var(--app-text)' },
              { label: 'Нравится', value: likedCount, color: '#d0e8df' },
              { label: 'Вопросы', value: questionCount, color: '#e6c364' },
              { label: 'Не подходит', value: dislikedCount, color: '#ffb4ab' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                border: '1px solid var(--hub-card-border)', borderRadius: 6,
                padding: '10px 8px', textAlign: 'center', background: 'var(--hub-card-bg)',
              }}>
                <div style={{ fontSize: 18, fontWeight: 400, color }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--app-text-subtle)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((entry) => {
            const itemId = entry.item.listingId!
            return (
              <PropertyRow
                key={itemId}
                entry={entry}
                editingNote={editingItemKey === itemId}
                noteVal={noteVal}
                onNoteChange={setNoteVal}
                onStartEdit={() => startEdit(itemId, entry.item.agentNote)}
                onSaveNote={() => saveNote(itemId)}
                onCancelEdit={() => setEditingItemKey(null)}
                onRemove={() => removeItem(selection.id, itemId)}
              />
            )
          })}
        </div>

        {/* Status change */}
        {selection.status === 'viewed' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--divider-subtle)' }}>
            <button
              type="button"
              onClick={() => setStatus(selection.id, 'archived')}
              style={{
                padding: '8px 16px', borderRadius: 4, border: '1px solid var(--hub-card-border)',
                background: 'transparent', color: 'var(--app-text-subtle)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              В архив
            </button>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
