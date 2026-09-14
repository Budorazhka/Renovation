import { beforeEach, describe, expect, it, vi } from 'vitest'

const leadsApi = {
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  changeStage: vi.fn(),
}
const checklistApi = { get: vi.fn(), update: vi.fn(), putStageNote: vi.fn() }

vi.mock('@/services/leadsApiV2', () => ({
  leadsApiV2: leadsApi,
  leadChecklistApiV2: checklistApi,
  newIdempotencyKey: () => 'idem',
}))
vi.mock('@/services/mediaApiV2', () => ({ mediaApiV2: { uploadFile: vi.fn() } }))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1', organizationId: 'org-1', ownerPositionId: null, productType: 'sales', stage: 'new',
    version: 3, source: { route: 'manual' }, createdAt: '2026-09-14T00:00:00.000Z',
    contact: { id: 'c-1', name: 'Иван', phone: '+995555010203', email: null },
    hasOpenNextAction: false, stalled: false,
    ...overrides,
  }
}

async function load() {
  return import('@/features/crm/services/leadsCrmV2')
}

describe('leadCrmService — форма клиента и чек-лист на leadsApiV2', () => {
  beforeEach(() => {
    Object.values(leadsApi).forEach((fn) => fn.mockReset())
    Object.values(checklistApi).forEach((fn) => fn.mockReset())
  })

  it('поля формы: имя/телефон/почта уходят в контакт, пустая почта — очистка, продукт — строка платформы', async () => {
    const { toUpdateLeadPayload } = await load()
    const { ProductType } = await import('@/features/crm/services/api')
    expect(toUpdateLeadPayload({ name: ' Иван ', phone: '+995555010203', email: '', productType: ProductType.NETWORK, notes: 'x' }))
      .toEqual({ name: 'Иван', phone: '+995555010203', email: null, productType: 'network', notes: 'x' })
  })

  it('создание: POST /leads с именем, телефоном и продуктом, остальное дописывается правкой', async () => {
    leadsApi.create.mockResolvedValue(makeLead())
    leadsApi.update.mockResolvedValue(makeLead({ city: 'Батуми' }))
    const { leadCrmService } = await load()
    const { ProductType } = await import('@/features/crm/services/api')

    const res = await leadCrmService.createLead({ name: 'Иван', phone: '+995555010203', productType: ProductType.SALES, assignedTo: 'pos-1', city: 'Батуми' })

    expect(leadsApi.create).toHaveBeenCalledWith({ requesterName: 'Иван', requesterPhone: '+995555010203', productType: 'sales' }, 'idem')
    expect(leadsApi.update).toHaveBeenCalledWith('lead-1', { city: 'Батуми' })
    expect(res.success).toBe(true)
  })

  it('создание без дополнительных полей не делает лишнюю правку', async () => {
    leadsApi.create.mockResolvedValue(makeLead())
    const { leadCrmService } = await load()
    const { ProductType } = await import('@/features/crm/services/api')

    await leadCrmService.createLead({ name: 'Иван', phone: '+995555010203', productType: ProductType.SALES, assignedTo: 'pos-1' })

    expect(leadsApi.update).not.toHaveBeenCalled()
  })

  it('смена стадии: легаси-стадия продаж переводится в id платформы, версия берётся свежая', async () => {
    leadsApi.getById.mockResolvedValue(makeLead({ version: 7 }))
    leadsApi.changeStage.mockResolvedValue({ version: 8 })
    const { leadCrmService } = await load()
    const { LeadStage } = await import('@/features/crm/services/api')

    await leadCrmService.updateLeadStage('lead-1', { stage: LeadStage.PRESENTATION, comment: 'перезвонить' })

    expect(leadsApi.changeStage).toHaveBeenCalledWith('lead-1', 'callback', 7, 'idem', 'перезвонить')
  })

  it('при смене продукта стадию не отправляет — её сбрасывает сервер', async () => {
    leadsApi.update.mockResolvedValue(makeLead({ productType: 'network', stage: 'network_new_lead' }))
    const { leadCrmService } = await load()
    const { LeadStage, ProductType } = await import('@/features/crm/services/api')

    await leadCrmService.updateLead('lead-1', { productType: ProductType.NETWORK, stage: LeadStage.NETWORK_NEW_LEAD })

    expect(leadsApi.changeStage).not.toHaveBeenCalled()
  })

  it('чек-лист и заметки стадий: стадии переводятся в обе стороны', async () => {
    checklistApi.get.mockResolvedValue({
      items: [{ stage: 'new', index: 0, checked: true }],
      stageNotes: [{ stage: 'callback', text: 'утром', updatedAt: '2026-09-14T00:00:00.000Z' }],
    })
    checklistApi.update.mockResolvedValue({ items: [], stageNotes: [] })
    checklistApi.putStageNote.mockResolvedValue({ stage: 'callback', text: 'вечером', updatedAt: '2026-09-14T00:00:00.000Z' })
    const { leadCrmService } = await load()
    const { LeadStage } = await import('@/features/crm/services/api')

    expect((await leadCrmService.getChecklistState('lead-1')).data!.items[0]).toMatchObject({ stage: 'needs_analysis', checked: true })
    await leadCrmService.saveChecklistState('lead-1', [{ stage: LeadStage.NEEDS_ANALYSIS, index: 1, checked: false }])
    expect(checklistApi.update).toHaveBeenCalledWith('lead-1', [{ stage: 'new', index: 1, checked: false }])
    expect((await leadCrmService.getStageComment('lead-1', LeadStage.PRESENTATION)).data).toEqual({ comment: 'утром' })
    await leadCrmService.createStageComment('lead-1', LeadStage.PRESENTATION, 'вечером')
    expect(checklistApi.putStageNote).toHaveBeenCalledWith('lead-1', 'callback', 'вечером')
  })
})
