import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Клиент ленты новостей (apps/api/src/modules/news).
 *
 * - GET    /api/v1/news          — новости платформы и своей компании, canPublish, channels
 * - POST   /api/v1/news          — новость компании (заголовок Idempotency-Key), с рассылкой по желанию
 * - PUT    /api/v1/news/:newsId  — правка с expectedVersion (409 — новость изменили)
 * - DELETE /api/v1/news/:newsId  — удалить новость своей компании
 *
 * Новости платформы публикует админка, из ERP они только читаются.
 */

export type NewsCategory = 'company' | 'market' | 'developer' | 'regulation'
export type NewsSource = 'platform' | 'organization'

export interface DeliveryCounts {
  pending: number
  sent: number
  failed: number
  skipped: number
}

export interface NewsDeliveryStats {
  email: DeliveryCounts
  telegram: DeliveryCounts
}

/** Какие каналы рассылки настроены на сервере. */
export interface NewsChannels {
  email: boolean
  telegram: boolean
}

export interface NewsArticle {
  id: string
  source: NewsSource
  title: string
  body: string
  category: NewsCategory
  pinned: boolean
  linkUrl: string | null
  linkLabel: string | null
  imageAssetId: string | null
  /** Публичная ссылка на картинку, если она есть. */
  imageUrl: string | null
  /** Имя сотрудника, опубликовавшего новость компании; у новости платформы null. */
  authorName: string | null
  publishedAt: string
  editedAt: string | null
  version: number
  /** Сводка рассылки — только тем, кто новость публикует. */
  delivery: NewsDeliveryStats | null
}

export interface NewsFeed {
  items: NewsArticle[]
  canPublish: boolean
  channels: NewsChannels
}

export interface NewsContentPayload {
  title: string
  body: string
  category: NewsCategory
  pinned?: boolean
  linkUrl?: string
  linkLabel?: string
  imageAssetId?: string
}

export interface CreateNewsPayload extends NewsContentPayload {
  sendEmail?: boolean
  sendTelegram?: boolean
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function idempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID()
  return `news-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const newsApiV2 = {
  async list(): Promise<NewsFeed> {
    const { data } = await api.get<NewsFeed>('/api/v1/news')
    return data
  },

  async create(payload: CreateNewsPayload): Promise<NewsArticle> {
    const { data } = await api.post<NewsArticle>('/api/v1/news', payload, {
      headers: { 'Idempotency-Key': idempotencyKey() },
    })
    return data
  },

  async update(newsId: string, payload: NewsContentPayload, expectedVersion: number): Promise<NewsArticle> {
    const { data } = await api.put<NewsArticle>(`/api/v1/news/${newsId}`, { ...payload, expectedVersion })
    return data
  },

  async remove(newsId: string): Promise<void> {
    await api.delete(`/api/v1/news/${newsId}`)
  },
}
