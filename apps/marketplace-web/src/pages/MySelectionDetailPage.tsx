import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { BuildingPlaceholder } from '../components/DevelopmentCard'
import { marketplaceApi } from '../api/marketplace-api'
import { resolveMarketplaceTarget, type ResolvedMarketplaceTarget } from '../lib/resolveMarketplaceTarget'
import { useI18n } from '../i18n'
import '../styles/favorites-selections.css'

/**
 * N-11: подборка покупателя, открытая по ссылке — с любого устройства, не
 * только там, где её создали. Отдельный маршрут от `/selections/:slug`
 * (агентские CRM-подборки, SelectionDetailPage) во избежание коллизии: оба
 * когда-то делили один путь, и ссылка на подборку покупателя вела в никуда
 * (backend для неё не существовал вовсе, см. SelectionsPage докстринг).
 */
export function MySelectionDetailPage() {
  const { token = '' } = useParams()
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<ResolvedMarketplaceTarget[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')

  useSeoMetadata({
    title: title ? `${title} | BAZA` : t('mySelectionDetail.seoTitle'),
    description: t('mySelectionDetail.seoDescription'),
    // Подборка адресована тому, с кем поделились ссылкой: в поиске ей делать нечего.
    noindex: true,
  })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      setStatus('loading')
      try {
        const selection = await marketplaceApi.getPublicMarketplaceSelection(token, { signal: controller.signal })
        if (cancelled) return
        const resolved = await Promise.all(selection.items.map((item) => resolveMarketplaceTarget(item, t)))
        if (cancelled) return
        setTitle(selection.title)
        setItems(resolved.filter((item): item is ResolvedMarketplaceTarget => item !== null))
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        const httpStatus = (error as { status?: number }).status
        setStatus(httpStatus === 404 ? 'not_found' : 'error')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [token, t])

  if (status === 'loading') {
    return (
      <div className="state-panel" role="status" aria-busy="true">
        <p>{t('mySelectionDetail.loading')}</p>
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div className="state-panel state-panel--empty">
        <p>{t('mySelectionDetail.notFound')}</p>
        <Link to="/newconstructions" className="clear-filter-btn">
          {t('mySelectionDetail.viewCatalogue')}
        </Link>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="state-panel state-panel--error" role="alert">
        <p>{t('mySelectionDetail.loadFailed')}</p>
      </div>
    )
  }

  return (
    <section className="client-selection" aria-labelledby="my-selection-title">
      <header className="client-selection__header">
        <h1 id="my-selection-title" className="client-selection__title">
          {title}
        </h1>
      </header>

      {items.length === 0 ? (
        <div className="state-panel state-panel--empty">
          <p>{t('mySelectionDetail.emptyItems')}</p>
        </div>
      ) : (
        <ul className="client-selection__grid">
          {items.map((item) => (
            <li key={item.id} className="client-selection__card">
              <div className="client-selection__media">
                <BuildingPlaceholder />
              </div>
              <div className="client-selection__body">
                {item.price && <p className="client-selection__price">{item.price}</p>}
                <p className="client-selection__unit-number">{item.title}</p>
                <p className="client-selection__params">
                  📍 {item.city}, {item.address}
                </p>
                <p className="client-selection__params">
                  {[
                    item.rooms ? t('card.rooms', { count: item.rooms }) : null,
                    item.area ? t('card.area', { area: item.area }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <Link
                  to={item.targetType === 'listing' ? `/listings/${item.slug}` : `/developments/${item.slug}`}
                  className="figma-fav-card-btn figma-fav-card-btn--primary"
                >
                  {t('favorites.view')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
