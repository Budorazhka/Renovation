import React, { useEffect } from 'react'
import { useI18n } from '../i18n'

export interface UnitInfo {
  title: string
  area: number
  rooms?: number
  floor?: number
  price?: string
  planImageUrl?: string
}

export interface UnitQuickViewModalProps {
  unit: UnitInfo | null
  developmentName: string
  onClose: () => void
  /** Переход к форме заявки застройщику — бронь без заявки не создаётся. */
  onRequest: () => void
}

/**
 * UnitQuickViewModal Component (Figma: 3314:203298 / mob 3314:203350)
 * Popup dialog showing 2D floor plan schematic layout, characteristics, and reservation CTA.
 */
export function UnitQuickViewModal({
  unit,
  developmentName,
  onClose,
  onRequest,
}: UnitQuickViewModalProps) {
  const { t } = useI18n()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!unit) return null

  return (
    <div
      className="figma-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('unitModal.ariaLabel', { title: unit.title })}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="figma-unit-modal">
        {/* Close Button */}
        <button
          type="button"
          className="figma-unit-modal__close"
          onClick={onClose}
          aria-label={t('unitModal.closeAria')}
        >
          ✕
        </button>

        {/* Left: 2D Floor Plan Layout Schematic (Figma 3314:203299) */}
        <div className="figma-unit-modal__plan" aria-label={t('unitModal.planAria')}>
          {unit.planImageUrl ? (
            <img
              src={unit.planImageUrl}
              alt={t('unitModal.planAlt', { title: unit.title })}
              style={{ maxWidth: '100%', maxHeight: '420px', objectFit: 'contain' }}
            />
          ) : (
            <svg
              width="320"
              height="320"
              viewBox="0 0 320 320"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Architectural layout blueprint */}
              <rect x="20" y="20" width="280" height="280" rx="4" stroke="#151515" strokeWidth="4" fill="#ffffff" />
              <rect x="20" y="20" width="160" height="180" stroke="#555454" strokeWidth="2" strokeDasharray="4 4" />
              <text x="50" y="100" fill="#555454" fontSize="14" fontFamily="sans-serif">{t('unitModal.livingRoom')}</text>
              <text x="50" y="120" fill="#169600" fontSize="12" fontWeight="bold" fontFamily="sans-serif">21.4 м²</text>

              <rect x="180" y="20" width="120" height="180" stroke="#555454" strokeWidth="2" strokeDasharray="4 4" />
              <text x="200" y="100" fill="#555454" fontSize="14" fontFamily="sans-serif">{t('unitModal.bedroom')}</text>
              <text x="200" y="120" fill="#169600" fontSize="12" fontWeight="bold" fontFamily="sans-serif">14.2 м²</text>

              <rect x="20" y="200" width="140" height="100" stroke="#555454" strokeWidth="2" strokeDasharray="4 4" />
              <text x="40" y="250" fill="#555454" fontSize="14" fontFamily="sans-serif">{t('unitModal.kitchen')}</text>
              <text x="40" y="270" fill="#169600" fontSize="12" fontWeight="bold" fontFamily="sans-serif">11.8 м²</text>

              <rect x="160" y="200" width="140" height="100" stroke="#555454" strokeWidth="2" strokeDasharray="4 4" />
              <text x="180" y="250" fill="#555454" fontSize="14" fontFamily="sans-serif">{t('unitModal.bathroom')}</text>
              <text x="180" y="270" fill="#169600" fontSize="12" fontWeight="bold" fontFamily="sans-serif">5.6 м²</text>
            </svg>
          )}
        </div>

        {/* Right: Unit Specs & Booking Action (Figma 3314:203304) */}
        <div className="figma-unit-modal__info">
          <div>
            <span className="figma-dev-spec-label">{developmentName}</span>
            <h2 className="figma-unit-modal__title">{unit.title}</h2>
          </div>

          <div className="figma-unit-modal__specs">
            <div className="figma-dev-spec">
              <span className="figma-dev-spec-label">{t('unitModal.totalArea')}</span>
              <strong className="figma-dev-spec-value">{t('card.area', { area: unit.area })}</strong>
            </div>
            {unit.rooms ? (
              <div className="figma-dev-spec">
                <span className="figma-dev-spec-label">{t('reviewDedupe.roomsShort')}</span>
                <strong className="figma-dev-spec-value">{unit.rooms}</strong>
              </div>
            ) : null}
            {unit.floor ? (
              <div className="figma-dev-spec">
                <span className="figma-dev-spec-label">{t('editListing.floor')}</span>
                <strong className="figma-dev-spec-value">{unit.floor}</strong>
              </div>
            ) : null}
          </div>

          {unit.price && (
            <div>
              <span className="figma-dev-spec-label">{t('unitModal.priceLabel')}</span>
              <div className="figma-unit-modal__price">{unit.price}</div>
            </div>
          )}

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              className="figma-reveal-cta__btn figma-reveal-cta__btn--primary"
              onClick={onRequest}
            >
              {t('unitModal.bookPlan')}
            </button>
            <button
              type="button"
              className="figma-card-jk__btn figma-card-jk__btn--outline"
              onClick={onClose}
            >
              {t('unitModal.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
