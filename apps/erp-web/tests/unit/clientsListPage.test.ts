/** @vitest-environment jsdom */

/**
 * Список клиентов ERP (N-20) читает реестр с сервера вместо восьми
 * вымышленных записей `CLIENTS_MOCK`. Проверяется поведение, которое ломает
 * молчаливый мок: реальный вызов contactsApiV2.listAll, реальные
 * имя/телефон/сегмент на экране, фильтр по вкладке сегмента.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const listAllMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/layout/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
}))

vi.mock('@/components/common/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/clients/ConversionFunnelCard', () => ({ ConversionFunnelCard: () => null }))
vi.mock('@/components/clients/CreateClientModal', () => ({ CreateClientModal: () => null }))

vi.mock('@/services/contactsApiV2', () => ({
  contactsApiV2: { listAll: listAllMock },
}))

const CONTACTS = [
  {
    id: 'contact-1',
    organizationId: 'org-1',
    name: 'Нино Беридзе',
    phone: '+995555000001',
    email: null,
    roles: ['buyer'],
    dealsCount: 2,
    segment: 'golden',
    createdAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'contact-2',
    organizationId: 'org-1',
    name: 'Георгий Абашидзе',
    phone: '+995555000002',
    email: 'giorgi@example.test',
    roles: [],
    dealsCount: 0,
    segment: 'active',
    createdAt: '2026-09-02T10:00:00.000Z',
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderPage() {
  const { ClientsListPage } = await import('@/components/clients/ClientsListPage')
  return render(createElement(ClientsListPage))
}

describe('ClientsListPage', () => {
  it('читает клиентов через contactsApiV2.listAll и показывает реальные имя/телефон, не CLIENTS_MOCK', async () => {
    listAllMock.mockResolvedValue({ items: CONTACTS, complete: true })

    await renderPage()

    expect(listAllMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('Нино Беридзе')).not.toBeNull())
    expect(screen.getByText('+995555000001')).not.toBeNull()
    expect(screen.getByText('giorgi@example.test')).not.toBeNull()
    // Имена из старого CLIENTS_MOCK на экране быть не должно.
    expect(screen.queryByText(/Александр Петров/)).toBeNull()
  })

  it('вкладка сегмента фильтрует список по реальному вычисленному сегменту', async () => {
    listAllMock.mockResolvedValue({ items: CONTACTS, complete: true })
    await renderPage()
    await waitFor(() => expect(screen.getByText('Нино Беридзе')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /Золотой фонд/ }))

    expect(screen.getByText('Нино Беридзе')).not.toBeNull()
    expect(screen.queryByText('Георгий Абашидзе')).toBeNull()
  })

  it('загрузка не всех страниц (complete:false) показывает предупреждение вместо тихого урезания', async () => {
    listAllMock.mockResolvedValue({ items: CONTACTS, complete: false })

    await renderPage()

    await waitFor(() => expect(screen.getByText(/показаны не все записи/)).not.toBeNull())
  })
})
