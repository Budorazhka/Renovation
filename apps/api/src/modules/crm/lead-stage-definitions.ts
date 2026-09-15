/**
 * `[technical decision — 03.09.2026]`, owner decision зафиксировано в
 * задаче "продуктовые воронки лида": legacy CRM (`api-crm.baza.sale`,
 * фронтенд apps/erp-web) знает 4 продукта — `sales`/`network`/`owner`/
 * `agent` — каждый со своим набором стадий воронки. Owner прямо решил
 * сохранить эту таксономию как есть в новом backend, не сводить к пяти
 * универсальным стадиям (`lead-stage.ts::LEAD_STAGES`).
 *
 * Источник данных — ТРИ файла фронтенда, прочитанные целиком и сверенные
 * друг с другом (не изобретены заново):
 *  - `apps/erp-web/src/data/leads-mock.ts` — `LEAD_STAGES`/`LEAD_STAGE_COLUMN`
 *    для `sales` (22 стадии, русские имена и группировка по колонкам уже
 *    заданы там дословно).
 *  - `apps/erp-web/src/features/crm/services/api/types.ts` — enum `LeadStage`,
 *    полный список машинных id для `network`/`owner`/`agent` (снейк-кейс).
 *  - `apps/erp-web/src/lib/crm-poker-adapter.ts` — четыре switch в
 *    `mapPokerIdToCrmStage` задают ТОЧНЫЙ порядок стадий внутри каждого
 *    продукта (порядок кейсов = порядок прохождения воронки, тот же самый
 *    poker-id порядок, что `LEAD_STAGES` использует для `sales`) и, через
 *    маппинг poker-id → `LEAD_STAGE_COLUMN`, — колонку каждой стадии
 *    (rejection/in_progress/success).
 *
 * Русские имена для network/owner/agent сгенерированы переводом уже
 * существующего машинного snake_case-имени (`network_form_filled` →
 * "Анкета заполнена") — ни одна стадия не добавлена и не пропущена, порядок
 * и группировка выведены из crm-poker-adapter.ts, не придуманы заново.
 *
 * Количество стадий на продукт (сверено построчным подсчётом enum-блоков
 * types.ts и switch-веток crm-poker-adapter.ts): sales — 22, network — 17,
 * owner — 16, agent — 12. network/owner/agent НЕ доходят до "золотого
 * фонда" (poker-id golden/check_in/referral/new_deals не замаплены ни в
 * одном из трёх switch) — их последняя стадия эквивалентна sales-стадии
 * `deposit`/`showing`/`kp_sent` соответственно (см. column ниже, у всех
 * трёх продуктов колонка `success` отсутствует вовсе).
 */
export const PRODUCT_TYPES = ['sales', 'network', 'owner', 'agent'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export type LeadFunnelColumn = 'rejection' | 'in_progress' | 'success';

export interface LeadStageDefinition {
  id: string;
  name: string;
  order: number;
  column: LeadFunnelColumn;
}

export const LEAD_STAGE_DEFINITIONS: Record<ProductType, LeadStageDefinition[]> = {
  sales: [
    { id: 'defective', name: 'Бракованный лид', order: 1, column: 'rejection' },
    { id: 'refused', name: 'Отказ', order: 2, column: 'rejection' },
    { id: 'no_answer_3', name: 'Недозвонился 3', order: 3, column: 'rejection' },
    { id: 'no_answer_2', name: 'Недозвонился 2', order: 4, column: 'rejection' },
    { id: 'no_answer_1', name: 'Недозвонился 1', order: 5, column: 'rejection' },
    { id: 'new', name: 'Новый лид', order: 6, column: 'in_progress' },
    { id: 'callback', name: 'Попросил связаться позже', order: 7, column: 'in_progress' },
    { id: 'presented', name: 'Презентовали компанию', order: 8, column: 'in_progress' },
    { id: 'country_discussed', name: 'Обсудили ситуацию в стране', order: 9, column: 'in_progress' },
    { id: 'need_identified', name: 'Выявлена потребность', order: 10, column: 'in_progress' },
    { id: 'need_adjusted', name: 'Потребность скорректирована', order: 11, column: 'in_progress' },
    { id: 'kp_sent', name: 'Отправлено КП', order: 12, column: 'in_progress' },
    { id: 'objections', name: 'Отработка возражений', order: 13, column: 'in_progress' },
    { id: 'deferred', name: 'Отложенный спрос', order: 14, column: 'in_progress' },
    { id: 'warmup', name: 'Прогрев', order: 15, column: 'in_progress' },
    { id: 'showing', name: 'Показ', order: 16, column: 'in_progress' },
    { id: 'deposit', name: 'Задаток получен', order: 17, column: 'in_progress' },
    { id: 'deal', name: 'Заключен договор', order: 18, column: 'in_progress' },
    { id: 'golden', name: 'Золотой фонд', order: 19, column: 'success' },
    { id: 'check_in', name: 'Узнал как дела', order: 20, column: 'success' },
    { id: 'referral', name: 'Взять рекомендацию', order: 21, column: 'success' },
    { id: 'new_deals', name: 'Выявление потребности о новых сделках', order: 22, column: 'success' },
  ],
  network: [
    { id: 'network_rejected_defective', name: 'Бракованный лид', order: 1, column: 'rejection' },
    { id: 'network_rejected', name: 'Отказ', order: 2, column: 'rejection' },
    { id: 'network_no_call_3', name: 'Недозвонился 3', order: 3, column: 'rejection' },
    { id: 'network_no_call_2', name: 'Недозвонился 2', order: 4, column: 'rejection' },
    { id: 'network_no_call_1', name: 'Недозвонился 1', order: 5, column: 'rejection' },
    { id: 'network_new_lead', name: 'Новый лид', order: 6, column: 'in_progress' },
    { id: 'network_call_later', name: 'Попросил перезвонить позже', order: 7, column: 'in_progress' },
    { id: 'network_company_presented', name: 'Презентовали компанию', order: 8, column: 'in_progress' },
    { id: 'network_platform_presented', name: 'Презентовали платформу', order: 9, column: 'in_progress' },
    { id: 'network_offer_given', name: 'Предложение сделано', order: 10, column: 'in_progress' },
    { id: 'network_objections', name: 'Отработка возражений', order: 11, column: 'in_progress' },
    { id: 'network_deferred_demand', name: 'Отложенный спрос', order: 12, column: 'in_progress' },
    { id: 'network_agreement', name: 'Согласие получено', order: 13, column: 'in_progress' },
    { id: 'network_form_filled', name: 'Анкета заполнена', order: 14, column: 'in_progress' },
    { id: 'network_account_registered', name: 'Аккаунт зарегистрирован', order: 15, column: 'in_progress' },
    { id: 'network_offer_signed', name: 'Оферта подписана', order: 16, column: 'in_progress' },
    { id: 'network_work_started', name: 'Начал работу', order: 17, column: 'in_progress' },
  ],
  owner: [
    { id: 'owner_rejected_defective', name: 'Бракованный лид', order: 1, column: 'rejection' },
    { id: 'owner_rejected_owner', name: 'Отказ собственника', order: 2, column: 'rejection' },
    { id: 'owner_no_call_3', name: 'Недозвонился 3', order: 3, column: 'rejection' },
    { id: 'owner_no_call_2', name: 'Недозвонился 2', order: 4, column: 'rejection' },
    { id: 'owner_no_call_1', name: 'Недозвонился 1', order: 5, column: 'rejection' },
    { id: 'owner_new_owner', name: 'Новый собственник', order: 6, column: 'in_progress' },
    { id: 'owner_call_later', name: 'Попросил перезвонить позже', order: 7, column: 'in_progress' },
    { id: 'owner_company_presented', name: 'Презентовали компанию', order: 8, column: 'in_progress' },
    { id: 'owner_object_discussed', name: 'Обсудили объект', order: 9, column: 'in_progress' },
    { id: 'owner_photo_proposed', name: 'Предложили сделать фото', order: 10, column: 'in_progress' },
    { id: 'owner_exclusive_proposed', name: 'Предложили эксклюзив', order: 11, column: 'in_progress' },
    { id: 'owner_objections', name: 'Отработка возражений', order: 12, column: 'in_progress' },
    { id: 'owner_agreed', name: 'Согласие получено', order: 13, column: 'in_progress' },
    { id: 'owner_active_for_sale', name: 'Объект выставлен на продажу', order: 14, column: 'in_progress' },
    { id: 'owner_get_referral', name: 'Взять рекомендацию', order: 15, column: 'in_progress' },
    { id: 'owner_new_object_inquiry', name: 'Запрос по новому объекту', order: 16, column: 'in_progress' },
  ],
  agent: [
    { id: 'agent_rejected_defective', name: 'Бракованный лид', order: 1, column: 'rejection' },
    { id: 'agent_rejected', name: 'Отказ', order: 2, column: 'rejection' },
    { id: 'agent_no_call_3', name: 'Недозвонился 3', order: 3, column: 'rejection' },
    { id: 'agent_no_call_2', name: 'Недозвонился 2', order: 4, column: 'rejection' },
    { id: 'agent_no_call_1', name: 'Недозвонился 1', order: 5, column: 'rejection' },
    { id: 'agent_new_agent', name: 'Новый агент', order: 6, column: 'in_progress' },
    { id: 'agent_call_later', name: 'Попросил перезвонить позже', order: 7, column: 'in_progress' },
    { id: 'agent_company_presented', name: 'Презентовали компанию', order: 8, column: 'in_progress' },
    { id: 'agent_format', name: 'Обсудили формат сотрудничества', order: 9, column: 'in_progress' },
    { id: 'agent_objections', name: 'Отработка возражений', order: 10, column: 'in_progress' },
    { id: 'agent_agreed', name: 'Согласие получено', order: 11, column: 'in_progress' },
    { id: 'agent_active', name: 'Активный агент', order: 12, column: 'in_progress' },
  ],
};

/** Все id стадий продукта, в порядке воронки — используется валидацией changeLeadStage. */
export function stageIdsForProduct(productType: ProductType): string[] {
  return LEAD_STAGE_DEFINITIONS[productType].map((stage) => stage.id);
}

/**
 * Стадия успеха каждой воронки (owner decision 15.09.2026): лид,
 * дошедший до неё или дальше по воронке, считается сконвертированным в
 * отчётах. У продаж это «Золотой фонд» (вся колонка `success`), у
 * остальных продуктов колонки `success` нет — успех назван владельцем.
 */
export const CONVERSION_STAGE_BY_PRODUCT: Record<ProductType, string> = {
  sales: 'golden',
  network: 'network_work_started',
  owner: 'owner_active_for_sale',
  agent: 'agent_active',
};

/**
 * Итог лида для отчётов по стадии: стадия успеха продукта и всё, что
 * после неё по воронке, — сконвертирован; колонка `rejection` — потерян;
 * плюс generic `converted`/`lost`. id стадий уникальны между продуктами
 * (у sales без префикса, у остальных с префиксом продукта), поэтому
 * productType для разбора не нужен.
 */
const LEAD_STAGE_OUTCOMES: ReadonlyMap<string, 'converted' | 'lost'> = new Map<string, 'converted' | 'lost'>([
  ['converted', 'converted'],
  ['lost', 'lost'],
  ...PRODUCT_TYPES.flatMap((productType) => {
    const stages = LEAD_STAGE_DEFINITIONS[productType];
    const conversionOrder = stages.find((stage) => stage.id === CONVERSION_STAGE_BY_PRODUCT[productType])!.order;
    return stages.flatMap((stage): Array<[string, 'converted' | 'lost']> => {
      if (stage.column === 'rejection') return [[stage.id, 'lost']];
      if (stage.order >= conversionOrder) return [[stage.id, 'converted']];
      return [];
    });
  }),
]);

export function leadStageOutcome(stage: string): 'converted' | 'lost' | null {
  return LEAD_STAGE_OUTCOMES.get(stage) ?? null;
}

/**
 * Стартовая стадия нового лида с этим productType — первая стадия колонки
 * `in_progress`, НЕ `[0]` массива. `[0]` в исходной легаси-таксономии — это
 * стадии колонки `rejection` (`defective`/`refused` и их аналоги у трёх
 * остальных продуктов, см. LEAD_STAGE_DEFINITIONS выше): порядок массива
 * идёт rejection → in_progress → success, а не по смыслу "с чего лид
 * начинается". Найдено 03.09.2026 при внешнем ревью — до этой правки
 * POST /leads с productType заводил лид сразу как "Бракованный лид".
 */
export function firstStageIdForProduct(productType: ProductType): string {
  const firstInProgress = LEAD_STAGE_DEFINITIONS[productType].find((stage) => stage.column === 'in_progress');
  return (firstInProgress ?? LEAD_STAGE_DEFINITIONS[productType][0]!).id;
}
