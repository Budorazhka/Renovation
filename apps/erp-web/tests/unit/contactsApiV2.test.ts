/**
 * Клиент к API клиентов (N-20). Проверяется то, что ломается молча: адрес
 * запроса, обязательный Idempotency-Key на создании, партиал в update() и
 * пагинация listAll() — не первая страница выдаётся за весь список.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const postMock = vi.fn()
const patchMock = vi.fn()
let axiosCreateConfig: Record<string, unknown> | undefined

vi.mock('axios', () => ({
  default: {
    create: (config: Record<string, unknown>) => {
      axiosCreateConfig = config
      return { get: getMock, post: postMock, patch: patchMock }
    },
  },
}))

describe('contactsApiV2', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    patchMock.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('ходит по cookie-сессии, не передавая организацию в запросе', async () => {
    await import('@/services/contactsApiV2')
    expect(axiosCreateConfig?.withCredentials).toBe(true)
    expect(axiosCreateConfig?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('list() запрашивает GET /api/v1/contacts с переданными параметрами (q, segment, cursor)', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    getMock.mockResolvedValue({ data: { items: [], nextCursor: null } })

    await contactsApiV2.list({ q: 'Иван', segment: 'golden', limit: 20 })

    expect(getMock).toHaveBeenCalledWith('/api/v1/contacts', { params: { q: 'Иван', segment: 'golden', limit: 20 } })
  })

  it('create() отправляет Idempotency-Key — иначе повтор завёл бы второго клиента', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    postMock.mockResolvedValue({ data: { id: 'contact-1' } })

    await contactsApiV2.create({ name: 'Иван', phone: '+79990000000' }, 'key-42')

    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/contacts',
      { name: 'Иван', phone: '+79990000000' },
      { headers: { 'Idempotency-Key': 'key-42' } },
    )
  })

  it('update() — PATCH партиалом, включая email:null', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    patchMock.mockResolvedValue({ data: { id: 'contact-1', email: null } })

    await contactsApiV2.update('contact-1', { email: null })

    expect(patchMock).toHaveBeenCalledWith('/api/v1/contacts/contact-1', { email: null })
  })

  it('getById() запрашивает контакт по id', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    getMock.mockResolvedValue({ data: { id: 'contact-1' } })

    await contactsApiV2.getById('contact-1')

    expect(getMock).toHaveBeenCalledWith('/api/v1/contacts/contact-1')
  })

  it('listAll() дочитывает все страницы по nextCursor, complete:true когда страницы кончились', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    getMock
      .mockResolvedValueOnce({ data: { items: [{ id: '1' }], nextCursor: 'c1' } })
      .mockResolvedValueOnce({ data: { items: [{ id: '2' }], nextCursor: null } })

    const result = await contactsApiV2.listAll()

    expect(result).toEqual({ items: [{ id: '1' }, { id: '2' }], complete: true })
    expect(getMock).toHaveBeenNthCalledWith(2, '/api/v1/contacts', { params: { limit: 100, cursor: 'c1' } })
  })

  it('listAll() возвращает complete:false, если упёрлось в предел страниц', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    getMock.mockResolvedValue({ data: { items: [{ id: 'x' }], nextCursor: 'next' } })

    const result = await contactsApiV2.listAll(undefined, 2)

    expect(result.complete).toBe(false)
    expect(result.items).toHaveLength(2)
  })

  it('ошибка сервера не проглатывается — вызывающий код обязан её увидеть', async () => {
    const { contactsApiV2 } = await import('@/services/contactsApiV2')
    const error = Object.assign(new Error('Conflict'), { response: { status: 409, data: { error: { code: 'CONTACT_PHONE_TAKEN' } } } })
    postMock.mockRejectedValue(error)

    await expect(contactsApiV2.create({ name: 'Иван', phone: '+1' }, 'key')).rejects.toBe(error)
  })
})
