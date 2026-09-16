/**
 * Типы для модуля Сделки.
 *
 * `DealStage` синхронизирован с backend-источником истины
 * (apps/api/src/modules/crm/deal-stage.ts::DEAL_STAGES) — до перехода на
 * dealsApiV2 (см. lib/deal-v2-legacy-adapter.ts) здесь была mock-стадия
 * `new_deals` ("выявление потребности о новых сделках"), у которой на
 * реальном Deal-агрегате бэкенда никогда не было аналога — это была
 * стадия ИЗ ВОРОНКИ ЛИДА продукта `sales` (см. lead-stage-definitions.ts),
 * случайно совпадающая по первым 6 id со стадиями сделки. Настоящая 7-я
 * стадия сделки на backend — `closed_lost` (терминальный провал, доступен
 * из любой активной стадии), у которого не было легаси-аналога вовсе
 * (mock никогда не моделировал "сделка сорвалась"). Заменено на честную
 * стадию backend вместо придуманной.
 */
export type DealStage =
  | 'showing'      // Показ
  | 'deposit'      // Задаток получен
  | 'deal'         // Заключен договор
  | 'golden'       // Золотой фонд
  | 'check_in'     // Узнал как дела
  | 'referral'     // Взять рекомендацию
  | 'closed_lost'  // Сделка сорвалась

/** Первичка, вторичка, аренда, переуступка — то же, что DealTypeV2 на backend. */
export type DealType = 'primary' | 'secondary' | 'rental' | 'assignment'

export interface DealParticipant {
  role: 'agent' | 'lawyer' | 'rop' | 'buyer' | 'seller'
  name: string
  userId?: string
}

export interface DealChecklistItem {
  id: string
  label: string
  done: boolean
  required: boolean
}

export type PaymentStatus = 'pending' | 'paid' | 'overdue'

/** Один платёж в графике оплаты сделки */
export interface DealPayment {
  id: string
  label: string
  amount: number
  dueDate: string
  status: PaymentStatus
}

/** Взаиморасчёт с партнёром (реферал, посредник, соагент) по сделке */
export interface DealSettlement {
  id: string
  partnerName: string
  /** Роль партнёра в расчётах: кто передал клиента / с кем делится комиссия */
  role: 'referral_partner' | 'broker' | 'co_agent'
  amount: number
  status: PaymentStatus
}

export interface Deal {
  id: string
  /** Связанный лид (если сделка создана из лида) */
  sourceLeadId?: string
  type: DealType
  stage: DealStage
  /** Клиент */
  clientId: string
  clientName: string
  /** Объект */
  propertyAddress: string
  propertyType: string
  /** Ответственный агент */
  agentId: string
  agentName: string
  /** Участники */
  participants: DealParticipant[]
  /** Сумма сделки */
  price: number
  /** Комиссия агентства */
  commission: number
  /** Комиссия, которая фактически пришла BAZA (отметка менеджера BAZA). Нет — ещё не пришла. */
  commissionReceived?: { amount: number; currency: string; receivedAt: string }
  /** Дата создания */
  createdAt: string
  /** Дата последнего обновления */
  updatedAt: string
  /** Чеклист для текущего этапа */
  checklist: DealChecklistItem[]
  /** Автозадача юристу создана */
  lawyerTaskCreated?: boolean
  notes?: string
  /** Ближайшее действие по сделке — что и когда нужно сделать дальше */
  nextAction?: string
  nextActionDate?: string
  /** График платежей по сделке */
  payments?: DealPayment[]
  /** Взаиморасчёты с партнёрами (рефералы, посредники, соагенты) */
  settlements?: DealSettlement[]
}

export const STAGE_LABELS: Record<DealStage, string> = {
  showing:     'Показ',
  deposit:     'Задаток получен',
  deal:        'Заключен договор',
  golden:      'Золотой фонд',
  check_in:    'Узнал как дела',
  referral:    'Взять рекомендацию',
  closed_lost: 'Сделка сорвалась',
}

export const STAGE_ORDER: DealStage[] = [
  'showing',
  'deposit',
  'deal',
  'golden',
  'check_in',
  'referral',
  'closed_lost',
]

/** Пост-продажный цикл удержания клиента (сделка уже успешна). `closed_lost` сюда НЕ входит — это провал, а не продолжение работы с довольным клиентом. */
export const POST_SALE_STAGES: readonly DealStage[] = [
  'golden',
  'check_in',
  'referral',
]

export const SUCCESS_DEAL_STAGES: readonly DealStage[] = [
  'deal',
  ...POST_SALE_STAGES,
]

export const SUCCESS_DEAL_STAGE_SET = new Set<DealStage>(SUCCESS_DEAL_STAGES)
