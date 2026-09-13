import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { useBuyerRequestsBoard } from '../hooks/useBuyerRequestsBoard'
import { useI18n } from '../i18n'
import type { Language, Translate } from '../i18n'
import { marketplaceApi, MarketplaceApiError } from '../api/marketplace-api'
import { publishingApi, PublishingApiError } from '../features/publishing/api/publishing-api'
import type { PublicBuyerRequest } from '../types/marketplace'

/*
 * Доска запросов клиентов — фрейм `search result (2 page)` (`2287:34150`,
 * он же MKT-SCR-016 `2287:35159` в реестре экранов): слева панель «Фильтр»
 * (`2287:34177`), в центре строка со счётчиком (`2287:34221`) и карточки
 * «card Запрос» (`2287:34226`).
 *
 * N-13: бэкенд реальный (apps/api/src/modules/buyer-requests). Часть
 * фильтров макета («Актуальность», многозначный чекбокс типов, свободный
 * поиск) сервер не поддерживает — `GET /public/requests` фильтрует только
 * по одному dealType/city/propertyKind за раз, без full-text search и без
 * дат создания в фильтре. Показывать такие фильтры означало бы либо
 * фильтровать только уже загруженную страницу (сломанная пагинация — на
 * следующей "load more" странице неотфильтрованные карточки), либо визуально
 * обещать то, чего нет в API (PRODUCT.md: «никаких визуальных обещаний
 * функций, которых нет в API») — то и другое хуже честного вырезания.
 *
 * Телефон автора запроса НЕ входит в публичный список принципиально
 * (owner decision 14.09.2026) — раскрывается по клику через отдельный
 * rate-limited endpoint, тот же принцип, что reveal-contact у объявлений,
 * только в обратную сторону.
 */

type PropertyKind =
  | 'newbuild'
  | 'secondary'
  | 'house'
  | 'land'
  | 'other'
  | 'office'
  | 'warehouse'
  | 'retail'
  | 'free'

/* Подписи переключателей — ключи словаря, порядок как в макете (`2287:34200`…`2287:34214`). */
const RESIDENTIAL: Array<[PropertyKind, string]> = [
  ['newbuild', 'requests.kind.newbuild'],
  ['secondary', 'requests.kind.secondary'],
  ['house', 'requests.kind.house'],
  ['land', 'requests.kind.land'],
  ['other', 'requests.kind.other'],
]

const COMMERCIAL: Array<[PropertyKind, string]> = [
  ['office', 'requests.kind.office'],
  ['warehouse', 'requests.kind.warehouse'],
  ['retail', 'requests.kind.retail'],
  ['free', 'requests.kind.free'],
]

const KIND_SHORT_KEY: Record<PropertyKind, string> = {
  newbuild: 'requests.kindShort.newbuild',
  secondary: 'requests.kindShort.secondary',
  house: 'requests.kindShort.house',
  land: 'requests.kindShort.land',
  other: 'requests.kindShort.other',
  office: 'requests.kindShort.office',
  warehouse: 'requests.kindShort.warehouse',
  retail: 'requests.kindShort.retail',
  free: 'requests.kindShort.free',
}

const DEAL_LABEL_KEY: Record<'buy' | 'rent', string> = { buy: 'requests.category.buy', rent: 'requests.category.rent' }

const MONEY = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatBudget(budget: PublicBuyerRequest['budget'], t: Translate): string {
  const amount = `$${MONEY.format(budget.amount)}`
  return budget.perMonth ? t('requests.budget.perMonth', { amount }) : t('requests.budget.total', { amount })
}

function ruPlural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/**
 * Счётчик результатов согласуется по числу и роду только в русском —
 * английский и грузинский этого не требуют (в грузинском существительное
 * после числительного всегда в единственном числе).
 */
function countLabel(language: Language, count: number, t: Translate): string {
  if (language === 'ru') {
    const noun = ruPlural(count, ['запрос', 'запроса', 'запросов'])
    const verb = count % 10 === 1 && count % 100 !== 11 ? 'найден' : 'найдено'
    return `${count} ${noun} ${verb}`
  }
  if (language === 'ka') {
    return t('requests.count.ka', { count })
  }
  return t('requests.count.en', { count, noun: count === 1 ? t('requests.count.enSingular') : t('requests.count.enPlural') })
}

export function RequestsPage() {
  const { t, language } = useI18n()
  const [deal, setDeal] = useState<'all' | 'buy' | 'rent'>('all')
  const [kind, setKind] = useState<'all' | PropertyKind>('all')
  const [city, setCity] = useState<'all' | string>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const { state, loadMore, retryLoadMore } = useBuyerRequestsBoard({
    dealType: deal === 'all' ? undefined : deal,
    city: city === 'all' ? undefined : city,
    propertyKind: kind === 'all' ? undefined : kind,
  })

  useSeoMetadata({
    title: t('requests.seo.title'),
    description: t('requests.seo.description'),
  })

  const resetFilters = () => {
    setDeal('all')
    setKind('all')
    setCity('all')
  }

  const activeFilters = (deal !== 'all' ? 1 : 0) + (kind !== 'all' ? 1 : 0) + (city !== 'all' ? 1 : 0)
  const count = state.status === 'ready' ? state.items.length : 0

  // Открытая на телефоне панель фильтров закрывается по Escape.
  useEffect(() => {
    if (!filtersOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filtersOpen])

  return (
    <div className="bz-requests">
      <header className="bz-requests__head">
        <div className="bz-requests__intro">
          <h1>{t('requests.title')}</h1>
          <p>{t('requests.subtitle')}</p>
        </div>
        <button
          type="button"
          className="bz-rq-btn bz-rq-btn--call bz-requests__cta"
          onClick={() => setCreateOpen(true)}
          data-testid="add-request-btn"
        >
          <PlusIcon />
          {t('requests.cta')}
        </button>
      </header>

      <div className="bz-requests__layout">
        {filtersOpen ? (
          <div className="bz-rq-scrim" aria-hidden="true" onClick={() => setFiltersOpen(false)} />
        ) : null}

        <aside
          id="requests-filters"
          className={`bz-rq-filters${filtersOpen ? ' is-open' : ''}`}
          aria-label={t('requests.filters.aria')}
        >
          <div className="bz-rq-filters__top">
            <h2 className="bz-rq-filters__title">{t('requests.filters.title')}</h2>
            {activeFilters > 0 ? (
              <button type="button" className="bz-rq-filters__reset" onClick={resetFilters}>
                {t('requests.filters.reset')}
              </button>
            ) : null}
            <button
              type="button"
              className="bz-rq-filters__close"
              onClick={() => setFiltersOpen(false)}
              aria-label={t('requests.filters.close')}
            >
              <CloseIcon />
            </button>
          </div>

          <fieldset className="bz-rq-group">
            <legend className="bz-rq-group__title">{t('requests.category.legend')}</legend>
            <div className="bz-rq-radios">
              {(
                [
                  ['all', 'requests.category.all'],
                  ['buy', 'requests.category.buy'],
                  ['rent', 'requests.category.rent'],
                ] as const
              ).map(([value, labelKey]) => (
                <label key={value} className="bz-rq-radio">
                  <input
                    type="radio"
                    name="rq-deal"
                    value={value}
                    checked={deal === value}
                    onChange={() => setDeal(value)}
                  />
                  <span className="bz-rq-radio__mark" aria-hidden="true" />
                  <span className="bz-rq-radio__label">{t(labelKey)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="bz-rq-group">
            <label className="bz-rq-group__title" htmlFor="rq-kind">
              {t('requests.propertyType.legend')}
            </label>
            <div className="bz-rq-select">
              <select id="rq-kind" value={kind} onChange={(event) => setKind(event.target.value as 'all' | PropertyKind)}>
                <option value="all">{t('requests.city.all')}</option>
                <optgroup label={t('requests.propertyType.residential')}>
                  {RESIDENTIAL.map(([value, labelKey]) => (
                    <option key={value} value={value}>{t(labelKey)}</option>
                  ))}
                </optgroup>
                <optgroup label={t('requests.propertyType.commercial')}>
                  {COMMERCIAL.map(([value, labelKey]) => (
                    <option key={value} value={value}>{t(labelKey)}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div className="bz-rq-group">
            <label className="bz-rq-group__title" htmlFor="rq-city">
              {t('requests.city.label')}
            </label>
            <div className="bz-rq-select">
              <select id="rq-city" value={city} onChange={(event) => setCity(event.target.value)}>
                <option value="all">{t('requests.city.all')}</option>
                <option value="Батуми">{t('requests.city.batumi')}</option>
                <option value="Тбилиси">{t('requests.city.tbilisi')}</option>
              </select>
            </div>
          </div>

          <button type="button" className="bz-rq-btn bz-rq-btn--call bz-rq-filters__apply" onClick={() => setFiltersOpen(false)}>
            {t('requests.filters.applyShort')}
          </button>
        </aside>

        <section className="bz-rq-results" aria-labelledby="rq-count">
          <div className="bz-rq-bar">
            <p id="rq-count" className="bz-rq-bar__count" aria-live="polite">
              {state.status === 'ready' || state.status === 'empty' ? countLabel(language, count, t) : ''}
            </p>
            <button
              type="button"
              className="bz-rq-bar__filters"
              onClick={() => setFiltersOpen(true)}
              aria-controls="requests-filters"
              aria-expanded={filtersOpen}
            >
              <FilterIcon />
              {t('requests.filters.title')}
              {activeFilters > 0 ? <span className="bz-rq-bar__badge">{activeFilters}</span> : null}
            </button>
          </div>

          {state.status === 'loading' ? (
            <div className="state-panel" role="status" aria-busy="true">
              <p>{t('requests.loading')}</p>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div className="state-panel state-panel--error">
              <p>{state.message}</p>
              <button type="button" className="bz-rq-btn bz-rq-btn--outline retry-btn" onClick={state.retry}>
                {t('requests.retry')}
              </button>
            </div>
          ) : null}

          {state.status === 'empty' ? (
            <div className="bz-rq-empty">
              <p className="bz-rq-empty__title">{t('requests.empty.title')}</p>
              <p>{t('requests.empty.text')}</p>
              {activeFilters > 0 ? (
                <button type="button" className="bz-rq-btn bz-rq-btn--outline" onClick={resetFilters}>
                  {t('requests.empty.reset')}
                </button>
              ) : null}
            </div>
          ) : null}

          {state.status === 'ready' ? (
            <>
              <ol className="bz-rq-list">
                {state.items.map((request) => (
                  <li key={request.id}>
                    <RequestCard request={request} t={t} />
                  </li>
                ))}
              </ol>
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
                  {state.loadMoreError ? (
                    <div className="pagination-error-panel">
                      <p>{state.loadMoreError}</p>
                      <button type="button" className="bz-rq-btn bz-rq-btn--outline" onClick={retryLoadMore}>
                        {t('requests.retry')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="catalogue-end-note" aria-live="polite">{t('catalogue.allShown')}</p>
              )}
            </>
          ) : null}
        </section>
      </div>

      {createOpen ? <CreateRequestDialog onClose={() => setCreateOpen(false)} t={t} /> : null}
    </div>
  )
}

/**
 * Карточка запроса по `card Запрос` (`2287:34226`): заголовок 24px и дата
 * справа, текст запроса, строка контактов с телефоном по клику, линия,
 * внизу пары «подпись — значение».
 */
function RequestCard({ request, t }: { request: PublicBuyerRequest; t: Translate }) {
  const titleId = `${request.id}-title`
  const date = new Date(request.createdAt)
  const [phone, setPhone] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)

  const handleReveal = async () => {
    setRevealing(true)
    setRevealError(null)
    try {
      const result = await marketplaceApi.revealBuyerRequestPhone(request.id)
      setPhone(result.phone)
    } catch (cause) {
      setRevealError(cause instanceof MarketplaceApiError ? cause.message : t('requests.card.revealError'))
    } finally {
      setRevealing(false)
    }
  }

  return (
    <article className="bz-rq-card" aria-labelledby={titleId}>
      <div className="bz-rq-card__head">
        <h3 id={titleId} className="bz-rq-card__title">
          {request.title}
        </h3>
        <p className="bz-rq-card__date">
          {t('requests.card.datePrefix')} <time dateTime={date.toISOString().slice(0, 10)}>{date.toLocaleDateString('ru-RU')}</time>
        </p>
      </div>

      <p className="bz-rq-card__text">{request.comment}</p>

      <div className="bz-rq-card__contact">
        <PhoneIcon />
        <span className="bz-rq-card__contact-label">{t('requests.card.contacts')}</span>
        {phone ? (
          <span className="bz-rq-card__phone">{phone}</span>
        ) : (
          <button
            type="button"
            className="bz-rq-card__reveal"
            onClick={() => void handleReveal()}
            disabled={revealing}
            aria-label={t('requests.card.revealAria', { name: request.title })}
          >
            <EyeIcon />
            {revealing ? t('requests.card.revealing') : t('requests.card.reveal')}
          </button>
        )}
        {revealError ? <span className="bz-rq-card__reveal-error" role="alert">{revealError}</span> : null}
      </div>

      <div className="bz-rq-card__foot">
        <dl className="bz-rq-card__facts">
          <div>
            <dt>{t('requests.card.categoryLabel')}</dt>
            <dd>{t(DEAL_LABEL_KEY[request.dealType])}</dd>
          </div>
          <div>
            <dt>{t('requests.card.propertyLabel')}</dt>
            <dd>{t(KIND_SHORT_KEY[request.propertyKind as PropertyKind] ?? 'requests.kindShort.other')}</dd>
          </div>
          <div>
            <dt>{t('requests.card.budgetLabel')}</dt>
            <dd>{formatBudget(request.budget, t)}</dd>
          </div>
        </dl>
        {phone ? (
          <div className="bz-rq-card__actions">
            <a className="bz-rq-btn bz-rq-btn--call" href={`tel:${phone.replace(/\s/g, '')}`}>
              {t('requests.card.call')}
            </a>
          </div>
        ) : null}
      </div>
    </article>
  )
}

/**
 * Модальное окно: фокус внутрь при открытии и назад при закрытии, Escape
 * и клик по затемнению закрывают, прокрутка страницы под окном стоит.
 */
function Dialog({
  title,
  subtitle,
  onClose,
  t,
  children,
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  t: Translate
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.bz-rq-dialog__close)')
    first?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [])

  return (
    <div
      className="bz-rq-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} className="bz-rq-dialog__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="bz-rq-dialog__close" onClick={onClose} aria-label={t('requests.dialog.close')}>
          <CloseIcon />
        </button>
        <h2 id={titleId} className="bz-rq-dialog__title">
          {title}
        </h2>
        {subtitle ? <p className="bz-rq-dialog__subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  )
}

function CreateRequestDialog({ onClose, t }: { onClose: () => void; t: Translate }) {
  const [sent, setSent] = useState(false)
  const [requiresAuth, setRequiresAuth] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deal, setDeal] = useState<'buy' | 'rent'>('buy')
  const [kind, setKind] = useState<PropertyKind>('newbuild')
  const [cityValue, setCityValue] = useState('Батуми')
  const [budget, setBudget] = useState('')
  const [comment, setComment] = useState('')
  const [phone, setPhone] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await publishingApi.createBuyerRequest({
        dealType: deal,
        city: cityValue,
        propertyKind: kind,
        title: comment.slice(0, 120) || t('requests.create.defaultTitle'),
        comment,
        phone,
        budgetAmount: Number(budget) || 0,
        budgetCurrency: 'USD',
        budgetPerMonth: deal === 'rent',
      })
      setSent(true)
    } catch (cause) {
      if (cause instanceof PublishingApiError && (cause.status === 401 || cause.status === 403)) {
        setRequiresAuth(true)
      } else {
        setError(cause instanceof Error ? cause.message : t('requests.create.error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog title={t('requests.create.title')} subtitle={t('requests.create.subtitle')} onClose={onClose} t={t}>
      {requiresAuth ? (
        <div className="bz-rq-dialog__done" role="status">
          <p className="bz-rq-dialog__done-title">{t('selections.requiresAuth')}</p>
          <Link className="bz-rq-btn bz-rq-btn--call" to="/auth/login?next=%2Frequests">{t('header.login')}</Link>
        </div>
      ) : sent ? (
        <div className="bz-rq-dialog__done" role="status">
          <p className="bz-rq-dialog__done-title">{t('requests.create.sentTitle')}</p>
          <p>{t('requests.create.sentText')}</p>
          <button type="button" className="bz-rq-btn bz-rq-btn--outline" onClick={onClose}>
            {t('requests.create.close')}
          </button>
        </div>
      ) : (
        <form className="bz-rq-form" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="bz-rq-field">
            <legend className="bz-rq-field__label">{t('requests.create.needLegend')}</legend>
            <div className="bz-rq-radios">
              {(Object.keys(DEAL_LABEL_KEY) as Array<'buy' | 'rent'>).map((value) => (
                <label key={value} className="bz-rq-radio">
                  <input type="radio" name="rq-create-deal" checked={deal === value} onChange={() => setDeal(value)} />
                  <span className="bz-rq-radio__mark" aria-hidden="true" />
                  <span className="bz-rq-radio__label">{value === 'buy' ? t('requests.create.buy') : t('requests.create.rent')}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="bz-rq-form__row">
            <label className="bz-rq-field">
              <span className="bz-rq-field__label">{t('requests.create.propertyType')}</span>
              <span className="bz-rq-select">
                <select value={kind} onChange={(event) => setKind(event.target.value as PropertyKind)}>
                  {[...RESIDENTIAL, ...COMMERCIAL].map(([value, labelKey]) => (
                    <option key={value} value={value}>
                      {t(labelKey)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="bz-rq-field">
              <span className="bz-rq-field__label">{t('requests.create.city')}</span>
              <span className="bz-rq-select">
                <select value={cityValue} onChange={(event) => setCityValue(event.target.value)}>
                  <option value="Батуми">{t('requests.city.batumi')}</option>
                  <option value="Тбилиси">{t('requests.city.tbilisi')}</option>
                </select>
              </span>
            </label>
          </div>
          <label className="bz-rq-field">
            <span className="bz-rq-field__label">{deal === 'buy' ? t('requests.create.budgetBuy') : t('requests.create.budgetRent')}</span>
            <input
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              required
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder={deal === 'buy' ? t('requests.create.budgetPlaceholderBuy') : t('requests.create.budgetPlaceholderRent')}
            />
          </label>
          <label className="bz-rq-field">
            <span className="bz-rq-field__label">{t('requests.create.whatLabel')}</span>
            <textarea
              rows={4}
              required
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t('requests.create.whatPlaceholder')}
            />
          </label>
          <label className="bz-rq-field">
            <span className="bz-rq-field__label">{t('requests.create.phoneLabel')}</span>
            <input
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={t('requests.create.phonePlaceholder')}
            />
          </label>
          {error ? <p className="bz-rq-form__error" role="alert">{error}</p> : null}
          <div className="bz-rq-form__actions">
            <button type="button" className="bz-rq-btn bz-rq-btn--outline" onClick={onClose}>
              {t('requests.write.cancel')}
            </button>
            <button type="submit" className="bz-rq-btn bz-rq-btn--call" disabled={submitting}>
              {submitting ? t('requests.create.submitting') : t('requests.create.submit')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/* ── значки ─────────────────────────────────────────────────────────── */

function CloseIcon() {
  return (
    <svg className="bz-rq-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="bz-rq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg className="bz-rq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

/* Трубка из `fi_7269995` (`2287:34241`): залитая, фирменный зелёный. */
function PhoneIcon() {
  return (
    <svg className="bz-rq-icon bz-rq-card__contact-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"
      />
    </svg>
  )
}

/* Глаз из `fi_535193` (`2287:34248`). */
function EyeIcon() {
  return (
    <svg className="bz-rq-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
