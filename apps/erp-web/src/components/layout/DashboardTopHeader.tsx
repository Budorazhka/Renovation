import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, Check, Sparkles } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { WorkspaceAddButton } from '@/components/dashboard/WorkspaceAddButton'
import { LanguageFlag } from '@/components/icons/FlagIcons'
import { DashboardBackButton } from '@/components/layout/DashboardBackButton'
import { isDashboardPathAllowedForRole } from '@/config/dashboard-rail'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DASHBOARD_NOTIFICATIONS_PREVIEW } from '@/data/home-workspace-mock'
import { useTheme } from '@/hooks/useTheme'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useWorkspaceDeskScreen } from '@/context/WorkspaceDeskScreenContext'
import type { Language } from '@/i18n'

/** Прямая ссылка на витрину (п. 5 ТЗ). */
const MARKETPLACE_HREF = 'https://baza.sale'

type AppLanguageOption = {
  value: Language
  label: string
  status?: string
  disabled?: boolean
}

const APP_LANGUAGE_OPTIONS: AppLanguageOption[] = [
  { value: 'en', label: 'English' },
  { value: 'ka', label: 'ქართული' },
  { value: 'es', label: 'Español' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ru', label: 'Русский' },
]

/** Сквозной верхний бар: AI, Marketplace, уведомления, быстрые действия. */
export function DashboardTopHeader() {
  const [aiOpen, setAiOpen] = useState(false)
  const location = useLocation()
  const { activeScreen, setActiveScreen } = useWorkspaceDeskScreen()
  const { currentUser } = useAuth()
  const { isLightTheme: isLight } = useTheme()
  const { language, setLanguage, t } = useI18n()
  const role = currentUser?.role ?? 'manager'
  const canInfo = isDashboardPathAllowedForRole('/dashboard/settings/info', role)

  const isDeskHome =
    location.pathname === '/dashboard' || location.pathname === '/dashboard/'

  const isDevManagement = location.pathname.startsWith('/dashboard/development/management')

  const btn = cn(
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-normal transition-colors',
    isLight
      ? 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
      : 'text-emerald-100/85 hover:bg-emerald-900/35 hover:text-emerald-50',
  )

  const iconBtn = cn(btn, 'min-w-10 px-0 sm:px-3')

  /** Та же поверхность, что у выпадающих панелей хедера — единый приподнятый слой. */
  const headerPopoverSurface = cn(
    isLight
      ? 'border-slate-200/90 bg-white text-slate-800 shadow-lg'
      : 'border-[color:var(--dropdown-border)] bg-[var(--dropdown-bg)] text-[color:var(--dropdown-text)] shadow-[var(--dropdown-shadow)]',
  )

  const notifPanelClass = cn(
    'w-[min(100vw-2rem,22rem)] max-h-[min(72vh,26rem)] overflow-hidden rounded-lg border p-0',
    headerPopoverSurface,
  )

  const notifMuted = isLight ? 'text-slate-500' : 'text-[color:var(--dropdown-text-muted)]'

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex min-h-[52px] shrink-0 items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4',
        isLight
          ? 'bg-white/92 backdrop-blur-md'
          : 'bg-[color-mix(in_srgb,var(--app-bg)_92%,transparent)] backdrop-blur-md',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <DashboardBackButton />
      </div>

      {isDeskHome ? (
        <div
          className="flex shrink-0 items-center gap-1 sm:gap-1.5"
          role="tablist"
          aria-label={t('shell.workspaceScreen')}
        >
          <span
            className={cn(
              'hidden text-[11px] font-normal uppercase tracking-wide lg:inline',
              isLight ? 'text-slate-500' : 'text-emerald-100/55',
            )}
          >
            {t('shell.screen')}
          </span>
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={activeScreen === n}
              onClick={() => setActiveScreen(n)}
              className={cn(
                'flex size-9 min-h-9 min-w-9 items-center justify-center rounded-lg border text-[14px] font-normal transition-colors sm:size-10 sm:min-h-10 sm:min-w-10',
                activeScreen === n
                  ? isLight
                    ? 'border-amber-400/55 bg-amber-100/70 text-slate-900'
                    : 'border-[color:color-mix(in_srgb,var(--gold)_60%,transparent)] bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-emerald-50'
                  : isLight
                    ? 'border-slate-200/90 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    : 'border-emerald-800/45 text-emerald-100/65 hover:bg-emerald-900/35 hover:text-emerald-50',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      ) : isDevManagement ? (
        <div
          className="flex shrink-0 items-center gap-1 sm:gap-1.5 overflow-x-auto"
          role="tablist"
          aria-label={t('shell.salesManagement')}
        >
          {[
            { id: 'bookings', label: t('tabs.bookings'), path: '/dashboard/development/management/bookings' },
            { id: 'registrations', label: t('tabs.registrations'), path: '/dashboard/development/management/registrations' },
            { id: 'broadcasts', label: t('tabs.broadcasts'), path: '/dashboard/development/management/broadcasts' },
          ].map((tab) => {
            const isActive = location.pathname === tab.path || location.pathname === tab.path + '/'
            return (
              <Link
                key={tab.id}
                to={tab.path}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  'flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border px-3 text-[14px] font-normal transition-colors sm:min-h-10 sm:px-4',
                  isActive
                    ? isLight
                      ? 'border-amber-400/55 bg-amber-100/70 text-slate-900'
                      : 'border-[color:color-mix(in_srgb,var(--gold)_60%,transparent)] bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-emerald-50'
                    : isLight
                      ? 'border-slate-200/90 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                      : 'border-emerald-800/45 text-emerald-100/65 hover:bg-emerald-900/35 hover:text-emerald-50',
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      ) : null}

      <nav
        className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2"
        aria-label={t('shell.controlPanel')}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex min-h-10 w-[52px] shrink-0 items-center justify-center rounded-md border px-0 py-2 transition-colors',
                isLight
                  ? 'border-slate-200/90 bg-white/70 hover:bg-amber-100/70'
                  : 'border-emerald-800/45 bg-[color-mix(in_srgb,var(--app-bg)_72%,transparent)] hover:bg-[color-mix(in_srgb,var(--gold)_18%,transparent)]',
              )}
              aria-label={t('shell.language')}
              title={t('shell.language')}
            >
              <LanguageFlag lang={language} className="h-[18px] w-auto rounded-[2px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className={cn('w-[188px] rounded-lg border p-1', headerPopoverSurface)}>
            {APP_LANGUAGE_OPTIONS.map((option) => {
              const active = language === option.value
              return (
                <DropdownMenuItem
                  key={option.value}
                  aria-label={option.status ? `${option.label} - ${option.status}` : option.label}
                  disabled={option.disabled}
                  onSelect={() => {
                    setLanguage(option.value)
                  }}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-[16px] font-normal',
                    isLight
                      ? 'focus:bg-amber-100/70 focus:text-slate-950'
                      : 'focus:bg-[color-mix(in_srgb,var(--gold)_16%,transparent)] focus:text-emerald-50',
                    option.disabled && 'cursor-not-allowed opacity-75',
                  )}
                >
                  <LanguageFlag lang={option.value} className="h-[18px] w-auto shrink-0 rounded-[2px]" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="truncate">{option.label}</span>
                    {option.status ? (
                      <span className={cn('shrink-0 text-[16px]', isLight ? 'text-slate-500' : 'text-[#d0e8df]')}>
                        {option.status}
                      </span>
                    ) : null}
                  </span>
                  {active ? <Check className="size-4 shrink-0 text-[color:var(--gold)]" strokeWidth={2} /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          className={cn(
            btn,
            'min-h-10 w-10 shrink-0 gap-2 px-0 py-2 text-[13px] font-normal',
            'ring-1 ring-transparent hover:ring-[color-mix(in_srgb,var(--gold)_42%,transparent)]',
          )}
          title={t('shell.aiQuickScenarios')}
          aria-label={t('shell.aiQuickScenarios')}
          aria-haspopup="dialog"
          aria-expanded={aiOpen}
          onClick={() => setAiOpen(true)}
        >
          <span>AI</span>
        </button>

        <a
          href={MARKETPLACE_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex min-h-10 w-[184px] shrink-0 items-center justify-center gap-2 rounded-[var(--section-cta-radius)] px-0 py-2 text-[13px] font-light uppercase text-[#d4f5c4] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]',
            'bg-[var(--corporate-green)] shadow-sm shadow-black/20',
            'tracking-[0.26em]',
          )}
          title={t('shell.marketplaceTitle')}
          aria-label="Marketplace — baza.sale"
        >
          Marketplace
        </a>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={iconBtn}
              title={t('shell.notifications')}
              aria-label={t('shell.notifications')}
            >
              <Bell className="size-[18px]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className={notifPanelClass}>
            <DropdownMenuLabel className="px-3 py-2 text-[13px] font-normal">
              {t('shell.notifications')}
            </DropdownMenuLabel>
            <div className="max-h-[min(52vh,18rem)] overflow-y-auto px-1 pb-1">
              {DASHBOARD_NOTIFICATIONS_PREVIEW.slice(0, 5).map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  className={cn(
                    'mb-0.5 cursor-default flex flex-col items-start gap-0.5 rounded-md py-2.5 whitespace-normal',
                    isLight ? 'focus:bg-slate-100' : 'focus:bg-emerald-950/50',
                  )}
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="text-[13px] font-normal leading-snug">{n.title}</span>
                  <span className={cn('text-[11px] leading-snug', notifMuted)}>{n.body}</span>
                  <span className={cn('text-[10px]', notifMuted)}>{n.time}</span>
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator className={isLight ? 'bg-slate-200' : 'bg-emerald-800/40'} />
            {canInfo ? (
              <DropdownMenuItem asChild className="cursor-pointer font-normal">
                <Link to="/dashboard/settings/info">{t('shell.allInfo')}</Link>
              </DropdownMenuItem>
            ) : (
              <p className={cn('px-2 py-2 text-center text-[11px]', notifMuted)}>
                {t('shell.infoAccessDenied')}
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <WorkspaceAddButton variant="header" className="shrink-0" />
      </nav>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent
          showCloseButton
          className={cn(
            'gap-0 overflow-hidden border p-0 sm:max-w-md',
            headerPopoverSurface,
          )}
        >
          <div className="flex gap-3 px-4 pb-4 pt-4 pr-14 sm:pr-16">
            <div
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-xl border',
                'border-[color:var(--hub-tile-icon-border)] bg-[var(--hub-tile-icon-bg)] text-[color:var(--hub-tile-icon-fg)]',
              )}
            >
              <Sparkles className="size-5" strokeWidth={2} />
            </div>
            <DialogHeader className="min-w-0 flex-1 space-y-2 text-left">
              <DialogTitle className="text-[1.05rem] font-normal uppercase leading-tight tracking-[0.05em] text-[color:var(--theme-accent-heading)]">
                {t('shell.aiAssistant')}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-[color:var(--hub-body)]">
                {t('shell.aiDescription')}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex flex-col gap-2 border-t border-[color:var(--workspace-row-border)] px-4 py-4">
            <p className="text-[11px] font-normal uppercase tracking-wide text-[color:var(--app-text-subtle)]">
              {t('shell.quickJump')}
            </p>
            <div className="flex flex-col gap-2">
              <Link
                to="/dashboard/leads/poker"
                onClick={() => setAiOpen(false)}
                className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2.5 text-[13px] font-normal text-[color:var(--workspace-text)] transition-colors hover:border-[color:color-mix(in_srgb,var(--gold)_40%,transparent)]"
              >
                {t('nav.leadsFunnel')}
              </Link>
              <Link
                to="/dashboard/deals"
                onClick={() => setAiOpen(false)}
                className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2.5 text-[13px] font-normal text-[color:var(--workspace-text)] transition-colors hover:border-[color:color-mix(in_srgb,var(--gold)_40%,transparent)]"
              >
                {t('nav.deals')}
              </Link>
              <Link
                to="/dashboard/objects/list"
                onClick={() => setAiOpen(false)}
                className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2.5 text-[13px] font-normal text-[color:var(--workspace-text)] transition-colors hover:border-[color:color-mix(in_srgb,var(--gold)_40%,transparent)]"
              >
                {t('nav.objects')}
              </Link>
            </div>
            <label className="mt-1 text-[11px] text-[color:var(--app-text-subtle)]">
              <span className="mb-1 block">{t('shell.assistantPromptSoon')}</span>
              <textarea
                readOnly
                rows={2}
                placeholder={t('shell.assistantPlaceholder')}
                className="w-full resize-none rounded-md border border-[color:var(--workspace-row-border)] bg-[color-mix(in_srgb,var(--app-bg)_88%,transparent)] px-2 py-1.5 text-[12px] text-[color:var(--workspace-text-muted)] outline-none"
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  )
}
