import { useState, useEffect, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { isAxiosError } from 'axios'
import { X } from 'lucide-react'
import { contactsApiV2, newIdempotencyKey } from '@/services/contactsApiV2'
import { CONTACT_ROLES_V2, type ContactRoleV2, type ContactV2 } from '@/types/contactsV2'
import { useI18n } from '@/i18n'

const PRIMARY = 'var(--gold)'
const SURFACE = 'var(--green-deep)'
const DIALOG_BG = 'var(--rail-bg)'

const ROLE_LABELS: Record<ContactRoleV2, string> = {
  buyer: 'Покупатель',
  investor: 'Инвестор',
  owner: 'Собственник',
  referral: 'Реферал',
  broker: 'Посредник',
}

const inputBase = {
  width: '100%' as const,
  height: 44,
  padding: '0 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: SURFACE,
  color: '#e8f2ec',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box' as const,
  fontFamily: 'inherit',
}

const labelStyle = { fontSize: 13, fontWeight: 400 as const, color: 'rgba(220,230,224,0.92)', marginBottom: 6 }

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (contact: ContactV2) => void
}

/**
 * «Добавить клиента» независимо от лида (N-20, POST /api/v1/contacts).
 * Раньше собирала фиктивную карточку локально: тип физ/юрлица, бюджет,
 * источник обращения и комментарий — ни одно из этих полей CRM не хранит.
 * Реальные поля контакта — имя, телефон, email, роли (buyer/investor/
 * owner/referral/broker), их и запрашивает форма.
 */
export function CreateClientModal({ open, onClose, onCreated }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<ContactRoleV2[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setPhone('')
    setEmail('')
    setRoles([])
    setSubmitting(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  if (!open || typeof document === 'undefined') return null

  function toggleRole(role: ContactRoleV2) {
    setRoles(prev => (prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    const trimmedPhone = phone.trim()
    if (!trimmedName) {
      setError('Укажите имя или название')
      return
    }
    if (!trimmedPhone) {
      setError('Укажите телефон')
      return
    }

    setSubmitting(true)
    try {
      const contact = await contactsApiV2.create(
        {
          name: trimmedName,
          phone: trimmedPhone,
          email: email.trim() || undefined,
          roles: roles.length > 0 ? roles : undefined,
        },
        newIdempotencyKey(),
      )
      onCreated(contact)
      onClose()
    } catch (cause) {
      if (isAxiosError(cause) && cause.response?.data?.error?.code === 'CONTACT_PHONE_TAKEN') {
        setError('Клиент с таким телефоном уже есть в базе')
      } else {
        setError('Не удалось создать клиента. Попробуйте ещё раз')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const modal = (
    <>
      <div
        role="presentation"
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10100,
          background: 'rgba(0,0,0,0.55)',
        }}
        onClick={submitting ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="create-client-title"
        style={{
          position: 'fixed',
          zIndex: 10101,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(460px, calc(100vw - 28px))',
          maxHeight: 'min(90vh, 640px)',
          overflowY: 'auto',
          padding: 22,
          background: DIALOG_BG,
          border: `2px solid ${PRIMARY}`,
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.05)',
          boxSizing: 'border-box',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <h2 id="create-client-title" style={{ margin: 0, fontSize: 18, fontWeight: 400, color: '#fff', lineHeight: 1.25 }}>
            {t('clients.createClientModal.новый_клиент')}</h2>
          <button
            type="button"
            aria-label={t('clients.createClientModal.закрыть')}
            onClick={onClose}
            disabled={submitting}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(0,0,0,0.35)',
              color: 'rgba(220,230,224,0.85)',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'rgba(194, 200, 196, 0.72)', lineHeight: 1.45 }}>
          Телефон — уникальный идентификатор клиента в базе агентства.
        </p>

        <form onSubmit={e => void handleSubmit(e)}>
          <label style={{ display: 'block', marginBottom: 14 }}>
            <span style={labelStyle}>
              {t('clients.createClientModal.имя')}<span style={{ color: '#fb923c' }}>*</span>
            </span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Иван Иванов"
              style={inputBase}
              autoComplete="name"
              disabled={submitting}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <span style={labelStyle}>
              {t('clients.createClientModal.телефон')}<span style={{ color: '#fb923c' }}>*</span>
            </span>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+7 …"
              style={inputBase}
              inputMode="tel"
              disabled={submitting}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 18 }}>
            <span style={labelStyle}>Email</span>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('clients.createClientModal.необязательно')}
              type="email"
              style={inputBase}
              disabled={submitting}
            />
          </label>

          <div style={{ marginBottom: 18 }}>
            <span style={{ ...labelStyle, display: 'block', marginBottom: 8 }}>Роль клиента</span>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
              {CONTACT_ROLES_V2.map(role => {
                const active = roles.includes(role)
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    disabled={submitting}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 999,
                      border: active ? `1px solid ${PRIMARY}` : '1px solid rgba(255,255,255,0.12)',
                      background: active ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : SURFACE,
                      color: active ? PRIMARY : 'rgba(220,230,224,0.85)',
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      cursor: submitting ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#fb923c', lineHeight: 1.4 }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                flex: 1,
                height: 48,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent',
                color: 'rgba(220,230,224,0.9)',
                fontSize: 14,
                fontWeight: 400,
                cursor: submitting ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('clients.createClientModal.отмена')}</button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 1,
                height: 48,
                borderRadius: 10,
                border: 'none',
                background: '#a07828',
                color: '#fff',
                fontSize: 14,
                fontWeight: 400,
                cursor: submitting ? 'default' : 'pointer',
                opacity: submitting ? 0.7 : 1,
                fontFamily: 'inherit',
                letterSpacing: '0.04em',
              }}
            >
              {submitting ? 'Создаём…' : t('clients.createClientModal.создать')}</button>
          </div>
        </form>
      </div>
    </>
  )

  return createPortal(modal, document.body)
}
