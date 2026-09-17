import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, LogOut, Monitor, RefreshCw, Smartphone } from 'lucide-react'
import { useI18n } from "@/i18n";
import { platformAuthApi, type PlatformSession } from '@/services/platformAuthApi'

/**
 * Лёгкая эвристика браузер/ОС по сырому User-Agent — сервер не хранит
 * готовую пару вида «Chrome · Windows 11», только userAgent как есть.
 * Не распознанное — честно показываем сырую строку, не выдумываем.
 */
function parseUserAgent(userAgent: string | undefined): { device: string; isMobile: boolean } {
  if (!userAgent) return { device: '—', isMobile: false }

  const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent)

  let browser: string | null = null
  if (/Edg\//.test(userAgent)) browser = 'Edge'
  else if (/OPR\//.test(userAgent)) browser = 'Opera'
  else if (/Chrome\//.test(userAgent)) browser = 'Chrome'
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox'
  else if (/Safari\//.test(userAgent)) browser = 'Safari'

  let os: string | null = null
  if (/Windows NT/.test(userAgent)) os = 'Windows'
  else if (/Mac OS X/.test(userAgent)) os = 'macOS'
  else if (/Android/.test(userAgent)) os = 'Android'
  else if (/iPhone|iPad|iOS/.test(userAgent)) os = 'iOS'
  else if (/Linux/.test(userAgent)) os = 'Linux'

  if (browser && os) return { device: `${browser} · ${os}`, isMobile }
  if (browser) return { device: browser, isMobile }
  if (os) return { device: os, isMobile }
  return { device: userAgent, isMobile }
}

function formatRelativeTime(iso: string, t: (key: string, fallback?: string) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) return t('settings.securityTab.сейчас', 'Сейчас')
  if (diffMinutes < 60) return `${diffMinutes} ${t('settings.securityTab.мин_назад', 'мин назад')}`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} ${t('settings.securityTab.ч_назад', 'ч назад')}`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} ${t('settings.securityTab.дн_назад', 'дн назад')}`
}

export function SecurityTab() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<PlatformSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [revokingOthers, setRevokingOthers] = useState(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadSessions = useCallback(() => {
    setLoading(true)
    setError(null)
    platformAuthApi.listSessions()
      .then((items) => {
        if (!isMountedRef.current) return
        setSessions(items)
        setLoading(false)
      })
      .catch(() => {
        if (!isMountedRef.current) return
        setSessions([])
        setError('Не удалось загрузить список сессий')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions, reloadTrigger])

  async function revokeSession(id: string) {
    setPendingId(id)
    try {
      await platformAuthApi.revokeSession(id)
      if (!isMountedRef.current) return
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch {
      // тихо оставляем сессию в списке — пользователь может повторить попытку
    } finally {
      if (isMountedRef.current) setPendingId(null)
    }
  }

  async function revokeAllExceptCurrent() {
    const others = sessions.filter((s) => !s.current)
    if (others.length === 0) return

    setRevokingOthers(true)
    const results = await Promise.allSettled(others.map((s) => platformAuthApi.revokeSession(s.id)))
    if (!isMountedRef.current) return

    const revokedIds = new Set(
      others.filter((_, index) => results[index]!.status === 'fulfilled').map((s) => s.id),
    )
    setSessions((prev) => prev.filter((s) => !revokedIds.has(s.id)))
    setRevokingOthers(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-[color:var(--hub-card-border)] bg-[rgba(0,0,0,0.3)] p-10 text-center">
        <div className="relative size-8">
          <span className="absolute inset-0 rounded-full border-2 border-[color:var(--hub-card-border)]" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[color:var(--theme-accent-link-dim)]" />
        </div>
        <p className="text-sm text-[color:var(--hub-desc)]">{t('settings.securityTab.загрузка', 'Загрузка сессий…')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-[color:var(--hub-card-border)] bg-[rgba(0,0,0,0.3)] p-10 text-center">
        <AlertCircle className="size-8 text-red-400" />
        <p className="max-w-sm text-sm text-[color:var(--hub-desc)]">{error}</p>
        <button
          type="button"
          onClick={() => setReloadTrigger((v) => v + 1)}
          className="flex items-center gap-2 rounded-lg border border-[color:var(--hub-card-border)] px-4 py-2 text-xs font-medium text-[color:var(--theme-accent-link-dim)] hover:border-[color:var(--hub-card-border-hover)] hover:text-[color:var(--app-text)] transition-colors"
        >
          <RefreshCw className="size-3.5" />
          {t('settings.securityTab.повторить', 'Повторить')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-xl border border-[color:var(--hub-card-border)] bg-[rgba(0,0,0,0.3)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--hub-tile-icon-border)]">
          <p className="text-xs font-normal uppercase tracking-wide text-[color:var(--hub-badge-soon-fg)]">
            {t('settings.securityTab.активные_сессии')}
          </p>
          {sessions.some((s) => !s.current) && (
            <button
              onClick={() => { void revokeAllExceptCurrent() }}
              disabled={revokingOthers}
              className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
            >
              {t('settings.securityTab.завершить_все_кроме')}
            </button>
          )}
        </div>

        <div className="divide-y divide-[color:var(--hub-tile-icon-border)]">
          {sessions.map((s) => {
            const { device, isMobile } = parseUserAgent(s.userAgent)
            return (
              <div key={s.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--hub-action-hover)] transition-colors">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--hub-card-border)] bg-[var(--hub-tile-icon-bg)] text-[color:var(--app-text-muted)]">
                  {isMobile ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-normal text-[color:var(--app-text)]">{device}</p>
                    {s.current && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-normal text-emerald-400 uppercase tracking-wide">
                        {t('settings.securityTab.текущая')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[color:var(--hub-stat-label)] mt-0.5">
                    {[s.ipAddress, formatRelativeTime(s.createdAt, t)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {!s.current && (
                  <button
                    onClick={() => { void revokeSession(s.id) }}
                    disabled={pendingId === s.id}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-900/15 px-3 py-1.5 text-xs font-medium text-red-400 hover:border-red-400/60 hover:bg-red-900/25 hover:text-red-300 disabled:opacity-50 transition-colors"
                  >
                    <LogOut className="size-3.5" />
                    {t('settings.securityTab.завершить')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
