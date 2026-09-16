/**
 * Реферальная сеть BAZA — зеркало ответов API
 * (docs/api/v1-first-vertical-slice.yaml, схемы Referral*, AdminCommission*,
 * CuratorAccrual*). Решения владельца 16.09.2026:
 * docs/plans/2026-09-16-mlm-curator-network.md.
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

export interface AdminReferralPerson extends ReferralPerson {
  login: string
}

export interface MoneyTotals {
  earned: MoneyAmount[]
  paid: MoneyAmount[]
  due: MoneyAmount[]
}

export type TeamSizeStatus = 'recruiting' | 'healthy' | 'time_to_split'
export type MembershipStatus = 'active' | 'on_review'

export interface ReferralTeamMember {
  person: AdminReferralPerson
  joinedAt: string
  joinedVia: 'invite_link' | 'admin'
  status: MembershipStatus
}

export interface AdminCuratorNode {
  person: AdminReferralPerson
  appointedAt: string
  teamSize: number
  teamStatus: TeamSizeStatus
  members: ReferralTeamMember[]
  inviteCode: string
  totals: MoneyTotals
}

export interface ReferralRules {
  ratePercent: number
  teamSizeMin: number
  teamSizeIdealMax: number
}

export interface AdminReferralNetwork {
  rules: ReferralRules
  curators: AdminCuratorNode[]
  summary: { curators: number; members: number; membersOnReview: number; pendingRequests: number }
}

export interface AdminReferralPersonLookup {
  person: AdminReferralPerson
  isCurator: boolean
  membership: { curator: ReferralPerson; status: MembershipStatus | 'ended' } | null
}

export interface MembershipHistoryItem {
  curator: ReferralPerson
  status: MembershipStatus | 'ended'
  joinedAt: string
  joinedVia: 'invite_link' | 'admin'
  endedAt: string | null
  endReason: string | null
  note: string | null
}

export type ReferralRequestType = 'become_curator' | 'leave_team' | 'change_curator'
export type ReferralRequestStatus = 'pending' | 'approved' | 'rejected'

export interface ReferralRequest {
  id: string
  type: ReferralRequestType
  applicant: ReferralPerson
  targetCurator: ReferralPerson | null
  reason: string
  status: ReferralRequestStatus
  decisionComment: string | null
  createdAt: string
  decidedAt: string | null
}

export type AccrualStatus = 'accrued' | 'paid' | 'reversed'

export interface CuratorAccrual {
  id: string
  curator: ReferralPerson
  member: ReferralPerson
  dealId: string
  commission: MoneyAmount
  ratePercent: number
  amount: MoneyAmount
  status: AccrualStatus
  accruedAt: string
  paidAt: string | null
  reversedAt: string | null
}

export interface AdminCommissionDeal {
  id: string
  organizationId: string
  ownerPositionId: string
  title: string
  stage: string
  dealType: string | null
  expectedCommission: MoneyAmount | null
  commissionReceived: MoneyAmount | null
  commissionReceivedAt: string | null
  version: number
  createdAt: string
  organizationName: string | null
  agentName: string | null
  curatorAccrual: CuratorAccrual | null
}

export type AccrualSkipReason =
  | 'not_primary'
  | 'no_occupant'
  | 'not_in_team'
  | 'membership_on_review'
  | 'company_mismatch'
  | 'curator_retired'

export type AccrualOutcome =
  | { accrued: true; accrualId: string; curatorIdentityId: string; amount: MoneyAmount }
  | { accrued: false; reason: AccrualSkipReason }

export interface CuratorPayout {
  curator: AdminReferralPerson
  inviteCode: string | null
  totals: MoneyTotals
}

export interface CuratorAccrualsResult {
  totals: MoneyTotals
  accruals: CuratorAccrual[]
}
