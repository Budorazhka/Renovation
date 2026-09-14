import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { BazaSaleBrandLogo } from '@/components/public/visit/BazaSaleBrandLogo'
import { LanguageFlag } from '@/components/icons/FlagIcons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import type { Language } from '@/i18n'
import { cn } from '@/lib/utils'

const APP_LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'ka', label: 'ქართული' },
  { value: 'es', label: 'Español' },
  { value: 'tr', label: 'Türkçe' },
]

function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-10 w-[52px] shrink-0 items-center justify-center rounded-sm border border-[var(--green-border)] bg-[color-mix(in_srgb,var(--app-bg)_72%,transparent)] px-0 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--gold)_18%,transparent)]"
          aria-label={t('shell.language')}
          title={t('shell.language')}
        >
          <LanguageFlag lang={language} className="h-[18px] w-auto rounded-[2px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[188px] rounded-md border border-[var(--green-border)] bg-[var(--green-card)] p-1">
        {APP_LANGUAGE_OPTIONS.map((option) => {
          const active = language === option.value
          return (
            <DropdownMenuItem
              key={option.value}
              aria-label={option.label}
              onSelect={() => setLanguage(option.value)}
              className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-[16px] font-normal text-[color:var(--app-text)] focus:bg-[color-mix(in_srgb,var(--gold)_16%,transparent)]"
            >
              <LanguageFlag lang={option.value} className="h-[18px] w-auto shrink-0 rounded-[2px]" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {active ? <Check className="size-4 shrink-0 text-[color:var(--gold)]" strokeWidth={2} /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function LoginPage() {
  const { t } = useI18n()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await login(loginValue.trim(), password)
      if (result === 'ok') {
        navigate('/dashboard', { replace: true })
      } else if (result === 'blocked') {
        setError(t('auth.login.errorBlocked'))
      } else {
        setError(t('auth.login.errorInvalid'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] font-[Montserrat,sans-serif]">
      <div className="flex items-center justify-between px-6 py-5 sm:px-8">
        <span className="flex items-center gap-2">
          <BazaSaleBrandLogo showLabel={false} iconClassName="h-8 w-auto shrink-0 text-[color:var(--gold)]" />
          <span className="flex items-baseline gap-0.5">
            <span className="text-[22px] font-medium text-[color:var(--app-text)]">BAZA</span>
            <span className="text-[16px] font-normal text-[color:var(--app-text-muted)]">.sale</span>
          </span>
        </span>
        <LanguageSwitcher />
      </div>

      <div className="flex min-h-[calc(100vh-88px)] items-center justify-center px-6 py-10">
        <div className="w-full max-w-[420px] rounded-md bg-[var(--green-card)] p-8 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.14)]">
          <h1 className="text-[24px] font-medium text-[color:var(--app-text)]">{t('auth.login.title')}</h1>
          <p className="mt-1 text-[16px] font-normal text-[color:var(--app-text-muted)]">{t('auth.login.subtitle')}</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="login-login" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.login.loginLabel')}
              </label>
              <input
                id="login-login"
                type="text"
                value={loginValue}
                onChange={(e) => setLoginValue(e.target.value)}
                autoComplete="username"
                placeholder={t('auth.login.loginPlaceholder')}
                required
                disabled={submitting}
                className="w-full border-0 border-b border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2.5 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
                {t('auth.login.passwordLabel')}
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder={t('auth.login.passwordPlaceholder')}
                  required
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
            </div>

            {error ? <p className="text-[16px] font-normal text-[color:var(--error,#ffb4ab)]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'mt-1 inline-flex min-h-10 w-full items-center justify-center rounded-sm bg-[var(--gold)] px-4 py-2 text-[16px] font-medium text-[color:var(--gold-btn-text)] transition-colors hover:bg-[color:var(--gold-light)] disabled:opacity-50',
              )}
            >
              {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
            </button>
          </form>

          <p className="mt-6 text-[16px] font-normal text-[color:var(--app-text-muted)]">
            {t('auth.login.noAccount')}{' '}
            <Link to="/register" className="font-medium text-[color:var(--gold)] hover:text-[color:var(--gold-light)]">
              {t('auth.login.registerLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
