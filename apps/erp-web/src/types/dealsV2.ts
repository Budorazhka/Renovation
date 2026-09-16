/**
 * Типы для нового API сделок BAZA (apps/api/src/modules/crm/deal.controller.ts,
 * CrmDealReadModel в crm.service.ts). Зеркалит backend-контракт 1:1 — НЕ
 * легаси-форму `Deal` (types/deals.ts), для перевода в неё см.
 * lib/deal-v2-legacy-adapter.ts.
 */

/** Источник истины — apps/api/src/modules/crm/deal-stage.ts::DEAL_STAGES. */
export const DEAL_STAGES_V2 = [
  'showing',
  'deposit',
  'deal',
  'golden',
  'check_in',
  'referral',
  'closed_lost',
] as const

export type DealStageV2 = (typeof DEAL_STAGES_V2)[number]

/** apps/api/packages/contracts/src/money.ts::MoneyAmount. */
export type CurrencyV2 = 'USD' | 'GEL' | 'RUB'

export interface MoneyAmountV2 {
  amountMinorUnits: number
  currency: CurrencyV2
}

export interface DealContactV2 {
  id: string
  name: string
  phone: string
  email?: string
}

export interface DealParticipantV2 {
  /**
   * Свободная строка (см. AddDealParticipantDto.role на бэкенде — IsString,
   * без enum) — НЕ совпадает по типу с легаси `DealParticipant.role`
   * (фиксированный union 'agent'|'lawyer'|'rop'|'buyer'|'seller').
   */
  role: string
  contactId: string
  contact?: DealContactV2 | null
}

export interface DealChecklistItemV2 {
  id: string
  label: string
  done: boolean
  completedAt: string | null
  completedByPositionId: string | null
}

export interface DealV2 {
  id: string
  organizationId: string
  leadId: string | null
  contactId: string
  ownerPositionId: string
  title: string
  description: string | null
  stage: DealStageV2
  expectedCommission: MoneyAmountV2 | null
  /** Фактическая комиссия, которую отметил менеджер BAZA в админке; до отметки null. */
  commissionReceived: MoneyAmountV2 | null
  commissionReceivedAt: string | null
  participants: DealParticipantV2[]
  checklistItems: DealChecklistItemV2[]
  /** Optimistic concurrency — обязателен как expectedVersion в PATCH .../stage, .../reassign, .../checklist, .../participants и PATCH /:id. */
  version: number
  createdAt: string
  updatedAt: string
  contact?: DealContactV2 | null
}

export interface ListDealsV2Params {
  stage?: DealStageV2
  ownerPositionId?: string
  leadId?: string
  contactId?: string
  cursor?: string
  limit?: number
}

export interface ListDealsV2Response {
  items: DealV2[]
  nextCursor: string | null
}

export interface CreateDealParticipantV2Payload {
  role: string
  contactId: string
}

export interface CreateDealChecklistItemV2Payload {
  id?: string
  label: string
  done?: boolean
}

/** POST /api/v1/deals body — см. CreateDealDto. */
export interface CreateDealV2Payload {
  contactId: string
  ownerPositionId?: string
  leadId?: string
  title: string
  description?: string
  stage?: DealStageV2
  expectedCommission?: MoneyAmountV2
  participants?: CreateDealParticipantV2Payload[]
  checklistItems?: CreateDealChecklistItemV2Payload[]
}

/**
 * PATCH /api/v1/deals/:id body — см. UpdateDealDto. НЕ содержит
 * ownerPositionId (смена владельца — отдельный эндпоинт .../reassign).
 */
export interface UpdateDealV2Payload {
  expectedVersion: number
  title?: string
  description?: string | null
  expectedCommission?: MoneyAmountV2 | null
}

export interface ChecklistItemInputV2 {
  id?: string
  label: string
  done: boolean
}
