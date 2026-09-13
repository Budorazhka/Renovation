import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type {
  BuyerRequestResponseView,
  ListBuyerRequestResponsesResponse,
  ListBuyerRequestsParams,
  ListBuyerRequestsResponse,
} from '@/types/buyerRequests'

export * from '@/types/buyerRequests'

/**
 * N-13: ERP-сторона доски запросов покупателей (apps/api/src/modules/
 * buyer-requests). Организация читает ту же публичную доску, что видят
 * покупатели (`GET /public/requests` — без авторизации, отдельного
 * "получить один запрос по id" эндпоинта нет намеренно, см. докстринг
 * erp-buyer-requests.controller.ts) и откликается через
 * `POST /buyer-requests/:id/respond` (upsert по организации — повторная
 * отправка правит текст отклика, не плодит второй).
 *
 * Авторизация только через cookie (withCredentials: true). Tenant
 * (organizationId/respondedByPositionId) читается бэкендом из сессии —
 * клиент их не передаёт (тот же принцип, что leadsApiV2/communityApi).
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

/** Предел одной страницы для листинга своих откликов. */
const RESPONSES_PER_REQUEST = 50
/** Тот же предел страниц, что leadsApiV2.listAll — см. её докстринг. */
const MAX_RESPONSE_PAGES = 20

export const buyerRequestsApi = {
  /** GET /api/v1/public/requests?dealType=&city=&propertyKind=&cursor= — публично, без cookie. */
  async listPublic(params?: ListBuyerRequestsParams): Promise<ListBuyerRequestsResponse> {
    const { data } = await api.get<ListBuyerRequestsResponse>('/api/v1/public/requests', { params })
    return data
  },

  /** GET /api/v1/public/requests/:id/reveal-phone — по клику, rate-limited по IP на сервере. */
  async revealPhone(id: string): Promise<{ phone: string }> {
    const { data } = await api.get<{ phone: string }>(`/api/v1/public/requests/${id}/reveal-phone`)
    return data
  },

  /**
   * POST /api/v1/buyer-requests/:id/respond. Upsert — повторный вызов с новым
   * текстом обновляет уже существующий отклик организации, не создаёт второй.
   */
  async respond(id: string, message: string): Promise<BuyerRequestResponseView> {
    const { data } = await api.post<BuyerRequestResponseView>(`/api/v1/buyer-requests/${id}/respond`, { message })
    return data
  },

  /** GET /api/v1/buyer-requests/responses — только свои отклики организации. */
  async listMyResponses(params?: { cursor?: string; limit?: number }): Promise<ListBuyerRequestResponsesResponse> {
    const { data } = await api.get<ListBuyerRequestResponsesResponse>('/api/v1/buyer-requests/responses', { params })
    return data
  },

  /**
   * Все свои отклики, не первая страница — нужны целиком, чтобы отметить на
   * доске запросы, на которые организация уже ответила (клиентский join,
   * бэкенд его не делает). Тот же паттерн, что leadsApiV2.listAll.
   * `complete: false` — упёрлись в предел страниц; вызывающий код должен
   * это увидеть, а не молчать.
   */
  async listAllMyResponses(maxPages = MAX_RESPONSE_PAGES): Promise<{ items: BuyerRequestResponseView[]; complete: boolean }> {
    const items: BuyerRequestResponseView[] = []
    let cursor: string | undefined
    let complete = false

    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.listMyResponses({ limit: RESPONSES_PER_REQUEST, cursor })
      items.push(...response.items)
      if (!response.nextCursor) {
        complete = true
        break
      }
      cursor = response.nextCursor
    }

    return { items, complete }
  },
}
