import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type { DevSelectionCustomization } from '@/config/dev-selection-customization'
import type { DevSelection, DevSelectionItem, DevSelectionReaction, DevSelectionStatus } from '@/types/dev-selection'

/**
 * `version` — optimistic concurrency (expectedVersion), нужен стору для CAS-
 * запросов, но НЕ часть зафиксированной доменной модели `DevSelection`
 * (types/dev-selection.ts) — расширение только для внутреннего использования
 * стором/этим клиентом, наружу (компонентам) версия не документируется как
 * публичное поле.
 */
export type DevSelectionRecord = DevSelection & { version: number }

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

interface ApiSelectionItem {
  targetType: 'unit' | 'listing'
  unitId?: string
  listingId?: string
  agentNote?: string
  reaction?: DevSelectionReaction
  viewedAt?: string
}

interface ApiSelectionResponse {
  id: string
  publicToken: string
  title: string
  leadId?: string
  clientName?: string
  clientPhone?: string
  agentNote?: string
  status: DevSelectionStatus
  items: ApiSelectionItem[]
  createdAt: string
  sentAt?: string
  lastOpenedAt?: string
  viewCount: number
  customization?: DevSelectionCustomization
  version: number
}

function mapApiSelectionToFrontend(raw: ApiSelectionResponse): DevSelectionRecord {
  return {
    id: raw.id,
    publicToken: raw.publicToken,
    title: raw.title,
    leadId: raw.leadId,
    clientName: raw.clientName,
    clientPhone: raw.clientPhone,
    agentNote: raw.agentNote,
    status: raw.status,
    items: raw.items.map((item): DevSelectionItem => ({
      targetType: item.targetType,
      unitId: item.unitId,
      listingId: item.listingId,
      agentNote: item.agentNote,
      reaction: item.reaction,
      viewedAt: item.viewedAt,
    })),
    createdAt: raw.createdAt,
    sentAt: raw.sentAt,
    lastOpenedAt: raw.lastOpenedAt,
    viewCount: raw.viewCount,
    customization: raw.customization,
    version: raw.version,
  }
}

/** Трекинг ключей идемпотентности на операцию — тот же паттерн, что installmentPlansApiV2. */
const mutationAttemptKeys = new Map<string, string>()

function attemptKey(operationId: string): string {
  let key = mutationAttemptKeys.get(operationId)
  if (!key) {
    key = uid()
    mutationAttemptKeys.set(operationId, key)
  }
  return key
}

function clearAttemptKey(operationId: string) {
  mutationAttemptKeys.delete(operationId)
}

export interface CreateSelectionPayload {
  title: string
  /** Хотя бы один из unitIds/listingIds должен быть непустым (валидируется сервером). */
  unitIds?: string[]
  listingIds?: string[]
  leadId?: string
  clientName?: string
  clientPhone?: string
  agentNote?: string
  customization?: DevSelectionCustomization
}

export interface UpdateSelectionPayload {
  title?: string
  leadId?: string
  clientName?: string
  clientPhone?: string
  agentNote?: string
  customization?: DevSelectionCustomization
}

/** Приватный (organization-scoped, аутентифицированный) API-клиент подборок для клиента. */
export const devSelectionsApiV2 = {
  /** GET /api/v1/selections */
  async list(status?: DevSelectionStatus): Promise<DevSelectionRecord[]> {
    const { data } = await api.get<{ items: ApiSelectionResponse[] }>('/api/v1/selections', {
      params: status ? { status } : undefined,
    })
    return (data.items ?? []).map(mapApiSelectionToFrontend)
  },

  /** GET /api/v1/selections/:id */
  async get(id: string): Promise<DevSelectionRecord> {
    const { data } = await api.get<ApiSelectionResponse>(`/api/v1/selections/${id}`)
    return mapApiSelectionToFrontend(data)
  },

  /** POST /api/v1/selections */
  async create(payload: CreateSelectionPayload, customKey?: string): Promise<DevSelectionRecord> {
    const opKey = `create:${payload.title}:${(payload.unitIds ?? []).join(',')}:${(payload.listingIds ?? []).join(',')}`
    const idempotencyKey = customKey || attemptKey(opKey)
    const { data } = await api.post<ApiSelectionResponse>('/api/v1/selections', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    clearAttemptKey(opKey)
    return mapApiSelectionToFrontend(data)
  },

  /** PATCH /api/v1/selections/:id */
  async update(
    id: string,
    patch: UpdateSelectionPayload,
    expectedVersion: number,
    customKey?: string,
  ): Promise<DevSelectionRecord> {
    const opKey = `update:${id}:${expectedVersion}`
    const idempotencyKey = customKey || attemptKey(opKey)
    const { data } = await api.patch<ApiSelectionResponse>(
      `/api/v1/selections/${id}`,
      { ...patch, expectedVersion },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    clearAttemptKey(opKey)
    return mapApiSelectionToFrontend(data)
  },

  /** PATCH /api/v1/selections/:id/status */
  async setStatus(
    id: string,
    status: DevSelectionStatus,
    expectedVersion: number,
    customKey?: string,
  ): Promise<DevSelectionRecord> {
    const opKey = `status:${id}:${expectedVersion}:${status}`
    const idempotencyKey = customKey || attemptKey(opKey)
    const { data } = await api.patch<ApiSelectionResponse>(
      `/api/v1/selections/${id}/status`,
      { status, expectedVersion },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    clearAttemptKey(opKey)
    return mapApiSelectionToFrontend(data)
  },

  /** DELETE /api/v1/selections/:id */
  async remove(id: string, expectedVersion: number, customKey?: string): Promise<void> {
    const opKey = `delete:${id}`
    const idempotencyKey = customKey || attemptKey(opKey)
    await api.delete(`/api/v1/selections/${id}`, {
      params: { expectedVersion },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    clearAttemptKey(opKey)
  },

  /** POST /api/v1/selections/:id/items */
  async addItems(
    id: string,
    items: { unitIds?: string[]; listingIds?: string[] },
    expectedVersion: number,
    customKey?: string,
  ): Promise<DevSelectionRecord> {
    const unitIds = items.unitIds ?? []
    const listingIds = items.listingIds ?? []
    const opKey = `add-items:${id}:${expectedVersion}:${unitIds.join(',')}:${listingIds.join(',')}`
    const idempotencyKey = customKey || attemptKey(opKey)
    const { data } = await api.post<ApiSelectionResponse>(
      `/api/v1/selections/${id}/items`,
      { unitIds, listingIds, expectedVersion },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    clearAttemptKey(opKey)
    return mapApiSelectionToFrontend(data)
  },

  /** DELETE /api/v1/selections/:id/items/:itemId */
  async removeItem(
    id: string,
    itemId: string,
    expectedVersion: number,
    customKey?: string,
  ): Promise<DevSelectionRecord> {
    const opKey = `remove-item:${id}:${itemId}`
    const idempotencyKey = customKey || attemptKey(opKey)
    const { data } = await api.delete<ApiSelectionResponse>(`/api/v1/selections/${id}/items/${itemId}`, {
      params: { expectedVersion },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    clearAttemptKey(opKey)
    return mapApiSelectionToFrontend(data)
  },

  /** PATCH /api/v1/selections/:id/items/:itemId */
  async updateItem(
    id: string,
    itemId: string,
    patch: { agentNote?: string; reaction?: DevSelectionReaction | null },
    expectedVersion: number,
    customKey?: string,
  ): Promise<DevSelectionRecord> {
    const opKey = `update-item:${id}:${itemId}:${expectedVersion}`
    const idempotencyKey = customKey || attemptKey(opKey)
    const { data } = await api.patch<ApiSelectionResponse>(
      `/api/v1/selections/${id}/items/${itemId}`,
      { ...patch, expectedVersion },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    clearAttemptKey(opKey)
    return mapApiSelectionToFrontend(data)
  },
}
