import { TaskPriority, TaskStatus } from '@/features/crm/services/api/types'
import type { Task as CrmTask } from '@/features/crm/services/api/types'
import type { TaskV2 } from '@/types/tasksV2'

/**
 * Адаптер: TaskV2 (apps/api, /api/v1/tasks) → легаси `Task`
 * (features/crm/services/api/types.ts), которым оперирует LeadViewModal.tsx
 * (TaskCard/ModalTaskData/TaskViewModal — вёрстка не меняется). Локальный
 * аналог `@/lib/map-task-v2.ts`: тот мапит в `@/types/tasks` (экран
 * /dashboard/tasks), этот — в легаси-тип CRM-карточки лида, у них разные
 * целевые формы, смешивать нельзя.
 *
 * Честные пробелы:
 *  - `attachments` → `url`/`mimeType`/`size` пустые. TaskV2.attachments
 *    (`CrmTaskReadModel.attachments`, apps/api) отдаёт только
 *    `{assetId, fileName}`, backend не резолвит URL вложений задачи (в
 *    отличие от файлов лида, см. CrmLeadFileReadModel) — превью/скачивание
 *    вложений задачи внутри карточки лида не работает для задач нового
 *    backend. Не выдумано: поле присутствует, но пусто.
 *  - `createdBy`/`assignedTo` → строка positionId, не `{_id,name,email}` —
 *    разрешение имени по позиции вне контракта этой задачи (TaskV2 отдаёт
 *    только id).
 *  - `category`/`syncWithCalendar`/`calendarEventId` — нет аналога на новом
 *    backend, не заполняются.
 */

const STATUS_V2_TO_CRM: Record<TaskV2['status'], TaskStatus> = {
  open: TaskStatus.PENDING,
  in_progress: TaskStatus.IN_PROGRESS,
  completed: TaskStatus.COMPLETED,
  cancelled: TaskStatus.CANCELLED,
}

function priorityFromFlags(isUrgent: boolean, isImportant: boolean): TaskPriority {
  if (isUrgent && isImportant) return TaskPriority.URGENT_IMPORTANT
  if (!isUrgent && isImportant) return TaskPriority.NOT_URGENT_IMPORTANT
  if (isUrgent && !isImportant) return TaskPriority.URGENT_NOT_IMPORTANT
  return TaskPriority.NOT_URGENT_NOT_IMPORTANT
}

export function mapTaskV2ToCrmTask(task: TaskV2): CrmTask {
  return {
    _id: task.id,
    title: task.title,
    description: task.description ?? undefined,
    priority: priorityFromFlags(task.isUrgent, task.isImportant),
    status: STATUS_V2_TO_CRM[task.status],
    startDate: task.startAt ?? undefined,
    endDate: task.dueAt ?? undefined,
    colorLabel: task.colorHex ?? undefined,
    // Классическая CRM различает вид (звонок/встреча) и рабочие/личные задачи по названиям категорий.
    categories: [
      ...(task.taskType === 'call' ? ['Звонок'] : task.taskType === 'meeting' ? ['Встреча'] : []),
      task.taskCategory === 'personal' ? 'Личные задачи' : 'Рабочие задачи',
    ],
    clientName: undefined,
    assignedTo: task.assignedPositionId ?? '',
    createdBy: task.createdByPositionId ?? '',
    leadId: task.leadId ?? undefined,
    subtasks: task.subtasks.map((subtask) => ({ title: subtask.title, completed: subtask.done })),
    files: task.attachments.map((attachment) => ({
      filename: attachment.assetId,
      originalName: attachment.fileName,
      mimeType: '',
      size: 0,
      url: '',
    })),
    hasFiles: task.attachments.length > 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt ?? task.createdAt,
  }
}
