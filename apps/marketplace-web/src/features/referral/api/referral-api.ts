import { resolveApiBaseUrl } from '../../publishing/api/api-base'

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

/**
 * Реферальная сеть BAZA в личном кабинете (решения владельца 16.09.2026):
 * куратор видит ссылку, команду и деньги; участник — своего куратора;
 * вступление по ссылке, уход и смена куратора — заявкой в BAZA.
 */

export type Currency = 'USD' | 'GEL' | 'RUB'

export interface MoneyAmount {
  amountMinorUnits: number
  currency: Currency
}

export interface ReferralPerson {
  identityId: string
  name: string
  organizationName: string | null
  organizationType: string | null
}

export type TeamSizeStatus = 'recruiting' | 'healthy' | 'time_to_split'
export type MembershipStatus = 'active' | 'on_review'

export interface TeamMember {
  person: ReferralPerson
  joinedAt: string
  joinedVia: 'invite_link' | 'admin'
  status: MembershipStatus
}

export interface CuratorNode {
  person: ReferralPerson
  appointedAt: string
  teamSize: number
  teamStatus: TeamSizeStatus
  members: TeamMember[]
}

export interface MoneyTotals {
  earned: MoneyAmount[]
  paid: MoneyAmount[]
  due: MoneyAmount[]
}

export interface Accrual {
  id: string
  curator: ReferralPerson
  member: ReferralPerson
  dealId: string
  commission: MoneyAmount
  ratePercent: number
  amount: MoneyAmount
  status: 'accrued' | 'paid' | 'reversed'
  accruedAt: string
  paidAt: string | null
  reversedAt: string | null
}

export type ReferralRequestType = 'become_curator' | 'leave_team' | 'change_curator'

export interface ReferralRequest {
  id: string
  type: ReferralRequestType
  applicant: ReferralPerson
  targetCurator: ReferralPerson | null
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  decisionComment: string | null
  createdAt: string
  decidedAt: string | null
}

export interface MyReferralNetwork {
  rules: { ratePercent: number; teamSizeMin: number; teamSizeIdealMax: number }
  role: 'curator' | 'member' | 'none'
  curator: { inviteCode: string; node: CuratorNode; totals: MoneyTotals; accruals: Accrual[] } | null
  membership: { curator: ReferralPerson; joinedAt: string; status: MembershipStatus; accruals: Accrual[] } | null
  requests: ReferralRequest[]
}

/** code — стабильный код ошибки сервера: по нему экран объясняет отказ, а не по тексту. */
export class ReferralApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ReferralApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  if (!response.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = response.statusText
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // Тело не JSON — остаёмся со статусом.
    }
    throw new ReferralApiError(message, response.status, code)
  }
  return response.json() as Promise<T>
}

export const referralApi = {
  async getMine(): Promise<MyReferralNetwork> {
    return request('/marketplace/referral/me')
  },

  async join(code: string): Promise<MyReferralNetwork> {
    return request('/marketplace/referral/join', { method: 'POST', body: JSON.stringify({ code }) })
  },

  async createRequest(params: { type: ReferralRequestType; reason: string; targetInviteCode?: string }): Promise<ReferralRequest> {
    return request('/marketplace/referral/requests', { method: 'POST', body: JSON.stringify(params) })
  },

  /** До регистрации: кто зовёт по ссылке. Без cookie — публичный маршрут. */
  async previewInvite(code: string): Promise<{ curatorName: string }> {
    return request(`/public/referral-invites/${encodeURIComponent(code.trim())}`)
  },
}

/** Ссылка-приглашение куратора на текущем домене витрины. */
export function inviteUrl(code: string, origin = window.location.origin): string {
  return `${origin}/join/${encodeURIComponent(code)}`
}
