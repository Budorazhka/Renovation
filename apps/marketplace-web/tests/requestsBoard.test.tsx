/** @vitest-environment jsdom */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RequestsPage } from '../src/pages/RequestsPage'
import { marketplaceApi, MarketplaceApiError } from '../src/api/marketplace-api'
import { publishingApi, PublishingApiError } from '../src/features/publishing/api/publishing-api'

vi.mock('../src/api/marketplace-api', () => ({
  marketplaceApi: {
    listBuyerRequests: vi.fn(),
    revealBuyerRequestPhone: vi.fn(),
  },
  MarketplaceApiError: class extends Error {
    constructor(msg: string, readonly status: number) {
      super(msg)
      this.name = 'MarketplaceApiError'
    }
  },
}))

vi.mock('../src/features/publishing/api/publishing-api', () => ({
  publishingApi: {
    createBuyerRequest: vi.fn(),
  },
  PublishingApiError: class extends Error {
    constructor(msg: string, readonly status: number) {
      super(msg)
      this.name = 'PublishingApiError'
    }
  },
}))

const REQUEST_A = {
  id: 'req-1',
  dealType: 'buy' as const,
  city: 'Батуми',
  propertyKind: 'newbuild',
  title: 'Куплю двушку в центре Батуми',
  comment: 'Рассмотрю варианты в новостройках.',
  budget: { amount: 90000, currency: 'USD', perMonth: false },
  status: 'published' as const,
  createdAt: '2026-09-14T00:00:00.000Z',
}

const REQUEST_B = {
  id: 'req-2',
  dealType: 'rent' as const,
  city: 'Тбилиси',
  propertyKind: 'secondary',
  title: 'Сниму квартиру в Ваке',
  comment: 'От года, с ремонтом.',
  budget: { amount: 700, currency: 'USD', perMonth: true },
  status: 'published' as const,
  createdAt: '2026-09-13T00:00:00.000Z',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RequestsPage />
    </MemoryRouter>,
  )
}

describe('Buyer & Tenant Requests Board Acceptance (MKT-SCR-016)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(marketplaceApi.listBuyerRequests as any).mockResolvedValue({ items: [REQUEST_A, REQUEST_B], nextCursor: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders requests fetched from the real API, not hardcoded demo data', async () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: /Запросы клиентов/i })).toBeDefined()
    expect(screen.getByTestId('add-request-btn')).toBeDefined()

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: 'Куплю двушку в центре Батуми' })).toBeDefined()
    })
    expect(screen.getByText('до $90 000')).toBeDefined()
    expect(marketplaceApi.listBuyerRequests).toHaveBeenCalled()
  })

  it('refetches with dealType filter when a radio is selected', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Куплю двушку в центре Батуми')).toBeDefined())

    ;(marketplaceApi.listBuyerRequests as any).mockResolvedValueOnce({ items: [REQUEST_B], nextCursor: null })
    fireEvent.click(screen.getByRole('radio', { name: 'Аренда' }))

    await waitFor(() => {
      expect(marketplaceApi.listBuyerRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ dealType: 'rent' }),
        expect.anything(),
      )
    })
    await waitFor(() => expect(screen.getByText('Сниму квартиру в Ваке')).toBeDefined())
    expect(screen.queryByText('Куплю двушку в центре Батуми')).toBeNull()
  })

  it('shows the empty state when the API returns no items', async () => {
    ;(marketplaceApi.listBuyerRequests as any).mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    await waitFor(() => expect(screen.getByText('По этим условиям запросов нет')).toBeDefined())
  })

  it('shows an error state with retry when the API call fails', async () => {
    ;(marketplaceApi.listBuyerRequests as any).mockRejectedValue(new MarketplaceApiError('Сеть недоступна', 500))
    renderPage()

    await waitFor(() => expect(screen.getByText('Сеть недоступна')).toBeDefined())
    ;(marketplaceApi.listBuyerRequests as any).mockResolvedValueOnce({ items: [REQUEST_A], nextCursor: null })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.getByText('Куплю двушку в центре Батуми')).toBeDefined())
  })

  it('phone stays hidden until revealed via the real reveal-phone endpoint', async () => {
    ;(marketplaceApi.revealBuyerRequestPhone as any).mockResolvedValue({ phone: '+995 599 00 00 01' })
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Куплю двушку в центре Батуми' })).toBeDefined())

    const card = screen.getByRole('article', { name: 'Куплю двушку в центре Батуми' })
    expect(within(card).queryByText(/\+995/)).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: /Показать телефон/ }))

    await waitFor(() => expect(within(card).getByText('+995 599 00 00 01')).toBeDefined())
    expect(marketplaceApi.revealBuyerRequestPhone).toHaveBeenCalledWith('req-1')
  })

  it('creates a request through the real API and shows the pending-moderation message', async () => {
    ;(publishingApi.createBuyerRequest as any).mockResolvedValue({ ...REQUEST_A, id: 'req-new', status: 'published' })
    renderPage()

    fireEvent.click(screen.getByTestId('add-request-btn'))
    const dialog = screen.getByRole('dialog', { name: 'Оставить запрос' })

    fireEvent.change(within(dialog).getByPlaceholderText('90 000'), { target: { value: '85000' } })
    fireEvent.change(within(dialog).getByPlaceholderText('Район, площадь, этаж, ремонт, сроки'), {
      target: { value: 'Ищу студию у моря' },
    })
    fireEvent.change(within(dialog).getByPlaceholderText('+995'), { target: { value: '+995599000099' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать запрос' }))

    await waitFor(() => expect(within(dialog).getByText('Запрос принят')).toBeDefined())
    expect(publishingApi.createBuyerRequest).toHaveBeenCalledWith(
      expect.objectContaining({ dealType: 'buy', phone: '+995599000099', comment: 'Ищу студию у моря' }),
    )
  })

  it('shows a login prompt instead of a fake success when the buyer is not authenticated', async () => {
    ;(publishingApi.createBuyerRequest as any).mockRejectedValue(new PublishingApiError('unauthorized', 401))
    renderPage()

    fireEvent.click(screen.getByTestId('add-request-btn'))
    const dialog = screen.getByRole('dialog', { name: 'Оставить запрос' })

    fireEvent.change(within(dialog).getByPlaceholderText('90 000'), { target: { value: '85000' } })
    fireEvent.change(within(dialog).getByPlaceholderText('Район, площадь, этаж, ремонт, сроки'), {
      target: { value: 'Ищу студию у моря' },
    })
    fireEvent.change(within(dialog).getByPlaceholderText('+995'), { target: { value: '+995599000099' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать запрос' }))

    await waitFor(() => expect(within(dialog).getByRole('link', { name: /Войти/i })).toBeDefined())
    expect(within(dialog).queryByText('Запрос принят')).toBeNull()
  })

  it('closes the dialog on Escape', () => {
    renderPage()

    fireEvent.click(screen.getByTestId('add-request-btn'))
    expect(screen.getByRole('dialog', { name: 'Оставить запрос' })).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
