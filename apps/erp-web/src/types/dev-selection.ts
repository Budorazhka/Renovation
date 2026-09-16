import type { DevSelectionCustomization } from '@/config/dev-selection-customization'

export type DevSelectionStatus = 'draft' | 'sent' | 'viewed' | 'archived'

export const DEV_SELECTION_STATUS_LABELS: Record<DevSelectionStatus, string> = {
  draft: 'Черновик',
  sent: 'Отправлена',
  viewed: 'Просмотрена',
  archived: 'Архив',
}

export const DEV_SELECTION_STATUS_COLORS: Record<DevSelectionStatus, string> = {
  draft: 'rgba(242,207,141,0.72)',
  sent: '#d0e8df',
  viewed: '#c9a84c',
  archived: 'rgba(242,207,141,0.72)',
}

export type DevSelectionReaction = 'liked' | 'disliked' | 'question'

export type DevSelectionTargetType = 'unit' | 'listing'

/** Ровно одно из unitId/listingId заполнено — по targetType (N-27, зеркалит серверную схему). */
export interface DevSelectionItem {
  targetType: DevSelectionTargetType
  unitId?: string
  listingId?: string
  agentNote?: string
  reaction?: DevSelectionReaction
  viewedAt?: string
}

export interface DevSelection {
  id: string
  publicToken: string
  title: string
  leadId?: string
  clientName?: string
  clientPhone?: string
  agentNote?: string
  status: DevSelectionStatus
  items: DevSelectionItem[]
  createdAt: string
  sentAt?: string
  lastOpenedAt?: string
  viewCount: number
  /** Настройки клиентского отображения (язык, валюта, видимость блоков). */
  customization?: DevSelectionCustomization
}

/**
 * У DevSelection нет отдельного поля "рынок" — сервер хранит все подборки
 * организации в одной коллекции, различие только на уровне targetType
 * элементов. ERP же показывает подборки в двух разных контурах (новостройки
 * и вторичка), поэтому классифицируем подборку по составу её items: пустая
 * или состоящая только из юнитов — новостройки, только из листингов —
 * вторичка. Смешанные подборки сейчас не создаются ни одним из UI-флоу.
 */
export function isNewbuildSelection(sel: Pick<DevSelection, 'items'>): boolean {
  return sel.items.every((i) => i.targetType !== 'listing')
}

export function isSecondarySelection(sel: Pick<DevSelection, 'items'>): boolean {
  return sel.items.length > 0 && sel.items.every((i) => i.targetType === 'listing')
}
