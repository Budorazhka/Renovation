import { useMemo, useState } from 'react'
import { ExternalLink, Pin, Search } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useNewsFeed } from '@/context/NewsFeedContext'
import type { NewsArticle, NewsCategory } from '@/services/newsApiV2'
import { newsAuthor, newsEmoji } from '@/lib/news'
import { useI18n } from '@/i18n'

const MUTED = 'text-[color:var(--app-text-muted)]'
const CATEGORIES: readonly NewsCategory[] = ['company', 'market', 'developer', 'regulation']

type CategoryFilter = NewsCategory | 'all'

/**
 * Лента новостей: новости платформы BAZA (из админки) и своей компании
 * (из «Настройки → Управление новостями»). Раньше — вшитые примеры.
 */
export function NewsPage() {
  const { t, formatDate } = useI18n()
  const { articles, status, reload } = useNewsFeed()
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'new' | 'old'>('new')
  const [expanded, setExpanded] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = articles.filter(
      (a) =>
        (filter === 'all' || a.category === filter) &&
        (!q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)),
    )
    return [...list].sort((x, y) =>
      sort === 'new' ? y.publishedAt.localeCompare(x.publishedAt) : x.publishedAt.localeCompare(y.publishedAt),
    )
  }, [articles, filter, search, sort])

  const pinned = visible.filter((a) => a.pinned)
  const regular = visible.filter((a) => !a.pinned)
  const renderCard = (article: NewsArticle) => (
    <ArticleCard
      key={article.id}
      article={article}
      expanded={expanded === article.id}
      onToggle={() => setExpanded(expanded === article.id ? null : article.id)}
      categoryLabel={t(`news.categories.${article.category}`)}
      author={newsAuthor(article, t('news.company'))}
      date={formatDate(article.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })}
      editedLabel={article.editedAt ? t('news.edited') : null}
      linkLabel={article.linkLabel ?? t('news.openLink')}
    />
  )

  return (
    <DashboardShell>
      <div className="flex w-full max-w-[960px] flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header>
          <h1 className="text-[30px] font-normal leading-tight text-[color:var(--theme-accent-heading)]">{t('news.title')}</h1>
          <p className={`mt-1 text-[17px] ${MUTED}`}>{t('news.subtitle')}</p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[220px] max-w-[340px] flex-1 items-center gap-2 rounded-sm bg-[var(--workspace-row-bg)] px-3">
            <Search className={`size-4 shrink-0 ${MUTED}`} aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('news.search')}
              aria-label={t('news.search')}
              className="h-10 w-full bg-transparent text-[16px] text-[color:var(--app-text)] outline-none"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'new' | 'old')}
            aria-label={t('news.sortNew')}
            className="h-10 rounded-sm bg-[var(--workspace-row-bg)] px-2 text-[16px] text-[color:var(--app-text)]"
          >
            <option value="new">{t('news.sortNew')}</option>
            <option value="old">{t('news.sortOld')}</option>
          </select>
          <div className="flex flex-wrap gap-1">
            {(['all', ...CATEGORIES] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`rounded-sm px-3 py-1.5 text-[16px] ${
                  filter === key
                    ? 'bg-[var(--gold)] font-medium text-[color:var(--gold-btn-text)]'
                    : `${MUTED} hover:text-[color:var(--app-text)]`
                }`}
              >
                {key === 'all' ? t('news.all') : t(`news.categories.${key}`)}
              </button>
            ))}
          </div>
        </div>

        {status === 'loading' ? <p className={`text-[17px] ${MUTED}`}>{t('common.loading')}</p> : null}
        {status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[17px] text-[#ffb4ab]">
            {t('news.loadFailed')}
            <button type="button" onClick={reload} className="rounded-sm bg-[var(--gold)] px-3 py-1.5 text-[16px] font-medium text-[color:var(--gold-btn-text)]">
              {t('news.retry')}
            </button>
          </div>
        ) : null}

        {pinned.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label={t('news.pinned')}>
            <h2 className="flex items-center gap-2 text-[16px] font-medium text-[color:var(--gold)]">
              <Pin className="size-4" aria-hidden /> {t('news.pinned')}
            </h2>
            {pinned.map(renderCard)}
          </section>
        ) : null}

        {regular.length > 0 ? <section className="flex flex-col gap-2">{regular.map(renderCard)}</section> : null}

        {status === 'ready' && visible.length === 0 ? (
          <p className={`py-12 text-center text-[17px] ${MUTED}`}>
            {articles.length === 0 ? t('news.empty') : t('news.notFound')}
          </p>
        ) : null}
      </div>
    </DashboardShell>
  )
}

function ArticleCard({
  article,
  expanded,
  onToggle,
  categoryLabel,
  author,
  date,
  editedLabel,
  linkLabel,
}: {
  article: NewsArticle
  expanded: boolean
  onToggle: () => void
  categoryLabel: string
  author: string
  date: string
  editedLabel: string | null
  linkLabel: string
}) {
  return (
    <article className="rounded-md bg-[var(--hub-card-bg)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-0.5 shrink-0 text-[22px] leading-none" aria-hidden>
          {newsEmoji(article.category)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-normal leading-snug text-[color:var(--app-text)]">{article.title}</span>
          <span className={`mt-1 flex flex-wrap items-center gap-x-2 text-[16px] ${MUTED}`}>
            <span className="text-[color:var(--gold)]">{categoryLabel}</span>
            <span>{date}</span>
            <span>· {author}</span>
            {editedLabel ? <span>· {editedLabel}</span> : null}
          </span>
        </span>
        {article.imageUrl && !expanded ? (
          <img src={article.imageUrl} alt="" loading="lazy" className="size-16 shrink-0 rounded-sm object-cover" />
        ) : null}
      </button>
      {expanded ? (
        <div className="px-4 pb-4 pl-[52px]">
          {article.imageUrl ? (
            <img src={article.imageUrl} alt="" loading="lazy" className="mb-3 block max-h-[320px] w-full rounded-md object-cover" />
          ) : null}
          <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-[color:var(--app-text)]">{article.body}</p>
          {article.linkUrl ? (
            <a
              href={article.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[16px] text-[color:var(--gold)] hover:underline"
            >
              <ExternalLink className="size-4" aria-hidden />
              {linkLabel}
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
