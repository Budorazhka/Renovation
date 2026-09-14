import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type {
  CreateTaskV2Payload,
  ListTasksV2Params,
  ListTasksV2Response,
  TaskSubtaskV2,
  TaskV2,
  UpdateTaskV2Payload,
} from '@/types/tasksV2'

export * from '@/types/tasksV2'

/**
 * Изолированный клиент к API задач BAZA
 * (apps/api/src/modules/crm/task.controller.ts).
 *
 * Эндпоинты:
 * - GET   /api/v1/tasks?status=&assignedPositionId=&limit=<1..100>
 * - POST  /api/v1/tasks                     (требует заголовок Idempotency-Key)
 * - POST  /api/v1/tasks/:taskId/complete    body: { expectedVersion }
 * - PATCH /api/v1/tasks/:taskId             body: { expectedVersion, status?, ... }
 *
 * Авторизация только через cookie (withCredentials: true). Организация,
 * создатель и область видимости выводятся сервером из сессии — клиент их не
 * передаёт (conventions.md §7).
 *
 * Ошибки НЕ проглатываются: вызывающий код обязан показать отказ, а не
 * подставить выдуманные данные вместо ответа сервера.
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

/**
 * Ключ идемпотентности: повтор отправки той же формы (двойной клик, ретрай
 * после обрыва) не должен создавать вторую задачу. Генерируется один раз на
 * попытку отправки, а не на каждый HTTP-запрос.
 */
/** Предел одного запроса на стороне сервера (MAX_TASK_LIST_LIMIT). */
const TASKS_PER_REQUEST = 100

/**
 * Сколько страниц дочитываем, прежде чем признать реестр слишком большим для
 * разового чтения. Предел нужен, чтобы одна организация с десятками тысяч
 * задач не вешала экран бесконечным опросом; при упоре в него интерфейс
 * обязан сказать, что показаны не все задачи, а не молчать.
 */
const MAX_TASK_PAGES = 20

export function newIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const tasksApiV2 = {
  /** GET /api/v1/tasks */
  async list(params?: ListTasksV2Params): Promise<ListTasksV2Response> {
    const { data } = await api.get<ListTasksV2Response>('/api/v1/tasks', { params })
    return data
  },

  /**
   * Все задачи, а не первая страница. Сервер отдаёт максимум 100 записей за
   * запрос и `nextCursor`, если есть ещё; экран показывает реестр целиком, и
   * взять только первую страницу значило бы выдать часть за всё: у
   * организации со 120 задачами двадцать старших молча исчезли бы из вкладок,
   * счётчиков и архива, ничем себя не обозначив.
   *
   * `complete: false` означает, что упёрлись в предел страниц и показаны не
   * все задачи. Это состояние обязано быть видно пользователю — молчаливая
   * половина реестра ничем не лучше молчаливого мока.
   */
  async listAll(
    params?: Omit<ListTasksV2Params, 'cursor'>,
    maxPages = MAX_TASK_PAGES,
  ): Promise<{ items: TaskV2[]; complete: boolean }> {
    const items: TaskV2[] = []
    let cursor: string | undefined
    let complete = false

    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.list({ ...params, limit: TASKS_PER_REQUEST, cursor })
      items.push(...response.items)
      if (!response.nextCursor) {
        complete = true
        break
      }
      cursor = response.nextCursor
    }

    return { items, complete }
  },

  /** GET /api/v1/tasks/:taskId */
  async getById(taskId: string): Promise<TaskV2> {
    const { data } = await api.get<TaskV2>(`/api/v1/tasks/${taskId}`)
    return data
  },

  /** POST /api/v1/tasks. Заголовок Idempotency-Key обязателен — без него 400. */
  async create(payload: CreateTaskV2Payload, idempotencyKey: string): Promise<TaskV2> {
    const { data } = await api.post<TaskV2>('/api/v1/tasks', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return data
  },

  /**
   * POST /api/v1/tasks/:taskId/complete. expectedVersion — прочитанная
   * клиентом version задачи: backend отклонит запрос с 409 VERSION_CONFLICT,
   * если задача изменилась с момента чтения. Вызывающий код должен перечитать
   * задачу, а не считать это фатальной ошибкой.
   */
  async complete(taskId: string, expectedVersion: number): Promise<TaskV2> {
    const { data } = await api.post<TaskV2>(`/api/v1/tasks/${taskId}/complete`, { expectedVersion })
    return data
  },

  /**
   * Смена статуса — PATCH. Отдельных эндпоинтов reopen/start на сервере нет,
   * и заводить их ради двух кнопок не нужно: PATCH умеет ровно эти переходы.
   *
   * `completed` сюда не передаётся: завершение — команда `complete`, она
   * пишет `completedAt`, `completedByPositionId` и событие `TaskCompleted`.
   */
  async setStatus(
    taskId: string,
    expectedVersion: number,
    status: 'open' | 'in_progress' | 'cancelled',
  ): Promise<TaskV2> {
    const { data } = await api.patch<TaskV2>(`/api/v1/tasks/${taskId}`, { expectedVersion, status })
    return data
  },

  /**
   * Смена срока — PATCH (UpdateTaskDto.dueAt на бэкенде уже принимает это
   * поле, отдельного эндпоинта под него нет и не нужно — тот же принцип, что
   * setStatus/setSubtasks: разные тонкие обёртки над одним PATCH ради
   * называемых по смыслу вызовов на стороне экрана).
   */
  async setDueAt(taskId: string, expectedVersion: number, dueAt: string | undefined): Promise<TaskV2> {
    const { data } = await api.patch<TaskV2>(`/api/v1/tasks/${taskId}`, { expectedVersion, dueAt })
    return data
  },

  /** Правка задачи одним PATCH — любые поля UpdateTaskV2Payload. */
  async update(taskId: string, expectedVersion: number, payload: UpdateTaskV2Payload): Promise<TaskV2> {
    const { data } = await api.patch<TaskV2>(`/api/v1/tasks/${taskId}`, { ...payload, expectedVersion })
    return data
  },

  /** GET /api/v1/tasks/:taskId/attachments/:assetId/download — временная ссылка на файл. */
  async getAttachmentDownloadUrl(taskId: string, assetId: string): Promise<{ url: string; fileName: string }> {
    const { data } = await api.get<{ url: string; fileName: string }>(
      `/api/v1/tasks/${taskId}/attachments/${assetId}/download`,
    )
    return data
  },

  /**
   * Подзадачи заменяются целиком: сервер принимает полный список, а не
   * поштучные операции. Экран всегда держит их все, поэтому отправлять
   * различия было бы сложнее, чем отправить список.
   */
  async setSubtasks(
    taskId: string,
    expectedVersion: number,
    subtasks: TaskSubtaskV2[],
  ): Promise<TaskV2> {
    const { data } = await api.patch<TaskV2>(`/api/v1/tasks/${taskId}`, { expectedVersion, subtasks })
    return data
  },

  /**
   * Смена исполнителя — отдельный эндпоинт и отдельное право `task.reassign`,
   * не `task.edit`: у менеджера может быть право править свою задачу и не быть
   * права передать её другому.
   *
   * `null` — снять назначение.
   */
  async reassign(
    taskId: string,
    expectedVersion: number,
    assignedPositionId: string | null,
  ): Promise<TaskV2> {
    const { data } = await api.patch<TaskV2>(`/api/v1/tasks/${taskId}/reassign`, {
      expectedVersion,
      assignedPositionId,
    })
    return data
  },
}
