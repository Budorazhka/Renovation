import { useEffect, useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { notificationsApiV2, type NotificationSettings } from '@/services/notificationsApiV2'
import { useI18n } from '@/i18n'

const MUTED = 'text-[color:var(--app-text-muted)]'
const BUTTON =
  'inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[16px] disabled:opacity-72'

/**
 * Уведомления в личном кабинете: новости на почту (адрес — логин) и в
 * Telegram через бота уведомлений BAZA. Привязка — ссылка t.me/<бот>?start=
 * <код>: человек жмёт «Старт» в Telegram, возвращается и проверяет статус.
 */
export function NotificationSettingsPanel() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [linkOpened, setLinkOpened] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    notificationsApiV2
      .get()
      .then((value) => {
        if (!cancelled) setSettings(value)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<NotificationSettings | void>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      setSettings(next ?? (await notificationsApiV2.get()))
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  async function connectTelegram() {
    // Вкладку открываем сразу по клику: после await браузер заблокировал бы всплывающее окно.
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    setError(null)
    try {
      const { url } = await notificationsApiV2.createTelegramLink()
      if (tab) tab.location.href = url
      else window.location.href = url
      setLinkOpened(true)
    } catch {
      tab?.close()
      setError(t('notifications.linkFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (failed) return <p role="alert" className="text-[16px] text-[#ffb4ab]">{t('notifications.loadFailed')}</p>
  if (!settings) return <p className={`text-[16px] ${MUTED}`}>{t('common.loading')}</p>

  const emailUsable = settings.email.configured && !!settings.email.address
  return (
    <div className="flex flex-col gap-5 text-[color:var(--app-text)]">
      {error ? <p role="alert" className="text-[16px] text-[#ffb4ab]">{error}</p> : null}

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-[16px] font-medium">
          <Mail className="size-4 text-[color:var(--gold)]" aria-hidden /> {t('notifications.email')}
        </p>
        <p className={`text-[16px] ${MUTED}`}>
          {!settings.email.configured
            ? t('notifications.notConfigured')
            : settings.email.address ?? t('notifications.emailNone')}
        </p>
        <label className={`flex items-center gap-2 text-[16px] ${emailUsable ? '' : MUTED}`}>
          <input
            type="checkbox"
            checked={settings.email.news}
            disabled={busy || !emailUsable}
            onChange={(e) => void run(() => notificationsApiV2.update({ newsEmail: e.target.checked }), t('notifications.saveFailed'))}
            className="size-4 accent-[var(--gold)]"
          />
          {t('notifications.emailNews')}
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-[16px] font-medium">
          <Send className="size-4 text-[color:var(--gold)]" aria-hidden /> Telegram
        </p>
        {!settings.telegram.configured ? (
          <p className={`text-[16px] ${MUTED}`}>{t('notifications.notConfigured')}</p>
        ) : (
          <>
            <p className={`text-[16px] ${settings.telegram.linked ? 'text-[color:var(--gold)]' : MUTED}`}>
              {settings.telegram.linked
                ? `${t('notifications.telegramLinked')}${settings.telegram.username ? `: @${settings.telegram.username}` : ''}`
                : t('notifications.telegramNotLinked')}
            </p>
            <div className="flex flex-wrap gap-2">
              {settings.telegram.linked ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => notificationsApiV2.unlinkTelegram(), t('notifications.saveFailed'))}
                  className={`${BUTTON} bg-[var(--workspace-row-bg)] text-[color:var(--app-text)]`}
                >
                  {t('notifications.telegramUnlink')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void connectTelegram()}
                    className={`${BUTTON} bg-[var(--gold)] font-medium text-[color:var(--gold-btn-text)]`}
                  >
                    {t('notifications.telegramConnect')}
                  </button>
                  {linkOpened ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => notificationsApiV2.get(), t('notifications.loadFailed'))}
                      className={`${BUTTON} bg-[var(--workspace-row-bg)] text-[color:var(--app-text)]`}
                    >
                      {t('notifications.telegramCheck')}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {linkOpened && !settings.telegram.linked ? (
              <p className={`max-w-[65ch] text-[16px] ${MUTED}`}>{t('notifications.telegramHint')}</p>
            ) : null}
            <label className={`flex items-center gap-2 text-[16px] ${settings.telegram.linked ? '' : MUTED}`}>
              <input
                type="checkbox"
                checked={settings.telegram.news}
                disabled={busy || !settings.telegram.linked}
                onChange={(e) => void run(() => notificationsApiV2.update({ newsTelegram: e.target.checked }), t('notifications.saveFailed'))}
                className="size-4 accent-[var(--gold)]"
              />
              {t('notifications.telegramNews')}
            </label>
          </>
        )}
      </div>
    </div>
  )
}
