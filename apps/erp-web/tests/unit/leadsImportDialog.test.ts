/** @vitest-environment jsdom */

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const importLeads = vi.fn()
// Отказ сервера отдаёт обычная функция: промис из обёртки vi.fn в jsdom vitest считает необработанным.
let rejectImportWith: unknown = null

vi.mock('@/services/leadsApiV2', () => ({
  leadsApiV2: {
    importLeads: (...args: unknown[]) => (rejectImportWith ? Promise.reject(rejectImportWith) : importLeads(...args)),
  },
  OLD_BASE_TAG: 'old_base',
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
}))

async function renderDialog(onImported = vi.fn()) {
  const { LeadsImportDialog } = await import('@/components/leads/LeadsImportDialog')
  render(createElement(LeadsImportDialog, { open: true, onOpenChange: vi.fn(), onImported }))
  return onImported
}

function chooseFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['phone\n+995555000111'], 'base.csv', { type: 'text/csv' })] } })
}

describe('LeadsImportDialog — импорт старой базы', () => {
  beforeEach(() => {
    importLeads.mockReset()
    rejectImportWith = null
  })
  afterEach(() => cleanup())

  it('без файла кнопка загрузки неактивна', async () => {
    await renderDialog()
    expect((screen.getByRole('button', { name: 'crmPoker.importSubmit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('отправляет файл с меткой old_base, показывает итог и ошибки строк, обновляет стол', async () => {
    importLeads.mockResolvedValue({ total: 3, created: 2, failed: 1, errors: [{ row: 4, message: 'Отсутствует обязательное поле phone' }] })
    const onImported = await renderDialog()

    chooseFile()
    fireEvent.click(screen.getByRole('button', { name: 'crmPoker.importSubmit' }))

    await waitFor(() => expect(screen.getByText('crmPoker.importResult:created=2,failed=1')).toBeDefined())
    expect(importLeads).toHaveBeenCalledWith(expect.any(File), { tag: 'old_base' })
    expect(screen.getByText('crmPoker.importRowError:row=4,message=Отсутствует обязательное поле phone')).toBeDefined()
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('ни одной созданной строки — стол не перечитывается', async () => {
    importLeads.mockResolvedValue({ total: 1, created: 0, failed: 1, errors: [{ row: 2, message: 'x' }] })
    const onImported = await renderDialog()

    chooseFile()
    fireEvent.click(screen.getByRole('button', { name: 'crmPoker.importSubmit' }))

    await waitFor(() => expect(screen.getByText('crmPoker.importResult:created=0,failed=1')).toBeDefined())
    expect(onImported).not.toHaveBeenCalled()
  })

  it('ошибка сервера показывается его текстом', async () => {
    rejectImportWith = Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { message: 'Импорт ограничен 2000 строками — разделите файл' } },
    })
    await renderDialog()

    chooseFile()
    fireEvent.click(screen.getByRole('button', { name: 'crmPoker.importSubmit' }))

    await waitFor(() => expect(screen.getByText('Импорт ограничен 2000 строками — разделите файл')).toBeDefined())
  })
})
