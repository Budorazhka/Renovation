/**
 * Типы для API клиентов BAZA (apps/api/src/modules/crm/contact.controller.ts,
 * CrmContactReadModel в crm.service.ts). Зеркалит backend-контракт 1:1 (N-20).
 */

/** Источник истины — apps/api/src/modules/crm/schemas/contact.schema.ts::CONTACT_ROLES. */
export const CONTACT_ROLES_V2 = ['buyer', 'investor', 'owner', 'referral', 'broker'] as const

export type ContactRoleV2 = (typeof CONTACT_ROLES_V2)[number]

/** Источник истины — CONTACT_SEGMENTS в contact.schema.ts. Не хранится, считается сервером из сделок и лидов. */
export const CONTACT_SEGMENTS_V2 = ['golden', 'active', 'archived', 'deferred'] as const

export type ContactSegmentV2 = (typeof CONTACT_SEGMENTS_V2)[number]

export interface ContactV2 {
  id: string
  organizationId: string
  name: string
  phone: string
  email: string | null
  roles: ContactRoleV2[]
  /** Число сделок контакта — сам список отдаёт GET /deals?contactId= */
  dealsCount: number
  segment: ContactSegmentV2
  createdAt: string
}

export interface ListContactsV2Params {
  q?: string
  segment?: ContactSegmentV2
  cursor?: string
  limit?: number
}

export interface ListContactsV2Response {
  items: ContactV2[]
  nextCursor: string | null
}

/** POST /api/v1/contacts body — см. CreateContactDto. */
export interface CreateContactV2Payload {
  name: string
  phone: string
  email?: string
  roles?: ContactRoleV2[]
}

/** PATCH /api/v1/contacts/:contactId body — см. UpdateContactDto. Партиал, email:null снимает адрес. */
export interface UpdateContactV2Payload {
  name?: string
  phone?: string
  email?: string | null
  roles?: ContactRoleV2[]
}
