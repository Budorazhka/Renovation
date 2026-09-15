/**
 * Допустимые generic-стадии лида БЕЗ productType (источник истины:
 * apps/api/src/modules/crm/lead-stage.ts::LEAD_STAGES). Лид С productType
 * (см. LeadProductTypeV2 ниже) использует свой собственный список стадий —
 * см. apps/erp-web/src/lib/lead-v2-poker-adapter.ts, полный runtime-список
 * (обе категории вместе) — apps/api/src/modules/crm/lead-stage.ts::ALL_LEAD_STAGE_VALUES.
 */
export const LEAD_STAGES_V2 = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const

export type LeadStageV2 = (typeof LEAD_STAGES_V2)[number]

/**
 * Продуктовые воронки лида (03.09.2026, owner decision, источник истины —
 * apps/api/src/modules/crm/lead-stage-definitions.ts::PRODUCT_TYPES).
 * Значения — обычные строки, НЕ легаси TS-enum `ProductType` из
 * features/crm/services/api/types.ts (те же значения, но enum-члены не
 * структурно совместимы с plain string union без явного каста) — этот файл
 * намеренно изолирован от легаси-типов (см. докстринг leadsApiV2.ts).
 */
export const LEAD_PRODUCT_TYPES_V2 = ['sales', 'network', 'owner', 'agent'] as const

export type LeadProductTypeV2 = (typeof LEAD_PRODUCT_TYPES_V2)[number]

/**
 * GET /leads/stage-definitions (apps/api/src/modules/crm/lead-stage-definitions.controller.ts)
 * — справочник стадий воронки по продукту, зеркалит backend 1:1
 * (LeadStageDefinition в apps/api/src/modules/crm/lead-stage-definitions.ts).
 */
export interface LeadStageDefinitionV2 {
  id: string
  name: string
  order: number
  column: 'rejection' | 'in_progress' | 'success'
}

export type LeadStageDefinitionsV2Response = Record<LeadProductTypeV2, LeadStageDefinitionV2[]>

export interface LeadSourceV2 {
  route: string
  publicationId?: string
  utm?: Record<string, string>
  referrer?: string
}

export interface LeadContactV2 {
  id: string
  name: string
  phone: string
  email?: string
}

export interface LeadV2 {
  id: string
  organizationId: string
  ownerPositionId: string | null
  /** null — лид на generic-пятёрке стадий (LEAD_STAGES_V2). Задан — stage принадлежит воронке этого продукта. */
  productType: LeadProductTypeV2 | null
  /**
   * generic-стадия (productType не задан) либо строковый id стадии
   * productType этого лида (см. lead-v2-poker-adapter.ts) — шире, чем
   * LeadStageV2, тип оставлен узким ради автодополнения generic-стадий;
   * значения продуктовых стадий читай
   * как `string`, не полагайся на исчерпывающее сужение union здесь.
   */
  stage: LeadStageV2
  /** Optimistic concurrency (27.08.2026) — обязателен в PATCH .../stage как expectedVersion. */
  version: number
  source: LeadSourceV2
  createdAt: string
  contact: LeadContactV2 | null
  /** CRM-003: активный лид без открытых next actions (read-only индикатор). Для лидов с productType — всегда false (правило не покрывает продуктовые воронки). */
  hasOpenNextAction: boolean
  /** Активная generic-стадия без открытых задач. */
  stalled: boolean
  /**
   * `[phase 3]` PATCH /leads/:leadId сопутствующие поля (см. CrmLeadReadModel
   * в apps/api/src/modules/crm/crm.service.ts). Сервер всегда отдаёт их
   * (null, если не заполнено) — здесь они опциональны по решению задачи, не
   * строго `| null`, чтобы не заставлять каждого потребителя типа проверять
   * поле, которого он не читает.
   */
  city?: string | null
  notes?: string | null
  tags?: string[]
  dealValue?: number | null
  budgetValue?: number | null
  budgetCurrency?: string | null
  expectedCloseDate?: string | null
  rejectionReason?: string | null
  rejectionComment?: string | null
  telegram?: string | null
  /** Из импорта старой базы. */
  whatsapp?: string | null
  lastContactAt?: string | null
  country?: string | null
  /**
   * realtorStage/curatorStage — независимые указатели легаси 6-ступенчатой
   * шкалы (realtor_1..6/curator_1..6), НЕ дубли `stage`. Решение по целевому
   * дизайну этих полей ещё не принято владельцем (см. lead.controller.ts
   * докстринг PATCH /leads/:leadId) — здесь они прокинуты как обычные
   * строки, без переосмысления.
   */
  realtorStage?: string | null
  curatorStage?: string | null
}

/** Тело PATCH /leads/:leadId — см. UpdateLeadDto (apps/api). Все поля опциональны, `stage` сюда не входит (отдельный эндпоинт .../stage). */
export interface UpdateLeadV2Payload {
  /** Имя, телефон и почта — поля контакта лида; сервер обновляет контакт. */
  name?: string
  phone?: string
  email?: string | null
  /** Смена продукта сбрасывает стадию в «Новый лид» нового продукта. */
  productType?: LeadProductTypeV2
  city?: string
  notes?: string
  tags?: string[]
  dealValue?: number
  budgetValue?: number
  budgetCurrency?: string
  expectedCloseDate?: string
  rejectionReason?: string
  rejectionComment?: string
  telegram?: string
  country?: string
  realtorStage?: string
  curatorStage?: string
}

/** GET /leads/:leadId/files — см. CrmLeadFileReadModel (apps/api). */
export interface LeadFileV2 {
  assetId: string
  fileName: string
  mimeType: string | null
  sizeBytes: number
  url: string | null
  createdAt: string
}

/** GET /leads/:leadId/events — см. CrmLeadEventReadModel (apps/api). */
export interface LeadEventV2 {
  id: string
  leadId: string
  stage: string
  changedBy: { type: 'position' | 'system'; positionId?: string }
  changedAt: string
  /** `[phase 3]` Легаси stage-comment, привязанный к этому переходу. */
  comment: string | null
}

export interface ListLeadEventsV2Response {
  items: LeadEventV2[]
  nextCursor: string | null
}

/**
 * Ответ команд assign/unassign/changeStage. Это НЕ полная read-модель
 * LeadV2 — assign/unassign не возвращают version/productType (см.
 * CrmService.assignLead/unassignLead) — вызывающий код обязан относиться к
 * этим полям как к опциональным, не читать их из этого результата.
 */
export interface LeadStageChangeResult {
  id: string
  organizationId: string
  contactId: string
  ownerPositionId: string | null
  stage: LeadStageV2
  version?: number
  productType?: LeadProductTypeV2 | null
  source: LeadSourceV2
}

export interface ListLeadsV2Params {
  stage?: LeadStageV2
  ownerPositionId?: string
  stalled?: boolean
  cursor?: string
  limit?: number
}

export interface ListLeadsV2Response {
  items: LeadV2[]
  nextCursor: string | null
}

export interface ChangeLeadStagePayload {
  stage: LeadStageV2
  expectedVersion: number
}

export interface CreateLeadV2Payload {
  contactId?: string
  requesterName?: string
  requesterPhone?: string
  productType?: LeadProductTypeV2
}
