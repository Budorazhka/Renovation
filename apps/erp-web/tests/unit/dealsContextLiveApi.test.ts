/** @vitest-environment jsdom */

/**
 * DealsContext (канбан/карточка сделок) читает сделки с нового backend
 * (apps/api, /api/v1/deals/*) — до этого прохода источником был DEALS_MOCK
 * поверх localStorage, без backend позади вовсе (см. докстринг
 * lib/deal-v2-legacy-adapter.ts). Вложен внутрь LeadsProvider — использует
 * его leadManagers ростер для резолва agentName, поэтому тест мокает те же
 * зависимости, что leadsContextLiveApi.test.ts (teamApi, leadsApiV2 не
 * нужен для базового сценария, apiService — только ради
 * getDistributionSettings, который дёргает LeadsProvider на монтировании).
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dealsListAllMock = vi.fn()
const dealsCreateMock = vi.fn()
const dealsChangeStageMock = vi.fn()
const dealsUpdateChecklistMock = vi.fn()
const dealsAddParticipantMock = vi.fn()
const dealsRemoveParticipantMock = vi.fn()
const dealsReassignMock = vi.fn()
const dealsUpdateMock = vi.fn()

const leadsListAllMock = vi.fn()
const teamListMock = vi.fn()
const getDistributionSettingsMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}))

const mockCurrentUser = { id: 'user-1', name: 'Директор', positionId: 'pos-owner' }
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}))

vi.mock('@/services/leadsApiV2', () => ({
  leadsApiV2: { listAll: leadsListAllMock },
}))

vi.mock('@/services/teamApi', () => ({
  teamApi: { list: teamListMock },
}))

vi.mock('@/features/crm/services/api/service', () => ({
  apiService: {
    getDistributionSettings: getDistributionSettingsMock,
    updateDistributionSettings: vi.fn(),
    createTask: vi.fn(),
  },
}))

vi.mock('@/services/dealsApiV2', () => ({
  dealsApiV2: {
    listAll: dealsListAllMock,
    create: dealsCreateMock,
    changeStage: dealsChangeStageMock,
    updateChecklist: dealsUpdateChecklistMock,
    addParticipant: dealsAddParticipantMock,
    removeParticipant: dealsRemoveParticipantMock,
    reassign: dealsReassignMock,
    update: dealsUpdateMock,
  },
  newIdempotencyKey: () => 'test-idempotency-key',
}))

function makeDealV2(overrides: Record<string, unknown> = {}) {
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
    contact: { id: 'c-1', name: 'Иванов А.В.', phone: '+79990000000' },
    ...overrides,
  }
}

describe('DealsContext — сделки на dealsApiV2', () => {
  beforeEach(() => {
    dealsListAllMock.mockReset().mockResolvedValue({ items: [makeDealV2()], complete: true })
    dealsCreateMock.mockReset()
    dealsChangeStageMock.mockReset()
    dealsUpdateChecklistMock.mockReset()
    dealsAddParticipantMock.mockReset()
    dealsRemoveParticipantMock.mockReset()
    dealsReassignMock.mockReset()
    dealsUpdateMock.mockReset()
    leadsListAllMock.mockReset().mockResolvedValue({ items: [], complete: true })
    teamListMock.mockReset().mockResolvedValue([
      { id: 'pos-1', positionId: 'pos-1', name: 'Анна Первичкина', email: 'anna@test.com', vacant: false, position: 'Агент' },
    ])
    getDistributionSettingsMock.mockReset().mockResolvedValue({ success: true, data: { type: 'manual', manualDistributorId: null } })
    toastErrorMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  async function renderDealsHook() {
    const { LeadsProvider } = await import('@/context/LeadsContext')
    const { DealsProvider, useDeals } = await import('@/context/DealsContext')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(LeadsProvider, null, createElement(DealsProvider, null, children))
    return renderHook(() => useDeals(), { wrapper })
  }

  it('при монтировании читает сделки через dealsApiV2.listAll и резолвит agentName через teamApi-ростер', async () => {
    const { result } = await renderDealsHook()

    await waitFor(() => expect(dealsListAllMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.deals).toHaveLength(1))

    expect(result.current.deals[0]?.id).toBe('deal-1')
    expect(result.current.deals[0]?.agentName).toBe('Анна Первичкина')
  })

  it('changeStage передаёт закешированный version (CAS) в dealsApiV2.changeStage', async () => {
    dealsListAllMock.mockResolvedValueOnce({ items: [makeDealV2({ version: 3 })], complete: true })
    const { result } = await renderDealsHook()
    await waitFor(() => expect(result.current.deals).toHaveLength(1))

    dealsChangeStageMock.mockResolvedValueOnce(makeDealV2({ stage: 'deposit', version: 4 }))

    await act(async () => {
      await result.current.changeStage('deal-1', 'deposit')
    })

    expect(dealsChangeStageMock).toHaveBeenCalledWith('deal-1', 'deposit', 3, undefined)
    expect(result.current.deals[0]?.stage).toBe('deposit')
  })

  it('changeStage при 409 показывает toast и перечитывает сделки вместо падения', async () => {
    const { result } = await renderDealsHook()
    await waitFor(() => expect(result.current.deals).toHaveLength(1))

    const conflictError = Object.assign(new Error('Conflict'), { response: { status: 409 } })
    dealsChangeStageMock.mockRejectedValueOnce(conflictError)
    dealsListAllMock.mockResolvedValueOnce({ items: [makeDealV2({ stage: 'deposit', version: 1 })], complete: true })

    const ok = await act(async () => result.current.changeStage('deal-1', 'deposit'))

    expect(ok).toBe(false)
    expect(toastErrorMock).toHaveBeenCalledWith('Сделку изменил кто-то ещё. Список обновлён.')
    await waitFor(() => expect(dealsListAllMock).toHaveBeenCalledTimes(2))
  })

  it('updateChecklist отправляет CAS-версию и обновляет чеклист сделки в состоянии', async () => {
    const { result } = await renderDealsHook()
    await waitFor(() => expect(result.current.deals).toHaveLength(1))

    dealsUpdateChecklistMock.mockResolvedValueOnce(
      makeDealV2({
        version: 1,
        checklistItems: [{ id: 'c1', label: 'Пункт', done: true, completedAt: '2026-09-02T00:00:00.000Z', completedByPositionId: 'pos-1' }],
      }),
    )

    await act(async () => {
      await result.current.updateChecklist('deal-1', [{ id: 'c1', label: 'Пункт', done: true }])
    })

    expect(dealsUpdateChecklistMock).toHaveBeenCalledWith('deal-1', 0, [{ id: 'c1', label: 'Пункт', done: true }])
    expect(result.current.deals[0]?.checklist).toEqual([{ id: 'c1', label: 'Пункт', done: true, required: false }])
  })

  it('changeType сохраняет тип с CAS-версией: первичка попадает в легаси-сделку', async () => {
    dealsListAllMock.mockResolvedValueOnce({ items: [makeDealV2({ version: 2 })], complete: true })
    const { result } = await renderDealsHook()
    await waitFor(() => expect(result.current.deals).toHaveLength(1))
    expect(result.current.deals[0]?.type).toBe('secondary')

    dealsUpdateMock.mockResolvedValueOnce(makeDealV2({ dealType: 'primary', version: 3 }))
    const outcome = await act(async () => result.current.changeType('deal-1', 'primary'))

    expect(outcome).toBe('saved')
    expect(dealsUpdateMock).toHaveBeenCalledWith('deal-1', { expectedVersion: 2, dealType: 'primary' })
    expect(result.current.deals[0]?.type).toBe('primary')
  })

  it('changeType после отметки BAZA: сервер отвечает DEAL_TYPE_LOCKED — без общего тоста о конфликте, сделки перечитываются', async () => {
    const { result } = await renderDealsHook()
    await waitFor(() => expect(result.current.deals).toHaveLength(1))

    const locked = Object.assign(new Error('Conflict'), {
      response: { status: 409, data: { error: { code: 'DEAL_TYPE_LOCKED' } } },
    })
    dealsUpdateMock.mockRejectedValueOnce(locked)
    const outcome = await act(async () => result.current.changeType('deal-1', 'secondary'))

    expect(outcome).toBe('locked')
    expect(toastErrorMock).not.toHaveBeenCalled()
    await waitFor(() => expect(dealsListAllMock).toHaveBeenCalledTimes(2))
  })

  it('createDeal вызывает dealsApiV2.create с Idempotency-Key и добавляет сделку в состояние', async () => {
    const { result } = await renderDealsHook()
    await waitFor(() => expect(result.current.deals).toHaveLength(1))

    dealsCreateMock.mockResolvedValueOnce(makeDealV2({ id: 'deal-2', title: 'Сделка по лиду' }))

    let created: unknown
    await act(async () => {
      created = await result.current.createDeal({ contactId: 'c-9', title: 'Сделка по лиду', leadId: 'lead-9' })
    })

    expect(dealsCreateMock).toHaveBeenCalledWith(
      { contactId: 'c-9', title: 'Сделка по лиду', leadId: 'lead-9' },
      'test-idempotency-key',
    )
    expect((created as { id: string }).id).toBe('deal-2')
    expect(result.current.deals.some((d) => d.id === 'deal-2')).toBe(true)
  })
})
