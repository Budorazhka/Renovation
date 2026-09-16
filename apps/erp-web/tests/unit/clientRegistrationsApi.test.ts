import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const postMock = vi.fn()
const getMock = vi.fn()
const patchMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({ post: postMock, get: getMock, patch: patchMock }),
  },
}))

const registration = {
  id: 'reg-1',
  developmentId: 'dev-1',
  developerName: 'Застройщик Икс',
  projectName: 'ЖК Солнечный',
  unitLabel: null,
  clientName: 'Иванов Иван',
  clientPhone: '+995 555 12-34-56',
  leadId: null,
  agentPositionId: 'pos-1',
  status: 'pending',
  isExpired: false,
  awaitsDeveloper: true,
  reservedUntil: null,
  decidedAt: null,
  decisionNote: null,
  notes: null,
  createdAt: '2026-09-16T10:00:00Z',
  version: 0,
}

describe('clientRegistrationsApi', () => {
  beforeEach(() => {
    postMock.mockReset()
    getMock.mockReset()
    patchMock.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('create отправляет ключ идемпотентности: без него сервер отвечает 400', async () => {
    postMock.mockResolvedValue({ data: registration })
    const { clientRegistrationsApi } = await import('@/services/clientRegistrationsApi')

    await clientRegistrationsApi.create(
      { developmentSlug: 'zhk-solnechnyy', clientName: 'Иванов Иван', clientPhone: '+995 555 12-34-56' },
      'key-1',
    )

    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/client-registrations',
      expect.objectContaining({ developmentSlug: 'zhk-solnechnyy' }),
      { headers: { 'Idempotency-Key': 'key-1' } },
    )
  })

  it('решения застройщика идут на свои маршруты и несут прочитанную версию', async () => {
    postMock.mockResolvedValue({ data: { ...registration, status: 'active', version: 1 } })
    const { clientRegistrationsApi } = await import('@/services/clientRegistrationsApi')

    await clientRegistrationsApi.accept('reg-1', 0)
    expect(postMock).toHaveBeenCalledWith('/api/v1/client-registrations/reg-1/accept', { expectedVersion: 0 })

    await clientRegistrationsApi.reject('reg-1', 0, 'Клиент уже наш')
    expect(postMock).toHaveBeenCalledWith('/api/v1/client-registrations/reg-1/reject', {
      expectedVersion: 0,
      reason: 'Клиент уже наш',
    })
  })

  it('реестр и входящие читаются разными маршрутами — это разные стороны одной записи', async () => {
    getMock.mockResolvedValue({ data: { items: [registration] } })
    const { clientRegistrationsApi } = await import('@/services/clientRegistrationsApi')

    await clientRegistrationsApi.list('pending')
    expect(getMock).toHaveBeenCalledWith('/api/v1/client-registrations', { params: { status: 'pending' } })

    await clientRegistrationsApi.listIncoming()
    expect(getMock).toHaveBeenCalledWith('/api/v1/client-registrations/incoming', { params: undefined })
  })

  it('правка шлёт PATCH с версией, которую видел менеджер', async () => {
    patchMock.mockResolvedValue({ data: { ...registration, notes: 'Позвонить в пятницу', version: 1 } })
    const { clientRegistrationsApi } = await import('@/services/clientRegistrationsApi')

    const updated = await clientRegistrationsApi.update('reg-1', 0, { notes: 'Позвонить в пятницу' })

    expect(patchMock).toHaveBeenCalledWith('/api/v1/client-registrations/reg-1', {
      expectedVersion: 0,
      notes: 'Позвонить в пятницу',
    })
    expect(updated.version).toBe(1)
  })
})
