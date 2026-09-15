import { useRef, useState, type FormEvent } from 'react'
import { marketplaceApi, MarketplaceApiError } from '../api/marketplace-api'
import { useI18n } from '../i18n'

export interface ListingContactFormProps {
  slug: string
  /** development — заявка застройщику со страницы ЖК, listing — представителю объекта. */
  type?: 'listing' | 'development'
}

export function extractUtmParams(search: string): Record<string, string> | undefined {
  if (!search) return undefined
  const params = new URLSearchParams(search)
  const utm: Record<string, string> = {}
  let hasUtm = false

  for (const [key, value] of params.entries()) {
    if (key.startsWith('utm_') || key === 'utm') {
      utm[key] = value
      hasUtm = true
    }
  }

  return hasUtm ? utm : undefined
}

/**
 * Форма заявки: посетитель оставляет телефон — у застройщика или владельца
 * объекта появляется лид (воронка «Продажи»), а посетитель видит прямой номер.
 * Лиды с витрины создаются только отсюда, не кнопкой «Показать телефон».
 */
export function ListingContactForm({ slug, type = 'listing' }: ListingContactFormProps) {
  const { t } = useI18n()
  const copy = type === 'development' ? 'devContact' : 'listingContact'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  // React state updates are not synchronous, so two submit events dispatched
  // before the first re-render commits would both read status === 'idle' and
  // both fire a real network request. This ref is checked and flipped
  // immediately, ahead of any state/await, to close that window.
  const isSubmittingRef = useRef(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmittingRef.current) return

    const trimmedPhone = phone.trim()
    if (!trimmedPhone) {
      setStatus('error')
      setErrorMessage(t(`${copy}.errorPhoneRequired`))
      setErrorStatus(400)
      return
    }

    isSubmittingRef.current = true
    setStatus('submitting')
    setErrorMessage(null)
    setErrorStatus(null)

    try {
      const search = typeof window !== 'undefined' ? window.location.search : ''
      const utm = extractUtmParams(search)

      const reveal =
        type === 'development' ? marketplaceApi.revealDevelopmentContact : marketplaceApi.revealListingContact
      const response = await reveal(slug, {
        requesterName: name.trim() || undefined,
        requesterPhone: trimmedPhone,
        utm,
      })

      setRevealedPhone(response.phone)
      setStatus('success')
    } catch (err) {
      setStatus('error')
      if (err instanceof MarketplaceApiError) {
        setErrorStatus(err.status)
        setErrorMessage(err.message)
      } else {
        setErrorStatus(500)
        setErrorMessage(t(`${copy}.errorGeneric`))
      }
    } finally {
      isSubmittingRef.current = false
    }
  }

  if (status === 'success' && revealedPhone) {
    return (
      <section className="listing-lead-card listing-lead-card--success" aria-live="polite">
        <div className="listing-lead-card__header">
          <span className="listing-lead-card__badge">{t(`${copy}.submitted`)}</span>
          <h3>{t(`${copy}.repContacts`)}</h3>
          <p>{t(`${copy}.directPhone`)}</p>
        </div>
        <div className="listing-lead-card__revealed-box">
          <a className="listing-lead-card__phone-link" href={`tel:${revealedPhone}`}>
            {revealedPhone}
          </a>
        </div>
        <p className="listing-lead-card__subtext">{t(`${copy}.managerNotified`)}</p>
      </section>
    )
  }

  return (
    <section className="listing-lead-card">
      {/*
        Заголовок даёт секция-обёртка на детальной странице
        (`figma-listing-contacts` в App.tsx, `h2#contacts-heading`). Свой `h3`
        здесь был бы вторым заголовком с ровно тем же текстом: на экране это
        видно как дубль, а для программ чтения с экрана и для тестов — два
        разных элемента с одинаковым именем.
      */}
      <div className="listing-lead-card__header">
        <p>{t(`${copy}.intro`)}</p>
      </div>

      <form className="listing-lead-form" onSubmit={handleSubmit} noValidate>
        {status === 'error' && errorMessage ? (
          <div className="listing-lead-form__error" role="alert">
            <p>{errorMessage}</p>
            {errorStatus !== 404 && errorStatus !== 429 ? (
              <button
                type="button"
                className="listing-lead-form__retry-btn"
                onClick={() => {
                  setStatus('idle')
                  setErrorMessage(null)
                }}
              >
                {t('common.tryAgain')}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="listing-lead-form__field">
          <label htmlFor="lead-phone">{t(`${copy}.phoneLabel`)}</label>
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="+995 555 12 34 56"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={status === 'submitting'}
          />
        </div>

        <div className="listing-lead-form__field">
          <label htmlFor="lead-name">{t(`${copy}.nameLabel`)}</label>
          <input
            id="lead-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder={t(`${copy}.namePlaceholder`)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status === 'submitting'}
          />
        </div>

        <button
          type="submit"
          className="listing-lead-form__submit"
          disabled={status === 'submitting' || !phone.trim()}
        >
          {status === 'submitting' ? t(`${copy}.sending`) : t(`${copy}.submit`)}
        </button>
      </form>
    </section>
  )
}
