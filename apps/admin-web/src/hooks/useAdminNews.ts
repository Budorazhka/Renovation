import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, AdminApiError } from '../api/admin-api'
import type { NewsArticle, NewsChannels } from '../types/admin'

export type AdminNewsState =
  | { status: 'loading' }
  | { status: 'ready'; items: NewsArticle[]; channels: NewsChannels }
  | { status: 'error'; message: string; retry: () => void }

/** Сообщение для 403 и конфликта версий: оператору важно знать, что делать дальше. */
export function newsErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof AdminApiError && cause.code === 'ADMIN_SCOPE_INSUFFICIENT') {
    return 'Нет права news.publish. Его выдаёт super_admin в разделе «Аккаунты».'
  }
  if (cause instanceof AdminApiError && cause.code === 'VERSION_CONFLICT') {
    return 'Новость изменили, пока вы её правили. Обновите страницу и повторите.'
  }
  return cause instanceof AdminApiError ? cause.message : fallback
}

/** Новости платформы (/admin/news, грант news.publish). Список короткий — без постраничности. */
export function useAdminNews(): {
  state: AdminNewsState
  applyCreated: (article: NewsArticle) => void
  applyUpdated: (article: NewsArticle) => void
  applyDeleted: (id: string) => void
} {
  const [state, setState] = useState<AdminNewsState>({ status: 'loading' })
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setState({ status: 'loading' })
    try {
      const response = await adminApi.listNews()
      if (requestIdRef.current !== requestId) return
      setState({ status: 'ready', items: response.items, channels: response.channels ?? { email: false, telegram: false } })
    } catch (cause) {
      if (requestIdRef.current !== requestId) return
      setState({ status: 'error', message: newsErrorMessage(cause, 'Не удалось загрузить новости.'), retry: () => void load() })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const applyCreated = useCallback((article: NewsArticle) => {
    setState((current) => (current.status === 'ready' ? { ...current, items: [article, ...current.items] } : current))
  }, [])

  const applyUpdated = useCallback((article: NewsArticle) => {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, items: current.items.map((item) => (item.id === article.id ? article : item)) }
        : current,
    )
  }, [])

  const applyDeleted = useCallback((id: string) => {
    setState((current) =>
      current.status === 'ready' ? { ...current, items: current.items.filter((item) => item.id !== id) } : current,
    )
  }, [])

  return { state, applyCreated, applyUpdated, applyDeleted }
}
