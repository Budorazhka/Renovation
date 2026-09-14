/** @vitest-environment jsdom */

/**
 * CrmSyncContext: календарь, задачи и производные уведомления — все с
 * платформенного API (calendarApiV2, tasksApiV2), без легаси api-crm.baza.sale.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listAllTasksMock = vi.fn()
const getUnifiedMock = vi.fn()
const teamListMock = vi.fn()

const mockUser = { id: 'user-1', role: 'manager' }

vi.mock('@/features/crm/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: true, isLoading: false, logout: vi.fn() }),
}))

vi.mock('@/services/calendarApiV2', () => ({
  calendarApiV2: { getUnified: getUnifiedMock },
}))

vi.mock('@/services/tasksApiV2', () => ({
  tasksApiV2: { listAll: listAllTasksMock },
}))

vi.mock('@/services/teamApi', () => ({
  teamApi: { list: teamListMock },
}))

function makeCalendarEventV2(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    organizationId: 'org-1',
    title: 'Показ ЖК Олимп',
    description: null,
    startTime: '2026-09-10T11:00:00.000Z',
    endTime: '2026-09-10T12:00:00.000Z',
    type: 'lead_followup',
    status: 'scheduled',
    isAllDay: false,
    location: 'ЖК Олимп, корп. 3',
    meetingUrl: null,
    leadId: null,
    dealId: null,
    participants: [],
    externalParticipants: [],
    reminderMinutes: [],
    isRecurring: false,
    recurringRule: null,
    parentEventId: null,
    createdByPositionId: 'pos-1',
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function localDateOffset(days: number): { iso: string; date: string } {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(15, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { iso: d.toISOString(), date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
}

function makeTaskV2(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    title: 'Позвонить клиенту',
    description: null,
    status: 'open',
    dueAt: null,
    startAt: null,
    isUrgent: false,
    isImportant: false,
    priority: 'low',
    taskCategory: 'work',
    colorHex: null,
    reminderOffsetsMinutes: [],
    subtasks: [],
    attachments: [],
    attachmentFileNames: [],
    entityType: 'none',
    entityId: null,
    isAutomatic: false,
    triggerType: null,
    assignedPositionId: 'pos-1',
    createdByPositionId: 'pos-1',
    leadId: null,
    contactId: null,
    completedAt: null,
    completedByPositionId: null,
    isOverdue: false,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('CrmSyncContext — календарь на calendarApiV2 (не легаси getCalendarUnified)', () => {
  beforeEach(() => {
    listAllTasksMock.mockReset().mockResolvedValue({ items: [], complete: true })
    getUnifiedMock.mockReset().mockResolvedValue({ events: [makeCalendarEventV2()], tasks: [] })
    teamListMock.mockReset().mockResolvedValue([
      { id: 'pos-1', positionId: 'pos-1', name: 'Анна Первичкина', email: 'anna@test.com', vacant: false, position: 'Агент' },
    ])
  })

  afterEach(() => {
    cleanup()
  })

  async function renderCrmSync() {
    const { CrmSyncProvider, useCrmSync } = await import('@/features/crm/context/CrmSyncContext')
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(CrmSyncProvider, null, children)
    return renderHook(() => useCrmSync(), { wrapper })
  }

  it('читает события через calendarApiV2.getUnified, не через легаси apiService.getCalendarUnified', async () => {
    const { result } = await renderCrmSync()

    await waitFor(() => expect(getUnifiedMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.calendarEvents).toHaveLength(1))

    expect(result.current.calendarEvents[0]?.id).toBe('ev-1')
  })

  it('переводит тип события через таблицу адаптера (lead_followup → showing) и резолвит agentName через ростер', async () => {
    const { result } = await renderCrmSync()
    await waitFor(() => expect(result.current.calendarEvents).toHaveLength(1))

    const event = result.current.calendarEvents[0]
    expect(event?.type).toBe('showing')
    expect(event?.agentName).toBe('Анна Первичкина')
    expect(event?.location).toBe('ЖК Олимп, корп. 3')
  })

  it('объединяет события с задачами из GET /calendar/unified (задача без даты не попадает в календарь)', async () => {
    getUnifiedMock.mockResolvedValueOnce({
      events: [],
      tasks: [
        {
          id: 'task-1',
          title: 'Подготовить документы',
          description: null,
          startAt: null,
          dueAt: '2026-09-12T09:00:00.000Z',
          status: 'open',
          assignedPositionId: 'pos-1',
          leadId: null,
        },
        {
          id: 'task-2',
          title: 'Без даты — не попадает в календарь',
          description: null,
          startAt: null,
          dueAt: null,
          status: 'open',
          assignedPositionId: 'pos-1',
          leadId: null,
        },
      ],
    })

    const { result } = await renderCrmSync()
    await waitFor(() => expect(result.current.calendarEvents).toHaveLength(1))
    expect(result.current.calendarEvents[0]?.title).toBe('Подготовить документы')
  })

  it('запрос диапазона: startDate/endDate — ISO-строки трёхмесячного окна', async () => {
    await renderCrmSync()

    await waitFor(() => expect(getUnifiedMock).toHaveBeenCalledTimes(1))
    const callArgs = getUnifiedMock.mock.calls[0]?.[0] as { startDate: string; endDate: string }
    expect(typeof callArgs.startDate).toBe('string')
    expect(typeof callArgs.endDate).toBe('string')
    expect(new Date(callArgs.startDate).getTime()).toBeLessThan(new Date(callArgs.endDate).getTime())
  })
})

describe('CrmSyncContext — задачи и уведомления на tasksApiV2', () => {
  beforeEach(() => {
    listAllTasksMock.mockReset()
    getUnifiedMock.mockReset().mockResolvedValue({ events: [makeCalendarEventV2()], tasks: [] })
    teamListMock.mockReset().mockResolvedValue([
      { id: 'pos-1', positionId: 'pos-1', name: 'Анна Первичкина', email: 'anna@test.com', vacant: false, position: 'Агент' },
    ])
  })

  afterEach(() => {
    cleanup()
  })

  async function renderCrmSync() {
    const { CrmSyncProvider, useCrmSync } = await import('@/features/crm/context/CrmSyncContext')
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(CrmSyncProvider, null, children)
    return renderHook(() => useCrmSync(), { wrapper })
  }

  it('берёт задачи из tasksApiV2.listAll, отменённые не показывает, имя исполнителя — из ростера', async () => {
    listAllTasksMock.mockResolvedValue({
      items: [makeTaskV2(), makeTaskV2({ id: 'task-cancelled', status: 'cancelled' })],
      complete: true,
    })
    const { result } = await renderCrmSync()

    await waitFor(() => expect(result.current.tasks).toHaveLength(1))
    expect(result.current.tasks[0]?.id).toBe('task-1')
    expect(result.current.tasks[0]?.assignedToName).toBe('Анна Первичкина')
  })

  it('уведомления: просроченная задача — alert, задача на сегодня — info, будущая — не попадает', async () => {
    listAllTasksMock.mockResolvedValue({
      items: [
        makeTaskV2({ id: 'overdue', title: 'Просроченная', dueAt: localDateOffset(-2).iso, isOverdue: true }),
        makeTaskV2({ id: 'today', title: 'Сегодняшняя', dueAt: localDateOffset(0).iso }),
        makeTaskV2({ id: 'later', title: 'Будущая', dueAt: localDateOffset(5).iso }),
      ],
      complete: true,
    })
    const { result } = await renderCrmSync()

    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    expect(result.current.notifications.map((n) => [n.title, n.type])).toEqual([
      ['Просроченная', 'alert'],
      ['Сегодняшняя', 'info'],
    ])
  })

  it('ошибка задач не обнуляет календарь', async () => {
    listAllTasksMock.mockRejectedValue(new Error('network down'))
    const { result } = await renderCrmSync()

    await waitFor(() => expect(result.current.calendarEvents).toHaveLength(1))
    expect(result.current.tasks).toEqual([])
  })
})
