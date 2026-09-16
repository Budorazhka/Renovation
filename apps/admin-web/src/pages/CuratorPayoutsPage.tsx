import { useCallback, useEffect, useState } from 'react'
import { adminApi, AdminApiError } from '../api/admin-api'
import { formatDateTime } from '../lib/format'
import { accrualStatusLabel, formatMoney, formatMoneyList } from '../lib/referral-format'
import type { CuratorAccrualsResult, CuratorPayout } from '../types/referral'

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof AdminApiError && cause.code === 'ADMIN_SCOPE_INSUFFICIENT') return 'Недостаточно прав: нужен грант curator_payout.mark.'
  return cause instanceof AdminApiError ? cause.message : fallback
}

/**
 * Выплаты кураторам: сколько BAZA начислила, выплатила и должна каждому.
 * Сам перевод денег делает бухгалтерия BAZA вне системы — здесь его
 * отмечают, чтобы у куратора в кабинете сошлись «к выплате» и «выплачено».
 */
export function CuratorPayoutsPage() {
  const [items, setItems] = useState<CuratorPayout[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems((await adminApi.listCuratorPayouts()).items)
    } catch (cause) {
      setItems([])
      setError(errorMessage(cause, 'Не удалось загрузить выплаты.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="page">
      <div className="page-header">
        <h1>Выплаты кураторам</h1>
        <p className="page-caption">
          Начисления появляются, когда менеджер BAZA отмечает пришедшую комиссию по сделке первички. Переведите деньги
          куратору и отметьте выплату — в кабинете куратора сумма перейдёт из «к выплате» в «выплачено».
        </p>
      </div>

      {error ? <div className="state-panel state-panel--error">{error}</div> : null}
      {items === null ? <div className="state-panel">Загружаем кураторов…</div> : null}
      {items && items.length === 0 && !error ? <div className="state-panel">Кураторов пока нет.</div> : null}

      {items && items.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Куратор</th>
                <th>Начислено</th>
                <th>Выплачено</th>
                <th>К выплате</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {items.map((payout) => (
                <PayoutRow
                  key={payout.curator.identityId}
                  payout={payout}
                  open={openId === payout.curator.identityId}
                  onToggle={() => setOpenId(openId === payout.curator.identityId ? null : payout.curator.identityId)}
                  onChanged={() => void load()}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function PayoutRow({
  payout,
  open,
  onToggle,
  onChanged,
}: {
  payout: CuratorPayout
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  return (
    <>
      <tr>
        <td>
          {payout.curator.name}
          <div className="referral-card__muted">
            {payout.curator.login}
            {payout.inviteCode ? ` · код ${payout.inviteCode}` : ''}
          </div>
        </td>
        <td>{formatMoneyList(payout.totals.earned)}</td>
        <td>{formatMoneyList(payout.totals.paid)}</td>
        <td>
          <strong>{formatMoneyList(payout.totals.due)}</strong>
        </td>
        <td>
          <button type="button" className="secondary" aria-expanded={open} onClick={onToggle}>
            {open ? 'Скрыть' : 'Начисления'}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="payout-details">
          <td colSpan={5}>
            <AccrualsList curatorIdentityId={payout.curator.identityId} onChanged={onChanged} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function AccrualsList({ curatorIdentityId, onChanged }: { curatorIdentityId: string; onChanged: () => void }) {
  const [result, setResult] = useState<CuratorAccrualsResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adminApi
      .listCuratorAccruals(curatorIdentityId)
      .then((response) => {
        if (!cancelled) setResult(response)
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Не удалось загрузить начисления.'))
      })
    return () => {
      cancelled = true
    }
  }, [curatorIdentityId])

  if (error) return <p className="dialog-error">{error}</p>
  if (!result) return <p className="referral-card__muted">Загружаем начисления…</p>
  if (result.accruals.length === 0) return <p className="referral-card__muted">Начислений пока нет.</p>

  const payable = result.accruals.filter((accrual) => accrual.status === 'accrued')
  const chosen = payable.filter((accrual) => selected.has(accrual.id))
  const chosenTotals = new Map<string, number>()
  for (const accrual of chosen) {
    chosenTotals.set(accrual.amount.currency, (chosenTotals.get(accrual.amount.currency) ?? 0) + accrual.amount.amountMinorUnits)
  }

  async function pay() {
    setSubmitting(true)
    setError(null)
    try {
      const updated = await adminApi.markCuratorPaid(curatorIdentityId, chosen.map((accrual) => accrual.id))
      setResult(updated)
      setSelected(new Set())
      onChanged()
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось отметить выплату.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="accruals-list">
      <table className="data-table data-table--compact">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="Выбрать все к выплате"
                checked={payable.length > 0 && chosen.length === payable.length}
                onChange={(event) => setSelected(event.target.checked ? new Set(payable.map((a) => a.id)) : new Set())}
              />
            </th>
            <th>Агент</th>
            <th>Комиссия</th>
            <th>Куратору</th>
            <th>Начислено</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {result.accruals.map((accrual) => (
            <tr key={accrual.id} className={accrual.status === 'reversed' ? 'is-muted' : undefined}>
              <td>
                {accrual.status === 'accrued' ? (
                  <input
                    type="checkbox"
                    aria-label={`Выбрать начисление ${accrual.member.name}`}
                    checked={selected.has(accrual.id)}
                    onChange={(event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(accrual.id)
                      else next.delete(accrual.id)
                      setSelected(next)
                    }}
                  />
                ) : null}
              </td>
              <td>{accrual.member.name}</td>
              <td>
                {formatMoney(accrual.commission)} × {accrual.ratePercent}%
              </td>
              <td>{formatMoney(accrual.amount)}</td>
              <td>{formatDateTime(accrual.accruedAt)}</td>
              <td>
                {accrualStatusLabel(accrual.status)}
                {accrual.paidAt ? <div className="referral-card__muted">{formatDateTime(accrual.paidAt)}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="accruals-list__actions">
        <button type="button" onClick={() => void pay()} disabled={submitting || chosen.length === 0}>
          {submitting
            ? 'Отмечаем…'
            : chosen.length === 0
              ? 'Выберите начисления к выплате'
              : `Отметить выплату: ${[...chosenTotals.entries()]
                  .map(([currency, amountMinorUnits]) => formatMoney({ currency: currency as 'USD', amountMinorUnits }))
                  .join(' · ')}`}
        </button>
      </div>
    </div>
  )
}
