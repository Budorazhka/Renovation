import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { BuildingPlaceholder } from '../components/DevelopmentCard'
import {
  publishingApi,
  PublishingApiError,
  type MarketplaceSelectionEntry,
} from '../features/publishing/api/publishing-api'
import { resolveMarketplaceTarget, type ResolvedMarketplaceTarget } from '../lib/resolveMarketplaceTarget'
import { useI18n } from '../i18n'

export interface CollectionItem {
  id: string
  title: string
  publicToken: string
  createdAt: string
  properties: ResolvedMarketplaceTarget[]
}

/**
 * N-11 (roadmap-2026-09.md, решение владельца 07.09.2026): подборки
 * покупателя живут на сервере у его аккаунта — открываются с любого
 * устройства и по настоящей публичной ссылке, не в localStorage одного
 * браузера.
 *
 * До этой работы страница хранила подборки в localStorage
 * (`baza:marketplace:selections`), а кнопки «Ссылка для клиента»/«Витрина»
 * вели на `/selections/:slug` с выдуманным slug'ом — тем же маршрутом, что
 * читает CRM-подборки агента по настоящему publicToken. Ссылка была мёртвой:
 * backend для подборок покупателя не существовал вовсе (проверено
 * 10.09.2026). Настоящая публичная ссылка теперь отдельная —
 * `/my-selection/:token` (MySelectionDetailPage) — во избежание коллизии с
 * агентским маршрутом.
 */
async function resolveCollection(entry: MarketplaceSelectionEntry, t: ReturnType<typeof useI18n>['t']): Promise<CollectionItem> {
  const resolved = await Promise.all(entry.items.map((item) => resolveMarketplaceTarget(item, t)))
  return {
    id: entry.id,
    title: entry.title,
    publicToken: entry.publicToken,
    createdAt: entry.createdAt,
    properties: resolved.filter((item): item is ResolvedMarketplaceTarget => item !== null),
  }
}

export function SelectionsPage() {
  const { t, formatDate } = useI18n()
  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [requiresAuth, setRequiresAuth] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useSeoMetadata({
    title: t('selections.seoTitle'),
    description: t('selections.seoDescription'),
  })

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const entries = await publishingApi.listSelections()
      const resolved = await Promise.all(entries.map((entry) => resolveCollection(entry, t)))
      setCollections(resolved)
      setRequiresAuth(false)
    } catch (error) {
      if (error instanceof PublishingApiError && (error.status === 401 || error.status === 403)) {
        setRequiresAuth(true)
      }
      setCollections([])
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывать список при смене языка не нужно
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreateNewCollection = () => {
    void publishingApi
      .createSelection(t('selections.newTitle', { count: collections.length + 1 }))
      .then((created) => {
        setCollections((prev) => [{ id: created.id, title: created.title, publicToken: created.publicToken, createdAt: created.createdAt, properties: [] }, ...prev])
      })
  }

  const handleUpdateTitle = (id: string, nextTitle: string) => {
    // Локально сразу — иначе поле "прыгает" при каждом нажатии клавиши, пока
    // ждём ответ сервера. Сохраняется на сервер по blur (handleCommitTitle),
    // не на каждый keystroke — PATCH на каждую букву был бы и лишней
    // нагрузкой, и источником гонки (последний ответ не обязательно
    // соответствует последнему введённому символу).
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, title: nextTitle } : c)))
  }

  const handleCommitTitle = (id: string, title: string) => {
    if (!title.trim()) return
    void publishingApi.renameSelection(id, title).catch(() => {
      // Не удалось сохранить — перечитываем список, чтобы поле не врало о состоянии на сервере.
      void load()
    })
  }

  const handleDeleteCollection = (id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id))
    void publishingApi.deleteSelection(id).catch(() => {
      void load()
    })
  }

  const handleCopyLink = (col: CollectionItem) => {
    const url = `${window.location.origin}/my-selection/${col.publicToken}`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedId(col.id)
        setTimeout(() => setCopiedId(null), 2000)
      })
    }
  }

  if (requiresAuth) {
    return (
      <div className="state-panel state-panel--empty">
        <p>{t('selections.requiresAuth')}</p>
        <Link to="/auth/login?next=%2Fselections" className="clear-filter-btn">
          {t('header.login')}
        </Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="state-panel" role="status" aria-busy="true">
        <p>{t('selections.loading')}</p>
      </div>
    )
  }

  return (
    <div className="figma-fav-page">
      <div className="figma-fav-header">
        <div className="figma-fav-header__title-group">
          <h1 className="figma-fav-header__title">{t('selections.title')}</h1>
          <span className="figma-fav-header__badge">{t('selections.countBadge', { count: collections.length })}</span>
        </div>

        <button
          type="button"
          className="figma-fav-create-btn"
          onClick={handleCreateNewCollection}
          data-testid="new-collection-btn"
        >
          {t('selections.create')}
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="state-panel" role="status" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: '16px', color: 'var(--color-neutral-secondary, #555454)', marginBottom: '16px' }}>
            {t('selections.emptyText')}
          </p>
          <button
            type="button"
            className="figma-fav-filter-btn figma-fav-filter-btn--active"
            onClick={handleCreateNewCollection}
          >
            {t('selections.createFirst')}
          </button>
        </div>
      ) : null}

      <div className="figma-collections-list" aria-label={t('selections.listAria')}>
        {collections.map((col) => (
          <div key={col.id} className="figma-collection-card">
            <div className="figma-collection-card__header">
              <div>
                <input
                  type="text"
                  value={col.title}
                  onChange={(e) => handleUpdateTitle(col.id, e.target.value)}
                  onBlur={(e) => handleCommitTitle(col.id, e.target.value)}
                  className="figma-collection-title-input"
                  aria-label={t('selections.titleInputAria')}
                />
                <div style={{ fontSize: '13px', color: '#757575', paddingLeft: '8px' }}>
                  {t('selections.createdAt', { date: formatDate(col.createdAt), count: col.properties.length })}
                </div>
              </div>

              <div className="figma-collection-actions">
                <button
                  type="button"
                  className="figma-collection-btn figma-collection-btn--primary"
                  onClick={() => handleCopyLink(col)}
                  data-testid={`copy-link-${col.id}`}
                >
                  {copiedId === col.id ? t('selections.linkCopied') : t('selections.clientLink')}
                </button>
                <Link
                  to={`/my-selection/${col.publicToken}`}
                  className="figma-collection-btn"
                >
                  {t('selections.showcase')}
                </Link>
                <button
                  type="button"
                  className="figma-collection-btn figma-collection-btn--danger"
                  onClick={() => handleDeleteCollection(col.id)}
                  title={t('selections.delete')}
                >
                  ✕
                </button>
              </div>
            </div>

            {col.properties.length > 0 ? (
              <div className="figma-fav-grid">
                {col.properties.map((p) => (
                  <article key={p.id} className="figma-fav-card">
                    <div className="figma-fav-card__media">
                      <BuildingPlaceholder />
                    </div>
                    <div className="figma-fav-card__body">
                      <div className="figma-fav-card__price">{p.price}</div>
                      <h2 className="figma-fav-card__title">{p.title}</h2>
                      <p className="figma-fav-card__address">
                        📍 {p.city}, {p.address}
                      </p>
                      <div className="figma-fav-card__specs">
                        <span>🛏 {t('card.rooms', { count: p.rooms })}</span>
                        <span>📐 {t('card.area', { area: p.area })}</span>
                      </div>
                      <div className="figma-fav-card__actions">
                        <Link
                          to={`/listings/${p.slug}`}
                          className="figma-fav-card-btn figma-fav-card-btn--primary"
                        >
                          {t('favorites.view')}
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px', color: '#757575', fontSize: '14px' }}>
                {t('selections.emptyCollection')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
