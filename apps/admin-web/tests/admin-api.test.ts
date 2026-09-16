import { describe, expect, it, vi } from 'vitest'
import { AdminApiError, createAdminApi } from '../src/api/admin-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('createAdminApi', () => {
  it('sends credentials:"include" on every request — session lives in an httpOnly cookie, not a token this client holds', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ isSuperAdmin: true, adminAccountId: 'a1', publicationReadScope: 'all' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.me()

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/admin/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('listPublications builds query params only for provided filters, omits empty ones', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.listPublications({ sourceType: 'development', city: 'batumi', limit: 10 })

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/publications?sourceType=development&city=batumi&limit=10')
  })

  it('listPublications omits query string entirely when no filters given', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.listPublications()

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/publications')
  })

  it('unpublish posts reason as JSON body to the correct publicationId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'pub1', sourceType: 'development', sourceId: 's1', status: 'unpublished', slug: null, unpublishReason: 'test reason' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.unpublish('pub1', 'test reason')

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/publications/pub1/unpublish')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'test reason' })
  })

  it('активация тарифа и публикация новости отправляют Idempotency-Key — без него сервер отвечает 400', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.activateSubscription('org1', { planCode: 'pro', reason: 'оплата по счёту 15' })
    await api.createNews({ title: 'T', body: 'B', category: 'market' })

    for (const [, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/\S{8,}/)
    }
  })

  it('non-2xx response is parsed into AdminApiError carrying the server error code, not swallowed as generic', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { code: 'ADMIN_SCOPE_INSUFFICIENT', message: 'Недостаточно прав', requestId: 'req-1' } }, 403),
    )
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await expect(api.unpublish('pub1', 'test reason')).rejects.toMatchObject({
      status: 403,
      code: 'ADMIN_SCOPE_INSUFFICIENT',
      message: 'Недостаточно прав',
    })
  })

  it('non-JSON error body still produces a usable AdminApiError, does not crash the caller', async () => {
    const fetcher = vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await expect(api.me()).rejects.toBeInstanceOf(AdminApiError)
  })

  it('grantPermission omits scopeValue when the caller does not pass one (global scope)', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ granted: true }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.grantPermission('acc1', { resource: 'development', action: 'read', scope: 'global' })

    const [, init] = fetcher.mock.calls[0]!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ resource: 'development', action: 'read', scope: 'global', scopeValue: undefined })
  })

  it('logout POSTs to /auth/logout with no body', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ loggedOut: true }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.logout()

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/auth/logout')
    expect(init).toMatchObject({ method: 'POST' })
    expect(result).toEqual({ loggedOut: true })
  })

  it('deactivateAccount posts reason to the correct accountId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ status: 'deactivated' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.deactivateAccount('acc1', 'нарушение политики использования admin-доступа')

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/accounts/acc1/deactivate')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'нарушение политики использования admin-доступа' })
    expect(result).toEqual({ status: 'deactivated' })
  })

  it('reactivateAccount posts reason to the correct accountId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ status: 'active' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.reactivateAccount('acc1', 'ошибка устранена, восстанавливаем доступ')

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/accounts/acc1/reactivate')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'ошибка устранена, восстанавливаем доступ' })
    expect(result).toEqual({ status: 'active' })
  })

  it('revokeGrant posts reason and expectedVersion to the correct grant path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ revoked: true }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.revokeGrant('acc1', 'grant1', { reason: 'причина отзыва granta', expectedVersion: 2 })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/accounts/acc1/grants/grant1/revoke')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'причина отзыва granta', expectedVersion: 2 })
    expect(result).toEqual({ revoked: true })
  })

  it('revokeGrant conflict (409 VERSION_CONFLICT) surfaces as AdminApiError with the server code, not swallowed', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { code: 'VERSION_CONFLICT', message: 'Grant изменён другим запросом', requestId: 'req-1' } }, 409),
    )
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await expect(api.revokeGrant('acc1', 'grant1', { reason: 'причина отзыва granta', expectedVersion: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
    })
  })

  it('listComplaints builds query params for status, cursor, and limit', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.listComplaints({ status: 'pending', cursor: 'c1', limit: 10 })

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/complaints?status=pending&cursor=c1&limit=10')
  })

  it('resolveComplaint posts decision and reason to correct complaintId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'comp1', status: 'resolved_upheld' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.resolveComplaint('comp1', { decision: 'upheld', reason: 'объявление нарушает правила' })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/complaints/comp1/resolve')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: 'upheld', reason: 'объявление нарушает правила' })
    expect(result).toEqual({ id: 'comp1', status: 'resolved_upheld' })
  })

  it('listDuplicateCandidates builds query params for status, cursor, and limit', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.listDuplicateCandidates({ status: 'detected', cursor: 'c2', limit: 15 })

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/duplicate-candidates?status=detected&cursor=c2&limit=15')
  })

  it('confirmDuplicate posts reason to correct duplicateCandidateId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'dup1', status: 'confirmed_duplicate' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.confirmDuplicate('dup1', 'совпадают все параметры и контакты')

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/duplicate-candidates/dup1/confirm')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'совпадают все параметры и контакты' })
    expect(result).toEqual({ id: 'dup1', status: 'confirmed_duplicate' })
  })

  it('listRealtorReviews builds query params for status, cursor, and limit', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.listRealtorReviews({ status: 'pending', cursor: 'c3', limit: 20 })

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/realtor-reviews?status=pending&cursor=c3&limit=20')
  })

  it('moderateRealtorReview posts decision and reason to correct reviewId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'review1', status: 'approved' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.moderateRealtorReview('review1', { decision: 'approved', reason: 'сделка подтверждена в CRM' })

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/realtor-reviews/review1/moderate')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: 'approved', reason: 'сделка подтверждена в CRM' })
    expect(result).toEqual({ id: 'review1', status: 'approved' })
  })

  it('listOrganizations builds query params for type, status, search, cursor, and limit', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    await api.listOrganizations({ type: 'agency', status: 'active', search: 'Batumi', cursor: 'c3', limit: 20 })

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/organizations?type=agency&status=active&search=Batumi&cursor=c3&limit=20')
  })

  it('getOrganization calls GET on the correct organizationId path', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'org1', name: 'Batumi Agency', type: 'agency', status: 'active', createdAt: '2026-01-01', positionsCount: 1, positions: [] }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.getOrganization('org1')

    const [url] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/organizations/org1')
    expect(result.name).toBe('Batumi Agency')
  })

  it('freezeOrganization posts reason to /freeze endpoint', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'org1', status: 'frozen' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.freezeOrganization('org1', 'Нарушение условий размещения объектов')

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/organizations/org1/freeze')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'Нарушение условий размещения объектов' })
    expect(result).toEqual({ id: 'org1', status: 'frozen' })
  })

  it('unfreezeOrganization posts reason to /unfreeze endpoint', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'org1', status: 'active' }))
    const api = createAdminApi({ baseUrl: 'https://api.example.test/api/v1', fetcher })

    const result = await api.unfreezeOrganization('org1', 'Документы проверены и подтверждены')

    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/api/v1/admin/organizations/org1/unfreeze')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'Документы проверены и подтверждены' })
    expect(result).toEqual({ id: 'org1', status: 'active' })
  })
})
