import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  newsApiV2,
  type CreateNewsPayload,
  type NewsArticle,
  type NewsChannels,
  type NewsContentPayload,
} from '@/services/newsApiV2'
import { normalizeNewsUrl, sortNewsFeed } from '@/lib/news'

export type AddNewsInput = CreateNewsPayload

type NewsFeedContextValue = {
  /** Лента: сначала закреплённые, внутри — новые первыми. */
  articles: NewsArticle[]
  /** Новости своей компании — их можно править и удалять в настройках. */
  organizationArticles: NewsArticle[]
  /** Может ли текущий сотрудник публиковать новости компании. */
  canPublish: boolean
  /** Каналы рассылки, настроенные на сервере. */
  channels: NewsChannels
  status: 'loading' | 'ready' | 'error'
  reload: () => void
  publish: (input: AddNewsInput) => Promise<NewsArticle>
  update: (id: string, input: NewsContentPayload, expectedVersion: number) => Promise<NewsArticle>
  remove: (id: string) => Promise<void>
}

const NO_CHANNELS: NewsChannels = { email: false, telegram: false }

const NewsFeedContext = createContext<NewsFeedContextValue | null>(null)

type Loaded = { items: NewsArticle[]; canPublish: boolean; channels: NewsChannels } | { failed: true }

/** Обрезка полей и ссылка с протоколом — API принимает только http(s) с протоколом. */
function toContentPayload(input: NewsContentPayload): NewsContentPayload {
  const linkUrl = input.linkUrl ? normalizeNewsUrl(input.linkUrl) : undefined
  return {
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category,
    pinned: input.pinned ?? false,
    ...(linkUrl ? { linkUrl } : {}),
    ...(linkUrl && input.linkLabel?.trim() ? { linkLabel: input.linkLabel.trim() } : {}),
    ...(input.imageAssetId ? { imageAssetId: input.imageAssetId } : {}),
  }
}

/**
 * Лента новостей рабочего стола и страницы «Новости» — с сервера (/news):
 * новости платформы BAZA и своей компании. Раньше — вшитые примеры и
 * localStorage автора, новость больше никто не видел.
 */
export function NewsFeedProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    newsApiV2
      .list()
      .then((feed) => {
        if (!cancelled) setLoaded({ items: feed.items, canPublish: feed.canPublish, channels: feed.channels ?? NO_CHANNELS })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const publish = useCallback(async (input: AddNewsInput) => {
    const created = await newsApiV2.create({
      ...toContentPayload(input),
      sendEmail: input.sendEmail ?? false,
      sendTelegram: input.sendTelegram ?? false,
    })
    setLoaded((prev) => (prev && !('failed' in prev) ? { ...prev, items: [created, ...prev.items] } : prev))
    return created
  }, [])

  const update = useCallback(async (id: string, input: NewsContentPayload, expectedVersion: number) => {
    const updated = await newsApiV2.update(id, toContentPayload(input), expectedVersion)
    setLoaded((prev) =>
      prev && !('failed' in prev) ? { ...prev, items: prev.items.map((a) => (a.id === id ? updated : a)) } : prev,
    )
    return updated
  }, [])

  const remove = useCallback(async (id: string) => {
    await newsApiV2.remove(id)
    setLoaded((prev) => (prev && !('failed' in prev) ? { ...prev, items: prev.items.filter((a) => a.id !== id) } : prev))
  }, [])

  const value = useMemo<NewsFeedContextValue>(() => {
    const ready = loaded && !('failed' in loaded) ? loaded : null
    const articles = sortNewsFeed(ready?.items ?? [])
    return {
      articles,
      organizationArticles: articles.filter((a) => a.source === 'organization'),
      canPublish: ready?.canPublish ?? false,
      channels: ready?.channels ?? NO_CHANNELS,
      status: loaded === null ? 'loading' : ready ? 'ready' : 'error',
      reload,
      publish,
      update,
      remove,
    }
  }, [loaded, reload, publish, update, remove])

  return <NewsFeedContext.Provider value={value}>{children}</NewsFeedContext.Provider>
}

export function useNewsFeed() {
  const ctx = useContext(NewsFeedContext)
  if (!ctx) throw new Error('useNewsFeed must be used within NewsFeedProvider')
  return ctx
}
