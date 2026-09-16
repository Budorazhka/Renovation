/**
 * Адаптер DealV2 → легаси Deal (DealsKanbanPage/DealCardPage/отчёты).
 * Проверяется прямой маппинг и честные пробелы формы — см. докстринг
 * lib/deal-v2-legacy-adapter.ts.
 */

import { describe, expect, it } from 'vitest'
import { buildDealVersionMap, mapDealV2ToLegacy } from '@/lib/deal-v2-legacy-adapter'
import type { DealV2 } from '@/types/dealsV2'

function makeDeal(overrides: Partial<DealV2> = {}): DealV2 {
  return {
    id: 'deal-1',
    organizationId: 'org-1',
    leadId: null,
    contactId: 'c-1',
    ownerPositionId: 'pos-1',
    title: 'Сделка с клиентом',
    description: null,
    stage: 'showing',
    expectedCommission: null,
    commissionReceived: null,
    commissionReceivedAt: null,
    dealType: 'secondary',
    participants: [],
    checklistItems: [],
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    contact: null,
    ...overrides,
  }
}

describe('deal-v2-legacy-adapter', () => {
  it('мапит прямые поля: id, sourceLeadId, stage, clientId/clientName, agentId', () => {
    const managerNameById = new Map([['pos-1', 'Анна Первичкина']])
    const deal = makeDeal({
      leadId: 'lead-9',
      contact: { id: 'c-1', name: 'Иванов А.В.', phone: '+79990000000' },
    })

    const legacy = mapDealV2ToLegacy(deal, managerNameById)

    expect(legacy.id).toBe('deal-1')
    expect(legacy.sourceLeadId).toBe('lead-9')
    expect(legacy.stage).toBe('showing')
    expect(legacy.clientId).toBe('c-1')
    expect(legacy.clientName).toBe('Иванов А.В.')
    expect(legacy.agentId).toBe('pos-1')
  })

  it('резолвит agentName через переданный ростер менеджеров (teamApi.list), не делает отдельного запроса', () => {
    const managerNameById = new Map([['pos-1', 'Анна Первичкина']])
    const legacy = mapDealV2ToLegacy(makeDeal({ ownerPositionId: 'pos-1' }), managerNameById)
    expect(legacy.agentName).toBe('Анна Первичкина')
  })

  it('agentName — честный дефолт "Не назначен", если позиции нет в ростере', () => {
    const legacy = mapDealV2ToLegacy(makeDeal({ ownerPositionId: 'pos-unknown' }), new Map())
    expect(legacy.agentName).toBe('Не назначен')
  })

  it('commission — переводит MoneyAmount.amountMinorUnits в мажорные единицы', () => {
    const legacy = mapDealV2ToLegacy(
      makeDeal({ expectedCommission: { amountMinorUnits: 25600000, currency: 'USD' } }),
      new Map(),
    )
    expect(legacy.commission).toBe(256000)
  })

  it('commission — 0, если expectedCommission не задан (не выдумывается)', () => {
    const legacy = mapDealV2ToLegacy(makeDeal({ expectedCommission: null }), new Map())
    expect(legacy.commission).toBe(0)
  })

  it('type — прямо из dealType backend: от него зависит начисление куратору', () => {
    expect(mapDealV2ToLegacy(makeDeal(), new Map()).type).toBe('secondary')
    expect(mapDealV2ToLegacy(makeDeal({ dealType: 'primary' }), new Map()).type).toBe('primary')
    expect(mapDealV2ToLegacy(makeDeal({ dealType: 'assignment' }), new Map()).type).toBe('assignment')
  })

  it('честные пробелы: propertyAddress/propertyType — плейсхолдер, price — 0', () => {
    const legacy = mapDealV2ToLegacy(makeDeal(), new Map())
    expect(legacy.propertyAddress).toBe('Не указано в CRM')
    expect(legacy.propertyType).toBe('Не указано в CRM')
    expect(legacy.price).toBe(0)
  })

  it('честные пробелы: lawyerTaskCreated/nextAction/payments/settlements не заполняются', () => {
    const legacy = mapDealV2ToLegacy(makeDeal(), new Map())
    expect(legacy.lawyerTaskCreated).toBeUndefined()
    expect(legacy.nextAction).toBeUndefined()
    expect(legacy.nextActionDate).toBeUndefined()
    expect(legacy.payments).toBeUndefined()
    expect(legacy.settlements).toBeUndefined()
  })

  it('notes — прямое соответствие description (не пробел, реальное поле backend)', () => {
    const legacy = mapDealV2ToLegacy(makeDeal({ description: 'Показ на 24.03 в 19:00' }), new Map())
    expect(legacy.notes).toBe('Показ на 24.03 в 19:00')
  })

  it('checklist — маппит id/label/done, required всегда false (backend не различает обязательность)', () => {
    const legacy = mapDealV2ToLegacy(
      makeDeal({
        checklistItems: [
          { id: 'i1', label: 'Пункт 1', done: true, completedAt: '2026-09-01T00:00:00.000Z', completedByPositionId: 'pos-1' },
        ],
      }),
      new Map(),
    )
    expect(legacy.checklist).toEqual([{ id: 'i1', label: 'Пункт 1', done: true, required: false }])
  })

  it('participants — маппит role/contact.name/contactId, роль передаётся как есть (свободная строка backend)', () => {
    const legacy = mapDealV2ToLegacy(
      makeDeal({
        participants: [
          { role: 'lawyer', contactId: 'c-2', contact: { id: 'c-2', name: 'Ирина Правова', phone: '+70000000000' } },
        ],
      }),
      new Map(),
    )
    expect(legacy.participants).toEqual([{ role: 'lawyer', name: 'Ирина Правова', userId: 'c-2' }])
  })

  it('participants — при отсутствии контакта имя фолбэчит на contactId', () => {
    const legacy = mapDealV2ToLegacy(
      makeDeal({ participants: [{ role: 'buyer', contactId: 'c-3', contact: null }] }),
      new Map(),
    )
    expect(legacy.participants[0]?.name).toBe('c-3')
  })

  it('buildDealVersionMap — строит карту dealId → version для CAS', () => {
    const map = buildDealVersionMap([makeDeal({ id: 'deal-1', version: 3 }), makeDeal({ id: 'deal-2', version: 0 })])
    expect(map).toEqual({ 'deal-1': 3, 'deal-2': 0 })
  })
})
