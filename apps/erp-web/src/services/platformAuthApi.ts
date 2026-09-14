import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type { ServerPermission } from '@/types/auth'

export interface PlatformLoginResponse {
  identityId: string
  requires2fa: boolean
}

/** Один активный PermissionGrant позиции. Зеркало ErpMePermissionView на бэке. */
export type PlatformPermission = ServerPermission

/**
 * Ответ GET /api/v1/me. Зеркало ErpMeResponseDto
 * (apps/api/src/modules/organizations/dto/erp-me-response.dto.ts).
 */
export interface PlatformMeResponse {
  identity: { id: string; login: string; status: string }
  organization: { id: string; name: string; type: string; status: string }
  position: {
    id: string
    role: string
    displayName: string
    parentPositionId: string | null
    avatarUrl?: string
  }
  permissions: PlatformPermission[]
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

/**
 * Минимальная граница ERP → нового Platform API для host-only cookie-сессии.
 * Не использует legacy CRM URL и не читает/не сохраняет session token в JS.
 */
export const platformAuthApi = {
  async login(params: { login: string; password: string }): Promise<PlatformLoginResponse> {
    const { data } = await api.post<PlatformLoginResponse>('/api/v1/auth/login', params)
    return data
  },

  /**
   * Шаг 1 онбординга (AuthController.register) — создаёт голую Identity, БЕЗ
   * сессии (cookie не ставится). Шаг 2 — organizationsAuthApi.register.
   */
  async register(params: { login: string; password: string }): Promise<{ identityId: string }> {
    const { data } = await api.post<{ identityId: string }>('/api/v1/auth/register', params)
    return data
  },

  async logout(): Promise<{ loggedOut: true }> {
    const { data } = await api.post<{ loggedOut: true }>('/api/v1/auth/logout')
    return data
  },

  /**
   * Контекст текущей сессии: организация, позиция и её активные права.
   *
   * Единственный источник правды по scope: сервер выводит организацию и
   * позицию из cookie-сессии (TenantContext), клиент их не передаёт и не может
   * подменить. До появления этого вызова ERP собирал контекст из трёх
   * эндпоинтов (team-users/ensure-self, team-users/ensure-team,
   * developers/ensure-self), и при отсутствии ответа подставлял companyId 'c1'
   * — идентификатор мок-компании — реальному залогиненному пользователю.
   *
   * Бросает при 401/403: отсутствие сессии здесь не «пустой профиль», а
   * отсутствие входа, и вызывающий код должен различать эти случаи.
   */
  async me(): Promise<PlatformMeResponse> {
    const { data } = await api.get<PlatformMeResponse>('/api/v1/me')
    return data
  },
}
