import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Клиент к трём эндпоинтам PersonalAccess (organizations.controller.ts):
 * список/выдача/отзыв PermissionGrant конкретной позиции. Тот же паттерн,
 * что commissionRulesApiV2.ts — свой axios-инстанс, PLATFORM_API_BASE_URL,
 * withCredentials, без {success,data}-обёртки (кроме list, у которого
 * ответ — {items: [...]}).
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

export type PermissionScope =
  | 'own'
  | 'position'
  | 'team'
  | 'organization'
  | 'project'
  | 'city'
  | 'global'
  | 'assigned'
  | 'domain'

export interface PositionGrant {
  id: string
  resource: string
  action: string
  scope: PermissionScope
  scopeValue?: string
  version: number
  /** Заполнено — грант отозван, не действует. */
  revokedAt?: string
  revokeReason?: string
}

export interface GrantPositionPermissionPayload {
  resource: string
  action: string
  scope: PermissionScope
  scopeValue?: string
}

export interface RevokePositionGrantPayload {
  expectedVersion: number
  reason: string
}

export const positionGrantsApi = {
  /** GET /organizations/:organizationId/positions/:positionId/grants — включая уже отозванные. */
  async list(organizationId: string, positionId: string): Promise<PositionGrant[]> {
    const { data } = await api.get<{ items: PositionGrant[] }>(
      `/api/v1/organizations/${organizationId}/positions/${positionId}/grants`,
    )
    return data.items
  },

  /** POST .../grants — создаёт новый grant поверх дефолтного набора роли позиции. */
  async grant(organizationId: string, positionId: string, payload: GrantPositionPermissionPayload): Promise<void> {
    await api.post(`/api/v1/organizations/${organizationId}/positions/${positionId}/grants`, payload)
  },

  /** POST .../grants/:grantId/revoke — CAS по expectedVersion, reason обязателен. */
  async revoke(
    organizationId: string,
    positionId: string,
    grantId: string,
    payload: RevokePositionGrantPayload,
  ): Promise<void> {
    await api.post(
      `/api/v1/organizations/${organizationId}/positions/${positionId}/grants/${grantId}/revoke`,
      payload,
    )
  },
}
