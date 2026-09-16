/** @vitest-environment jsdom */

/**
 * Лента новостей ERP: с сервера (/news), без вшитых примеров и localStorage.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsArticle } from '@/services/newsApiV2'
import { newsAuthor, normalizeNewsUrl, sortNewsFeed } from '@/lib/news'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/services/newsApiV2', () => ({ newsApiV2: api }))

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: 'n1',
    source: 'organization',
    title: 'Регламент',
    body: 'Текст',
    category: 'company',
    pinned: false,
    linkUrl: null,
    linkLabel: null,
    imageAssetId: null,
    imageUrl: null,
    authorName: 'Марина Петрова',
    publishedAt: '2026-09-15T10:00:00.000Z',
    editedAt: null,
    version: 0,
    delivery: null,
    ...overrides,
  }
}

describe('помощники ленты', () => {
  it('закреплённые сверху, внутри — новые первыми', () => {
    const sorted = sortNewsFeed([
      article({ id: 'old', publishedAt: '2026-09-01T00:00:00.000Z' }),
      article({ id: 'pinned-old', pinned: true, publishedAt: '2026-08-01T00:00:00.000Z' }),
      article({ id: 'new', publishedAt: '2026-09-10T00:00:00.000Z' }),
    ])
    expect(sorted.map((a) => a.id)).toEqual(['pinned-old', 'new', 'old'])
  })

  it('автор: BAZA у новости платформы, имя сотрудника или «Компания»', () => {
    expect(newsAuthor(article({ source: 'platform', authorName: null }), 'Компания')).toBe('BAZA')
    expect(newsAuthor(article(), 'Компания')).toBe('Марина Петрова')
    expect(newsAuthor(article({ authorName: null }), 'Компания')).toBe('Компания')
  })

  it('адрес без протокола дополняется https://', () => {
    expect(normalizeNewsUrl('baza.sale/rules')).toBe('https://baza.sale/rules')
    expect(normalizeNewsUrl('http://baza.sale')).toBe('http://baza.sale')
    expect(normalizeNewsUrl('   ')).toBeUndefined()
  })
})

describe('NewsFeedProvider', () => {
  beforeEach(() => {
    api.list.mockReset()
    api.create.mockReset()
    api.update.mockReset()
    api.remove.mockReset()
  })

  afterEach(() => cleanup())

  async function renderFeed() {
    const { NewsFeedProvider, useNewsFeed } = await import('@/context/NewsFeedContext')
    const wrapper = ({ children }: { children: ReactNode }) => createElement(NewsFeedProvider, null, children)
    return renderHook(() => useNewsFeed(), { wrapper })
  }

  it('берёт ленту с сервера: новости платформы и компании, право публиковать, каналы рассылки', async () => {
    api.list.mockResolvedValue({
      items: [article({ id: 'org' }), article({ id: 'platform', source: 'platform', authorName: null })],
      canPublish: true,
      channels: { email: true, telegram: false },
    })
    const { result } = await renderFeed()

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.articles).toHaveLength(2)
    expect(result.current.organizationArticles.map((a) => a.id)).toEqual(['org'])
    expect(result.current.canPublish).toBe(true)
    expect(result.current.channels).toEqual({ email: true, telegram: false })
  })

  it('правка отправляет версию и заменяет новость в ленте', async () => {
    api.list.mockResolvedValue({ items: [article({ id: 'n1' })], canPublish: true, channels: { email: false, telegram: false } })
    api.update.mockImplementation(async (id, payload) => article({ id, ...payload, version: 1, editedAt: '2026-09-15T12:00:00.000Z' }))
    const { result } = await renderFeed()
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.update('n1', { title: ' Новый ', body: 'Текст', category: 'company', imageAssetId: 'img1' }, 0)
    })

    expect(api.update).toHaveBeenCalledWith('n1', { title: 'Новый', body: 'Текст', category: 'company', pinned: false, imageAssetId: 'img1' }, 0)
    expect(result.current.articles[0]).toMatchObject({ title: 'Новый', version: 1 })
  })

  it('ошибка сервера — статус error, без выдуманных новостей', async () => {
    api.list.mockRejectedValue(new Error('500'))
    const { result } = await renderFeed()

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.articles).toEqual([])
    expect(result.current.canPublish).toBe(false)
  })

  it('публикация дополняет ссылку протоколом и сразу добавляет новость в ленту', async () => {
    api.list.mockResolvedValue({ items: [], canPublish: true })
    api.create.mockImplementation(async (payload) => article({ id: 'fresh', ...payload }))
    const { result } = await renderFeed()
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.publish({ title: ' Итоги ', body: ' Текст ', category: 'company', linkUrl: 'baza.sale', linkLabel: '' })
    })

    expect(api.create).toHaveBeenCalledWith({
      title: 'Итоги',
      body: 'Текст',
      category: 'company',
      pinned: false,
      linkUrl: 'https://baza.sale',
      sendEmail: false,
      sendTelegram: false,
    })
    expect(result.current.articles.map((a) => a.id)).toEqual(['fresh'])

    await act(async () => {
      await result.current.remove('fresh')
    })
    expect(api.remove).toHaveBeenCalledWith('fresh')
    expect(result.current.articles).toEqual([])
  })
})
