import { useSyncExternalStore } from 'react'
import type { DevSelection, DevSelectionItem, DevSelectionReaction, DevSelectionStatus } from '@/types/dev-selection'
import { DEFAULT_DEV_CUSTOMIZATION, type DevSelectionCustomization } from '@/config/dev-selection-customization'
import { devSelectionsApiV2, type DevSelectionRecord } from '@/services/devSelectionsApiV2'
import { publicSelectionsApi } from '@/services/publicSelectionsApi'

const STORAGE_KEY = 'dev.selections.v1'

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Плейсхолдер для `publicToken` НОВОЙ подборки в окне между optimistic-
 * добавлением в `selections` и ответом сервера (create() должен вернуть
 * подборку СИНХРОННО — CreateSelectionModal.tsx строит `buildSelectionShareUrl`
 * сразу же из возврата create(), см. этот файл не трогать без необходимости).
 * Никогда не отправляется на backend и не используется для реального
 * доступа — только временная локальная метка, заменяется настоящим 256-бит
 * токеном сервера (SelectionsService.generatePublicToken) в фоне, как только
 * ответ create() придёт. Слабый (8 символов a-z0-9), в отличие от серверного
 * — это ровно то же самое, чем был ЕДИНСТВЕННЫЙ токен до этой миграции, и
 * ровно поэтому небезопасно было использовать его как постоянный секрет.
 * Короткое окно гонки (скопировать ссылку до ответа сервера) закрыто тем, что
 * `buildSelectionShareUrl`/`selection-share.ts` кладёт полный состав подборки
 * в `?d=` — публичная страница отрисуется по этому payload, даже если токен
 * ещё не существует на сервере в момент открытия ссылки.
 */
function tempPublicToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function load(): DevSelectionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as DevSelectionRecord[]
  } catch {
    return []
  }
}

function save(selections: DevSelectionRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch { /* best-effort */ }
}

/** Версия для CAS — не часть публичного DevSelection, читаем из внутреннего DevSelectionRecord. */
function versionOf(selection: DevSelection): number {
  return (selection as DevSelectionRecord).version ?? 0
}

interface State {
  selections: DevSelection[]
  create: (params: { title: string; unitIds?: string[]; listingIds?: string[]; leadId?: string; clientName?: string; clientPhone?: string; agentNote?: string; customization?: DevSelectionCustomization }) => DevSelection
  update: (id: string, patch: Partial<Omit<DevSelection, 'id' | 'publicToken' | 'createdAt'>>) => void
  setStatus: (id: string, status: DevSelectionStatus) => void
  /** itemId — unitId либо listingId элемента (N-27: подборка объединяет оба типа). */
  setReaction: (selectionId: string, itemId: string, reaction: DevSelectionReaction | undefined) => void
  markViewed: (publicToken: string) => void
  updateItemNote: (selectionId: string, itemId: string, note: string) => void
  /** Юнит-специфичная обёртка над addItems — используется шахматкой/UnitDetailModal (только первичка). */
  addUnits: (selectionId: string, unitIds: string[]) => void
  addItems: (selectionId: string, items: { unitIds?: string[]; listingIds?: string[] }) => void
  removeItem: (selectionId: string, itemId: string) => void
  remove: (id: string) => void
  getByToken: (publicToken: string) => DevSelection | undefined
  /** Забрать актуальный список подборок организации с backend (вызывается страницами при монтировании, тот же паттерн, что useInstallmentStore.fetchForProject). */
  fetchAll: () => Promise<DevSelection[]>
}

let state: State
const listeners = new Set<() => void>()

/** Кэш подборок, открытых по публичной ссылке (клиент без аутентификации) — отдельно от `selections` (те organization-scoped, требуют сессии агента). Ключ — publicToken. */
const publicCache = new Map<string, DevSelection>()

function emit() { for (const l of listeners) l() }
function set(next: Partial<State>) {
  state = { ...state, ...next }
  if (next.selections) save(next.selections as DevSelectionRecord[])
  emit()
}
function get() { return state }

function findRecord(id: string): DevSelectionRecord | undefined {
  return get().selections.find((s) => s.id === id) as DevSelectionRecord | undefined
}

function replaceSelection(id: string, saved: DevSelectionRecord) {
  set({ selections: get().selections.map((s) => (s.id === id ? saved : s)) })
}

state = {
  selections: load(),

  create({ title, unitIds = [], listingIds = [], leadId, clientName, clientPhone, agentNote, customization }) {
    const now = new Date().toISOString()
    const tempId = uid()
    const sel: DevSelectionRecord = {
      id: tempId,
      publicToken: tempPublicToken(),
      title,
      leadId,
      clientName,
      clientPhone,
      agentNote,
      status: 'draft',
      items: [
        ...unitIds.map((unitId): DevSelectionItem => ({ targetType: 'unit', unitId })),
        ...listingIds.map((listingId): DevSelectionItem => ({ targetType: 'listing', listingId })),
      ],
      createdAt: now,
      viewCount: 0,
      customization: customization ?? DEFAULT_DEV_CUSTOMIZATION,
      version: 0,
    }
    set({ selections: [sel, ...get().selections] })

    devSelectionsApiV2
      .create({ title, unitIds, listingIds, leadId, clientName, clientPhone, agentNote, customization })
      .then((saved) => replaceSelection(tempId, saved))
      .catch((err) => console.error('Не удалось сохранить подборку на сервере:', err))

    return sel
  },

  update(id, patch) {
    const target = findRecord(id)
    if (!target) return
    set({ selections: get().selections.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

    devSelectionsApiV2
      .update(
        id,
        {
          title: patch.title,
          leadId: patch.leadId,
          clientName: patch.clientName,
          clientPhone: patch.clientPhone,
          agentNote: patch.agentNote,
          customization: patch.customization,
        },
        versionOf(target),
      )
      .then((saved) => replaceSelection(id, saved))
      .catch((err) => console.error('Не удалось обновить подборку на сервере:', err))
  },

  setStatus(id, status) {
    const target = findRecord(id)
    if (!target) return
    const patch: Partial<DevSelection> = { status }
    if (status === 'sent' && !target.sentAt) patch.sentAt = new Date().toISOString()
    set({ selections: get().selections.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

    devSelectionsApiV2
      .setStatus(id, status, versionOf(target))
      .then((saved) => replaceSelection(id, saved))
      .catch((err) => console.error('Не удалось изменить статус подборки на сервере:', err))
  },

  setReaction(selectionId, itemId, reaction) {
    const target = findRecord(selectionId)
    if (!target) return
    const now = new Date().toISOString()
    set({
      selections: get().selections.map((s) => {
        if (s.id !== selectionId) return s
        return {
          ...s,
          items: s.items.map((item) =>
            item.unitId === itemId || item.listingId === itemId ? { ...item, reaction, viewedAt: now } : item,
          ),
        }
      }),
    })

    devSelectionsApiV2
      .updateItem(selectionId, itemId, { reaction: reaction ?? null }, versionOf(target))
      .then((saved) => replaceSelection(selectionId, saved))
      .catch((err) => console.error('Не удалось сохранить реакцию на лот на сервере:', err))
  },

  markViewed(publicToken) {
    publicSelectionsApi
      .getByToken(publicToken)
      .then((pub) => {
        publicCache.set(publicToken, { id: publicToken, publicToken, ...pub })
        emit()
      })
      .catch((err) => console.error('Не удалось открыть подборку по ссылке:', err))
  },

  updateItemNote(selectionId, itemId, note) {
    const target = findRecord(selectionId)
    if (!target) return
    set({
      selections: get().selections.map((s) => {
        if (s.id !== selectionId) return s
        return {
          ...s,
          items: s.items.map((item) =>
            item.unitId === itemId || item.listingId === itemId ? { ...item, agentNote: note } : item,
          ),
        }
      }),
    })

    devSelectionsApiV2
      .updateItem(selectionId, itemId, { agentNote: note }, versionOf(target))
      .then((saved) => replaceSelection(selectionId, saved))
      .catch((err) => console.error('Не удалось сохранить заметку агента на сервере:', err))
  },

  addUnits(selectionId, unitIds) {
    get().addItems(selectionId, { unitIds })
  },

  addItems(selectionId, { unitIds = [], listingIds = [] }) {
    const target = findRecord(selectionId)
    if (!target) return
    const existingUnits = new Set(target.items.map((i) => i.unitId).filter(Boolean))
    const existingListings = new Set(target.items.map((i) => i.listingId).filter(Boolean))
    const newUnitIds = unitIds.filter((id) => !existingUnits.has(id))
    const newListingIds = listingIds.filter((id) => !existingListings.has(id))
    if (newUnitIds.length === 0 && newListingIds.length === 0) return

    set({
      selections: get().selections.map((s) => {
        if (s.id !== selectionId) return s
        return {
          ...s,
          items: [
            ...s.items,
            ...newUnitIds.map((unitId): DevSelectionItem => ({ targetType: 'unit', unitId })),
            ...newListingIds.map((listingId): DevSelectionItem => ({ targetType: 'listing', listingId })),
          ],
        }
      }),
    })

    devSelectionsApiV2
      .addItems(selectionId, { unitIds: newUnitIds, listingIds: newListingIds }, versionOf(target))
      .then((saved) => replaceSelection(selectionId, saved))
      .catch((err) => console.error('Не удалось добавить лоты в подборку на сервере:', err))
  },

  removeItem(selectionId, itemId) {
    const target = findRecord(selectionId)
    if (!target) return
    set({
      selections: get().selections.map((s) =>
        s.id !== selectionId
          ? s
          : { ...s, items: s.items.filter((i) => i.unitId !== itemId && i.listingId !== itemId) },
      ),
    })

    devSelectionsApiV2
      .removeItem(selectionId, itemId, versionOf(target))
      .then((saved) => replaceSelection(selectionId, saved))
      .catch((err) => console.error('Не удалось удалить лот из подборки на сервере:', err))
  },

  remove(id) {
    const target = findRecord(id)
    set({ selections: get().selections.filter((s) => s.id !== id) })
    if (!target) return

    devSelectionsApiV2
      .remove(id, versionOf(target))
      .catch((err) => console.error('Не удалось удалить подборку на сервере:', err))
  },

  getByToken(publicToken) {
    return get().selections.find((s) => s.publicToken === publicToken) ?? publicCache.get(publicToken)
  },

  async fetchAll() {
    try {
      const items = await devSelectionsApiV2.list()
      set({ selections: items })
      return items
    } catch (err) {
      console.error('Не удалось получить подборки с сервера:', err)
      return get().selections
    }
  },
}

export function useDevSelectionsStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => selector(get()),
    () => selector(get()),
  )
}

export function getDevSelectionsState() { return state }
