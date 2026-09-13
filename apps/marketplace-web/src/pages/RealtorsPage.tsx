import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { useRealtorsDirectory } from '../hooks/useRealtorsDirectory'
import { useI18n } from '../i18n'
import type { PublicRealtorProfile } from '../types/marketplace'

/**
 * RealtorsPage (Figma: Рейтинг риелторов v2, Node ID 3576:53108, MKT-SCR-014)
 *
 * N-13 (owner decision 14.09.2026): "риэлтор" — занятая позиция в
 * организации типа agency/independent_realtor, реальный GET /public/realtors.
 * Метрики из исходного демо-макета (число сделок, стаж, бейджи вида
 * «ТОП-1 Батуми»/«Проверен BAZA») не перенесены — ни одна из них не имеет
 * опоры в бэкенде, показывать их значило бы визуальное обещание
 * несуществующих данных (PRODUCT.md). Единственная реальная метрика —
 * средний рейтинг по одобренным отзывам, честно отсутствует (не «0.0»),
 * если отзывов ещё нет.
 */
export function RealtorsPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const cityParam = searchParams.get('city') || 'all'

  const { state, loadMore, retryLoadMore } = useRealtorsDirectory({ city: cityParam === 'all' ? undefined : cityParam })

  useSeoMetadata({
    title: t('realtors.seoTitle'),
    description: t('realtors.seoDescription'),
  })

  function setCity(value: 'all' | 'Батуми' | 'Тбилиси') {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete('city')
    else next.set('city', value)
    setSearchParams(next)
  }

  return (
    <div className="figma-realtors-page">
      <div className="figma-realtors-header">
        <div className="figma-realtors-header__eyebrow">{t('realtors.eyebrow')}</div>
        <h1 className="figma-realtors-header__title">{t('realtors.title')}</h1>
        <p className="figma-realtors-header__subtitle">{t('realtors.subtitle')}</p>
      </div>

      <div className="figma-realtors-toolbar">
        <div className="figma-realtors-toolbar__tabs" role="tablist" aria-label={t('realtors.cityFilterAria')}>
          <button type="button" className={`figma-realtor-tab-btn${cityParam === 'all' ? ' is-active' : ''}`} onClick={() => setCity('all')} role="tab" aria-selected={cityParam === 'all'}>
            {t('filters.allCities')}
          </button>
          <button type="button" className={`figma-realtor-tab-btn${cityParam === 'Батуми' ? ' is-active' : ''}`} onClick={() => setCity('Батуми')} role="tab" aria-selected={cityParam === 'Батуми'}>
            {t('header.cityBatumi')}
          </button>
          <button type="button" className={`figma-realtor-tab-btn${cityParam === 'Тбилиси' ? ' is-active' : ''}`} onClick={() => setCity('Тбилиси')} role="tab" aria-selected={cityParam === 'Тбилиси'}>
            {t('header.cityTbilisi')}
          </button>
        </div>
      </div>

      {state.status === 'loading' ? (
        <div className="state-panel" role="status" aria-busy="true">
          <p>{t('realtors.loading')}</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="state-panel state-panel--error">
          <p>{state.message}</p>
          <button type="button" className="retry-btn" onClick={state.retry}>{t('requests.retry')}</button>
        </div>
      ) : null}

      {state.status === 'empty' ? (
        <div className="state-panel state-panel--empty">
          <p>{t('realtors.empty')}</p>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <div className="figma-realtors-grid" aria-label={t('realtors.gridAria')}>
            {state.items.map((realtor) => (
              <RealtorCard key={realtor.id} realtor={realtor} t={t} />
            ))}
          </div>
          {state.nextCursor ? (
            <div className="load-more-container">
              <button className="load-more" type="button" onClick={loadMore} disabled={state.loadingMore} aria-busy={state.loadingMore}>
                {state.loadingMore ? t('catalogue.loadingMore') : t('catalogue.loadMore')}
              </button>
              {state.loadMoreError ? (
                <div className="pagination-error-panel">
                  <p>{state.loadMoreError}</p>
                  <button type="button" className="retry-btn" onClick={retryLoadMore}>{t('requests.retry')}</button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="catalogue-end-note" aria-live="polite">{t('catalogue.allShown')}</p>
          )}
        </>
      ) : null}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

function RealtorCard({ realtor, t }: { realtor: PublicRealtorProfile; t: (key: string, params?: Record<string, string | number>) => string }) {
  return (
    <article className="figma-realtor-card">
      <div className="figma-realtor-card__top">
        {realtor.avatarUrl ? (
          <img className="figma-realtor-avatar" src={realtor.avatarUrl} alt="" aria-hidden="true" />
        ) : (
          <div className="figma-realtor-avatar" aria-hidden="true">{initials(realtor.name)}</div>
        )}
        <div className="figma-realtor-card__info">
          <h2 className="figma-realtor-name">{realtor.name}</h2>
          <span className="figma-realtor-agency">
            {realtor.organizationName}{realtor.city ? ` · ${realtor.city}` : ''}
          </span>
          <div className="figma-realtor-rating-row">
            {realtor.rating ? (
              <>
                <span className="figma-realtor-stars" aria-hidden="true">★ {realtor.rating.average.toFixed(1)}</span>
                <span className="figma-realtor-reviews-count">{t('realtors.reviewsCount', { count: realtor.rating.count })}</span>
              </>
            ) : (
              <span className="figma-realtor-reviews-count">{t('realtors.noReviewsYet')}</span>
            )}
          </div>
        </div>
      </div>

      {realtor.aboutMe ? <p className="figma-realtor-about">{realtor.aboutMe}</p> : null}

      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
        <Link to={`/realtors/${realtor.id}`} className="figma-realtor-card__btn" aria-label={t('realtors.profileAria', { name: realtor.name })}>
          {t('realtors.profileLink')}
        </Link>
      </div>
    </article>
  )
}
