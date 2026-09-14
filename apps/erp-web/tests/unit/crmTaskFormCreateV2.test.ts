/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()
const uploadFileMock = vi.fn()
const legacyCreateTaskMock = vi.fn()

vi.mock('@/services/tasksApiV2', () => ({
  tasksApiV2: { create: createMock },
  newIdempotencyKey: () => 'idem-key',
}))

vi.mock('@/services/mediaApiV2', () => ({
  mediaApiV2: { uploadFile: uploadFileMock },
}))

vi.mock('@/features/crm/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/crm/services/api')>()
  return { ...actual, apiService: { ...actual.apiService, createTask: legacyCreateTaskMock } }
})

function makeTaskV2(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-new',
    organizationId: 'org-1',
    title: 'Позвонить клиенту',
    description: null,
    status: 'open',
    dueAt: null,
    startAt: null,
    isUrgent: true,
    isImportant: true,
    priority: 'critical',
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
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('useCrmTaskForm — создание задачи на tasksApiV2', () => {
  const addTask = vi.fn()
  const loadTasks = vi.fn()

  beforeEach(() => {
    createMock.mockReset().mockResolvedValue(makeTaskV2())
    uploadFileMock.mockReset()
    legacyCreateTaskMock.mockReset()
    addTask.mockReset()
    loadTasks.mockReset().mockResolvedValue(undefined)
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  async function renderForm() {
    const { useCrmTaskForm } = await import('@/features/crm/pages/crm/hooks/useCrmTaskForm')
    const data = {
      backendTasks: [],
      taskSync: { addTask, updateTask: vi.fn(), updateTaskAfterSync: vi.fn() },
      taskCategoriesMap: new Map<number, string>(),
      setTaskCategoriesMap: vi.fn(),
      loadTasks,
    }
    return renderHook(() => useCrmTaskForm({ data: data as never, user: { id: 'pos-1' } }))
  }

  it('отправляет POST /tasks с парой срочно/важно, категорией, сроками, подзадачами, лидом и исполнителем', async () => {
    const { result } = await renderForm()
    const { TaskPriority } = await import('@/features/crm/services/api')

    await act(async () => {
      await result.current.createBackendTask(
        'Позвонить клиенту',
        'Уточнить бюджет',
        TaskPriority.URGENT_NOT_IMPORTANT,
        [{ title: 'Найти номер', completed: true }],
        'lead-1',
        '2026-09-15T06:00:00.000Z',
        '2026-09-15T07:00:00.000Z',
        '#169600',
        ['Личные задачи'],
      )
    })

    expect(legacyCreateTaskMock).not.toHaveBeenCalled()
    expect(createMock).toHaveBeenCalledTimes(1)
    const [payload, key] = createMock.mock.calls[0]!
    expect(key).toBe('idem-key')
    expect(payload).toMatchObject({
      title: 'Позвонить клиенту',
      description: 'Уточнить бюджет',
      isUrgent: true,
      isImportant: false,
      taskCategory: 'personal',
      startAt: '2026-09-15T06:00:00.000Z',
      dueAt: '2026-09-15T07:00:00.000Z',
      colorHex: '#169600',
      assignedPositionId: 'pos-1',
      leadId: 'lead-1',
    })
    expect(payload.subtasks).toHaveLength(1)
    expect(payload.subtasks[0]).toMatchObject({ title: 'Найти номер', done: true })
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({ _id: 'task-new' }))
  })

  it('невалидный цвет не отправляется (сервер принимает только #rrggbb)', async () => {
    const { result } = await renderForm()
    const { TaskPriority } = await import('@/features/crm/services/api')

    await act(async () => {
      await result.current.createBackendTask('Задача', '', TaskPriority.NOT_URGENT_NOT_IMPORTANT, [], undefined, undefined, undefined, 'green')
    })

    expect(createMock.mock.calls[0]![0]).toMatchObject({ colorHex: null, isUrgent: false, isImportant: false, taskCategory: 'work' })
  })

  it('ошибка сервера — задача не добавляется в список, пользователь видит сообщение', async () => {
    createMock.mockRejectedValue({ response: { data: { message: 'Validation failed' } } })
    const { result } = await renderForm()
    const { TaskPriority } = await import('@/features/crm/services/api')

    let created: unknown = 'not-called'
    await act(async () => {
      created = await result.current.createBackendTask('Задача', '', TaskPriority.NOT_URGENT_NOT_IMPORTANT, [])
    })

    expect(created).toBeNull()
    expect(addTask).not.toHaveBeenCalled()
    expect(window.alert).toHaveBeenCalledWith('Ошибка: Validation failed')
  })
})
