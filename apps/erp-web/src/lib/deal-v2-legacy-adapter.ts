import type { Deal, DealChecklistItem, DealParticipant, DealStage } from '@/types/deals'
import type { DealParticipantV2, DealV2 } from '@/types/dealsV2'

/**
 * Адаптер: DealV2 (apps/api, /api/v1/deals/*) → легаси `Deal`
 * (types/deals.ts), которым продолжает оперировать вёрстка
 * DealsKanbanPage/DealCardPage/DealsReportPage/финансовых панелей (не
 * меняется — меняется только источник данных). Тот же принцип, что
 * lead-v2-legacy-adapter.ts::mapLeadV2ToCrmLead.
 *
 * `managerNameById` — резолвинг имени владельца сделки: DealV2 отдаёт
 * только `ownerPositionId` (opaque id), backend не денормализует имя.
 * Строится один раз через `teamApi.list()` (тот же приём, что
 * LeadsContext.fetchLeads строит `leadManagers`) — НЕ отдельный запрос на
 * каждую сделку.
 *
 * Честные пробелы этого адаптера (backend Deal не хранит эти поля вовсе —
 * не выдумываются, не подставляются фиктивные данные):
 *  - `propertyAddress`/`propertyType` — на Deal нет связи с
 *    PropertyAsset/Listing (ни поля, ни поиска по leadId → listing).
 *    Плейсхолдер `'Не указано в CRM'` вместо реального адреса/типа объекта.
 *  - `price` (полная цена объекта) — на Deal есть только
 *    `expectedCommission` (комиссия агентства), самой цены объекта
 *    backend не хранит. 0 — честный ноль, не оценка "комиссия / ставка".
 *    Экраны, которые считают % ставки от price (DealCardPage финансы),
 *    обязаны сами защититься от деления на 0 (см. правку в DealCardPage).
 *  - `lawyerTaskCreated` — авто-триггер "создать задачу юристу при выходе
 *    на задаток" был чисто mock-поведением (setTimeout+alert в
 *    DealsKanbanPage), на backend нет такого события. Всегда `undefined`.
 *  - `nextAction`/`nextActionDate` — нет аналога на Deal.
 *  - `payments`/`settlements` (график платежей, взаиморасчёты с
 *    партнёрами) — нет аналога на Deal. `undefined` — экраны уже
 *    рендерят эти блоки условно (`deal.payments && deal.payments.length > 0`),
 *    поэтому просто не показываются, без правок вёрстки.
 *  - `DealChecklistItem.required` — backend checklist (`checklistItems`)
 *    не различает обязательные/необязательные пункты, только
 *    `id/label/done`. Всегда `false` — бейдж "Обязательно" никогда не
 *    покажется для сделок из backend, честно, не выдумано.
 *  - `DealParticipant.role` — легаси тип это фиксированный union
 *    ('agent'|'lawyer'|'rop'|'buyer'|'seller'), backend хранит свободную
 *    строку (см. AddDealParticipantDto.role). Прокидывается как есть через
 *    приведение типа — экран уже занижает нераспознанную роль к "РОП" в
 *    своём switch (существовавшее поведение, не трогается здесь).
 *  - `notes` — реальный аналог ЕСТЬ: `description` на Deal — тот же
 *    принцип свободного текста, поэтому не пробел, а прямое соответствие.
 */
export function mapDealV2ToLegacy(deal: DealV2, managerNameById: Map<string, string>): Deal {
  const commission = deal.expectedCommission ? deal.expectedCommission.amountMinorUnits / 100 : 0

  const participants: DealParticipant[] = deal.participants.map((p: DealParticipantV2) => ({
    role: p.role as unknown as DealParticipant['role'],
    name: p.contact?.name ?? p.contactId,
    userId: p.contactId,
  }))

  const checklist: DealChecklistItem[] = deal.checklistItems.map((item) => ({
    id: item.id,
    label: item.label,
    done: item.done,
    required: false,
  }))

  return {
    id: deal.id,
    sourceLeadId: deal.leadId ?? undefined,
    // Тип хранит backend (dealType); у старых сделок без поля — вторичка.
    type: deal.dealType ?? 'secondary',
    stage: deal.stage as unknown as DealStage,
    clientId: deal.contactId,
    clientName: deal.contact?.name ?? '',
    propertyAddress: 'Не указано в CRM',
    propertyType: 'Не указано в CRM',
    agentId: deal.ownerPositionId,
    agentName: managerNameById.get(deal.ownerPositionId) ?? 'Не назначен',
    participants,
    price: 0,
    commission,
    commissionReceived:
      deal.commissionReceived && deal.commissionReceivedAt
        ? {
            amount: deal.commissionReceived.amountMinorUnits / 100,
            currency: deal.commissionReceived.currency,
            receivedAt: deal.commissionReceivedAt,
          }
        : undefined,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    checklist,
    lawyerTaskCreated: undefined,
    notes: deal.description ?? undefined,
    nextAction: undefined,
    nextActionDate: undefined,
    payments: undefined,
    settlements: undefined,
  }
}

/** `expectedVersion` для CAS-мутаций сделки (см. dealsApiV2.changeStage/updateChecklist/...). НЕ часть легаси `Deal` (там нет version) — служебная карта leadId→version, тот же приём, что LeadsContext.leadVersions. */
export function buildDealVersionMap(deals: DealV2[]): Record<string, number> {
  return Object.fromEntries(deals.map((d) => [d.id, d.version]))
}
