import type { DevSelectionCustomization } from '@/config/dev-selection-customization'
import type { DevSelection, DevSelectionItem, DevSelectionReaction } from '@/types/dev-selection'

/**
 * Самодостаточная ссылка на подборку.
 *
 * Бэкенда у подборок нет: токен `#/s/:token` живёт только в localStorage агента,
 * поэтому у клиента на другом устройстве подборка не находится. Чтобы ссылку можно
 * было переслать, состав подборки (id лотов, контакты, заметки, кастомизация)
 * кладём прямо в URL — `?d=<payload>`. Сами квартиры клиент догружает через
 * публичный API лота (как визитка), а не из локального стора.
 */

const REACTION_CODE: Record<DevSelectionReaction, string> = {
  liked: 'l',
  disliked: 'd',
  question: 'q',
}
const REACTION_BY_CODE: Record<string, DevSelectionReaction> = {
  l: 'liked',
  d: 'disliked',
  q: 'question',
}

/** Компактный формат: короткие ключи, чтобы ссылка была не длиннее необходимого. */
interface SelectionSharePayload {
  /** title */
  t?: string
  /** clientName */
  cn?: string
  /** clientPhone */
  cp?: string
  /** agentNote (общая заметка к подборке) */
  an?: string
  /** customization */
  c?: DevSelectionCustomization
  /** items: u — unitId, n — заметка агента к лоту, r — реакция клиента */
  i: Array<{ u: string; n?: string; r?: string }>
}

/* ── UTF-8-safe base64url (кириллица в именах/заметках не должна ломать btoa) ── */

function toBase64Url(str: string): string {
  const utf8 = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
  return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const percent = Array.from(bin)
    .map((ch) => '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2))
    .join('')
  return decodeURIComponent(percent)
}

/** Кодирует подборку в payload для `?d=`. */
export function encodeSelectionShare(sel: DevSelection): string {
  const payload: SelectionSharePayload = {
    // Фоллбэк-payload поддерживает только юниты новостроек (см. докстринг файла) —
    // листинги вторички (N-27) резолвятся сервером в самой подборке по токену,
    // а не через это временное окно до ответа create().
    i: sel.items.filter((item): item is DevSelectionItem & { unitId: string } => Boolean(item.unitId)).map((item) => {
      const entry: { u: string; n?: string; r?: string } = { u: item.unitId }
      if (item.agentNote) entry.n = item.agentNote
      if (item.reaction) entry.r = REACTION_CODE[item.reaction]
      return entry
    }),
  }
  if (sel.title) payload.t = sel.title
  if (sel.clientName) payload.cn = sel.clientName
  if (sel.clientPhone) payload.cp = sel.clientPhone
  if (sel.agentNote) payload.an = sel.agentNote
  if (sel.customization) payload.c = sel.customization

  return toBase64Url(JSON.stringify(payload))
}

/** Прямая пересылаемая ссылка на подборку (состав внутри URL). */
export function buildSelectionShareUrl(sel: DevSelection): string {
  const base = `${window.location.origin}${window.location.pathname}#/s/${sel.publicToken}`
  return `${base}?d=${encodeSelectionShare(sel)}`
}

/** Только hash-часть (`#/s/...`) — для href в ссылках «Открыть». */
export function buildSelectionShareHash(sel: DevSelection): string {
  return `#/s/${sel.publicToken}?d=${encodeSelectionShare(sel)}`
}

/**
 * Восстанавливает подборку из payload `?d=`. Возвращает объект формы DevSelection
 * (служебные поля — заглушки), готовый к рендеру публичной страницей.
 */
export function parseSelectionShare(search: string): DevSelection | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const raw = params.get('d')
  if (!raw) return null

  try {
    const payload = JSON.parse(fromBase64Url(raw)) as SelectionSharePayload
    if (!Array.isArray(payload.i) || payload.i.length === 0) return null

    const items: DevSelectionItem[] = payload.i
      .filter((entry) => typeof entry?.u === 'string' && entry.u)
      .map((entry) => {
        const item: DevSelectionItem = { targetType: 'unit', unitId: entry.u }
        if (entry.n) item.agentNote = entry.n
        if (entry.r && REACTION_BY_CODE[entry.r]) item.reaction = REACTION_BY_CODE[entry.r]
        return item
      })
    if (items.length === 0) return null

    return {
      id: 'shared',
      publicToken: 'shared',
      title: payload.t ?? 'Подборка',
      clientName: payload.cn,
      clientPhone: payload.cp,
      agentNote: payload.an,
      status: 'sent',
      items,
      createdAt: '',
      viewCount: 0,
      customization: payload.c,
    }
  } catch {
    return null
  }
}
