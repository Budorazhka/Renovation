import { beforeEach, describe, expect, it, vi } from 'vitest'

const tasksApi = {
  listAll: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  setStatus: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
}
const uploadFile = vi.fn()

vi.mock('@/services/tasksApiV2', () => ({ tasksApiV2: tasksApi }))
vi.mock('@/services/mediaApiV2', () => ({ mediaApiV2: { uploadFile } }))

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1', organizationId: 'org-1', title: 'Задача', description: null, status: 'open',
    dueAt: null, startAt: null, isUrgent: false, isImportant: false, priority: 'low',
    taskCategory: 'work', taskType: 'standard', colorHex: null, reminderOffsetsMinutes: [],
    subtasks: [], attachments: [], attachmentFileNames: [], entityType: 'none', entityId: null,
    isAutomatic: false, triggerType: null, assignedPositionId: 'pos-1', createdByPositionId: 'pos-1',
    leadId: null, contactId: null, completedAt: null, completedByPositionId: null, isOverdue: false,
    version: 4, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: null,
    ...overrides,
  }
}

async function load() {
  return import('@/features/crm/services/crmTasksV2')
}

describe('crmTasksV2 — карточка задачи классической CRM на tasksApiV2', () => {
  beforeEach(() => {
    Object.values(tasksApi).forEach((fn) => fn.mockReset())
    uploadFile.mockReset()
  })

  it('приоритет → пара срочно/важно', async () => {
    const { toUpdateTaskPayload } = await load()
    const { TaskPriority } = await import('@/features/crm/services/api')
    expect(toUpdateTaskPayload({ priority: TaskPriority.URGENT_NOT_IMPORTANT })).toEqual({ isUrgent: true, isImportant: false })
    expect(toUpdateTaskPayload({ priority: TaskPriority.NOT_URGENT_IMPORTANT })).toEqual({ isUrgent: false, isImportant: true })
  })

  it('категории распознаются на любом языке интерфейса: вид задачи + рабочая/личная', async () => {
    const { toUpdateTaskPayload } = await load()
    expect(toUpdateTaskPayload({ categories: ['Звонок', 'Личные задачи'] })).toEqual({ taskType: 'call', taskCategory: 'personal' })
    const { en } = await import('@/i18n/dictionaries/en')
    expect(toUpdateTaskPayload({ categories: [en.taskViewModal!.meeting!, en.taskViewModal!.workTasks!] }))
      .toEqual({ taskType: 'meeting', taskCategory: 'work' })
    expect(toUpdateTaskPayload({ categories: ['Рабочие задачи'] })).toEqual({ taskType: 'standard', taskCategory: 'work' })
  })

  it('даты уходят в ISO, пустая дата — снятие (null); невалидный цвет — снятие', async () => {
    const { toUpdateTaskPayload } = await load()
    const local = '2026-09-15T09:30:00'
    expect(toUpdateTaskPayload({ startDate: local })).toEqual({ startAt: new Date(local).toISOString() })
    expect(toUpdateTaskPayload({ endDate: '' })).toEqual({ dueAt: null })
    expect(toUpdateTaskPayload({ colorLabel: '#AABBCC' })).toEqual({ colorHex: '#AABBCC' })
    expect(toUpdateTaskPayload({ colorLabel: 'var(--gold)' })).toEqual({ colorHex: '#e6c364' })
    expect(toUpdateTaskPayload({ colorLabel: 'зелёный' })).toEqual({ colorHex: null })
  })

  it('правка перечитывает версию перед PATCH и отправляет только изменённое поле', async () => {
    tasksApi.getById.mockResolvedValue(makeTask({ version: 9 }))
    tasksApi.update.mockResolvedValue(makeTask({ version: 10, title: 'Новое название' }))
    const { crmTaskService } = await load()

    const res = await crmTaskService.updateTask('task-1', { title: 'Новое название' })

    expect(tasksApi.update).toHaveBeenCalledWith('task-1', 9, { title: 'Новое название' })
    expect(res.data!.title).toBe('Новое название')
  })

  it('завершение идёт отдельной командой complete, не PATCH status', async () => {
    tasksApi.getById.mockResolvedValue(makeTask({ version: 2 }))
    tasksApi.complete.mockResolvedValue(makeTask({ version: 3, status: 'completed' }))
    const { crmTaskService } = await load()
    const { TaskStatus } = await import('@/features/crm/services/api')

    await crmTaskService.updateTask('task-1', { status: TaskStatus.COMPLETED })

    expect(tasksApi.update).not.toHaveBeenCalled()
    expect(tasksApi.complete).toHaveBeenCalledWith('task-1', 2)
  })

  it('подзадача отмечается выполненной по индексу, остальные не трогаются', async () => {
    tasksApi.getById.mockResolvedValue(makeTask({
      subtasks: [{ id: 's1', title: 'A', done: false }, { id: 's2', title: 'B', done: false }],
    }))
    tasksApi.update.mockResolvedValue(makeTask())
    const { crmTaskService } = await load()

    await crmTaskService.updateSubtaskStatus('task-1', 1, true)

    expect(tasksApi.update).toHaveBeenCalledWith('task-1', 4, {
      subtasks: [{ id: 's1', title: 'A', done: false }, { id: 's2', title: 'B', done: true }],
    })
  })

  it('файл: загрузка как task_attachment и дописывание к вложениям; удаление по assetId', async () => {
    tasksApi.getById.mockResolvedValue(makeTask({ attachments: [{ assetId: 'a-1', fileName: '1.pdf' }] }))
    uploadFile.mockResolvedValueOnce({ assetId: 'a-2' })
    tasksApi.update.mockResolvedValue(makeTask())
    const { crmTaskService } = await load()

    await crmTaskService.uploadTaskFiles('task-1', [new File(['x'], '2.pdf')])
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), 'task_attachment')
    expect(tasksApi.update).toHaveBeenLastCalledWith('task-1', 4, {
      attachments: [{ assetId: 'a-1', fileName: '1.pdf' }, { assetId: 'a-2', fileName: '2.pdf' }],
    })

    await crmTaskService.deleteTaskFileByName('task-1', 'a-1')
    expect(tasksApi.update).toHaveBeenLastCalledWith('task-1', 4, { attachments: [] })
  })

  it('категория, которой нет среди четырёх фиксированных, не создаётся', async () => {
    const { crmTaskService } = await load()
    expect((await crmTaskService.getOrCreateTaskCategory('Звонок')).data).toMatchObject({ id: 1, name: 'Звонок' })
    expect((await crmTaskService.getOrCreateTaskCategory('Моя категория')).success).toBe(false)
  })
})
