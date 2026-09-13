/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

function makeReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'review1',
    status: 'pending',
    realtorPositionId: 'position1',
    reviewerIdentityId: 'identity1',
    completedDealId: 'deal1',
    rating: 5,
    text: 'Отличный риелтор, помог быстро подобрать квартиру.',
    createdAt: '2026-09-01T10:00:00.000Z',
    moderationReason: null,
    ...overrides,
  }
}

function mockAdminApi(overrides: {
  listRealtorReviews?: (...args: unknown[]) => Promise<unknown>
  moderateRealtorReview?: (...args: unknown[]) => Promise<unknown>
}) {
  vi.doMock('../src/api/admin-api', async () => {
    const actual = await vi.importActual<typeof import('../src/api/admin-api')>('../src/api/admin-api')
    return {
      ...actual,
      adminApi: {
        ...actual.adminApi,
        me: () => Promise.resolve({ adminAccountId: 'a1', isSuperAdmin: false, publicationReadScope: 'all' }),
        listRealtorReviews: overrides.listRealtorReviews ?? (() => Promise.resolve({ items: [makeReview()], nextCursor: null })),
        moderateRealtorReview: overrides.moderateRealtorReview ?? ((id: string, params: { decision: string }) =>
          Promise.resolve({ id, status: params.decision })),
      },
    }
  })
}

async function renderRealtorReviewsPage() {
  const { AdminAuthProvider } = await import('../src/hooks/useAdminAuth')
  const { RequireAdmin } = await import('../src/hooks/RequireAdmin')
  const { RealtorReviewsPage } = await import('../src/pages/RealtorReviewsPage')

  return render(
    <MemoryRouter initialEntries={['/realtor-reviews']}>
      <AdminAuthProvider>
        <RequireAdmin>
          <RealtorReviewsPage />
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

describe('RealtorReviewsPage', () => {
  it('loads and displays pending reviews in the table', async () => {
    mockAdminApi({})
    await renderRealtorReviewsPage()

    await waitFor(() => {
      expect(screen.queryByText('Отличный риелтор, помог быстро подобрать квартиру.')).not.toBeNull()
      expect(screen.queryByText('position1')).not.toBeNull()
      expect(screen.queryByText('deal1')).not.toBeNull()
      expect(screen.queryAllByText('Ожидает проверки').length).toBeGreaterThan(0)
    })
  })

  it('filters reviews by status', async () => {
    const listRealtorReviews = vi.fn(() => Promise.resolve({ items: [makeReview({ status: 'approved' })], nextCursor: null }))
    mockAdminApi({ listRealtorReviews })
    await renderRealtorReviewsPage()

    await waitFor(() => expect(listRealtorReviews).toHaveBeenCalledTimes(1))

    const select = screen.getByLabelText('Статус')
    fireEvent.change(select, { target: { value: 'approved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    await waitFor(() => {
      expect(listRealtorReviews).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }))
    })
  })

  it('approving a review requires reason >= 10 chars, sends POST /moderate, and updates the row', async () => {
    const moderateRealtorReview = vi.fn((id: string, params: { decision: string; reason: string }) =>
      Promise.resolve({ id, status: 'approved' }),
    )
    mockAdminApi({ moderateRealtorReview })
    await renderRealtorReviewsPage()

    await waitFor(() => expect(screen.queryByText('Одобрить')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))

    expect(screen.queryByRole('alertdialog')).not.toBeNull()
    expect(screen.queryByText('Одобрить отзыв?')).not.toBeNull()

    const submitBtn = screen.getAllByRole('button', { name: 'Одобрить' })[1] as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'коротко' } })
    expect(submitBtn.disabled).toBe(true)

    fireEvent.change(textarea, { target: { value: 'Отзыв проверен, сделка подтверждена' } })
    expect(submitBtn.disabled).toBe(false)

    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(moderateRealtorReview).toHaveBeenCalledWith('review1', {
        decision: 'approved',
        reason: 'Отзыв проверен, сделка подтверждена',
      })
      expect(screen.queryByText('Одобрен', { selector: '.status-pill' })).not.toBeNull()
      expect(screen.queryByText('Причина: Отзыв проверен, сделка подтверждена')).not.toBeNull()
    })
  })

  it('rejecting a review requires reason >= 10 chars and sends POST /moderate with rejected', async () => {
    const moderateRealtorReview = vi.fn((id: string, params: { decision: string; reason: string }) =>
      Promise.resolve({ id, status: 'rejected' }),
    )
    mockAdminApi({ moderateRealtorReview })
    await renderRealtorReviewsPage()

    await waitFor(() => expect(screen.queryByText('Отклонить')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }))

    expect(screen.queryByRole('alertdialog')).not.toBeNull()
    expect(screen.queryByText('Отклонить отзыв?')).not.toBeNull()

    const submitBtn = screen.getAllByRole('button', { name: 'Отклонить' })[1] as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Похоже на накрутку, сделка не найдена' } })
    expect(submitBtn.disabled).toBe(false)

    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(moderateRealtorReview).toHaveBeenCalledWith('review1', {
        decision: 'rejected',
        reason: 'Похоже на накрутку, сделка не найдена',
      })
      expect(screen.queryByText('Отклонён', { selector: '.status-pill' })).not.toBeNull()
    })
  })
})
