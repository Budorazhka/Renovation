import type { Lead as PokerLead, LeadSource, LeadStageId } from '@/types/leads'
import type { LeadProductTypeV2, LeadV2 } from '@/types/leadsV2'

/**
 * Адаптер: LeadV2 (apps/api, /api/v1/leads/*) → PokerLead (карточный стол,
 * apps/erp-web/src/components/leads/LeadsCardTableView.tsx). Аналог
 * mapCrmLeadToPoker в crm-poker-adapter.ts, но источник — новый backend, не
 * легаси api-crm.baza.sale.
 */

/**
 * Значения ТЕ ЖЕ, что CRM_PRODUCT_TO_POKER_SOURCE/POKER_SOURCE_TO_CRM_PRODUCT
 * в crm-poker-adapter.ts (sales↔primary, network↔secondary, owner↔rent,
 * agent↔ad_campaigns) — переобъявлены здесь, а не импортированы оттуда:
 * легаси-таблицы типизированы TS-enum'ом `ProductType`, member которого не
 * структурно совместим с plain string union LeadProductTypeV2 без явного
 * каста (nominal enum typing). Сама таксономия не меняется, дублируется
 * только объявление объекта.
 */
export const POKER_SOURCE_TO_PRODUCT_V2: Record<LeadSource, LeadProductTypeV2> = {
  primary: 'sales',
  secondary: 'network',
  rent: 'owner',
  ad_campaigns: 'agent',
}

export const PRODUCT_V2_TO_POKER_SOURCE: Record<LeadProductTypeV2, LeadSource> = {
  sales: 'primary',
  network: 'secondary',
  owner: 'rent',
  agent: 'ad_campaigns',
}

/**
 * poker-id → id стадии продукта на backend (apps/api/src/modules/crm/
 * lead-stage-definitions.ts::LEAD_STAGE_DEFINITIONS). Порядок и состав
 * сверены 1:1 построчно с lead-stage-definitions.ts (order:1..N на продукт)
 * и с RP_STAGES/NET_STAGES/OWNER_STAGES/AGENT_STAGES в
 * LeadsCardTableView.tsx — те же 4 массива на фронте задают порядок карт
 * покер-стола. `sales` — id backend совпадают с poker-id буквально (обе
 * таксономии выведены из одного и того же apps/erp-web/src/data/
 * leads-mock.ts::LEAD_STAGES источника), поэтому таблица — тождество.
 */
const POKER_ID_TO_LEAD_STAGE_V2: Record<LeadProductTypeV2, Record<string, string>> = {
  sales: {
    defective: 'defective',
    refused: 'refused',
    no_answer_3: 'no_answer_3',
    no_answer_2: 'no_answer_2',
    no_answer_1: 'no_answer_1',
    new: 'new',
    callback: 'callback',
    presented: 'presented',
    country_discussed: 'country_discussed',
    need_identified: 'need_identified',
    need_adjusted: 'need_adjusted',
    kp_sent: 'kp_sent',
    objections: 'objections',
    deferred: 'deferred',
    warmup: 'warmup',
    showing: 'showing',
    deposit: 'deposit',
    deal: 'deal',
    golden: 'golden',
    check_in: 'check_in',
    referral: 'referral',
    new_deals: 'new_deals',
  },
  network: {
    defective: 'network_rejected_defective',
    refused: 'network_rejected',
    no_answer_3: 'network_no_call_3',
    no_answer_2: 'network_no_call_2',
    no_answer_1: 'network_no_call_1',
    new: 'network_new_lead',
    callback: 'network_call_later',
    presented: 'network_company_presented',
    country_discussed: 'network_platform_presented',
    need_identified: 'network_offer_given',
    need_adjusted: 'network_objections',
    kp_sent: 'network_deferred_demand',
    objections: 'network_agreement',
    deferred: 'network_form_filled',
    warmup: 'network_account_registered',
    showing: 'network_offer_signed',
    deposit: 'network_work_started',
  },
  owner: {
    defective: 'owner_rejected_defective',
    refused: 'owner_rejected_owner',
    no_answer_3: 'owner_no_call_3',
    no_answer_2: 'owner_no_call_2',
    no_answer_1: 'owner_no_call_1',
    new: 'owner_new_owner',
    callback: 'owner_call_later',
    presented: 'owner_company_presented',
    country_discussed: 'owner_object_discussed',
    need_identified: 'owner_photo_proposed',
    need_adjusted: 'owner_exclusive_proposed',
    kp_sent: 'owner_objections',
    objections: 'owner_agreed',
    deferred: 'owner_active_for_sale',
    warmup: 'owner_get_referral',
    showing: 'owner_new_object_inquiry',
  },
  agent: {
    defective: 'agent_rejected_defective',
    refused: 'agent_rejected',
    no_answer_3: 'agent_no_call_3',
    no_answer_2: 'agent_no_call_2',
    no_answer_1: 'agent_no_call_1',
    new: 'agent_new_agent',
    callback: 'agent_call_later',
    presented: 'agent_company_presented',
    country_discussed: 'agent_format',
    need_identified: 'agent_objections',
    need_adjusted: 'agent_agreed',
    kp_sent: 'agent_active',
  },
}

/** Реверс-таблица: id стадии продукта на backend → poker-id. Выведена из POKER_ID_TO_LEAD_STAGE_V2 (тот же приём, что POKER_ID_TO_CRM_STAGE в crm-poker-adapter.ts). */
const LEAD_STAGE_V2_TO_POKER_ID: Record<LeadProductTypeV2, Record<string, LeadStageId>> = (
  Object.entries(POKER_ID_TO_LEAD_STAGE_V2) as [LeadProductTypeV2, Record<string, string>][]
).reduce(
  (acc, [productType, pokerToBackend]) => {
    acc[productType] = Object.entries(pokerToBackend).reduce(
      (inner, [pokerId, backendStage]) => {
        inner[backendStage] = pokerId
        return inner
      },
      {} as Record<string, LeadStageId>,
    )
    return acc
  },
  {} as Record<LeadProductTypeV2, Record<string, LeadStageId>>,
)

/** poker-id этапа воронки → id стадии на backend для productType этого лида. `null`, если у productType нет такого этапа (у network/owner/agent воронка короче, чем sales). */
export function mapPokerIdToLeadStageV2(pokerId: string, productType: LeadProductTypeV2): string | null {
  return POKER_ID_TO_LEAD_STAGE_V2[productType][pokerId] ?? null
}

/** id стадии на backend → poker-id для того же productType. Незнакомое значение (напр. лид создан вне этой воронки) возвращается как есть — рендерится в колонке in_progress по дефолту getLeadStageColumn. */
export function mapLeadStageV2ToPokerId(stage: string, productType: LeadProductTypeV2): LeadStageId {
  return LEAD_STAGE_V2_TO_POKER_ID[productType][stage] ?? stage
}

/**
 * Адаптер: LeadV2 → PokerLead.
 *
 * Честные пробелы (тот же класс, что accessProfile в CreateTeamAccountSlotDto
 * прошлых фаз — задокументированы, не подменены выдуманными данными):
 *  - `commissionUsd` → 0. У Lead на новом backend пока нет dealValue/
 *    budgetValue (это поле Deal, не Lead, в domain-model.md) — колонка
 *    комиссии на столе временно нулевая для всех V2-лидов.
 *  - `taskOverdue` → false. Новый backend не отдаёт "есть ли просроченная
 *    задача" в read-модели лида (только hasOpenNextAction — открыта ли
 *    ХОТЬ ОДНА задача, без разбора дедлайнов) — подсветка просрочки на
 *    карточке временно не работает для V2-лидов.
 *  - `actorAccountId` → не заполняется. LeadV2.ownerPositionId — id
 *    позиции, не аккаунта; кто именно сейчас её занимает, отсюда не видно
 *    без отдельного join на реестр команды (out of scope этой фазы).
 *
 * НЕ пробел: `hasTask` заполняется из `hasOpenNextAction` read-модели.
 */
export function mapLeadV2ToPoker(lead: LeadV2): PokerLead {
  const productType = lead.productType
  const source: LeadSource = productType ? PRODUCT_V2_TO_POKER_SOURCE[productType] : 'primary'
  const stageId: LeadStageId = productType ? mapLeadStageV2ToPokerId(lead.stage, productType) : lead.stage

  return {
    id: lead.id,
    source,
    stageId,
    // Легаси-поле (аккаунт-based) — заполняется значением ownerPositionId
    // для обратной совместимости мест, которые сравнивают managerId с
    // LeadManager.id (LeadsCardTableView/LeadsSecretDistributionDialog):
    // ростер leadManagers на этом экране теперь тоже строится по
    // positionId (teamApi.list()), поэтому значения совпадают.
    managerId: lead.ownerPositionId,
    ownerPositionId: lead.ownerPositionId ?? undefined,
    createdAt: lead.createdAt,
    name: lead.contact?.name,
    phone: lead.contact?.phone,
    hasTask: lead.hasOpenNextAction,
    taskOverdue: false,
    commissionUsd: 0,
    status: 'in_progress',
    tags: lead.tags ?? [],
  }
}
