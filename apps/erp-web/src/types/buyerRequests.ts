export type BuyerRequestDealType = 'buy' | 'rent'
export type BuyerRequestStatus = 'published' | 'closed' | 'moderated'

export interface BuyerRequestBudget {
  amount: number
  currency: string
  perMonth: boolean
}

/** GET /api/v1/public/requests — публичная доска, без авторизации. */
export interface BuyerRequestView {
  id: string
  dealType: BuyerRequestDealType
  city: string
  propertyKind: string
  title: string
  comment: string
  budget: BuyerRequestBudget
  status: BuyerRequestStatus
  createdAt: string
}

export interface ListBuyerRequestsResponse {
  items: BuyerRequestView[]
  nextCursor: string | null
}

export interface ListBuyerRequestsParams {
  dealType?: BuyerRequestDealType
  city?: string
  propertyKind?: string
  cursor?: string
}

/**
 * POST /api/v1/buyer-requests/:id/respond и GET /api/v1/buyer-requests/responses.
 * Не содержит title/city/budget исходного запроса — на бэкенде нет join'а
 * (см. erp-buyer-requests.controller.ts); сопоставление с BuyerRequestView
 * делает фронтенд по buyerRequestId против уже загруженной публичной доски.
 */
export interface BuyerRequestResponseView {
  id: string
  buyerRequestId: string
  message: string
  updatedAt: string
}

export interface ListBuyerRequestResponsesResponse {
  items: BuyerRequestResponseView[]
  nextCursor: string | null
}
