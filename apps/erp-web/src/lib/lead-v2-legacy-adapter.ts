import { ProductType } from '@/features/crm/services/api/types'
import type { BudgetCurrency, Lead as CrmLead, LeadStage as CrmLeadStage, RejectionReason } from '@/features/crm/services/api/types'
import type { LeadEventV2, LeadProductTypeV2, LeadV2 } from '@/types/leadsV2'
import type { LeadStageId } from '@/types/leads'
import { CRM_STAGE_TO_POKER_ID, POKER_ID_TO_CRM_STAGE } from './crm-poker-adapter'

/**
 * Адаптер: LeadV2 (apps/api, /api/v1/leads/*) → легаси `Lead`
 * (features/crm/services/api/types.ts), которым до сих пор оперирует
 * LeadViewModal.tsx (вёрстка не меняется — меняется только источник
 * данных). Аналог lead-v2-poker-adapter.ts, но целевой тип — легаси CRM
 * Lead, а не покерная карточка.
 *
 * Стадии: у network/owner/agent id на backend (lead-stage-definitions.ts)
 * побуквенно совпадают с легаси enum `LeadStage` (все с префиксом продукта),
 * а у sales — нет: backend хранит `defective`/`refused`/`new`/…, легаси —
 * `rejected`/`first_contact`/`needs_analysis`/…. Перевод — по таблице
 * crm-poker-adapter (CRM_STAGE_TO_POKER_ID), той же, что переносит в
 * apps/api lead-stage-legacy-mapping.ts. Id продаж без префикса и не
 * пересекаются с другими продуктами, поэтому переводятся без знания продукта.
 * realtorStage/curatorStage (`realtor_1..6`/`curator_1..6`) совпадают.
 */

/** Id стадии backend → легаси LeadStage (у sales id различаются, у остальных совпадают). */
export function stageV2ToCrm(stage: string): CrmLeadStage {
  return (POKER_ID_TO_CRM_STAGE[stage as LeadStageId] ?? stage) as CrmLeadStage
}

/** Легаси LeadStage → id стадии backend для PATCH /leads/:id/stage. */
export function stageCrmToV2(stage: string): string {
  return CRM_STAGE_TO_POKER_ID[stage] ?? stage
}

const PRODUCT_V2_TO_CRM: Record<LeadProductTypeV2, ProductType> = {
  sales: ProductType.SALES,
  network: ProductType.NETWORK,
  owner: ProductType.OWNER,
  agent: ProductType.AGENT,
}

export function mapProductTypeV2ToCrm(productType: LeadProductTypeV2 | null): ProductType {
  // `null` (generic-лид без productType) практически не встречается на
  // экранах, которые ведут в LeadViewModal (карточный стол всегда создаёт
  // лид с productType) — SALES здесь честный дефолт, не выдумка данных.
  return productType ? PRODUCT_V2_TO_CRM[productType] : ProductType.SALES
}

const CRM_TO_PRODUCT_V2: Record<ProductType, LeadProductTypeV2> = {
  [ProductType.SALES]: 'sales',
  [ProductType.NETWORK]: 'network',
  [ProductType.OWNER]: 'owner',
  [ProductType.AGENT]: 'agent',
}

/** `[phase 4]` Обратное к mapProductTypeV2ToCrm — нужно там, где форма создания лида (LeadsBlock) отдаёт легаси ProductType, а POST /leads принимает LeadProductTypeV2. */
export function mapProductTypeCrmToV2(productType: ProductType): LeadProductTypeV2 {
  return CRM_TO_PRODUCT_V2[productType]
}

/**
 * Честные пробелы этого адаптера (тот же класс, что в lead-v2-poker-adapter.ts):
 *  - `createdBy` → '' — LeadV2 не отдаёт identity создателя, только
 *    ownerPositionId текущего владельца.
 *  - `history` → [] — LeadViewModal не читает `lead.history` напрямую
 *    (грепом подтверждено), историю он загружает отдельно через
 *    leadsApiV2.listEvents.
 *  - `updatedAt` → createdAt — CrmLeadReadModel не хранит updatedAt
 *    отдельно от createdAt.
 *  - `extractPropertyType`/`extractDealType` в LeadViewModal парсят легаси
 *    `source` вида "Тип сделки - Тип объекта"; LeadV2.source — структурный
 *    объект `{route, publicationId, utm, referrer}` из маркетплейса, этот
 *    формат не имеет отношения к легаси-строке. Для лидов нового backend
 *    эти поля покажут «Не указано» — честно, не выдумано.
 *  - `roles`/`aiSummary` → не заполняются: LeadViewModal сам подставляет
 *    demo-fallback для roles, когда поле не пришло (см. код компонента).
 */
export function mapLeadV2ToCrmLead(lead: LeadV2): CrmLead {
  const mapped = {
    _id: lead.id,
    name: lead.contact?.name ?? '',
    phone: lead.contact?.phone ?? '',
    email: lead.contact?.email,
    city: lead.city ?? undefined,
    stage: stageV2ToCrm(lead.stage),
    productType: mapProductTypeV2ToCrm(lead.productType),
    realtorStage: lead.realtorStage ? (lead.realtorStage as unknown as CrmLeadStage) : undefined,
    curatorStage: lead.curatorStage ? (lead.curatorStage as unknown as CrmLeadStage) : undefined,
    assignedTo: lead.ownerPositionId ?? '',
    createdBy: '',
    source: undefined,
    notes: lead.notes ?? undefined,
    rejectionReason: lead.rejectionReason ? (lead.rejectionReason as unknown as RejectionReason) : undefined,
    rejectionComment: lead.rejectionComment ?? undefined,
    history: [],
    dealValue: lead.dealValue ?? 0,
    expectedCloseDate: lead.expectedCloseDate ?? undefined,
    budgetValue: lead.budgetValue ?? undefined,
    budgetCurrency: lead.budgetCurrency ? (lead.budgetCurrency as unknown as BudgetCurrency) : undefined,
    tags: lead.tags,
    files: undefined,
    createdAt: lead.createdAt,
    updatedAt: lead.createdAt,
    roles: undefined,
    aiSummary: undefined,
    // Не в интерфейсе легаси Lead — LeadViewModal читает его через `(displayLead as any).telegram`.
    telegram: lead.telegram ?? undefined,
    // `[phase 4]` Тоже не в интерфейсе легаси Lead — нужен LeadsBlock
    // как expectedVersion для CAS в leadsApiV2.changeStage/update (лиды там
    // читаются из общего списка, не из отдельного getById с явным version,
    // как в LeadViewModal), читается через `(lead as any).version`.
    version: lead.version,
  }
  return mapped as unknown as CrmLead
}

/**
 * Адаптер: LeadEventV2 (переходы стадии, GET /leads/:id/events) → легаси
 * `LeadHistory`, которым уже умеет рисоваться история в LeadViewModal.
 *
 * `events` обязаны быть отсортированы по убыванию времени (так их и отдаёт
 * backend, см. LeadEventRepository.listForLead: `sort({_id:-1})`) — функция
 * восстанавливает `fromStage` каждого перехода как `stage` СЛЕДУЮЩЕГО
 * (более раннего) события в списке. Для самого раннего известного события
 * `fromStage` неизвестен — используется значение, заведомо отличное от
 * `toStage`, чтобы это осталось "реальным переходом" для рендера
 * (LeadViewModal сравнивает fromStage!==toStage, сам fromStage не рисует).
 *
 * `userName`/`userRole` не резолвятся в человекочитаемое имя (у события есть
 * только `positionId`, разрешение в имя — отдельный join на реестр команды,
 * вне контракта этой задачи) — LeadViewModal их не рендерит для этого
 * экрана (грепом подтверждено), пустая строка ничего не ломает.
 */
export function mapLeadEventsV2ToLegacyHistory(events: LeadEventV2[]): Array<{
  fromStage: CrmLeadStage
  toStage: CrmLeadStage
  changedAt: string
  changedBy: string
  userName: string
  userRole: string
  comment?: string
}> {
  return events.map((event, index) => {
    const previous = events[index + 1]
    const toStage = stageV2ToCrm(event.stage)
    const fromStage = previous ? stageV2ToCrm(previous.stage) : `${toStage}__unknown_previous`
    return {
      fromStage: fromStage as unknown as CrmLeadStage,
      toStage,
      changedAt: event.changedAt,
      changedBy: event.changedBy.positionId ?? 'system',
      userName: '',
      userRole: '',
      comment: event.comment ?? undefined,
    }
  })
}

/** stage (строка backend) → последний известный комментарий к переходу в этот stage (события отсортированы по убыванию времени, первое совпадение — самое свежее). */
export function buildStageCommentsMap(events: LeadEventV2[]): Map<CrmLeadStage, string> {
  const map = new Map<CrmLeadStage, string>()
  for (const event of events) {
    const stage = stageV2ToCrm(event.stage)
    if (event.comment && !map.has(stage)) {
      map.set(stage, event.comment)
    }
  }
  return map
}
