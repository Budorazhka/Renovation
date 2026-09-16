import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * N-21: клиент к apps/api/src/modules/developments (commission-rules
 * роуты, добавлены рядом с installment-plans) — тот же паттерн, что
 * developmentsApiV2.ts (свой axios-инстанс, PLATFORM_API_BASE_URL,
 * withCredentials, не {success,data} обёртка).
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export interface CommissionRuleV2 {
  _id: string
  organizationId: string
  developmentId: string
  partnerType: string
  commissionPercent: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateCommissionRulePayload {
  partnerType: string
  commissionPercent: number
}

export interface UpdateCommissionRulePayload {
  expectedVersion: number
  partnerType?: string
  commissionPercent?: number
}

/** Ключ идемпотентности на попытку — тот же принцип, что у остальных *ApiV2 клиентов: живёт до успеха попытки. */
const attemptKeys = new Map<string, string>()

function attemptKey(scope: string): string {
  let key = attemptKeys.get(scope)
  if (!key) {
    key = uid()
    attemptKeys.set(scope, key)
  }
  return key
}

function clearAttemptKey(scope: string) {
  attemptKeys.delete(scope)
}

export const commissionRulesApiV2 = {
  /** GET /api/v1/developments/:developmentId/commission-rules */
  async list(developmentId: string): Promise<CommissionRuleV2[]> {
    const { data } = await api.get<CommissionRuleV2[]>(`/api/v1/developments/${developmentId}/commission-rules`)
    return data
  },

  /** POST /api/v1/developments/:developmentId/commission-rules */
  async create(developmentId: string, payload: CreateCommissionRulePayload): Promise<CommissionRuleV2> {
    const scope = `create:${developmentId}`
    const idempotencyKey = attemptKey(scope)
    const { data } = await api.post<CommissionRuleV2>(
      `/api/v1/developments/${developmentId}/commission-rules`,
      payload,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    clearAttemptKey(scope)
    return data
  },

  /** PATCH /api/v1/developments/:developmentId/commission-rules/:id */
  async update(developmentId: string, id: string, payload: UpdateCommissionRulePayload): Promise<CommissionRuleV2> {
    const scope = `update:${id}:${payload.expectedVersion}`
    const idempotencyKey = attemptKey(scope)
    const { data } = await api.patch<CommissionRuleV2>(
      `/api/v1/developments/${developmentId}/commission-rules/${id}`,
      payload,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    clearAttemptKey(scope)
    return data
  },

  /** DELETE /api/v1/developments/:developmentId/commission-rules/:id */
  async remove(developmentId: string, id: string, expectedVersion: number): Promise<void> {
    const scope = `delete:${id}:${expectedVersion}`
    const idempotencyKey = attemptKey(scope)
    await api.delete(`/api/v1/developments/${developmentId}/commission-rules/${id}`, {
      params: { expectedVersion },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    clearAttemptKey(scope)
  },
}
