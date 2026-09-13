import type {
  PublicSelection,
  PublicMarketplaceSelection,
  CatalogueQuery,
  PublicDevelopmentCard,
  PublicDevelopmentList,
  ListingCatalogueQuery,
  PublicListingCard,
  PublicListingList,
  PublicBuyerRequestList,
  BuyerRequestQuery,
  PublicRealtorReview,
  PublicRealtorProfile,
  PublicRealtorList,
  PublicRealtorQuery,
} from '../types/marketplace'
import { getStoredLanguage, en, ka, ru } from '../i18n'

/**
 * Этот слой — не React, `useI18n` здесь недоступен. Язык читается тем же
 * способом, что в useSeoMetadata.ts: по ключу в localStorage, с запасным
 * вариантом «ru».
 */
const API_ERROR_DICTS = {
  ru: ru.apiErrors,
  en: en.apiErrors,
  ka: ka.apiErrors,
}

function apiErrors() {
  return API_ERROR_DICTS[getStoredLanguage()]
}

type Fetcher = typeof fetch

export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'MarketplaceApiError'
  }
}

export interface RevealContactPayload {
  requesterName?: string
  requesterPhone: string
  utm?: Record<string, string>
}

export interface RevealContactResponse {
  phone: string
  whatsapp?: string | null
  telegram?: string | null
  leadId: string
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function toErrorMessage(status: number): string {
  if (status === 404) return apiErrors().notFound
  if (status === 429) return apiErrors().tooManyRequests
  return apiErrors().loadFailed
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let customMessage: string | undefined
    let errorCode: string | undefined
    try {
      const data = await response.json()
      if (data?.message) {
        customMessage = Array.isArray(data.message) ? data.message.join(', ') : data.message
      } else if (data?.error?.message) {
        customMessage = data.error.message
      }
      if (data?.code) errorCode = data.code
      if (data?.error?.code) errorCode = data.error.code
    } catch {
      // json parse error, ignore
    }

    if (response.status === 404) {
      throw new MarketplaceApiError(customMessage || apiErrors().notFound, 404, errorCode)
    }
    if (response.status === 429) {
      throw new MarketplaceApiError(apiErrors().tooManyRequests, 429, errorCode)
    }
    if (response.status === 400 || response.status === 422) {
      throw new MarketplaceApiError(customMessage || apiErrors().checkPhone, response.status, errorCode)
    }

    throw new MarketplaceApiError(customMessage || toErrorMessage(response.status), response.status, errorCode)
  }
  return response.json() as Promise<T>
}

export interface RequestOptions {
  signal?: AbortSignal
}

export function createMarketplaceApi({ baseUrl, fetcher = fetch }: { baseUrl: string; fetcher?: Fetcher }) {
  const apiBaseUrl = normalizedBaseUrl(baseUrl)

  return {
    /**
     * Персональная подборка по токену из ссылки, которую риэлтор отправил
     * клиенту. Без аутентификации: авторизует сам токен (256 бит случайности),
     * и он открывает ровно эту подборку.
     */
    async getPublicSelection(token: string, options?: RequestOptions): Promise<PublicSelection> {
      const response = await fetcher(`${apiBaseUrl}/public/selections/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicSelection>(response)
    },

    /**
     * Подборка покупателя по ссылке (N-11) — «открывается по ссылке» из
     * решения владельца, тот же принцип, что getPublicSelection выше, но
     * без аутентификации владельца и без сохранённого признака просмотра.
     */
    async getPublicMarketplaceSelection(
      token: string,
      options?: RequestOptions,
    ): Promise<PublicMarketplaceSelection> {
      const response = await fetcher(`${apiBaseUrl}/public/marketplace-selections/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicMarketplaceSelection>(response)
    },

    async listDevelopments(query: CatalogueQuery = {}, options?: RequestOptions): Promise<PublicDevelopmentList> {
      const params = new URLSearchParams()
      if (query.city?.trim()) params.set('city', query.city.trim())
      if (query.bbox) {
        const { minLng, minLat, maxLng, maxLat } = query.bbox
        params.set('bbox', `${minLng},${minLat},${maxLng},${maxLat}`)
      }
      if (query.publisher) params.set('publisher', query.publisher)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      if (query.sort) params.set('sort', query.sort)
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      const response = await fetcher(`${apiBaseUrl}/public/developments${suffix}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicDevelopmentList>(response)
    },

    async getDevelopment(slug: string, options?: RequestOptions): Promise<PublicDevelopmentCard> {
      const response = await fetcher(`${apiBaseUrl}/public/developments/${encodeURIComponent(slug)}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicDevelopmentCard>(response)
    },

    async revealDevelopmentContact(
      slug: string,
      payload: RevealContactPayload,
      options?: RequestOptions,
    ): Promise<RevealContactResponse> {
      const response = await fetcher(
        `${apiBaseUrl}/public/developments/${encodeURIComponent(slug)}/reveal-contact`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: options?.signal,
        },
      )
      return parseResponse<RevealContactResponse>(response)
    },

    async listListings(query: ListingCatalogueQuery = {}, options?: RequestOptions): Promise<PublicListingList> {
      const params = new URLSearchParams()
      if (query.city?.trim()) params.set('city', query.city.trim())
      if (query.dealType) params.set('dealType', query.dealType)
      if (query.propertyType) params.set('propertyType', query.propertyType)
      if (query.commercialSubtype) params.set('commercialSubtype', query.commercialSubtype)
      if (query.bbox) {
        const { minLng, minLat, maxLng, maxLat } = query.bbox
        params.set('bbox', `${minLng},${minLat},${maxLng},${maxLat}`)
      }
      if (query.publisher) params.set('publisher', query.publisher)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      if (query.sort) params.set('sort', query.sort)
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      const response = await fetcher(`${apiBaseUrl}/public/listings${suffix}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicListingList>(response)
    },

    async getListing(slug: string, options?: RequestOptions): Promise<PublicListingCard> {
      const response = await fetcher(`${apiBaseUrl}/public/listings/${encodeURIComponent(slug)}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicListingCard>(response)
    },

    async revealListingContact(
      slug: string,
      payload: RevealContactPayload,
      options?: RequestOptions,
    ): Promise<RevealContactResponse> {
      const response = await fetcher(
        `${apiBaseUrl}/public/listings/${encodeURIComponent(slug)}/reveal-contact`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: options?.signal,
        },
      )
      return parseResponse<RevealContactResponse>(response)
    },

    /** N-13: публичная доска запросов покупателей — без аутентификации, без контактов автора. */
    async listBuyerRequests(query: BuyerRequestQuery = {}, options?: RequestOptions): Promise<PublicBuyerRequestList> {
      const params = new URLSearchParams()
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.dealType) params.set('dealType', query.dealType)
      if (query.city?.trim()) params.set('city', query.city.trim())
      if (query.propertyKind) params.set('propertyKind', query.propertyKind)
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      const response = await fetcher(`${apiBaseUrl}/public/requests${suffix}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicBuyerRequestList>(response)
    },

    /**
     * Телефон автора запроса — намеренно отдельный вызов по клику, не в
     * общем списке (owner decision 14.09.2026), rate-limited по IP.
     */
    async revealBuyerRequestPhone(id: string, options?: RequestOptions): Promise<{ phone: string }> {
      const response = await fetcher(`${apiBaseUrl}/public/requests/${encodeURIComponent(id)}/reveal-phone`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<{ phone: string }>(response)
    },

    /** Только одобренные модератором отзывы — pending/rejected сюда не попадают. */
    async listApprovedRealtorReviews(positionId: string, options?: RequestOptions): Promise<PublicRealtorReview[]> {
      const response = await fetcher(`${apiBaseUrl}/public/realtors/${encodeURIComponent(positionId)}/reviews`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicRealtorReview[]>(response)
    },

    /** N-13: публичный каталог риэлторов — без аутентификации, без телефона (см. revealRealtorPhone). */
    async listPublicRealtors(query: PublicRealtorQuery = {}, options?: RequestOptions): Promise<PublicRealtorList> {
      const params = new URLSearchParams()
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.city?.trim()) params.set('city', query.city.trim())
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      const response = await fetcher(`${apiBaseUrl}/public/realtors${suffix}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicRealtorList>(response)
    },

    async getPublicRealtor(positionId: string, options?: RequestOptions): Promise<PublicRealtorProfile> {
      const response = await fetcher(`${apiBaseUrl}/public/realtors/${encodeURIComponent(positionId)}`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<PublicRealtorProfile>(response)
    },

    /** Телефон риэлтора — отдельный вызов по клику (owner decision 14.09.2026), rate-limited по IP. */
    async revealRealtorPhone(positionId: string, options?: RequestOptions): Promise<{ phone: string }> {
      const response = await fetcher(`${apiBaseUrl}/public/realtors/${encodeURIComponent(positionId)}/reveal-phone`, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })
      return parseResponse<{ phone: string }>(response)
    },
  }
}

export const marketplaceApi = createMarketplaceApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
})
