import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, AdminApiError } from '../api/admin-api'
import type { AdminOrganizationListItem, AdminOrganizationStatus, AdminOrganizationType } from '../types/admin'

export type OrganizationsState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; items: AdminOrganizationListItem[]; nextCursor: string | null; loadingMore: boolean }
  | { status: 'error'; message: string; retry: () => void }

export interface OrganizationsFilter {
  type?: AdminOrganizationType
  status?: AdminOrganizationStatus
  search?: string
}

export function useAdminOrganizations(filter: OrganizationsFilter = {}): {
  state: OrganizationsState
  loadMore: () => void
  applyStatusChange: (updated: { id: string; status: AdminOrganizationStatus }) => void
  applyMlsVerifiedChange: (updated: { id: string; mlsVerified: boolean }) => void
} {
  const [state, setState] = useState<OrganizationsState>({ status: 'loading' })
  const nextCursorRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const { type, status, search } = filter

  const loadFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setState({ status: 'loading' })
    try {
      const response = await adminApi.listOrganizations({ type, status, search, limit: 20 })
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
      const message = cause instanceof AdminApiError ? cause.message : 'Не удалось загрузить список организаций.'
      setState({ status: 'error', message, retry: () => void loadFirstPage() })
    }
  }, [type, status, search])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current
    if (!cursor) return
    const requestId = requestIdRef.current
    setState((current) => (current.status === 'ready' ? { ...current, loadingMore: true } : current))
    void adminApi.listOrganizations({ type, status, search, cursor, limit: 20 }).then(
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
  }, [type, status, search, loadFirstPage])

  const applyStatusChange = useCallback((updated: { id: string; status: AdminOrganizationStatus }) => {
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === updated.id ? { ...item, status: updated.status } : item,
            ),
          }
        : current,
    )
  }, [])

  const applyMlsVerifiedChange = useCallback((updated: { id: string; mlsVerified: boolean }) => {
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === updated.id ? { ...item, mlsVerified: updated.mlsVerified } : item,
            ),
          }
        : current,
    )
  }, [])

  return { state, loadMore, applyStatusChange, applyMlsVerifiedChange }
}
