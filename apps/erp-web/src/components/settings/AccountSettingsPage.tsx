import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'
import { Bell, Camera, Check, Crown, KeyRound, X, Sparkles, User, Phone, MapPin, FileText, Link2, Shield } from 'lucide-react'
import { NotificationSettingsPanel } from '@/components/settings/NotificationSettingsPanel'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useAuth } from '@/context/AuthContext'
import { ROLE_LABEL } from '@/lib/permissions'
import { teamApi } from '@/services/teamApi'
import { developersApi } from '@/services/developersApi'
import type { UserRole } from '@/types/auth'
import { useI18n } from '@/i18n'

function splitSkills(value: string): string[] {
  return value.split(',').map((x) => x.trim()).filter(Boolean)
}

/** API застройщиков требует полный URL (`new URL()` на бэке) — дописываем схему к «example.com». */
function toWebsiteUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const GOLD = 'var(--gold)'

const cardStyle: CSSProperties = {
  position: 'relative',
  borderRadius: 6,
  padding: '18px 20px 20px',
  background: 'radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--gold) 7%, transparent) 0%, transparent 42%), var(--green-card)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--gold) 14%, transparent)',
}
const labelStyle: CSSProperties = { display: 'block', fontSize: 16, color: 'var(--app-text-muted)', marginBottom: 6 }
const inputStyle: CSSProperties = {
  height: 42, width: '100%', borderRadius: 4,
  border: '1px solid color-mix(in srgb, var(--gold) 14%, transparent)',
  background: 'color-mix(in srgb, #000 22%, var(--green-deep))',
  color: 'var(--app-text)', fontSize: 16, padding: '0 13px', outline: 'none',
}

function SectionCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 6, flexShrink: 0,
          background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: GOLD,
        }}>
          {icon}
        </span>
        <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: GOLD }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text', readOnly = false,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  type?: string
  readOnly?: boolean
}) {
  const { language } = useI18n()
  const [isFocused, setIsFocused] = useState(false)

  const resolvedType = type === 'date' && !isFocused && !value ? 'text' : type
  const resolvedPlaceholder = type === 'date'
    ? (language === 'en' ? 'dd.mm.yyyy' : 'дд.мм.гггг')
    : placeholder

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={resolvedType}
        lang={language}
        readOnly={readOnly}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={resolvedPlaceholder}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{ ...inputStyle, ...(readOnly ? { opacity: 0.6, cursor: 'default' } : {}), ...(type === 'date' ? { colorScheme: 'dark' } : {}) }}
      />
    </div>
  )
}

export function AccountSettingsPage() {
    const { t } = useI18n();
  const { currentUser, updateProfile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const role = currentUser?.role as UserRole | undefined
  const roleLabel = role ? ROLE_LABEL[role] : '—'

  const [avatar, setAvatar] = useState(currentUser?.avatarUrl ?? '')
  const avatarFileRef = useRef<File | null>(null)
  const [name, setName] = useState(currentUser?.name ?? '')
  const [companyName, setCompanyName] = useState(currentUser?.companyName ?? '')
  const [position, setPosition] = useState(currentUser?.position ?? '')
  const [phone, setPhone] = useState(currentUser?.phone ?? '')
  const [email, setEmail] = useState(currentUser?.login ?? '')
  const [telegram, setTelegram] = useState(currentUser?.telegram ?? '')
  const [whatsapp, setWhatsapp] = useState(currentUser?.whatsapp ?? '')
  const [city, setCity] = useState(currentUser?.city ?? '')
  const [birthDate, setBirthDate] = useState(currentUser?.birthDate ?? '')
  const [department, setDepartment] = useState(currentUser?.department ?? '')
  const [aboutMe, setAboutMe] = useState(currentUser?.aboutMe ?? '')
  const [aboutCompany, setAboutCompany] = useState(currentUser?.aboutCompany ?? '')
  const [skills, setSkills] = useState((currentUser?.skills ?? []).join(', '))
  const [vk, setVk] = useState(currentUser?.vk ?? '')
  const [instagram, setInstagram] = useState(currentUser?.instagram ?? '')
  const [website, setWebsite] = useState(currentUser?.website ?? '')

  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)

  /** `_id` записи застройщика текущего пользователя (реальный API `/api/developers`). */
  const developerIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!currentUser?.id || currentUser.login === 'demo') return
    if (!localStorage.getItem('jwt_token')) return

    let cancelled = false
    void teamApi.getById(currentUser.id).then((user) => {
      if (cancelled) return
      setName(user.name ?? '')
      setPosition(user.position ?? '')
      setPhone(user.phone ?? '')
      setEmail(user.loginEmail || user.email || currentUser.login)
      setTelegram(user.telegram ?? '')
      setWhatsapp(user.whatsapp ?? '')
      setCity(user.city ?? '')
      setBirthDate(user.birthDate ?? '')
      setDepartment(user.department ?? '')
      setAboutMe(user.aboutMe ?? '')
      setAboutCompany(user.aboutCompany ?? '')
      setSkills((user.skills ?? []).join(', '))
      setVk(user.vk ?? '')
      setInstagram(user.instagram ?? '')
      setWebsite(user.website ?? '')
      if (user.avatarUrl) setAvatar(user.avatarUrl)
    }).catch(() => {
      // Оставляем данные из currentUser / localStorage
    })

    // Запись застройщика — реальные данные из /api/developers (create-or-return).
    // Для ролей ≠ developer без записи вернётся null — поля компании остаются локальными.
    void developersApi.ensureSelf().then((profile) => {
      if (cancelled || !profile) return
      developerIdRef.current = profile._id
      if (profile.title) setCompanyName(profile.title)
      if (profile.contactPhone) setPhone((prev) => prev || profile.contactPhone || '')
      if (profile.contactTelegram) setTelegram((prev) => prev || profile.contactTelegram || '')
      if (profile.contactWhatsapp) setWhatsapp((prev) => prev || profile.contactWhatsapp || '')
      if (profile.website) setWebsite((prev) => prev || profile.website || '')
      if (profile.description) setAboutMe((prev) => prev || profile.description || '')
      if (profile.image) setAvatar((prev) => prev || profile.image || '')
    }).catch(() => {
      // API застройщиков недоступен — работаем с локальными данными
    })

    return () => {
      cancelled = true
    }
  }, [currentUser?.id, currentUser?.login])

  const initials = (name || currentUser?.name || 'U').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  function onPickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    avatarFileRef.current = f
    setAvatar(URL.createObjectURL(f))
  }

  async function handleSave() {
    if (!currentUser) return
    setSaving(true)
    setSaveError(null)

    const skillsList = splitSkills(skills)
    let avatarUrl = avatar.startsWith('blob:') ? currentUser.avatarUrl : avatar.trim() || undefined

    try {
      if (avatarFileRef.current) {
        // Для застройщика фото уходит на реальный CDN (purpose=developer_logo) и
        // сохраняется в поле image записи /api/developers; иначе — канал team-users.
        avatarUrl = developerIdRef.current
          ? await developersApi.uploadLogo(avatarFileRef.current)
          : await teamApi.uploadAvatar(avatarFileRef.current)
        avatarFileRef.current = null
        setAvatar(avatarUrl)
      }

      const profilePatch = {
        name: name.trim() || currentUser.name,
        companyName: companyName.trim() || currentUser.companyName,
        login: email.trim() || currentUser.login,
        avatarUrl,
        position: position.trim() || undefined,
        phone: phone.trim() || undefined,
        telegram: telegram.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        aboutMe: aboutMe.trim() || undefined,
        aboutCompany: aboutCompany.trim() || undefined,
        skills: skillsList,
        city: city.trim() || undefined,
        birthDate: birthDate || undefined,
        department: department.trim() || undefined,
        vk: vk.trim() || undefined,
        instagram: instagram.trim() || undefined,
        website: website.trim() || undefined,
      }

      updateProfile(profilePatch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)

      if (currentUser.login !== 'demo' && localStorage.getItem('jwt_token')) {
        teamApi.update(currentUser.id, {
          name: profilePatch.name,
          email: email.trim() || undefined,
          avatarUrl: profilePatch.avatarUrl,
          position: profilePatch.position,
          phone: profilePatch.phone,
          telegram: profilePatch.telegram,
          whatsapp: profilePatch.whatsapp,
          aboutMe: profilePatch.aboutMe,
          aboutCompany: profilePatch.aboutCompany,
          skills: skillsList,
          city: profilePatch.city,
          birthDate: profilePatch.birthDate,
          department: profilePatch.department,
          vk: profilePatch.vk,
          instagram: profilePatch.instagram,
          website: profilePatch.website,
        }).catch((err: unknown) => {
          const message =
            (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data
              ?.message ||
            (err as { message?: string })?.message ||
            'Не удалось синхронизировать с сервером'
          setSaveError(message)
        })

        // Реальная запись застройщика: название компании, контакты, сайт,
        // описание и логотип персистятся через PATCH /api/developers/:id.
        if (developerIdRef.current) {
          developersApi.update(developerIdRef.current, {
            ...(companyName.trim() ? { title: companyName.trim() } : {}),
            contactPhone: phone.trim(),
            contactTelegram: telegram.trim(),
            contactWhatsapp: whatsapp.trim(),
            website: toWebsiteUrl(website),
            description: aboutMe.trim(),
            ...(avatarUrl && !avatarUrl.startsWith('data:') ? { image: avatarUrl } : {}),
          }).catch((err: unknown) => {
            const message =
              (err as { message?: string })?.message ||
              'Не удалось сохранить профиль застройщика'
            setSaveError(message)
          })
        }
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data
          ?.message ||
        (err as { message?: string })?.message ||
        'Не удалось сохранить профиль'
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }

  const gap3: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }
  const gap2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }

  return (
    <DashboardShell>
      <div style={{ padding: '24px 32px 56px', width: '100%', maxWidth: 1320, margin: '0 auto' }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 24, fontWeight: 400, color: 'var(--app-text)' }}>{t('settings.accountSettingsPage.личный_кабинет')}</div>
          <div style={{ fontSize: 16, color: 'var(--app-text-muted)', marginTop: 4 }}>{t('settings.accountSettingsPage.профиль_контакты_и_и')}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, alignItems: 'start' }}>
          {/* Профиль-хедер */}
          <div style={{ ...cardStyle, gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 92, height: 92, borderRadius: '50%', overflow: 'hidden',
                boxShadow: '0 0 0 2px color-mix(in srgb, var(--gold) 55%, transparent), 0 0 0 6px color-mix(in srgb, var(--gold) 14%, transparent)',
                background: 'var(--green-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: GOLD, fontSize: 32, fontWeight: 500,
              }}>
                {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
              </div>
              {currentUser?.mlsCircleVerified && (
                <span
                  aria-label={t('settings.accountSettingsPage.вы_член_mls')}
                  title={t('settings.accountSettingsPage.вы_член_mls')}
                  style={{
                    position: 'absolute',
                    right: -4,
                    top: -4,
                    width: 42,
                    height: 22,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    borderRadius: 4,
                    background: GOLD,
                    color: '#1c140a',
                    fontSize: 16,
                    fontWeight: 500,
                    lineHeight: 1,
                    letterSpacing: 0,
                    boxShadow: '0 0 0 2px var(--green-card), inset 0 0 0 1px color-mix(in srgb, #000 18%, transparent)',
                  }}
                >
                  <Crown size={12} strokeWidth={2} aria-hidden />
                  MLS
                </span>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label={t('settings.accountSettingsPage.загрузить_фото')}
                style={{
                  position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: '50%',
                  border: '1px solid color-mix(in srgb, var(--gold) 50%, transparent)', background: 'var(--green-card)',
                  color: GOLD, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Camera size={15} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickAvatar} style={{ display: 'none' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--app-text)', lineHeight: 1.2 }}>{name || currentUser?.name}</div>
              <div style={{ fontSize: 16, color: 'var(--app-text-muted)', marginTop: 4 }}>{companyName || currentUser?.companyName}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <span style={{
                  display: 'inline-block', fontSize: 16, color: GOLD,
                  background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
                  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--gold) 35%, transparent)',
                  borderRadius: 4, padding: '3px 13px',
                }}>
                  {roleLabel}
                </span>
                <span style={
                  currentUser?.mlsCircleVerified
                    ? {
                      display: 'inline-block', fontSize: 16, color: GOLD,
                      background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
                      boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--gold) 35%, transparent)',
                      borderRadius: 4, padding: '3px 13px',
                    }
                    : {
                      display: 'inline-block', fontSize: 16, color: 'var(--app-text-muted)',
                      background: 'var(--nav-item-bg-active)',
                      boxShadow: 'inset 0 0 0 1px var(--hub-card-border)',
                      borderRadius: 4, padding: '3px 13px',
                    }
                }>
                  {currentUser?.mlsCircleVerified ? 'MLS: верифицирован' : 'MLS: не подключён'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              {saveError ? (
                <span style={{ fontSize: 16, color: '#f87171', maxWidth: 280, textAlign: 'right' }}>{saveError}</span>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  height: 44, paddingInline: 22, borderRadius: 4, border: 'none',
                  background: GOLD, color: '#1c140a', fontSize: 16, fontWeight: 500,
                  cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
                }}
              >
                {saved ? <><Check size={16} /> {t('settings.accountSettingsPage.сохранено')}</> : saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>

          {/* Основное */}
          <SectionCard icon={<User size={17} />} title={t('settings.accountSettingsPage.основное')}>
            <div style={gap2}>
              <Field label={t('settings.accountSettingsPage.имя')} value={name} onChange={setName} placeholder={t('settings.accountSettingsPage.ваше_имя')} />
              <Field label={t('settings.accountSettingsPage.должность')} value={position} onChange={setPosition} placeholder={t('settings.accountSettingsPage.менеджер_по_продажам')} />
              <Field label={t('settings.accountSettingsPage.компания')} value={companyName} onChange={setCompanyName} placeholder={t('settings.accountSettingsPage.название_компании')} />
            </div>
          </SectionCard>

          {/* Контакты */}
          <SectionCard icon={<Phone size={17} />} title={t('settings.accountSettingsPage.контакты')}>
            <div style={gap2}>
              <Field label={t('settings.accountSettingsPage.телефон')} value={phone} onChange={setPhone} type="tel" placeholder="+998 90 ..." />
              <Field label="E-mail" value={email} onChange={setEmail} type="email" placeholder="email@company.ru" />
              <Field label="Telegram" value={telegram} onChange={setTelegram} placeholder="@username" />
              <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} placeholder="+998 90 ..." />
            </div>
          </SectionCard>

          {/* Личное */}
          <SectionCard icon={<MapPin size={17} />} title={t('settings.accountSettingsPage.личное')}>
            <div style={gap3}>
              <Field label={t('settings.accountSettingsPage.город_офис')} value={city} onChange={setCity} placeholder={t('settings.accountSettingsPage.самарканд')} />
              <Field label={t('settings.accountSettingsPage.дата_рождения')} value={birthDate} onChange={setBirthDate} type="date" />
              <Field label={t('settings.accountSettingsPage.подразделение')} value={department} onChange={setDepartment} placeholder={t('settings.accountSettingsPage.продажи')} />
            </div>
          </SectionCard>

          {/* О себе */}
          <SectionCard icon={<FileText size={17} />} title={t('settings.accountSettingsPage.о_себе')}>
            <label style={labelStyle}>{t('settings.accountSettingsPage.описание')}</label>
            <textarea
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              placeholder={t('settings.accountSettingsPage.коротко_о_себе')}
              style={{ ...inputStyle, height: 96, padding: '11px 13px', resize: 'vertical', marginBottom: 14 }}
            />
            <label style={labelStyle}>{t('settings.accountSettingsPage.о_компании')}</label>
            <textarea
              value={aboutCompany}
              onChange={(e) => setAboutCompany(e.target.value)}
              placeholder={t('settings.accountSettingsPage.коротко_о_застройщик')}
              style={{ ...inputStyle, height: 96, padding: '11px 13px', resize: 'vertical', marginBottom: 14 }}
            />
            <Field label={t('settings.accountSettingsPage.навыки_через_запятую')} value={skills} onChange={setSkills} placeholder={t('settings.accountSettingsPage.переговоры_crm_новос')} />
            {skills.trim() && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {skills.split(',').map((x) => x.trim()).filter(Boolean).map((sk) => (
                  <span key={sk} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 16, color: 'var(--app-text)',
                    background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
                    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--gold) 28%, transparent)', borderRadius: 4, padding: '5px 11px',
                  }}>
                    <Sparkles size={13} style={{ color: GOLD, opacity: 0.85 }} /> {sk}
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Соцсети */}
          <SectionCard icon={<Link2 size={17} />} title={t('settings.accountSettingsPage.соцсети_и_ссылки')}>
            <div style={gap3}>
              <Field label="Facebook" value={vk} onChange={setVk} placeholder="facebook.com/..." />
              <Field label="Instagram" value={instagram} onChange={setInstagram} placeholder="@..." />
              <Field label={t('settings.accountSettingsPage.сайт')} value={website} onChange={setWebsite} placeholder="example.com" />
            </div>
          </SectionCard>

          {/* Безопасность */}
          <SectionCard icon={<Shield size={17} />} title={t('settings.accountSettingsPage.безопасность')}>
            <button
              type="button"
              onClick={() => setPwdOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, paddingInline: 16, borderRadius: 4,
                border: '1px solid color-mix(in srgb, var(--gold) 22%, transparent)', background: 'transparent', color: 'var(--app-text)', fontSize: 16, cursor: 'pointer',
              }}
            >
              <KeyRound size={16} style={{ color: GOLD }} /> {t('settings.accountSettingsPage.изменить_пароль')}</button>
          </SectionCard>

          {/* Уведомления */}
          <SectionCard icon={<Bell size={17} />} title={t('notifications.title')}>
            <NotificationSettingsPanel />
          </SectionCard>
        </div>
      </div>

      {pwdOpen && <PasswordModal onClose={() => setPwdOpen(false)} />}
    </DashboardShell>
  )
}

function PasswordModal({ onClose }: { onClose: () => void }) {
    const { t } = useI18n();
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confPwd, setConfPwd] = useState('')
  const valid = oldPwd !== '' && newPwd !== '' && newPwd === confPwd

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 94vw)', background: 'var(--green-card)', borderRadius: 6, boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18), 0 12px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--green-deep)' }}>
          <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--app-text)' }}>{t('settings.accountSettingsPage.изменить_пароль')}</span>
          <button type="button" onClick={onClose} aria-label={t('settings.accountSettingsPage.закрыть')} style={{ padding: 6, background: 'none', border: 'none', color: 'var(--app-text-muted)', cursor: 'pointer', borderRadius: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 14, padding: '18px 20px' }}>
          <Field label={t('settings.accountSettingsPage.текущий_пароль')} value={oldPwd} onChange={setOldPwd} type="password" placeholder="••••••••" />
          <Field label={t('settings.accountSettingsPage.новый_пароль')} value={newPwd} onChange={setNewPwd} type="password" placeholder="••••••••" />
          <Field label={t('settings.accountSettingsPage.подтверждение')} value={confPwd} onChange={setConfPwd} type="password" placeholder="••••••••" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', background: 'var(--green-deep)' }}>
          <button type="button" onClick={onClose} style={{ height: 42, paddingInline: 18, borderRadius: 4, border: '1px solid var(--green-border)', background: 'transparent', color: 'var(--app-text-muted)', fontSize: 16, cursor: 'pointer' }}>
            {t('settings.accountSettingsPage.отмена')}</button>
          <button
            type="button"
            onClick={onClose}
            disabled={!valid}
            style={{
              height: 42, paddingInline: 20, borderRadius: 4, border: 'none',
              background: valid ? GOLD : 'color-mix(in srgb, var(--gold) 12%, transparent)', color: valid ? '#1c140a' : 'var(--app-text-muted)',
              fontSize: 16, fontWeight: 500, cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : 0.6,
            }}
          >
            {t('settings.accountSettingsPage.сохранить')}</button>
        </div>
      </div>
    </div>
  )
}
