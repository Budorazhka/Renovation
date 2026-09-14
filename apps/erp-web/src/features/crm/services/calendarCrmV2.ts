import axios from 'axios';
import { calendarApiV2, newIdempotencyKey } from '@/services/calendarApiV2';
import { tasksApiV2, newIdempotencyKey as newTaskIdempotencyKey } from '@/services/tasksApiV2';
import { mapCalendarEventV2ToCrm } from '@/lib/calendar-v2-crm-adapter';
import type { CalendarEventTypeV2, CalendarUnifiedTaskV2, CreateCalendarEventV2Payload, UpdateCalendarEventV2Payload } from '@/types/calendarV2';
import { TaskPriority } from './api';
import {
  EventStatus,
  EventType,
  type ApiResponse,
  type CalendarEvent,
  type CreateCalendarEventDto,
  type UpdateCalendarEventDto,
} from './api';

/**
 * Календарь платформы в легаси-форме CalendarViewModal (методы и ответы
 * {success, data} как у старого apiService). У платформы события и задачи —
 * разные сущности: «событие типа задача» создаётся как задача, а перенос
 * задачи в календаре меняет её даты.
 */

// userId/userRole старого API не нужны: организацию и позицию сервер берёт из сессии.
type LegacyRangeParams = { startDate: string; endDate: string; type?: EventType; userId?: string; userRole?: unknown };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const HOUR_MS = 60 * 60 * 1000;

export interface CrmUnifiedTask {
  _id: string;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  priority: string;
  status: string;
  type: 'task';
  taskId: string;
}

function failure<T>(error: unknown): ApiResponse<T> {
  const err = error as { response?: { data?: { message?: string } }; message?: string };
  return { success: false, message: err.response?.data?.message || err.message || 'Ошибка запроса' };
}

function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function toUnifiedTask(task: CalendarUnifiedTaskV2): CrmUnifiedTask {
  return {
    _id: task.id,
    title: task.title,
    description: task.description ?? undefined,
    // Задача только со сроком встаёт в календарь на срок.
    startDate: task.startAt ?? task.dueAt ?? undefined,
    endDate: task.dueAt ?? undefined,
    priority: TaskPriority.NOT_URGENT_NOT_IMPORTANT,
    status: task.status,
    type: 'task',
    taskId: task.id,
  };
}

function eventTypeV2(type: EventType | undefined): CalendarEventTypeV2 | undefined {
  return type === undefined ? undefined : (type as CalendarEventTypeV2);
}

function onlyObjectIds(ids: string[] | undefined): string[] | undefined {
  const valid = ids?.filter((id) => OBJECT_ID.test(id));
  return valid && valid.length > 0 ? valid : undefined;
}

export const calendarCrmService = {
  async getCalendarUnified(params: LegacyRangeParams): Promise<
    ApiResponse<{ events: CalendarEvent[]; tasks: CrmUnifiedTask[] }>
  > {
    try {
      const { events, tasks } = await calendarApiV2.getUnified({ startDate: params.startDate, endDate: params.endDate });
      const mapped = events.map(mapCalendarEventV2ToCrm).filter((e) => !params.type || e.type === params.type);
      return {
        success: true,
        data: { events: mapped, tasks: tasks.filter((t) => t.status !== 'cancelled').map(toUnifiedTask) },
      };
    } catch (error) {
      return failure(error);
    }
  },

  async getCalendarEventsView(params: LegacyRangeParams): Promise<ApiResponse<CalendarEvent[]>> {
    try {
      const { items } = await calendarApiV2.list({
        startDate: params.startDate,
        endDate: params.endDate,
        ...(params.type && { type: eventTypeV2(params.type) }),
      });
      return { success: true, data: items.map(mapCalendarEventV2ToCrm) };
    } catch (error) {
      return failure(error);
    }
  },

  async createCalendarEvent(data: CreateCalendarEventDto): Promise<ApiResponse<CalendarEvent>> {
    try {
      if (data.type === EventType.TASK) {
        const task = await tasksApiV2.create(
          {
            title: data.title,
            ...(data.description && { description: data.description }),
            startAt: data.startTime,
            dueAt: data.endTime,
            ...(data.leadId && { leadId: data.leadId }),
          },
          newTaskIdempotencyKey(),
        );
        const start = task.startAt ?? data.startTime;
        return {
          success: true,
          data: {
            _id: task.id,
            title: task.title,
            description: task.description ?? undefined,
            startTime: start,
            endTime: task.dueAt ?? new Date(new Date(start).getTime() + HOUR_MS).toISOString(),
            type: EventType.TASK,
            status: EventStatus.SCHEDULED,
            isAllDay: false,
            taskId: task.id,
            createdBy: task.createdByPositionId ?? '',
            createdAt: task.createdAt,
            updatedAt: task.updatedAt ?? task.createdAt,
          },
        };
      }

      const payload: CreateCalendarEventV2Payload = {
        title: data.title,
        startTime: data.startTime,
        endTime: data.endTime,
        ...(data.description && { description: data.description }),
        ...(data.type && { type: eventTypeV2(data.type) }),
        ...(data.isAllDay !== undefined && { isAllDay: data.isAllDay }),
        ...(data.location && { location: data.location }),
        ...(data.meetingUrl && { meetingUrl: data.meetingUrl }),
        ...(data.leadId && { leadId: data.leadId }),
        ...(onlyObjectIds(data.participants) && { participants: onlyObjectIds(data.participants) }),
        ...(data.externalParticipants?.length && { externalParticipants: data.externalParticipants }),
        ...(data.reminderMinutes?.length && { reminderMinutes: data.reminderMinutes }),
        ...(data.isRecurring && { isRecurring: true, ...(data.recurringRule && { recurringRule: data.recurringRule }) }),
      };
      const created = await calendarApiV2.create(payload, newIdempotencyKey());
      return { success: true, data: mapCalendarEventV2ToCrm(created) };
    } catch (error) {
      return failure(error);
    }
  },

  /** Общие поля — PATCH, время — отдельный move (так устроен API платформы). */
  async updateCalendarEvent(id: string, data: UpdateCalendarEventDto): Promise<ApiResponse<CalendarEvent>> {
    try {
      let current = await calendarApiV2.getById(id);
      const payload: UpdateCalendarEventV2Payload = { expectedVersion: current.version };
      if (data.title !== undefined) payload.title = data.title;
      if (data.description !== undefined) payload.description = data.description || null;
      if (data.type !== undefined) payload.type = eventTypeV2(data.type);
      if (data.status !== undefined) payload.status = data.status as UpdateCalendarEventV2Payload['status'];
      if (data.isAllDay !== undefined) payload.isAllDay = data.isAllDay;
      if (data.location !== undefined) payload.location = data.location || null;
      if (data.meetingUrl !== undefined) payload.meetingUrl = data.meetingUrl || null;
      if (data.leadId !== undefined) payload.leadId = data.leadId;
      if (data.participants !== undefined) payload.participants = onlyObjectIds(data.participants) ?? [];
      if (data.externalParticipants !== undefined) payload.externalParticipants = data.externalParticipants;
      if (data.reminderMinutes !== undefined) payload.reminderMinutes = data.reminderMinutes;
      if (data.isRecurring !== undefined) payload.isRecurring = data.isRecurring;
      if (data.recurringRule !== undefined) payload.recurringRule = data.recurringRule || null;
      if (Object.keys(payload).length > 1) current = await calendarApiV2.update(id, payload);
      if (data.startTime && data.endTime) {
        current = await calendarApiV2.move(id, {
          expectedVersion: current.version,
          newStartTime: data.startTime,
          newEndTime: data.endTime,
        });
      }
      return { success: true, data: mapCalendarEventV2ToCrm(current) };
    } catch (error) {
      return failure(error);
    }
  },

  async deleteCalendarEvent(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      return { success: true, data: await calendarApiV2.remove(id) };
    } catch (error) {
      return failure(error);
    }
  },

  /** Событие двигается через move; если такого события нет — это задача, у неё меняются даты. */
  async moveCalendarEvent(id: string, data: { newStartTime: string; newEndTime: string }): Promise<ApiResponse<CalendarEvent>> {
    const rawId = id.startsWith('task_') ? id.slice('task_'.length) : id;
    try {
      const current = await calendarApiV2.getById(rawId);
      const moved = await calendarApiV2.move(rawId, { expectedVersion: current.version, ...data });
      return { success: true, data: mapCalendarEventV2ToCrm(moved) };
    } catch (error) {
      if (!isNotFound(error)) return failure(error);
    }
    try {
      const task = await tasksApiV2.getById(rawId);
      const updated = await tasksApiV2.update(rawId, task.version, { startAt: data.newStartTime, dueAt: data.newEndTime });
      return {
        success: true,
        data: {
          _id: updated.id,
          title: updated.title,
          description: updated.description ?? undefined,
          startTime: updated.startAt ?? data.newStartTime,
          endTime: updated.dueAt ?? data.newEndTime,
          type: EventType.TASK,
          status: updated.status === 'completed' ? EventStatus.COMPLETED : EventStatus.SCHEDULED,
          isAllDay: false,
          taskId: updated.id,
          createdBy: updated.createdByPositionId ?? '',
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt ?? updated.createdAt,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
};
