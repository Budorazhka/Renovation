import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { useI18n } from '../i18n'
import { marketplaceApi, MarketplaceApiError } from '../api/marketplace-api'
import { publishingApi, PublishingApiError } from '../features/publishing/api/publishing-api'
import type { PublicRealtorProfile, PublicRealtorReview } from '../types/marketplace'

/**
 * RealtorProfilePage (Figma: Отзывы `3576:53737`, Добавить отзыв `3576:53923`, MKT-SCR-015)
 *
 * N-13: подключено к реальному API — GET /public/realtors/:id,
 * GET /public/realtors/:id/reviews, POST /marketplace/realtor-reviews.
 * `completedDealId` — реальный id сделки в CRM, известный только риэлтору
 * (у покупателя нет самостоятельного способа его узнать: между аккаунтом
 * покупателя на сайте и CRM-карточкой сделки нет автоматической связи, см.
 * docs/operations/buyer-requests-and-reviews.md). Поле формы честно
 * подписано как "код сделки от риэлтора", а не скрыто/подделано.
 */
export function RealtorProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useI18n()

  const [profile, setProfile] = useState<PublicRealtorProfile | null>(null)
  const [reviews, setReviews] = useState<PublicRealtorReview[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    try {
      const [profileResult, reviewsResult] = await Promise.all([
        marketplaceApi.getPublicRealtor(id),
        marketplaceApi.listApprovedRealtorReviews(id),
      ])
      setProfile(profileResult)
      setReviews(reviewsResult)
      setStatus('ready')
    } catch (cause) {
      if (cause instanceof MarketplaceApiError && cause.status === 404) {
        setStatus('notFound')
      } else {
        setErrorMessage(cause instanceof Error ? cause.message : t('realtorProfile.loadError'))
        setStatus('error')
      }
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  useSeoMetadata({
    title: profile ? t('realtorProfile.seoTitle', { name: profile.name, city: profile.city ?? '' }) : t('realtors.seoTitle'),
    description: profile ? t('realtorProfile.seoDescription', { name: profile.name, agency: profile.organizationName }) : t('realtors.seoDescription'),
  })

  const handleRevealPhone = async () => {
    if (!id) return
    setRevealing(true)
    try {
      const result = await marketplaceApi.revealRealtorPhone(id)
      setPhone(result.phone)
    } catch {
      // Тихо: телефон мог не быть заполнен в профиле — кнопка просто не даёт результата.
    } finally {
      setRevealing(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="figma-realtors-page state-panel" role="status" aria-busy="true">
        <p>{t('realtorProfile.loading')}</p>
      </div>
    )
  }

  if (status === 'notFound') {
    return (
      <div className="figma-realtors-page state-panel state-panel--empty">
        <p>{t('realtorProfile.notFound')}</p>
        <Link className="back-link" to="/realtors">{t('realtorProfile.backLabel')}</Link>
      </div>
    )
  }

  if (status === 'error' || !profile) {
    return (
      <div className="figma-realtors-page state-panel state-panel--error">
        <p>{errorMessage ?? t('realtorProfile.loadError')}</p>
      </div>
    )
  }

  return (
    <div className="figma-realtors-page">
      <Link className="back-link" to="/realtors" aria-label={t('realtorProfile.backAria')} style={{ display: 'inline-flex', marginBottom: '24px', color: '#757575', textDecoration: 'none' }}>
        {t('realtorProfile.backLabel')}
      </Link>

      <div className="figma-realtor-profile-hero">
        {profile.avatarUrl ? (
          <img className="figma-realtor-profile-avatar" src={profile.avatarUrl} alt="" aria-hidden="true" />
        ) : (
          <div className="figma-realtor-profile-avatar" aria-hidden="true">
            {profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'}
          </div>
        )}
        <div>
          <h1 style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '28px', margin: '0 0 6px', color: '#ffffff' }}>{profile.name}</h1>
          <p style={{ margin: '0 0 10px', color: 'rgba(255, 255, 255, 0.72)', fontSize: '15px' }}>
            {profile.organizationName}{profile.city ? ` · ${profile.city}` : ''}
          </p>
          <div className="figma-realtor-rating-row" style={{ fontSize: '15px', color: '#ffffff' }}>
            {profile.rating ? (
              <>
                <span className="figma-realtor-stars">★ {profile.rating.average.toFixed(1)}</span>
                <span>{t('realtorProfile.reviewsCount', { count: profile.rating.count })}</span>
              </>
            ) : (
              <span>{t('realtors.noReviewsYet')}</span>
            )}
          </div>
        </div>

        <div>
          {phone ? (
            <a href={`tel:${phone.replace(/\s+/g, '')}`} className="figma-realtor-card__btn" style={{ display: 'inline-block', textDecoration: 'none', padding: '12px 24px' }}>
              {t('realtorProfile.contact', { phone })}
            </a>
          ) : (
            <button type="button" className="figma-realtor-card__btn" style={{ padding: '12px 24px' }} onClick={() => void handleRevealPhone()} disabled={revealing}>
              {revealing ? t('requests.card.revealing') : t('realtorProfile.revealPhone')}
            </button>
          )}
        </div>
      </div>

      {profile.aboutMe ? (
        <section style={{ marginBottom: '32px' }}>
          <p className="figma-realtor-about">{profile.aboutMe}</p>
        </section>
      ) : null}

      <section aria-labelledby="reviews-heading" style={{ marginBottom: '40px' }}>
        <h2 id="reviews-heading" style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '22px', marginBottom: '20px' }}>
          {t('realtorProfile.reviewsHeading', { count: reviews.length })}
        </h2>

        {reviews.length === 0 ? (
          <p style={{ color: '#757575' }}>{t('realtorProfile.noReviews')}</p>
        ) : (
          <div className="figma-reviews-list">
            {reviews.map((rev) => (
              <div key={rev.id} className="figma-review-item">
                <div className="figma-review-header">
                  <span className="figma-realtor-stars">{'★'.repeat(rev.rating)}</span>
                  <span className="figma-review-date">{new Date(rev.createdAt).toLocaleDateString('ru-RU')}</span>
                </div>
                <p className="figma-review-text">{rev.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <AddReviewSection realtorPositionId={profile.id} t={t} />
    </div>
  )
}

function AddReviewSection({ realtorPositionId, t }: { realtorPositionId: string; t: (key: string, params?: Record<string, string | number>) => string }) {
  const [dealId, setDealId] = useState('')
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<'idle' | 'sent' | 'requiresAuth' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setResult('idle')
    try {
      await publishingApi.submitRealtorReview({ realtorPositionId, completedDealId: dealId.trim(), rating, text })
      setResult('sent')
    } catch (cause) {
      if (cause instanceof PublishingApiError && (cause.status === 401 || cause.status === 403)) {
        setResult('requiresAuth')
      } else {
        setErrorMessage(cause instanceof Error ? cause.message : t('realtorProfile.reviewError'))
        setResult('error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="figma-listing-section" aria-labelledby="add-review-heading">
      <h2 id="add-review-heading" className="figma-listing-section-title">{t('realtorProfile.addReviewHeading')}</h2>

      {result === 'sent' ? (
        <div style={{ padding: '16px', background: '#F0FFF0', border: '1px solid #1BA800', borderRadius: '8px', color: '#1BA800', fontWeight: 600 }}>
          {t('realtorProfile.reviewAdded')}
        </div>
      ) : result === 'requiresAuth' ? (
        <div style={{ padding: '16px', background: '#FFF8E1', border: '1px solid #E0A800', borderRadius: '8px' }}>
          <p style={{ margin: '0 0 10px' }}>{t('selections.requiresAuth')}</p>
          <Link className="figma-realtor-card__btn" to="/auth/login?next=%2Frealtors" style={{ display: 'inline-block', textDecoration: 'none', padding: '10px 18px' }}>
            {t('header.login')}
          </Link>
        </div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label htmlFor="rev-deal" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              {t('realtorProfile.dealIdLabel')}
            </label>
            <input
              id="rev-deal"
              type="text"
              required
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              placeholder={t('realtorProfile.dealIdPlaceholder')}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #EAEAEA', fontSize: '14px', boxSizing: 'border-box' }}
            />
            <span style={{ fontSize: '12px', color: '#999' }}>{t('realtorProfile.dealIdHint')}</span>
          </div>

          <div>
            <label htmlFor="rev-rating" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              {t('realtorProfile.ratingLabel')}
            </label>
            <select id="rev-rating" value={rating} onChange={(e) => setRating(Number(e.target.value))} style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #EAEAEA', fontSize: '14px' }}>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={value}>{'★'.repeat(value)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rev-text" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              {t('realtorProfile.reviewText')}
            </label>
            <textarea
              id="rev-text"
              required
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('realtorProfile.reviewTextPlaceholder')}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #EAEAEA', fontSize: '14px', boxSizing: 'border-box' }}
            />
          </div>

          {result === 'error' ? <p style={{ color: '#b3261e', fontSize: '14px' }}>{errorMessage}</p> : null}

          <button type="submit" className="figma-realtor-card__btn" style={{ maxWidth: '240px', padding: '12px 20px' }} disabled={submitting}>
            {submitting ? t('realtorProfile.submitting') : t('realtorProfile.submitReview')}
          </button>
        </form>
      )}
    </section>
  )
}
