import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { BuildingPlaceholder } from '../components/DevelopmentCard'
import { publishingApi, PublishingApiError, type FavoriteEntry } from '../features/publishing/api/publishing-api'
import { resolveMarketplaceTarget, type ResolvedMarketplaceTarget } from '../lib/resolveMarketplaceTarget'
import { useI18n } from '../i18n'

export type FavoriteItem = ResolvedMarketplaceTarget

export function FavoritesPage() {
  const { t } = useI18n()
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [requiresAuth, setRequiresAuth] = useState(false)
  const [dealFilter, setDealFilter] = useState<'all' | 'sale' | 'rent_long' | 'rent_short'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'default' | 'price_asc' | 'price_desc'>('default')
  const [isCreatedSelectionOpen, setIsCreatedSelectionOpen] = useState(false)
  const [isCreatingSelection, setIsCreatingSelection] = useState(false)

  useSeoMetadata({
    title: t('favorites.seoTitle'),
    description: t('favorites.seoDescription'),
  })

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const entries = await publishingApi.listFavorites()
      const resolved = await Promise.all(entries.map((entry) => resolveMarketplaceTarget(entry, t)))
      setFavorites(resolved.filter((item): item is FavoriteItem => item !== null))
      setRequiresAuth(false)
    } catch (error) {
      if (error instanceof PublishingApiError && (error.status === 401 || error.status === 403)) {
        setRequiresAuth(true)
      }
      setFavorites([])
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывать список при смене языка не нужно
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleRemove = (id: string) => {
    const item = favorites.find((candidate) => candidate.id === id)
    if (!item) return
    // Убираем из списка сразу, но отправляем на сервер: иначе объект вернулся бы
    // после перезагрузки, и человек решил бы, что кнопка не работает.
    setFavorites((prev) => prev.filter((candidate) => candidate.id !== id))
    void publishingApi
      .removeFavorite({ targetType: item.targetType, slug: item.slug })
      .catch(() => {
        // Не удалось — возвращаем на место, чтобы список не врал.
        setFavorites((prev) => [item, ...prev])
      })
  }

  const handleCreateSelection = () => {
    if (favorites.length === 0 || isCreatingSelection) return
    setIsCreatingSelection(true)
    void (async () => {
      try {
        const created = await publishingApi.createSelection(t('favorites.selectionDefaultTitle'))
        // Идёт последовательно, не Promise.all: addSelectionItem пишет в тот же
        // документ (условный push) — параллельные запросы к одной подборке
        // не портят данные, но и не выигрывают у последовательного пути ничего,
        // а порядок объектов в подборке остаётся предсказуемым (как в избранном).
        for (const item of favorites) {
          await publishingApi.addSelectionItem(created.id, { targetType: item.targetType, slug: item.slug })
        }
        setIsCreatedSelectionOpen(true)
        setTimeout(() => setIsCreatedSelectionOpen(false), 3000)
      } catch {
        // Не удалось — молчаливо не показываем «✓ создана», честнее ничего не
        // сказать, чем соврать об успехе.
      } finally {
        setIsCreatingSelection(false)
      }
    })()
  }

  const filtered = favorites
    .filter((item) => {
      if (dealFilter !== 'all' && item.dealType !== dealFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          item.title.toLowerCase().includes(q) ||
          item.address.toLowerCase().includes(q) ||
          item.city.toLowerCase().includes(q)
        )
      }
      return true
    })

  // Гостю нужен вход, а не пустой список: сервер требует сессию, и без этой
  // ветки человек видел бы «ничего не сохранено» вместо объяснения.
  if (requiresAuth) {
    return (
      <div className="state-panel state-panel--empty">
        <p>{t('favorites.requiresAuth')}</p>
        <Link to="/auth/login?next=%2Ffavorites" className="clear-filter-btn">
          {t('header.login')}
        </Link>
      </div>
    )
  }

  // Без этой ветки на секунду показывалось бы «ничего не сохранено», хотя
  // список ещё грузится.
  if (isLoading) {
    return (
      <div className="state-panel" role="status" aria-busy="true">
        <p>{t('favorites.loading')}</p>
      </div>
    )
  }

  return (
    <div className="figma-fav-page">
      <div className="figma-fav-header">
        <div className="figma-fav-header__title-group">
          <h1 className="figma-fav-header__title">{t('favorites.title')}</h1>
          <span className="figma-fav-header__badge" data-testid="favorites-count-badge">
            {t('favorites.countBadge', { count: favorites.length })}
          </span>
        </div>

        {favorites.length > 0 && (
          <button
            type="button"
            className="figma-fav-create-btn"
            onClick={handleCreateSelection}
            disabled={isCreatingSelection}
            data-testid="create-selection-btn"
          >
            {isCreatedSelectionOpen ? t('favorites.selectionCreated') : t('favorites.createSelection')}
          </button>
        )}
      </div>

      {favorites.length > 0 && (
        <div className="figma-fav-controls">
          <div className="figma-fav-tabs" role="tablist" aria-label={t('favorites.dealFilterAria')}>
            <button
              type="button"
              className={`figma-fav-tab-btn${dealFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setDealFilter('all')}
              role="tab"
              aria-selected={dealFilter === 'all'}
            >
              {t('myProperties.tabAll', { count: favorites.length })}
            </button>
            <button
              type="button"
              className={`figma-fav-tab-btn${dealFilter === 'sale' ? ' is-active' : ''}`}
              onClick={() => setDealFilter('sale')}
              role="tab"
              aria-selected={dealFilter === 'sale'}
            >
              {t('favorites.tabBuy', { count: favorites.filter((f) => f.dealType === 'sale').length })}
            </button>
            <button
              type="button"
              className={`figma-fav-tab-btn${dealFilter === 'rent_long' ? ' is-active' : ''}`}
              onClick={() => setDealFilter('rent_long')}
              role="tab"
              aria-selected={dealFilter === 'rent_long'}
            >
              {t('favorites.tabLongTerm', { count: favorites.filter((f) => f.dealType === 'rent_long').length })}
            </button>
          </div>

          <div className="figma-fav-search-sort">
            <input
              type="search"
              placeholder={t('favorites.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="figma-fav-search-input"
              aria-label={t('favorites.searchAria')}
            />
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="figma-fav-select"
              aria-label={t('favorites.sortAria')}
            >
              <option value="default">{t('favorites.sortDefault')}</option>
              <option value="price_asc">{t('filters.sort.priceAsc')}</option>
              <option value="price_desc">{t('filters.sort.priceDesc')}</option>
            </select>
          </div>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="figma-fav-grid" aria-label={t('favorites.gridAria')}>
          {filtered.map((item) => (
            <article key={item.id} className="figma-fav-card">
              <div className="figma-fav-card__media">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} />
                ) : (
                  <BuildingPlaceholder />
                )}
                <button
                  type="button"
                  className="figma-fav-card__like-btn"
                  onClick={() => handleRemove(item.id)}
                  title={t('card.removeFromFavorites')}
                  aria-label={t('card.removeFromFavorites')}
                >
                  ♥
                </button>
              </div>

              <div className="figma-fav-card__body">
                <div className="figma-fav-card__price-row">
                  <span className="figma-fav-card__price">{item.price}</span>
                  {item.pricePerSqm && (
                    <span className="figma-fav-card__price-sqm">{item.pricePerSqm}</span>
                  )}
                </div>

                <h2 className="figma-fav-card__title">{item.title}</h2>
                <p className="figma-fav-card__address">
                  📍 {item.city}, {item.address}
                </p>

                <div className="figma-fav-card__specs">
                  <span>🛏 {t('card.rooms', { count: item.rooms })}</span>
                  <span>📐 {t('card.area', { area: item.area })}</span>
                  <span>🏢 {t('card.floor', { floor: item.floor })}</span>
                </div>

                <div className="figma-fav-card__actions">
                  <Link
                    to={`/listings/${item.slug}`}
                    className="figma-fav-card-btn figma-fav-card-btn--primary"
                  >
                    {t('favorites.view')}
                  </Link>
                  <button
                    type="button"
                    className="figma-fav-card-btn"
                    onClick={() => handleRemove(item.id)}
                  >
                    {t('favorites.remove')}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="figma-fav-empty">
          <div className="figma-fav-empty__icon">♥</div>
          <h2 className="figma-fav-empty__title">{t('favorites.emptyTitle')}</h2>
          <p className="figma-fav-empty__desc">{t('favorites.emptyText')}</p>
          <Link to="/" className="figma-fav-create-btn">
            {t('favorites.goToCatalogue')}
          </Link>
        </div>
      )}
    </div>
  )
}
