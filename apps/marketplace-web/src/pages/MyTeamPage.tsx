import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSeoMetadata } from '../hooks/useSeoMetadata'
import { useI18n } from '../i18n'
import { TeamTree } from '../features/referral/components/TeamTree'
import {
  inviteUrl,
  referralApi,
  ReferralApiError,
  type Accrual,
  type MoneyAmount,
  type MyReferralNetwork,
  type ReferralRequestType,
} from '../features/referral/api/referral-api'

function formatMoney(money: MoneyAmount, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(money.amountMinorUnits / 100)
}

function moneyList(list: MoneyAmount[], locale: string): string {
  return list.length === 0 ? '—' : list.map((money) => formatMoney(money, locale)).join(' · ')
}

const LOCALES = { ru: 'ru-RU', en: 'en-US', ka: 'ka-GE' } as const

/**
 * «Моя команда» в личном кабинете: реферальная сеть BAZA глазами человека.
 * Куратор — ссылка-приглашение, команда деревом, начислено, выплачено и к
 * выплате. Участник — его куратор и начисления с его сделок. Остальные —
 * вступить по коду или попросить BAZA сделать куратором.
 */
export function MyTeamPage() {
  const { t, language } = useI18n()
  const locale = LOCALES[language as keyof typeof LOCALES] ?? 'ru-RU'
  const [network, setNetwork] = useState<MyReferralNetwork | null>(null)
  const [error, setError] = useState<string | null>(null)

  useSeoMetadata({ title: t('team.seoTitle'), description: t('team.seoDescription') })

  const load = useCallback(async () => {
    setError(null)
    try {
      setNetwork(await referralApi.getMine())
    } catch {
      setError(t('team.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывать сеть при смене языка не нужно
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="state-panel state-panel--error" role="alert">
        <p>{error}</p>
        <button type="button" className="team-button" onClick={() => void load()}>
          {t('team.retry')}
        </button>
      </div>
    )
  }

  if (!network) {
    return (
      <div className="state-panel" role="status" aria-busy="true">
        <p>{t('team.loading')}</p>
      </div>
    )
  }

  const pendingTypes = new Set(network.requests.filter((r) => r.status === 'pending').map((r) => r.type))

  return (
    <div className="team-page">
      <header className="team-page__header">
        <h1>{t('team.title')}</h1>
        <p>{t('team.subtitle', { rate: network.rules.ratePercent, min: network.rules.teamSizeMin, max: network.rules.teamSizeIdealMax })}</p>
      </header>

      {network.role === 'curator' && network.curator ? (
        <CuratorView network={network} locale={locale} />
      ) : null}

      {network.role === 'member' && network.membership ? (
        <section className="team-card">
          <h2>{t('team.yourCurator')}</h2>
          <p className="team-card__lead">{network.membership.curator.name}</p>
          <p className="team-card__muted">
            {network.membership.curator.organizationName ?? t('team.independent')} ·{' '}
            {t('team.memberSince', { date: new Date(network.membership.joinedAt).toLocaleDateString(locale) })}
          </p>
          {network.membership.status === 'on_review' ? <p className="team-card__warning">{t('team.onReview')}</p> : null}
          <AccrualTable accruals={network.membership.accruals} locale={locale} showMember={false} emptyText={t('team.memberNoAccruals')} />
          <RequestForm
            types={['leave_team', 'change_curator']}
            pendingTypes={pendingTypes}
            onCreated={() => void load()}
          />
        </section>
      ) : null}

      {network.role === 'none' ? (
        <div className="team-grid">
          <JoinByCode onJoined={setNetwork} />
          <section className="team-card">
            <h2>{t('team.becomeCuratorTitle')}</h2>
            <p className="team-card__muted">{t('team.becomeCuratorText', { rate: network.rules.ratePercent })}</p>
            <RequestForm types={['become_curator']} pendingTypes={pendingTypes} onCreated={() => void load()} />
          </section>
        </div>
      ) : null}

      {network.requests.length > 0 ? (
        <section className="team-card">
          <h2>{t('team.requestsTitle')}</h2>
          <ul className="team-requests">
            {network.requests.map((request) => (
              <li key={request.id}>
                <span>{t(`team.requestType.${request.type}`)}</span>
                <span className={`team-status team-status--${request.status}`}>{t(`team.requestStatus.${request.status}`)}</span>
                {request.decisionComment ? <span className="team-card__muted">{request.decisionComment}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function CuratorView({ network, locale }: { network: MyReferralNetwork; locale: string }) {
  const { t } = useI18n()
  const curator = network.curator!
  const [copied, setCopied] = useState(false)
  const link = inviteUrl(curator.inviteCode)
  const { teamSize, teamStatus } = curator.node
  const { teamSizeMin, teamSizeIdealMax } = network.rules

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <div className="team-grid">
        <section className="team-card team-card--invite">
          <h2>{t('team.inviteTitle')}</h2>
          <p className="team-card__muted">{t('team.inviteText')}</p>
          <div className="team-invite">
            <input readOnly value={link} aria-label={t('team.inviteTitle')} onFocus={(event) => event.target.select()} />
            <button type="button" className="team-button" onClick={() => void copy()}>
              {copied ? t('team.copied') : t('team.copy')}
            </button>
          </div>
          <p className="team-card__muted">{t('team.inviteCode', { code: curator.inviteCode })}</p>
        </section>

        <section className="team-card">
          <h2>{t('team.teamTitle')}</h2>
          <p className="team-card__lead">{t('team.teamCount', { count: teamSize, max: teamSizeIdealMax })}</p>
          <p className={`team-status team-status--${teamStatus}`}>{t(`team.teamStatus.${teamStatus}`)}</p>
          <div className="team-fill" aria-hidden>
            <div className="team-fill__band" style={{ left: `${(teamSizeMin / (teamSizeIdealMax + 5)) * 100}%`, width: `${((teamSizeIdealMax - teamSizeMin) / (teamSizeIdealMax + 5)) * 100}%` }} />
            <div className="team-fill__value" style={{ width: `${Math.min(100, (teamSize / (teamSizeIdealMax + 5)) * 100)}%` }} />
          </div>
          <dl className="team-money">
            <div>
              <dt>{t('team.earned')}</dt>
              <dd>{moneyList(curator.totals.earned, locale)}</dd>
            </div>
            <div>
              <dt>{t('team.paid')}</dt>
              <dd>{moneyList(curator.totals.paid, locale)}</dd>
            </div>
            <div>
              <dt>{t('team.due')}</dt>
              <dd>{moneyList(curator.totals.due, locale)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="team-card team-card--tree">
        {curator.node.members.length === 0 ? (
          <p className="team-card__muted">{t('team.emptyTeam')}</p>
        ) : null}
        <TeamTree
          curator={{ id: curator.node.person.identityId, name: curator.node.person.name }}
          members={curator.node.members.map((member) => ({
            id: member.person.identityId,
            name: member.person.name,
            joinedVia: member.joinedVia,
            status: member.status,
          }))}
        />
      </section>

      <section className="team-card">
        <h2>{t('team.accrualsTitle')}</h2>
        <AccrualTable accruals={curator.accruals} locale={locale} showMember emptyText={t('team.curatorNoAccruals')} />
      </section>
    </>
  )
}

function AccrualTable({
  accruals,
  locale,
  showMember,
  emptyText,
}: {
  accruals: Accrual[]
  locale: string
  showMember: boolean
  emptyText: string
}) {
  const { t } = useI18n()
  if (accruals.length === 0) return <p className="team-card__muted">{emptyText}</p>
  return (
    <div className="team-table-scroll">
      <table className="team-table">
        <thead>
          <tr>
            {showMember ? <th>{t('team.colMember')}</th> : null}
            <th>{t('team.colCommission')}</th>
            <th>{t('team.colAccrual')}</th>
            <th>{t('team.colDate')}</th>
            <th>{t('team.colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {accruals.map((accrual) => (
            <tr key={accrual.id} className={accrual.status === 'reversed' ? 'is-reversed' : undefined}>
              {showMember ? <td>{accrual.member.name}</td> : null}
              <td>
                {formatMoney(accrual.commission, locale)} × {accrual.ratePercent}%
              </td>
              <td>{formatMoney(accrual.amount, locale)}</td>
              <td>{new Date(accrual.accruedAt).toLocaleDateString(locale)}</td>
              <td>{t(`team.accrualStatus.${accrual.status}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JoinByCode({ onJoined }: { onJoined: (network: MyReferralNetwork) => void }) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      onJoined(await referralApi.join(code))
    } catch (cause) {
      setError(joinErrorText(cause, t))
      setSubmitting(false)
    }
  }

  return (
    <section className="team-card">
      <h2>{t('team.joinTitle')}</h2>
      <p className="team-card__muted">{t('team.joinText')}</p>
      <form className="team-invite" onSubmit={submit}>
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="ABCD2345" aria-label={t('team.codeLabel')} />
        <button type="submit" className="team-button" disabled={submitting || code.trim().length < 4}>
          {submitting ? t('team.joining') : t('team.join')}
        </button>
      </form>
      {error ? (
        <p className="team-card__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export function joinErrorText(cause: unknown, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (cause instanceof ReferralApiError) {
    if (cause.status === 404) return t('team.errors.inviteNotFound')
    if (cause.code === 'REFERRAL_COMPANY_MISMATCH') return t('team.errors.companyMismatch')
    if (cause.code === 'REFERRAL_ALREADY_IN_TEAM') return t('team.errors.alreadyInTeam')
    if (cause.status === 400) return t('team.errors.cannotJoin')
  }
  return t('team.errors.joinFailed')
}

function RequestForm({
  types,
  pendingTypes,
  onCreated,
}: {
  types: ReferralRequestType[]
  pendingTypes: Set<ReferralRequestType>
  onCreated: () => void
}) {
  const { t } = useI18n()
  const available = types.filter((type) => !pendingTypes.has(type))
  const [type, setType] = useState<ReferralRequestType>(available[0] ?? types[0]!)
  const [reason, setReason] = useState('')
  const [targetCode, setTargetCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (available.length === 0) return <p className="team-card__muted">{t('team.requestPending')}</p>

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await referralApi.createRequest({
        type,
        reason: reason.trim(),
        ...(type === 'change_curator' ? { targetInviteCode: targetCode.trim() } : {}),
      })
      setReason('')
      setTargetCode('')
      onCreated()
    } catch (cause) {
      setError(
        cause instanceof ReferralApiError && cause.code === 'REFERRAL_REQUEST_PENDING'
          ? t('team.requestPending')
          : joinErrorText(cause, t),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="team-request-form" onSubmit={submit}>
      {available.length > 1 ? (
        <div className="team-segmented" role="radiogroup" aria-label={t('team.requestTypeLabel')}>
          {available.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={type === option} className={type === option ? 'is-active' : ''} onClick={() => setType(option)}>
              {t(`team.requestType.${option}`)}
            </button>
          ))}
        </div>
      ) : null}
      {type === 'change_curator' ? (
        <input value={targetCode} onChange={(event) => setTargetCode(event.target.value)} placeholder={t('team.newCuratorCode')} aria-label={t('team.newCuratorCode')} />
      ) : null}
      <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('team.reasonPlaceholder')} aria-label={t('team.reasonPlaceholder')} />
      <p className="team-card__muted">{t('team.requestHint')}</p>
      {error ? (
        <p className="team-card__error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="team-button"
        disabled={submitting || reason.trim().length < 3 || (type === 'change_curator' && targetCode.trim().length < 4)}
      >
        {submitting ? t('team.sending') : t('team.sendRequest')}
      </button>
    </form>
  )
}
