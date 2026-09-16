import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { toast } from 'sonner'
import { ArrowLeft, Mail, Phone, User } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { contactsApiV2 } from '@/services/contactsApiV2'
import { CONTACT_ROLES_V2, type ContactRoleV2, type ContactSegmentV2, type ContactV2 } from '@/types/contactsV2'
import { dealsApiV2 } from '@/services/dealsApiV2'
import type { DealV2 } from '@/types/dealsV2'
import { STAGE_LABELS, type DealStage } from '@/types/deals'
import { useI18n } from '@/i18n'

const C = {
  gold: 'var(--gold)',
  white: '#ffffff',
  whiteMid: 'rgba(255,255,255,0.7)',
  whiteLow: 'rgba(255,255,255,0.4)',
  border: 'var(--green-border)',
  card: 'var(--green-card)',
}

const SEGMENT_LABELS: Record<ContactSegmentV2, string> = {
  golden: 'Золотой фонд',
  active: 'Активный',
  archived: 'Архив',
  deferred: 'Отложенный спрос',
}

const ROLE_LABELS: Record<ContactRoleV2, string> = {
  buyer: 'Покупатель',
  investor: 'Инвестор',
  owner: 'Собственник',
  referral: 'Реферал',
  broker: 'Посредник',
}

/**
 * Карточка клиента (N-20, GET /api/v1/contacts/:contactId). До этого
 * прохода экрана не было вовсе — ссылка из списка клиентов вела на
 * несуществующий route. Правка полей и ролей — PATCH того же контакта;
 * сделки — реальный список GET /deals?contactId=.
 */
export function ClientCardPage() {
  const { t } = useI18n()
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()

  const [contact, setContact] = useState<ContactV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deals, setDeals] = useState<DealV2[]>([])
  const [dealsLoading, setDealsLoading] = useState(true)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<ContactRoleV2[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    contactsApiV2
      .getById(clientId)
      .then(c => {
        if (cancelled) return
        setContact(c)
        setName(c.name)
        setPhone(c.phone)
        setEmail(c.email ?? '')
        setRoles(c.roles)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        if (isAxiosError(cause) && cause.response?.status === 404) setNotFound(true)
        else toast.error('Не удалось загрузить клиента')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setDealsLoading(true)
    dealsApiV2
      .list({ contactId: clientId, limit: 50 })
      .then(res => {
        if (!cancelled) setDeals(res.items)
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось загрузить сделки клиента')
      })
      .finally(() => {
        if (!cancelled) setDealsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  function toggleRole(role: ContactRoleV2) {
    setRoles(prev => (prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]))
  }

  function startEdit() {
    if (!contact) return
    setName(contact.name)
    setPhone(contact.phone)
    setEmail(contact.email ?? '')
    setRoles(contact.roles)
    setSaveError(null)
    setEditing(true)
  }

  async function save() {
    if (!clientId) return
    const trimmedName = name.trim()
    const trimmedPhone = phone.trim()
    if (!trimmedName || !trimmedPhone) {
      setSaveError('Имя и телефон обязательны')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await contactsApiV2.update(clientId, {
        name: trimmedName,
        phone: trimmedPhone,
        email: email.trim() ? email.trim() : null,
        roles,
      })
      setContact(updated)
      setEditing(false)
      toast.success('Клиент обновлён')
    } catch (cause) {
      if (isAxiosError(cause) && cause.response?.data?.error?.code === 'CONTACT_PHONE_TAKEN') {
        setSaveError('Клиент с таким телефоном уже есть в базе')
      } else {
        setSaveError('Не удалось сохранить изменения')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DashboardShell>
        <div style={{ padding: 40, color: C.whiteLow }}>Загружаем клиента…</div>
      </DashboardShell>
    )
  }

  if (notFound || !contact) {
    return (
      <DashboardShell>
        <div style={{ padding: 40, color: C.whiteLow }}>{t('clients.clientsListPage.клиенты_не_найдены')}</div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell>
      <div style={{ padding: '24px 28px 40px', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        <button
          type="button"
          onClick={() => navigate('/dashboard/clients')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 16,
            background: 'none',
            border: 'none',
            color: C.whiteMid,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          <ArrowLeft size={16} /> К списку клиентов
        </button>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }}>
          {!editing ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      background: C.gold,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <User size={22} color="var(--gold-btn-text)" />
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 400, color: C.white }}>{contact.name}</div>
                    <div style={{ fontSize: 12, color: C.whiteLow, marginTop: 2 }}>
                      В базе с {new Date(contact.createdAt).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={startEdit} className="alphabase-section-primary">
                  Изменить
                </button>
              </div>

              <div style={{ display: 'flex', gap: 24, marginTop: 18, flexWrap: 'wrap' as const }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: C.whiteMid }}>
                  <Phone size={16} color={C.gold} /> {contact.phone}
                </div>
                {contact.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: C.whiteMid }}>
                    <Mail size={16} color={C.gold} /> {contact.email}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    background: 'rgba(230, 195, 100, 0.12)',
                    border: '1px solid rgba(230, 195, 100, 0.25)',
                    color: 'var(--gold-light)',
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  {SEGMENT_LABELS[contact.segment]}
                </span>
                {contact.roles.map(role => (
                  <span
                    key={role}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: 'var(--green-card-hover)',
                      fontSize: 12,
                      color: C.whiteMid,
                    }}
                  >
                    {ROLE_LABELS[role]}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: C.whiteMid, display: 'block', marginBottom: 4 }}>Имя</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={saving}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'var(--green-deep)',
                    color: C.white,
                    fontSize: 14,
                    boxSizing: 'border-box' as const,
                    fontFamily: 'inherit',
                  }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: C.whiteMid, display: 'block', marginBottom: 4 }}>Телефон</span>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  disabled={saving}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'var(--green-deep)',
                    color: C.white,
                    fontSize: 14,
                    boxSizing: 'border-box' as const,
                    fontFamily: 'inherit',
                  }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: C.whiteMid, display: 'block', marginBottom: 4 }}>Email</span>
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={saving}
                  type="email"
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'var(--green-deep)',
                    color: C.white,
                    fontSize: 14,
                    boxSizing: 'border-box' as const,
                    fontFamily: 'inherit',
                  }}
                />
              </label>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: C.whiteMid, display: 'block', marginBottom: 6 }}>Роль клиента</span>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
                  {CONTACT_ROLES_V2.map(role => {
                    const active = roles.includes(role)
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleRole(role)}
                        disabled={saving}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 999,
                          border: active ? `1px solid ${C.gold}` : `1px solid ${C.border}`,
                          background: active ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : 'var(--green-deep)',
                          color: active ? C.gold : C.whiteMid,
                          fontSize: 12,
                          cursor: saving ? 'default' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {ROLE_LABELS[role]}
                      </button>
                    )
                  })}
                </div>
              </div>
              {saveError && <p style={{ color: '#fb923c', fontSize: 13, marginBottom: 12 }}>{saveError}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'transparent',
                    color: C.whiteMid,
                    fontSize: 13,
                    cursor: saving ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="alphabase-section-primary"
                >
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 500, color: C.white }}>
            Сделки{deals.length > 0 ? ` (${deals.length})` : ''}
          </h2>
          {dealsLoading ? (
            <p style={{ color: C.whiteLow, fontSize: 13 }}>Загружаем сделки…</p>
          ) : deals.length === 0 ? (
            <p style={{ color: C.whiteLow, fontSize: 13 }}>У клиента пока нет сделок.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {deals.map(deal => (
                <button
                  key={deal.id}
                  type="button"
                  onClick={() => navigate(`/dashboard/deals/${deal.id}`)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'var(--green-deep)',
                    color: C.white,
                    cursor: 'pointer',
                    textAlign: 'left' as const,
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{deal.title}</span>
                  <span style={{ fontSize: 12, color: C.gold }}>{STAGE_LABELS[deal.stage as DealStage]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
