import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, AdminApiError } from '../api/admin-api'
import type { AdminRealtorReviewListItem, RealtorReviewStatus } from '../types/admin'

export type RealtorReviewsState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; items: AdminRealtorReviewListItem[]; nextCursor: string | null; loadingMore: boolean }
  | { status: 'error'; message: string; retry: () => void }

export interface RealtorReviewsFilter {
  status?: RealtorReviewStatus
}

/** N-13 / permission-matrix.md разд.2: модерация отзывов о риэлторах, review.moderate.global. Тот же паттерн, что useAdminComplaints. */
export function useAdminRealtorReviews(filter: RealtorReviewsFilter = {}): {
  state: RealtorReviewsState
  loadMore: () => void
  applyModerated: (updated: { id: string; status: RealtorReviewStatus; moderationReason: string }) => void
} {
  const [state, setState] = useState<RealtorReviewsState>({ status: 'loading' })
  const nextCursorRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const { status } = filter

  const loadFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setState({ status: 'loading' })
    try {
      const response = await adminApi.listRealtorReviews({ status, limit: 20 })
      if (requestIdRef.current !== requestId) return
      nextCursorRef.current = response.nextCursor
      if (response.items.length === 0) {
        setState({ status: 'empty' })
      } else {
        setState({ status: 'ready', items: response.items, nextCursor: response.nextCursor, loadingMore: false })
      }
    } catch (cause) {
      if (requestIdRef.current !== requestId) return
      nextCursorRef.current = null
      const message = cause instanceof AdminApiError ? cause.message : 'Не удалось загрузить список отзывов.'
      setState({ status: 'error', message, retry: () => void loadFirstPage() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current
    if (!cursor) return
    const requestId = requestIdRef.current
    setState((current) => (current.status === 'ready' ? { ...current, loadingMore: true } : current))
    void adminApi.listRealtorReviews({ status, cursor, limit: 20 }).then(
      (response) => {
        if (requestIdRef.current !== requestId) return
        nextCursorRef.current = response.nextCursor
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', items: [...current.items, ...response.items], nextCursor: response.nextCursor, loadingMore: false }
            : current,
        )
      },
      (cause: unknown) => {
        if (requestIdRef.current !== requestId) return
        const message = cause instanceof AdminApiError ? cause.message : 'Не удалось загрузить следующую страницу.'
        setState({ status: 'error', message, retry: () => void loadFirstPage() })
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, loadFirstPage])

  const applyModerated = useCallback(
    (updated: { id: string; status: RealtorReviewStatus; moderationReason: string }) => {
      setState((current) =>
        current.status === 'ready'
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === updated.id ? { ...item, status: updated.status, moderationReason: updated.moderationReason } : item,
              ),
            }
          : current,
      )
    },
    [],
  )

  return { state, loadMore, applyModerated }
}
