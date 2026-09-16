/** @vitest-environment jsdom */

/**
 * Карточка клиента (N-20) — до этого прохода экрана не было вовсе, ссылка
 * из списка вела на несуществующий route. Проверяется реальная загрузка
 * контакта и его сделок, и что правка отправляет PATCH с полем roles.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getByIdMock = vi.fn()
const updateMock = vi.fn()
const dealsListMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ clientId: 'contact-1' }),
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/layout/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
}))

vi.mock('@/services/contactsApiV2', () => ({
  contactsApiV2: { getById: getByIdMock, update: updateMock },
}))

vi.mock('@/services/dealsApiV2', () => ({
  dealsApiV2: { list: dealsListMock },
}))

const CONTACT = {
  id: 'contact-1',
  organizationId: 'org-1',
  name: 'Нино Беридзе',
  phone: '+995555000001',
  email: 'nino@example.test',
  roles: ['buyer'],
  dealsCount: 1,
  segment: 'active',
  createdAt: '2026-09-01T10:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderPage() {
  const { ClientCardPage } = await import('@/components/clients/ClientCardPage')
  return render(createElement(ClientCardPage))
}

describe('ClientCardPage', () => {
  it('загружает контакт по id и его сделки, показывает реальные поля', async () => {
    getByIdMock.mockResolvedValue(CONTACT)
    dealsListMock.mockResolvedValue({ items: [{ id: 'deal-1', title: 'Квартира в Батуми', stage: 'showing' }], nextCursor: null })

    await renderPage()

    expect(getByIdMock).toHaveBeenCalledWith('contact-1')
    await waitFor(() => expect(screen.getByText('Нино Беридзе')).not.toBeNull())
    expect(screen.getByText('+995555000001')).not.toBeNull()
    expect(dealsListMock).toHaveBeenCalledWith({ contactId: 'contact-1', limit: 50 })
    await waitFor(() => expect(screen.getByText('Квартира в Батуми')).not.toBeNull())
  })

  it('правка отправляет PATCH с изменённым именем и ролями', async () => {
    getByIdMock.mockResolvedValue(CONTACT)
    dealsListMock.mockResolvedValue({ items: [], nextCursor: null })
    updateMock.mockResolvedValue({ ...CONTACT, name: 'Нино Б.', roles: ['buyer', 'investor'] })

    await renderPage()
    await waitFor(() => expect(screen.getByText('Нино Беридзе')).not.toBeNull())

    fireEvent.click(screen.getByText('Изменить'))
    const nameInput = screen.getByDisplayValue('Нино Беридзе')
    fireEvent.change(nameInput, { target: { value: 'Нино Б.' } })
    fireEvent.click(screen.getByText('Инвестор'))
    fireEvent.click(screen.getByText('Сохранить'))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('contact-1', {
        name: 'Нино Б.',
        phone: '+995555000001',
        email: 'nino@example.test',
        roles: ['buyer', 'investor'],
      }),
    )
  })

  it('несуществующий контакт (404) — сообщение, не падение', async () => {
    const error = Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404 } })
    getByIdMock.mockRejectedValue(error)
    dealsListMock.mockResolvedValue({ items: [], nextCursor: null })

    await renderPage()

    await waitFor(() => expect(screen.getByText('clients.clientsListPage.клиенты_не_найдены')).not.toBeNull())
  })
})
