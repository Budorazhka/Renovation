/** @vitest-environment jsdom */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { RealtorsPage } from '../src/pages/RealtorsPage'
import { marketplaceApi, MarketplaceApiError } from '../src/api/marketplace-api'
import { publishingApi, PublishingApiError } from '../src/features/publishing/api/publishing-api'

vi.mock('../src/api/marketplace-api', () => ({
  marketplaceApi: {
    listPublicRealtors: vi.fn(),
    getPublicRealtor: vi.fn(),
    listApprovedRealtorReviews: vi.fn(),
    revealRealtorPhone: vi.fn(),
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
    submitRealtorReview: vi.fn(),
  },
  PublishingApiError: class extends Error {
    constructor(msg: string, readonly status: number) {
      super(msg)
      this.name = 'PublishingApiError'
    }
  },
}))

const REALTOR_A = {
  id: 'realtor-1',
  name: 'Георгий Беридзе',
  fixedRole: 'owner' as const,
  organizationName: 'Batumi Estates',
  organizationType: 'agency' as const,
  city: 'Батуми',
  aboutMe: 'Помогаю подобрать недвижимость у моря.',
  avatarUrl: null,
  socials: { telegram: null, whatsapp: null, instagram: null, website: null },
  rating: { average: 4.8, count: 12 },
}

const REALTOR_B = {
  id: 'realtor-2',
  name: 'Давид Кварацхелия',
  fixedRole: 'manager' as const,
  organizationName: 'Tbilisi Homes',
  organizationType: 'independent_realtor' as const,
  city: 'Тбилиси',
  aboutMe: null,
  avatarUrl: null,
  socials: { telegram: null, whatsapp: null, instagram: null, website: null },
  rating: null,
}

const REVIEW_A = {
  id: 'review-1',
  rating: 5,
  text: 'Георгий помог выбрать отличную студию у моря, все прошло быстро.',
  createdAt: '2026-09-01T00:00:00.000Z',
}

function renderDirectory() {
  return render(
    <MemoryRouter>
      <RealtorsPage />
    </MemoryRouter>,
  )
}

describe('Realtors Rating & Profiles Acceptance (MKT-SCR-014, MKT-SCR-015)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(marketplaceApi.listPublicRealtors as any).mockResolvedValue({ items: [REALTOR_A, REALTOR_B], nextCursor: null })
    ;(marketplaceApi.getPublicRealtor as any).mockResolvedValue(REALTOR_A)
    ;(marketplaceApi.listApprovedRealtorReviews as any).mockResolvedValue([REVIEW_A])
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the realtors directory fetched from the real API, not hardcoded demo data', async () => {
    renderDirectory()

    expect(screen.getByRole('heading', { level: 1, name: /Риелторы/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Батуми/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Тбилиси/i })).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText('Георгий Беридзе')).toBeDefined()
    })
    expect(screen.getByText('Давид Кварацхелия')).toBeDefined()
    expect(marketplaceApi.listPublicRealtors).toHaveBeenCalled()
  })

  it('refetches with a city filter when a city tab is selected', async () => {
    renderDirectory()
    await waitFor(() => expect(screen.getByText('Георгий Беридзе')).toBeDefined())

    ;(marketplaceApi.listPublicRealtors as any).mockResolvedValueOnce({ items: [REALTOR_B], nextCursor: null })
    fireEvent.click(screen.getByRole('tab', { name: 'Тбилиси' }))

    await waitFor(() => {
      expect(marketplaceApi.listPublicRealtors).toHaveBeenLastCalledWith(
        expect.objectContaining({ city: 'Тбилиси' }),
        expect.anything(),
      )
    })
    await waitFor(() => expect(screen.getByText('Давид Кварацхелия')).toBeDefined())
    expect(screen.queryByText('Георгий Беридзе')).toBeNull()
  })

  it('shows the empty state when the API returns no realtors', async () => {
    ;(marketplaceApi.listPublicRealtors as any).mockResolvedValue({ items: [], nextCursor: null })
    renderDirectory()

    await waitFor(() => expect(screen.getByText('По этим условиям риелторов не нашлось.')).toBeDefined())
  })

  it('shows an honest "no reviews yet" note instead of a fake rating', async () => {
    renderDirectory()
    await waitFor(() => expect(screen.getByText('Давид Кварацхелия')).toBeDefined())

    expect(screen.getByText('Пока нет отзывов')).toBeDefined()
  })

  it('navigates to the realtor profile and renders approved reviews', async () => {
    render(
      <MemoryRouter initialEntries={['/realtors/realtor-1']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Георгий Беридзе/i })).toBeDefined()
    })
    expect(screen.getByRole('heading', { level: 2, name: /Отзывы клиентов/i })).toBeDefined()
    expect(screen.getByText(/Георгий помог выбрать отличную студию/i)).toBeDefined()
    expect(marketplaceApi.getPublicRealtor).toHaveBeenCalledWith('realtor-1')
  })

  it('shows a not-found state instead of a fake profile for an unknown realtor', async () => {
    ;(marketplaceApi.getPublicRealtor as any).mockRejectedValue(new MarketplaceApiError('not found', 404))
    render(
      <MemoryRouter initialEntries={['/realtors/unknown']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Риелтор не найден.')).toBeDefined())
  })

  it('reveals the phone only after the reveal button is clicked', async () => {
    ;(marketplaceApi.revealRealtorPhone as any).mockResolvedValue({ phone: '+995 599 00 00 02' })
    render(
      <MemoryRouter initialEntries={['/realtors/realtor-1']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Георгий Беридзе/i })).toBeDefined())
    expect(screen.queryByText(/\+995/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Показать телефон/i }))

    await waitFor(() => expect(screen.getByText(/\+995 599 00 00 02/)).toBeDefined())
    expect(marketplaceApi.revealRealtorPhone).toHaveBeenCalledWith('realtor-1')
  })

  it('submits a new review through the real API with the honest pending-moderation message', async () => {
    ;(publishingApi.submitRealtorReview as any).mockResolvedValue({ id: 'review-new' })
    render(
      <MemoryRouter initialEntries={['/realtors/realtor-1']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Георгий Беридзе/i })).toBeDefined())

    fireEvent.change(screen.getByLabelText('Код сделки от риелтора'), { target: { value: '66f1a2b3c4d5e6f7a8b9c0d1' } })
    fireEvent.change(screen.getByLabelText('Текст отзыва'), {
      target: { value: 'Прекрасная работа, все быстро и профессионально!' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }))

    await waitFor(() => expect(screen.getByText(/отправлен на модерацию/i)).toBeDefined())
    expect(publishingApi.submitRealtorReview).toHaveBeenCalledWith(
      expect.objectContaining({
        realtorPositionId: 'realtor-1',
        completedDealId: '66f1a2b3c4d5e6f7a8b9c0d1',
        rating: 5,
        text: 'Прекрасная работа, все быстро и профессионально!',
      }),
    )
  })

  it('shows a login prompt instead of a fake success when the reviewer is not authenticated', async () => {
    ;(publishingApi.submitRealtorReview as any).mockRejectedValue(new PublishingApiError('unauthorized', 401))
    render(
      <MemoryRouter initialEntries={['/realtors/realtor-1']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Георгий Беридзе/i })).toBeDefined())

    fireEvent.change(screen.getByLabelText('Код сделки от риелтора'), { target: { value: '66f1a2b3c4d5e6f7a8b9c0d1' } })
    fireEvent.change(screen.getByLabelText('Текст отзыва'), {
      target: { value: 'Прекрасная работа, все быстро и профессионально!' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }))

    await waitFor(() => expect(screen.getByRole('link', { name: /Войти/i })).toBeDefined())
    expect(screen.queryByText(/отправлен на модерацию/i)).toBeNull()
  })
})
