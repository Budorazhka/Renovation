import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type { DevSelectionCustomization } from '@/config/dev-selection-customization'
import type { DevSelection, DevSelectionItem, DevSelectionReaction, DevSelectionStatus, DevSelectionTargetType } from '@/types/dev-selection'

/**
 * Публичный (без аутентификации, без cookie) клиент — открывается клиентом
 * с чужого устройства/браузера по ссылке `/selection/:token`, поэтому
 * `withCredentials: false` и никаких заголовков авторизации.
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
})

/** Денормализованные поля юнита новостройки — whitelist сервера, см. toPublicDevSelection в selections.service.ts. */
export interface PublicSelectionUnit {
  number: string
  kind?: string
  rooms?: number | string
  area?: number
  price?: { amountMinorUnits: number; currency: string }
  status: string
}

/** Денормализованные поля вторичного листинга — whitelist сервера (N-27). */
export interface PublicSelectionListing {
  propertyType: string
  city: string
  address: string
  area: number
  rooms?: number
  floor?: number
  dealType: 'sale' | 'rent_long' | 'rent_short'
  price: { amountMinorUnits: number; currency: string }
  status: string
}

interface ApiPublicSelectionItem {
  targetType: DevSelectionTargetType
  unitId?: string
  listingId?: string
  agentNote?: string
  reaction?: DevSelectionReaction
  viewedAt?: string
  unit?: PublicSelectionUnit
  listing?: PublicSelectionListing
}

interface ApiPublicSelectionResponse {
  title: string
  clientName?: string
  clientPhone?: string
  agentNote?: string
  status: DevSelectionStatus
  items: ApiPublicSelectionItem[]
  createdAt: string
  sentAt?: string
  viewCount: number
  customization?: DevSelectionCustomization
}

/** Публичный элемент подборки — DevSelectionItem + денормализованные данные объекта (сервер не заставляет клиента делать доп. запросы). */
export type PublicSelectionItem = DevSelectionItem & {
  unit?: PublicSelectionUnit
  listing?: PublicSelectionListing
}

/** Публичная проекция не содержит id/publicToken/leadId — служебные поля стору не нужны за пределами публичного просмотра. */
export type PublicDevSelection = Omit<DevSelection, 'id' | 'publicToken' | 'leadId' | 'items'> & {
  items: PublicSelectionItem[]
}

function mapApiPublicSelectionToFrontend(raw: ApiPublicSelectionResponse): PublicDevSelection {
  return {
    title: raw.title,
    clientName: raw.clientName,
    clientPhone: raw.clientPhone,
    agentNote: raw.agentNote,
    status: raw.status,
    items: raw.items.map((item): PublicSelectionItem => ({
      targetType: item.targetType,
      unitId: item.unitId,
      listingId: item.listingId,
      agentNote: item.agentNote,
      reaction: item.reaction,
      viewedAt: item.viewedAt,
      unit: item.unit,
      listing: item.listing,
    })),
    createdAt: raw.createdAt,
    sentAt: raw.sentAt,
    viewCount: raw.viewCount,
    customization: raw.customization,
  }
}

export const publicSelectionsApi = {
  /**
   * GET /api/v1/public/selections/:token — side-effect на сервере:
   * инкремент viewCount/lastOpenedAt, sent->viewed. Каждый вызов ЭТОГО
   * метода и есть факт "клиент открыл подборку".
   */
  async getByToken(token: string): Promise<PublicDevSelection> {
    const { data } = await api.get<ApiPublicSelectionResponse>(`/api/v1/public/selections/${token}`)
    return mapApiPublicSelectionToFrontend(data)
  },
}
