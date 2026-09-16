import { useCallback, useEffect, useMemo, useState, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { IUnit } from '@/types/core'
import {
  Search,
  Send,
  Paperclip,
  Smile,
  Phone,
  Video,
  Sparkles,
  Library,
  AlertTriangle,
  CheckCheck,
  Rows3,
  Plus,
  ArrowLeft,
  Check,
  FileText,
  PlaySquare,
  Presentation as PresentationIcon,
  X,
  RefreshCw,
  Trash2,
  Settings,
  Wand2,
  ChevronDown,
  Loader2,
  Target,
  MapPin,
  Wallet,
  MessageSquareQuote,
  Crosshair,
  Building2,
  ShieldAlert,
  Users,
  MessageCircle,
  Clock,
  Zap,
  TrendingUp,
  Thermometer,
  Percent,
  ShieldCheck,
  Scale,
  Lightbulb,
  Database,
  Info,
  UserRound,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { type LMSItem } from '@/data/lms-mock'
import { useLmsLibrary } from '@/components/lms/useLms'
import { useCoreStore } from '@/store/useCoreStore'
import {
  messengerApi,
  isMessengerAccountConnected,
  type Account,
  type OwnerAiChatMessage,
  type ClientDossier,
  type Dialog,
  type Message,
  type CrmLeadContext,
  type IAiSelfTask,
  type SelfTaskType,
  type SelfTaskStatus,
  type SelfTaskPriority,
  type IExecutionRecord,
  SELF_TASK_TYPE_LABELS,
  SELF_TASK_STATUS_LABELS,
  SELF_TASK_PRIORITY_LABELS,
  SELF_TASK_STATUS_COLORS,
  SELF_TASK_PRIORITY_COLORS,
  selfTaskApi,
} from '@/services/messengerApi'
import {
  useMessengerAiSettingsStore,
  onMessengerAiSettingsConfirmed,
  onMessengerAiSettingsSaveError,
  resolveDialogAiSettingsFromStore,
} from '@/store/useMessengerAiSettingsStore'
import { getGlobalAiEnabled } from '@/store/useAiKillSwitchStore'
import { getMessengerSocket } from '@/services/messengerSocket'
import { MESSENGERS_SOCKET_URL } from '@/config/backend'
import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { buildSelectionShareUrl } from '@/lib/selection-share'
import { DEV_SELECTION_STATUS_COLORS, isSecondarySelection } from '@/types/dev-selection'
import type { DevSelection } from '@/types/dev-selection'
import { propertyAssetsApi, type PropertyAsset, type Listing } from '@/services/propertyAssetsApi'
import { resolveDevCustomization } from '@/config/dev-selection-customization'
import { openDevSelectionPdf } from '@/lib/dev-selection-pdf'
import { useToasts, type Toast } from '@/hooks/useToasts'
import { ChatMessageBody } from '@/components/chat/ChatMessageBody'
import { useI18n } from "@/i18n";

type ChatPlatform = 'telegram' | 'whatsapp'

const VIEWPORT_H = 'calc(100vh - 40px)'
const RIGHT_PANEL_WIDTH = 400

const CHANNEL_META: Record<ChatPlatform, { label: string; color: string; bg: string }> = {
  telegram: { label: 'Telegram', color: '#229ED9', bg: 'var(--chat-surface)' },
  whatsapp: { label: 'WhatsApp', color: '#25D366', bg: 'var(--chat-surface)' },
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  const s = 25 + Math.abs((hash >> 8) % 10) // 25-35%
  const l = 16 + Math.abs((hash >> 16) % 8) // 16-24%
  return `hsl(${h}, ${s}%, ${l}%)`
}

function resolveMessengerAssetUrl(url?: string): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  const base = MESSENGERS_SOCKET_URL.replace(/\/$/, '')
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

function ChatAvatar({
  name,
  avatarUrl,
  platform,
  size,
  fontSize,
  showPlatformBadge = false,
  showOnlineIndicator = false,
  showAiBadge = false,
}: {
  name: string
  avatarUrl?: string
  platform?: ChatPlatform
  size: number
  fontSize?: number
  showPlatformBadge?: boolean
  showOnlineIndicator?: boolean
  showAiBadge?: boolean
}) {
    const { t } = useI18n();
  const [imgError, setImgError] = useState(false)
  const resolvedUrl = resolveMessengerAssetUrl(avatarUrl)
  const ch = platform ? CHANNEL_META[platform] : null
  const label = initials(name)
  const showImage = Boolean(resolvedUrl) && !imgError
  const badgeSize = Math.max(12, Math.round(size * 0.33))

  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          background: showImage ? 'var(--green-card)' : (ch?.bg ?? getAvatarColor(name)),
          border: '1px solid var(--chat-avatar-border)',
          color: 'var(--chat-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: fontSize ?? Math.max(11, Math.round(size * 0.34)),
          fontWeight: 500,
        }}
      >
        {showImage ? (
          <img
            src={resolvedUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
          />
        ) : label}
      </div>
      {showPlatformBadge && ch && (
        <span
          title={ch.label}
          style={{
            position: 'absolute',
            right: -2,
            top: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: 4,
            background: 'var(--chat-avatar-badge-bg)',
            border: `1.5px solid ${ch.color}`,
            color: ch.color,
            fontSize: Math.max(7, Math.round(badgeSize * 0.55)),
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          {platform === 'whatsapp' ? 'W' : 'T'}
        </span>
      )}
      {showOnlineIndicator && (
        <span
          title={t('modules.chatsPage.в_сети')}
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(10, Math.round(size * 0.28)),
            height: Math.max(10, Math.round(size * 0.28)),
            borderRadius: '50%',
            background: '#22c55e',
            border: '2px solid var(--chat-avatar-badge-bg)',
          }}
        />
      )}
      {showAiBadge && (
        <span
          title={t('modules.chatsPage.автоответ_ии_включ_н')}
          style={{
            position: 'absolute',
            left: -3,
            bottom: -3,
            width: badgeSize,
            height: badgeSize,
            borderRadius: 4,
            background: '#ef4444',
            border: '1.5px solid var(--chat-avatar-badge-bg)',
            color: '#fff',
            fontSize: Math.max(7, Math.round(badgeSize * 0.5)),
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          AI
        </span>
      )}
    </div>
  )
}


function formatTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function isPrivateDialog(dialog?: Pick<Dialog, 'chatType'> | null) {
  return !dialog?.chatType || dialog.chatType === 'private'
}

function isDialogOnline(dialog?: Pick<Dialog, 'isOnline' | 'chatType'> | null) {
  return isPrivateDialog(dialog) && dialog?.isOnline === true
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

type SendMode = 'normal' | 'ai' | 'generate'

const SEND_MODES: SendMode[] = ['normal', 'ai', 'generate']

const COMPOSE_BAR_HEIGHT = 40

const composeControlStyle: React.CSSProperties = {
  height: COMPOSE_BAR_HEIGHT,
  borderRadius: 4,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const STAGE_LABELS: Record<string, string> = {
  rejected: 'Бракованный лид',
  first_contact: 'Отказ',
  needs_analysis: 'Новый лид',
  presentation: 'Попросил связаться позже',
  proposal: 'Презентовали компанию',
  negotiation: 'Обсудили ситуацию',
  decision_making: 'Выявлена потребность',
  contract_signing: 'Потребность скорректирована',
  onboarding: 'Отправлено КП',
  needs_analysis1: 'Отработка возражений',
  presentation1: 'Отложенный спрос',
  proposal1: 'Прогрев',
  negotiation1: 'Показ',
  decision_making1: 'Задаток получен',
  contract_signing1: 'Заключён договор',
  deal_closed: 'Золотой фонд',
}

const SEND_MODE_CONFIG: Record<SendMode, {
  label: string
  shortLabel: string
  description: string
  requiresDraft: boolean
  enablesAutoReply: boolean | null
}> = {
  normal: {
    label: 'ИИ Отключен',
    shortLabel: 'ИИ выкл.',
    description: 'Обычная отправка · автоответ ИИ выключен',
    requiresDraft: true,
    enablesAutoReply: false,
  },
  ai: {
    label: 'ИИ Включен',
    shortLabel: 'ИИ вкл.',
    description: 'ИИ ответит и включит автоответ на входящие',
    requiresDraft: false,
    enablesAutoReply: true,
  },
  generate: {
    label: 'Сгенерировать ответ',
    shortLabel: 'Генерация',
    description: 'ИИ сформирует ответ и сразу отправит',
    requiresDraft: false,
    enablesAutoReply: null,
  },
}

function SendModeSelect({
  value,
  disabled,
  open,
  onOpenChange,
  onChange,
  selectRef,
}: {
  value: SendMode
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (mode: SendMode) => void
  selectRef: RefObject<HTMLDivElement | null>
}) {
    const { t } = useI18n();
  const current = SEND_MODE_CONFIG[value]

  return (
    <div ref={selectRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        aria-label={`Режим отправки: ${current.label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={current.description}
        style={{
          ...composeControlStyle,
          minWidth: 0,
          maxWidth: 168,
          padding: '0 10px',
          border: value === 'ai'
            ? '1px solid color-mix(in srgb, var(--gold) 45%, transparent)'
            : '1px solid var(--green-border)',
          background: value === 'ai'
            ? 'color-mix(in srgb, var(--gold) 14%, transparent)'
            : 'var(--chat-surface)',
          color: 'var(--chat-text)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current.label}
        </span>
        <ChevronDown
          size={13}
          style={{
            color: 'var(--chat-text-dim)',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('modules.chatsPage.режим_отправки')}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 8px)',
            minWidth: 260,
            padding: 6,
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
            background: 'var(--chat-surface-solid)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            zIndex: 20,
          }}
        >
          {SEND_MODES.map((mode) => {
            const item = SEND_MODE_CONFIG[mode]
            const ItemIcon = mode === 'normal' ? Send : mode === 'ai' ? Sparkles : Wand2
            const selected = mode === value
            return (
              <button
                key={mode}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(mode)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  background: selected ? 'rgba(201,168,76,0.12)' : 'transparent',
                  color: 'var(--chat-text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = 'rgba(201,168,76,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selected ? 'rgba(201,168,76,0.12)' : 'transparent'
                }}
              >
                <ItemIcon size={16} style={{ color: 'var(--gold)', marginTop: 2, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{item.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--chat-text-muted)', marginTop: 2 }}>
                    {item.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function normalizeId(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return normalizeId((value as { _id: unknown })._id)
  }
  return String(value)
}

function sortDialogsByLastMessage(dialogs: Dialog[]): Dialog[] {
  return [...dialogs].sort((a, b) => {
    const aTime = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0
    const bTime = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0
    return bTime - aTime
  })
}

const MESSAGE_STATUS_RANK: Record<Message['status'], number> = {
  failed: -1,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
}

function pickHigherStatus(current?: Message['status'], next?: Message['status']): Message['status'] {
  const cur = MESSAGE_STATUS_RANK[current ?? 'sent'] ?? 0
  const nxt = MESSAGE_STATUS_RANK[next ?? 'sent'] ?? 0
  return nxt > cur ? (next ?? 'sent') : (current ?? 'sent')
}

function isAiPlaceholderExternalId(id?: string): boolean {
  return Boolean(id?.startsWith('ai-'))
}

function messageContentKey(msg: Message): string {
  const sentSec = Math.floor(new Date(msg.sentAt || 0).getTime() / 1000)
  return `${msg.fromMe}:${msg.text}:${sentSec}`
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>()
  const externalToId = new Map<string, string>()

  for (const msg of [...existing, ...incoming]) {
    if (isHiddenChatMessage(msg)) continue
    const id = normalizeId(msg._id)
    if (!id) continue

    const extId = msg.externalMessageId
    if (extId && !isAiPlaceholderExternalId(extId)) {
      const canonicalId = externalToId.get(extId)
      if (canonicalId && canonicalId !== id) {
        const prev = byId.get(canonicalId)
        if (prev) {
          byId.set(canonicalId, {
            ...prev,
            ...msg,
            status: pickHigherStatus(prev.status, msg.status),
            isRevoked: prev.isRevoked || msg.isRevoked,
            isEdited: prev.isEdited || msg.isEdited,
          })
        }
        continue
      }
      externalToId.set(extId, id)
    }

    const prev = byId.get(id)
    byId.set(id, prev
      ? {
          ...prev,
          ...msg,
          status: pickHigherStatus(prev.status, msg.status),
          isRevoked: prev.isRevoked || msg.isRevoked,
          isEdited: prev.isEdited || msg.isEdited,
        }
      : msg)
  }

  const realContentKeys = new Set<string>()
  for (const msg of byId.values()) {
    if (msg.externalMessageId && !isAiPlaceholderExternalId(msg.externalMessageId)) {
      realContentKeys.add(messageContentKey(msg))
    }
  }

  return [...byId.values()]
    .filter((msg) => {
      if (!isAiPlaceholderExternalId(msg.externalMessageId)) return true
      return !realContentKeys.has(messageContentKey(msg))
    })
    .sort((a, b) => {
      const aTime = new Date(a.sentAt || Date.now()).getTime()
      const bTime = new Date(b.sentAt || Date.now()).getTime()
      return aTime - bTime
    })
}

const UNRECOGNIZED_MESSAGE_TEXT = 'Не распознано'
const DELETED_MESSAGE_TEXT = 'Удалено'
const EDITED_MESSAGE_LABEL = 'изменено'

/** Входящие стикеры и нераспознанные медиа не показываем в CRM-чате */
function isHiddenChatMessage(message: Message): boolean {
  if (message.fromMe) return false
  if (message.messageType === 'sticker') return true
  if (message.messageType === 'unknown') return true
  if (message.text === UNRECOGNIZED_MESSAGE_TEXT) return true
  if (message.text === 'Стикер') return true
  if (message.messageType === 'gif' && (!message.text?.trim() || message.text === 'GIF')) return true
  return false
}

function filterVisibleChatMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isHiddenChatMessage(message))
}

function resolveUnreadCount(dialogId: string, count: number, activeChatId: string): number {
  const key = normalizeId(dialogId)
  if (!key) return count
  return normalizeId(activeChatId) === key ? 0 : Math.max(0, count)
}

function fetchAndMergeMissingDialogs(
  accountId: string,
  setDialogs: Dispatch<SetStateAction<Dialog[]>>,
) {
  messengerApi.getDialogs(accountId).then((dRes) => {
    const accountDialogs = dRes.dialogs || []
    if (!Array.isArray(accountDialogs)) return
    setDialogs((currentDialogs) => {
      const existingIds = new Set(currentDialogs.map((d) => normalizeId(d._id)))
      const newDialogs = accountDialogs.filter((d) => !existingIds.has(normalizeId(d._id)))
      if (newDialogs.length === 0) return currentDialogs
      return sortDialogsByLastMessage([...currentDialogs, ...newDialogs])
    })
  }).catch((err) => console.error('Failed to fetch new dialogs on message arrival:', err))
}

function applyMessageUpdate(messages: Message[], payload: {
  messageId?: string
  externalMessageId?: string
  text?: string
  isRevoked?: boolean
  isEdited?: boolean
}): { messages: Message[]; matched: boolean } {
  let matched = false

  const updated = messages.map((m) => {
    const matches =
      (payload.messageId && normalizeId(m._id) === payload.messageId) ||
      (payload.externalMessageId && m.externalMessageId === payload.externalMessageId)

    if (!matches) return m
    matched = true

    if (payload.isRevoked) {
      return {
        ...m,
        text: DELETED_MESSAGE_TEXT,
        isRevoked: true,
        isEdited: false,
        messageType: 'text' as const,
        media: undefined,
      }
    }

    return {
      ...m,
      text: payload.text ?? m.text,
      isEdited: payload.isEdited ?? m.isEdited,
    }
  })

  return { messages: updated, matched }
}

function reloadDialogMessages(
  dialogId: string,
  setMessages: Dispatch<SetStateAction<Record<string, Message[]>>>
) {
  messengerApi.getMessages(dialogId).then((res) => {
    const msgs = res.messages || []
    setMessages((prev) => ({
      ...prev,
      [dialogId]: mergeMessages(prev[dialogId] || [], msgs),
    }))
  }).catch((err) => console.error('Failed to reload dialog messages:', err))
}

function isDeletedMessage(message: Message): boolean {
  return Boolean(message.isRevoked)
    || message.text === DELETED_MESSAGE_TEXT
    || message.text === '🚫 Message deleted'
}

function isUnrecognizedMessage(message: Message): boolean {
  if (isDeletedMessage(message)) return false
  return message.messageType === 'unknown' || message.text === UNRECOGNIZED_MESSAGE_TEXT
}

function formatMessageContent(message: Message): string {
  if (isDeletedMessage(message)) return DELETED_MESSAGE_TEXT
  if (isUnrecognizedMessage(message)) return UNRECOGNIZED_MESSAGE_TEXT
  if (message.messageType === 'sticker') return 'Стикер'
  if (message.messageType === 'gif' && !message.text?.trim()) return 'GIF'
  if (message.text?.trim()) return message.text
  if (message.media?.url || message.media?.urls?.length) {
    const labels: Record<Message['messageType'], string> = {
      photo: '📷 Фото',
      video: '🎬 Видео',
      gif: 'GIF',
      audio: '🎵 Аудио',
      document: message.media.fileName || '📎 Документ',
      sticker: 'Стикер',
      location: '📍 Локация',
      text: message.text,
      unknown: UNRECOGNIZED_MESSAGE_TEXT,
    }
    return labels[message.messageType] || UNRECOGNIZED_MESSAGE_TEXT
  }
  return UNRECOGNIZED_MESSAGE_TEXT
}

function groupByDay(messages: Message[]) {
  const out: { day: string; items: Message[] }[] = []
  for (const m of messages) {
    const sentAt = m.sentAt || new Date().toISOString()
    const day = sentAt.slice(0, 10)
    const last = out[out.length - 1]
    if (!last || last.day !== day) out.push({ day, items: [m] })
    else last.items.push(m)
  }
  return out
}

function getIncomingSenderMeta(message: Message, dialog: Dialog) {
  const isPrivate = !dialog.chatType || dialog.chatType === 'private'
  const senderName = message.senderName?.trim() || dialog.name
  return {
    name: senderName,
    avatarUrl: isPrivate ? dialog.avatarUrl : undefined,
    platform: dialog.platform,
  }
}

function MessageStatusIcon({ status }: { status?: Message['status'] }) {
    const { t } = useI18n();
  const resolved = status ?? 'sent'
  if (resolved === 'read') {
    return (
      <CheckCheck
        size={15}
        color="var(--gold)"
        strokeWidth={2.5}
        aria-label={t('modules.chatsPage.прочитано')}
        style={{ filter: 'drop-shadow(0 0 5px color-mix(in srgb, var(--gold) 55%, transparent))' }}
      />
    )
  }
  if (resolved === 'delivered') {
    return <CheckCheck size={15} color="var(--chat-text-dim)" strokeWidth={2} aria-label={t('modules.chatsPage.доставлено')} />
  }
  return <Check size={15} color="var(--chat-text-dim)" strokeWidth={2} aria-label={t('modules.chatsPage.отправлено')} />
}

const MATERIAL_TYPE_ICON: Record<LMSItem['type'], typeof FileText> = {
  article: FileText,
  video: PlaySquare,
  script: FileText,
  quiz: FileText,
  presentation: PresentationIcon,
  pdf: FileText,
}

const MATERIAL_TYPE_LABEL: Record<LMSItem['type'], string> = {
  article: 'Статья',
  video: 'Видео',
  script: 'Скрипт',
  quiz: 'Тест',
  presentation: 'Презентация',
  pdf: 'PDF',
}

type RightPanelTab = 'ai' | 'ownerAi' | 'tasks' | 'send'

/** Что отправляем клиенту: готовую подборку или материал из библиотеки. */
type SendKind = 'selection' | 'material'

/** Кому адресована задача: ИИ ставит её себе сам, либо задача идёт человеку. */
type TaskAssignee = 'ai' | 'human'

const RIGHT_PANEL_TABS: { id: RightPanelTab; label: string | null; title?: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'ownerAi', label: 'Афина', title: 'Чат с Афиной — ассистентом по этому лиду' },
  { id: 'tasks', label: 'Задачи', title: 'Задачи ИИ и задачи человеку по этому лиду' },
  // Иконка без подписи — на узкой панели текст обрезался
  { id: 'send', label: null, title: 'Отправить клиенту подборку или материал' },
]

export default function ChatsPage() {
    const { t } = useI18n();
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toasts, addToast, removeToast } = useToasts()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  
  const [isSyncing, setIsSyncing] = useState(false)
  const [isChatsListLoading, setIsChatsListLoading] = useState(true)
  const [crmStatus, setCrmStatus] = useState<{ hasCrmCredentials: boolean; crmConnected: boolean; crmUserId?: string; crmUserRole?: string } | null>(null)
  const [crmSyncing, setCrmSyncing] = useState(false)
  const [crmReconnecting, setCrmReconnecting] = useState(false)

  const [selfTasksActiveCount, setSelfTasksActiveCount] = useState(0)
  const [ownerAiMessages, setOwnerAiMessages] = useState<OwnerAiChatMessage[]>([])
  const [ownerAiDirectives, setOwnerAiDirectives] = useState('')
  const [ownerAiCompletedDirectives, setOwnerAiCompletedDirectives] = useState('')
  const [ownerAiLoading, setOwnerAiLoading] = useState(false)
  const [ownerAiSending, setOwnerAiSending] = useState(false)
  const [ownerAiDraft, setOwnerAiDraft] = useState('')
  const ownerAiScrollRef = useRef<HTMLDivElement>(null)

  const [accountFilter, setAccountFilter] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')
  const [rightTab, setRightTab] = useState<RightPanelTab>('ai')
  const [activeSelection, setActiveSelection] = useState<{ id: string; market: 'secondary' | 'newbuild' } | null>(null)
  const [selectionsSubTab, setSelectionsSubTab] = useState<'secondary' | 'newbuild'>('secondary')
  const [sendKind, setSendKind] = useState<SendKind>('selection')
  const [taskAssignee, setTaskAssignee] = useState<TaskAssignee>('ai')

  const allUnits = useCoreStore((s) => s.allUnits)
  const allBuildings = useCoreStore((s) => s.allBuildings)
  const projects = useCoreStore((s) => s.projects)
  const devSelections = useDevSelectionsStore((s) => s.selections)
  const fetchDevSelections = useDevSelectionsStore((s) => s.fetchAll)
  useEffect(() => {
    void fetchDevSelections()
  }, [fetchDevSelections])
  const secondarySelections = useMemo(() => devSelections.filter(isSecondarySelection), [devSelections])
  const [secondaryInventory, setSecondaryInventory] = useState<{ asset: PropertyAsset; listings: Listing[] }[]>([])
  useEffect(() => {
    let cancelled = false
    propertyAssetsApi.listAllAssetsWithListings().then(({ items }) => {
      if (!cancelled) setSecondaryInventory(items)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const secondaryListingById = useMemo(() => {
    const map = new Map<string, { asset: PropertyAsset; listing: Listing }>()
    for (const { asset, listings } of secondaryInventory) {
      for (const listing of listings) map.set(listing._id, { asset, listing })
    }
    return map
  }, [secondaryInventory])
  // Подписка на in-memory store — перерисовка при смене настроек ИИ
  useMessengerAiSettingsStore((s) => s.byDialogId)
  const [activeId, setActiveId] = useState<string>('')
  const prevActiveIdForAiRef = useRef(activeId)
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  const refreshBadgeCountsRef = useRef<(() => void) | null>(null)

  // Deep-link из «Старых лидов»: /dashboard/chats?dialog=<id> — открыть только что начатый диалог.
  useEffect(() => {
    const dialogParam = searchParams.get('dialog')
    if (!dialogParam) return
    if (!Array.isArray(dialogs) || dialogs.length === 0) return
    // Диалог мог быть создан только что — ждём, пока он доедет в список по сокету.
    const match = dialogs.find((d) => normalizeId(d._id) === dialogParam)
    if (!match) return
    setActiveId(match._id)
    const next = new URLSearchParams(searchParams)
    next.delete('dialog')
    setSearchParams(next, { replace: true })
  }, [searchParams, dialogs, setSearchParams])

  // Deep-link из «Расклада» CRM: /dashboard/chats?phone=<цифры> — открыть чат лида по номеру.
  useEffect(() => {
    const phoneParam = searchParams.get('phone')
    if (!phoneParam) return
    const digits = phoneParam.replace(/\D/g, '')
    setSearch(phoneParam)
    if (Array.isArray(dialogs) && dialogs.length > 0) {
      if (digits) {
        const match = dialogs.find(
          (d) =>
            String(d.externalChatId || '').replace(/\D/g, '').includes(digits) ||
            String(d.name || '').replace(/\D/g, '').includes(digits),
        )
        if (match) setActiveId(match._id)
      }
      const next = new URLSearchParams(searchParams)
      next.delete('phone')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, dialogs, setSearchParams])

  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleMarkDialogRead = useCallback((dialogId: string) => {
    const dialogKey = normalizeId(dialogId)
    if (!dialogKey || normalizeId(activeIdRef.current) !== dialogKey) return
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current)
    markReadTimerRef.current = setTimeout(() => {
      markReadTimerRef.current = null
      messengerApi.markDialogRead(dialogKey)
        .then(() => {
          setDialogs((prev) =>
            prev.map((d) => (normalizeId(d._id) === dialogKey ? { ...d, unreadCount: 0 } : d))
          )
        })
        .catch((err) => console.error('Failed to mark dialog read:', err))
    }, 300)
  }, [])

  const dialogsRef = useRef(dialogs)
  useEffect(() => { dialogsRef.current = dialogs }, [dialogs])

  const [loadedHistoryIds, setLoadedHistoryIds] = useState<Set<string>>(new Set())
  const [loadingDialogId, setLoadingDialogId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const [draft, setDraft] = useState('')
  // Разовый режим «Генерация» привязан к конкретному диалогу; режимы «ИИ вкл/выкл»
  // не храним отдельно — они выводятся из фактического aiEnabled активного диалога.
  const [generateModeDialogKey, setGenerateModeDialogKey] = useState<string | null>(null)
  const [sendModeSelectOpen, setSendModeSelectOpen] = useState(false)

  const [isComposing, setIsComposing] = useState(false)
  const [aiProcessingDialogIds, setAiProcessingDialogIds] = useState<Set<string>>(() => new Set())
  const [isSendingMedia, setIsSendingMedia] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const sendModeSelectRef = useRef<HTMLDivElement>(null)
  const [broadcastUnit, setBroadcastUnit] = useState<{ unit: IUnit; buildingName: string; projectName: string } | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [broadcastSearch, setBroadcastSearch] = useState('')

  const pendingChatDraft = useCoreStore((s) => s.pendingChatDraft)
  const clearPendingChatDraft = useCoreStore((s) => s.clearPendingChatDraft)
  const clearExpiredSharedUnits = useCoreStore((s) => s.clearExpiredSharedUnits)

  useEffect(() => {
    clearExpiredSharedUnits()
    const interval = setInterval(() => {
      clearExpiredSharedUnits()
    }, 30000)
    return () => clearInterval(interval)
  }, [clearExpiredSharedUnits])

  useEffect(() => {
    if (!activeId || !pendingChatDraft) return
    setDraft(pendingChatDraft)
    clearPendingChatDraft()
  }, [activeId, pendingChatDraft, clearPendingChatDraft])

  useEffect(() => {
    useMessengerAiSettingsStore.getState().seedFromDialogs(dialogs)
  }, [dialogs])

  useEffect(() => {
    return onMessengerAiSettingsConfirmed((dialogId, settings) => {
      setDialogs((prev) =>
        prev.map((d) => (normalizeId(d._id) === dialogId ? { ...d, aiSettings: settings } : d))
      )
    })
  }, [])

  useEffect(() => {
    return onMessengerAiSettingsSaveError(() => {
      addToast('Не удалось сохранить настройки ИИ', 'error')
    })
  }, [addToast])

  useEffect(() => {
    const prev = normalizeId(prevActiveIdForAiRef.current)
    const next = normalizeId(activeId)
    if (prev && prev !== next) {
      useMessengerAiSettingsStore.getState().flush(prev)
    }
    prevActiveIdForAiRef.current = activeId
  }, [activeId])

  useEffect(() => {
    return () => useMessengerAiSettingsStore.getState().flushAll()
  }, [])

  const setDialogAiEnabled = useCallback(async (enabled: boolean, silent = false) => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey) return false

    // Значение для отката читаем до апдейта: React может вызвать обновляющую
    // функцию повторно, и тогда она увидит уже применённый оптимистичный флаг.
    const previousEnabled = Boolean(
      dialogsRef.current.find((d) => normalizeId(d._id) === dialogKey)?.aiEnabled
    )
    setDialogs((prev) =>
      prev.map((d) => (normalizeId(d._id) === dialogKey ? { ...d, aiEnabled: enabled } : d))
    )

    try {
      const res = await messengerApi.setDialogAiEnabled(dialogKey, enabled)
      const nextEnabled = res.dialog?.aiEnabled ?? enabled
      setDialogs((prev) =>
        prev.map((d) => (normalizeId(d._id) === dialogKey ? { ...d, aiEnabled: nextEnabled } : d))
      )
      if (!silent) {
        addToast(
          nextEnabled ? 'Автоответ ИИ включён' : 'Автоответ ИИ выключен',
          nextEnabled ? 'success' : 'info'
        )
      }
      return true
    } catch (error) {
      console.error('Failed to toggle AI:', error)
      setDialogs((prev) =>
        prev.map((d) => (normalizeId(d._id) === dialogKey ? { ...d, aiEnabled: previousEnabled } : d))
      )
      if (!silent) addToast('Не удалось изменить настройку ИИ', 'error')
      return false
    }
  }, [activeId, addToast])

  const handleSendModeChange = useCallback((mode: SendMode) => {
    setSendModeSelectOpen(false)
    if (mode === 'generate') {
      setGenerateModeDialogKey(normalizeId(activeIdRef.current) ?? null)
      return
    }
    setGenerateModeDialogKey(null)
    void setDialogAiEnabled(mode === 'ai', true)
  }, [setDialogAiEnabled])

  const removeDialogFromState = useCallback((dialogId: string) => {
    const dialogKey = normalizeId(dialogId)
    if (!dialogKey) return

    setDialogs((prev) => {
      const remaining = prev.filter((d) => normalizeId(d._id) !== dialogKey)
      if (normalizeId(activeIdRef.current) === dialogKey) {
        const nextActive = remaining[0] ? normalizeId(remaining[0]._id) ?? '' : ''
        setActiveId(nextActive)
        setDraft('')
        setSendModeSelectOpen(false)
      }
      return remaining
    })

    setMessages((prev) => {
      if (!(dialogKey in prev)) return prev
      const next = { ...prev }
      delete next[dialogKey]
      return next
    })

    setLoadedHistoryIds((prev) => {
      if (!prev.has(dialogKey)) return prev
      const next = new Set(prev)
      next.delete(dialogKey)
      return next
    })
  }, [])

  // Load accounts and initial dialogs
  useEffect(() => {
    const init = async () => {
      try {
        const res = await messengerApi.getAccounts()
        const accountsData = res.accounts || []
        const allAccounts = Array.isArray(accountsData) ? accountsData : []
        const uniqueAccounts = allAccounts.filter((v, i, a) => a.findIndex(t => t._id === v._id) === i)
        const connectedAccounts = uniqueAccounts.filter((a) => isMessengerAccountConnected(a as Account))
        setAccounts(connectedAccounts)

        if (connectedAccounts.length > 0) {
          const allDialogs: Dialog[] = []
          for (const account of connectedAccounts) {
            const dRes = await messengerApi.getDialogs(account._id)
            const accountDialogs = dRes.dialogs || []
            if (Array.isArray(accountDialogs)) {
              allDialogs.push(...accountDialogs)
            }
          }
          setDialogs(allDialogs)
          if (allDialogs.length > 0) {
            setActiveId(allDialogs[0]._id)
          }
        }
      } catch (error: any) {
        console.error('Failed to load chats:', error)
        if (error.response?.status === 401) {
          addToast('Сессия мессенджеров истекла. Пожалуйста, перезайдите в систему.', 'error')
        }
      } finally {
        setIsChatsListLoading(false)
      }

      // Проверяем статус CRM-токена
      try {
        const crmRes = await messengerApi.getCrmStatus()
        setCrmStatus(crmRes)
      } catch {
        setCrmStatus({ hasCrmCredentials: false, crmConnected: false })
      }
    }
    init()
  }, [])

  const handleCrmReconnect = useCallback(async () => {
    const raw = localStorage.getItem('crm_credentials')
    if (!raw) {
      addToast('Нет сохранённых данных для входа. Перезайдите в систему.', 'error')
      return
    }
    const { email, password } = JSON.parse(raw)
    if (!email || !password) {
      addToast('Нет сохранённых данных для входа. Перезайдите в систему.', 'error')
      return
    }
    setCrmReconnecting(true)
    try {
      const res = await messengerApi.saveCrmCredentials(email, password)
      if (res.error) {
        addToast(res.error, 'error')
        return
      }
      const status = await messengerApi.getCrmStatus()
      setCrmStatus(status)
      if (status.crmConnected) {
        addToast('CRM подключён', 'success')
      } else {
        addToast('Не удалось подключить CRM. Попробуйте перезайти.', 'error')
      }
    } catch {
      addToast('Ошибка подключения CRM', 'error')
    } finally {
      setCrmReconnecting(false)
    }
  }, [addToast])

  // Socket setup
  useEffect(() => {
    const socket = getMessengerSocket()

    socket.on('message:new', (payload: any) => {
      const eventDialogId = normalizeId(payload.dialogId ?? payload.message?.dialogId)
      const rawMessage: Message = payload.message || payload

      if (!rawMessage || !rawMessage._id || !eventDialogId) {
        console.warn('[Socket] Invalid message payload', payload)
        return
      }

      const message: Message = {
        ...rawMessage,
        dialogId: eventDialogId,
        isAiReply: Boolean(payload.isAiReply ?? rawMessage.isAiReply),
      }

      const hidden = isHiddenChatMessage(message)

      if (message.fromMe && (message.isAiReply || payload.isAiReply)) {
        setAiProcessingDialogIds((prev) => {
          if (!prev.has(eventDialogId)) return prev
          const next = new Set(prev)
          next.delete(eventDialogId)
          return next
        })
      }

      if (!hidden) {
        setMessages((prev) => {
          const existing = prev[eventDialogId] || []
          const merged = mergeMessages(existing, [message])
          if (merged.length === existing.length && existing.some((m) => normalizeId(m._id) === normalizeId(message._id))) {
            return prev
          }
          return {
            ...prev,
            [eventDialogId]: merged,
          }
        })
      }

      setDialogs((prev) => {
        const dialogExists = prev.some((d) => normalizeId(d._id) === eventDialogId)

        if (!dialogExists) {
          const accountId = normalizeId(payload.accountId)
          if (accountId) {
            fetchAndMergeMissingDialogs(accountId, setDialogs)
          }
          return prev
        }

        if (hidden) return prev

        const updated = prev.map((d) => (
          normalizeId(d._id) === eventDialogId
            ? {
                ...d,
                lastMessage: {
                  text: message.text,
                  timestamp: message.sentAt,
                  fromMe: message.fromMe,
                },
                unreadCount: resolveUnreadCount(
                  eventDialogId,
                  (message.fromMe || activeIdRef.current === eventDialogId)
                    ? (d.unreadCount || 0)
                    : (d.unreadCount || 0) + 1,
                  activeIdRef.current,
                ),
              }
            : d
        ))

        return sortDialogsByLastMessage(updated)
      })

      if (!message.fromMe && activeIdRef.current === eventDialogId) {
        scheduleMarkDialogRead(eventDialogId)
      }
    })

    socket.on('dialog:updated', (payload: Partial<Dialog> & { dialogId?: string }) => {
      const dialogId = normalizeId(payload.dialogId ?? payload._id)
      if (!dialogId) return

      if (
        payload.lastMessage?.timestamp &&
        activeIdRef.current === dialogId
      ) {
        reloadDialogMessages(dialogId, setMessages)
      }

      const isNewDialog = dialogsRef.current.findIndex((d) => normalizeId(d._id) === dialogId) < 0
      const shouldAutoEnableAi =
        getGlobalAiEnabled() &&
        isNewDialog &&
        typeof payload.aiEnabled !== 'boolean'

      setDialogs((prev) => {
        const idx = prev.findIndex((d) => normalizeId(d._id) === dialogId)
        const accountId = normalizeId(payload.accountId) ?? (idx >= 0 ? normalizeId(prev[idx].accountId) : undefined)
        const serverUnread = typeof payload.unreadCount === 'number'
          ? payload.unreadCount
          : (idx >= 0 ? (prev[idx].unreadCount || 0) : 0)

        const merged: Dialog = {
          ...(idx >= 0 ? prev[idx] : {
            _id: dialogId,
            accountId: accountId || '',
            platform: payload.platform || 'telegram',
            externalChatId: payload.externalChatId || '',
            name: payload.name || 'Чат',
            unreadCount: 0,
          }),
          ...payload,
          _id: dialogId,
          accountId: accountId || (idx >= 0 ? prev[idx].accountId : ''),
          isOnline: typeof payload.isOnline === 'boolean' ? payload.isOnline : (idx >= 0 ? prev[idx].isOnline : false),
          avatarUrl: payload.avatarUrl ?? (idx >= 0 ? prev[idx].avatarUrl : undefined),
          aiEnabled: typeof payload.aiEnabled === 'boolean'
            ? payload.aiEnabled
            : (idx >= 0 ? prev[idx].aiEnabled : getGlobalAiEnabled()),
          aiSettings: useMessengerAiSettingsStore.getState().isPending(dialogId)
            ? (idx >= 0 ? prev[idx].aiSettings : payload.aiSettings)
            : (payload.aiSettings ?? (idx >= 0 ? prev[idx].aiSettings : undefined)),
          clientDossier: payload.clientDossier ?? (idx >= 0 ? prev[idx].clientDossier : undefined),
          unreadCount: resolveUnreadCount(dialogId, serverUnread, activeIdRef.current),
        }

        if (idx >= 0) {
          const next = [...prev]
          next[idx] = merged
          return sortDialogsByLastMessage(next)
        }

        return sortDialogsByLastMessage([...prev, merged])
      })

      if (shouldAutoEnableAi) {
        void messengerApi.setDialogAiEnabled(dialogId, true).catch((error) => {
          console.error('Failed to auto-enable AI for new dialog:', error)
        })
      }

      if (activeIdRef.current === dialogId) {
        scheduleMarkDialogRead(dialogId)
      }
    })

    socket.on('whatsapp:disconnected', (payload: { accountId: string }) => {
      console.warn('[Socket] WhatsApp disconnected:', payload.accountId);
      addToast('Сессия WhatsApp разорвана', 'error');
      setAccounts(prev => prev.map(a => a._id === payload.accountId ? { ...a, isActive: false } : a));
      
      // Закрываем активный чат, если он принадлежит этому аккаунту
      setDialogs(prev => {
        if (prev.some(d => d.accountId === payload.accountId && d._id === activeIdRef.current)) {
          setActiveId('');
        }
        return prev;
      });
    })

    socket.on('account:updated', (account: Account) => {
      setAccounts(prev => prev.map(a => a._id === account._id ? account : a));
      
      if (!account.isActive) {
        addToast(`Аккаунт ${account.name} деактивирован или сессия истекла`, 'error');
        setDialogs(prev => {
          if (prev.some(d => d.accountId === account._id && d._id === activeIdRef.current)) {
            setActiveId('');
          }
          return prev;
        });
      }
    })

    socket.on('message:updated', (payload: {
      messageId?: unknown
      externalMessageId?: string
      dialogId?: unknown
      text?: string
      isRevoked?: boolean
      isEdited?: boolean
    }) => {
      const messageId = normalizeId(payload.messageId)
      const externalMessageId = payload.externalMessageId
      const explicitDialogId = normalizeId(payload.dialogId)

      setMessages((prev) => {
        const dialogId = explicitDialogId
          ?? Object.keys(prev).find((id) =>
            prev[id]?.some((m) =>
              (messageId && normalizeId(m._id) === messageId) ||
              (externalMessageId && m.externalMessageId === externalMessageId)
            )
          )

        if (!dialogId || !prev[dialogId]) {
          if (explicitDialogId) {
            reloadDialogMessages(explicitDialogId, setMessages)
          }
          return prev
        }

        const { messages: updated, matched } = applyMessageUpdate(prev[dialogId], {
          messageId,
          externalMessageId,
          text: payload.text,
          isRevoked: payload.isRevoked,
          isEdited: payload.isEdited,
        })

        if (!matched && explicitDialogId) {
          reloadDialogMessages(explicitDialogId, setMessages)
        }

        return { ...prev, [dialogId]: updated }
      })

      if (explicitDialogId && payload.isRevoked) {
        setDialogs((prev) => prev.map((d) => {
          if (normalizeId(d._id) !== explicitDialogId || !d.lastMessage) return d
          return {
            ...d,
            lastMessage: {
              ...d.lastMessage,
              text: DELETED_MESSAGE_TEXT,
            },
          }
        }))
      }
    })

    socket.on('message:status', (payload: {
      messageId?: unknown
      externalMessageId?: string
      dialogId?: unknown
      status: Message['status']
    }) => {
      if (!payload?.status) return

      const messageId = normalizeId(payload.messageId)
      const externalMessageId = payload.externalMessageId
      const explicitDialogId = normalizeId(payload.dialogId)

      setMessages(prev => {
        const dialogId = explicitDialogId
          ?? Object.keys(prev).find((id) =>
            prev[id]?.some((m) =>
              m.fromMe && (
                (messageId && normalizeId(m._id) === messageId) ||
                (externalMessageId && m.externalMessageId === externalMessageId)
              )
            )
          )

        if (!dialogId || !prev[dialogId]) return prev

        const updated = prev[dialogId].map((m) => {
          const matches =
            m.fromMe && (
              (messageId && normalizeId(m._id) === messageId) ||
              (externalMessageId && m.externalMessageId === externalMessageId)
            )
          if (!matches) return m
          return { ...m, status: pickHigherStatus(m.status, payload.status) }
        })

        return { ...prev, [dialogId]: updated }
      })
    })

    socket.on('whatsapp:sync_completed', () => {
      const currentActiveId = activeIdRef.current
      if (!currentActiveId) return

      messengerApi.getMessages(currentActiveId).then((res) => {
        const msgs = res.messages || []
        setMessages(prev => ({
          ...prev,
          [currentActiveId]: mergeMessages(prev[currentActiveId] || [], msgs),
        }))
      }).catch((err) => console.error('Failed to refresh messages after sync:', err))
    })

    const refreshAccountDialogs = (accountId: string) => {
      messengerApi.getDialogs(accountId).then((dRes) => {
        const accountDialogs = dRes.dialogs || []
        if (!Array.isArray(accountDialogs)) return
        setDialogs((prev) => {
          const others = prev.filter((d) => normalizeId(d.accountId) !== accountId)
          const merged = sortDialogsByLastMessage([...others, ...accountDialogs])
          if (!activeIdRef.current && merged.length > 0) {
            setActiveId(merged[0]._id)
          }
          return merged
        })
      }).catch((err) => console.error('Failed to refresh dialogs after Telegram sync:', err))
    }

    socket.on('telegram:sync_completed', (payload: { accountId?: string }) => {
      const accountId = normalizeId(payload?.accountId)
      if (!accountId) return
      refreshAccountDialogs(accountId)

      const currentActiveId = activeIdRef.current
      if (!currentActiveId) return
      const activeDialog = dialogsRef.current.find((d) => normalizeId(d._id) === currentActiveId)
      if (!activeDialog || normalizeId(activeDialog.accountId) !== accountId) return

      messengerApi.getMessages(currentActiveId).then((res) => {
        const msgs = res.messages || []
        setMessages((prev) => ({
          ...prev,
          [currentActiveId]: mergeMessages(prev[currentActiveId] || [], msgs),
        }))
      }).catch((err) => console.error('Failed to refresh messages after Telegram sync:', err))
    })

    socket.on('telegram:authenticated', (payload: { accountId?: string }) => {
      const accountId = normalizeId(payload?.accountId)
      if (accountId) refreshAccountDialogs(accountId)
    })

    socket.on('ai:processing', (payload: { dialogId?: string; active?: boolean }) => {
      const eventDialogId = normalizeId(payload?.dialogId)
      if (!eventDialogId) return
      setAiProcessingDialogIds((prev) => {
        const next = new Set(prev)
        if (payload.active) next.add(eventDialogId)
        else next.delete(eventDialogId)
        return next
      })
    })

    socket.on('ai:reply_failed', (payload: { dialogId?: string; message?: string }) => {
      const eventDialogId = normalizeId(payload?.dialogId)
      if (eventDialogId) {
        setAiProcessingDialogIds((prev) => {
          const next = new Set(prev)
          next.delete(eventDialogId)
          return next
        })
      }
      if (eventDialogId && activeIdRef.current && eventDialogId !== activeIdRef.current) return
      addToast(payload?.message || 'ИИ не смог ответить', 'error')
    })

    socket.on('dialog:deleted', (payload: { dialogId?: string }) => {
      const dialogId = normalizeId(payload?.dialogId)
      if (!dialogId) return
      removeDialogFromState(dialogId)
    })

    socket.on('dialog:dossier_updated', (payload: { dialogId?: string; clientDossier?: ClientDossier }) => {
      const dialogId = normalizeId(payload?.dialogId)
      if (!dialogId || !payload.clientDossier) return
      setDialogs((prev) =>
        prev.map((d) => (
          normalizeId(d._id) === dialogId ? { ...d, clientDossier: payload.clientDossier } : d
        ))
      )
    })

    socket.on('crm:lead_update', (data: any) => {
      const dialogId = normalizeId(data?.dialogId)
      if (!dialogId) return

      if (data.action === 'create_lead' || data.action === 'link_lead') {
        setDialogs((prev) =>
          prev.map((d) =>
            normalizeId(d._id) === dialogId
              ? { ...d, crmLeadId: data.leadId || undefined, crmLeadStage: data.stage || undefined, lastCrmSyncAt: new Date().toISOString() }
              : d
          )
        )
      } else if (data.shouldMove) {
        setDialogs((prev) =>
          prev.map((d) =>
            normalizeId(d._id) === dialogId
              ? { ...d, crmLeadStage: data.stage || undefined, lastCrmSyncAt: new Date().toISOString() }
              : d
          )
        )
      }

      if (data.notification) {
        addToast(data.notification, 'info')
      }
    })

    socket.on('crm:context_update', (data: any) => {
      const dialogId = normalizeId(data?.dialogId)
      if (!dialogId || !data?.crmContext) return
      setDialogs((prev) =>
        prev.map((d) =>
          normalizeId(d._id) === dialogId
            ? { ...d, crmContext: data.crmContext }
            : d
        )
      )
    })

    socket.on('crm:action_required', async (data: any) => {
      const dialogId = normalizeId(data?.dialogId)
      if (!dialogId) return

      const { action, payload } = data

      if (action === 'move_stage' && payload?.leadId && payload?.suggestedStage) {
        try {
          const result = await messengerApi.crmMoveLeadStage(payload.leadId, payload.suggestedStage, payload.reason)
          if (result.success && result.data) {
            setDialogs((prev) =>
              prev.map((d) =>
                normalizeId(d._id) === dialogId
                  ? { ...d, crmLeadStage: (result.data as any).stage, lastCrmSyncAt: new Date().toISOString() }
                  : d
              )
            )
            addToast(`Лид перемещён: ${(result.data as any).stage}`, 'success')
          }
        } catch (err: any) {
          console.error('[CRM] move_stage failed:', err)
        }
        return
      }

      if (action === 'add_history' && payload?.leadId && payload?.message) {
        try {
          const result = await messengerApi.crmAddLeadHistory(payload.leadId, payload.message, payload.comment)
          if (result.success) {
            addToast('Комментарий добавлен к этапу', 'success')
          }
        } catch (err: any) {
          console.error('[CRM] add_history failed:', err)
        }
        return
      }

      if (action === 'already_linked') {
        setDialogs((prev) =>
          prev.map((d) =>
            normalizeId(d._id) === dialogId
              ? { ...d, crmLeadStage: payload?.stage || d.crmLeadStage, lastCrmSyncAt: new Date().toISOString() }
              : d
          )
        )
        return
      }

      if (action === 'update_lead' && payload?.leadId) {
        try {
          const fields = (payload.updatedFields as Record<string, unknown>) || {}
          const result = await messengerApi.crmUpdateLead(payload.leadId, fields)
          if (result.success && result.data) {
            setDialogs((prev) =>
              prev.map((d) =>
                normalizeId(d._id) === dialogId
                  ? { ...d, crmLeadStage: (result.data as any).stage, lastCrmSyncAt: new Date().toISOString() }
                  : d
              )
            )
            const updatedNames = Object.keys(fields).join(', ')
            addToast(`Данные лида обновлены: ${updatedNames}`, 'success')
          } else {
            addToast(result.message || 'Не удалось обновить данные лида', 'error')
          }
        } catch (err: any) {
          console.error('[CRM] update_lead failed:', err)
          addToast('Ошибка обновления данных лида', 'error')
        }
        return
      }

      if (action === 'create_task' && payload?.leadId && payload?.taskTitle) {
        addToast(
          `📋 ${payload.taskTitle}${payload.taskCategory ? ` [${payload.taskCategory}]` : ''}`,
          'info'
        )
        return
      }

    })

    socket.on('owner-ai:updated', (payload: {
      dialogId?: string
      messages?: OwnerAiChatMessage[]
      directives?: string
      completedDirectives?: string
    }) => {
      const eventDialogId = normalizeId(payload?.dialogId)
      const currentActiveId = activeIdRef.current
      if (!eventDialogId || eventDialogId !== currentActiveId) return
      if (payload.messages?.length) {
        setOwnerAiMessages((prev) => {
          const known = new Set(prev.map((m) => m._id))
          const next = [...prev]
          for (const msg of payload.messages!) {
            if (!known.has(msg._id)) next.push(msg)
          }
          return next
        })
      }
      if (payload.directives !== undefined) {
        setOwnerAiDirectives(payload.directives)
        setDialogs((prev) =>
          prev.map((d) => (
            normalizeId(d._id) === eventDialogId
              ? { ...d, ownerAiDirectives: payload.directives }
              : d
          ))
        )
      }
      if (payload.completedDirectives !== undefined) {
        setOwnerAiCompletedDirectives(payload.completedDirectives)
      }
    })

    socket.on('self-task:created', (payload: { dialogId?: string; task?: IAiSelfTask }) => {
      if (!payload?.task) return
      const eventDialogId = normalizeId(payload.dialogId)
      const currentActiveId = activeIdRef.current
      if (eventDialogId && eventDialogId === currentActiveId) {
        addToast('Новая самозадача создана', 'success')
        refreshBadgeCountsRef.current?.()
      }
    })

    socket.on('self-task:completed', (payload: { dialogId?: string; task?: IAiSelfTask }) => {
      if (!payload?.task) return
      const eventDialogId = normalizeId(payload.dialogId)
      const currentActiveId = activeIdRef.current
      if (eventDialogId && eventDialogId === currentActiveId) {
        addToast(`Задача "${payload.task.title}" выполнена`, 'success')
        refreshBadgeCountsRef.current?.()
      }
    })

    socket.on('self-task:overdue', (payload: { dialogId?: string; taskId?: string }) => {
      const eventDialogId = normalizeId(payload.dialogId)
      const currentActiveId = activeIdRef.current
      if (eventDialogId && eventDialogId === currentActiveId) {
        addToast('Задача просрочена', 'info')
        refreshBadgeCountsRef.current?.()
      }
    })

    socket.on('self-task:limit_reached', () => {
      addToast('Достигнут лимит самозадач', 'info')
    })

    return () => {
      socket.off('message:new')
      socket.off('dialog:updated')
      socket.off('whatsapp:disconnected')
      socket.off('account:updated')
      socket.off('message:updated')
      socket.off('message:status')
      socket.off('whatsapp:sync_completed')
      socket.off('telegram:sync_completed')
      socket.off('telegram:authenticated')
      socket.off('ai:processing')
      socket.off('ai:reply_failed')
      socket.off('dialog:deleted')
      socket.off('dialog:dossier_updated')
      socket.off('crm:lead_update')
      socket.off('crm:context_update')
      socket.off('crm:action_required')
      socket.off('ai:history_updated')
      socket.off('owner-ai:updated')
      socket.off('self-task:created')
      socket.off('self-task:completed')
      socket.off('self-task:overdue')
      socket.off('self-task:limit_reached')
    }
  }, [addToast, removeDialogFromState, scheduleMarkDialogRead])

  // Mark dialog as read when opened (Telegram read sync + local unread reset)
  useEffect(() => {
    if (!activeId) return
    const dialog = dialogsRef.current.find((d) => normalizeId(d._id) === activeId)
    if (!dialog) return

    messengerApi.markDialogRead(activeId)
      .then(() => {
        setDialogs((prev) =>
          prev.map((d) => (normalizeId(d._id) === activeId ? { ...d, unreadCount: 0 } : d))
        )
      })
      .catch((err) => console.error('Failed to mark dialog read:', err))
  }, [activeId])

  // Счётчик активных задач ИИ для бейджа на вкладке «Задачи»
  const refreshBadgeCounts = useCallback(() => {
    if (!activeId) {
      setSelfTasksActiveCount(0)
      return
    }
    void selfTaskApi.getTasks(activeId, { status: 'scheduled', limit: 1 })
      .then((res) => setSelfTasksActiveCount(res?.data?.total || 0))
      .catch(() => setSelfTasksActiveCount(0))
  }, [activeId])

  useEffect(() => { refreshBadgeCountsRef.current = refreshBadgeCounts }, [refreshBadgeCounts])
  useEffect(() => { refreshBadgeCounts() }, [refreshBadgeCounts])



  useEffect(() => {
    if (!activeId) {
      setOwnerAiMessages([])
      setOwnerAiDirectives('')
      setOwnerAiCompletedDirectives('')
      setOwnerAiDraft('')
      return
    }
    setOwnerAiLoading(true)
    messengerApi.getOwnerAiChat(activeId)
      .then((res) => {
        setOwnerAiMessages(res.messages || [])
        setOwnerAiDirectives(res.directives || '')
        setOwnerAiCompletedDirectives(res.completedDirectives || '')
      })
      .catch(() => {
        setOwnerAiMessages([])
        setOwnerAiDirectives('')
      })
      .finally(() => setOwnerAiLoading(false))
  }, [activeId])

  useEffect(() => {
    if (rightTab !== 'ownerAi') return
    const el = ownerAiScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [ownerAiMessages, rightTab, ownerAiSending])

  useEffect(() => {
    setRightTab('ai')
    setSendModeSelectOpen(false)
    setGenerateModeDialogKey(null)
  }, [activeId])

  // Кнопка режима отправки всегда отражает фактический aiEnabled диалога — и при
  // смене диалога, и когда настройка меняется фоном (диалог создан с автоответом,
  // webhook, откат после ошибки сохранения).
  const activeAiEnabled = useMemo(() => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey) return false
    return Boolean(dialogs.find((d) => normalizeId(d._id) === dialogKey)?.aiEnabled)
  }, [activeId, dialogs])

  const sendMode: SendMode = useMemo(() => {
    const dialogKey = normalizeId(activeId)
    if (dialogKey && generateModeDialogKey === dialogKey) return 'generate'
    return activeAiEnabled ? 'ai' : 'normal'
  }, [activeId, generateModeDialogKey, activeAiEnabled])

  // Load messages for active dialog
  useEffect(() => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey) {
      setLoadingDialogId(null)
      return
    }

    if (loadedHistoryIds.has(dialogKey)) {
      setLoadingDialogId((current) => (current === dialogKey ? null : current))
      return
    }

    setLoadingDialogId(dialogKey)
    let cancelled = false

    messengerApi.getMessages(dialogKey)
      .then((res) => {
        if (cancelled) return
        const msgs = res.messages || []
        setMessages((prev) => ({
          ...prev,
          [dialogKey]: mergeMessages(prev[dialogKey] || [], msgs),
        }))
        setLoadedHistoryIds((prev) => {
          const next = new Set(prev)
          next.add(dialogKey)
          return next
        })
      })
      .catch((err) => {
        console.error('Failed to load messages:', err)
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDialogId((current) => (current === dialogKey ? null : current))
        }
    })

    return () => {
      cancelled = true
    }
  }, [activeId, loadedHistoryIds])

  useEffect(() => {
    if (!activeId) return

    const dialog = dialogsRef.current.find((d) => normalizeId(d._id) === activeId)
    if (!dialog || dialog.platform !== 'whatsapp' || !isPrivateDialog(dialog)) return

    let cancelled = false

    const refreshPresence = () => {
      messengerApi.refreshDialogPresence(activeId)
        .then((res) => {
          if (cancelled || !res.dialog) return
          setDialogs((prev) => prev.map((d) => (
            normalizeId(d._id) === activeId
              ? { ...d, isOnline: res.dialog!.isOnline === true }
              : d
          )))
        })
        .catch((err) => console.error('Failed to refresh dialog presence:', err))
    }

    refreshPresence()
    const interval = setInterval(refreshPresence, 45_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeId])

  const handleSyncDialogs = async () => {
    if (!Array.isArray(accounts) || accounts.length === 0) return
    try {
      setIsSyncing(true)
      addToast('Синхронизация чатов...', 'info')
      await Promise.all(accounts.map((acc) => messengerApi.syncDialogs(acc._id)))

      const allDialogs: Dialog[] = []
      for (const account of accounts) {
        const dRes = await messengerApi.getDialogs(account._id)
        const accountDialogs = dRes.dialogs || []
        if (Array.isArray(accountDialogs)) {
          allDialogs.push(...accountDialogs)
        }
      }
      setDialogs(allDialogs)

      if (activeIdRef.current) {
        const currentActiveId = activeIdRef.current
        const res = await messengerApi.getMessages(currentActiveId)
        const msgs = res.messages || []
        setMessages(prev => ({
          ...prev,
          [currentActiveId]: mergeMessages(prev[currentActiveId] || [], msgs),
        }))
      }

      addToast('Синхронизация завершена', 'success')
    } catch (error) {
      console.error('Failed to sync dialogs:', error)
      addToast('Ошибка при синхронизации чатов', 'error')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleDeleteDialog = async () => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey) return
    if (!window.confirm('Удалить этот чат? Переписка будет очищена у вас и у собеседника (если платформа это поддерживает).')) return

    removeDialogFromState(dialogKey)

    try {
      await messengerApi.deleteDialog(dialogKey)
      addToast('Чат удалён', 'success')
    } catch (error) {
      console.error('Failed to delete dialog:', error)
      addToast('Ошибка при удалении чата', 'error')
      const accountIds = accounts.map((a) => a._id)
      for (const accountId of accountIds) {
        try {
          const res = await messengerApi.getDialogs(accountId)
          const accountDialogs = res.dialogs || []
          if (Array.isArray(accountDialogs)) {
            setDialogs((prev) => {
              const others = prev.filter((d) => normalizeId(d.accountId) !== accountId)
              return sortDialogsByLastMessage([...others, ...accountDialogs])
            })
          }
        } catch {
          // ignore reload errors
        }
      }
    }
  }

  const handleCrmSync = async () => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey || crmSyncing) return
    setCrmSyncing(true)
    try {
      const result = await messengerApi.syncCrm(dialogKey)
      if (result.success) {
        if (result.analysis?.crmLeadId) {
          setDialogs((prev) =>
            prev.map((d) =>
              normalizeId(d._id) === dialogKey
                ? { ...d, crmLeadId: result.analysis!.crmLeadId, crmLeadStage: result.analysis!.currentStage, lastCrmSyncAt: new Date().toISOString() }
                : d
            )
          )
        }
        const summary = result.actions.length > 0 ? result.actions.join('; ') : 'Обновлено'
        addToast(`CRM синхронизировано: ${summary}`, 'success')
      } else {
        addToast(result.error || 'Ошибка синхронизации CRM', 'error')
      }
    } catch (err) {
      console.error('[CRM] sync failed:', err)
      addToast('Ошибка синхронизации CRM', 'error')
    } finally {
      setCrmSyncing(false)
    }
  }

  const handleSendOwnerAiMessage = async () => {
    const dialogKey = normalizeId(activeId)
    const text = ownerAiDraft.trim()
    if (!dialogKey || !text || ownerAiSending) return

    setOwnerAiSending(true)
    setOwnerAiDraft('')
    try {
      const result = await messengerApi.sendOwnerAiChatMessage(dialogKey, text)
      if (result.ownerMessage) {
        setOwnerAiMessages((prev) => {
          if (prev.some((m) => m._id === result.ownerMessage!._id)) return prev
          return [...prev, result.ownerMessage!]
        })
      }
      if (result.assistantMessage) {
        setOwnerAiMessages((prev) => {
          if (prev.some((m) => m._id === result.assistantMessage!._id)) return prev
          return [...prev, result.assistantMessage!]
        })
      }
      if (result.directives !== undefined) {
        setOwnerAiDirectives(result.directives)
        setDialogs((prev) =>
          prev.map((d) => (
            normalizeId(d._id) === dialogKey
              ? { ...d, ownerAiDirectives: result.directives }
              : d
          ))
        )
      }
      if (result.completedDirectives !== undefined) {
        setOwnerAiCompletedDirectives(result.completedDirectives)
      }
    } catch (err) {
      console.error('Failed to send owner AI message:', err)
      setOwnerAiDraft(text)
      addToast('Не удалось отправить сообщение ИИ', 'error')
    } finally {
      setOwnerAiSending(false)
    }
  }

  const appendSentMessage = useCallback((dialogId: string, message: Message) => {
    setMessages((prev) => {
      const existing = prev[dialogId] || []
      if (existing.some((m) => m._id === message._id)) return prev
      return {
        ...prev,
        [dialogId]: [...existing, message].sort((a, b) => {
          const aTime = new Date(a.sentAt || Date.now()).getTime()
          const bTime = new Date(b.sentAt || Date.now()).getTime()
          return aTime - bTime
        }),
      }
    })

    const dialogKey = normalizeId(dialogId)
    setDialogs((prev) => {
      const updated = prev.map((d) => (
        normalizeId(d._id) === dialogKey
          ? {
              ...d,
              lastMessage: {
                text: formatMessageContent(message),
                timestamp: message.sentAt,
                fromMe: true,
              },
            }
          : d
      ))

      return [...updated].sort((a, b) => {
        const aTime = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0
        const bTime = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0
        return bTime - aTime
      })
    })
  }, [])

  const activeDialogKey = normalizeId(activeId)
  const isAiProcessing = Boolean(
    activeDialogKey && aiProcessingDialogIds.has(activeDialogKey),
  )

  const isSendBusy = isSendingMedia || isComposing || isAiProcessing

  useEffect(() => {
    if (!sendModeSelectOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (sendModeSelectRef.current && !sendModeSelectRef.current.contains(event.target as Node)) {
        setSendModeSelectOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [sendModeSelectOpen])

  const buildLeadContext = useCallback(async (dialog: Dialog): Promise<CrmLeadContext | undefined> => {
    if (!dialog.crmLeadId) return undefined
    try {
      const leadRes = await messengerApi.crmGetLead(dialog.crmLeadId)
      if (!leadRes.success || !leadRes.data) return undefined
      const lead = leadRes.data
      return {
        leadId: lead._id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        stage: lead.stage,
        productType: lead.productType,
        source: lead.source,
        notes: lead.notes,
        dealValue: lead.dealValue,
        tags: lead.tags,
      }
    } catch (err) {
      console.error('[CRM] buildLeadContext failed:', err)
      return undefined
    }
  }, [])

  const handleSend = async () => {
    if (!activeId || isSendBusy) return
    const mode = sendMode

    const config = SEND_MODE_CONFIG[mode]
    const hint = draft.trim() || undefined
    const dialogKey = normalizeId(activeId)
    const currentDialog = dialogsRef.current.find((d) => normalizeId(d._id) === dialogKey)
    const aiSettings = resolveDialogAiSettingsFromStore(activeId, currentDialog)

    if (config.requiresDraft && !hint) {
      addToast('Введите сообщение для отправки', 'info')
      return
    }

    if (config.enablesAutoReply === false) {
      await setDialogAiEnabled(false, true)
    }

    if (mode === 'normal') {
      const text = draft.trim()
      setDraft('')
      try {
        const res = await messengerApi.sendMessage(activeId, text)
        if (res.success && res.message) {
          appendSentMessage(activeId, res.message)
        }
      } catch (error) {
        console.error('Failed to send message:', error)
        addToast('Ошибка при отправке сообщения', 'error')
      }
      return
    }

    const dialogKeyForAi = normalizeId(activeId)
    if (mode === 'ai' && dialogKeyForAi) {
      setDialogs((prev) =>
        prev.map((d) => (normalizeId(d._id) === dialogKeyForAi ? { ...d, aiEnabled: true } : d))
      )
    }

    setIsComposing(true)
    try {
      const leadContext = currentDialog ? await buildLeadContext(currentDialog) : undefined

      if (mode === 'ai') {
        const res = await messengerApi.sendAiMessage(activeId, hint, aiSettings, leadContext)
        if (res.success && res.message) {
          if (dialogKeyForAi) {
            setDialogs((prev) =>
              prev.map((d) => (
                normalizeId(d._id) === dialogKeyForAi ? { ...d, aiEnabled: res.aiEnabled ?? true } : d
              ))
            )
          }
          setDraft('')
          appendSentMessage(activeId, res.message)
          addToast('Сообщение отправлено · автоответ ИИ включён', 'success')
        } else if (dialogKeyForAi) {
          setDialogs((prev) =>
            prev.map((d) => (normalizeId(d._id) === dialogKeyForAi ? { ...d, aiEnabled: false } : d))
          )
        }
        return
      }

      const res = await messengerApi.generateMessage(activeId, hint, aiSettings, leadContext)
      if (res.success && res.text?.trim()) {
        const sendRes = await messengerApi.sendMessage(activeId, res.text.trim())
        if (sendRes.success && sendRes.message) {
          setDraft('')
          appendSentMessage(activeId, sendRes.message)
          addToast('Ответ сгенерирован и отправлен', 'success')
        }
      }
    } catch (error: any) {
      console.error('Failed to compose message:', error)
      if (mode === 'ai' && dialogKey) {
        setDialogs((prev) =>
          prev.map((d) => (normalizeId(d._id) === dialogKey ? { ...d, aiEnabled: false } : d))
        )
      }
      const message = error?.response?.data?.error
      if (error?.response?.status === 429) {
        addToast(message || 'Лимит Gemini API исчерпан', 'error')
      } else {
        addToast(message || 'Не удалось обработать сообщение через ИИ', 'error')
      }
    } finally {
      setIsComposing(false)
    }
  }

  const handleSendImage = async (file: File) => {
    if (!activeId) return

    if (!file.type.startsWith('image/')) {
      addToast('Можно отправить только изображение', 'error')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      addToast('Изображение не должно превышать 10 МБ', 'error')
      return
    }

    const caption = draft.trim()
    setDraft('')
    setIsSendingMedia(true)

    try {
      const res = await messengerApi.sendMedia(activeId, file, caption || undefined)
      if (res.success && res.message) {
        appendSentMessage(activeId, res.message)
      }
    } catch (error) {
      console.error('Failed to send image:', error)
      addToast('Ошибка при отправке изображения', 'error')
      if (caption) setDraft(caption)
    } finally {
      setIsSendingMedia(false)
    }
  }

  const handleImageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void handleSendImage(file)
  }

  const handleSendBroadcast = useCallback(async () => {
    if (!broadcastUnit || selectedLeadIds.length === 0) return
    const { unit, buildingName, projectName } = broadcastUnit
    const text = `🏠 [Лот ${unit.number}, ЖК "${projectName}" · ${buildingName}] ${unit.rooms}, ${unit.area} м², этаж ${unit.floor}. Цена: ${unit.price ? '$' + unit.price.toLocaleString('ru-RU') : 'по запросу'}`
    
    try {
      await Promise.all(selectedLeadIds.map(dialogId => messengerApi.sendMessage(dialogId, text)))
      setBroadcastUnit(null)
      setSelectedLeadIds([])
      setBroadcastSearch('')
    } catch (error) {
      console.error('Failed to send broadcast messages:', error)
    }
  }, [broadcastUnit, selectedLeadIds])

  const visibleDialogs = useMemo(() => {
    const q = search.trim().toLowerCase()
    const safeDialogs = Array.isArray(dialogs) ? dialogs : []
    return safeDialogs
      .filter((d) => {
        if (accountFilter !== 'all' && normalizeId(d.accountId) !== normalizeId(accountFilter)) return false
        if (!q) return true
        const qDigits = q.replace(/\D/g, '')
        return (
          d.name.toLowerCase().includes(q) ||
          (d.lastMessage?.text || '').toLowerCase().includes(q) ||
          (qDigits.length >= 3 && String(d.externalChatId || '').replace(/\D/g, '').includes(qDigits))
        )
      })
      .sort((a, b) => {
        const ta = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0
        const tb = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0
        return tb - ta
      })
  }, [dialogs, accountFilter, search])

  const filteredBroadcastDialogs = useMemo(() => {
    const q = broadcastSearch.trim().toLowerCase()
    const safeDialogs = Array.isArray(dialogs) ? dialogs : []
    if (!q) return safeDialogs
    return safeDialogs.filter(d => d.name.toLowerCase().includes(q) || d.externalChatId.toLowerCase().includes(q))
  }, [dialogs, broadcastSearch])

  const activeDialog = useMemo(() => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey || !Array.isArray(dialogs)) return null
    return dialogs.find((d) => normalizeId(d._id) === dialogKey) ?? null
  }, [dialogs, activeId])

  const isAiAutoReplyActive = Boolean(activeDialog?.aiEnabled)

  const isActiveChatLoading = Boolean(
    activeDialogKey
    && (loadingDialogId === activeDialogKey || !loadedHistoryIds.has(activeDialogKey))
  )

  const dossierBootstrappedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const dialogKey = normalizeId(activeId)
    if (!dialogKey || isActiveChatLoading) return
    if (dossierBootstrappedRef.current.has(dialogKey)) return

    const dialog = dialogsRef.current.find((d) => normalizeId(d._id) === dialogKey)
    const dossier = dialog?.clientDossier
    const shouldRefresh = !dossier?.summary || dossier.status === 'error'
    if (!shouldRefresh) {
      dossierBootstrappedRef.current.add(dialogKey)
      return
    }

    dossierBootstrappedRef.current.add(dialogKey)
    messengerApi.refreshClientDossier(dialogKey)
      .then((res) => {
        if (!res.clientDossier) return
        setDialogs((prev) =>
          prev.map((d) => (
            normalizeId(d._id) === dialogKey ? { ...d, clientDossier: res.clientDossier } : d
          ))
        )
      })
      .catch((err) => {
        console.error('Failed to refresh client dossier:', err)
        dossierBootstrappedRef.current.delete(dialogKey)
      })
  }, [activeId, isActiveChatLoading])

  const activeMessages = useMemo(() => {
    if (!activeDialogKey) return []
    return filterVisibleChatMessages(messages[activeDialogKey] || [])
  }, [activeDialogKey, messages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activeMessages])

  const grouped = useMemo(() => (activeMessages ? groupByDay(activeMessages) : []), [activeMessages])

  const suggestedMaterials = useMemo<LMSItem[]>(() => {
    return []
  }, [])

  /**
   * База знаний в боковой панели чата — те же материалы, что в разделе
   * «Обучение» (lmsApi). Раньше панель показывала первые 12 примеров из
   * `lms-mock.ts`: менеджер отправлял клиенту материал, которого в компании
   * нет, а материалы, которые компания действительно завела, сюда не попадали.
   */
  const { items: lmsItems, loading: lmsLoading, loadError: lmsError } = useLmsLibrary()
  const libraryItems = useMemo(() => lmsItems.slice(0, 12), [lmsItems])

  return (
    <DashboardShell>
      <div
        style={{
          height: VIEWPORT_H,
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'row',
          background: 'var(--app-bg)',
          overflow: 'hidden',
          fontFamily: "'Montserrat', sans-serif",
        }}
      >
        {/* ───── Левая колонка: список чатов ───── */}
        <aside
          style={{
            width: 320,
            minWidth: 320,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--app-bg)',
            borderRight: '1px solid var(--chat-border)',
          }}
        >
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 18, color: 'var(--gold)', fontWeight: 400 }}>
                {t('modules.chatsPage.чаты')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {Array.isArray(accounts) && accounts.length > 0 && (
                  <button
                    onClick={handleSyncDialogs}
                    disabled={isSyncing}
                    title={t('modules.chatsPage.синхронизировать_чат')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: isSyncing ? 'var(--chat-text-dim)' : 'var(--chat-gold-text)',
                      cursor: isSyncing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  >
                    <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                    {isSyncing ? 'Синхронизация...' : ''}
                  </button>
                )}
                <button
                  onClick={() => navigate('/dashboard/settings/chats')}
                  title={t('modules.chatsPage.настройки_чатов')}
                  aria-label={t('modules.chatsPage.настройки_чатов')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--chat-gold-text)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 0,
                  }}
                >
                  <Settings size={16} />
                </button>
              </div>
            </div>
            {!isChatsListLoading && accounts.length > 0 && (
              <div
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  padding: 2,
                  background: 'var(--chat-surface)',
                  borderRadius: 4,
                  border: '1px solid var(--green-border)',
                  width: '100%',
                  boxSizing: 'border-box',
                  overflowX: 'auto',
                  whiteSpace: 'nowrap',
                }}
              >
                {[{ _id: 'all', name: 'Все', platform: 'all' }, ...accounts].map((acc) => {
                  const accId = normalizeId(acc._id) || acc._id
                  const active = normalizeId(accountFilter) === accId
                  const isAll = acc._id === 'all'
                  const dotColor = isAll ? null : CHANNEL_META[acc.platform as ChatPlatform]?.color
                  return (
                    <button
                      key={accId}
                      type="button"
                      onClick={() => setAccountFilter(accId)}
                      style={{
                        flex: '1 1 0',
                        minWidth: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        height: 28,
                        borderRadius: 3,
                        border: 'none',
                        background: active ? 'color-mix(in srgb, var(--gold) 24%, transparent)' : 'transparent',
                        color: active ? 'var(--chat-gold-text)' : 'var(--chat-text-secondary)',
                        fontSize: 13,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'background 0.15s, color 0.15s',
                        padding: '0 12px',
                      }}
                    >
                      {dotColor && (
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, flexShrink: 0 }} />
                      )}
                      <span style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>{acc.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {!isChatsListLoading && crmStatus && !crmStatus.crmConnected && (
            <div style={{ padding: '10px 16px', background: 'var(--chat-surface)', borderBottom: '1px solid var(--green-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--chat-text-secondary)', fontSize: 13 }}>{t('modules.chatsPage.crm_не_подключ_н')}</span>
              <button
                onClick={handleCrmReconnect}
                disabled={crmReconnecting}
                style={{
                  marginLeft: 'auto',
                  padding: '4px 10px',
                  fontSize: 12,
                  border: '1px solid var(--green-border)',
                  borderRadius: 4,
                  background: crmReconnecting ? 'var(--green-border)' : 'transparent',
                  color: crmReconnecting ? 'var(--chat-text-secondary)' : 'var(--gold)',
                  cursor: crmReconnecting ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {crmReconnecting ? 'Подключение…' : 'Подключить'}
              </button>
            </div>
          )}

          {!isChatsListLoading && (
            <div style={{ padding: '0 16px 10px', position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 26, top: '50%', transform: 'translateY(-50%)', color: 'var(--chat-text-secondary)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('modules.chatsPage.поиск_по_чатам')}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px 10px 32px',
                  background: 'var(--chat-surface)',
                  border: '1px solid var(--green-border)',
                  borderRadius: 4,
                  color: 'var(--chat-text)',
                  fontFamily: 'inherit',
                  fontSize: 16,
                  outline: 'none',
                }}
              />
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isChatsListLoading ? (
              <ChatPanelLoader label={t('modules.chatsPage.загрузка_чатов')} />
            ) : (!Array.isArray(accounts) || accounts.length === 0) ? (
              <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center', lineHeight: 1.5 }}>
                  {t('modules.chatsPage.мессенджеры_не_подкл')}<br />
                  {t('modules.chatsPage.перейдите_в_настройк')}</div>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard/settings/chats')}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--gold)',
                    color: 'var(--chat-gold-on-bg)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 500,
                  }}
                >
                  {t('modules.chatsPage.настройки_чата')}</button>
              </div>
            ) : visibleDialogs.length === 0 ? (
              <div style={{ padding: '24px 16px', color: 'var(--chat-text-secondary)', fontSize: 16, textAlign: 'center' }}>
                {search.trim() ? 'Ничего не найдено' : 'Чатов пока нет'}
              </div>
            ) : (
              visibleDialogs.map((d) => {
                const last = d.lastMessage
                const isActive = activeDialog?._id === d._id
                const dialogKey = normalizeId(d._id)
                const isDialogAiProcessing = Boolean(dialogKey && aiProcessingDialogIds.has(dialogKey))
                return (
                  <button
                    key={d._id}
                    type="button"
                    onClick={() => setActiveId(d._id)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      gap: 12,
                      padding: '10px 16px',
                      border: 'none',
                      borderLeft: `3px solid ${isActive ? 'var(--gold)' : 'transparent'}`,
                      background: isActive ? 'rgba(201,168,76,0.08)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--chat-surface-hover)' }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    <ChatAvatar
                      name={d.name}
                      avatarUrl={d.avatarUrl}
                      platform={d.platform}
                      size={42}
                      showPlatformBadge
                      showOnlineIndicator={isDialogOnline(d)}
                      showAiBadge={Boolean(d.aiEnabled)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 16, color: 'var(--chat-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {d.name}
                        </span>
                        {last && (
                          <span style={{ fontSize: 13, color: 'var(--chat-text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {formatTime(last.timestamp)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: isDialogAiProcessing ? 'var(--chat-gold-text)' : 'var(--chat-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {isDialogAiProcessing ? (
                            <>
                              <Sparkles size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
                              {t('modules.chatsPage.ии_обрабатывает')}</>
                          ) : (
                            <>{last?.fromMe && 'Вы: '}{last?.text ?? ''}</>
                          )}
                        </span>
                        {d.unreadCount > 0 && (
                          <span
                            style={{
                              flexShrink: 0,
                              minWidth: 18, height: 18, padding: '0 6px',
                              borderRadius: 9,
                              background: 'var(--gold)',
                              color: 'var(--chat-gold-on-bg)',
                              fontSize: 11, fontWeight: 500,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {d.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* ───── Центральная колонка: диалог ───── */}
        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--app-bg)' }}>
          {!activeDialog ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--chat-text-secondary)', fontSize: 16 }}>
              {t('modules.chatsPage.выберите_чат')}</div>
          ) : (
            <>
              {/* Шапка диалога */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 20px',
                  background: 'var(--app-bg)',
                  borderBottom: '1px solid var(--chat-border)',
                }}
              >
                <ChatAvatar
                  name={activeDialog.name}
                  avatarUrl={activeDialog.avatarUrl}
                  platform={activeDialog.platform}
                  size={38}
                  fontSize={13}
                  showOnlineIndicator={isDialogOnline(activeDialog)}
                  showAiBadge={isAiAutoReplyActive}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, color: 'var(--chat-text-strong)' }}>{activeDialog.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--chat-text-secondary)' }}>
                    {isAiAutoReplyActive && (
                      <span style={{ color: 'var(--chat-error-text)', marginRight: 6 }}>
                        <Sparkles size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
                        {t('modules.chatsPage.автоответ_ии')}{' · '}
                      </span>
                    )}
                    {isAiProcessing && (
                      <span style={{ color: 'var(--chat-gold-text)', marginRight: 6 }}>
                        <Loader2 size={11} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4, animation: 'spin 1s linear infinite' }} />
                        {t('modules.chatsPage.ии_готовит_ответ')}{' · '}
                      </span>
                    )}
                    {isPrivateDialog(activeDialog) && activeDialog.platform === 'whatsapp' ? (
                      isDialogOnline(activeDialog) ? (
                        <span style={{ color: 'var(--chat-online-text)' }}>{t('modules.chatsPage.в_сети')}</span>
                      ) : (
                        <span style={{ color: 'var(--chat-away-text)' }}>{t('modules.chatsPage.не_в_сети')}</span>
                      )
                    ) : (
                      <>
                        {activeDialog.platform === 'telegram' ? 'Telegram' : 'WhatsApp'}
                        {' · '}
                        <span style={{ color: 'var(--chat-gold-text)' }}>{CHANNEL_META[activeDialog.platform].label}</span>
                      </>
                    )}
                  </div>
                  {activeDialog.crmLeadId && (
                    <div style={{ fontSize: 12, color: 'var(--chat-gold-text)', marginTop: 2 }}>
                      <Target size={10} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />
                      {STAGE_LABELS[activeDialog.crmLeadStage || ''] || activeDialog.crmLeadStage || 'CRM лид'}
                    </div>
                  )}
                </div>
                <button type="button" aria-label={t('modules.chatsPage.звонок')} style={iconBtnStyle}><Phone size={16} /></button>
                <button type="button" aria-label={t('modules.chatsPage.видеозвонок')} style={iconBtnStyle}><Video size={16} /></button>
                <button type="button" aria-label={t('modules.chatsPage.удалить_чат')} title={t('modules.chatsPage.удалить_чат')} onClick={handleDeleteDialog} style={{ ...iconBtnStyle, color: 'var(--chat-text-dim)', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--chat-text-dim)'}><Trash2 size={16} /></button>
              </div>

              {/* Лента сообщений */}
              <div
                ref={scrollRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px 24px',
                  background:
                    'var(--app-bg)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}
              >
                {isActiveChatLoading ? (
                  <ChatPanelLoader label={t('modules.chatsPage.загрузка_сообщений')} />
                ) : grouped.map((g) => (
                  <div key={g.day} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--chat-text-secondary)', letterSpacing: '0.06em', padding: '5px 12px', borderRadius: 4, background: 'var(--chat-surface-subtle)' }}>
                      {formatDate(g.items[0].sentAt)}
                    </div>
                    {g.items.map((m, i) => {
                      const own = m.fromMe
                      const content = formatMessageContent(m)
                      const deleted = isDeletedMessage(m)
                      const unrecognized = isUnrecognizedMessage(m)
                      const edited = Boolean(m.isEdited) && !deleted
                      const hasPhoto = Boolean(
                        !unrecognized
                        && !deleted
                        && m.messageType === 'photo'
                        && (m.media?.urls?.length || m.media?.url)
                      )
                      const photoUrls = hasPhoto
                        ? (m.media?.urls?.length ? m.media.urls : m.media?.url ? [m.media.url] : [])
                        : []
                      const caption = m.text?.trim()
                      const hasSticker = !unrecognized && !deleted && m.messageType === 'sticker'
                      const hasMediaContent = hasPhoto || hasSticker || Boolean(caption)
                      const sender = !own && activeDialog ? getIncomingSenderMeta(m, activeDialog) : null
                      const showSenderName = Boolean(sender && activeDialog?.chatType === 'group' && m.senderName)

                      return (
                        <div
                          key={m._id || `msg-${i}`}
                          style={{
                            display: 'flex',
                            justifyContent: own ? 'flex-end' : 'flex-start',
                            alignItems: 'flex-end',
                            gap: 8,
                          }}
                        >
                          {!own && sender && (
                            <ChatAvatar
                              name={sender.name}
                              avatarUrl={sender.avatarUrl}
                              platform={sender.platform}
                              size={28}
                              fontSize={11}
                            />
                          )}
                          <div
                            style={{
                              maxWidth: hasPhoto ? 'min(85%, 420px)' : '72%',
                              padding: hasPhoto ? '6px 6px 8px' : '10px 14px 8px',
                              borderRadius: own ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                              background: own
                                ? 'var(--green-card)'
                                : 'var(--chat-incoming-bg)',
                              border: own
                                ? '1px solid var(--green-border)'
                                : deleted || unrecognized
                                  ? '1px solid var(--chat-border-strong)'
                                  : '1px solid var(--chat-incoming-border)',
                              color: 'var(--chat-text)',
                              fontSize: 15,
                              lineHeight: 1.5,
                              opacity: deleted ? 0.82 : 1,
                              overflow: 'hidden',
                            }}
                          >
                            {showSenderName && (
                              <div style={{ fontSize: 12, color: 'var(--chat-gold-text)', margin: hasMediaContent ? '4px 8px 6px' : '0 0 4px', fontWeight: 500 }}>
                                {m.senderName}
                              </div>
                            )}
                            {hasMediaContent ? (
                              <div style={{ padding: hasPhoto ? (caption ? '0 8px 2px' : '0 2px') : 0 }}>
                                <ChatMessageBody
                                  text={hasPhoto ? caption : content}
                                  photoUrls={photoUrls}
                                  deleted={deleted}
                                  unrecognized={unrecognized}
                                  resolveUrl={resolveMessengerAssetUrl}
                                />
                              </div>
                            ) : null}
                            <div style={{ marginTop: 6, padding: hasPhoto ? '0 8px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, fontSize: 11, color: 'var(--chat-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                              {own && m.isAiReply && !deleted && (
                                <span style={{ fontSize: 10, color: 'var(--chat-gold-text)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <Sparkles size={10} />
                                  {t('modules.chatsPage.ии')}</span>
                              )}
                              {edited && (
                                <span style={{ fontSize: 11, color: 'var(--chat-text-dim)', fontStyle: 'italic' }}>
                                  {EDITED_MESSAGE_LABEL}
                                </span>
                              )}
                              {formatTime(m.sentAt)}
                              {own && !deleted && <MessageStatusIcon status={m.status} />}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
                {isAiProcessing && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 14px',
                        borderRadius: '12px 12px 4px 12px',
                        background: 'rgba(201,168,76,0.12)',
                        border: '1px solid rgba(201,168,76,0.25)',
                        color: 'var(--chat-gold-text)',
                        fontSize: 13,
                      }}
                    >
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      <span>{t('modules.chatsPage.ии_подбирает_ответ')}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Поле ввода */}
              {(!isActiveChatLoading || isAiAutoReplyActive) && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 16px',
                  background: 'var(--app-bg)',
                  borderTop: '1px solid var(--chat-border)',
                }}
              >
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleImageInputChange}
                />
                <button
                  type="button"
                  aria-label={t('modules.chatsPage.отправить_изображени')}
                  title={t('modules.chatsPage.отправить_изображени')}
                  disabled={isSendingMedia}
                  onClick={() => imageInputRef.current?.click()}
                  style={{
                    ...composeIconBtnStyle,
                    opacity: isSendingMedia ? 0.5 : 1,
                    cursor: isSendingMedia ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Paperclip size={18} />
                </button>
                <button type="button" aria-label={t('modules.chatsPage.эмодзи')} style={composeIconBtnStyle}><Smile size={18} /></button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!isSendBusy) {
                        void handleSend()
                      }
                    }
                  }}
                  placeholder={
                    isSendBusy
                      ? isAiProcessing
                        ? 'ИИ готовит ответ…'
                        : 'Обработка…'
                      : sendMode === 'ai'
                        ? 'Подсказка для ИИ необязательна'
                        : sendMode === 'generate'
                          ? 'Подсказка для генерации необязательна'
                          : 'Сообщение'
                  }
                  disabled={isSendBusy || isActiveChatLoading}
                  style={{
                    ...composeControlStyle,
                    flex: 1,
                    minWidth: 0,
                    padding: '0 14px',
                    background: 'var(--chat-surface)',
                    border: sendMode === 'ai' || isAiAutoReplyActive
                      ? '1px solid color-mix(in srgb, var(--gold) 35%, transparent)'
                      : '1px solid var(--green-border)',
                    color: 'var(--chat-text)',
                    fontSize: 15,
                    lineHeight: `${COMPOSE_BAR_HEIGHT - 2}px`,
                    outline: 'none',
                    opacity: isSendBusy || isActiveChatLoading ? 0.7 : 1,
                  }}
                />
                <SendModeSelect
                  value={sendMode}
                  disabled={isSendBusy || isActiveChatLoading}
                  open={sendModeSelectOpen}
                  onOpenChange={setSendModeSelectOpen}
                  onChange={handleSendModeChange}
                  selectRef={sendModeSelectRef}
                />
                <button
                  type="button"
                  disabled={isSendBusy || isActiveChatLoading}
                  onClick={() => { void handleSend() }}
                  aria-label={t('modules.chatsPage.отправить')}
                  title={t('modules.chatsPage.отправить')}
                  style={{
                    ...composeControlStyle,
                    width: COMPOSE_BAR_HEIGHT,
                    minWidth: COMPOSE_BAR_HEIGHT,
                    padding: 0,
                    border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)',
                    background: 'color-mix(in srgb, var(--gold) 22%, transparent)',
                    color: 'var(--gold)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isSendBusy || isActiveChatLoading ? 'not-allowed' : 'pointer',
                    opacity: isSendBusy || isActiveChatLoading ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  <Send size={16} />
                </button>
              </div>
              )}
            </>
          )}
        </section>

        {/* ───── Правая колонка: клиент + AI + материалы ───── */}
        <aside
          style={{
            width: RIGHT_PANEL_WIDTH,
            minWidth: RIGHT_PANEL_WIDTH,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--app-bg)',
            borderLeft: '1px solid var(--chat-border)',
          }}
        >
          {activeDialog && (
            <>
              <div style={{ padding: '18px 18px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--chat-border)' }}>
                <ChatAvatar
                  name={activeDialog.name}
                  avatarUrl={activeDialog.avatarUrl}
                  platform={activeDialog.platform}
                  size={64}
                  fontSize={20}
                />
                <div style={{ fontSize: 17, color: 'var(--chat-text-strong)' }}>{activeDialog.name}</div>
                <div style={{ fontSize: 14, color: 'var(--chat-text-secondary)' }}>{activeDialog.externalChatId}</div>
              </div>

              {isActiveChatLoading ? (
                <ChatPanelLoader label={t('modules.chatsPage.загрузка_данных_чата')} />
              ) : (
              <>
              {/* Tabs: AI / Афина / Задачи / Отправить */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--chat-border)' }}>
                {RIGHT_PANEL_TABS.map((tab) => {
                  const isActive = rightTab === tab.id
                  const Icon = tab.id === 'ai'
                    ? Sparkles
                    : tab.id === 'ownerAi'
                      ? MessageCircle
                      : tab.id === 'tasks'
                        ? Target
                        : Send
                  const isIconOnly = tab.label === null
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setRightTab(tab.id)}
                      aria-label={tab.title || tab.label || undefined}
                      title={tab.title || tab.label || undefined}
                      style={{
                        flex: isIconOnly ? '0 0 48px' : 1,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        padding: '10px 4px', background: 'transparent', border: 'none',
                        borderBottom: `2px solid ${isActive ? 'var(--gold)' : 'transparent'}`,
                        color: isActive ? 'var(--chat-gold-text)' : 'var(--chat-text-secondary)',
                        fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase',
                        cursor: 'pointer', transition: 'color 0.15s, border-color 0.15s', position: 'relative', minWidth: 0,
                      }}
                    >
                      <Icon size={isIconOnly ? 16 : 13} style={{ flexShrink: 0 }} />
                      {tab.label && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.label}</span>}
                      {tab.id === 'tasks' && selfTasksActiveCount > 0 && (
                        <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--gold)', color: '#000', fontSize: 10, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                          {selfTasksActiveCount > 99 ? '99+' : selfTasksActiveCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                {rightTab === 'ownerAi' ? (
                  <AthenaChatPanel
                    messages={ownerAiMessages}
                    directives={ownerAiDirectives}
                    completedDirectives={ownerAiCompletedDirectives}
                    loading={ownerAiLoading}
                    sending={ownerAiSending}
                    draft={ownerAiDraft}
                    onDraftChange={setOwnerAiDraft}
                    onSend={() => { void handleSendOwnerAiMessage() }}
                    scrollRef={ownerAiScrollRef}
                  />
                ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
                {rightTab === 'tasks' ? (
                  <TasksPanel
                    dialogId={activeDialog._id}
                    assignee={taskAssignee}
                    onAssigneeChange={setTaskAssignee}
                  />
                ) : rightTab === 'ai' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {activeDialog && (
                      <>
                        <button
                          type="button"
                          onClick={handleCrmSync}
                          disabled={crmSyncing}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            width: '100%',
                            padding: '10px 14px',
                            borderRadius: 6,
                            border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
                            background: crmSyncing ? 'var(--chat-surface)' : 'color-mix(in srgb, var(--gold) 8%, transparent)',
                            color: crmSyncing ? 'var(--chat-text-secondary)' : 'var(--gold)',
                            fontSize: 14,
                            fontFamily: 'inherit',
                            fontWeight: 500,
                            cursor: crmSyncing ? 'not-allowed' : 'pointer',
                            transition: 'background 0.15s, color 0.15s',
                          }}
                        >
                          <RefreshCw size={14} className={crmSyncing ? 'animate-spin' : ''} />
                          {crmSyncing ? 'Обновление лида…' : 'Обновить лида в CRM'}
                        </button>

                        <ClientDossierPanel
                          dossier={activeDialog.clientDossier}
                          onUseReply={setDraft}
                        />

                        {suggestedMaterials.length > 0 && (
                          <AiBlock label={t('modules.chatsPage.рекомендую_отправить')}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {suggestedMaterials.map((m) => (
                                <MaterialRow key={m.id} item={m} />
                              ))}
                            </div>
                          </AiBlock>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Переключатель: отправляем подборку или материал */}
                    <div
                      style={{
                        display: 'inline-flex',
                        gap: 4,
                        padding: 2,
                        background: 'var(--chat-surface)',
                        borderRadius: 4,
                        border: '1px solid var(--green-border)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    >
                      {([
                        { id: 'selection' as SendKind, label: 'Подборка', Icon: Rows3 },
                        { id: 'material' as SendKind, label: 'Материал', Icon: Library },
                      ]).map(({ id, label, Icon: KindIcon }) => {
                        const kindActive = sendKind === id
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => { setSendKind(id); setActiveSelection(null) }}
                            aria-pressed={kindActive}
                            style={{
                              flex: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                              height: 32,
                              borderRadius: 3,
                              border: 'none',
                              background: kindActive ? 'color-mix(in srgb, var(--gold) 24%, transparent)' : 'transparent',
                              color: kindActive ? 'var(--chat-gold-text)' : 'var(--chat-text-secondary)',
                              fontSize: 16,
                              fontWeight: 500,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              transition: 'background 0.15s, color 0.15s',
                            }}
                          >
                            <KindIcon size={14} style={{ flexShrink: 0 }} />
                            {label}
                          </button>
                        )
                      })}
                    </div>

                {sendKind === 'selection' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeSelection === null ? (
                      <>
                        <div
                          style={{
                            display: 'inline-flex',
                            gap: 4,
                            padding: 2,
                            background: 'var(--chat-surface)',
                            borderRadius: 4,
                            border: '1px solid var(--green-border)',
                            width: '100%',
                            boxSizing: 'border-box',
                            marginBottom: 10,
                          }}
                        >
                          {(['secondary', 'newbuild'] as const).map((v) => {
                            const subActive = selectionsSubTab === v
                            const label = v === 'secondary' ? 'Вторичка' : 'Новостройки'
                            return (
                              <button
                                key={v}
                                type="button"
                                onClick={() => setSelectionsSubTab(v)}
                                style={{
                                  flex: 1,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  height: 28,
                                  borderRadius: 3,
                                  border: 'none',
                                  background: subActive ? 'color-mix(in srgb, var(--gold) 24%, transparent)' : 'transparent',
                                  color: subActive ? 'var(--chat-gold-text)' : 'var(--chat-text-secondary)',
                                  fontSize: 13,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  transition: 'background 0.15s, color 0.15s',
                                }}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (selectionsSubTab === 'secondary') {
                              navigate('/dashboard/objects/selections/new')
                            } else {
                              navigate('/dashboard/new-buildings/chessboard?pick=1')
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            width: '100%',
                            padding: '8px 12px',
                            marginBottom: 10,
                            borderRadius: 4,
                            border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
                            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
                            color: 'var(--gold)',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          <Plus size={14} />
                          {t('modules.chatsPage.создать_подборку')}</button>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {selectionsSubTab === 'secondary' ? (
                            (() => {
                              if (secondarySelections.length === 0) {
                                return (
                                  <div style={{ padding: '24px 16px', color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center', fontStyle: 'italic' }}>
                                    {t('modules.chatsPage.нет_подборок_по_втор')}</div>
                                )
                              }
                              return secondarySelections.map((sel) => {
                                const statusColor = DEV_SELECTION_STATUS_COLORS[sel.status] || 'gray'
                                return (
                                  <div
                                    key={sel.id}
                                    onClick={() => setActiveSelection({ id: sel.id, market: 'secondary' })}
                                    style={{
                                      padding: '10px 12px',
                                      borderRadius: 6,
                                      border: '1px solid var(--chat-border)',
                                      background: 'var(--chat-surface-subtle)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 4,
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                                      <span style={{ fontSize: 14, color: 'var(--chat-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                        {sel.title}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--chat-text-secondary)' }}>
                                      <span>{sel.items.length} {t('modules.chatsPage.объектов')}</span>
                                      <span>{new Date(sel.createdAt).toLocaleDateString('ru-RU')}</span>
                                    </div>
                                  </div>
                                )
                              })
                            })()
                          ) : (
                            (() => {
                              if (devSelections.length === 0) {
                                return (
                                  <div style={{ padding: '24px 16px', color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center', fontStyle: 'italic' }}>
                                    {t('modules.chatsPage.нет_подборок_по_ново')}</div>
                                )
                              }
                              return devSelections.map((sel: DevSelection) => {
                                const statusColor = DEV_SELECTION_STATUS_COLORS[sel.status] || 'gray'
                                return (
                                  <div
                                    key={sel.id}
                                    onClick={() => setActiveSelection({ id: sel.id, market: 'newbuild' })}
                                    style={{
                                      padding: '10px 12px',
                                      borderRadius: 6,
                                      border: '1px solid var(--chat-border)',
                                      background: 'var(--chat-surface-subtle)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 4,
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                                      <span style={{ fontSize: 14, color: 'var(--chat-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                        {sel.title}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--chat-text-secondary)' }}>
                                      <span>{sel.items.length} {t('modules.chatsPage.лотов')}</span>
                                      <span>{new Date(sel.createdAt).toLocaleDateString('ru-RU')}</span>
                                    </div>
                                  </div>
                                )
                              })
                            })()
                          )}
                        </div>
                      </>
                    ) : (
                      (() => {
                        if (activeSelection.market === 'secondary') {
                          const sel = secondarySelections.find((s) => s.id === activeSelection.id)
                          if (!sel) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => setActiveSelection(null)}
                                  style={{
                                    border: 'none', background: 'transparent', color: 'var(--gold)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, fontSize: 13, fontFamily: 'inherit',
                                  }}
                                >
                                  <ArrowLeft size={16} />
                                  <span style={{ marginLeft: 4 }}>{t('modules.chatsPage.назад')}</span>
                                </button>
                                <div style={{ color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center' }}>
                                  {t('modules.chatsPage.подборка_не_найдена')}</div>
                              </div>
                            )
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => setActiveSelection(null)}
                                  style={{
                                    border: 'none', background: 'transparent', color: 'var(--gold)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, fontSize: 13, fontFamily: 'inherit',
                                  }}
                                >
                                  <ArrowLeft size={16} />
                                  <span style={{ marginLeft: 4 }}>{t('modules.chatsPage.назад')}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate(`/dashboard/objects/selections/${sel.id}`)
                                  }}
                                  style={{
                                    border: 'none', background: 'transparent', color: 'var(--gold)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, fontSize: 13, fontFamily: 'inherit',
                                  }}
                                >
                                  {t('modules.chatsPage.посмотреть_подборку')}</button>
                              </div>
                              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--chat-gold-text)' }}>
                                {sel.title}
                              </div>
                              {sel.clientName && (
                                <div style={{ fontSize: 13, color: 'var(--chat-text-secondary)', marginBottom: 4 }}>
                                  {t('modules.chatsPage.клиент')}{sel.clientName}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(buildSelectionShareUrl(sel)).then(() => {
                                      addToast('Ссылка скопирована', 'success')
                                    })
                                  }}
                                  style={{
                                    flex: 1, height: 32, borderRadius: 4, border: '1px solid var(--chat-border)',
                                    background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)',
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {t('modules.chatsPage.ссылка')}</button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraft((prev) => {
                                      const linkText = `Подборка объектов "${sel.title}": ${buildSelectionShareUrl(sel)}`
                                      return prev ? `${prev}\n${linkText}` : linkText
                                    })
                                  }}
                                  style={{
                                    flex: 1, height: 32, borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)',
                                    background: 'color-mix(in srgb, var(--gold) 12%, transparent)', color: 'var(--gold)',
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {t('modules.chatsPage.в_сообщение')}</button>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {sel.items.map((selItem) => {
                                  const resolved = selItem.listingId ? secondaryListingById.get(selItem.listingId) : undefined
                                  if (!resolved) return null
                                  const { asset, listing } = resolved
                                  const priceLabel = new Intl.NumberFormat('ru-RU', {
                                    style: 'currency',
                                    currency: listing.price.currency,
                                    maximumFractionDigits: 0,
                                  }).format(listing.price.amountMinorUnits / 100)
                                  return (
                                    <div
                                      key={listing._id}
                                      style={{
                                        padding: 10, borderRadius: 6, border: '1px solid var(--chat-border)',
                                        background: 'var(--chat-surface)', fontSize: 14,
                                        display: 'flex', flexDirection: 'column', gap: 6,
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ color: 'var(--chat-text)', fontWeight: 500, flex: 1, fontSize: 13 }}>
                                          {asset.location.address}
                                        </span>
                                      </div>
                                      <div style={{ color: 'var(--chat-text-secondary)', fontSize: 12 }}>
                                        {asset.characteristics.rooms ?? '—'} {t('modules.chatsPage.комн')}{asset.characteristics.area} {t('modules.chatsPage.м_эт')}{asset.characteristics.floor ?? '—'}
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                        <span style={{ fontWeight: 500, color: 'var(--chat-gold-text)' }}>
                                          {priceLabel}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDraft((prev) => {
                                              const unitText = `🏠 ${asset.location.address}, ${asset.characteristics.rooms ?? '—'} комн., ${asset.characteristics.area} м², этаж ${asset.characteristics.floor ?? '—'}. Цена: ${priceLabel}`
                                              return prev ? `${prev}\n${unitText}` : unitText
                                            })
                                          }}
                                          style={{
                                            height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid var(--chat-border)',
                                            background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11,
                                            cursor: 'pointer', fontFamily: 'inherit',
                                          }}
                                        >
                                          {t('modules.chatsPage.в_сообщение')}</button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        } else {
                          const sel = devSelections.find((s: DevSelection) => s.id === activeSelection.id)
                          if (!sel) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => setActiveSelection(null)}
                                  style={{
                                    border: 'none', background: 'transparent', color: 'var(--gold)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, fontSize: 13, fontFamily: 'inherit',
                                  }}
                                >
                                  <ArrowLeft size={16} />
                                  <span style={{ marginLeft: 4 }}>{t('modules.chatsPage.назад')}</span>
                                </button>
                                <div style={{ color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center' }}>
                                  {t('modules.chatsPage.подборка_не_найдена')}</div>
                              </div>
                            )
                          }
                          const selectionItems = sel.items.map((item: any) => {
                            const unit = allUnits.find((u: any) => u._id === item.unitId)
                            const building = unit ? allBuildings.find((b: any) => b._id === unit.building) : undefined
                            const project = building ? projects.find((p: any) => p._id === building.project) : undefined
                            return { item, unit, building, project }
                          }).filter((e: any) => e.unit)
                          const shareUrl = buildSelectionShareUrl(sel)
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => setActiveSelection(null)}
                                  style={{
                                    border: 'none', background: 'transparent', color: 'var(--gold)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, fontSize: 13, fontFamily: 'inherit',
                                  }}
                                >
                                  <ArrowLeft size={16} />
                                  <span style={{ marginLeft: 4 }}>{t('modules.chatsPage.назад')}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate('/dashboard/development/selections', { state: { activeId: sel.id } })
                                  }}
                                  style={{
                                    border: 'none', background: 'transparent', color: 'var(--gold)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, fontSize: 13, fontFamily: 'inherit',
                                  }}
                                >
                                  {t('modules.chatsPage.посмотреть_подборку')}</button>
                              </div>
                              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--chat-gold-text)' }}>
                                {sel.title}
                              </div>
                              {sel.clientName && (
                                <div style={{ fontSize: 13, color: 'var(--chat-text-secondary)', marginBottom: 4 }}>
                                  {t('modules.chatsPage.клиент')}{sel.clientName}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(shareUrl).then(() => {
                                      addToast('Ссылка скопирована', 'success')
                                    })
                                  }}
                                  style={{
                                    flex: 1, height: 32, borderRadius: 4, border: '1px solid var(--chat-border)',
                                    background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)',
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {t('modules.chatsPage.ссылка')}</button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const customization = resolveDevCustomization(sel.customization)
                                    openDevSelectionPdf({
                                      selection: sel,
                                      customization,
                                      items: selectionItems.map(({ item, unit, building, project }: any) => ({
                                        unit: unit!,
                                        building,
                                        project,
                                        agentNote: item.agentNote,
                                      })),
                                    })
                                  }}
                                  style={{
                                    flex: 1, height: 32, borderRadius: 4, border: '1px solid var(--chat-border)',
                                    background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)',
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraft((prev) => {
                                      const linkText = `Подборка новостроек "${sel.title}": ${shareUrl}`
                                      return prev ? `${prev}\n${linkText}` : linkText
                                    })
                                  }}
                                  style={{
                                    flex: 1, height: 32, borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)',
                                    background: 'color-mix(in srgb, var(--gold) 12%, transparent)', color: 'var(--gold)',
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {t('modules.chatsPage.в_сообщение')}</button>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {selectionItems.map(({ unit, building, project }: any) => {
                                  if (!unit) return null
                                  return (
                                    <div
                                      key={unit._id}
                                      style={{
                                        padding: 10, borderRadius: 6, border: '1px solid var(--chat-border)',
                                        background: 'var(--chat-surface)', fontSize: 14,
                                        display: 'flex', flexDirection: 'column', gap: 6,
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ color: 'var(--chat-text)', fontWeight: 500, flex: 1, fontSize: 13 }}>
                                          {t('modules.chatsPage.жк')}{project?.name || '—'}" · {building?.name || '—'} {t('modules.chatsPage.лот')}{unit.number}
                                        </span>
                                      </div>
                                      <div style={{ color: 'var(--chat-text-secondary)', fontSize: 12 }}>
                                        {unit.rooms} {t('modules.chatsPage.комн')}{unit.area} {t('modules.chatsPage.м_эт')}{unit.floor}
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                        <span style={{ fontWeight: 500, color: 'var(--chat-gold-text)' }}>
                                          ${unit.price ? unit.price.toLocaleString('ru-RU') : '—'}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDraft((prev) => {
                                              const unitText = `🏠 ЖК "${project?.name || ''}" · ${building?.name || ''}, Лот ${unit.number}, ${unit.rooms}, ${unit.area} м², этаж ${unit.floor}. Цена: ${unit.price ? '$' + unit.price.toLocaleString('ru-RU') : 'по запросу'}`
                                              return prev ? `${prev}\n${unitText}` : unitText
                                            })
                                          }}
                                          style={{
                                            height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid var(--chat-border)',
                                            background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11,
                                            cursor: 'pointer', fontFamily: 'inherit',
                                          }}
                                        >
                                          {t('modules.chatsPage.в_сообщение')}</button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        }
                      })()
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--chat-gold-text)', marginBottom: 6 }}>
                      {t('modules.chatsPage.база_знаний')}</div>
                    {lmsLoading || lmsError || libraryItems.length === 0 ? (
                      <div style={{ padding: '24px 16px', color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center' }}>
                        {lmsError ?? (lmsLoading ? t('common.loading') : t('modules.chatsPage.база_знаний_пуста'))}
                      </div>
                    ) : (
                      libraryItems.map((m) => <MaterialRow key={m.id} item={m} />)
                    )}
                  </div>
                )}
                  </div>
                )}
              </div>
                )}
              </div>
              </>
              )}
            </>
          )}
        </aside>
      </div>

      {broadcastUnit && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16
        }}>
          <div 
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(20px)'
            }}
            onClick={() => {
              setBroadcastUnit(null)
              setSelectedLeadIds([])
              setBroadcastSearch('')
            }}
          />
          <div style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(480px, 100vw - 2rem)',
            background: 'var(--chat-modal-bg)',
            border: 'none',
            borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18), 0 24px 80px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'min(640px, 100vh - 2rem)',
            overflow: 'hidden',
            fontFamily: "'Montserrat', sans-serif",
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              background: 'var(--chat-modal-header)',
              boxShadow: 'inset 0 -1px 0 rgba(201,168,76,0.15)',
            }}>
              <h3 style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 500,
                color: 'var(--chat-gold-light-text)',
                letterSpacing: '-0.02em',
              }}>
                {t('modules.chatsPage.массовая_рассылка_ло')}</h3>
              <button
                type="button"
                onClick={() => {
                  setBroadcastUnit(null)
                  setSelectedLeadIds([])
                  setBroadcastSearch('')
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--chat-text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 4,
                  borderRadius: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{
              padding: 20,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              color: 'var(--chat-text)'
            }}>
              {/* Apartment Info Card */}
              <div style={{
                padding: '12px 14px',
                background: 'var(--chat-modal-card)',
                borderRadius: 6,
                boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18)',
                fontSize: 16,
              }}>
                <div style={{ color: 'var(--chat-gold-text)', fontSize: 18, fontWeight: 500, marginBottom: 4 }}>
                  {t('modules.chatsPage.лот')}{broadcastUnit.unit.number}
                </div>
                <div style={{ fontSize: 16, color: 'var(--chat-gold-mint-text)' }}>
                  {broadcastUnit.projectName} · {broadcastUnit.buildingName} · {broadcastUnit.unit.rooms} · {broadcastUnit.unit.area} {t('modules.chatsPage.м_эт')}{broadcastUnit.unit.floor}
                </div>
              </div>

              {/* Horizontal Selected Leads Tray */}
              {selectedLeadIds.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: 12,
                  overflowX: 'auto',
                  padding: '10px 12px',
                  background: 'var(--chat-modal-tray)',
                  borderRadius: 6,
                  boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.12)',
                }}>
                  {selectedLeadIds.map(id => {
                    const d = dialogs.find(t => t._id === id)
                    if (!d) return null
                    return (
                      <div 
                        key={id} 
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          gap: 4, 
                          position: 'relative',
                          flexShrink: 0,
                          width: 56,
                        }}
                      >
                        <ChatAvatar
                          name={d.name}
                          avatarUrl={d.avatarUrl}
                          size={44}
                          fontSize={16}
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedLeadIds(selectedLeadIds.filter(x => x !== id))}
                          style={{
                            position: 'absolute',
                            top: -2,
                            right: 2,
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            backgroundColor: 'var(--chat-gold-text)',
                            color: 'var(--chat-gold-on-bg)',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                          }}
                        >
                          <X size={10} strokeWidth={3} />
                        </button>
                        <span style={{
                          fontSize: 16,
                          color: 'var(--chat-text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          width: '100%',
                          textAlign: 'center',
                        }}>
                          {d.name.split(' ')[0]}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Search Input */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={broadcastSearch}
                  onChange={(e) => setBroadcastSearch(e.target.value)}
                  placeholder={t('modules.chatsPage.поиск_лида_по_имени')}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    background: 'var(--chat-surface)',
                    border: 'none',
                    borderBottom: '2px solid var(--chat-modal-input-border)',
                    borderRadius: 4,
                    color: 'var(--chat-text)',
                    fontFamily: 'inherit',
                    fontSize: 16,
                    outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => e.target.style.borderBottomColor = 'var(--chat-modal-input-focus)'}
                  onBlur={(e) => e.target.style.borderBottomColor = 'var(--chat-modal-input-border)'}
                />
              </div>

              <div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10
                }}>
                  <span style={{ fontSize: 16, color: 'var(--chat-text-secondary)', fontWeight: 500 }}>
                    {t('modules.chatsPage.получатели_диалоги')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const safeDialogs = Array.isArray(dialogs) ? dialogs : []
                      const allSelected = selectedLeadIds.length === safeDialogs.length
                      if (allSelected) {
                        setSelectedLeadIds([])
                      } else {
                        setSelectedLeadIds(safeDialogs.map(d => d._id))
                      }
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--chat-gold-text)',
                      fontSize: 16,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {selectedLeadIds.length === dialogs.length ? 'Снять всех' : 'Выбрать всех'}
                  </button>
                </div>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 240,
                  overflowY: 'auto',
                  paddingRight: 4
                }}>
                  {filteredBroadcastDialogs.length === 0 ? (
                    <div style={{ padding: '16px 8px', color: 'var(--chat-text-secondary)', textAlign: 'center', fontSize: 16 }}>
                      {t('modules.chatsPage.получатели_не_найден')}</div>
                  ) : (
                    filteredBroadcastDialogs.map(d => {
                      const isChecked = selectedLeadIds.includes(d._id)
                      return (
                        <button
                          key={d._id}
                          type="button"
                          onClick={() => {
                            if (isChecked) {
                              setSelectedLeadIds(selectedLeadIds.filter(id => id !== d._id))
                            } else {
                              setSelectedLeadIds([...selectedLeadIds, d._id])
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            width: '100%',
                            padding: '10px 12px',
                            background: isChecked ? 'rgba(201,168,76,0.06)' : 'transparent',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'inherit',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            if (!isChecked) e.currentTarget.style.background = 'var(--chat-surface-hover)'
                          }}
                          onMouseLeave={(e) => {
                            if (!isChecked) e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <ChatAvatar
                            name={d.name}
                            avatarUrl={d.avatarUrl}
                            platform={d.platform}
                            size={40}
                            fontSize={16}
                          />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--chat-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {d.name}
                            </div>
                            <div style={{ fontSize: 16, color: 'var(--chat-text-secondary)' }}>
                              {CHANNEL_META[d.platform].label} · {d.externalChatId}
                            </div>
                          </div>

                          {/* Circular custom checkbox */}
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            border: isChecked ? '2px solid var(--chat-gold-text)' : '2px solid var(--chat-border-checkbox)',
                            backgroundColor: isChecked ? 'var(--chat-gold-text)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease',
                            flexShrink: 0,
                          }}>
                            {isChecked && (
                              <Check size={12} strokeWidth={3} style={{ color: 'var(--chat-gold-on-bg)' }} />
                            )}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'end',
              gap: 10,
              padding: '12px 20px',
              background: 'var(--chat-modal-header)',
              boxShadow: 'inset 0 1px 0 rgba(201,168,76,0.15)',
            }}>
              <button
                type="button"
                onClick={() => {
                  setBroadcastUnit(null)
                  setSelectedLeadIds([])
                  setBroadcastSearch('')
                }}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(201,168,76,0.25)',
                  background: 'transparent',
                  color: 'var(--chat-text)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('modules.chatsPage.отмена')}</button>
              <button
                type="button"
                disabled={selectedLeadIds.length === 0}
                onClick={handleSendBroadcast}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 4,
                  border: 'none',
                  background: selectedLeadIds.length === 0 ? 'rgba(201,168,76,0.2)' : 'var(--gold)',
                  color: selectedLeadIds.length === 0 ? 'var(--chat-text-dim)' : 'var(--chat-gold-on-bg)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: selectedLeadIds.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedLeadIds.length === 0 ? 0.5 : 1,
                  transition: 'background 0.15s',
                  fontFamily: 'inherit',
                }}
              >
                {t('modules.chatsPage.отправить')}{selectedLeadIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ───── Toast Notifications ───── */}
      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 10001,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none'
      }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>

    </DashboardShell>
  )
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 5000)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  const bg = toast.type === 'success' ? '#064e3b' : toast.type === 'error' ? '#7f1d1d' : '#1e3a8a'
  const border = toast.type === 'success' ? '#059669' : toast.type === 'error' ? '#dc2626' : '#3b82f6'

  return (
    <div
      onClick={() => onRemove(toast.id)}
      style={{
        padding: '12px 20px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        color: 'white',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        pointerEvents: 'auto',
        cursor: 'pointer',
        minWidth: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        animation: 'toast-in 0.3s ease-out'
      }}
    >
      {toast.message}
      <X size={14} style={{ opacity: 0.7 }} />
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 32, height: 32,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--chat-text-secondary)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}

const composeIconBtnStyle: React.CSSProperties = {
  ...composeControlStyle,
  width: COMPOSE_BAR_HEIGHT,
  minWidth: COMPOSE_BAR_HEIGHT,
  border: 'none',
  background: 'transparent',
  color: 'var(--chat-text-secondary)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}

const dossierCardStyle: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--hub-card-border)',
  background: 'var(--chat-surface-subtle)',
  overflow: 'hidden',
}

function DossierSection({
  icon: Icon,
  title,
  accent = 'gold',
  badge,
  children,
}: {
  icon: typeof Sparkles
  title: string
  accent?: 'gold' | 'ai' | 'warn'
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const accentColor = accent === 'ai'
    ? '#7dd3fc'
    : accent === 'warn'
      ? '#fdba74'
      : 'var(--gold)'

  return (
    <section style={dossierCardStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '11px 14px',
          borderBottom: '1px solid var(--chat-border-subtle)',
          background: 'var(--chat-surface-muted)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `color-mix(in srgb, ${accentColor} 16%, transparent)`,
              color: accentColor,
              flexShrink: 0,
            }}
          >
            <Icon size={15} />
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: accentColor,
            }}
          >
            {title}
          </span>
        </div>
        {badge}
      </div>
      <div style={{ padding: '14px' }}>
        {children}
      </div>
    </section>
  )
}

function DossierMetaChip({
  icon: Icon,
  label,
  value,
  fullWidth = false,
}: {
  icon: typeof Target
  label: string
  value: string
  fullWidth?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 11px',
        borderRadius: 6,
        border: '1px solid var(--chat-border-subtle)',
        background: 'var(--chat-surface-card)',
        minWidth: 0,
        width: fullWidth ? '100%' : undefined,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--chat-text-dim)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        <Icon size={12} style={{ flexShrink: 0 }} />
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--chat-text)' }}>{value}</div>
    </div>
  )
}

function ScoringBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--chat-text-dim)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--chat-text)' }}>{value}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--chat-border-subtle)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function GoalTypeBadge({ goalType }: { goalType?: string }) {
  const labels: Record<string, string> = {
    life: 'Жизнь',
    investment: 'Инвестиция',
    rent: 'Аренда',
    relocation: 'Релокация',
    capital: 'Капитал',
    business: 'Бизнес',
  }
  if (!goalType) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: 'color-mix(in srgb, var(--gold) 16%, transparent)',
        color: 'var(--gold)',
      }}
    >
      {labels[goalType] || goalType}
    </span>
  )
}

function TrustBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--chat-text)', flex: 1, minWidth: 0 }}>{label}</span>
      <div style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--chat-border-subtle)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--chat-text-dim)', width: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function ClientDossierPanel({
  dossier,
  onUseReply,
}: {
  dossier?: ClientDossier
  onUseReply: (text: string) => void
}) {
    const { t } = useI18n();
  const isAnalyzing = dossier?.status === 'analyzing'
  const hasError = dossier?.status === 'error'
  const updatedLabel = dossier?.updatedAt
    ? new Date(dossier.updatedAt).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null

  const statusBadge = isAnalyzing ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--gold)', whiteSpace: 'nowrap' }}>
      <Loader2 size={12} className="animate-spin" />
      {t('modules.chatsPage.обновление')}</span>
  ) : updatedLabel ? (
    <span style={{ fontSize: 11, color: 'var(--chat-text-dim)', whiteSpace: 'nowrap' }}>
      {updatedLabel}
    </span>
  ) : null

  if (isAnalyzing && !dossier?.summary) {
    return <ChatPanelLoader label={t('modules.chatsPage.ии_формирует_досье_к')} />
  }

  const aiIntentions = dossier?.aiIntentions || []
  const risks = dossier?.risks || []
  const suggestedReplies = dossier?.suggestedReplies || []
  const scoring = dossier?.scoring
  const goals = dossier?.goals
  const geography = dossier?.geography
  const finance = dossier?.finance
  const propertyProfile = dossier?.propertyProfile
  const objections = dossier?.objections
  const decisionMakers = dossier?.decisionMakers
  const communication = dossier?.communication
  const trust = dossier?.trust
  const legalReadiness = dossier?.legalReadiness
  const recommendations = dossier?.recommendations
  const dataQuality = dossier?.dataQuality
  const investmentProfile = dossier?.investmentProfile

  const tempColor = !scoring?.temperature
    ? 'var(--chat-text-dim)'
    : scoring.temperature < 20
      ? '#9ca3af'
      : scoring.temperature < 60
        ? '#fbbf24'
        : '#4ade80'

  const sensitivityLabels: Record<string, string> = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' }
  const maturityLabels: Record<string, string> = { newbie: 'Новичок', learning: 'Изучает', experienced: 'Опытный', professional: 'Профессионал' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {hasError && dossier?.errorMessage && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(248,113,113,0.35)',
            background: 'rgba(248,113,113,0.08)',
            fontSize: 13,
            color: 'var(--chat-error-text)',
            lineHeight: 1.4,
          }}
        >
          {dossier.errorMessage}
        </div>
      )}

      <DossierSection icon={Sparkles} title={t('modules.chatsPage.ai_резюме')} accent="ai" badge={statusBadge}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--chat-text)' }}>
          {dossier?.summary || 'Досье появится после анализа переписки с клиентом.'}
        </p>
        {scoring && (
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {scoring.temperature != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Thermometer size={14} style={{ color: tempColor }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: tempColor }}>
                  {scoring.temperature}°
                </span>
              </div>
            )}
            {scoring.dealProbability != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Percent size={14} style={{ color: 'var(--gold)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>
                  {scoring.dealProbability}{t('modules.chatsPage.сделка')}</span>
              </div>
            )}
          </div>
        )}
      </DossierSection>

      {goals && (goals.goalType || goals.goalDetail || (goals.emotionalTriggers?.length ?? 0) > 0) && (
        <DossierSection icon={Crosshair} title={t('modules.chatsPage.цель_клиента')} accent="gold">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {goals.goalType && <GoalTypeBadge goalType={goals.goalType} />}
            {goals.goalDetail && (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--chat-text)' }}>
                {goals.goalDetail}
              </p>
            )}
            {(goals.emotionalTriggers?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {goals.emotionalTriggers!.map((t, i) => (
                  <span
                    key={i}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: 'rgba(201,168,76,0.1)',
                      color: 'var(--gold)',
                      border: '1px solid rgba(201,168,76,0.2)',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {aiIntentions.length > 0 && (
        <DossierSection icon={Sparkles} title={t('modules.chatsPage.намерения_ии')} accent="ai">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {aiIntentions.map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '10px 11px',
                  borderRadius: 6,
                  border: '1px solid rgba(125,211,252,0.18)',
                  background: 'rgba(125,211,252,0.05)',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#7dd3fc',
                    background: 'rgba(125,211,252,0.12)',
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--chat-text)', paddingTop: 1 }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </DossierSection>
      )}

      {scoring && (
        <DossierSection icon={TrendingUp} title={t('modules.chatsPage.скоринги')} accent="ai">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scoring.temperature != null && <ScoringBar label={t('modules.chatsPage.температура')} value={scoring.temperature} color={tempColor} />}
            {scoring.dealProbability != null && <ScoringBar label={t('modules.chatsPage.вероятность_сделки')} value={scoring.dealProbability} color="var(--gold)" />}
            {scoring.leadQuality != null && <ScoringBar label={t('modules.chatsPage.качество_лида')} value={scoring.leadQuality} color="#7dd3fc" />}
            {scoring.competitorChurnRisk != null && <ScoringBar label={t('modules.chatsPage.риск_ухода_к_конкуре')} value={scoring.competitorChurnRisk} color="#f87171" />}
            {scoring.investmentMaturity && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--chat-text-dim)' }}>{t('modules.chatsPage.уровень_инвестора')}</span>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'rgba(125,211,252,0.12)',
                    color: '#7dd3fc',
                  }}
                >
                  {maturityLabels[scoring.investmentMaturity] || scoring.investmentMaturity}
                </span>
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {objections && (objections.mainObstacle || (objections.fears?.length ?? 0) > 0) && (
        <DossierSection icon={ShieldAlert} title={t('modules.chatsPage.возражения')} accent="warn">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {objections.mainObstacle && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(248,113,113,0.3)',
                  background: 'rgba(248,113,113,0.08)',
                }}
              >
                <div style={{ fontSize: 11, color: '#f87171', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.главное_препятствие')}</div>
                <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--chat-text)' }}>
                  {objections.mainObstacle}
                </div>
              </div>
            )}
            {objections.howToRemove && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(74,222,128,0.25)',
                  background: 'rgba(74,222,128,0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: '#4ade80', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.как_снять')}</div>
                <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--chat-text)' }}>
                  {objections.howToRemove}
                </div>
              </div>
            )}
            {(objections.fears?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--chat-text-dim)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {t('modules.chatsPage.страхи')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {objections.fears!.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                        fontSize: 13,
                        color: 'var(--chat-text)',
                        lineHeight: 1.4,
                      }}
                    >
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2, color: '#fdba74' }} />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {objections.churnRisk != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--chat-text-dim)' }}>{t('modules.chatsPage.риск_ухода')}</span>
                <ScoringBar label="" value={objections.churnRisk} color="#f87171" />
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {recommendations && ((recommendations.whatToOffer?.length ?? 0) > 0 || (recommendations.whatNotToOffer?.length ?? 0) > 0 || recommendations.managerTask) && (
        <DossierSection icon={Lightbulb} title={t('modules.chatsPage.рекомендации_ai')} accent="ai">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(recommendations.whatToOffer?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#4ade80', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.что_предлагать')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {recommendations.whatToOffer!.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--chat-text)', lineHeight: 1.4 }}>
                      <Check size={13} style={{ flexShrink: 0, marginTop: 2, color: '#4ade80' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(recommendations.whatNotToOffer?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.что_не_предлагать')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {recommendations.whatNotToOffer!.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--chat-text)', lineHeight: 1.4 }}>
                      <X size={13} style={{ flexShrink: 0, marginTop: 2, color: '#f87171' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {recommendations.managerTask && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(125,211,252,0.25)',
                  background: 'rgba(125,211,252,0.06)',
                }}
              >
                <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.задача_менеджеру')}</div>
                <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--chat-text)' }}>
                  {recommendations.managerTask}
                </div>
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {(geography || finance) && (
        <DossierSection icon={Target} title={t('modules.chatsPage.цель_и_локация')} accent="gold">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {geography && (geography.city || geography.district || geography.microLocation) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {geography.city && <DossierMetaChip icon={MapPin} label={t('modules.chatsPage.город')} value={geography.city} />}
                {geography.district && <DossierMetaChip icon={MapPin} label={t('modules.chatsPage.район')} value={geography.district} />}
                {geography.microLocation && (
                  <div style={{ gridColumn: '1 / -1', width: '100%' }}>
                    <DossierMetaChip icon={MapPin} label={t('modules.chatsPage.микролокация')} value={geography.microLocation} fullWidth />
                  </div>
                )}
              </div>
            )}
            {(geography?.undesirableZones?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.нежелательные_зоны')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {geography!.undesirableZones!.map((z, i) => (
                    <span
                      key={i}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        background: 'rgba(248,113,113,0.08)',
                        color: '#f87171',
                        border: '1px solid rgba(248,113,113,0.2)',
                      }}
                    >
                      {z}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {geography?.geoLogic && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--chat-border-subtle)',
                  background: 'var(--chat-surface-card)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--chat-text-dim)', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {t('modules.chatsPage.почему_эта_локация')}</div>
                <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--chat-text)' }}>
                  {geography.geoLogic}
                </div>
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {finance && (finance.totalBudget || finance.comfortableBudget || finance.maxBudget || finance.downPayment || finance.installment || finance.credit || finance.purchaseTimeline || finance.priceSensitivity) && (
        <DossierSection icon={Wallet} title={t('modules.chatsPage.финансы')} accent="gold">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {finance.totalBudget && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.общий_бюджет')} value={finance.totalBudget} />}
            {finance.comfortableBudget && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.комфортный')} value={finance.comfortableBudget} />}
            {finance.maxBudget && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.максимум')} value={finance.maxBudget} />}
            {finance.downPayment && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.первый_взнос')} value={finance.downPayment} />}
            {finance.installment && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.рассрочка')} value={finance.installment} />}
            {finance.credit && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.кредит')} value={finance.credit} />}
            {finance.currency && (
              <div style={{ gridColumn: '1 / -1', width: '100%' }}>
                <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.валюта')} value={finance.currency} fullWidth />
              </div>
            )}
            {finance.purchaseTimeline && (
              <div style={{ gridColumn: '1 / -1', width: '100%' }}>
                <DossierMetaChip icon={Clock} label={t('modules.chatsPage.срок_покупки')} value={finance.purchaseTimeline} fullWidth />
              </div>
            )}
          </div>
          {finance.priceSensitivity && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--chat-text-dim)' }}>{t('modules.chatsPage.чувствительность_к_ц')}</span>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  background: finance.priceSensitivity === 'high'
                    ? 'rgba(248,113,113,0.12)'
                    : finance.priceSensitivity === 'medium'
                      ? 'rgba(251,191,36,0.12)'
                      : 'rgba(74,222,128,0.12)',
                  color: finance.priceSensitivity === 'high'
                    ? '#f87171'
                    : finance.priceSensitivity === 'medium'
                      ? '#fbbf24'
                      : '#4ade80',
                }}
              >
                {sensitivityLabels[finance.priceSensitivity] || finance.priceSensitivity}
              </span>
            </div>
          )}
        </DossierSection>
      )}

      {propertyProfile && (propertyProfile.propertyType || propertyProfile.rooms || propertyProfile.areaMin || propertyProfile.areaMax || propertyProfile.view || propertyProfile.condition || propertyProfile.deliveryDate || (propertyProfile.unwanted?.length ?? 0) > 0) && (
        <DossierSection icon={Building2} title={t('modules.chatsPage.желаемый_объект')} accent="gold">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: (propertyProfile.unwanted?.length ?? 0) > 0 ? 10 : 0 }}>
            {propertyProfile.propertyType && <DossierMetaChip icon={Building2} label={t('modules.chatsPage.тип')} value={propertyProfile.propertyType} />}
            {propertyProfile.rooms && <DossierMetaChip icon={Building2} label={t('modules.chatsPage.комнаты')} value={propertyProfile.rooms} />}
            {(propertyProfile.areaMin || propertyProfile.areaMax) && (
              <DossierMetaChip
                icon={Building2}
                label={t('modules.chatsPage.площадь')}
                value={`${propertyProfile.areaMin || '?'}–${propertyProfile.areaMax || '?'} м²`}
              />
            )}
            {propertyProfile.view && <DossierMetaChip icon={Building2} label={t('modules.chatsPage.вид')} value={propertyProfile.view} />}
            {propertyProfile.condition && <DossierMetaChip icon={Building2} label={t('modules.chatsPage.состояние')} value={propertyProfile.condition} />}
            {propertyProfile.deliveryDate && <DossierMetaChip icon={Clock} label={t('modules.chatsPage.сдача')} value={propertyProfile.deliveryDate} />}
          </div>
          {(propertyProfile.unwanted?.length ?? 0) > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                {t('modules.chatsPage.не_предлагать')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {propertyProfile.unwanted!.map((item, i) => (
                  <span
                    key={i}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: 'rgba(248,113,113,0.08)',
                      color: '#f87171',
                      border: '1px solid rgba(248,113,113,0.2)',
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </DossierSection>
      )}

      {investmentProfile && goals?.goalType === 'investment' && (investmentProfile.investorType || investmentProfile.mainInvestmentGoal || investmentProfile.investmentHorizon || investmentProfile.attitudeToRisk) && (
        <DossierSection icon={TrendingUp} title={t('modules.chatsPage.инвестиционный_профи')} accent="ai">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {investmentProfile.investorType && <DossierMetaChip icon={TrendingUp} label={t('modules.chatsPage.тип_инвестора')} value={investmentProfile.investorType} />}
            {investmentProfile.mainInvestmentGoal && <DossierMetaChip icon={Target} label={t('modules.chatsPage.цель_инвестиции')} value={investmentProfile.mainInvestmentGoal} />}
            {investmentProfile.investmentHorizon && <DossierMetaChip icon={Clock} label={t('modules.chatsPage.горизонт')} value={investmentProfile.investmentHorizon} />}
            {investmentProfile.attitudeToRisk && <DossierMetaChip icon={ShieldAlert} label={t('modules.chatsPage.отношение_к_риску')} value={investmentProfile.attitudeToRisk} />}
          </div>
        </DossierSection>
      )}

      {decisionMakers && (decisionMakers.decisionMaker || decisionMakers.whoPays || (decisionMakers.influencers?.length ?? 0) > 0 || (decisionMakers.opponents?.length ?? 0) > 0) && (
        <DossierSection icon={Users} title={t('modules.chatsPage.лица_решения')} accent="gold">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {decisionMakers.decisionMaker && (
              <DossierMetaChip icon={Users} label={t('modules.chatsPage.кто_решает')} value={decisionMakers.decisionMaker} fullWidth />
            )}
            {decisionMakers.whoPays && (
              <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.кто_платит')} value={decisionMakers.whoPays} fullWidth />
            )}
            {(decisionMakers.influencers?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--chat-text-dim)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {t('modules.chatsPage.влиятельные_лица')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {decisionMakers.influencers!.map((p, i) => (
                    <span key={i} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'rgba(201,168,76,0.1)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.2)' }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(decisionMakers.opponents?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {t('modules.chatsPage.противники')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {decisionMakers.opponents!.map((p, i) => (
                    <span key={i} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {communication && (communication.preferredChannel || communication.bestTimeToContact || communication.communicationStyle || communication.tone) && (
        <DossierSection icon={MessageCircle} title={t('modules.chatsPage.коммуникация')} accent="ai">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {communication.preferredChannel && <DossierMetaChip icon={MessageCircle} label={t('modules.chatsPage.канал')} value={communication.preferredChannel} />}
            {communication.bestTimeToContact && <DossierMetaChip icon={Clock} label={t('modules.chatsPage.лучшее_время')} value={communication.bestTimeToContact} />}
            {communication.communicationStyle && <DossierMetaChip icon={Zap} label={t('modules.chatsPage.стиль')} value={communication.communicationStyle} />}
            {communication.tone && <DossierMetaChip icon={MessageSquareQuote} label={t('modules.chatsPage.тон')} value={communication.tone} />}
          </div>
        </DossierSection>
      )}

      {trust && (trust.trustToManager != null || trust.trustToPlatform != null || trust.trustToCountry != null || trust.trustToDevelopers != null) && (
        <DossierSection icon={ShieldCheck} title={t('modules.chatsPage.доверие')} accent="gold">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {trust.trustToManager != null && <TrustBar label={t('modules.chatsPage.менеджер')} value={trust.trustToManager} />}
            {trust.trustToPlatform != null && <TrustBar label={t('modules.chatsPage.платформа')} value={trust.trustToPlatform} />}
            {trust.trustToCountry != null && <TrustBar label={t('modules.chatsPage.страна')} value={trust.trustToCountry} />}
            {trust.trustToDevelopers != null && <TrustBar label={t('modules.chatsPage.застройщик')} value={trust.trustToDevelopers} />}
          </div>
        </DossierSection>
      )}

      {legalReadiness && (legalReadiness.dealReadiness || legalReadiness.documentsReady || legalReadiness.moneyReady) && (
        <DossierSection icon={Scale} title={t('modules.chatsPage.юридическая_готовнос')}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {legalReadiness.dealReadiness && <DossierMetaChip icon={Scale} label={t('modules.chatsPage.готовность_к_сделке')} value={legalReadiness.dealReadiness} fullWidth />}
            {legalReadiness.documentsReady && <DossierMetaChip icon={FileText} label={t('modules.chatsPage.документы')} value={legalReadiness.documentsReady} />}
            {legalReadiness.moneyReady && <DossierMetaChip icon={Wallet} label={t('modules.chatsPage.деньги')} value={legalReadiness.moneyReady} />}
          </div>
        </DossierSection>
      )}

      {dataQuality && (dataQuality.aiConfidence != null || (dataQuality.needsClarification?.length ?? 0) > 0 || (dataQuality.confirmedFacts?.length ?? 0) > 0 || (dataQuality.assumptions?.length ?? 0) > 0) && (
        <DossierSection icon={Database} title={t('modules.chatsPage.качество_данных')} accent="ai">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dataQuality.aiConfidence != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Info size={14} style={{ color: '#7dd3fc' }} />
                <span style={{ fontSize: 13, color: 'var(--chat-text)' }}>
                  {t('modules.chatsPage.уверенность_ии')}<strong>{dataQuality.aiConfidence}%</strong>
                </span>
              </div>
            )}
            {(dataQuality.needsClarification?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.уточнить')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dataQuality.needsClarification!.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--chat-text)', lineHeight: 1.4 }}>
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2, color: '#fbbf24' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(dataQuality.confirmedFacts?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#4ade80', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('modules.chatsPage.подтвержд_нные_факты')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dataQuality.confirmedFacts!.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--chat-text)', lineHeight: 1.4 }}>
                      <Check size={13} style={{ flexShrink: 0, marginTop: 2, color: '#4ade80' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(dataQuality.assumptions?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--chat-text-dim)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {t('modules.chatsPage.предположения')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dataQuality.assumptions!.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--chat-text-muted)', lineHeight: 1.4 }}>
                      <Info size={13} style={{ flexShrink: 0, marginTop: 2, color: 'var(--chat-text-dim)' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DossierSection>
      )}

      {risks.length > 0 && (
        <DossierSection icon={AlertTriangle} title={t('modules.chatsPage.риски')} accent="warn">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risks.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '9px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(251,146,60,0.2)',
                  background: 'rgba(251,146,60,0.06)',
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2, color: '#fdba74' }} />
                <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--chat-text)' }}>{r}</span>
              </div>
            ))}
          </div>
        </DossierSection>
      )}

      {suggestedReplies.length > 0 && (
        <DossierSection icon={MessageSquareQuote} title={t('modules.chatsPage.подсказки_по_ответу')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestedReplies.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onUseReply(s)}
                style={{
                  textAlign: 'left',
                  padding: '11px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--hub-card-border)',
                  background: 'var(--chat-surface-card)',
                  color: 'var(--chat-text)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  lineHeight: 1.45,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s, transform 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--gold) 50%, transparent)'
                  e.currentTarget.style.background = 'rgba(201,168,76,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--hub-card-border)'
                  e.currentTarget.style.background = 'var(--chat-surface-card)'
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </DossierSection>
      )}
    </div>
  )
}

function ChatPanelLoader({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 160,
        color: 'var(--chat-text-secondary)',
      }}
    >
      <Loader2
        size={28}
        className="animate-spin"
        style={{ color: 'var(--gold)' }}
        aria-hidden
      />
      <span style={{ fontSize: 14 }}>{label}</span>
    </div>
  )
}

/**
 * Аватар Афины — сгенерированный SVG: профиль в шлеме, отсылка к Афине Палладе.
 * Рисуем инлайном, чтобы не тянуть картинку и не зависеть от сети.
 */
function AthenaAvatar({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Афина"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id="athena-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0dca4" />
          <stop offset="100%" stopColor="#d8b862" />
        </linearGradient>
        <linearGradient id="athena-helm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e6c364" />
          <stop offset="100%" stopColor="#a07828" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="32" r="32" fill="#072821" />
      <circle cx="32" cy="32" r="31" fill="none" stroke="rgba(230,195,100,0.35)" strokeWidth="1.5" />

      {/* гребень шлема */}
      <path
        d="M20 21c2-9 9-14 16-13 4 .6 6 3 6 3-6-1-9 1-11 4-1.6 2.4-2.2 4.6-2.4 6.4z"
        fill="#d0e8df"
        opacity="0.85"
      />
      {/* купол шлема */}
      <path
        d="M19 34c0-9 6-16 14-16s14 6 14 15c0 2-.4 3.6-1 5l-4-2c.6-1.4.8-2.6.8-4 0-6-4-10-9.6-10S23 26 23 32z"
        fill="url(#athena-helm)"
      />
      {/* лицо в профиль */}
      <path
        d="M25 30c0-4 3.4-7 7.6-7 4.2 0 7.4 3 7.4 7v7c0 6-3 10-7.6 10-2.2 0-4-.7-5.2-1.8l1.4-4.4-2.6-1 2-2.6-2-1.4 1.6-2z"
        fill="url(#athena-face)"
      />
      {/* наносник и глаз */}
      <path d="M33 30v9" stroke="#a07828" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <circle cx="30" cy="33" r="1.6" fill="#072821" />
    </svg>
  )
}

function AthenaChatPanel({
  messages,
  directives,
  completedDirectives,
  loading,
  sending,
  draft,
  onDraftChange,
  onSend,
  scrollRef,
}: {
  messages: OwnerAiChatMessage[]
  directives: string
  completedDirectives: string
  loading: boolean
  sending: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  scrollRef: RefObject<HTMLDivElement | null>
}) {
    const { t } = useI18n();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Шапка ассистента */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: 'var(--chat-surface-subtle)',
          flexShrink: 0,
        }}
      >
        <AthenaAvatar size={36} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--chat-gold-text)', letterSpacing: '-0.02em' }}>
            Афина
          </div>
          <div style={{ fontSize: 16, color: 'var(--chat-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
            На связи
          </div>
        </div>
      </div>

      {completedDirectives.trim() && (
        <div
          style={{
            margin: '12px 14px 0',
            padding: '10px 12px',
            borderRadius: 6,
            background: 'var(--chat-surface-subtle)',
            fontSize: 16,
            lineHeight: 1.5,
            color: 'var(--chat-text-secondary)',
            whiteSpace: 'pre-wrap',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--chat-text-secondary)', marginBottom: 6 }}>
            {t('modules.chatsPage.выполнено')}</div>
          {completedDirectives}
        </div>
      )}

      {directives.trim() && (
        <div
          style={{
            margin: '12px 14px 0',
            padding: '10px 12px',
            borderRadius: 6,
            boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18)',
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
            fontSize: 16,
            lineHeight: 1.5,
            color: 'var(--chat-text-secondary)',
            whiteSpace: 'pre-wrap',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>
            {t('modules.chatsPage.активные_указания_дл')}</div>
          {directives}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 0,
        }}
      >
        {loading ? (
          <div style={{ padding: '24px 8px', color: 'var(--chat-text-secondary)', fontSize: 14, textAlign: 'center' }}>
            {t('modules.chatsPage.загрузка')}</div>
        ) : messages.length === 0 ? (
          <div style={{ padding: '24px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--chat-text-secondary)', fontSize: 16, textAlign: 'center', lineHeight: 1.6 }}>
            <AthenaAvatar size={56} />
            <div style={{ color: 'var(--chat-text)' }}>Афина ведёт этого клиента</div>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwner = msg.role === 'owner'
            if (isOwner) {
              return (
                <div
                  key={msg._id}
                  style={{
                    alignSelf: 'flex-end',
                    maxWidth: '88%',
                    padding: '10px 12px',
                    borderRadius: '8px 8px 2px 8px',
                    background: 'color-mix(in srgb, var(--gold) 18%, var(--chat-surface))',
                    boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18)',
                    color: 'var(--chat-text)',
                    fontSize: 16,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.text}
                </div>
              )
            }
            return (
              <div key={msg._id} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'flex-end', gap: 8, maxWidth: '92%' }}>
                <AthenaAvatar size={28} />
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px 8px 8px 2px',
                    background: 'var(--chat-surface-subtle)',
                    color: 'var(--chat-text)',
                    fontSize: 16,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    minWidth: 0,
                  }}
                >
                  {msg.text}
                </div>
              </div>
            )
          })
        )}
        {sending && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--chat-text-secondary)', fontSize: 16, padding: '4px 2px' }}>
            <AthenaAvatar size={20} />
            <Loader2 size={14} className="animate-spin" />
            Афина печатает…
          </div>
        )}
      </div>

      <div
        style={{
          padding: '10px 12px 14px',
          borderTop: '1px solid var(--chat-border)',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!sending && draft.trim()) onSend()
            }
          }}
          placeholder="Сообщение Афине"
          disabled={sending || loading}
          rows={2}
          style={{
            flex: 1,
            minWidth: 0,
            resize: 'none',
            padding: '10px 12px',
            borderRadius: 4,
            border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
            background: 'var(--chat-surface)',
            color: 'var(--chat-text)',
            fontFamily: 'inherit',
            fontSize: 16,
            lineHeight: 1.45,
            outline: 'none',
            opacity: sending || loading ? 0.7 : 1,
          }}
        />
        <button
          type="button"
          disabled={sending || loading || !draft.trim()}
          onClick={onSend}
          aria-label={t('modules.chatsPage.отправить_указание')}
          style={{
            width: 40,
            minWidth: 40,
            alignSelf: 'flex-end',
            height: 40,
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)',
            background: 'color-mix(in srgb, var(--gold) 22%, transparent)',
            color: 'var(--gold)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: sending || loading || !draft.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || loading || !draft.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

// ── Self-Tasks Panel ──────────────────────────────────────

const SELF_TASK_TYPES: SelfTaskType[] = [
  'follow_up_no_response', 'check_reaction', 'warmup_guide', 'clarify_status',
  'update_profile', 'next_recommendation', 'silence_control', 'price_drop_alert',
  'new_match_notification', 'document_reminder', 'viewing_feedback', 'market_update',
  'birthday_greeting', 'seasonal_tip', 'objection_handling', 'competitor_check', 'deal_momentum',
]

// ── Задачи человеку (пока только фронт: localStorage) ─────

type HumanTaskStatus = 'open' | 'done'

interface HumanTask {
  id: string
  dialogId: string
  title: string
  description?: string
  assigneeName: string
  priority: SelfTaskPriority
  dueAt: string
  status: HumanTaskStatus
  createdAt: string
}

const HUMAN_TASKS_STORAGE_KEY = 'bz26:chat-human-tasks'

function loadHumanTasks(dialogId: string): HumanTask[] {
  try {
    const raw = localStorage.getItem(HUMAN_TASKS_STORAGE_KEY)
    if (!raw) return []
    const all = JSON.parse(raw) as HumanTask[]
    if (!Array.isArray(all)) return []
    return all
      .filter((task) => task.dialogId === dialogId)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  } catch {
    return []
  }
}

function persistHumanTasks(dialogId: string, tasks: HumanTask[]) {
  try {
    const raw = localStorage.getItem(HUMAN_TASKS_STORAGE_KEY)
    const all = raw ? (JSON.parse(raw) as HumanTask[]) : []
    const others = Array.isArray(all) ? all.filter((task) => task.dialogId !== dialogId) : []
    localStorage.setItem(HUMAN_TASKS_STORAGE_KEY, JSON.stringify([...others, ...tasks]))
  } catch {
    /* хранилище недоступно — задачи живут только в текущей сессии */
  }
}

/** Вкладка «Задачи»: переключатель между задачами ИИ и задачами человеку. */
function TasksPanel({
  dialogId,
  assignee,
  onAssigneeChange,
}: {
  dialogId: string
  assignee: TaskAssignee
  onAssigneeChange: (value: TaskAssignee) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'inline-flex',
          gap: 4,
          padding: 2,
          background: 'var(--chat-surface)',
          borderRadius: 4,
          border: '1px solid var(--green-border)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {([
          { id: 'ai' as TaskAssignee, label: 'Задачи ИИ', Icon: Sparkles },
          { id: 'human' as TaskAssignee, label: 'Задачи человеку', Icon: UserRound },
        ]).map(({ id, label, Icon: AssigneeIcon }) => {
          const isActive = assignee === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onAssigneeChange(id)}
              aria-pressed={isActive}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 32,
                borderRadius: 3,
                border: 'none',
                background: isActive ? 'color-mix(in srgb, var(--gold) 24%, transparent)' : 'transparent',
                color: isActive ? 'var(--chat-gold-text)' : 'var(--chat-text-secondary)',
                fontSize: 16,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <AssigneeIcon size={14} style={{ flexShrink: 0 }} />
              {label}
            </button>
          )
        })}
      </div>

      {assignee === 'ai' ? <SelfTaskPanel dialogId={dialogId} /> : <HumanTaskPanel dialogId={dialogId} />}
    </div>
  )
}

function HumanTaskPanel({ dialogId }: { dialogId: string }) {
  const { addToast } = useToasts()
  const [tasks, setTasks] = useState<HumanTask[]>(() => loadHumanTasks(dialogId))
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    setTasks(loadHumanTasks(dialogId))
  }, [dialogId])

  const commit = useCallback((next: HumanTask[]) => {
    setTasks(next)
    persistHumanTasks(dialogId, next)
  }, [dialogId])

  const handleCreate = (data: { title: string; description?: string; assigneeName: string; priority: SelfTaskPriority; dueAt: string }) => {
    const task: HumanTask = {
      id: `ht-${Date.now()}-${Math.round(Math.random() * 10000)}`,
      dialogId,
      status: 'open',
      createdAt: new Date().toISOString(),
      ...data,
    }
    commit([...tasks, task].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()))
    setShowCreate(false)
    addToast('Задача поставлена', 'success')
  }

  const handleToggleDone = (taskId: string) => {
    commit(tasks.map((task) => (
      task.id === taskId ? { ...task, status: task.status === 'done' ? 'open' : 'done' } : task
    )))
  }

  const handleDelete = (taskId: string) => {
    commit(tasks.filter((task) => task.id !== taskId))
    setConfirmDeleteId(null)
    addToast('Задача удалена', 'success')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--chat-text)' }}>Задачи человеку</span>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 45%, transparent)', background: 'color-mix(in srgb, var(--gold) 10%, transparent)', color: 'var(--gold)', fontSize: 16, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <Plus size={12} /> Поставить
        </button>
      </div>

      {tasks.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--chat-text-secondary)', fontSize: 16 }}>
          Задач по этому клиенту нет
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map((task) => {
            const isDone = task.status === 'done'
            const isOverdue = !isDone && new Date(task.dueAt) < new Date()
            const priorityColor = SELF_TASK_PRIORITY_COLORS[task.priority]
            return (
              <div
                key={task.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: isOverdue ? 'rgba(255,180,171,0.06)' : 'var(--chat-surface-subtle)',
                  boxShadow: isOverdue
                    ? 'inset 0 0 0 1px rgba(255,180,171,0.35)'
                    : 'inset 0 0 0 1px rgba(201,168,76,0.18)',
                  opacity: isDone ? 0.72 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: isDone ? 'var(--chat-text-secondary)' : 'var(--gold)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 500, color: 'var(--chat-text)', textDecoration: isDone ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, color: 'var(--chat-text-secondary)', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: priorityColor, fontWeight: 500 }}>{SELF_TASK_PRIORITY_LABELS[task.priority]}</span>
                  <span>·</span>
                  <span>{task.assigneeName}</span>
                </div>

                {task.description && (
                  <div style={{ fontSize: 16, color: 'var(--chat-text-secondary)', marginBottom: 6, lineHeight: 1.45 }}>
                    {task.description}
                  </div>
                )}

                <div style={{ fontSize: 16, color: isOverdue ? 'var(--error, #ffb4ab)' : 'var(--chat-text-secondary)', marginBottom: 8 }}>
                  {isDone ? 'Выполнена' : `Срок: ${new Date(task.dueAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </div>

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => handleToggleDone(task.id)}
                    style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)', background: 'color-mix(in srgb, var(--gold) 8%, transparent)', color: 'var(--gold)', fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    {isDone ? 'Вернуть в работу' : 'Выполнена'}
                  </button>
                  {confirmDeleteId === task.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(255,180,171,0.35)', background: 'rgba(255,180,171,0.1)', color: '#ffb4ab', fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }}
                      >
                        Удалить
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--green-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }}
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(task.id)}
                      style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--green-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && <HumanTaskCreateModal onSubmit={handleCreate} onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function HumanTaskCreateModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: { title: string; description?: string; assigneeName: string; priority: SelfTaskPriority; dueAt: string }) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [assigneeName, setAssigneeName] = useState('')
  const [priority, setPriority] = useState<SelfTaskPriority>('medium')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 24)
    return d.toISOString().slice(0, 16)
  })

  const canSubmit = Boolean(title.trim() && assigneeName.trim() && dueAt)

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      assigneeName: assigneeName.trim(),
      priority,
      description: description.trim() || undefined,
      dueAt: new Date(dueAt).toISOString(),
    })
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid var(--green-border)',
    background: 'var(--chat-surface-subtle)',
    color: 'var(--chat-text)',
    fontSize: 16,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 16,
    color: 'var(--chat-text-secondary)',
    display: 'block',
    marginBottom: 4,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(20px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxHeight: '80vh', overflowY: 'auto', background: 'var(--chat-modal-card)', boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18)', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--chat-text)', letterSpacing: '-0.02em' }}>Новая задача человеку</span>
          <button type="button" onClick={onClose} aria-label="Закрыть" style={{ background: 'none', border: 'none', color: 'var(--chat-text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="human-task-title">Задача</label>
            <input id="human-task-title" value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="human-task-assignee">Исполнитель</label>
            <input id="human-task-assignee" value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="human-task-priority">Приоритет</label>
            <select id="human-task-priority" value={priority} onChange={(e) => setPriority(e.target.value as SelfTaskPriority)} style={fieldStyle}>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="human-task-desc">Описание</label>
            <textarea id="human-task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="human-task-due">Срок</label>
            <input id="human-task-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={fieldStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid var(--green-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }}>
            Отмена
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)', background: 'color-mix(in srgb, var(--gold) 18%, transparent)', color: 'var(--gold)', fontSize: 16, fontWeight: 500, fontFamily: 'inherit', cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5 }}>
            Поставить задачу
          </button>
        </div>
      </div>
    </div>
  )
}

function SelfTaskPanel({ dialogId }: { dialogId: string }) {
    const { t } = useI18n();
  const { addToast } = useToasts()
  const [tasks, setTasks] = useState<IAiSelfTask[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | SelfTaskStatus>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | SelfTaskType>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState<IAiSelfTask | null>(null)
  const [historyTask, setHistoryTask] = useState<IAiSelfTask | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    try {
      const opts: { status?: string; type?: string; limit?: number } = { limit: 50 }
      if (statusFilter !== 'all') opts.status = statusFilter
      if (typeFilter !== 'all') opts.type = typeFilter
      const res = await selfTaskApi.getTasks(dialogId, opts)
      if (res.success && res.data) setTasks(res.data.tasks)
      else setTasks([])
    } catch { setTasks([]) }
  }, [dialogId, statusFilter, typeFilter])

  useEffect(() => {
    setLoading(true)
    loadTasks().finally(() => setLoading(false))
  }, [loadTasks])

  const handlePause = async (taskId: string) => {
    setActingId(taskId)
    try {
      const res = await selfTaskApi.pauseTask(taskId)
      if (res.success && res.data) {
        setTasks((prev) => prev.map((t) => t._id === taskId ? res.data! : t))
        addToast('Задача приостановлена', 'success')
      } else addToast('Не удалось поставить на паузу', 'error')
    } catch { addToast('Ошибка', 'error') } finally { setActingId(null) }
  }

  const handleResume = async (taskId: string) => {
    setActingId(taskId)
    try {
      const res = await selfTaskApi.resumeTask(taskId)
      if (res.success && res.data) {
        setTasks((prev) => prev.map((t) => t._id === taskId ? res.data! : t))
        addToast('Задача возобновлена', 'success')
      } else addToast('Не удалось возобновить', 'error')
    } catch { addToast('Ошибка', 'error') } finally { setActingId(null) }
  }

  const handleExecuteNow = async (taskId: string) => {
    setActingId(taskId)
    try {
      const res = await selfTaskApi.executeNow(taskId)
      if (res.success) {
        addToast('Задача запущена на выполнение', 'success')
        loadTasks()
      } else addToast('Не удалось выполнить', 'error')
    } catch { addToast('Ошибка', 'error') } finally { setActingId(null) }
  }

  const handleDelete = async (taskId: string) => {
    setActingId(taskId)
    try {
      const res = await selfTaskApi.deleteTask(taskId)
      if (res.success) {
        setTasks((prev) => prev.filter((t) => t._id !== taskId))
        addToast('Задача удалена', 'success')
      } else addToast('Не удалось удалить', 'error')
    } catch { addToast('Ошибка', 'error') } finally { setActingId(null); setConfirmDeleteId(null) }
  }

  const handleCreate = async (data: { type: SelfTaskType; title: string; priority?: SelfTaskPriority; description?: string; executeAt: string; recurring?: boolean; recurringInterval?: string; recurringDays?: number[] }) => {
    try {
      const res = await selfTaskApi.createTask(dialogId, { ...data, recurringInterval: data.recurringInterval as any })
      if (res.success && res.data) {
        setTasks((prev) => [res.data!, ...prev])
        setShowCreate(false)
        addToast('Задача создана', 'success')
      } else addToast('Не удалось создать задачу', 'error')
    } catch { addToast('Ошибка', 'error') }
  }

  const handleUpdate = async (taskId: string, data: Record<string, unknown>) => {
    try {
      const res = await selfTaskApi.updateTask(taskId, data as any)
      if (res.success && res.data) {
        setTasks((prev) => prev.map((t) => t._id === taskId ? res.data! : t))
        setEditingTask(null)
        addToast('Задача обновлена', 'success')
      } else addToast('Не удалось обновить', 'error')
    } catch { addToast('Ошибка', 'error') }
  }

  const formatExecuteAt = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diffMs = d.getTime() - now.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffMs < 0) {
      if (diffDays < -1) return `Просрочена ${Math.abs(diffDays)} дн. назад`
      if (diffHours < -1) return `Просрочена ${Math.abs(diffHours)} ч. назад`
      return 'Просрочена'
    }
    if (diffDays > 0) return `Через ${diffDays} дн.`
    if (diffHours > 0) return `Через ${diffHours} ч.`
    return 'Скоро'
  }

  if (loading) {
    return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--chat-text-secondary)', fontSize: 13 }}>{t('modules.chatsPage.загрузка')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--chat-text)' }}>Задачи ИИ</span>
        <button type="button" onClick={() => setShowCreate(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 45%, transparent)', background: 'color-mix(in srgb, var(--gold) 10%, transparent)', color: 'var(--gold)', fontSize: 16, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
          <Plus size={12} /> {t('modules.chatsPage.создать')}</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
          style={{ flex: 1, padding: '5px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface)', color: 'var(--chat-text)', fontSize: 12, fontFamily: 'inherit' }}>
          <option value="all">{t('modules.chatsPage.все_статусы')}</option>
          <option value="scheduled">{t('modules.chatsPage.запланирована')}</option>
          <option value="in_progress">{t('modules.chatsPage.в_работе')}</option>
          <option value="completed">{t('modules.chatsPage.выполнена')}</option>
          <option value="paused">{t('modules.chatsPage.на_паузе')}</option>
          <option value="cancelled">{t('modules.chatsPage.отменена')}</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}
          style={{ flex: 1, padding: '5px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface)', color: 'var(--chat-text)', fontSize: 12, fontFamily: 'inherit' }}>
          <option value="all">{t('modules.chatsPage.все_типы')}</option>
          {SELF_TASK_TYPES.map((t) => <option key={t} value={t}>{SELF_TASK_TYPE_LABELS[t]}</option>)}
        </select>
      </div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--chat-text-secondary)', fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🤖</div>
          {t('modules.chatsPage.у_вас_пока_нет_самоз')}<div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{t('modules.chatsPage.ai_автоматически_соз')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map((task) => {
            const isOverdue = task.status === 'scheduled' && new Date(task.executeAt) < new Date()
            const statusColor = SELF_TASK_STATUS_COLORS[task.status]
            const priorityColor = SELF_TASK_PRIORITY_COLORS[task.priority]
            const isActing = actingId === task._id
            const isPaused = task.status === 'paused'
            const isCompleted = task.status === 'completed'
            const isCancelled = task.status === 'cancelled'

            return (
              <div key={task._id}
                style={{ padding: '10px 12px', borderRadius: 6, border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.35)' : 'var(--chat-border)'}`, background: isOverdue ? 'rgba(239,68,68,0.04)' : 'var(--chat-surface-subtle)', transition: 'border-color 0.15s' }}>
                {/* Row 1: title + status badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--chat-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${statusColor}22`, color: statusColor, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {SELF_TASK_STATUS_LABELS[task.status]}
                  </span>
                </div>

                {/* Row 2: meta info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--chat-text-secondary)', marginBottom: 6 }}>
                  <span style={{ color: priorityColor, fontWeight: 500 }}>{SELF_TASK_PRIORITY_LABELS[task.priority]}</span>
                  <span>·</span>
                  <span>{SELF_TASK_TYPE_LABELS[task.type]}</span>
                  {task.createdBy === 'ai' && <span title={t('modules.chatsPage.создано_ai')}>🤖</span>}
                </div>

                {/* Row 3: execute time */}
                <div style={{ fontSize: 11, color: isOverdue ? '#f87171' : 'var(--chat-text-dim)', marginBottom: 8 }}>
                  {isCompleted && task.executedAt
                    ? `Выполнена: ${new Date(task.executedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : `Выполнить: ${formatExecuteAt(task.executeAt)}`
                  }
                </div>

                {/* Actions */}
                {!isCompleted && !isCancelled && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {isPaused ? (
                      <button type="button" disabled={isActing} onClick={() => handleResume(task._id)}
                        style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11, fontFamily: 'inherit', cursor: isActing ? 'wait' : 'pointer', opacity: isActing ? 0.5 : 1 }}>
                        {t('modules.chatsPage.возобновить')}</button>
                    ) : (
                      <button type="button" disabled={isActing} onClick={() => handlePause(task._id)}
                        style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11, fontFamily: 'inherit', cursor: isActing ? 'wait' : 'pointer', opacity: isActing ? 0.5 : 1 }}>
                        {t('modules.chatsPage.пауза')}</button>
                    )}
                    <button type="button" disabled={isActing} onClick={() => handleExecuteNow(task._id)}
                      style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)', background: 'color-mix(in srgb, var(--gold) 8%, transparent)', color: 'var(--gold)', fontSize: 11, fontFamily: 'inherit', cursor: isActing ? 'wait' : 'pointer', opacity: isActing ? 0.5 : 1 }}>
                      {t('modules.chatsPage.выполнить')}</button>
                    <button type="button" onClick={() => setEditingTask(task)}
                      style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {t('modules.chatsPage.настройки')}</button>
                    {confirmDeleteId === task._id ? (
                      <>
                        <button type="button" onClick={() => handleDelete(task._id)}
                          style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                          {t('modules.chatsPage.удалить')}</button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)}
                          style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                          {t('modules.chatsPage.отмена')}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmDeleteId(task._id)}
                        style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                        {t('modules.chatsPage.удалить')}</button>
                    )}
                  </div>
                )}

                {/* History button for completed */}
                {isCompleted && (
                  <button type="button" onClick={() => setHistoryTask(task)}
                    style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {t('modules.chatsPage.история_выполнения')}</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && <SelfTaskCreateModal onSubmit={handleCreate} onClose={() => setShowCreate(false)} />}

      {/* Edit Modal */}
      {editingTask && <SelfTaskEditModal task={editingTask} onSubmit={(data) => handleUpdate(editingTask._id, data)} onClose={() => setEditingTask(null)} />}

      {/* History Modal */}
      {historyTask && <SelfTaskHistoryModal task={historyTask} onClose={() => setHistoryTask(null)} />}
    </div>
  )
}

function SelfTaskCreateModal({ onSubmit, onClose }: { onSubmit: (data: any) => void; onClose: () => void }) {
    const { t } = useI18n();
  const [type, setType] = useState<SelfTaskType>('follow_up_no_response')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<SelfTaskPriority>('medium')
  const [description, setDescription] = useState('')
  const [executeAt, setExecuteAt] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 24)
    return d.toISOString().slice(0, 16)
  })
  const [recurring, setRecurring] = useState(false)
  const [recurringInterval, setRecurringInterval] = useState('weekly')

  const handleSubmit = () => {
    if (!title.trim() || !executeAt) return
    onSubmit({ type, title: title.trim(), priority, description: description.trim() || undefined, executeAt: new Date(executeAt).toISOString(), recurring, recurringInterval: recurring ? recurringInterval : undefined })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxHeight: '80vh', overflowY: 'auto', background: 'var(--chat-modal-card)', border: '1px solid var(--chat-border)', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--chat-text)' }}>{t('modules.chatsPage.новая_самозадача')}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--chat-text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.тип_задачи')}</label>
            <select value={type} onChange={(e) => setType(e.target.value as SelfTaskType)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-solid)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit' }}>
              {SELF_TASK_TYPES.map((t) => <option key={t} value={t}>{SELF_TASK_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.название')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('modules.chatsPage.название_задачи')}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.приоритет')}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as SelfTaskPriority)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit' }}>
              <option value="high">{t('modules.chatsPage.высокий')}</option>
              <option value="medium">{t('modules.chatsPage.средний')}</option>
              <option value="low">{t('modules.chatsPage.низкий')}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.описание')}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('modules.chatsPage.инструкция_для_ai')} rows={3}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.дата_и_время_выполне')}</label>
            <input type="datetime-local" value={executeAt} onChange={(e) => setExecuteAt(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="recurring" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            <label htmlFor="recurring" style={{ fontSize: 12, color: 'var(--chat-text-secondary)', cursor: 'pointer' }}>{t('modules.chatsPage.повторяющаяся_задача')}</label>
          </div>
          {recurring && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.интервал')}</label>
              <select value={recurringInterval} onChange={(e) => setRecurringInterval(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit' }}>
                <option value="daily">{t('modules.chatsPage.ежедневно')}</option>
                <option value="weekly">{t('modules.chatsPage.еженедельно')}</option>
                <option value="biweekly">{t('modules.chatsPage.раз_в_2_недели')}</option>
                <option value="monthly">{t('modules.chatsPage.ежемесячно')}</option>
              </select>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
            {t('modules.chatsPage.отмена')}</button>
          <button type="button" onClick={handleSubmit} disabled={!title.trim() || !executeAt}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)', background: 'color-mix(in srgb, var(--gold) 18%, transparent)', color: 'var(--gold)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', opacity: !title.trim() || !executeAt ? 0.5 : 1 }}>
            {t('modules.chatsPage.создать')}</button>
        </div>
      </div>
    </div>
  )
}

function SelfTaskEditModal({ task, onSubmit, onClose }: { task: IAiSelfTask; onSubmit: (data: Record<string, unknown>) => void; onClose: () => void }) {
    const { t } = useI18n();
  const [title, setTitle] = useState(task.title)
  const [priority, setPriority] = useState<SelfTaskPriority>(task.priority)
  const [description, setDescription] = useState(task.description || '')
  const [executeAt, setExecuteAt] = useState(() => new Date(task.executeAt).toISOString().slice(0, 16))
  const [status, setStatus] = useState<SelfTaskStatus>(task.status)

  const handleSubmit = () => {
    onSubmit({ title: title.trim(), priority, description: description.trim() || undefined, executeAt: new Date(executeAt).toISOString(), status })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxHeight: '80vh', overflowY: 'auto', background: 'var(--chat-modal-card)', border: '1px solid var(--chat-border)', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--chat-text)' }}>{t('modules.chatsPage.настройки_задачи')}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--chat-text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.название')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.приоритет')}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as SelfTaskPriority)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit' }}>
              <option value="high">{t('modules.chatsPage.высокий')}</option>
              <option value="medium">{t('modules.chatsPage.средний')}</option>
              <option value="low">{t('modules.chatsPage.низкий')}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.статус')}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as SelfTaskStatus)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit' }}>
              <option value="scheduled">{t('modules.chatsPage.запланирована')}</option>
              <option value="in_progress">{t('modules.chatsPage.в_работе')}</option>
              <option value="completed">{t('modules.chatsPage.выполнена')}</option>
              <option value="paused">{t('modules.chatsPage.на_паузе')}</option>
              <option value="cancelled">{t('modules.chatsPage.отменена')}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.описание')}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--chat-text-secondary)', display: 'block', marginBottom: 4 }}>{t('modules.chatsPage.дата_и_время_выполне')}</label>
            <input type="datetime-local" value={executeAt} onChange={(e) => setExecuteAt(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'var(--chat-surface-subtle)', color: 'var(--chat-text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid var(--chat-border)', background: 'transparent', color: 'var(--chat-text-secondary)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
            {t('modules.chatsPage.отмена')}</button>
          <button type="button" onClick={handleSubmit}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)', background: 'color-mix(in srgb, var(--gold) 18%, transparent)', color: 'var(--gold)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
            {t('modules.chatsPage.сохранить')}</button>
        </div>
      </div>
    </div>
  )
}

function SelfTaskHistoryModal({ task, onClose }: { task: IAiSelfTask; onClose: () => void }) {
    const { t } = useI18n();
  const [history, setHistory] = useState<IExecutionRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    selfTaskApi.getHistory(task._id).then((res) => {
      if (res.success && res.data) setHistory(res.data.history)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [task._id])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: '80vh', overflowY: 'auto', background: 'var(--chat-surface)', border: '1px solid var(--chat-border)', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--chat-text)' }}>{t('modules.chatsPage.история')}{task.title}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--chat-text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        {loading ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--chat-text-secondary)', fontSize: 13 }}>{t('modules.chatsPage.загрузка')}</div>
        ) : history.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--chat-text-secondary)', fontSize: 13 }}>{t('modules.chatsPage.история_пуста')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {history.map((record, i) => {
              const icon = record.status === 'success' ? '✅' : record.status === 'failed' ? '❌' : '⏭️'
              const label = record.status === 'success' ? 'Успех' : record.status === 'failed' ? 'Ошибка' : 'Пропущено'
              return (
                <div key={i} style={{ padding: '10px 0', borderBottom: i < history.length - 1 ? '1px solid var(--chat-border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span>{icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--chat-text)' }}>{label}</span>
                    <span style={{ fontSize: 11, color: 'var(--chat-text-dim)', marginLeft: 'auto' }}>
                      {new Date(record.executedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {record.message && <div style={{ fontSize: 12, color: 'var(--chat-text-secondary)', marginLeft: 20 }}>{record.message}</div>}
                  {record.error && <div style={{ fontSize: 12, color: '#f87171', marginLeft: 20 }}>{record.error}</div>}
                  {record.duration != null && <div style={{ fontSize: 11, color: 'var(--chat-text-dim)', marginLeft: 20, marginTop: 2 }}>{t('modules.chatsPage.время')}{record.duration < 1000 ? `${record.duration} мс` : `${(record.duration / 1000).toFixed(1)} сек`}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function AiBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--chat-gold-text)', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function MaterialRow({ item }: { item: LMSItem }) {
    const { t } = useI18n();
  const Icon = MATERIAL_TYPE_ICON[item.type]
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 4,
        border: '1px solid var(--hub-card-border)',
        background: 'var(--chat-surface-subtle)',
      }}
    >
      <span
        style={{
          width: 32, height: 32, flexShrink: 0,
          borderRadius: 4,
          background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
          color: 'var(--gold)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, color: 'var(--chat-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
        <div style={{ fontSize: 13, color: 'var(--chat-text-secondary)', letterSpacing: '0.04em', marginTop: 2 }}>
          {MATERIAL_TYPE_LABEL[item.type]}{item.readTime ? ` · ${item.readTime}` : ''}
        </div>
      </div>
      <button
        type="button"
        style={{
          flexShrink: 0,
          padding: '7px 14px',
          borderRadius: 4,
          border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)',
          background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
          color: 'var(--gold)',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        {t('modules.chatsPage.отправить')}</button>

      {hovered && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 12,
            right: 12,
            padding: '8px 12px',
            borderRadius: 4,
            background: 'var(--chat-modal-card)',
            border: '1px solid var(--hub-card-border-hover)',
            color: 'var(--chat-text)',
            fontSize: 14,
            lineHeight: 1.4,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {item.title}
        </div>
      )}
    </div>
  )
}
