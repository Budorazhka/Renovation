import { FormEvent, useEffect, useState, useTransition } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  completionLabel,
  developmentAddress,
  developmentTitle,
  listingTitle,
  listingAddress,
  listingPrice,
  listingDealTypeLabel,
  listingPropertyTypeLabel,
  formatMoneyAmount,
} from './lib/format'
import { useCatalogue } from './hooks/useCatalogue'
import { useDevelopmentDetail } from './hooks/useDevelopmentDetail'
import { useListingsCatalogue } from './hooks/useListingsCatalogue'
import { useListingDetail } from './hooks/useListingDetail'
import { useSeoMetadata, buildListingJsonLd, buildDevelopmentJsonLd } from './hooks/useSeoMetadata'
import { ListingContactForm } from './components/ListingContactForm'
import { ListingMediaGallery } from './components/ListingMediaGallery'
import { MarketplaceMap } from './components/MarketplaceMap'
import { PublishingWizard } from './features/publishing'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { DevelopmentCard, BuildingPlaceholder } from './components/DevelopmentCard'
import { ListingCard } from './components/ListingCard'
import { CardSkeleton } from './components/CardSkeleton'
import { FacetFilters } from './components/FacetFilters'
import { RevealContactCTA } from './components/RevealContactCTA'
import { UnitQuickViewModal, type UnitInfo } from './components/UnitQuickViewModal'
import { RealtorsPage } from './pages/RealtorsPage'
import { RealtorProfilePage } from './pages/RealtorProfilePage'
import { MyPropertiesPage } from './pages/MyPropertiesPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SelectionsPage } from './pages/SelectionsPage'
import { SelectionDetailPage } from './pages/SelectionDetailPage'
import { MySelectionDetailPage } from './pages/MySelectionDetailPage'
import { RequestsPage } from './pages/RequestsPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AuthPage } from './pages/AuthPage'
import { EditListingPage } from './pages/EditListingPage'
import { RequireAuth } from './features/auth/components/RequireAuth'
import { MyTeamPage } from './pages/MyTeamPage'
import { JoinTeamPage } from './pages/JoinTeamPage'
import './styles/header-footer.css'
import './styles/cards.css'
import './styles/listing-card.css'
import './styles/filters.css'
import './styles/development-detail.css'
import './styles/listing-detail.css'
import './styles/realtors.css'
import './styles/my-properties.css'
import './styles/referral-team.css'
import './styles/favorites-selections.css'
import './styles/requests.css'
import './styles/home.css'
// Шапка и подвал: подключаются последними, чтобы не проигрывать старым правилам.
import './styles/chrome.css'
import './styles/visual-upgrade.css'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { I18nProvider, useI18n } from './i18n'
import type {
  BoundingBox,
  PublicDevelopmentCard,
  PublicListingCard,
  ListingDealType,
  ListingPropertyType,
  PublicListingSort,
} from './types/marketplace'

/** Маршруты, на которых живёт каталог с фильтрами. */
const CATALOGUE_ROUTES = ['/newconstructions', '/secondary', '/rent']

/**
 * Раздел каталога по типу сделки объявления.
 *
 * Нужен ссылкам «показать всё этой компании»: аренда живёт в своём разделе, и
 * ссылка на `/secondary` увела бы в раздел, где арендных объектов заведомо нет.
 */
function listingSectionPath(dealType: unknown): string {
  return dealType === 'rent_long' || dealType === 'rent_short' ? '/rent' : '/secondary'
}

function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { t } = useI18n()
  // Плавающие кнопки фильтров и карты имеют смысл только в разделах каталога.
  // Раньше признаком был путь '/', но каталог переехал из корня в разделы.
  const isCatalogueRoute = CATALOGUE_ROUTES.includes(location.pathname)
  const mapQuery = new URLSearchParams(location.search)
  mapQuery.set('view', 'map')
  mapQuery.delete('cursor')
  const listQuery = new URLSearchParams(location.search)
  listQuery.delete('view')
  listQuery.delete('bbox')
  listQuery.delete('cursor')
  const isMapView = location.search.includes('view=map')
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        {t('shell.skipLink')}
      </a>
      <Header />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      {isCatalogueRoute ? (
        <div className="floating-controls" aria-label={t('shell.catalogueToolsAria')}>
          <a href="#catalogue-filters" className="floating-control floating-control--filters" aria-label={t('shell.openFiltersAria')}>☷<span>⌁</span></a>
          <Link
            to={`${location.pathname}?${isMapView ? listQuery.toString() : mapQuery.toString()}`}
            className="floating-control floating-control--map"
            aria-label={isMapView ? t('shell.showList') : t('shell.showMap')}
          >
            {isMapView ? '▤' : '♧'}
          </Link>
        </div>
      ) : null}
      <Footer />
    </div>
  )
}

type CatalogueTab = 'developments' | 'listings'
const LISTING_SORTS = ['newest', 'price_asc', 'price_desc', 'area_asc', 'area_desc'] as const

function parseBoundingBox(value: string | null): BoundingBox | undefined {
  if (!value) return undefined
  const numbers = value.split(',').map(Number)
  if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) return undefined
  const [minLng, minLat, maxLng, maxLat] = numbers
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
    return undefined
  }
  return { minLng, minLat, maxLng, maxLat }
}

function serializeBoundingBox(bbox: BoundingBox): string {
  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat].map((value) => value.toFixed(5)).join(',')
}

/**
 * Раздел каталога: фильтры, сортировка, список или карта.
 *
 * Раздел задаёт маршрут (`/newconstructions`, `/secondary`, `/rent`), а не
 * query-параметр: главная информационная и каталога не содержит (решение
 * владельца от 04.09.2026, по образцу действующего baza.sale). Значения из
 * query по-прежнему сильнее — так работают переходы по ссылкам с фильтрами
 * внутри раздела.
 */
function CataloguePage({
  defaultTab = 'developments',
  defaultDealType,
}: {
  defaultTab?: CatalogueTab
  defaultDealType?: ListingDealType
} = {}) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [, startTransition] = useTransition()

  // Read URL parameters
  const tabParam = (searchParams.get('tab') as CatalogueTab) || defaultTab
  const cityParam = searchParams.get('city') || ''
  const dealTypeParam = (searchParams.get('dealType') as ListingDealType) || defaultDealType
  const propertyTypeParam = (searchParams.get('propertyType') as ListingPropertyType) || undefined
  const commercialSubtypeParam = searchParams.get('commercialSubtype') || undefined
  const rawSortParam = searchParams.get('sort')
  const sortParam: PublicListingSort = LISTING_SORTS.includes(rawSortParam as PublicListingSort)
    ? (rawSortParam as PublicListingSort)
    : 'newest'
  const publisherParam = searchParams.get('publisher') || undefined
  const isMapView = searchParams.get('view') === 'map'
  const bboxParam = parseBoundingBox(searchParams.get('bbox'))

  const [cityInput, setCityInput] = useState(cityParam)

  // Keep input synchronized if URL changes (e.g. back/forward button)
  useEffect(() => {
    setCityInput(cityParam)
  }, [cityParam])

  // Queries
  const developmentsQuery = useCatalogue({
    city: cityParam,
    publisher: publisherParam,
    bbox: isMapView ? bboxParam : undefined,
  })

  const listingsQuery = useListingsCatalogue({
    city: cityParam,
    publisher: publisherParam,
    dealType: dealTypeParam,
    propertyType: propertyTypeParam,
    commercialSubtype: commercialSubtypeParam,
    bbox: isMapView ? bboxParam : undefined,
    sort: sortParam,
  })

  const isDev = tabParam === 'developments'
  const state = isDev ? developmentsQuery.state : listingsQuery.state
  const loadMore = isDev ? developmentsQuery.loadMore : listingsQuery.loadMore
  const retryLoadMore = isDev ? developmentsQuery.retryLoadMore : listingsQuery.retryLoadMore

  // Update URL helper (resets cursor)
  function updateFilters(updates: Record<string, string | undefined>) {
    startTransition(() => {
      const nextParams = new URLSearchParams(searchParams)
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          nextParams.delete(key)
        } else {
          nextParams.set(key, value)
        }
      }
      nextParams.delete('cursor')
      setSearchParams(nextParams, { replace: false })
    })
  }

  function submitCity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateFilters({ city: cityInput.trim() || undefined })
  }

  function clearAllFilters() {
    setCityInput('')
    updateFilters({
      city: undefined,
      dealType: undefined,
      propertyType: undefined,
      commercialSubtype: undefined,
      bbox: undefined,
      publisher: undefined,
    })
  }

  function handleMapBoundsChange(nextBbox: BoundingBox) {
    const serialized = serializeBoundingBox(nextBbox)
    if (serialized === searchParams.get('bbox')) return
    updateFilters({ bbox: serialized, view: 'map' })
  }

  function viewUrl(view: 'list' | 'map') {
    const params = new URLSearchParams(searchParams)
    if (view === 'map') params.set('view', 'map')
    else {
      params.delete('view')
      params.delete('bbox')
    }
    params.delete('cursor')
    return `/?${params.toString()}`
  }

  return (
    <Shell>
      <FacetFilters
        tabParam={tabParam}
        cityParam={cityParam}
        dealTypeParam={dealTypeParam}
        propertyTypeParam={propertyTypeParam}
        commercialSubtypeParam={commercialSubtypeParam}
        sortParam={sortParam}
        isMapView={isMapView}
        onFilterChange={updateFilters}
        onClearFilters={clearAllFilters}
        viewUrl={viewUrl}
      />

      <section className="catalogue-section" aria-live="polite" aria-labelledby="catalogue-results-heading">
        <div className="section-heading">
          <h2 id="catalogue-results-heading">
            {cityParam
              ? t('catalogue.headingInCity', { kind: t(isDev ? 'catalogue.kindDev' : 'catalogue.kindListings'), city: cityParam })
              : t('catalogue.headingAll', { kind: t(isDev ? 'catalogue.kindDev' : 'catalogue.kindListingsLower') })}
          </h2>
          {/*
            Счётчик выдачи. У него есть testid, потому что на него опирается
            runtime-гейт: раньше сценарий искал класс `.catalogue-count`,
            который остался только в CSS — саму разметку переписали, и тест
            падал, пока гейт до него не доходил.
          */}
          {state.status === 'ready' ? (
            <span data-testid="catalogue-count">
              {t('catalogue.shownPrefix')} <strong>{state.items.length}</strong> {t('catalogue.shownOf')} {state.total}
            </span>
          ) : null}
          {state.status === 'empty' ? (
            <span data-testid="catalogue-empty-note">{t('catalogue.emptyNote')}</span>
          ) : null}
        </div>

        {/*
          Активный фильтр по компании. Имя берём из первой карточки выдачи, а не
          отдельным запросом: все объекты в ней принадлежат этому публикатору по
          определению фильтра. Пока выдача пустая или ещё грузится, показываем
          нейтральное «Выбранная компания» — придумывать имя не из чего.
        */}
        {publisherParam ? (
          <div className="active-publisher-filter">
            <span>
              {t('catalogue.publisherFilterPrefix')}{' '}
              <strong>
                {(state.status === 'ready' && state.items[0]?.publisher?.name) || t('catalogue.publisherFilterFallback')}
              </strong>
            </span>
            <button type="button" className="clear-filter-btn" onClick={() => updateFilters({ publisher: undefined })}>
              {t('catalogue.publisherFilterClear')}
            </button>
          </div>
        ) : null}

        {state.status === 'loading' ? (
          <div className="state-panel" role="status" aria-busy="true">
            <p>{t('catalogue.loading')}</p>
            <div className="development-grid figma-catalog-grid">
              <CardSkeleton count={6} />
            </div>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <div className="state-panel state-panel--error" role="alert">
            <p>{state.message}</p>
            <button type="button" className="retry-btn" onClick={state.retry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {state.status === 'empty' ? (
          <div className="state-panel state-panel--empty">
            <p>{t('catalogue.emptyState')}</p>
            {(cityParam || dealTypeParam || propertyTypeParam) && (
              <button type="button" className="clear-filter-btn" onClick={clearAllFilters}>
                {t('catalogue.resetFilters')}
              </button>
            )}
          </div>
        ) : null}

        {state.status === 'ready' ? (
          <>
            {isMapView ? (
              <div className="catalogue-split-view">
                <aside className="catalogue-split-sidebar" aria-label={t('catalogue.mapSidebarAria')}>
                  <div className="catalogue-split-cards">
                    {isDev
                      ? (state.items as PublicDevelopmentCard[]).map((item, index) => (
                          <DevelopmentCard
                            key={item.slug ?? `${item.name}-${index}`}
                            item={item}
                            size="small"
                          />
                        ))
                      : (state.items as PublicListingCard[]).map((item, index) => (
                          <ListingCard
                            key={item.slug ?? `listing-${index}`}
                            item={item}
                            size="small"
                          />
                        ))}
                  </div>
                </aside>
                <div className="catalogue-split-map">
                  <MarketplaceMap
                    items={state.items as Array<PublicDevelopmentCard | PublicListingCard>}
                    onBoundsChange={handleMapBoundsChange}
                  />
                </div>
              </div>
            ) : (
              <div className="development-grid figma-catalog-grid">
                {isDev
                  ? (state.items as PublicDevelopmentCard[]).map((item, index) => (
                      <DevelopmentCard key={item.slug ?? `${item.name}-${index}`} item={item} />
                    ))
                  : (state.items as PublicListingCard[]).map((item, index) => (
                      <ListingCard key={item.slug ?? `listing-${index}`} item={item} />
                    ))}
              </div>
            )}

            {state.loadMoreError && (
              <div className="pagination-error-panel" role="alert">
                <p>{state.loadMoreError}</p>
                <button type="button" className="retry-btn" onClick={retryLoadMore}>
                  {t('common.tryAgain')}
                </button>
              </div>
            )}

            {state.nextCursor ? (
              <div className="load-more-container">
                <button
                  className="load-more"
                  type="button"
                  onClick={loadMore}
                  disabled={state.loadingMore}
                  aria-busy={state.loadingMore}
                >
                  {state.loadingMore ? t('catalogue.loadingMore') : t('catalogue.loadMore')}
                </button>
              </div>
            ) : (
              <p className="catalogue-end-note" aria-live="polite">
                {t('catalogue.allShown')}
              </p>
            )}
          </>
        ) : null}
      </section>

      <button className="visually-hidden" type="button" onClick={() => navigate('/')}>
        {t('catalogue.backToStart')}
      </button>
    </Shell>
  )
}

function DevelopmentDetailPage() {
  const { slug } = useParams()
  const state = useDevelopmentDetail(slug)
  const [selectedUnit, setSelectedUnit] = useState<UnitInfo | null>(null)
  const { t } = useI18n()

  useSeoMetadata(
    state.status === 'ready'
      ? {
          title: developmentTitle(state.item, t),
          description: state.item.description || t('devDetail.descriptionFallback', { title: developmentTitle(state.item, t) }),
          jsonLd: buildDevelopmentJsonLd(
            state.item,
            typeof window !== 'undefined' ? window.location.origin : '',
            t
          ),
        }
      : {
          title: state.status === 'not-found' ? t('devDetail.notFoundTitle') : undefined,
        }
  )

  /**
   * Планировки комплекса из публичной проекции (MarketplacePublication.denormalizedFields.units).
   * Если застройщик опубликовал квартиры в этом ЖК, они отображаются здесь с реальными
   * ценами и площадями; если нет — честное сообщение об отсутствии опубликованных планировок.
   */
  const units: UnitInfo[] = (state.status === 'ready' && state.item.units ? state.item.units : []).map((u) => ({
    title: u.number
      ? t('devDetail.unitTitleNumbered', { number: u.number })
      : u.kind === 'apartment'
        ? t('devDetail.unitTitleApartment')
        : t('devDetail.unitTitleSpace'),
    area: u.area ?? 0,
    rooms: u.rooms,
    floor: u.floor,
    price: formatMoneyAmount(u.price, t) ?? undefined,
    planImageUrl: u.planImageUrl,
  }))

  return (
    <Shell>
      <section className="detail-page figma-dev-detail" aria-labelledby="development-detail-title">
        <Link className="back-link" to="/" aria-label={t('devDetail.backAria')}>
          {t('common.backArrow')}
        </Link>
        {state.status === 'loading' ? (
          <div className="state-panel" role="status" aria-busy="true">
            {t('common.loadingItem')}
          </div>
        ) : null}
        {state.status === 'not-found' ? (
          <div className="state-panel state-panel--error" role="alert">
            <p>{t('devDetail.notFoundBody')}</p>
            <Link to="/" className="back-to-catalogue-btn">
              {t('common.backToCatalogue')}
            </Link>
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="state-panel state-panel--error" role="alert">
            <p>{state.message}</p>
            <button type="button" className="retry-btn" onClick={state.retry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            {/* Top Hero: Gallery & Details (Figma 3314:200744 & 3314:200763) */}
            <div className="detail-hero figma-dev-hero">
              <div className="figma-dev-gallery">
                <BuildingPlaceholder />
              </div>
              <div className="detail-hero__copy figma-dev-summary">
                <div className="figma-dev-badges">
                  <span className="figma-badge figma-badge--completed">{t('devDetail.onSale')}</span>
                  {state.item.classType ? (
                    <span className="figma-badge figma-badge--class">{state.item.classType}</span>
                  ) : null}
                </div>
                <h1 id="development-detail-title" className="figma-dev-title">
                  {developmentTitle(state.item, t)}
                </h1>
                <p className="address figma-dev-address">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{developmentAddress(state.item, t)}</span>
                </p>

                {/*
                  Застройщик ведёт в каталог, отфильтрованный по нему: отдельной
                  страницы компании нет (решение владельца от 04.09.2026, как на
                  действующем baza.sale).
                */}
                {state.item.publisher ? (
                  <p className="figma-dev-publisher">
                    {t('devDetail.publisherPrefix')}{' '}
                    <Link to={`/newconstructions?publisher=${encodeURIComponent(state.item.publisher.id)}`}>
                      {state.item.publisher.name}
                    </Link>
                  </p>
                ) : null}

                {state.item.priceFrom ? (
                  <div className="figma-dev-pricing-card">
                    <span className="figma-dev-spec-label">{t('devDetail.priceLabel')}</span>
                    <div className="figma-dev-price-main">
                      {t('devDetail.priceFromPrefix')} {formatMoneyAmount(state.item.priceFrom, t)}
                    </div>
                  </div>
                ) : null}

                {slug ? <RevealContactCTA slug={slug} type="development" /> : null}
              </div>
            </div>

            {/* Specs Ribbon (Figma 3314:200845) */}
            <div className="detail-facts figma-dev-ribbon" aria-label={t('devDetail.factsAria')}>
              <div className="figma-dev-spec">
                <span className="figma-dev-spec-label">{t('devDetail.completionLabel')}</span>
                <strong className="figma-dev-spec-value">{completionLabel(state.item.completionDate, t) ?? t('common.clarify')}</strong>
              </div>
              <div className="figma-dev-spec">
                <span className="figma-dev-spec-label">{t('devDetail.classLabel')}</span>
                <strong className="figma-dev-spec-value">{state.item.classType ?? t('devDetail.classFallback')}</strong>
              </div>
              <div className="figma-dev-spec">
                <span className="figma-dev-spec-label">{t('common.country')}</span>
                <strong className="figma-dev-spec-value">{state.item.location?.country ?? t('devDetail.countryFallback')}</strong>
              </div>
              <div className="figma-dev-spec">
                <span className="figma-dev-spec-label">{t('common.city')}</span>
                <strong className="figma-dev-spec-value">{state.item.location?.city ?? t('devDetail.cityFallback')}</strong>
              </div>
            </div>

            {/* About Project (Figma 3314:200866) */}
            <section className="detail-description figma-dev-section" aria-labelledby="about-project-heading">
              <h2 id="about-project-heading" className="figma-dev-section-title">{t('devDetail.aboutHeading')}</h2>
              <p className="figma-dev-description">
                {state.item.description?.trim() || t('devDetail.aboutFallback')}
              </p>
            </section>

            {/* Layouts and Units Matrix (Figma 3314:202465) */}
            <section id="units" className="figma-dev-section" aria-label={t('devDetail.unitsHeading')}>
              <h2 className="figma-dev-section-title">{t('devDetail.unitsHeading')}</h2>
              {units.length === 0 ? (
                <p className="figma-dev-description">
                  {t('devDetail.noUnits')}
                </p>
              ) : null}
              <div className="figma-units-matrix">
                {units.map((u, i) => (
                  <div key={i} className="figma-unit-card">
                    <h3 className="figma-unit-card__title">{u.title}</h3>
                    <div className="figma-unit-card__meta">
                      <span>{t('devDetail.unitArea', { area: u.area })}</span>
                      {u.floor !== undefined ? <span>{t('devDetail.unitFloor', { floor: u.floor })}</span> : null}
                    </div>
                    <div className="figma-unit-card__price">{u.price}</div>
                    <button
                      type="button"
                      className="figma-unit-card__btn"
                      onClick={() => setSelectedUnit(u)}
                    >
                      {t('devDetail.viewPlan')}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Заявка застройщику: лид создаётся только отсюда */}
            <section className="figma-listing-contacts" id="request" aria-labelledby="dev-request-heading">
              <h2 id="dev-request-heading" className="figma-dev-section-title">{t('devDetail.requestHeading')}</h2>
              <ListingContactForm slug={slug!} type="development" />
            </section>

            {/* Quick View Modal (Figma 3314:203298) */}
            <UnitQuickViewModal
              unit={selectedUnit}
              developmentName={developmentTitle(state.item, t)}
              onClose={() => setSelectedUnit(null)}
              onRequest={() => {
                setSelectedUnit(null)
                document.getElementById('request')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                document.getElementById('lead-phone')?.focus({ preventScroll: true })
              }}
            />
          </>
        ) : null}
      </section>
    </Shell>
  )
}

function ListingDetailPage() {
  const { slug } = useParams()
  const state = useListingDetail(slug)
  const { t } = useI18n()

  useSeoMetadata(
    state.status === 'ready'
      ? {
          title: state.item.seo?.title || listingTitle(state.item, t),
          description:
            state.item.seo?.description ||
            t('listingDetail.descriptionFallback', { title: listingTitle(state.item, t), address: listingAddress(state.item, t) }),
          imageUrl: state.item.media?.find((m) => m.role === 'cover')?.url || state.item.media?.[0]?.url,
          jsonLd: buildListingJsonLd(
            state.item,
            typeof window !== 'undefined' ? window.location.origin : '',
            t
          ),
        }
      : {
          title: state.status === 'not-found' ? t('listingDetail.notFoundTitle') : undefined,
        }
  )

  return (
    <Shell>
      <section className="detail-page figma-listing-detail" aria-labelledby="listing-detail-title">
        <Link className="back-link" to="/secondary" aria-label={t('listingDetail.backAria')}>
          {t('common.backArrow')}
        </Link>
        {state.status === 'loading' ? (
          <div className="state-panel" role="status" aria-busy="true">
            {t('common.loadingItem')}
          </div>
        ) : null}
        {state.status === 'not-found' ? (
          <div className="state-panel state-panel--error" role="alert">
            <p>{t('listingDetail.notFoundBody')}</p>
            <Link to="/secondary" className="back-to-catalogue-btn">
              {t('common.backToCatalogue')}
            </Link>
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="state-panel state-panel--error" role="alert">
            <p>{state.message}</p>
            <button type="button" className="retry-btn" onClick={state.retry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            {/* Top Hero: Gallery & Details (Figma 3314:206822) */}
            <div className="detail-hero detail-hero--listing figma-listing-hero">
              <div className="figma-listing-gallery">
                <ListingMediaGallery media={state.item.media} title={listingTitle(state.item, t)} />
              </div>
              <div className="detail-hero__copy figma-listing-summary">
                <div className="figma-listing-summary__badges">
                  <span className="listing-badge figma-listing-card__badge figma-listing-card__badge--deal">
                    {listingDealTypeLabel(state.item.dealType, t)}
                  </span>
                  {state.item.isVerified ? (
                    <span className="figma-listing-card__badge figma-listing-card__badge--verified">
                      {t('listingDetail.verified')}
                    </span>
                  ) : null}
                </div>
                <h1 id="listing-detail-title" className="figma-listing-title">
                  {listingTitle(state.item, t)}
                </h1>
                <p className="address figma-listing-address">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{listingAddress(state.item, t)}</span>
                </p>

                {/*
                  Компания-продавец ведёт в каталог, отфильтрованный по ней.
                  Раздел выбирается по типу сделки, чтобы ссылка не уводила
                  туда, где этих объектов заведомо нет.
                */}
                {state.item.publisher ? (
                  <p className="figma-listing-publisher">
                    {t('listingDetail.publisherPrefix')}{' '}
                    <Link to={`${listingSectionPath(state.item.dealType)}?publisher=${encodeURIComponent(state.item.publisher.id)}`}>
                      {state.item.publisher.name}
                    </Link>
                  </p>
                ) : null}

                <div className="detail-price-box figma-listing-pricing-card">
                  <p className="detail-price-main figma-listing-price-main">
                    {listingPrice(state.item, t)}
                    {state.item.dealType === 'rent_short' ? (
                      <span className="figma-listing-price-sub">{t('card.perDay')}</span>
                    ) : state.item.dealType === 'rent_long' ? (
                      <span className="figma-listing-price-sub">{t('card.perMonth')}</span>
                    ) : null}
                  </p>
                  <p className="meta figma-listing-price-sub">
                    {listingPropertyTypeLabel(state.item.propertyType, state.item.commercialSubtype, t)}
                  </p>
                </div>
                {slug ? <RevealContactCTA slug={slug} type="listing" /> : null}
              </div>
            </div>

            {/* Facts / Specifications Ribbon */}
            <div className="detail-facts figma-listing-ribbon" aria-label={t('listingDetail.factsAria')}>
              <div className="figma-listing-spec">
                <span className="figma-listing-spec-label">{t('listingDetail.dealTypeLabel')}</span>
                <strong className="figma-listing-spec-value">{listingDealTypeLabel(state.item.dealType, t)}</strong>
              </div>
              <div className="figma-listing-spec">
                <span className="figma-listing-spec-label">{t('listingDetail.areaLabel')}</span>
                <strong className="figma-listing-spec-value">
                  {state.item.characteristics?.area ? t('card.area', { area: state.item.characteristics.area }) : '—'}
                </strong>
              </div>
              <div className="figma-listing-spec">
                <span className="figma-listing-spec-label">{t('listingDetail.roomsLabel')}</span>
                <strong className="figma-listing-spec-value">{state.item.characteristics?.rooms ?? '—'}</strong>
              </div>
              <div className="figma-listing-spec">
                <span className="figma-listing-spec-label">{t('listingDetail.floorLabel')}</span>
                <strong className="figma-listing-spec-value">
                  {state.item.characteristics?.floor
                    ? `${state.item.characteristics.floor}${state.item.characteristics.totalFloors ? ` / ${state.item.characteristics.totalFloors}` : ''}`
                    : '—'}
                </strong>
              </div>
              <div className="figma-listing-spec">
                <span className="figma-listing-spec-label">{t('common.city')}</span>
                <strong className="figma-listing-spec-value">{state.item.location?.city ?? t('common.clarify')}</strong>
              </div>
              <div className="figma-listing-spec">
                <span className="figma-listing-spec-label">{t('common.country')}</span>
                <strong className="figma-listing-spec-value">{state.item.location?.country ?? t('common.clarify')}</strong>
              </div>
            </div>

            {/* Description Section */}
            <section className="detail-description figma-listing-section" aria-labelledby="listing-description-heading">
              <h2 id="listing-description-heading" className="figma-listing-section-title">{t('listingDetail.descriptionHeading')}</h2>
              <p className="figma-listing-description">
                {state.item.seo?.description?.trim() || t('listingDetail.descriptionFallbackText')}
              </p>
            </section>

            {/* Contacts & Lead Generation Section (Figma 3304:57919) */}
            <section className="figma-listing-contacts" id="contacts" aria-labelledby="contacts-heading">
              <h2 id="contacts-heading" className="figma-listing-section-title">{t('listingDetail.contactsHeading')}</h2>
              <ListingContactForm slug={slug!} />
            </section>
          </>
        ) : null}
      </section>
    </Shell>
  )
}

function PublishingWizardPage() {
  const { t } = useI18n()
  useSeoMetadata({
    title: t('publishPage.title'),
    description: t('publishPage.description'),
    canonicalUrl: `${window.location.origin}/publish`,
  })

  return (
    <Shell>
      <PublishingWizard />
    </Shell>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<Shell><HomePage /></Shell>} />
          {/*
            Разделы каталога. Маршрут задаёт раздел, query — фильтры внутри него.
            Пути совпадают с действующим baza.sale, чтобы не ломать внешние ссылки
            и SEO-инвентарь.
          */}
          <Route path="/newconstructions" element={<CataloguePage defaultTab="developments" />} />
          <Route path="/secondary" element={<CataloguePage defaultTab="listings" defaultDealType="sale" />} />
          <Route path="/rent" element={<CataloguePage defaultTab="listings" defaultDealType="rent_long" />} />
          <Route path="/developments/:slug" element={<DevelopmentDetailPage />} />
          <Route path="/listings/:slug" element={<ListingDetailPage />} />
          <Route path="/realtors" element={<Shell><RealtorsPage /></Shell>} />
          <Route path="/realtors/:id" element={<Shell><RealtorProfilePage /></Shell>} />
          <Route path="/favorites" element={<Shell><FavoritesPage /></Shell>} />
          <Route path="/account/favorites" element={<Shell><RequireAuth><FavoritesPage /></RequireAuth></Shell>} />
          <Route path="/account/team" element={<Shell><RequireAuth><MyTeamPage /></RequireAuth></Shell>} />
          <Route path="/join/:code" element={<Shell><JoinTeamPage /></Shell>} />
          <Route path="/selections" element={<Shell><SelectionsPage /></Shell>} />
          <Route path="/selections/:slug" element={<Shell><SelectionDetailPage /></Shell>} />
          <Route path="/my-selection/:token" element={<Shell><MySelectionDetailPage /></Shell>} />
          <Route path="/requests" element={<Shell><RequestsPage /></Shell>} />
          <Route path="/account/properties" element={<Shell><RequireAuth><MyPropertiesPage /></RequireAuth></Shell>} />
          <Route
            path="/account/properties/:assetId/listings/:listingId/edit"
            element={<Shell><RequireAuth><EditListingPage /></RequireAuth></Shell>}
          />
          <Route path="/account" element={<Shell><RequireAuth><MyPropertiesPage /></RequireAuth></Shell>} />
          <Route path="/auth/login" element={<Shell><AuthPage mode="login" /></Shell>} />
          <Route path="/auth/register" element={<Shell><AuthPage mode="register" /></Shell>} />
          <Route path="/publish" element={<PublishingWizardPage />} />
          {/*
            Неизвестный адрес отдаёт 404, а не главную: иначе битая ссылка выглядит
            как рабочая страница, и человек не понимает, что ошибся адресом.
          */}
          <Route path="*" element={<Shell><NotFoundPage /></Shell>} />
        </Routes>
      </RouteErrorBoundary>
    </I18nProvider>
  )
}
