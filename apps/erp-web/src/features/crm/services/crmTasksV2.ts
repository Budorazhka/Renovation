import { tasksApiV2 } from '@/services/tasksApiV2';
import { mediaApiV2 } from '@/services/mediaApiV2';
import { leadsApiV2 } from '@/services/leadsApiV2';
import { isDisplayableTaskV2, toStoredColor } from '@/lib/map-task-v2';
import { mapTaskV2ToCrmTask } from '@/lib/task-v2-legacy-adapter';
import { mapLeadV2ToCrmLead } from '@/lib/lead-v2-legacy-adapter';
import type { TaskAttachmentV2, TaskCategoryV2, TaskTypeV2, TaskV2, UpdateTaskV2Payload } from '@/types/tasksV2';
import { en } from '@/i18n/dictionaries/en';
import { es } from '@/i18n/dictionaries/es';
import { ka } from '@/i18n/dictionaries/ka';
import { ru } from '@/i18n/dictionaries/ru';
import { tr } from '@/i18n/dictionaries/tr';
import {
  TaskPriority,
  TaskStatus,
  type ApiResponse,
  type Category,
  type Lead,
  type PaginatedResult,
  type Subtask,
  type Task,
  type TaskFile,
  type UpdateTaskDto,
} from './api';

/**
 * Задачи платформы в легаси-форме классической CRM — для блоков вне
 * useCrmData (уведомления, карточка задачи, календарь). Методы и ответы
 * {success, data} повторяют старый apiService, чтобы не переписывать
 * компоненты на тысячи строк.
 */

export async function listCrmTasks(assignedPositionId?: string): Promise<{ tasks: Task[]; versions: Map<string, number> }> {
  const { items } = await tasksApiV2.listAll(assignedPositionId ? { assignedPositionId } : undefined);
  const visible = items.filter(isDisplayableTaskV2);
  return {
    tasks: visible.map(mapTaskV2ToCrmTask),
    versions: new Map(visible.map((t) => [t.id, t.version])),
  };
}

/** Смена статуса: завершение — отдельная команда complete, остальное — PATCH status. */
export function setCrmTaskStatus(taskId: string, expectedVersion: number, status: TaskStatus): Promise<TaskV2> {
  if (status === TaskStatus.COMPLETED) return tasksApiV2.complete(taskId, expectedVersion);
  return tasksApiV2.setStatus(
    taskId,
    expectedVersion,
    status === TaskStatus.CANCELLED ? 'cancelled' : status === TaskStatus.IN_PROGRESS ? 'in_progress' : 'open',
  );
}

// Категории классической CRM — названия на языке интерфейса (taskViewModal.*),
// у платформы это два независимых поля: вид задачи и рабочая/личная.
type CategoryBucket = 'call' | 'meeting' | 'personal' | 'work';

const BUCKET_ID: Record<CategoryBucket, number> = { call: 1, meeting: 2, personal: 3, work: 4 };

const BUCKET_BY_LABEL: Map<string, CategoryBucket> = (() => {
  const map = new Map<string, CategoryBucket>();
  const add = (label: string | undefined, bucket: CategoryBucket) => {
    if (label) map.set(label.toLowerCase(), bucket);
  };
  for (const dict of [ru, en, ka, es, tr]) {
    const labels = dict.taskViewModal;
    add(labels?.call, 'call');
    add(labels?.meeting, 'meeting');
    add(labels?.personalTasks, 'personal');
    add(labels?.workTasks, 'work');
  }
  return map;
})();

function bucketOf(name: string): CategoryBucket | null {
  return BUCKET_BY_LABEL.get(name.trim().toLowerCase()) ?? null;
}

function bucketById(id: number): CategoryBucket | null {
  const entry = Object.entries(BUCKET_ID).find(([, value]) => value === id);
  return entry ? (entry[0] as CategoryBucket) : null;
}

/** Названия категорий классической CRM → вид задачи и рабочая/личная платформы. */
export function categoryFields(categories?: string[], category?: number): { taskCategory?: TaskCategoryV2; taskType?: TaskTypeV2 } {
  if (categories === undefined && category === undefined) return {};
  const buckets = new Set<CategoryBucket>();
  categories?.forEach((name) => {
    const bucket = bucketOf(name);
    if (bucket) buckets.add(bucket);
  });
  const byId = category !== undefined ? bucketById(category) : null;
  if (byId) buckets.add(byId);
  return {
    ...(buckets.has('personal') ? { taskCategory: 'personal' as const } : buckets.has('work') ? { taskCategory: 'work' as const } : {}),
    taskType: buckets.has('call') ? 'call' : buckets.has('meeting') ? 'meeting' : 'standard',
  };
}

function toIsoOrNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Легаси UpdateTaskDto → тело PATCH /tasks/:id. Статус сюда не входит — см. updateTask. */
export function toUpdateTaskPayload(dto: UpdateTaskDto): UpdateTaskV2Payload {
  const payload: UpdateTaskV2Payload = {};
  if (dto.title !== undefined) payload.title = dto.title;
  if (dto.description !== undefined) payload.description = dto.description;
  if (dto.priority !== undefined) {
    payload.isUrgent = dto.priority === TaskPriority.URGENT_IMPORTANT || dto.priority === TaskPriority.URGENT_NOT_IMPORTANT;
    payload.isImportant = dto.priority === TaskPriority.URGENT_IMPORTANT || dto.priority === TaskPriority.NOT_URGENT_IMPORTANT;
  }
  const startAt = toIsoOrNull(dto.startDate);
  if (startAt !== undefined) payload.startAt = startAt;
  const dueAt = toIsoOrNull(dto.endDate);
  if (dueAt !== undefined) payload.dueAt = dueAt;
  if (dto.colorLabel !== undefined) {
    const stored = toStoredColor(dto.colorLabel);
    payload.colorHex = stored && HEX_COLOR.test(stored) ? stored : null;
  }
  Object.assign(payload, categoryFields(dto.categories, dto.category));
  if (dto.leadId !== undefined) payload.leadId = dto.leadId;
  if (dto.subtasks !== undefined) payload.subtasks = toSubtasksV2(dto.subtasks);
  return payload;
}

function toSubtasksV2(subtasks: Subtask[]) {
  const stamp = Date.now();
  return subtasks.map((s, index) => ({ id: `sub-${stamp}-${index}`, title: s.title, done: !!s.completed }));
}

function failure<T>(error: unknown): ApiResponse<T> {
  const err = error as { response?: { data?: { message?: string } }; message?: string };
  return { success: false, message: err.response?.data?.message || err.message || 'Ошибка запроса' };
}

function toFiles(task: TaskV2): TaskFile[] {
  return task.attachments.map((a) => ({ filename: a.assetId, originalName: a.fileName, mimeType: '', size: 0, url: '' }));
}

/**
 * Каждая правка перечитывает версию задачи прямо перед PATCH: версии этих же
 * задач ведёт и useCrmData, и держать здесь свою копию значило бы ловить
 * ложные 409. Правка отправляет только изменённые поля, так что остальные
 * поля чужой правкой не затираются.
 */
async function patch(taskId: string, payload: UpdateTaskV2Payload): Promise<TaskV2> {
  const current = await tasksApiV2.getById(taskId);
  return tasksApiV2.update(taskId, current.version, payload);
}

export const crmTaskService = {
  async getTasks(params?: { assignedTo?: string; page?: number; limit?: number }): Promise<ApiResponse<PaginatedResult<Task>>> {
    try {
      const { tasks } = await listCrmTasks(params?.assignedTo);
      return { success: true, data: { items: tasks, total: tasks.length, page: 1, totalPages: 1 } };
    } catch (error) {
      return failure(error);
    }
  },

  async getTask(taskId: string): Promise<ApiResponse<Task>> {
    try {
      return { success: true, data: mapTaskV2ToCrmTask(await tasksApiV2.getById(taskId)) };
    } catch (error) {
      return failure(error);
    }
  },

  async updateTask(taskId: string, dto: UpdateTaskDto): Promise<ApiResponse<Task>> {
    try {
      const payload = toUpdateTaskPayload(dto);
      let updated = Object.keys(payload).length > 0 ? await patch(taskId, payload) : await tasksApiV2.getById(taskId);
      if (dto.status !== undefined) updated = await setCrmTaskStatus(taskId, updated.version, dto.status);
      return { success: true, data: mapTaskV2ToCrmTask(updated) };
    } catch (error) {
      return failure(error);
    }
  },

  async addSubtask(taskId: string, subtask: Subtask): Promise<ApiResponse<Task>> {
    try {
      const current = await tasksApiV2.getById(taskId);
      const subtasks = [...current.subtasks, { id: `sub-${Date.now()}`, title: subtask.title, done: !!subtask.completed }];
      return { success: true, data: mapTaskV2ToCrmTask(await tasksApiV2.update(taskId, current.version, { subtasks })) };
    } catch (error) {
      return failure(error);
    }
  },

  async updateSubtaskStatus(taskId: string, subtaskIndex: number, completed: boolean): Promise<ApiResponse<Task>> {
    try {
      const current = await tasksApiV2.getById(taskId);
      const subtasks = current.subtasks.map((s, index) => (index === subtaskIndex ? { ...s, done: completed } : s));
      return { success: true, data: mapTaskV2ToCrmTask(await tasksApiV2.update(taskId, current.version, { subtasks })) };
    } catch (error) {
      return failure(error);
    }
  },

  async deleteSubtask(taskId: string, subtaskIndex: number): Promise<ApiResponse<Task>> {
    try {
      const current = await tasksApiV2.getById(taskId);
      const subtasks = current.subtasks.filter((_, index) => index !== subtaskIndex);
      return { success: true, data: mapTaskV2ToCrmTask(await tasksApiV2.update(taskId, current.version, { subtasks })) };
    } catch (error) {
      return failure(error);
    }
  },

  async getTaskFiles(taskId: string): Promise<ApiResponse<{ files: TaskFile[]; count: number }>> {
    try {
      const files = toFiles(await tasksApiV2.getById(taskId));
      return { success: true, data: { files, count: files.length } };
    } catch (error) {
      return failure(error);
    }
  },

  /** Файлы — в хранилище платформы (task_attachment), затем дописываются к вложениям задачи. */
  async uploadTaskFiles(taskId: string, files: File[]): Promise<ApiResponse<Task>> {
    try {
      const uploaded: TaskAttachmentV2[] = [];
      for (const file of files) {
        const { assetId } = await mediaApiV2.uploadFile(file, 'task_attachment');
        uploaded.push({ assetId, fileName: file.name });
      }
      const current = await tasksApiV2.getById(taskId);
      const updated = await tasksApiV2.update(taskId, current.version, { attachments: [...current.attachments, ...uploaded] });
      return { success: true, data: mapTaskV2ToCrmTask(updated) };
    } catch (error) {
      return failure(error);
    }
  },

  /** `filename` у файла задачи — это assetId (см. mapTaskV2ToCrmTask). */
  async deleteTaskFileByName(taskId: string, filename: string): Promise<ApiResponse<{ task: Task; message: string }>> {
    try {
      const current = await tasksApiV2.getById(taskId);
      const attachments = current.attachments.filter((a) => a.assetId !== filename);
      const updated = await tasksApiV2.update(taskId, current.version, { attachments });
      return { success: true, data: { task: mapTaskV2ToCrmTask(updated), message: '' } };
    } catch (error) {
      return failure(error);
    }
  },

  getAttachmentUrl(taskId: string, assetId: string): Promise<{ url: string; fileName: string }> {
    return tasksApiV2.getAttachmentDownloadUrl(taskId, assetId);
  },

  /** Своих категорий у платформы нет: карточка получает фиксированные через getOrCreateTaskCategory. */
  async getTaskCategories(): Promise<ApiResponse<Category[]>> {
    return { success: true, data: [] };
  },

  async getOrCreateTaskCategory(name: string): Promise<ApiResponse<Category>> {
    const bucket = bucketOf(name);
    if (!bucket) return { success: false, message: 'Такой категории задач нет' };
    return { success: true, data: { _id: String(BUCKET_ID[bucket]), id: BUCKET_ID[bucket], name } };
  },

  async getLeads(): Promise<ApiResponse<PaginatedResult<Lead>>> {
    try {
      const { items } = await leadsApiV2.listAll();
      const leads = items.map(mapLeadV2ToCrmLead);
      return { success: true, data: { items: leads, total: leads.length, page: 1, totalPages: 1 } };
    } catch (error) {
      return failure(error);
    }
  },
};
