/**
 * Адаптер LeadV2 → легаси Lead/LeadHistory (LeadViewModal.tsx). Проверяется
 * маппинг стадии/продукта/сопутствующих полей и восстановление fromStage из
 * последовательности событий — см. докстринг lib/lead-v2-legacy-adapter.ts.
 */

import { describe, expect, it } from 'vitest'
import { ProductType } from '@/features/crm/services/api/types'
import {
  buildStageCommentsMap,
  mapLeadEventsV2ToLegacyHistory,
  mapLeadV2ToCrmLead,
  mapProductTypeCrmToV2,
  mapProductTypeV2ToCrm,
  stageCrmToV2,
  stageV2ToCrm,
} from '@/lib/lead-v2-legacy-adapter'
import type { LeadEventV2, LeadV2 } from '@/types/leadsV2'

function makeLead(overrides: Partial<LeadV2> = {}): LeadV2 {
  return {
    id: 'lead-1',
    organizationId: 'org-1',
    ownerPositionId: null,
    productType: 'sales',
    stage: 'new',
    version: 3,
    source: { route: 'manual' },
    createdAt: '2026-09-01T00:00:00.000Z',
    contact: null,
    hasOpenNextAction: false,
    stalled: false,
    ...overrides,
  }
}

describe('lead-v2-legacy-adapter', () => {
  it('mapProductTypeV2ToCrm — переводит строки в легаси-enum, null → SALES (честный дефолт)', () => {
    expect(mapProductTypeV2ToCrm('sales')).toBe(ProductType.SALES)
    expect(mapProductTypeV2ToCrm('network')).toBe(ProductType.NETWORK)
    expect(mapProductTypeV2ToCrm('owner')).toBe(ProductType.OWNER)
    expect(mapProductTypeV2ToCrm('agent')).toBe(ProductType.AGENT)
    expect(mapProductTypeV2ToCrm(null)).toBe(ProductType.SALES)
  })

  it('mapLeadV2ToCrmLead — маппит контакт, стадию, сопутствующие поля', () => {
    const lead = makeLead({
      contact: { id: 'c-1', name: 'Иван Иванов', phone: '+79990000000', email: 'ivan@example.com' },
      city: 'Тбилиси',
      notes: 'звонить после обеда',
      dealValue: 15000,
      budgetValue: 20000,
      budgetCurrency: 'USD',
      telegram: '@ivan',
      realtorStage: 'realtor_2',
      curatorStage: null,
      ownerPositionId: 'pos-7',
      productType: 'network',
      stage: 'network_call_later',
    })

    const crmLead = mapLeadV2ToCrmLead(lead)

    expect(crmLead._id).toBe('lead-1')
    expect(crmLead.name).toBe('Иван Иванов')
    expect(crmLead.phone).toBe('+79990000000')
    expect(crmLead.email).toBe('ivan@example.com')
    expect(crmLead.city).toBe('Тбилиси')
    expect(crmLead.notes).toBe('звонить после обеда')
    expect(crmLead.dealValue).toBe(15000)
    expect(crmLead.budgetValue).toBe(20000)
    expect(crmLead.budgetCurrency).toBe('USD')
    expect((crmLead as any).telegram).toBe('@ivan')
    expect(crmLead.realtorStage).toBe('realtor_2')
    expect(crmLead.curatorStage).toBeUndefined()
    expect(crmLead.assignedTo).toBe('pos-7')
    expect(crmLead.productType).toBe(ProductType.NETWORK)
    expect(crmLead.stage).toBe('network_call_later')
  })

  it('mapLeadV2ToCrmLead — честные пробелы: history пуста, dealValue дефолтится в 0, createdBy пуст', () => {
    const crmLead = mapLeadV2ToCrmLead(makeLead({ dealValue: undefined }))
    expect(crmLead.history).toEqual([])
    expect(crmLead.dealValue).toBe(0)
    expect(crmLead.createdBy).toBe('')
    expect(crmLead.updatedAt).toBe(crmLead.createdAt)
  })

  it('mapLeadV2ToCrmLead — прокидывает version (не в легаси-интерфейсе Lead) для CAS в LeadsBlock', () => {
    const crmLead = mapLeadV2ToCrmLead(makeLead({ version: 7 }))
    expect((crmLead as any).version).toBe(7)
  })

  it('стадии продаж переводятся: backend `new` → легаси needs_analysis («Новый лид»), `defective` → rejected', () => {
    expect(mapLeadV2ToCrmLead(makeLead({ productType: 'sales', stage: 'new' })).stage).toBe('needs_analysis')
    expect(mapLeadV2ToCrmLead(makeLead({ productType: 'sales', stage: 'defective' })).stage).toBe('rejected')
    expect(mapLeadV2ToCrmLead(makeLead({ productType: 'sales', stage: 'golden' })).stage).toBe('deal_closed')
  })

  it('stageCrmToV2 — обратный перевод для PATCH /stage; стадии с префиксом продукта не меняются', () => {
    expect(stageCrmToV2('needs_analysis')).toBe('new')
    expect(stageCrmToV2('rejected')).toBe('defective')
    expect(stageCrmToV2('network_call_later')).toBe('network_call_later')
    for (const backendId of ['defective', 'refused', 'new', 'callback', 'deal', 'golden', 'new_deals']) {
      expect(stageCrmToV2(stageV2ToCrm(backendId))).toBe(backendId)
    }
  })

  it('история и комментарии стадий тоже в легаси-номенклатуре', () => {
    const events = [
      { id: 'e-2', leadId: 'lead-1', stage: 'callback', changedBy: { type: 'system' as const }, changedAt: '2026-09-02T00:00:00Z', comment: 'перезвонить' },
      { id: 'e-1', leadId: 'lead-1', stage: 'new', changedBy: { type: 'system' as const }, changedAt: '2026-09-01T00:00:00Z', comment: null },
    ]
    const history = mapLeadEventsV2ToLegacyHistory(events as never)
    expect(history[0]).toMatchObject({ fromStage: 'needs_analysis', toStage: 'presentation' })
    expect(buildStageCommentsMap(events as never).get('presentation' as never)).toBe('перезвонить')
  })

  it('mapProductTypeCrmToV2 — обратное к mapProductTypeV2ToCrm', () => {
    expect(mapProductTypeCrmToV2(ProductType.SALES)).toBe('sales')
    expect(mapProductTypeCrmToV2(ProductType.NETWORK)).toBe('network')
    expect(mapProductTypeCrmToV2(ProductType.OWNER)).toBe('owner')
    expect(mapProductTypeCrmToV2(ProductType.AGENT)).toBe('agent')
    for (const v2 of ['sales', 'network', 'owner', 'agent'] as const) {
      expect(mapProductTypeCrmToV2(mapProductTypeV2ToCrm(v2))).toBe(v2)
    }
  })

  it('mapLeadEventsV2ToLegacyHistory — восстанавливает fromStage как stage предыдущего (более раннего) события', () => {
    const events: LeadEventV2[] = [
      { id: 'evt-2', leadId: 'lead-1', stage: 'qualified', changedBy: { type: 'position', positionId: 'pos-1' }, changedAt: '2026-09-02T00:00:00Z', comment: 'квалифицирован' },
      { id: 'evt-1', leadId: 'lead-1', stage: 'contacted', changedBy: { type: 'position', positionId: 'pos-1' }, changedAt: '2026-09-01T00:00:00Z', comment: null },
    ]

    const history = mapLeadEventsV2ToLegacyHistory(events)

    expect(history).toHaveLength(2)
    expect(history[0].fromStage).toBe('contacted')
    expect(history[0].toStage).toBe('qualified')
    expect(history[0].comment).toBe('квалифицирован')
    // Самое раннее известное событие — fromStage неизвестен, но заведомо отличен от toStage.
    expect(history[1].toStage).toBe('contacted')
    expect(history[1].fromStage).not.toBe(history[1].toStage)
  })

  it('buildStageCommentsMap — берёт самый свежий комментарий на stage (события отсортированы по убыванию времени)', () => {
    const events: LeadEventV2[] = [
      { id: 'evt-2', leadId: 'lead-1', stage: 'qualified', changedBy: { type: 'system' }, changedAt: '2026-09-02T00:00:00Z', comment: 'новый комментарий' },
      { id: 'evt-1', leadId: 'lead-1', stage: 'qualified', changedBy: { type: 'system' }, changedAt: '2026-09-01T00:00:00Z', comment: 'старый комментарий' },
      { id: 'evt-0', leadId: 'lead-1', stage: 'contacted', changedBy: { type: 'system' }, changedAt: '2026-08-31T00:00:00Z', comment: null },
    ]

    const map = buildStageCommentsMap(events)

    expect(map.get('qualified' as any)).toBe('новый комментарий')
    expect(map.has('contacted' as any)).toBe(false)
  })
})
