/**
 * Модель задачи нового Platform API (apps/api/src/modules/crm/crm.service.ts,
 * CrmTaskReadModel). Отдельный тип от `@/types/tasks`: тот описывает то, что
 * рисует экран, этот — то, что отдаёт сервер, и смешивать их нельзя, иначе
 * расхождение снова станет невидимым.
 */

export type TaskStatusV2 = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type TaskPriorityV2 = 'low' | 'medium' | 'high' | 'critical'
export type TaskCategoryV2 = 'work' | 'personal'
/** Вид задачи: обычная, звонок или встреча. Независим от категории «рабочая/личная». */
export type TaskTypeV2 = 'standard' | 'call' | 'meeting'
export type TaskEntityTypeV2 = 'lead' | 'client' | 'deal' | 'property' | 'booking' | 'none'

export interface TaskAttachmentV2 {
  assetId: string
  fileName: string
}

export interface TaskSubtaskV2 {
  id: string
  title: string
  done: boolean
}

export interface TaskV2 {
  id: string
  organizationId: string
  title: string
  description: string | null
  status: TaskStatusV2
  /** Срок, ISO-момент времени. Разделение на дату и время — забота представления. */
  dueAt: string | null
  startAt: string | null
  /** Признаки матрицы Эйзенхауэра — то, что сервер хранит. */
  isUrgent: boolean
  isImportant: boolean
  /** Квадрант для экрана. Сервер выводит из признаков, не хранит. */
  priority: TaskPriorityV2
  taskCategory: TaskCategoryV2
  taskType: TaskTypeV2
  colorHex: string | null
  reminderOffsetsMinutes: number[]
  subtasks: TaskSubtaskV2[]
  /** Ссылки на подтверждённые файлы с именами для экрана. */
  attachments: TaskAttachmentV2[]
  /** Имена вложений — сервер выводит из attachments. */
  attachmentFileNames: string[]
  entityType: TaskEntityTypeV2
  entityId: string | null
  isAutomatic: boolean
  triggerType: string | null
  assignedPositionId: string | null
  createdByPositionId: string | null
  leadId: string | null
  contactId: string | null
  completedAt: string | null
  completedByPositionId: string | null
  /**
   * Просрочена ли задача. Сервер вычисляет на чтении и НЕ хранит: производное
   * от dueAt и статуса. Клиент обязан брать этот признак, а не пересчитывать
   * его сам — иначе два места будут отвечать на один вопрос по-разному.
   */
  isOverdue: boolean
  version: number
  createdAt: string
  updatedAt: string | null
}

export interface ListTasksV2Params {
  status?: TaskStatusV2
  assignedPositionId?: string
  leadId?: string
  contactId?: string
  dueBefore?: string
  dueAfter?: string
  cursor?: string
  limit?: number
}

export interface ListTasksV2Response {
  items: TaskV2[]
  nextCursor: string | null
}

/** Тело POST /tasks. Организация и создатель выводятся сервером из сессии. */
export interface CreateTaskV2Payload {
  title: string
  description?: string
  dueAt?: string
  startAt?: string
  isUrgent?: boolean
  isImportant?: boolean
  taskCategory?: TaskCategoryV2
  taskType?: TaskTypeV2
  colorHex?: string | null
  reminderOffsetsMinutes?: number[]
  subtasks?: TaskSubtaskV2[]
  /** Файлы загружены заранее (mediaApiV2.uploadFile, purpose task_attachment); здесь только ссылки. */
  attachments?: TaskAttachmentV2[]
  assignedPositionId?: string
  leadId?: string
  contactId?: string
}

/**
 * Тело PATCH /tasks/:taskId. Исполнитель сюда не входит — только через
 * /reassign; завершение — только через /complete. `null` снимает значение.
 */
export interface UpdateTaskV2Payload {
  title?: string
  description?: string
  status?: 'open' | 'in_progress' | 'cancelled'
  dueAt?: string | null
  startAt?: string | null
  isUrgent?: boolean
  isImportant?: boolean
  taskCategory?: TaskCategoryV2
  taskType?: TaskTypeV2
  colorHex?: string | null
  leadId?: string | null
  subtasks?: TaskSubtaskV2[]
  attachments?: TaskAttachmentV2[]
}
