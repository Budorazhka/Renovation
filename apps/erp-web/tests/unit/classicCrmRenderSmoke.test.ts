/** @vitest-environment jsdom */

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * src/features/crm/** исключена из `tsc -b` (tsconfig.app.json), поэтому
 * необъявленная переменная там доходит до сборки и роняет классический вид
 * только в браузере — так и было 15.09.2026 с isAskQuestionModalOpen.
 * Эти тесты рендерят легаси-компоненты по-настоящему.
 */

const getBaseFiles = vi.fn()
const getRealtorLibraryFiles = vi.fn()

vi.mock('@/features/crm/services/libraryCrmV2', () => ({
  libraryCrmService: {
    getBaseFiles: (...args: unknown[]) => getBaseFiles(...args),
    getRealtorLibraryFiles: (...args: unknown[]) => getRealtorLibraryFiles(...args),
  },
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number> | string) =>
      params && typeof params === 'object' ? `${key}:${Object.values(params).join(',')}` : key,
    language: 'ru',
    formatNumber: (value: number) => String(value),
    formatDate: (date: string) => String(date),
  }),
}))

describe('классическая CRM — рендер без падений', () => {
  afterEach(() => cleanup())

  it('CrmModals со всеми закрытыми окнами рендерится', async () => {
    const { default: CrmModals } = await import('@/features/crm/pages/crm/components/CrmModals')
    const closed = new Proxy(
      {},
      { get: (_target, key) => (typeof key === 'string' && (key.startsWith('is') || key.startsWith('show')) ? false : undefined) },
    )

    expect(() => render(createElement(CrmModals, closed as never))).not.toThrow()
  })
})

describe('LibrarySelectorBlock — библиотека платформы', () => {
  beforeEach(() => {
    getBaseFiles.mockReset()
    getRealtorLibraryFiles.mockReset()
    getRealtorLibraryFiles.mockResolvedValue({ success: true, data: { files: [], folders: [], count: 0 } })
  })
  afterEach(() => cleanup())

  async function openLibrary() {
    const { default: LibrarySelectorBlock } = await import('@/features/crm/components/crm/LibrarySelectorBlock')
    render(createElement(LibrarySelectorBlock, {}))
    fireEvent.click(screen.getByText('crm.crm.librarySelectorBlock.библиотека'))
  }

  it('руководитель видит загрузку и удаление общих материалов', async () => {
    getBaseFiles.mockResolvedValue({
      success: true,
      data: {
        canUpload: true,
        count: 1,
        files: [{ _id: 'i1', filename: 'a1', originalName: 'Регламент.pdf', mimeType: 'application/pdf', size: 10, url: '' }],
      },
    })
    await openLibrary()

    await waitFor(() => expect(screen.getByText('Регламент.pdf')).toBeDefined())
    expect(screen.getByRole('button', { name: 'crmLibrary.uploadCommon' })).toBeDefined()
    expect(screen.getByTitle('crm.crm.librarySelectorBlock.удалить')).toBeDefined()
    expect(screen.getByText(/crmLibrary\.commonManageHint/)).toBeDefined()
  })

  it('менеджер общие материалы только читает', async () => {
    getBaseFiles.mockResolvedValue({ success: true, data: { canUpload: false, count: 0, files: [] } })
    await openLibrary()

    await waitFor(() => expect(screen.getByText('crmLibrary.emptyCommon')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'crmLibrary.uploadCommon' })).toBeNull()
    expect(screen.getByText(/crmLibrary\.commonHint/)).toBeDefined()
  })
})
