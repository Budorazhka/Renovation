import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  listAll: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
}
const uploadFile = vi.fn()

vi.mock('@/services/notesApiV2', () => ({ notesApiV2: api }))
vi.mock('@/services/mediaApiV2', () => ({ mediaApiV2: { uploadFile } }))

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    organizationId: 'org-1',
    authorPositionId: 'pos-1',
    title: 'Позвонить в банк',
    content: 'по ипотеке',
    isPinned: false,
    category: 'personal',
    leadId: null,
    attachments: [],
    version: 2,
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

async function loadService() {
  return (await import('@/features/crm/services/notesV2')).notesService
}

describe('notesService — заметки платформы в легаси-форме NotesBlock', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    uploadFile.mockReset()
  })

  it('список: категория personal → 1, work → 2, вложения → files, автор → createdBy', async () => {
    api.listAll.mockResolvedValue({
      items: [
        makeNote(),
        makeNote({ id: 'note-2', category: 'work', attachments: [{ assetId: 'a-1', fileName: 'договор.pdf' }] }),
      ],
      complete: true,
    })
    const service = await loadService()

    const res = await service.getNotes()

    expect(res.success).toBe(true)
    expect(res.data!.items.map((n) => n.category)).toEqual([1, 2])
    expect(res.data!.items[1].files).toEqual([{ filename: 'a-1', originalName: 'договор.pdf', mimeType: '', size: 0, url: '' }])
    expect(res.data!.items[0].createdBy).toBe('pos-1')
  })

  it('создание: легаси-категория 2 уходит как work, лид передаётся', async () => {
    api.create.mockResolvedValue(makeNote({ category: 'work', leadId: 'lead-1' }))
    const service = await loadService()

    const res = await service.createNote({ title: 'Позвонить в банк', content: 'по ипотеке', category: 2, leadId: 'lead-1' })

    expect(api.create).toHaveBeenCalledWith({ title: 'Позвонить в банк', content: 'по ипотеке', category: 'work', leadId: 'lead-1' })
    expect(res.data!.leadId).toBe('lead-1')
  })

  it('правка передаёт последнюю известную версию; закрепление — через isPinned', async () => {
    api.getById.mockResolvedValue(makeNote({ version: 5 }))
    api.update.mockResolvedValue(makeNote({ version: 6, isPinned: true }))
    const service = await loadService()

    await service.getNote('note-1')
    await service.pinNote('note-1', true)

    expect(api.update).toHaveBeenCalledWith('note-1', 5, { isPinned: true })
  })

  it('отвязка от лида: leadId null передаётся как null', async () => {
    api.update.mockResolvedValue(makeNote())
    const service = await loadService()

    await service.updateNote('note-1', { leadId: null })

    expect(api.update.mock.calls[0]![2]).toEqual({ leadId: null })
  })

  it('загрузка файлов: каждый файл в хранилище как note_attachment, затем дописываются к вложениям', async () => {
    api.getById.mockResolvedValue(makeNote({ version: 3, attachments: [{ assetId: 'a-old', fileName: 'старый.pdf' }] }))
    uploadFile.mockResolvedValueOnce({ assetId: 'a-new' })
    api.update.mockImplementation(async (_id, _version, payload) => makeNote({ version: 4, attachments: payload.attachments }))
    const service = await loadService()

    const res = await service.uploadNoteFiles('note-1', [new File(['x'], 'новый.png', { type: 'image/png' })])

    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), 'note_attachment')
    expect(api.update).toHaveBeenCalledWith('note-1', 3, {
      attachments: [{ assetId: 'a-old', fileName: 'старый.pdf' }, { assetId: 'a-new', fileName: 'новый.png' }],
    })
    expect(res.data!.files).toHaveLength(2)
  })

  it('удаление файла по индексу убирает именно его', async () => {
    api.getById.mockResolvedValue(makeNote({
      version: 7,
      attachments: [{ assetId: 'a-1', fileName: '1.pdf' }, { assetId: 'a-2', fileName: '2.pdf' }],
    }))
    api.update.mockResolvedValue(makeNote())
    const service = await loadService()

    await service.deleteNoteFileByIndex('note-1', 0)

    expect(api.update).toHaveBeenCalledWith('note-1', 7, { attachments: [{ assetId: 'a-2', fileName: '2.pdf' }] })
  })

  it('ошибка сервера возвращается как success:false с его сообщением, а не бросается', async () => {
    api.update.mockRejectedValue({ response: { data: { message: 'Note was modified by another request' } } })
    const service = await loadService()

    const res = await service.updateNote('note-1', { title: 'x' })

    expect(res).toEqual({ success: false, message: 'Note was modified by another request' })
  })
})
