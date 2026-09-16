import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const setStatusMock = vi.fn()
const removeMock = vi.fn()
const addItemsMock = vi.fn()
const removeItemMock = vi.fn()
const updateItemMock = vi.fn()

vi.mock('@/services/devSelectionsApiV2', () => ({
  devSelectionsApiV2: {
    list: listMock,
    create: createMock,
    update: updateMock,
    setStatus: setStatusMock,
    remove: removeMock,
    addItems: addItemsMock,
    removeItem: removeItemMock,
    updateItem: updateItemMock,
  },
}))

const publicGetByTokenMock = vi.fn()
vi.mock('@/services/publicSelectionsApi', () => ({
  publicSelectionsApi: { getByToken: publicGetByTokenMock },
}))

const storageMap = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { storageMap.set(key, String(value)) },
  removeItem: (key: string) => { storageMap.delete(key) },
  clear: () => { storageMap.clear() },
}
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true })

const baseServerSelection = {
  id: 'server-id-1',
  publicToken: 'b'.repeat(64),
  title: 'Подборка для Анны',
  status: 'draft' as const,
  items: [{ unitId: 'unit-1' }],
  createdAt: '2026-09-04T00:00:00.000Z',
  viewCount: 0,
  version: 0,
}

describe('useDevSelectionsStore with real backend API', () => {
  beforeEach(() => {
    storageMap.clear()
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    setStatusMock.mockReset()
    removeMock.mockReset()
    addItemsMock.mockReset()
    removeItemMock.mockReset()
    updateItemMock.mockReset()
    publicGetByTokenMock.mockReset()
    vi.resetModules()
    // Дефолт для тестов, которым create() нужен только как setup-шаг (не предмет проверки).
    createMock.mockResolvedValue(baseServerSelection)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('create() возвращает подборку синхронно (оптимистично) и заменяет её на серверную после ответа', async () => {
    createMock.mockResolvedValue(baseServerSelection)

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()

    const created = store.create({ title: 'Подборка для Анны', unitIds: ['unit-1'] })
    expect(created.title).toBe('Подборка для Анны')
    expect(typeof created.publicToken).toBe('string')
    expect(getDevSelectionsState().selections.some((s) => s.id === created.id)).toBe(true)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Подборка для Анны', unitIds: ['unit-1'] }),
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(getDevSelectionsState().selections.some((s) => s.id === 'server-id-1')).toBe(true)
  })

  it('update() оптимистично патчит и вызывает API с expectedVersion из текущей версии', async () => {
    updateMock.mockResolvedValue({ ...baseServerSelection, title: 'Новое имя', version: 1 })

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()
    store.create({ title: 'Исходное', unitIds: ['unit-1'] })
    const id = getDevSelectionsState().selections[0]!.id

    store.update(id, { title: 'Новое имя' })

    expect(getDevSelectionsState().selections.find((s) => s.id === id)?.title).toBe('Новое имя')
    expect(updateMock).toHaveBeenCalledWith(id, expect.objectContaining({ title: 'Новое имя' }), 0)
  })

  it('setStatus() проставляет sentAt при переходе в sent и вызывает API', async () => {
    setStatusMock.mockResolvedValue({ ...baseServerSelection, status: 'sent', version: 1 })

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()
    store.create({ title: 'x', unitIds: ['unit-1'] })
    const id = getDevSelectionsState().selections[0]!.id

    store.setStatus(id, 'sent')

    const sel = getDevSelectionsState().selections.find((s) => s.id === id)
    expect(sel?.status).toBe('sent')
    expect(sel?.sentAt).toBeDefined()
    expect(setStatusMock).toHaveBeenCalledWith(id, 'sent', 0)
  })

  it('addUnits() дедуплицирует против уже существующих items и вызывает API только с новыми unitId', async () => {
    addItemsMock.mockResolvedValue({ ...baseServerSelection, items: [{ unitId: 'unit-1' }, { unitId: 'unit-2' }], version: 1 })

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()
    store.create({ title: 'x', unitIds: ['unit-1'] })
    const id = getDevSelectionsState().selections[0]!.id

    store.addUnits(id, ['unit-1', 'unit-2'])

    expect(addItemsMock).toHaveBeenCalledWith(id, { unitIds: ['unit-2'], listingIds: [] }, 0)
  })

  it('removeItem() удаляет лот локально и вызывает API', async () => {
    removeItemMock.mockResolvedValue({ ...baseServerSelection, items: [], version: 1 })

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()
    store.create({ title: 'x', unitIds: ['unit-1'] })
    const id = getDevSelectionsState().selections[0]!.id

    store.removeItem(id, 'unit-1')

    expect(getDevSelectionsState().selections.find((s) => s.id === id)?.items).toHaveLength(0)
    expect(removeItemMock).toHaveBeenCalledWith(id, 'unit-1', 0)
  })

  it('remove() удаляет подборку из стора и вызывает API', async () => {
    removeMock.mockResolvedValue(undefined)

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()
    store.create({ title: 'x', unitIds: ['unit-1'] })
    const id = getDevSelectionsState().selections[0]!.id

    store.remove(id)

    expect(getDevSelectionsState().selections.find((s) => s.id === id)).toBeUndefined()
    expect(removeMock).toHaveBeenCalledWith(id, 0)
  })

  it('fetchAll() загружает подборки с сервера и заменяет selections', async () => {
    listMock.mockResolvedValue([baseServerSelection])

    const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
    const store = getDevSelectionsState()

    const result = await store.fetchAll()

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(getDevSelectionsState().selections.some((s) => s.id === 'server-id-1')).toBe(true)
  })

  describe('markViewed/getByToken — публичный контур (без организации)', () => {
    it('markViewed() запрашивает публичный API и getByToken() возвращает результат из кэша', async () => {
      publicGetByTokenMock.mockResolvedValue({
        title: 'Публичная подборка',
        status: 'viewed',
        items: [{ unitId: 'unit-1' }],
        createdAt: '2026-09-04T00:00:00.000Z',
        viewCount: 1,
      })

      const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
      const store = getDevSelectionsState()

      expect(store.getByToken('shared-token')).toBeUndefined()
      store.markViewed('shared-token')

      await Promise.resolve()
      await Promise.resolve()

      expect(publicGetByTokenMock).toHaveBeenCalledWith('shared-token')
      const found = getDevSelectionsState().getByToken('shared-token')
      expect(found?.title).toBe('Публичная подборка')
    })

    it('неизвестный токен — getByToken() остаётся undefined после неуспешного markViewed', async () => {
      publicGetByTokenMock.mockRejectedValue(new Error('not found'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { getDevSelectionsState } = await import('@/store/useDevSelectionsStore')
      const store = getDevSelectionsState()
      store.markViewed('unknown-token')

      await Promise.resolve()
      await Promise.resolve()

      expect(getDevSelectionsState().getByToken('unknown-token')).toBeUndefined()
      errorSpy.mockRestore()
    })
  })
})
