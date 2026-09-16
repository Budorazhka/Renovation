import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { useI18n } from '../i18n'
import { useAuthSession } from '../features/auth/model/useAuthSession'
import { referralApi } from '../features/referral/api/referral-api'
import { joinErrorText } from './MyTeamPage'

/**
 * Страница ссылки-приглашения куратора `/join/:code`. До входа показывает,
 * кто зовёт, и ведёт на регистрацию или вход с возвратом сюда же; после
 * входа — одна кнопка «Вступить».
 */
export function JoinTeamPage() {
  const { code = '' } = useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { isAuthenticated, isChecking } = useAuthSession()
  const [curatorName, setCuratorName] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'not-found' | 'joining'>('loading')
  const [error, setError] = useState<string | null>(null)

  useSeoMetadata({ title: t('team.joinSeoTitle'), description: t('team.seoDescription') })

  useEffect(() => {
    let cancelled = false
    referralApi
      .previewInvite(code)
      .then((preview) => {
        if (cancelled) return
        setCuratorName(preview.curatorName)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('not-found')
      })
    return () => {
      cancelled = true
    }
  }, [code])

  async function join() {
    setState('joining')
    setError(null)
    try {
      await referralApi.join(code)
      navigate('/account/team', { replace: true })
    } catch (cause) {
      setError(joinErrorText(cause, t))
      setState('ready')
    }
  }

  const next = encodeURIComponent(`/join/${code}`)

  if (state === 'loading' || isChecking) {
    return (
      <div className="state-panel" role="status" aria-busy="true">
        <p>{t('team.loading')}</p>
      </div>
    )
  }

  if (state === 'not-found') {
    return (
      <div className="team-page team-page--narrow">
        <section className="team-card">
          <h1>{t('team.errors.inviteNotFound')}</h1>
          <p className="team-card__muted">{t('team.inviteNotFoundText')}</p>
          <Link to="/" className="team-button">
            {t('team.toCatalogue')}
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="team-page team-page--narrow">
      <section className="team-card team-card--invite-landing">
        <p className="team-card__muted">{t('team.invitedBy')}</p>
        <h1>{curatorName}</h1>
        <p>{t('team.inviteLandingText')}</p>
        {error ? (
          <p className="team-card__error" role="alert">
            {error}
          </p>
        ) : null}
        {isAuthenticated ? (
          <button type="button" className="team-button" onClick={() => void join()} disabled={state === 'joining'}>
            {state === 'joining' ? t('team.joining') : t('team.join')}
          </button>
        ) : (
          <div className="team-invite-actions">
            <Link to={`/auth/register?next=${next}`} className="team-button">
              {t('team.registerAndJoin')}
            </Link>
            <Link to={`/auth/login?next=${next}`} className="team-button team-button--ghost">
              {t('team.loginAndJoin')}
            </Link>
          </div>
        )}
      </section>
    </div>
  )
}
