import { useState } from 'react'
import { marketplaceApi, MarketplaceApiError } from '../api/marketplace-api'
import { useI18n } from '../i18n'

export interface RevealContactCTAProps {
  slug: string
  type?: 'development' | 'listing'
  phonePlaceholder?: string
  className?: string
}

/**
 * RevealContactCTA Component (Figma: 4687:62533 / 4687:62538 / 3304:59895)
 * «Показать телефон» застройщика или менеджера объекта. Лид не создаётся —
 * лид появляется только из формы заявки, где посетитель сам оставил телефон
 * (ListingContactForm). Номер берётся только с сервера: при ошибке — сообщение
 * и повтор, никаких подставных номеров.
 */
export function RevealContactCTA({
  slug,
  type = 'development',
  phonePlaceholder = '+995 599 •• •• ••',
  className = '',
}: RevealContactCTAProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'loading' | 'revealed' | 'error'>('idle')
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleReveal = async () => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const response =
        type === 'development'
          ? await marketplaceApi.revealDevelopmentContact(slug, {})
          : await marketplaceApi.revealListingContact(slug, {})

      if (response?.phone) {
        setRevealedPhone(response.phone)
        setStatus('revealed')
      } else {
        setStatus('error')
      }
    } catch (err) {
      setErrorMessage(err instanceof MarketplaceApiError ? err.message : null)
      setStatus('error')
    }
  }

  return (
    <div className={`figma-reveal-cta ${className}`.trim()} aria-label={t('revealCta.aria')}>
      {status === 'idle' && (
        <button
          type="button"
          className="figma-reveal-cta__btn figma-reveal-cta__btn--primary"
          onClick={handleReveal}
          aria-label={t('revealCta.showPhoneAria', { phone: phonePlaceholder })}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>{t('revealCta.showPhone', { phone: phonePlaceholder })}</span>
        </button>
      )}

      {status === 'loading' && (
        <button
          type="button"
          className="figma-reveal-cta__btn figma-reveal-cta__btn--primary"
          disabled
          aria-busy="true"
        >
          {t('revealCta.loading')}
        </button>
      )}

      {status === 'revealed' && revealedPhone && (
        <div className="figma-reveal-cta__revealed">
          <span className="figma-dev-spec-label">{t(type === 'development' ? 'revealCta.directNumber' : 'revealCta.directNumberListing')}</span>
          <a
            href={`tel:${revealedPhone.replace(/\s+/g, '')}`}
            className="figma-reveal-cta__phone-link"
          >
            {revealedPhone}
          </a>
        </div>
      )}

      {status === 'error' && (
        <div className="figma-reveal-cta__error">
          <p>{errorMessage || t('revealCta.errorGeneric')}</p>
          <button type="button" onClick={handleReveal}>{t('common.tryAgain')}</button>
        </div>
      )}
    </div>
  )
}
