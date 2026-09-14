import { calendarApiV2 } from '@/services/calendarApiV2'
import { EventStatus, EventType, type CalendarEvent } from '@/features/crm/services/api/types'
import type { CalendarEventV2, CalendarUnifiedTaskV2 } from '@/types/calendarV2'

/**
 * Календарь платформы (GET /api/v1/calendar/unified) → форма CalendarEvent
 * классической CRM. Типы и статусы событий совпадают 1:1. Участники не
 * переносятся: сервер отдаёт id позиций, а CRM ждёт объекты с именем и почтой.
 */

const HOUR_MS = 60 * 60 * 1000

export function mapCalendarEventV2ToCrm(event: CalendarEventV2): CalendarEvent {
  return {
    _id: event.id,
    title: event.title,
    description: event.description ?? undefined,
    startTime: event.startTime,
    endTime: event.endTime,
    type: event.type as EventType,
    status: event.status as EventStatus,
    isAllDay: event.isAllDay,
    location: event.location ?? undefined,
    meetingUrl: event.meetingUrl ?? undefined,
    leadId: event.leadId ?? undefined,
    externalParticipants: event.externalParticipants,
    reminderMinutes: event.reminderMinutes,
    isRecurring: event.isRecurring,
    recurringRule: event.recurringRule ?? undefined,
    parentEventId: event.parentEventId ?? undefined,
    createdBy: event.createdByPositionId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt ?? event.createdAt,
  }
}

/** Задача без начала и срока в календарь не попадает; без длительности — час от начала. */
export function mapUnifiedTaskV2ToCrm(task: CalendarUnifiedTaskV2): CalendarEvent | null {
  if (task.status === 'cancelled') return null
  const startIso = task.startAt ?? task.dueAt
  if (!startIso) return null
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return null
  const due = task.dueAt ? new Date(task.dueAt) : null
  const end = due && due.getTime() > start.getTime() ? due : new Date(start.getTime() + HOUR_MS)

  return {
    _id: task.id,
    title: task.title,
    description: task.description ?? undefined,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    type: EventType.TASK,
    status: task.status === 'completed' ? EventStatus.COMPLETED : EventStatus.SCHEDULED,
    isAllDay: false,
    leadId: task.leadId ?? undefined,
    taskId: task.id,
    createdBy: task.assignedPositionId ?? '',
    createdAt: startIso,
    updatedAt: startIso,
  }
}

export async function loadCrmCalendarEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
  const { events, tasks } = await calendarApiV2.getUnified({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  })
  return [
    ...events.map(mapCalendarEventV2ToCrm),
    ...tasks.map(mapUnifiedTaskV2ToCrm).filter((e): e is CalendarEvent => e !== null),
  ]
}

export function monthRange(date: Date): { start: Date; end: Date } {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59),
  }
}
