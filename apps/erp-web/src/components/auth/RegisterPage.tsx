import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { BazaSaleBrandLogo } from '@/components/public/visit/BazaSaleBrandLogo'
import type { OrganizationType } from '@/services/organizationsAuthApi'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const ORGANIZATION_TYPES: OrganizationType[] = ['agency', 'independent_realtor', 'developer']

export function RegisterPage() {
  const { t } = useI18n()
  const { registerOrganization } = useAuth()
  const navigate = useNavigate()

  const [type, setType] = useState<OrganizationType>('agency')
  const [ownerName, setOwnerName] = useState('')
  const [name, setName] = useState('')
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeLabel: Record<OrganizationType, string> = {
    agency: t('auth.register.typeAgency'),
    independent_realtor: t('auth.register.typeRealtor'),
    developer: t('auth.register.typeDeveloper'),
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)

    if (password.length < 8) {
      setError(t('auth.register.errorPasswordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('auth.register.errorPasswordMismatch'))
      return
    }

    setSubmitting(true)
    try {
      const result = await registerOrganization({
        login: loginValue.trim(),
        password,
        type,
        name: name.trim(),
        ownerName: ownerName.trim(),
      })
      if (result === 'ok') {
        navigate('/dashboard', { replace: true })
      } else if (result === 'login_taken') {
        setError(t('auth.register.errorLoginTaken'))
      } else {
        setError(t('auth.register.errorGeneric'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] font-[Montserrat,sans-serif]">
      <div className="px-6 py-5 sm:px-8">
        <span className="flex items-center gap-2">
          <BazaSaleBrandLogo showLabel={false} iconClassName="h-8 w-auto shrink-0 text-[color:var(--gold)]" />
          <span className="flex items-baseline gap-0.5">
            <span className="text-[22px] font-medium text-[color:var(--app-text)]">BAZA</span>
            <span className="text-[16px] font-normal text-[color:var(--app-text-muted)]">.sale</span>
          </span>
        </span>
      </div>

      <div className="flex min-h-[calc(100vh-88px)] items-center justify-center px-6 py-10">
        <div className="w-full max-w-[460px] rounded-md bg-[var(--green-card)] p-8 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.14)]">
          <h1 className="text-[24px] font-medium text-[color:var(--app-text)]">{t('auth.register.title')}</h1>
          <p className="mt-1 text-[16px] font-normal text-[color:var(--app-text-muted)]">{t('auth.register.subtitle')}</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.register.typeLabel')}
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('auth.register.typeLabel')}>
                {ORGANIZATION_TYPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={type === option}
                    onClick={() => setType(option)}
                    className={cn(
                      'rounded-sm border px-3.5 py-1.5 text-[16px] font-normal transition-colors',
                      type === option
                        ? 'border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] text-[color:var(--app-text)]'
                        : 'border-[var(--green-border)] bg-transparent text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)]',
                    )}
                  >
                    {typeLabel[option]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="reg-owner-name" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.register.ownerNameLabel')}
              </label>
              <input
                id="reg-owner-name"
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                autoComplete="name"
                placeholder={t('auth.register.ownerNamePlaceholder')}
                required
                minLength={1}
                maxLength={200}
                disabled={submitting}
                className="w-full border-0 border-b border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2.5 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
              />
            </div>

            <div>
              <label htmlFor="reg-name" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.register.orgNameLabel')}
              </label>
              <input
                id="reg-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth.register.orgNamePlaceholder')}
                required
                minLength={1}
                maxLength={200}
                disabled={submitting}
                className="w-full border-0 border-b border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2.5 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
              />
            </div>

            <div>
              <label htmlFor="reg-login" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.register.loginLabel')}
              </label>
              <input
                id="reg-login"
                type="text"
                value={loginValue}
                onChange={(e) => setLoginValue(e.target.value)}
                autoComplete="username"
                placeholder={t('auth.register.loginPlaceholder')}
                required
                minLength={1}
                disabled={submitting}
                className="w-full border-0 border-b border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2.5 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
              />
            </div>

            <div>
              <label htmlFor="reg-password" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.register.passwordLabel')}
              </label>
              <div className="relative">
                <input
                  id="reg-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={t('auth.register.passwordPlaceholder')}
                  required
                  minLength={8}
                  disabled={submitting}
                  className="w-full border-0 border-b border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2.5 pr-10 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)]"
                >
                  {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <span className="mt-1 block text-[16px] font-normal text-[color:var(--app-text-muted)]">{t('auth.register.passwordHint')}</span>
            </div>

            <div>
              <label htmlFor="reg-password-confirm" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.register.confirmPasswordLabel')}
              </label>
              <input
                id="reg-password-confirm"
                type={showPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={t('auth.register.confirmPasswordPlaceholder')}
                required
                minLength={8}
                disabled={submitting}
                className="w-full border-0 border-b border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2.5 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
              />
            </div>

            {error ? <p className="text-[16px] font-normal text-[color:var(--error,#ffb4ab)]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 inline-flex min-h-10 w-full items-center justify-center rounded-sm bg-[var(--gold)] px-4 py-2 text-[16px] font-medium text-[color:var(--gold-btn-text)] transition-colors hover:bg-[color:var(--gold-light)] disabled:opacity-50"
            >
              {submitting ? t('auth.register.submitting') : t('auth.register.submit')}
            </button>
          </form>

          <p className="mt-6 text-[16px] font-normal text-[color:var(--app-text-muted)]">
            {t('auth.register.hasAccount')}{' '}
            <Link to="/login" className="font-medium text-[color:var(--gold)] hover:text-[color:var(--gold-light)]">
              {t('auth.register.loginLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
