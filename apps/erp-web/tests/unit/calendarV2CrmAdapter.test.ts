import { describe, expect, it } from 'vitest'
import { mapCalendarEventV2ToCrm, mapUnifiedTaskV2ToCrm } from '@/lib/calendar-v2-crm-adapter'
import type { CalendarEventV2, CalendarUnifiedTaskV2 } from '@/types/calendarV2'

function makeEvent(overrides: Partial<CalendarEventV2> = {}): CalendarEventV2 {
  return {
    id: 'ev-1',
    organizationId: 'org-1',
    title: 'Показ',
    description: null,
    startTime: '2026-09-15T08:00:00.000Z',
    endTime: '2026-09-15T09:00:00.000Z',
    type: 'meeting',
    status: 'scheduled',
    isAllDay: false,
    location: 'ЖК Олимп',
    meetingUrl: null,
    leadId: 'lead-1',
    dealId: null,
    participants: ['pos-2'],
    externalParticipants: [],
    reminderMinutes: [15],
    isRecurring: false,
    recurringRule: null,
    parentEventId: null,
    createdByPositionId: 'pos-1',
    version: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function makeTask(overrides: Partial<CalendarUnifiedTaskV2> = {}): CalendarUnifiedTaskV2 {
  return {
    id: 'task-1',
    title: 'Позвонить',
    description: null,
    startAt: null,
    dueAt: null,
    status: 'open',
    assignedPositionId: 'pos-1',
    leadId: null,
    ...overrides,
  }
}

describe('calendar-v2-crm-adapter', () => {
  it('событие: id → _id, тип/статус как есть, null → undefined, участники (id позиций) не переносятся', () => {
    const e = mapCalendarEventV2ToCrm(makeEvent())
    expect(e).toMatchObject({
      _id: 'ev-1',
      type: 'meeting',
      status: 'scheduled',
      location: 'ЖК Олимп',
      leadId: 'lead-1',
      createdBy: 'pos-1',
      reminderMinutes: [15],
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(e.description).toBeUndefined()
    expect(e.participants).toBeUndefined()
  })

  it('задача без начала и срока в календарь не попадает', () => {
    expect(mapUnifiedTaskV2ToCrm(makeTask())).toBeNull()
  })

  it('отменённая задача в календарь не попадает', () => {
    expect(mapUnifiedTaskV2ToCrm(makeTask({ dueAt: '2026-09-15T10:00:00.000Z', status: 'cancelled' }))).toBeNull()
  })

  it('задача только со сроком — событие на сроке длиной час', () => {
    const e = mapUnifiedTaskV2ToCrm(makeTask({ dueAt: '2026-09-15T10:00:00.000Z' }))
    expect(e).toMatchObject({ type: 'task', taskId: 'task-1', startTime: '2026-09-15T10:00:00.000Z', endTime: '2026-09-15T11:00:00.000Z' })
  })

  it('задача с началом и сроком — от начала до срока; выполненная — completed', () => {
    const e = mapUnifiedTaskV2ToCrm(makeTask({
      startAt: '2026-09-15T08:00:00.000Z',
      dueAt: '2026-09-15T12:00:00.000Z',
      status: 'completed',
    }))
    expect(e).toMatchObject({ startTime: '2026-09-15T08:00:00.000Z', endTime: '2026-09-15T12:00:00.000Z', status: 'completed' })
  })
})
