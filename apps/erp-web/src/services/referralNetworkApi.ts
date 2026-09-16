import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Реферальная сеть BAZA в ERP (apps/api/src/modules/referral-network).
 * Сотрудник видит свою команду или своего куратора; руководитель агентства —
 * кураторов своей компании и их команды, без денег: начисления — отношения
 * BAZA и куратора.
 */

export interface ReferralPerson {
  identityId: string
  name: string
  organizationName: string | null
  organizationType: string | null
}

export interface MoneyAmount {
  amountMinorUnits: number
  currency: 'USD' | 'GEL' | 'RUB'
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

export interface ReferralRules {
  ratePercent: number
  teamSizeMin: number
  teamSizeIdealMax: number
}

export interface Accrual {
  id: string
  member: ReferralPerson
  dealId: string
  commission: MoneyAmount
  ratePercent: number
  amount: MoneyAmount
  status: 'accrued' | 'paid' | 'reversed'
  accruedAt: string
}

export interface MyReferralNetwork {
  rules: ReferralRules
  role: 'curator' | 'member' | 'none'
  curator: {
    inviteCode: string
    node: CuratorNode
    totals: { earned: MoneyAmount[]; paid: MoneyAmount[]; due: MoneyAmount[] }
    accruals: Accrual[]
  } | null
  membership: { curator: ReferralPerson; joinedAt: string; status: MembershipStatus; accruals: Accrual[] } | null
}

export interface OrganizationReferralNetwork {
  rules: ReferralRules
  curators: CuratorNode[]
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

export const referralNetworkApi = {
  /** Своё место в сети — любому сотруднику. */
  async getMine(): Promise<MyReferralNetwork> {
    const { data } = await api.get<MyReferralNetwork>('/api/v1/referral-network/me')
    return data
  },

  /** Сеть компании — руководителю (referral_network.read); остальным сервер отвечает 403. */
  async getOrganization(): Promise<OrganizationReferralNetwork> {
    const { data } = await api.get<OrganizationReferralNetwork>('/api/v1/referral-network/organization')
    return data
  },
}
