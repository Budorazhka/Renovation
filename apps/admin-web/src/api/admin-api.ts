import type {
  ActivateSubscriptionParams,
  AdminAccountList,
  AdminAuditEventList,
  AdminAuditEventListQuery,
  AdminBillingOverview,
  AdminComplaintList,
  AdminComplaintListQuery,
  AdminDuplicateCandidateList,
  AdminDuplicateCandidateListQuery,
  AdminMe,
  AdminNewsList,
  AdminOrganizationDetail,
  AdminOrganizationList,
  AdminOrganizationListQuery,
  AdminPublicationList,
  AdminPublicationListQuery,
  AdminRealtorReviewList,
  AdminRealtorReviewListQuery,
  ConfirmDuplicateResult,
  CreateNewsParams,
  DeactivateReactivateResult,
  FreezeOrganizationResult,
  ModerateRealtorReviewResult,
  NewsArticle,
  NewsContentParams,
  OrganizationSubscription,
  PermissionGrant,
  PermissionScope,
  ResolveComplaintResult,
  RevokeMlsVerificationResult,
  SubscriptionPlan,
  UnfreezeOrganizationResult,
  UnpublishResult,
  VerifyMlsResult,
} from '../types/admin'
import type {
  AccrualOutcome,
  AdminCommissionDeal,
  AdminReferralNetwork,
  AdminReferralPerson,
  AdminReferralPersonLookup,
  CuratorAccrualsResult,
  CuratorPayout,
  MembershipHistoryItem,
  MoneyAmount,
  ReferralRequest,
  ReferralRequestStatus,
} from '../types/referral'

type Fetcher = typeof fetch

/**
 * error.code — стабильный ErrorCode с сервера (apps/api
 * shared/errors/error-codes.ts), не HTTP-статус-текст — вызывающий код
 * (useAdminAuth, экраны) различает 403 FORBIDDEN (нет активного
 * AdminContext — веди на /login) от 403 ADMIN_SCOPE_INSUFFICIENT/
 * SELF_ESCALATION_BLOCKED (вошёл, но нет прав — показывай отказ, не login).
 */
export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = 'Не удалось выполнить запрос. Попробуйте ещё раз.'
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch {
      // Тело не JSON (например, сеть/прокси-ошибка вне контроля API) —
      // остаёмся с generic-сообщением, не роняем UI на парсинге.
    }
    throw new AdminApiError(message, response.status, code)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function createAdminApi({ baseUrl, fetcher = fetch }: { baseUrl: string; fetcher?: Fetcher }) {
  const apiBaseUrl = normalizedBaseUrl(baseUrl)

  // credentials:'include' на каждый запрос — сессия admin-web живёт в
  // httpOnly `baza_session` cookie, выставленной сервером на /auth/login
  // (ADR-004 host-only cookie). Без этого браузер не отправит cookie на
  // cross-origin запрос к API (dev: разные порты Vite/Nest).
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
    return parseResponse<T>(response)
  }

  return {
    async login(params: { login: string; password: string }): Promise<{ identityId: string; requires2fa: boolean }> {
      return request('/auth/login', { method: 'POST', body: JSON.stringify(params) })
    },

    async logout(): Promise<{ loggedOut: true }> {
      return request('/auth/logout', { method: 'POST' })
    },

    async me(): Promise<AdminMe> {
      return request('/admin/me')
    },

    async listPublications(query: AdminPublicationListQuery = {}): Promise<AdminPublicationList> {
      const params = new URLSearchParams()
      if (query.sourceType) params.set('sourceType', query.sourceType)
      if (query.city?.trim()) params.set('city', query.city.trim())
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/publications${suffix}`)
    },

    async unpublish(publicationId: string, reason: string): Promise<UnpublishResult> {
      return request(`/admin/publications/${encodeURIComponent(publicationId)}/unpublish`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async listComplaints(query: AdminComplaintListQuery = {}): Promise<AdminComplaintList> {
      const params = new URLSearchParams()
      if (query.status) params.set('status', query.status)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/complaints${suffix}`)
    },

    async resolveComplaint(
      complaintId: string,
      params: { decision: 'upheld' | 'dismissed'; reason: string },
    ): Promise<ResolveComplaintResult> {
      return request(`/admin/complaints/${encodeURIComponent(complaintId)}/resolve`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },

    async listDuplicateCandidates(query: AdminDuplicateCandidateListQuery = {}): Promise<AdminDuplicateCandidateList> {
      const params = new URLSearchParams()
      if (query.status) params.set('status', query.status)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/duplicate-candidates${suffix}`)
    },

    async confirmDuplicate(
      duplicateCandidateId: string,
      reason: string,
    ): Promise<ConfirmDuplicateResult> {
      return request(`/admin/duplicate-candidates/${encodeURIComponent(duplicateCandidateId)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async listRealtorReviews(query: AdminRealtorReviewListQuery = {}): Promise<AdminRealtorReviewList> {
      const params = new URLSearchParams()
      if (query.status) params.set('status', query.status)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/realtor-reviews${suffix}`)
    },

    async moderateRealtorReview(
      reviewId: string,
      params: { decision: 'approved' | 'rejected'; reason: string },
    ): Promise<ModerateRealtorReviewResult> {
      return request(`/admin/realtor-reviews/${encodeURIComponent(reviewId)}/moderate`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },

    async listAdminAccounts(params: { cursor?: string; limit?: number } = {}): Promise<AdminAccountList> {
      const search = new URLSearchParams()
      if (params.cursor) search.set('cursor', params.cursor)
      if (params.limit) search.set('limit', String(params.limit))
      const suffix = search.size > 0 ? `?${search.toString()}` : ''
      return request(`/admin/accounts${suffix}`)
    },

    async createAdminAccount(params: { identityId: string; isSuperAdmin: boolean }): Promise<{
      id: string
      identityId: string
      isSuperAdmin: boolean
    }> {
      // Ключ обязателен: повтор без него создал бы второй админ-аккаунт (ADR-006).
      // Генерируется на вызов — форма создания одноразовая, повтор здесь это
      // осознанное новое действие оператора, а не автоматический retry.
      return request('/admin/accounts', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(params),
      })
    },

    async grantPermission(
      adminAccountId: string,
      params: { resource: string; action: string; scope: PermissionScope; scopeValue?: string },
    ): Promise<{ granted: true }> {
      return request(`/admin/accounts/${encodeURIComponent(adminAccountId)}/grants`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },

    async listGrants(adminAccountId: string): Promise<{ items: PermissionGrant[] }> {
      return request(`/admin/accounts/${encodeURIComponent(adminAccountId)}/grants`)
    },

    async deactivateAccount(adminAccountId: string, reason: string): Promise<DeactivateReactivateResult> {
      return request(`/admin/accounts/${encodeURIComponent(adminAccountId)}/deactivate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async reactivateAccount(adminAccountId: string, reason: string): Promise<DeactivateReactivateResult> {
      return request(`/admin/accounts/${encodeURIComponent(adminAccountId)}/reactivate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async revokeGrant(
      adminAccountId: string,
      grantId: string,
      params: { reason: string; expectedVersion: number },
    ): Promise<{ revoked: true }> {
      return request(`/admin/accounts/${encodeURIComponent(adminAccountId)}/grants/${encodeURIComponent(grantId)}/revoke`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
    async listAuditEvents(query: AdminAuditEventListQuery = {}): Promise<AdminAuditEventList> {
      const params = new URLSearchParams()
      if (query.resource) params.set('resource', query.resource)
      if (query.action?.trim()) params.set('action', query.action.trim())
      if (query.resourceId) params.set('resourceId', query.resourceId)
      if (query.publicationId) params.set('publicationId', query.publicationId)
      if (query.actorId) params.set('actorId', query.actorId)
      if (query.from) params.set('from', query.from)
      if (query.to) params.set('to', query.to)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/audit-events${suffix}`)
    },

    async listPublicationAudit(
      publicationId: string,
      query: { action?: string; from?: string; to?: string; cursor?: string; limit?: number } = {},
    ): Promise<AdminAuditEventList> {
      const params = new URLSearchParams()
      if (query.action?.trim()) params.set('action', query.action.trim())
      if (query.from) params.set('from', query.from)
      if (query.to) params.set('to', query.to)
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/publications/${encodeURIComponent(publicationId)}/audit${suffix}`)
    },

    async listOrganizations(query: AdminOrganizationListQuery = {}): Promise<AdminOrganizationList> {
      const params = new URLSearchParams()
      if (query.type) params.set('type', query.type)
      if (query.status) params.set('status', query.status)
      if (query.search?.trim()) params.set('search', query.search.trim())
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request(`/admin/organizations${suffix}`)
    },

    async getOrganization(organizationId: string): Promise<AdminOrganizationDetail> {
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}`)
    },

    async freezeOrganization(organizationId: string, reason: string): Promise<FreezeOrganizationResult> {
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}/freeze`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async unfreezeOrganization(organizationId: string, reason: string): Promise<UnfreezeOrganizationResult> {
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}/unfreeze`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async verifyMls(organizationId: string, reason: string): Promise<VerifyMlsResult> {
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}/verify-mls`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async revokeMlsVerification(organizationId: string, reason: string): Promise<RevokeMlsVerificationResult> {
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}/revoke-mls-verification`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async getOrganizationBilling(organizationId: string): Promise<AdminBillingOverview> {
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}/billing`)
    },

    async activateSubscription(
      organizationId: string,
      params: ActivateSubscriptionParams,
    ): Promise<OrganizationSubscription> {
      // Сервер требует Idempotency-Key (повтор продлил бы подписку дважды) —
      // без заголовка активация отвечала 400 IDEMPOTENCY_KEY_REQUIRED.
      return request(`/admin/organizations/${encodeURIComponent(organizationId)}/billing/activate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(params),
      })
    },

    // ИСПРАВЛЕНО 11.09.2026: раньше OrganizationBillingModal держал список
    // тарифов руками (AVAILABLE_PLANS) — дублировал DEFAULT_PLANS backend'а
    // и расходился бы с ним при следующем изменении каталога.
    async listBillingPlans(): Promise<SubscriptionPlan[]> {
      return request('/admin/billing/plans')
    },

    async listNews(): Promise<AdminNewsList> {
      return request('/admin/news')
    },

    async createNews(params: CreateNewsParams): Promise<NewsArticle> {
      return request('/admin/news', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(params),
      })
    },

    async updateNews(newsId: string, params: NewsContentParams, expectedVersion: number): Promise<NewsArticle> {
      return request(`/admin/news/${encodeURIComponent(newsId)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...params, expectedVersion }),
      })
    },

    async deleteNews(newsId: string): Promise<void> {
      return request(`/admin/news/${encodeURIComponent(newsId)}`, { method: 'DELETE' })
    },

    /**
     * Картинка к новости платформы (ADR-008): intent → PUT по presigned URL →
     * confirm. Возвращает assetId подтверждённого изображения.
     */
    async uploadNewsImage(file: File): Promise<{ assetId: string }> {
      const intent = await request<{ assetId: string; uploadUrl: string }>('/admin/news/images/upload-intent', {
        method: 'POST',
        body: JSON.stringify({ declaredMimeType: file.type, sizeBytes: file.size }),
      })
      // Прямо в хранилище, не через request(): адрес другого домена, cookie туда не нужны.
      const put = await fetcher(intent.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!put.ok) {
        throw new AdminApiError(`Хранилище отклонило файл (${put.status})`, put.status, 'UPLOAD_FAILED')
      }
      const confirmed = await request<{ status: 'verified' | 'rejected' }>(
        `/admin/news/images/${encodeURIComponent(intent.assetId)}/confirm`,
        { method: 'POST' },
      )
      if (confirmed.status !== 'verified') {
        throw new AdminApiError('Файл не прошёл проверку: нужна картинка JPG, PNG или WebP', 400, 'UPLOAD_REJECTED')
      }
      return { assetId: intent.assetId }
    },

    // ─── Реферальная сеть BAZA ─────────────────────────────────────────────

    async getReferralNetwork(): Promise<AdminReferralNetwork> {
      return request('/admin/referral-network')
    },

    async findReferralPerson(login: string): Promise<AdminReferralPersonLookup> {
      return request(`/admin/referral-network/people?login=${encodeURIComponent(login.trim())}`)
    },

    async getReferralHistory(identityId: string): Promise<{ items: MembershipHistoryItem[] }> {
      return request(`/admin/referral-network/people/${encodeURIComponent(identityId)}/history`)
    },

    async appointCurator(identityId: string, reason: string): Promise<AdminReferralNetwork> {
      return request('/admin/referral-network/curators', { method: 'POST', body: JSON.stringify({ identityId, reason }) })
    },

    async retireCurator(identityId: string, reason: string): Promise<AdminReferralNetwork> {
      return request(`/admin/referral-network/curators/${encodeURIComponent(identityId)}/retire`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async assignReferralMember(memberIdentityId: string, curatorIdentityId: string, reason: string): Promise<AdminReferralNetwork> {
      return request('/admin/referral-network/members', {
        method: 'POST',
        body: JSON.stringify({ memberIdentityId, curatorIdentityId, reason }),
      })
    },

    /** Имя после регистрации меняет BAZA: причина обязательна, уходит в аудит. */
    async renamePerson(identityId: string, name: string, reason: string): Promise<AdminReferralPerson> {
      return request(`/admin/people/${encodeURIComponent(identityId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, reason }),
      })
    },

    async removeReferralMember(identityId: string, reason: string): Promise<AdminReferralNetwork> {
      return request(`/admin/referral-network/members/${encodeURIComponent(identityId)}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },

    async listReferralRequests(status?: ReferralRequestStatus): Promise<{ items: ReferralRequest[] }> {
      return request(`/admin/referral-network/requests${status ? `?status=${status}` : ''}`)
    },

    async decideReferralRequest(requestId: string, decision: 'approved' | 'rejected', comment?: string): Promise<ReferralRequest> {
      return request(`/admin/referral-network/requests/${encodeURIComponent(requestId)}/decide`, {
        method: 'POST',
        body: JSON.stringify(comment ? { decision, comment } : { decision }),
      })
    },

    // ─── Комиссии и выплаты ────────────────────────────────────────────────

    async listCommissions(received: boolean): Promise<{ items: AdminCommissionDeal[] }> {
      return request(`/admin/commissions?received=${received ? 'true' : 'false'}`)
    },

    async markCommissionReceived(
      dealId: string,
      params: { expectedVersion: number; amount: MoneyAmount; receivedAt?: string },
    ): Promise<{ deal: AdminCommissionDeal; accrual: AccrualOutcome }> {
      return request(`/admin/commissions/${encodeURIComponent(dealId)}/received`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: params.expectedVersion,
          amountMinorUnits: params.amount.amountMinorUnits,
          currency: params.amount.currency,
          ...(params.receivedAt ? { receivedAt: params.receivedAt } : {}),
        }),
      })
    },

    async cancelCommissionReceived(
      dealId: string,
      params: { expectedVersion: number; reason: string },
    ): Promise<{ deal: AdminCommissionDeal; accrualReversed: boolean }> {
      return request(`/admin/commissions/${encodeURIComponent(dealId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },

    async listCuratorPayouts(): Promise<{ items: CuratorPayout[] }> {
      return request('/admin/curator-payouts')
    },

    async listCuratorAccruals(identityId: string): Promise<CuratorAccrualsResult> {
      return request(`/admin/curator-payouts/${encodeURIComponent(identityId)}/accruals`)
    },

    async markCuratorPaid(identityId: string, accrualIds: string[]): Promise<CuratorAccrualsResult & { paid: number }> {
      return request(`/admin/curator-payouts/${encodeURIComponent(identityId)}/pay`, {
        method: 'POST',
        body: JSON.stringify({ accrualIds }),
      })
    },
  }
}

export const adminApi = createAdminApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
})
