import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

export type OrganizationType = 'agency' | 'developer' | 'independent_realtor'

export interface RegisterOrganizationResponse {
  organizationId: string
  positionId: string
  identityId: string
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

/**
 * Шаг 2 онбординга (organization-onboarding.controller.ts) — после
 * platformAuthApi.register (создаёт голую Identity). Повторно принимает
 * login/password: сессии после шага 1 ещё нет (её и создаёт этот вызов),
 * пароль здесь подтверждает владение только что созданной Identity, не
 * создаёт вторую. Создаёт организацию + owner-позицию и ставит ту же
 * httpOnly session cookie, что POST /auth/login — отдельный вызов логина
 * после регистрации не нужен.
 */
export const organizationsAuthApi = {
  async register(params: {
    login: string
    password: string
    type: OrganizationType
    name: string
    /** Как зовут владельца — без него в должности заглушка «Owner». */
    ownerName?: string
  }): Promise<RegisterOrganizationResponse> {
    const { data } = await api.post<RegisterOrganizationResponse>('/api/v1/organizations/register', params)
    return data
  },
}
