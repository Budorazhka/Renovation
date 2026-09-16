import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminApi, AdminApiError } from '../api/admin-api'
import { ReferralGenealogy } from '../components/ReferralGenealogy'
import { ReferralNetworkList } from '../components/ReferralNetworkList'
import { formatDateTime } from '../lib/format'
import {
  formatMoneyList,
  membershipEndReasonLabel,
  organizationTypeShort,
  requestStatusLabel,
  requestTypeLabel,
  teamStatusLabel,
} from '../lib/referral-format'
import { curatorKey, memberKey, rootKey } from '../lib/referral-tree-layout'
import type {
  AdminCuratorNode,
  AdminReferralNetwork,
  AdminReferralPerson,
  AdminReferralPersonLookup,
  MembershipHistoryItem,
  ReferralRequest,
  ReferralRequestStatus,
  ReferralTeamMember,
} from '../types/referral'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; network: AdminReferralNetwork }

type Selection =
  | { kind: 'root' }
  | { kind: 'curator'; curator: AdminCuratorNode }
  | { kind: 'member'; member: ReferralTeamMember; curator: AdminCuratorNode }
  | { kind: 'lookup'; lookup: AdminReferralPersonLookup }

/** Действие суперадмина, которое ждёт причины. */
type PendingAction =
  | { type: 'appoint'; person: AdminReferralPerson }
  | { type: 'retire'; curator: AdminCuratorNode }
  | { type: 'assign'; person: AdminReferralPerson; curatorIdentityId: string }
  | { type: 'remove'; person: AdminReferralPerson }
  | { type: 'decide'; request: ReferralRequest; decision: 'approved' | 'rejected' }

const MIN_REASON = 3

function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof AdminApiError)) return fallback
  if (cause.code === 'ADMIN_SCOPE_INSUFFICIENT') return 'Недостаточно прав: реферальную сеть правит суперадмин или администратор с правом referral_network.manage.'
  if (cause.code === 'REFERRAL_COMPANY_MISMATCH') return 'Сотрудник агентства не может состоять в команде куратора из другой компании.'
  if (cause.code === 'REFERRAL_ALREADY_IN_TEAM') return 'Человек уже в этой команде.'
  return cause.message
}

/** Где в сети человек: сам куратор или чей участник. */
function locate(network: AdminReferralNetwork, key: string): Selection | null {
  if (key === rootKey) return { kind: 'root' }
  for (const curator of network.curators) {
    if (key === curatorKey(curator.person.identityId)) return { kind: 'curator', curator }
    const member = curator.members.find((m) => key === memberKey(m.person.identityId))
    if (member) return { kind: 'member', member, curator }
  }
  return null
}

export function ReferralNetworkPage() {
  const [tab, setTab] = useState<'tree' | 'requests'>('tree')
  const [view, setView] = useState<'tree' | 'list'>('tree')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [selection, setSelection] = useState<Selection>({ kind: 'root' })
  const [selectedKey, setSelectedKey] = useState<string | null>(rootKey)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    try {
      const network = await adminApi.getReferralNetwork()
      setState({ status: 'ready', network })
      return network
    } catch (cause) {
      setState({ status: 'error', message: errorMessage(cause, 'Не удалось загрузить реферальную сеть.') })
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** После правки сеть приходит заново: выбор переносим на тот же узел, если он ещё есть. */
  const applyNetwork = useCallback((network: AdminReferralNetwork, keepKey: string | null) => {
    setState({ status: 'ready', network })
    const found = keepKey ? locate(network, keepKey) : null
    setSelection(found ?? { kind: 'root' })
    setSelectedKey(found ? keepKey : rootKey)
  }, [])

  function toggle(curatorId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(curatorId)) next.delete(curatorId)
      else next.add(curatorId)
      return next
    })
  }

  function select(key: string) {
    if (state.status !== 'ready') return
    const found = locate(state.network, key)
    if (!found) return
    setNotice(null)
    setSelectedKey(key)
    setSelection(found)
    // Выбранный участник всегда виден: его команда раскрывается.
    if (found.kind === 'member') {
      setExpanded((current) => new Set(current).add(found.curator.person.identityId))
    }
  }

  const allExpanded =
    state.status === 'ready' &&
    state.network.curators.filter((c) => c.members.length > 0).every((c) => expanded.has(c.person.identityId))

  return (
    <section className="page page--wide">
      <div className="page-header">
        <h1>Реферальная сеть</h1>
        <p className="page-caption">
          Куратор получает от BAZA {state.status === 'ready' ? state.network.rules.ratePercent : 7}% от комиссии агентов своей
          команды по сделкам первички. Команда на старте от 5 человек, в идеале до 20. Куратором становится только
          проверенный BAZA риэлтор; уход и смена куратора — по заявке.
        </p>
      </div>

      {state.status === 'ready' ? (
        <div className="referral-summary" role="list">
          <div role="listitem">
            <strong>{state.network.summary.curators}</strong> кураторов
          </div>
          <div role="listitem">
            <strong>{state.network.summary.members}</strong> в командах
          </div>
          <div role="listitem" className={state.network.summary.membersOnReview > 0 ? 'is-warning' : undefined}>
            <strong>{state.network.summary.membersOnReview}</strong> связей под вопросом
          </div>
          <button type="button" className="link-button" onClick={() => setTab('requests')}>
            <strong>{state.network.summary.pendingRequests}</strong> заявок ждут решения
          </button>
        </div>
      ) : null}

      <div className="tab-bar" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tree'} className={tab === 'tree' ? 'is-active' : ''} onClick={() => setTab('tree')}>
          Сеть
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'requests'}
          className={tab === 'requests' ? 'is-active' : ''}
          onClick={() => setTab('requests')}
        >
          Заявки
        </button>
      </div>

      {state.status === 'loading' ? <div className="state-panel">Загружаем сеть…</div> : null}
      {state.status === 'error' ? (
        <div className="state-panel state-panel--error">
          <p>{state.message}</p>
          <button type="button" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="referral-notice" role="status">
          {notice}
        </p>
      ) : null}

      {state.status === 'ready' && tab === 'tree' ? (
        <div className="referral-layout">
          <div className="referral-layout__canvas">
            <PersonSearch
              onFound={(lookup) => {
                const key = lookup.isCurator
                  ? curatorKey(lookup.person.identityId)
                  : lookup.membership
                    ? memberKey(lookup.person.identityId)
                    : null
                if (key && locate(state.network, key)) {
                  select(key)
                  setFocusKey(key)
                } else {
                  setSelectedKey(null)
                  setSelection({ kind: 'lookup', lookup })
                }
              }}
            />

            <div className="network-controls">
              <div className="network-controls__segmented" role="radiogroup" aria-label="Вид сети">
                <button type="button" role="radio" aria-checked={view === 'tree'} className={view === 'tree' ? 'is-active' : ''} onClick={() => setView('tree')}>
                  Деревом
                </button>
                <button type="button" role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}>
                  Списком
                </button>
              </div>
              {state.network.curators.some((c) => c.members.length > 0) ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setExpanded(
                      allExpanded ? new Set() : new Set(state.network.curators.filter((c) => c.members.length > 0).map((c) => c.person.identityId)),
                    )
                  }
                >
                  {allExpanded ? 'Свернуть все команды' : 'Раскрыть все команды'}
                </button>
              ) : null}
            </div>

            {state.network.curators.length === 0 ? (
              <div className="state-panel">
                Кураторов пока нет. Найдите проверенного риэлтора по почте и назначьте его куратором.
              </div>
            ) : view === 'tree' ? (
              <ReferralGenealogy
                curators={state.network.curators}
                rules={state.network.rules}
                expanded={expanded}
                onToggle={toggle}
                selectedKey={selectedKey}
                onSelect={select}
                focusKey={focusKey}
              />
            ) : (
              <ReferralNetworkList
                curators={state.network.curators}
                rules={state.network.rules}
                expanded={expanded}
                onToggle={toggle}
                selectedKey={selectedKey}
                onSelect={select}
              />
            )}
          </div>

          <aside className="referral-layout__panel" aria-live="polite">
            <SelectionPanel
              selection={selection}
              network={state.network}
              onAction={(action) => {
                setNotice(null)
                setPending(action)
              }}
            />
          </aside>
        </div>
      ) : null}

      {state.status === 'ready' && tab === 'requests' ? (
        <RequestsQueue
          onDecide={(request, decision) => setPending({ type: 'decide', request, decision })}
          refreshToken={state.network.summary.pendingRequests}
        />
      ) : null}

      {pending && state.status === 'ready' ? (
        <ActionDialog
          action={pending}
          curators={state.network.curators}
          onCancel={() => setPending(null)}
          onDone={async (result) => {
            const keepKey = selectedKey
            setPending(null)
            setNotice(result.message)
            if (result.network) applyNetwork(result.network, keepKey)
            else await load()
          }}
        />
      ) : null}
    </section>
  )
}

function PersonSearch({ onFound }: { onFound: (lookup: AdminReferralPersonLookup) => void }) {
  const [login, setLogin] = useState('')
  const [status, setStatus] = useState<'idle' | 'searching' | 'not-found' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (login.trim().length < 3) return
    setStatus('searching')
    setError(null)
    try {
      onFound(await adminApi.findReferralPerson(login))
      setStatus('idle')
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 404) {
        setStatus('not-found')
      } else {
        setStatus('error')
        setError(errorMessage(cause, 'Поиск не удался.'))
      }
    }
  }

  return (
    <form className="filter-bar referral-search" onSubmit={submit}>
      <div className="filter-field">
        <label htmlFor="referral-search-login">Найти человека по почте</label>
        <input
          id="referral-search-login"
          type="search"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          placeholder="realtor@example.ge"
        />
      </div>
      <button type="submit" disabled={status === 'searching' || login.trim().length < 3}>
        {status === 'searching' ? 'Ищем…' : 'Найти'}
      </button>
      {status === 'not-found' ? <span className="referral-search__hint">Такой почты на платформе нет.</span> : null}
      {status === 'error' && error ? <span className="referral-search__hint is-error">{error}</span> : null}
    </form>
  )
}

function PersonHeader({ person }: { person: AdminReferralPerson }) {
  return (
    <header className="referral-card__header">
      <h2>{person.name}</h2>
      <p>
        {person.login}
        <br />
        {person.organizationName ? `${person.organizationName}, ` : ''}
        {organizationTypeShort(person.organizationType)}
      </p>
    </header>
  )
}

function SelectionPanel({
  selection,
  network,
  onAction,
}: {
  selection: Selection
  network: AdminReferralNetwork
  onAction: (action: PendingAction) => void
}) {
  if (selection.kind === 'root') {
    return (
      <div className="referral-card">
        <header className="referral-card__header">
          <h2>BAZA</h2>
          <p>Вся сеть платформы. Выберите куратора или участника на дереве, либо найдите человека по почте.</p>
        </header>
        <dl className="referral-card__facts">
          <div>
            <dt>Кураторов</dt>
            <dd>{network.summary.curators}</dd>
          </div>
          <div>
            <dt>В командах</dt>
            <dd>{network.summary.members}</dd>
          </div>
          <div>
            <dt>Всего к выплате кураторам</dt>
            <dd>{formatMoneyList(sumDue(network.curators))}</dd>
          </div>
        </dl>
      </div>
    )
  }

  if (selection.kind === 'lookup') {
    const { lookup } = selection
    return (
      <div className="referral-card">
        <PersonHeader person={lookup.person} />
        <p className="referral-card__note">В сети пока не состоит.</p>
        <div className="referral-card__actions">
          <button type="button" onClick={() => onAction({ type: 'appoint', person: lookup.person })}>
            Назначить куратором
          </button>
          {network.curators.length > 0 ? (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onAction({ type: 'assign', person: lookup.person, curatorIdentityId: network.curators[0]!.person.identityId })
              }
            >
              Поставить в команду
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (selection.kind === 'curator') {
    const { curator } = selection
    return (
      <div className="referral-card">
        <PersonHeader person={curator.person} />
        <dl className="referral-card__facts">
          <div>
            <dt>Код приглашения</dt>
            <dd>
              <code>{curator.inviteCode}</code>
            </dd>
          </div>
          <div>
            <dt>Куратор с</dt>
            <dd>{formatDateTime(curator.appointedAt)}</dd>
          </div>
          <div>
            <dt>Команда</dt>
            <dd>
              {curator.teamSize} из {network.rules.teamSizeIdealMax} ·{' '}
              <span className={`team-status team-status--${curator.teamStatus}`}>{teamStatusLabel(curator.teamStatus)}</span>
            </dd>
          </div>
          <div>
            <dt>Начислено</dt>
            <dd>{formatMoneyList(curator.totals.earned)}</dd>
          </div>
          <div>
            <dt>Выплачено</dt>
            <dd>{formatMoneyList(curator.totals.paid)}</dd>
          </div>
          <div>
            <dt>К выплате</dt>
            <dd>{formatMoneyList(curator.totals.due)}</dd>
          </div>
        </dl>
        <TeamFill size={curator.teamSize} min={network.rules.teamSizeMin} max={network.rules.teamSizeIdealMax} />
        {curator.members.length > 0 ? (
          <ul className="referral-card__team">
            {curator.members.map((member) => (
              <li key={member.person.identityId}>
                <span>{member.person.name}</span>
                <span className="referral-card__muted">
                  {member.status === 'on_review' ? 'под вопросом' : member.joinedVia === 'invite_link' ? 'по ссылке' : 'добавлен BAZA'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="referral-card__note">В команде пока никого.</p>
        )}
        <div className="referral-card__actions">
          <button type="button" className="danger" onClick={() => onAction({ type: 'retire', curator })}>
            Снять куратора
          </button>
        </div>
      </div>
    )
  }

  const { member, curator } = selection
  return (
    <div className="referral-card">
      <PersonHeader person={member.person} />
      <dl className="referral-card__facts">
        <div>
          <dt>Куратор</dt>
          <dd>{curator.person.name}</dd>
        </div>
        <div>
          <dt>В команде с</dt>
          <dd>
            {formatDateTime(member.joinedAt)} · {member.joinedVia === 'invite_link' ? 'по ссылке' : 'добавлен BAZA'}
          </dd>
        </div>
        {member.status === 'on_review' ? (
          <div className="is-warning">
            <dt>Связь под вопросом</dt>
            <dd>Участник работает в агентстве другой компании. Начисления куратору не пишутся — переведите или уберите.</dd>
          </div>
        ) : null}
      </dl>
      <MemberHistory identityId={member.person.identityId} />
      <div className="referral-card__actions">
        {network.curators.length > 1 ? (
          <button
            type="button"
            onClick={() =>
              onAction({
                type: 'assign',
                person: member.person,
                curatorIdentityId:
                  network.curators.find((c) => c.person.identityId !== curator.person.identityId)?.person.identityId ??
                  curator.person.identityId,
              })
            }
          >
            Перевести к другому куратору
          </button>
        ) : null}
        <button type="button" className="danger" onClick={() => onAction({ type: 'remove', person: member.person })}>
          Убрать из команды
        </button>
      </div>
    </div>
  )
}

function TeamFill({ size, min, max }: { size: number; min: number; max: number }) {
  const scaleMax = Math.max(max + 5, size)
  const percent = (value: number) => `${Math.min(100, (value / scaleMax) * 100)}%`
  return (
    <div className="team-fill" aria-label={`В команде ${size}: норма от ${min} до ${max}`}>
      <div className="team-fill__track">
        <div className="team-fill__band" style={{ left: percent(min), width: `calc(${percent(max)} - ${percent(min)})` }} />
        <div className="team-fill__value" style={{ width: percent(size) }} />
      </div>
      <div className="team-fill__scale" aria-hidden>
        <span style={{ left: percent(min) }}>{min}</span>
        <span style={{ left: percent(max) }}>{max}</span>
      </div>
    </div>
  )
}

function MemberHistory({ identityId }: { identityId: string }) {
  const [items, setItems] = useState<MembershipHistoryItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    adminApi
      .getReferralHistory(identityId)
      .then((response) => {
        if (!cancelled) setItems(response.items)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [identityId])

  if (!items || items.length <= 1) return null
  return (
    <div className="referral-card__history">
      <h3>История</h3>
      <ol>
        {items.map((item) => (
          <li key={`${item.joinedAt}-${item.curator.identityId}`}>
            <span>{item.curator.name}</span>
            <span className="referral-card__muted">
              {formatDateTime(item.joinedAt)}
              {item.endedAt ? ` — ${formatDateTime(item.endedAt)}` : ''} · {membershipEndReasonLabel(item.endReason)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function RequestsQueue({
  onDecide,
  refreshToken,
}: {
  onDecide: (request: ReferralRequest, decision: 'approved' | 'rejected') => void
  refreshToken: number
}) {
  const [status, setStatus] = useState<ReferralRequestStatus>('pending')
  const [items, setItems] = useState<ReferralRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    adminApi
      .listReferralRequests(status)
      .then((response) => {
        if (!cancelled) setItems(response.items)
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Не удалось загрузить заявки.'))
      })
    return () => {
      cancelled = true
    }
  }, [status, refreshToken])

  return (
    <div className="referral-requests">
      <div className="filter-bar">
        <div className="filter-field">
          <label htmlFor="referral-request-status">Статус</label>
          <select id="referral-request-status" value={status} onChange={(event) => setStatus(event.target.value as ReferralRequestStatus)}>
            <option value="pending">Ждут решения</option>
            <option value="approved">Одобренные</option>
            <option value="rejected">Отклонённые</option>
          </select>
        </div>
      </div>
      {error ? <div className="state-panel state-panel--error">{error}</div> : null}
      {items === null && !error ? <div className="state-panel">Загружаем заявки…</div> : null}
      {items && items.length === 0 ? <div className="state-panel">Заявок нет.</div> : null}
      {items && items.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Заявка</th>
                <th>Кто</th>
                <th>Причина</th>
                <th>Подана</th>
                <th>Статус</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {items.map((request) => (
                <tr key={request.id}>
                  <td>
                    {requestTypeLabel(request.type)}
                    {request.targetCurator ? <div className="referral-card__muted">к куратору {request.targetCurator.name}</div> : null}
                  </td>
                  <td>
                    {request.applicant.name}
                    <div className="referral-card__muted">{request.applicant.organizationName ?? organizationTypeShort(null)}</div>
                  </td>
                  <td>{request.reason}</td>
                  <td>{formatDateTime(request.createdAt)}</td>
                  <td>
                    <span className={`status-pill status-pill--${request.status}`}>{requestStatusLabel(request.status)}</span>
                    {request.decisionComment ? <div className="referral-card__muted">{request.decisionComment}</div> : null}
                  </td>
                  <td>
                    {request.status === 'pending' ? (
                      <div className="row-actions">
                        <button type="button" onClick={() => onDecide(request, 'approved')}>
                          Одобрить
                        </button>
                        <button type="button" className="secondary" onClick={() => onDecide(request, 'rejected')}>
                          Отклонить
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function ActionDialog({
  action,
  curators,
  onCancel,
  onDone,
}: {
  action: PendingAction
  curators: AdminCuratorNode[]
  onCancel: () => void
  onDone: (result: { message: string; network: AdminReferralNetwork | null }) => void
}) {
  const [reason, setReason] = useState('')
  const [curatorIdentityId, setCuratorIdentityId] = useState(action.type === 'assign' ? action.curatorIdentityId : '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const text = describe(action)
  const reasonRequired = action.type !== 'decide'
  const canSubmit = !submitting && (!reasonRequired || reason.trim().length >= MIN_REASON)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      switch (action.type) {
        case 'appoint':
          onDone({ message: `${action.person.name} назначен куратором.`, network: await adminApi.appointCurator(action.person.identityId, reason.trim()) })
          break
        case 'retire':
          onDone({ message: `${action.curator.person.name} больше не куратор.`, network: await adminApi.retireCurator(action.curator.person.identityId, reason.trim()) })
          break
        case 'assign':
          onDone({
            message: `${action.person.name} теперь в команде ${curators.find((c) => c.person.identityId === curatorIdentityId)?.person.name ?? ''}.`,
            network: await adminApi.assignReferralMember(action.person.identityId, curatorIdentityId, reason.trim()),
          })
          break
        case 'remove':
          onDone({ message: `${action.person.name} убран из команды.`, network: await adminApi.removeReferralMember(action.person.identityId, reason.trim()) })
          break
        case 'decide':
          await adminApi.decideReferralRequest(action.request.id, action.decision, reason.trim() || undefined)
          onDone({ message: action.decision === 'approved' ? 'Заявка одобрена и применена.' : 'Заявка отклонена.', network: null })
          break
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось выполнить действие.'))
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="referral-action-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="referral-action-title">{text.title}</h2>
        <p className="dialog-target">{text.target}</p>
        {text.warning ? <p className="dialog-warning">{text.warning}</p> : null}

        {action.type === 'assign' ? (
          <>
            <label htmlFor="referral-action-curator">Куратор</label>
            <select id="referral-action-curator" value={curatorIdentityId} onChange={(event) => setCuratorIdentityId(event.target.value)} disabled={submitting}>
              {curators.map((curator) => (
                <option key={curator.person.identityId} value={curator.person.identityId}>
                  {curator.person.name} · в команде {curator.teamSize}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label htmlFor="referral-action-reason">
          {reasonRequired ? `Причина (обязательно, не менее ${MIN_REASON} символов)` : 'Комментарий для заявителя'}
        </label>
        <textarea id="referral-action-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={submitting} />

        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
            Отмена
          </button>
          <button type="button" className={text.danger ? 'danger' : undefined} onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Сохраняем…' : text.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

function describe(action: PendingAction): { title: string; target: string; warning: string | null; confirm: string; danger: boolean } {
  switch (action.type) {
    case 'appoint':
      return {
        title: 'Назначить куратором',
        target: `${action.person.name} · ${action.person.login}`,
        warning: 'Назначение — это проверка BAZA. Если человек состоит в чьей-то команде, он из неё выйдет: сеть одноуровневая.',
        confirm: 'Назначить',
        danger: false,
      }
    case 'retire':
      return {
        title: 'Снять куратора',
        target: `${action.curator.person.name} · в команде ${action.curator.teamSize}`,
        warning: 'Команда куратора закроется, её участники останутся без куратора. Начисленное остаётся за ним.',
        confirm: 'Снять',
        danger: true,
      }
    case 'assign':
      return {
        title: 'Поставить в команду',
        target: `${action.person.name} · ${action.person.login}`,
        warning: 'Если человек уже в другой команде, его переведут: прежнее членство закроется, начисленное прежнему куратору не переедет.',
        confirm: 'Сохранить',
        danger: false,
      }
    case 'remove':
      return {
        title: 'Убрать из команды',
        target: `${action.person.name} · ${action.person.login}`,
        warning: 'С новых сделок этого человека куратору ничего не начислится.',
        confirm: 'Убрать',
        danger: true,
      }
    case 'decide':
      return {
        title: action.decision === 'approved' ? 'Одобрить заявку' : 'Отклонить заявку',
        target: `${requestTypeLabel(action.request.type)} · ${action.request.applicant.name}`,
        warning: action.decision === 'approved' ? 'Одобрение сразу применяет заявку.' : null,
        confirm: action.decision === 'approved' ? 'Одобрить' : 'Отклонить',
        danger: action.decision === 'rejected',
      }
  }
}

function sumDue(curators: AdminCuratorNode[]) {
  const totals = new Map<string, number>()
  for (const curator of curators) {
    for (const money of curator.totals.due) totals.set(money.currency, (totals.get(money.currency) ?? 0) + money.amountMinorUnits)
  }
  return [...totals.entries()].map(([currency, amountMinorUnits]) => ({ currency: currency as 'USD', amountMinorUnits }))
}
