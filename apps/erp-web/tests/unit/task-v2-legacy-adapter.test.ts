/**
 * Адаптер TaskV2 → легаси Task (LeadViewModal.tsx/TaskCard/TaskViewModal).
 * Проверяется маппинг статуса/приоритета/подзадач/вложений — см. докстринг
 * lib/task-v2-legacy-adapter.ts.
 */

import { describe, expect, it } from 'vitest'
import { TaskPriority, TaskStatus } from '@/features/crm/services/api/types'
import { mapTaskV2ToCrmTask } from '@/lib/task-v2-legacy-adapter'
import type { TaskV2 } from '@/types/tasksV2'

function makeTask(overrides: Partial<TaskV2> = {}): TaskV2 {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    title: 'Позвонить клиенту',
    description: null,
    status: 'open',
    dueAt: null,
    startAt: null,
    isUrgent: false,
    isImportant: false,
    priority: 'low',
    taskCategory: 'work',
    colorHex: null,
    reminderOffsetsMinutes: [],
    subtasks: [],
    attachments: [],
    attachmentFileNames: [],
    entityType: 'lead',
    entityId: 'lead-1',
    isAutomatic: false,
    triggerType: null,
    assignedPositionId: null,
    createdByPositionId: null,
    leadId: 'lead-1',
    contactId: null,
    completedAt: null,
    completedByPositionId: null,
    isOverdue: false,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('task-v2-legacy-adapter', () => {
  it('маппит статус: open/in_progress/completed/cancelled → легаси TaskStatus', () => {
    expect(mapTaskV2ToCrmTask(makeTask({ status: 'open' })).status).toBe(TaskStatus.PENDING)
    expect(mapTaskV2ToCrmTask(makeTask({ status: 'in_progress' })).status).toBe(TaskStatus.IN_PROGRESS)
    expect(mapTaskV2ToCrmTask(makeTask({ status: 'completed' })).status).toBe(TaskStatus.COMPLETED)
    expect(mapTaskV2ToCrmTask(makeTask({ status: 'cancelled' })).status).toBe(TaskStatus.CANCELLED)
  })

  it('маппит приоритет из пары isUrgent/isImportant (не из строкового priority)', () => {
    expect(mapTaskV2ToCrmTask(makeTask({ isUrgent: true, isImportant: true })).priority).toBe(TaskPriority.URGENT_IMPORTANT)
    expect(mapTaskV2ToCrmTask(makeTask({ isUrgent: false, isImportant: true })).priority).toBe(TaskPriority.NOT_URGENT_IMPORTANT)
    expect(mapTaskV2ToCrmTask(makeTask({ isUrgent: true, isImportant: false })).priority).toBe(TaskPriority.URGENT_NOT_IMPORTANT)
    expect(mapTaskV2ToCrmTask(makeTask({ isUrgent: false, isImportant: false })).priority).toBe(TaskPriority.NOT_URGENT_NOT_IMPORTANT)
  })

  it('категория задачи сохраняется: work → «Рабочие задачи», personal → «Личные задачи»', () => {
    expect(mapTaskV2ToCrmTask(makeTask({ taskCategory: 'work' })).categories).toEqual(['Рабочие задачи'])
    expect(mapTaskV2ToCrmTask(makeTask({ taskCategory: 'personal' })).categories).toEqual(['Личные задачи'])
  })

  it('маппит подзадачи done→completed', () => {
    const task = makeTask({ subtasks: [{ id: 's-1', title: 'Уточнить бюджет', done: true }, { id: 's-2', title: 'Отправить КП', done: false }] })
    const crmTask = mapTaskV2ToCrmTask(task)
    expect(crmTask.subtasks).toEqual([
      { title: 'Уточнить бюджет', completed: true },
      { title: 'Отправить КП', completed: false },
    ])
  })

  it('честный пробел: вложения переносят имя/assetId, но url/mimeType/size пусты (backend их не резолвит)', () => {
    const task = makeTask({ attachments: [{ assetId: 'asset-1', fileName: 'contract.pdf' }] })
    const crmTask = mapTaskV2ToCrmTask(task)
    expect(crmTask.files).toEqual([{ filename: 'asset-1', originalName: 'contract.pdf', mimeType: '', size: 0, url: '' }])
    expect(crmTask.hasFiles).toBe(true)
  })

  it('leadId/dueAt/startAt переносятся как есть (endDate ← dueAt, startDate ← startAt)', () => {
    const task = makeTask({ leadId: 'lead-42', dueAt: '2026-09-10T12:00:00.000Z', startAt: '2026-09-05T09:00:00.000Z' })
    const crmTask = mapTaskV2ToCrmTask(task)
    expect(crmTask.leadId).toBe('lead-42')
    expect(crmTask.endDate).toBe('2026-09-10T12:00:00.000Z')
    expect(crmTask.startDate).toBe('2026-09-05T09:00:00.000Z')
  })
})
