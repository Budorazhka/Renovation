import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const postMock = vi.fn()
const patchMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      patch: patchMock,
      delete: deleteMock,
    }),
  },
}))

const apiSelection = {
  id: 'sel-1',
  publicToken: 'a'.repeat(64),
  title: 'Подборка для Анны',
  status: 'draft' as const,
  items: [{ unitId: 'unit-1' }],
  createdAt: '2026-09-04T00:00:00.000Z',
  viewCount: 0,
  version: 0,
}

describe('devSelectionsApiV2', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    patchMock.mockReset()
    deleteMock.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('запрашивает GET /api/v1/selections и маппит items', async () => {
      getMock.mockResolvedValue({ data: { items: [apiSelection] } })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      const result = await devSelectionsApiV2.list()

      expect(getMock).toHaveBeenCalledWith('/api/v1/selections', { params: undefined })
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('sel-1')
      expect(result[0]!.version).toBe(0)
    })

    it('передаёт status в query-параметрах при наличии', async () => {
      getMock.mockResolvedValue({ data: { items: [] } })
      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      await devSelectionsApiV2.list('sent')

      expect(getMock).toHaveBeenCalledWith('/api/v1/selections', { params: { status: 'sent' } })
    })
  })

  describe('create', () => {
    it('отправляет POST с Idempotency-Key и телом подборки', async () => {
      postMock.mockResolvedValue({ data: apiSelection })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      const result = await devSelectionsApiV2.create({ title: 'Подборка для Анны', unitIds: ['unit-1'] })

      expect(postMock).toHaveBeenCalledTimes(1)
      const [url, body, config] = postMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections')
      expect(body.title).toBe('Подборка для Анны')
      expect(config?.headers?.['Idempotency-Key']).toBeTruthy()
      expect(result.id).toBe('sel-1')
    })
  })

  describe('update', () => {
    it('отправляет PATCH с expectedVersion и Idempotency-Key', async () => {
      patchMock.mockResolvedValue({ data: { ...apiSelection, title: 'Обновлено', version: 1 } })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      const result = await devSelectionsApiV2.update('sel-1', { title: 'Обновлено' }, 0)

      const [url, body, config] = patchMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections/sel-1')
      expect(body.expectedVersion).toBe(0)
      expect(body.title).toBe('Обновлено')
      expect(config?.headers?.['Idempotency-Key']).toBeTruthy()
      expect(result.version).toBe(1)
    })
  })

  describe('setStatus', () => {
    it('отправляет PATCH /status с status и expectedVersion', async () => {
      patchMock.mockResolvedValue({ data: { ...apiSelection, status: 'sent', version: 1 } })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      const result = await devSelectionsApiV2.setStatus('sel-1', 'sent', 0)

      const [url, body] = patchMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections/sel-1/status')
      expect(body).toMatchObject({ status: 'sent', expectedVersion: 0 })
      expect(result.status).toBe('sent')
    })
  })

  describe('remove', () => {
    it('отправляет DELETE с Idempotency-Key и expectedVersion в params', async () => {
      deleteMock.mockResolvedValue({ status: 204 })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      await devSelectionsApiV2.remove('sel-1', 2)

      const [url, config] = deleteMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections/sel-1')
      expect(config?.params?.expectedVersion).toBe(2)
      expect(config?.headers?.['Idempotency-Key']).toBeTruthy()
    })
  })

  describe('addItems', () => {
    it('отправляет POST /items с unitIds и expectedVersion', async () => {
      postMock.mockResolvedValue({ data: apiSelection })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      await devSelectionsApiV2.addItems('sel-1', { unitIds: ['unit-2'] }, 1)

      const [url, body] = postMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections/sel-1/items')
      expect(body).toMatchObject({ unitIds: ['unit-2'], expectedVersion: 1 })
    })
  })

  describe('removeItem', () => {
    it('отправляет DELETE /items/:unitId с expectedVersion в params', async () => {
      deleteMock.mockResolvedValue({ data: apiSelection })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      await devSelectionsApiV2.removeItem('sel-1', 'unit-1', 0)

      const [url, config] = deleteMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections/sel-1/items/unit-1')
      expect(config?.params?.expectedVersion).toBe(0)
    })
  })

  describe('updateItem', () => {
    it('отправляет PATCH /items/:unitId с agentNote/reaction и expectedVersion', async () => {
      patchMock.mockResolvedValue({ data: apiSelection })

      const { devSelectionsApiV2 } = await import('@/services/devSelectionsApiV2')
      await devSelectionsApiV2.updateItem('sel-1', 'unit-1', { agentNote: 'Хорошая планировка' }, 0)

      const [url, body] = patchMock.mock.calls[0]!
      expect(url).toBe('/api/v1/selections/sel-1/items/unit-1')
      expect(body).toMatchObject({ agentNote: 'Хорошая планировка', expectedVersion: 0 })
    })
  })
})
