import { beforeEach, describe, expect, it, vi } from 'vitest'

const listOrganization = vi.fn()
const listPersonal = vi.fn()
const listFolders = vi.fn()
const createItem = vi.fn()
const deleteFolder = vi.fn()
const attachFile = vi.fn()
const uploadFile = vi.fn()
// Отказ сервера отдаёт обычная функция: промис из обёртки vi.fn vitest считает необработанным.
let rejectDeleteFolderWith: unknown = null

vi.mock('@/services/libraryApiV2', () => ({
  libraryApiV2: {
    listOrganization: (...args: unknown[]) => listOrganization(...args),
    listPersonal: (...args: unknown[]) => listPersonal(...args),
    listFolders: (...args: unknown[]) => listFolders(...args),
    createItem: (...args: unknown[]) => createItem(...args),
    deleteFolder: (...args: unknown[]) =>
      rejectDeleteFolderWith ? Promise.reject(rejectDeleteFolderWith) : deleteFolder(...args),
    deleteItem: vi.fn(),
    getDownloadUrl: vi.fn(),
  },
}))

vi.mock('@/services/leadsApiV2', () => ({
  leadsApiV2: { attachFile: (...args: unknown[]) => attachFile(...args) },
}))

vi.mock('@/services/mediaApiV2', () => ({
  mediaApiV2: { uploadFile: (...args: unknown[]) => uploadFile(...args) },
}))

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    scope: 'organization',
    productType: 'sales',
    folderId: null,
    assetId: 'asset-1',
    fileName: 'Презентация.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    createdByPositionId: 'pos-1',
    createdAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  }
}

async function facade() {
  const { libraryCrmService } = await import('@/features/crm/services/libraryCrmV2')
  const { ProductType } = await import('@/features/crm/services/api')
  return { libraryCrmService, ProductType }
}

describe('libraryCrmService — библиотека платформы в легаси-форме', () => {
  beforeEach(() => {
    for (const fn of [listOrganization, listPersonal, listFolders, createItem, deleteFolder, attachFile, uploadFile]) fn.mockReset()
    rejectDeleteFolderWith = null
  })

  it('общие материалы: продукт переводится в платформенный, _id — id материала, filename — assetId, canUpload с сервера', async () => {
    const { libraryCrmService, ProductType } = await facade()
    listOrganization.mockResolvedValue({ items: [item()], canUpload: true })

    const res = await libraryCrmService.getBaseFiles(ProductType.NETWORK)

    expect(listOrganization).toHaveBeenCalledWith('network')
    expect(res.success).toBe(true)
    expect(res.data?.canUpload).toBe(true)
    expect(res.data?.files[0]).toEqual(
      expect.objectContaining({ _id: 'item-1', filename: 'asset-1', originalName: 'Презентация.pdf', size: 2048, url: '' }),
    )
  })

  it('прикрепление к лиду передаёт assetId и имя материала из последнего списка', async () => {
    const { libraryCrmService, ProductType } = await facade()
    listOrganization.mockResolvedValue({ items: [item({ id: 'item-7', assetId: 'asset-7', fileName: 'КП.pdf' })], canUpload: false })
    attachFile.mockResolvedValue([])
    await libraryCrmService.getBaseFiles(ProductType.SALES)

    const res = await libraryCrmService.attachBaseFilesToLead('lead-1', ['item-7'])

    expect(res).toEqual({ success: true, data: { attachedCount: 1 } })
    expect(attachFile).toHaveBeenCalledWith('lead-1', 'asset-7', 'КП.pdf')
  })

  it('неизвестный материал не прикрепляется — ошибка с просьбой обновить список', async () => {
    const { libraryCrmService } = await facade()

    const res = await libraryCrmService.attachLibraryFilesToLead('lead-1', ['missing'])

    expect(res.success).toBe(false)
    expect(res.message).toMatch(/обновите список/)
    expect(attachFile).not.toHaveBeenCalled()
  })

  it('загрузка в личную библиотеку: файл в хранилище как library_file, затем материал в текущей папке', async () => {
    const { libraryCrmService } = await facade()
    uploadFile.mockResolvedValue({ assetId: 'asset-9' })
    createItem.mockResolvedValue(item({ id: 'item-9', scope: 'personal' }))
    const file = new File(['%PDF'], 'Скрипт.pdf', { type: 'application/pdf' })

    const res = await libraryCrmService.uploadLibraryFiles([file], 'folder-1')

    expect(res.success).toBe(true)
    expect(uploadFile).toHaveBeenCalledWith(file, 'library_file')
    expect(createItem).toHaveBeenCalledWith({ scope: 'personal', assetId: 'asset-9', fileName: 'Скрипт.pdf', folderId: 'folder-1' })
  })

  it('загрузка в общие материалы указывает продукт', async () => {
    const { libraryCrmService, ProductType } = await facade()
    uploadFile.mockResolvedValue({ assetId: 'asset-3' })
    createItem.mockResolvedValue(item())
    const file = new File(['%PDF'], 'Регламент.pdf', { type: 'application/pdf' })

    await libraryCrmService.uploadBaseFiles([file], ProductType.OWNER)

    expect(createItem).toHaveBeenCalledWith({ scope: 'organization', assetId: 'asset-3', fileName: 'Регламент.pdf', productType: 'owner' })
  })

  it('личная библиотека с папками: папки в легаси-форме', async () => {
    const { libraryCrmService } = await facade()
    listPersonal.mockResolvedValue({ items: [], canUpload: true })
    listFolders.mockResolvedValue([{ id: 'f-1', name: 'Договоры', parentId: null, createdAt: '2026-09-15T00:00:00.000Z' }])

    const res = await libraryCrmService.getRealtorLibraryFiles(null, true)

    expect(listPersonal).toHaveBeenCalledWith(null)
    expect(listFolders).toHaveBeenCalledWith(null)
    expect(res.data?.folders).toEqual([expect.objectContaining({ _id: 'f-1', name: 'Договоры', parentId: null })])
    expect(res.data?.foldersCount).toBe(1)
  })

  it('непустая папка: текст ошибки сервера доходит до экрана', async () => {
    const { libraryCrmService } = await facade()
    rejectDeleteFolderWith = Object.assign(new Error('Request failed with status code 409'), {
      response: { data: { error: { code: 'LIBRARY_FOLDER_NOT_EMPTY', message: 'Library folder is not empty' } } },
    })

    const res = await libraryCrmService.deleteLibraryFolder('f-1')

    expect(res).toEqual({ success: false, message: 'Library folder is not empty' })
  })
})

describe('findRejectedUpload — правила хранилища платформы', () => {
  it('пропускает PDF и картинки до 20 МБ, отклоняет Word и слишком большие файлы', async () => {
    const { findRejectedUpload } = await import('@/lib/open-signed-file')
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const docx = new File(['x'], 'b.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const big = new File(['x'], 'c.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 })

    expect(findRejectedUpload([pdf])).toBeNull()
    expect(findRejectedUpload([pdf, docx])).toBe(docx)
    expect(findRejectedUpload([big])).toBe(big)
  })
})
