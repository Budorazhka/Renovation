import type { NewsArticle, NewsCategory } from '@/services/newsApiV2'

/** Значок категории в ленте: у новостей нет своих картинок, категория различает их с первого взгляда. */
const CATEGORY_EMOJI: Record<NewsCategory, string> = {
  company: '📢',
  market: '📈',
  developer: '🏗️',
  regulation: '⚖️',
}

export function newsEmoji(category: NewsCategory): string {
  return CATEGORY_EMOJI[category] ?? '📰'
}

/**
 * Подпись автора: имя сотрудника у новости компании; у новости платформы —
 * BAZA; у новости компании без имени (позиция без сотрудника) — «Компания».
 */
export function newsAuthor(article: NewsArticle, companyLabel: string): string {
  if (article.source === 'platform') return 'BAZA'
  return article.authorName?.trim() || companyLabel
}

/** Сначала закреплённые, внутри — новые первыми. */
export function sortNewsFeed(articles: NewsArticle[]): NewsArticle[] {
  return [...articles].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.localeCompare(a.publishedAt),
  )
}

/** Адрес без протокола дополняется https:// — API принимает только http(s) с протоколом. */
export function normalizeNewsUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return `https://${trimmed}`
}
