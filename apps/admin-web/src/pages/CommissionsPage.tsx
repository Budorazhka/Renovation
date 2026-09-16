import { useCallback, useEffect, useState } from 'react'
import { adminApi, AdminApiError } from '../api/admin-api'
import { formatDateTime } from '../lib/format'
import { accrualSkipReasonLabel, formatMoney, parseMoneyInput } from '../lib/referral-format'
import type { AccrualOutcome, AdminCommissionDeal, Currency } from '../types/referral'

const STAGE_LABELS: Record<string, string> = {
  showing: 'Показ',
  deposit: 'Задаток',
  deal: 'Сделка',
  golden: 'Золотая сделка',
  check_in: 'Заселение',
  referral: 'Рекомендация',
  closed_lost: 'Проиграна',
}

type Dialog =
  | { type: 'mark'; deal: AdminCommissionDeal }
  | { type: 'cancel'; deal: AdminCommissionDeal }
  | null

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function describeOutcome(deal: AdminCommissionDeal, outcome: AccrualOutcome): string {
  if (outcome.accrued) return `«${deal.title}»: деньги отмечены, куратору начислено ${formatMoney(outcome.amount)}.`
  return `«${deal.title}»: деньги отмечены, начисления нет — ${accrualSkipReasonLabel(outcome.reason)}.`
}

function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof AdminApiError)) return fallback
  if (cause.code === 'ADMIN_SCOPE_INSUFFICIENT') return 'Недостаточно прав: нужен грант commission.confirm.'
  if (cause.code === 'CURATOR_ACCRUAL_ALREADY_PAID') return 'Куратору уже выплачено по этой сделке: отменить может только суперадмин.'
  if (cause.status === 409) return 'Сделку изменили после загрузки списка — обновите страницу.'
  return cause.message
}

/**
 * Комиссии BAZA по сделкам первички (решение владельца 16.09.2026): менеджер
 * BAZA отмечает, что деньги пришли, — в ту же секунду куратору агента
 * начисляется 7%. Отметку, поставленную по ошибке, можно снять: начисление
 * сторнируется.
 */
export function CommissionsPage() {
  const [received, setReceived] = useState(false)
  const [items, setItems] = useState<AdminCommissionDeal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    setItems(null)
    setError(null)
    try {
      setItems((await adminApi.listCommissions(received)).items)
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось загрузить сделки.'))
    }
  }, [received])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="page">
      <div className="page-header">
        <h1>Комиссии</h1>
        <p className="page-caption">
          Сделки первичного рынка всех агентств. Когда комиссия пришла BAZA, отметьте фактическую сумму: куратору агента
          сразу начисляется 7%. Ожидаемая комиссия из CRM — это план, а не деньги.
        </p>
      </div>

      <div className="tab-bar" role="tablist">
        <button type="button" role="tab" aria-selected={!received} className={!received ? 'is-active' : ''} onClick={() => setReceived(false)}>
          Ждут денег
        </button>
        <button type="button" role="tab" aria-selected={received} className={received ? 'is-active' : ''} onClick={() => setReceived(true)}>
          Деньги пришли
        </button>
      </div>

      {notice ? (
        <p className="referral-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="state-panel state-panel--error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      {items === null && !error ? <div className="state-panel">Загружаем сделки…</div> : null}
      {items && items.length === 0 ? (
        <div className="state-panel">{received ? 'Отмеченных комиссий пока нет.' : 'Все сделки первички отмечены.'}</div>
      ) : null}

      {items && items.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Сделка</th>
                <th>Компания и агент</th>
                <th>Стадия</th>
                <th>Ожидаемая комиссия</th>
                {received ? <th>Пришло</th> : null}
                {received ? <th>Куратору</th> : null}
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {items.map((deal) => (
                <tr key={deal.id}>
                  <td>
                    {deal.title}
                    <div className="referral-card__muted">создана {formatDateTime(deal.createdAt)}</div>
                  </td>
                  <td>
                    {deal.organizationName ?? '—'}
                    <div className="referral-card__muted">{deal.agentName ?? 'должность пуста'}</div>
                  </td>
                  <td>{STAGE_LABELS[deal.stage] ?? deal.stage}</td>
                  <td>{deal.expectedCommission ? formatMoney(deal.expectedCommission) : '—'}</td>
                  {received ? (
                    <td>
                      {deal.commissionReceived ? formatMoney(deal.commissionReceived) : '—'}
                      <div className="referral-card__muted">{formatDateTime(deal.commissionReceivedAt)}</div>
                    </td>
                  ) : null}
                  {received ? (
                    <td>
                      {deal.curatorAccrual ? (
                        <>
                          {formatMoney(deal.curatorAccrual.amount)}
                          <div className="referral-card__muted">
                            {deal.curatorAccrual.curator.name} · {deal.curatorAccrual.status === 'paid' ? 'выплачено' : 'к выплате'}
                          </div>
                        </>
                      ) : (
                        <span className="referral-card__muted">нет куратора</span>
                      )}
                    </td>
                  ) : null}
                  <td>
                    {received ? (
                      <button type="button" className="secondary" onClick={() => setDialog({ type: 'cancel', deal })}>
                        Снять отметку
                      </button>
                    ) : (
                      <button type="button" onClick={() => setDialog({ type: 'mark', deal })}>
                        Деньги пришли
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {dialog?.type === 'mark' ? (
        <MarkReceivedDialog
          deal={dialog.deal}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setNotice(message)
            void load()
          }}
        />
      ) : null}
      {dialog?.type === 'cancel' ? (
        <CancelReceivedDialog
          deal={dialog.deal}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setNotice(message)
            void load()
          }}
        />
      ) : null}
    </section>
  )
}

function MarkReceivedDialog({ deal, onCancel, onDone }: { deal: AdminCommissionDeal; onCancel: () => void; onDone: (message: string) => void }) {
  const expected = deal.expectedCommission
  const [amount, setAmount] = useState(expected ? (expected.amountMinorUnits / 100).toFixed(2) : '')
  const [currency, setCurrency] = useState<Currency>(expected?.currency ?? 'USD')
  const [receivedAt, setReceivedAt] = useState(toLocalInput(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const minor = parseMoneyInput(amount)

  async function submit() {
    if (minor === null) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await adminApi.markCommissionReceived(deal.id, {
        expectedVersion: deal.version,
        amount: { amountMinorUnits: minor, currency },
        receivedAt: new Date(receivedAt).toISOString(),
      })
      onDone(describeOutcome(deal, result.accrual))
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось сохранить отметку.'))
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="mark-received-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="mark-received-title">Комиссия пришла</h2>
        <p className="dialog-target">
          {deal.title} · {deal.organizationName ?? '—'} · {deal.agentName ?? '—'}
        </p>
        <p className="dialog-warning">
          Укажите сумму, которая фактически пришла BAZA. Если агент в команде куратора, куратору начислится 7% от неё.
        </p>
        <div className="money-fields">
          <div>
            <label htmlFor="mark-received-amount">Сумма</label>
            <input id="mark-received-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={submitting} />
          </div>
          <div>
            <label htmlFor="mark-received-currency">Валюта</label>
            <select id="mark-received-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} disabled={submitting}>
              <option value="USD">USD</option>
              <option value="GEL">GEL</option>
              <option value="RUB">RUB</option>
            </select>
          </div>
          <div>
            <label htmlFor="mark-received-at">Когда пришли</label>
            <input id="mark-received-at" type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} disabled={submitting} />
          </div>
        </div>
        {amount && minor === null ? <p className="dialog-error">Сумма — число больше нуля, до двух знаков после запятой.</p> : null}
        {minor !== null ? (
          <p className="referral-card__muted">Куратору, если он есть: {formatMoney({ amountMinorUnits: Math.round((minor * 7) / 100), currency })}</p>
        ) : null}
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
            Отмена
          </button>
          <button type="button" onClick={() => void submit()} disabled={submitting || minor === null}>
            {submitting ? 'Сохраняем…' : 'Отметить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CancelReceivedDialog({ deal, onCancel, onDone }: { deal: AdminCommissionDeal; onCancel: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await adminApi.cancelCommissionReceived(deal.id, { expectedVersion: deal.version, reason: reason.trim() })
      onDone(
        result.accrualReversed
          ? `«${deal.title}»: отметка снята, начисление куратору отменено.`
          : `«${deal.title}»: отметка снята.`,
      )
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось снять отметку.'))
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="cancel-received-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="cancel-received-title">Снять отметку о деньгах</h2>
        <p className="dialog-target">
          {deal.title} · {deal.commissionReceived ? formatMoney(deal.commissionReceived) : '—'}
        </p>
        <p className="dialog-warning">
          Начисление куратору по этой сделке будет отменено. Уже выплаченное отменяет только суперадмин.
        </p>
        <label htmlFor="cancel-received-reason">Причина (обязательно, не менее 3 символов)</label>
        <textarea id="cancel-received-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={submitting} />
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
            Отмена
          </button>
          <button type="button" className="danger" onClick={() => void submit()} disabled={submitting || reason.trim().length < 3}>
            {submitting ? 'Снимаем…' : 'Снять отметку'}
          </button>
        </div>
      </div>
    </div>
  )
}
