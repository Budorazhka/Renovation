import { describe, expect, it } from 'vitest'
import {
  fromDateTimeLocal,
  isOpenReminder,
  matchesDue,
  matchesLink,
  matchesTab,
  reminderEndTime,
  reminderState,
  reminderWindow,
  sortReminders,
  toDateTimeLocal,
} from '@/lib/reminders'
import type { CalendarEventV2 } from '@/types/calendarV2'

const NOW = new Date('2026-09-16T12:00:00.000Z')

function event(overrides: Partial<CalendarEventV2> & { id: string; startTime: string }): CalendarEventV2 {
  return {
    organizationId: 'org-1',
    title: 'Позвонить клиенту',
    description: null,
    endTime: reminderEndTime(overrides.startTime),
    type: 'reminder',
    status: 'scheduled',
    isAllDay: false,
    location: null,
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
    version: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('состояние напоминания', () => {
  it('срок в прошлом — просрочено, в будущем того же дня — сегодня', () => {
    expect(reminderState(event({ id: '1', startTime: '2026-09-16T09:00:00.000Z' }), NOW)).toBe('overdue')
    // Тот же день по местному времени проверяющей машины, +1 час от «сейчас».
    const laterToday = new Date(NOW.getTime() + 3_600_000).toISOString()
    expect(reminderState(event({ id: '2', startTime: laterToday }), NOW)).toBe('today')
  })

  it('следующая неделя — впереди, завершённое и отменённое — закрыты', () => {
    const nextWeek = new Date(NOW.getTime() + 7 * 86_400_000).toISOString()
    expect(reminderState(event({ id: '3', startTime: nextWeek }), NOW)).toBe('upcoming')
    expect(reminderState(event({ id: '4', startTime: nextWeek, status: 'completed' }), NOW)).toBe('done')
    expect(reminderState(event({ id: '5', startTime: nextWeek, status: 'cancelled' }), NOW)).toBe('cancelled')
    expect(reminderState(event({ id: '6', startTime: nextWeek, status: 'no_show' }), NOW)).toBe('cancelled')
  })

  it('завершённое не считается открытым, даже если срок прошёл', () => {
    const done = event({ id: '7', startTime: '2026-09-01T09:00:00.000Z', status: 'completed' })
    expect(isOpenReminder(reminderState(done, NOW))).toBe(false)
  })
})

describe('фильтры и порядок', () => {
  const overdue = event({ id: 'a', startTime: '2026-09-10T09:00:00.000Z' })
  const soon = event({ id: 'b', startTime: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(), dealId: 'deal-1' })
  const far = event({ id: 'c', startTime: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(), leadId: 'lead-1' })
  const done = event({ id: 'd', startTime: '2026-09-12T09:00:00.000Z', status: 'completed' })

  it('вкладка «активные» скрывает закрытые, «закрытые» — открытые', () => {
    expect(matchesTab(reminderState(overdue, NOW), 'open')).toBe(true)
    expect(matchesTab(reminderState(done, NOW), 'open')).toBe(false)
    expect(matchesTab(reminderState(done, NOW), 'done')).toBe(true)
    expect(matchesTab(reminderState(overdue, NOW), 'all')).toBe(true)
  })

  it('фильтр срока: просроченные и ближайшая неделя', () => {
    expect(matchesDue(overdue, reminderState(overdue, NOW), 'overdue', NOW)).toBe(true)
    expect(matchesDue(soon, reminderState(soon, NOW), 'overdue', NOW)).toBe(false)
    expect(matchesDue(soon, reminderState(soon, NOW), 'week', NOW)).toBe(true)
    expect(matchesDue(far, reminderState(far, NOW), 'week', NOW)).toBe(false)
  })

  it('фильтр связи различает сделку, лид и напоминания без связи', () => {
    expect(matchesLink(soon, 'deal')).toBe(true)
    expect(matchesLink(soon, 'lead')).toBe(false)
    expect(matchesLink(far, 'lead')).toBe(true)
    expect(matchesLink(overdue, 'none')).toBe(true)
    expect(matchesLink(soon, 'none')).toBe(false)
  })

  it('сначала открытые по возрастанию срока, закрытые — в конце', () => {
    const order = sortReminders([done, far, overdue, soon], NOW).map((item) => item.id)
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('перевод времени', () => {
  it('конец напоминания отстоит от начала на 15 минут', () => {
    expect(reminderEndTime('2026-09-16T10:00:00.000Z')).toBe('2026-09-16T10:15:00.000Z')
  })

  it('значение формы и ISO-момент переводятся друг в друга без сдвига', () => {
    const iso = '2026-09-16T10:30:00.000Z'
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso)
  })

  it('окно чтения покрывает прошедший срок и планы вперёд', () => {
    const { startDate, endDate } = reminderWindow(NOW)
    expect(new Date(startDate).getTime()).toBeLessThan(NOW.getTime())
    expect(new Date(endDate).getTime()).toBeGreaterThan(NOW.getTime() + 90 * 86_400_000)
  })
})
