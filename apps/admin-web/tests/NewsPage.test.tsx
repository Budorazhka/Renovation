/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

function makeArticle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'news1',
    source: 'platform',
    title: 'В CRM появились планы сотрудников',
    body: 'Руководитель ставит план, сотрудник видит выполнение на рабочем столе.',
    category: 'market',
    pinned: false,
    linkUrl: null,
    linkLabel: null,
    imageAssetId: null,
    imageUrl: null,
    authorName: null,
    publishedAt: '2026-09-15T10:00:00.000Z',
    editedAt: null,
    version: 0,
    delivery: {
      email: { pending: 0, sent: 12, failed: 1, skipped: 0 },
      telegram: { pending: 0, sent: 0, failed: 0, skipped: 0 },
    },
    ...overrides,
  }
}

const CHANNELS_ON = { email: true, telegram: true }

function mockAdminApi(overrides: {
  listNews?: (...args: unknown[]) => Promise<unknown>
  createNews?: (...args: unknown[]) => Promise<unknown>
  updateNews?: (...args: unknown[]) => Promise<unknown>
  deleteNews?: (...args: unknown[]) => Promise<unknown>
}) {
  vi.doMock('../src/api/admin-api', async () => {
    const actual = await vi.importActual<typeof import('../src/api/admin-api')>('../src/api/admin-api')
    return {
      ...actual,
      adminApi: {
        ...actual.adminApi,
        me: () => Promise.resolve({ adminAccountId: 'a1', isSuperAdmin: true, publicationReadScope: 'all' }),
        listNews: overrides.listNews ?? (() => Promise.resolve({ items: [makeArticle()], channels: CHANNELS_ON })),
        createNews: overrides.createNews ?? ((params: Record<string, unknown>) => Promise.resolve(makeArticle({ id: 'news2', ...params }))),
        updateNews: overrides.updateNews ?? ((id: string, params: Record<string, unknown>) => Promise.resolve(makeArticle({ id, ...params, version: 1 }))),
        deleteNews: overrides.deleteNews ?? (() => Promise.resolve(undefined)),
      },
    }
  })
}

async function renderNewsPage() {
  const { AdminAuthProvider } = await import('../src/hooks/useAdminAuth')
  const { RequireAdmin } = await import('../src/hooks/RequireAdmin')
  const { NewsPage } = await import('../src/pages/NewsPage')

  return render(
    <MemoryRouter initialEntries={['/news']}>
      <AdminAuthProvider>
        <RequireAdmin>
          <NewsPage />
        </RequireAdmin>
      </AdminAuthProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('NewsPage', () => {
  it('показывает новости платформы с сервера и сводку рассылки', async () => {
    mockAdminApi({})
    await renderNewsPage()

    await waitFor(() => expect(screen.queryByText('В CRM появились планы сотрудников')).not.toBeNull())
    expect(screen.queryByText('Почта: отправлено 12 из 13, ошибок 1')).not.toBeNull()
  })

  it('публикует новость с рассылкой: ссылка без протокола дополняется https://, новость сразу в списке', async () => {
    const createNews = vi.fn((params: Record<string, unknown>) => Promise.resolve(makeArticle({ id: 'news2', ...params, delivery: null })))
    mockAdminApi({ listNews: () => Promise.resolve({ items: [], channels: CHANNELS_ON }), createNews })
    await renderNewsPage()
    await waitFor(() => expect(screen.queryByText(/Новостей платформы пока нет/)).not.toBeNull())

    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: '  Обновление BAZA  ' } })
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'Что нового в сентябре' } })
    fireEvent.change(screen.getByLabelText('Ссылка (необязательно)'), { target: { value: 'baza.sale/news' } })
    fireEvent.click(screen.getByLabelText('Закрепить в ленте'))
    fireEvent.click(screen.getByLabelText('На почту'))
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }))

    await waitFor(() =>
      expect(createNews).toHaveBeenCalledWith({
        title: 'Обновление BAZA',
        body: 'Что нового в сентябре',
        category: 'market',
        pinned: true,
        linkUrl: 'https://baza.sale/news',
        sendEmail: true,
        sendTelegram: false,
      }),
    )
    await waitFor(() => expect(screen.queryByText('Обновление BAZA')).not.toBeNull())
    expect(screen.queryByText(/Новость опубликована/)).not.toBeNull()
  })

  it('каналы не настроены на сервере — отметки рассылки недоступны', async () => {
    mockAdminApi({ listNews: () => Promise.resolve({ items: [], channels: { email: false, telegram: false } }) })
    await renderNewsPage()
    await waitFor(() => expect(screen.queryByText(/Новостей платформы пока нет/)).not.toBeNull())

    expect((screen.getByLabelText('На почту (не настроено на сервере)') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('В Telegram (не настроено на сервере)') as HTMLInputElement).disabled).toBe(true)
  })

  it('правка: форма заполняется новостью, сохранение уходит с версией', async () => {
    const updateNews = vi.fn((id: string, params: Record<string, unknown>) => Promise.resolve(makeArticle({ id, ...params, version: 1 })))
    mockAdminApi({ updateNews })
    await renderNewsPage()
    await waitFor(() => expect(screen.queryByText('В CRM появились планы сотрудников')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
    expect((screen.getByLabelText('Заголовок') as HTMLInputElement).value).toBe('В CRM появились планы сотрудников')
    expect(screen.queryByText('Рассылка сотрудникам всех организаций')).toBeNull()
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'Планы сотрудников в CRM' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))

    await waitFor(() =>
      expect(updateNews).toHaveBeenCalledWith(
        'news1',
        expect.objectContaining({ title: 'Планы сотрудников в CRM', category: 'market' }),
        0,
      ),
    )
    await waitFor(() => expect(screen.queryByText('Планы сотрудников в CRM')).not.toBeNull())
  })

  it('удаление — после подтверждения, новость пропадает из списка', async () => {
    const deleteNews = vi.fn(() => Promise.resolve(undefined))
    mockAdminApi({ deleteNews })
    await renderNewsPage()
    await waitFor(() => expect(screen.queryByText('В CRM появились планы сотрудников')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    const dialog = await screen.findByRole('dialog')
    expect(deleteNews).not.toHaveBeenCalled()
    fireEvent.click(dialog.querySelector('button.danger')!)

    await waitFor(() => expect(deleteNews).toHaveBeenCalledWith('news1'))
    await waitFor(() => expect(screen.queryByText('В CRM появились планы сотрудников')).toBeNull())
  })

  it('без права news.publish — понятное сообщение, к кому идти', async () => {
    const { AdminApiError } = await vi.importActual<typeof import('../src/api/admin-api')>('../src/api/admin-api')
    mockAdminApi({
      listNews: () => Promise.reject(new AdminApiError('Недостаточно прав: news.publish', 403, 'ADMIN_SCOPE_INSUFFICIENT')),
    })
    await renderNewsPage()

    await waitFor(() => expect(screen.queryByText(/Его выдаёт super_admin/)).not.toBeNull())
  })
})
