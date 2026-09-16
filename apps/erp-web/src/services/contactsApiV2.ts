import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type {
  ContactV2,
  CreateContactV2Payload,
  ListContactsV2Params,
  ListContactsV2Response,
  UpdateContactV2Payload,
} from '@/types/contactsV2'

export * from '@/types/contactsV2'

/**
 * Изолированный клиент к API клиентов BAZA (N-20,
 * apps/api/src/modules/crm/contact.controller.ts) — тот же принцип, что
 * tasksApiV2/dealsApiV2: авторизация только через cookie, ошибки не
 * проглатываются.
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

const CONTACTS_PER_REQUEST = 100
/** Тот же предел страниц, что tasksApiV2.listAll/dealsApiV2.listAll. */
const MAX_CONTACT_PAGES = 20

export function newIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  return `contact-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const contactsApiV2 = {
  /** GET /api/v1/contacts */
  async list(params?: ListContactsV2Params): Promise<ListContactsV2Response> {
    const { data } = await api.get<ListContactsV2Response>('/api/v1/contacts', { params })
    return data
  },

  /**
   * Все клиенты вкладки, а не первая страница — список ERP показывает
   * реестр целиком, тот же принцип, что tasksApiV2.listAll докстринг.
   * `complete: false` означает, что упёрлись в предел страниц.
   */
  async listAll(
    params?: Omit<ListContactsV2Params, 'cursor'>,
    maxPages = MAX_CONTACT_PAGES,
  ): Promise<{ items: ContactV2[]; complete: boolean }> {
    const items: ContactV2[] = []
    let cursor: string | undefined
    let complete = false

    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.list({ ...params, limit: CONTACTS_PER_REQUEST, cursor })
      items.push(...response.items)
      if (!response.nextCursor) {
        complete = true
        break
      }
      cursor = response.nextCursor
    }

    return { items, complete }
  },

  /** GET /api/v1/contacts/:contactId */
  async getById(contactId: string): Promise<ContactV2> {
    const { data } = await api.get<ContactV2>(`/api/v1/contacts/${contactId}`)
    return data
  },

  /** POST /api/v1/contacts. Заголовок Idempotency-Key обязателен — без него 400. */
  async create(payload: CreateContactV2Payload, idempotencyKey: string): Promise<ContactV2> {
    const { data } = await api.post<ContactV2>('/api/v1/contacts', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return data
  },

  /** PATCH /api/v1/contacts/:contactId — партиал, непереданное поле не трогается. */
  async update(contactId: string, payload: UpdateContactV2Payload): Promise<ContactV2> {
    const { data } = await api.patch<ContactV2>(`/api/v1/contacts/${contactId}`, payload)
    return data
  },
}
