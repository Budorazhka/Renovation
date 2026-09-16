import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Фиксация клиента у застройщика
 * (apps/api/src/modules/client-registrations/client-registrations.controller.ts).
 *
 * Две стороны одной записи: агентство ведёт свой реестр, застройщик отвечает
 * на входящие. Сторону сервер выводит из сессии — клиент её не передаёт.
 */

export type ClientRegistrationStatus = 'pending' | 'active' | 'rejected' | 'completed' | 'cancelled'

export interface ClientRegistration {
  id: string
  developmentId: string | null
  developerName: string
  projectName: string
  unitLabel: string | null
  clientName: string
  clientPhone: string
  leadId: string | null
  agentPositionId: string
  status: ClientRegistrationStatus
  /** Срок закрепления истёк. Сервер считает это на чтении, клиент не пересчитывает. */
  isExpired: boolean
  /** Ждёт ответа застройщика на платформе; у внешнего застройщика false. */
  awaitsDeveloper: boolean
  reservedUntil: string | null
  decidedAt: string | null
  decisionNote: string | null
  notes: string | null
  createdAt: string
  version: number
}

export interface IncomingClientRegistration extends ClientRegistration {
  agencyOrganizationId: string
}

export interface CreateClientRegistrationPayload {
  /** ЖК на платформе. Застройщика и название проекта сервер берёт из комплекса сам. */
  developmentId?: string
  developerName?: string
  projectName?: string
  unitLabel?: string
  clientName: string
  clientPhone: string
  leadId?: string
  notes?: string
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

export function newIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  return `reg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const clientRegistrationsApi = {
  /** Реестр своей организации. */
  async list(status?: ClientRegistrationStatus): Promise<ClientRegistration[]> {
    const { data } = await api.get<{ items: ClientRegistration[] }>('/api/v1/client-registrations', {
      params: status ? { status } : undefined,
    })
    return data.items
  },

  /** Входящие заявки застройщика — по его ЖК. */
  async listIncoming(status?: ClientRegistrationStatus): Promise<IncomingClientRegistration[]> {
    const { data } = await api.get<{ items: IncomingClientRegistration[] }>(
      '/api/v1/client-registrations/incoming',
      { params: status ? { status } : undefined },
    )
    return data.items
  },

  /** Ключ идемпотентности обязателен: без него сервер отвечает 400. */
  async create(payload: CreateClientRegistrationPayload, idempotencyKey: string): Promise<ClientRegistration> {
    const { data } = await api.post<ClientRegistration>('/api/v1/client-registrations', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return data
  },

  async update(
    registrationId: string,
    expectedVersion: number,
    patch: { unitLabel?: string; notes?: string },
  ): Promise<ClientRegistration> {
    const { data } = await api.patch<ClientRegistration>(`/api/v1/client-registrations/${registrationId}`, {
      expectedVersion,
      ...patch,
    })
    return data
  },

  /** Решение застройщика: подтвердить. */
  async accept(registrationId: string, expectedVersion: number): Promise<ClientRegistration> {
    const { data } = await api.post<ClientRegistration>(
      `/api/v1/client-registrations/${registrationId}/accept`,
      { expectedVersion },
    )
    return data
  },

  /** Решение застройщика: отклонить с причиной. */
  async reject(registrationId: string, expectedVersion: number, reason: string): Promise<ClientRegistration> {
    const { data } = await api.post<ClientRegistration>(
      `/api/v1/client-registrations/${registrationId}/reject`,
      { expectedVersion, reason },
    )
    return data
  },

  /** Ручное подтверждение по застройщику вне платформы. */
  async confirmExternal(registrationId: string, expectedVersion: number): Promise<ClientRegistration> {
    const { data } = await api.post<ClientRegistration>(
      `/api/v1/client-registrations/${registrationId}/confirm-external`,
      { expectedVersion },
    )
    return data
  },

  async complete(registrationId: string, expectedVersion: number): Promise<ClientRegistration> {
    const { data } = await api.post<ClientRegistration>(
      `/api/v1/client-registrations/${registrationId}/complete`,
      { expectedVersion },
    )
    return data
  },

  async cancel(registrationId: string, expectedVersion: number): Promise<ClientRegistration> {
    const { data } = await api.post<ClientRegistration>(
      `/api/v1/client-registrations/${registrationId}/cancel`,
      { expectedVersion },
    )
    return data
  },
}
