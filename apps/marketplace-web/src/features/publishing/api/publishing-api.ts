import type {
  LocationFormData,
  CharacteristicsFormData,
  DealFormData,
  DuplicateCandidate,
  ActualityState,
  PublicationStatusResult,
} from '../model/types'
import type { PublicBuyerRequest, CreateBuyerRequestPayload } from '../../../types/marketplace'
import { resolveApiBaseUrl } from './api-base'

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

/**
 * Объект недвижимости, как его отдаёт приватный API владельцу.
 *
 * Умышленно узкий тип: только то, что реально приходит и используется. Счётчиков
 * просмотров, лидов и добавлений в избранное здесь нет, потому что их нет и в
 * API — см. `docs/operations/marketplace-listing-edit.md`.
 */
export interface OwnerPropertyAsset {
  _id: string
  propertyType: string
  commercialSubtype?: string
  location: { country: string; city: string; address: string }
  characteristics: { area?: number; rooms?: number; floor?: number; totalFloors?: number }
  representativePhone: string
  version: number
  createdAt?: string
  updatedAt?: string
}

export interface OwnerListing {
  _id: string
  propertyAssetId: string
  dealType: 'sale' | 'rent_long' | 'rent_short'
  price: { amountMinorUnits: number; currency: string }
  status: 'draft' | 'active' | 'expired' | 'archived'
  version: number
  createdAt?: string
  /** Дата последней правки. Отсутствует у объявлений, которые ни разу не правили. */
  updatedAt?: string
}

export type FavoriteTargetType = 'development' | 'listing'

export interface FavoriteEntry {
  targetType: FavoriteTargetType
  slug: string
  createdAt: string
}

export interface MarketplaceSelectionItem {
  targetType: FavoriteTargetType
  slug: string
  addedAt: string
}

export interface MarketplaceSelectionEntry {
  id: string
  title: string
  items: MarketplaceSelectionItem[]
  publicToken: string
  createdAt: string
  updatedAt: string
}

export class PublishingApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'PublishingApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined && options.body !== null ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    let errorDetail = response.statusText
    try {
      const errorJson = await response.json()
      errorDetail = errorJson.message || errorJson.error || response.statusText
    } catch {
      // Non-JSON
    }
    throw new PublishingApiError(errorDetail, response.status)
  }

  if (response.status === 204) {
    return {} as T
  }

  return response.json() as Promise<T>
}

export const publishingApi = {
  async createPropertyAsset(
    data: {
      location: LocationFormData
      characteristics: CharacteristicsFormData
    },
    idempotencyKey: string,
  ): Promise<{ _id: string; version: number }> {
    const payload = {
      propertyType: data.characteristics.propertyType,
      commercialSubtype:
        data.characteristics.propertyType === 'commercial' ? data.characteristics.commercialSubtype : undefined,
      location: {
        country: data.location.country || 'GE',
        city: data.location.city,
        address: data.location.address,
        geo: data.location.geo,
      },
      characteristics: {
        area: Number(data.characteristics.area),
        rooms: data.characteristics.rooms !== '' ? Number(data.characteristics.rooms) : undefined,
        floor: data.characteristics.floor !== '' ? Number(data.characteristics.floor) : undefined,
        totalFloors: data.characteristics.totalFloors !== '' ? Number(data.characteristics.totalFloors) : undefined,
      },
      representativePhone: data.characteristics.representativePhone,
    }

    return request<{ _id: string; version: number }>('/marketplace/property-assets', {
      method: 'POST',
      // Ключ обязателен: повтор без него создал бы второй объект (ADR-006).
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    })
  },

  async createListing(
    assetId: string,
    deal: DealFormData,
    idempotencyKey: string,
  ): Promise<{ _id: string; dealType: string; status: string; version: number }> {
    const amountMinorUnits = Math.round(Number(deal.priceAmount) * 100)
    const payload = {
      dealType: deal.dealType,
      price: {
        amountMinorUnits,
        currency: deal.currency,
      },
    }

    return request<{ _id: string; dealType: string; status: string; version: number }>(
      `/marketplace/property-assets/${assetId}/listings`,
      {
        method: 'POST',
        // Ключ обязателен: повтор без него создал бы второй листинг (ADR-006).
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      },
    )
  },

  /**
   * Избранное текущего пользователя. Требует сессии: 401 здесь означает «войдите»,
   * а не «избранного нет» — вызывающий код обязан их различать.
   */
  async listFavorites(): Promise<FavoriteEntry[]> {
    return request<FavoriteEntry[]>('/marketplace/favorites')
  },

  async addFavorite(target: { targetType: FavoriteTargetType; slug: string }): Promise<FavoriteEntry> {
    return request<FavoriteEntry>('/marketplace/favorites', {
      method: 'POST',
      body: JSON.stringify(target),
    })
  },

  async removeFavorite(target: { targetType: FavoriteTargetType; slug: string }): Promise<{ removed: boolean }> {
    return request<{ removed: boolean }>('/marketplace/favorites', {
      method: 'DELETE',
      body: JSON.stringify(target),
    })
  },

  /**
   * Подборки текущего покупателя (N-11). Живут на сервере у аккаунта —
   * открываются с любого устройства и по ссылке (publicToken), не только
   * в браузере, где были созданы.
   */
  async listSelections(): Promise<MarketplaceSelectionEntry[]> {
    return request<MarketplaceSelectionEntry[]>('/marketplace/selections')
  },

  async createSelection(title: string): Promise<MarketplaceSelectionEntry> {
    return request<MarketplaceSelectionEntry>('/marketplace/selections', {
      method: 'POST',
      // Обязателен: в отличие от избранного создание НЕ идемпотентно по
      // построению — без ключа повтор (двойной клик) завёл бы вторую
      // пустую подборку.
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ title }),
    })
  },

  async renameSelection(id: string, title: string): Promise<MarketplaceSelectionEntry> {
    return request<MarketplaceSelectionEntry>(`/marketplace/selections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  },

  async deleteSelection(id: string): Promise<{ removed: boolean }> {
    return request<{ removed: boolean }>(`/marketplace/selections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async addSelectionItem(
    id: string,
    target: { targetType: FavoriteTargetType; slug: string },
  ): Promise<MarketplaceSelectionEntry> {
    return request<MarketplaceSelectionEntry>(`/marketplace/selections/${encodeURIComponent(id)}/items`, {
      method: 'POST',
      body: JSON.stringify(target),
    })
  },

  async removeSelectionItem(
    id: string,
    target: { targetType: FavoriteTargetType; slug: string },
  ): Promise<MarketplaceSelectionEntry> {
    return request<MarketplaceSelectionEntry>(`/marketplace/selections/${encodeURIComponent(id)}/items`, {
      method: 'DELETE',
      body: JSON.stringify(target),
    })
  },

  /**
   * N-13: свои запросы покупателя, все статусы (единственный способ узнать
   * id, чтобы закрыть запрос, если он потерян со страницы создания).
   */
  async listMyBuyerRequests(): Promise<{ items: PublicBuyerRequest[] }> {
    return request<{ items: PublicBuyerRequest[] }>('/marketplace/requests')
  },

  async createBuyerRequest(data: CreateBuyerRequestPayload): Promise<PublicBuyerRequest> {
    return request<PublicBuyerRequest>('/marketplace/requests', {
      method: 'POST',
      // Обязателен: повтор (двойной клик, ретрай) без ключа создал бы
      // второй публичный запрос — тот же принцип, что createSelection выше.
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(data),
    })
  },

  async closeBuyerRequest(id: string): Promise<PublicBuyerRequest> {
    return request<PublicBuyerRequest>(`/marketplace/requests/${encodeURIComponent(id)}/close`, {
      method: 'PATCH',
    })
  },

  /** Отзыв уходит в pending — не появится в публичном списке до модерации. */
  async submitRealtorReview(data: {
    realtorPositionId: string
    completedDealId: string
    rating: number
    text: string
  }): Promise<{ id: string; status: string }> {
    return request<{ id: string; status: string }>('/marketplace/realtor-reviews', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /** Объекты текущего владельца. Кабинет «Мои объекты» и экран редактирования. */
  async listPropertyAssets(): Promise<OwnerPropertyAsset[]> {
    return request<OwnerPropertyAsset[]>('/marketplace/property-assets')
  },

  async getPropertyAsset(assetId: string): Promise<OwnerPropertyAsset> {
    return request<OwnerPropertyAsset>(`/marketplace/property-assets/${assetId}`)
  },

  async listListingsForAsset(assetId: string): Promise<OwnerListing[]> {
    return request<OwnerListing[]>(`/marketplace/property-assets/${assetId}/listings`)
  },

  /**
   * Правка объявления (MKT-SCR-021).
   *
   * Тип объекта, тип сделки и адрес в патч не входят: по ним ищутся дубликаты,
   * и сервер такие поля отклоняет с 400. Ответ говорит `rebuildRequested` —
   * была ли запрошена пересборка каталога, чтобы экран мог честно сказать, что
   * изменения появятся в каталоге не мгновенно.
   */
  async updateListing(
    assetId: string,
    listingId: string,
    patch: {
      price?: { amountMinorUnits: number; currency: string }
      characteristics?: { area?: number; rooms?: number; floor?: number; totalFloors?: number }
      representativePhone?: string
    },
  ): Promise<{ listing: OwnerListing; rebuildRequested: boolean }> {
    return request<{ listing: OwnerListing; rebuildRequested: boolean }>(
      `/marketplace/property-assets/${assetId}/listings/${listingId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    )
  },

  async activateListing(
    assetId: string,
    listingId: string,
  ): Promise<{ _id: string; status: string; version: number }> {
    return request<{ _id: string; status: string; version: number }>(
      `/marketplace/property-assets/${assetId}/listings/${listingId}/activate`,
      {
        method: 'PATCH',
      },
    )
  },

  // 3-Phase Media Vertical
  async createMediaUploadIntent(
    assetId: string,
    declaredMimeType: string,
    sizeBytes: number,
  ): Promise<{ mediaAssetId: string; uploadUrl: string }> {
    return request<{ mediaAssetId: string; uploadUrl: string }>(
      `/marketplace/property-assets/${assetId}/media/upload-intent`,
      {
        method: 'POST',
        body: JSON.stringify({ declaredMimeType, sizeBytes }),
      },
    )
  },

  async uploadBinaryFile(uploadUrl: string, file: File | Blob, mimeType: string): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: file,
    })

    if (!response.ok) {
      throw new PublishingApiError(`Failed to upload file to storage (${response.status})`, response.status)
    }
  },

  async confirmMediaUpload(
    assetId: string,
    mediaAssetId: string,
    options?: { role?: 'cover' | 'gallery'; alt?: string },
  ): Promise<any[]> {
    return request<any[]>(
      `/marketplace/property-assets/${assetId}/media/${mediaAssetId}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify(options || {}),
      },
    )
  },

  async listMedia(assetId: string): Promise<any[]> {
    return request<any[]>(`/marketplace/property-assets/${assetId}/media`)
  },

  async deleteMedia(assetId: string, mediaAssetId: string): Promise<void> {
    return request<void>(`/marketplace/property-assets/${assetId}/media/${mediaAssetId}`, {
      method: 'DELETE',
    })
  },

  async updateMediaItem(
    assetId: string,
    mediaAssetId: string,
    dto: { role?: 'cover' | 'gallery'; alt?: string },
  ): Promise<any> {
    return request<any>(`/marketplace/property-assets/${assetId}/media/${mediaAssetId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    })
  },

  // Deduplication & Actuality
  async getDuplicateCandidates(assetId: string): Promise<DuplicateCandidate[]> {
    return request<DuplicateCandidate[]>(`/marketplace/property-assets/${assetId}/duplicate-candidates`)
  },

  async overrideDuplicate(duplicateCandidateId: string, reason: string): Promise<{ id: string; status: string }> {
    return request<{ id: string; status: string }>(
      `/marketplace/property-assets/duplicate-candidates/${duplicateCandidateId}/override`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    )
  },

  async getActuality(assetId: string, listingId: string): Promise<ActualityState> {
    return request<ActualityState>(
      `/marketplace/property-assets/${assetId}/listings/${listingId}/actuality`,
    )
  },

  async confirmActuality(assetId: string, listingId: string, expectedVersion: number): Promise<ActualityState> {
    return request<ActualityState>(
      `/marketplace/property-assets/${assetId}/listings/${listingId}/confirm-actuality`,
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion }),
      },
    )
  },

  // Publish & Polling
  async publishListing(
    assetId: string,
    listingId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; sourceType: string; sourceId: string; status: string }> {
    return request<{ id: string; sourceType: string; sourceId: string; status: string }>(
      `/marketplace/property-assets/${assetId}/listings/${listingId}/publish`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    )
  },

  async getPublicationStatus(assetId: string, listingId: string): Promise<PublicationStatusResult> {
    return request<PublicationStatusResult>(
      `/marketplace/property-assets/${assetId}/listings/${listingId}/publication-status`,
    )
  },
}
