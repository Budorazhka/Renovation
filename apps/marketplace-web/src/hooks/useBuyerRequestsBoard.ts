import { useCallback, useEffect, useRef, useState } from 'react'
import { MarketplaceApiError, marketplaceApi } from '../api/marketplace-api'
import { isAbortError } from '../lib/async'
import { useI18n } from '../i18n'
import type { PublicBuyerRequest } from '../types/marketplace'

export type BuyerRequestsBoardState =
  | { status: 'loading' }
  | { status: 'empty' }
  | {
      status: 'ready'
      items: PublicBuyerRequest[]
      nextCursor: string | null
      loadingMore: boolean
      loadMoreError: string | null
    }
  | { status: 'error'; message: string; statusCode?: number; retry: () => void }

export interface UseBuyerRequestsBoardQuery {
  dealType?: 'buy' | 'rent'
  city?: string
  propertyKind?: string
}

/** N-13: та же форма, что useListingsCatalogue — cursor pagination поверх публичной доски запросов. */
export function useBuyerRequestsBoard(query: UseBuyerRequestsBoardQuery = {}): {
  state: BuyerRequestsBoardState
  loadMore: () => void
  retryLoadMore: () => void
} {
  const { t } = useI18n()
  const [state, setState] = useState<BuyerRequestsBoardState>({ status: 'loading' })
  const nextCursorRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const loadMoreAbortControllerRef = useRef<AbortController | null>(null)
  const { dealType, city, propertyKind } = query

  const loadFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current
    abortControllerRef.current?.abort()
    loadMoreAbortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setState({ status: 'loading' })
    nextCursorRef.current = null

    try {
      const response = await marketplaceApi.listBuyerRequests(
        { dealType, city: city?.trim() || undefined, propertyKind },
        { signal: controller.signal },
      )
      if (requestIdRef.current !== requestId || controller.signal.aborted) return

      nextCursorRef.current = response.nextCursor
      if (response.items.length === 0) {
        setState({ status: 'empty' })
      } else {
        setState({ status: 'ready', items: response.items, nextCursor: response.nextCursor, loadingMore: false, loadMoreError: null })
      }
    } catch (cause) {
      if (requestIdRef.current !== requestId || controller.signal.aborted || isAbortError(cause)) return
      nextCursorRef.current = null
      const statusCode = cause instanceof MarketplaceApiError ? cause.status : undefined
      const message = cause instanceof Error ? cause.message : t('errors.listingsCatalogue')
      setState({ status: 'error', message, statusCode, retry: () => void loadFirstPage() })
    }
  }, [dealType, city, propertyKind, t])

  useEffect(() => {
    void loadFirstPage()
    return () => {
      abortControllerRef.current?.abort()
      loadMoreAbortControllerRef.current?.abort()
    }
  }, [loadFirstPage])

  const executeLoadMore = useCallback(() => {
    const cursor = nextCursorRef.current
    if (!cursor) return
    const requestId = requestIdRef.current
    loadMoreAbortControllerRef.current?.abort()
    const controller = new AbortController()
    loadMoreAbortControllerRef.current = controller

    setState((current) => (current.status === 'ready' ? { ...current, loadingMore: true, loadMoreError: null } : current))

    void marketplaceApi
      .listBuyerRequests({ dealType, city: city?.trim() || undefined, propertyKind, cursor }, { signal: controller.signal })
      .then(
        (response) => {
          if (requestIdRef.current !== requestId || controller.signal.aborted) return
          nextCursorRef.current = response.nextCursor
          setState((current) =>
            current.status !== 'ready'
              ? current
              : {
                  status: 'ready',
                  items: [...current.items, ...response.items],
                  nextCursor: response.nextCursor,
                  loadingMore: false,
                  loadMoreError: null,
                },
          )
        },
        (cause: unknown) => {
          if (requestIdRef.current !== requestId || controller.signal.aborted || isAbortError(cause)) return
          const message = cause instanceof Error ? cause.message : t('errors.loadMore')
          setState((current) => (current.status === 'ready' ? { ...current, loadingMore: false, loadMoreError: message } : current))
        },
      )
  }, [dealType, city, propertyKind, t])

  return { state, loadMore: executeLoadMore, retryLoadMore: executeLoadMore }
}
