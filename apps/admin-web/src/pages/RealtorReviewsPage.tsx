import { FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi } from '../api/admin-api'
import { useAdminRealtorReviews } from '../hooks/useAdminRealtorReviews'
import { useConfirmReasonAction } from '../hooks/useConfirmReasonAction'
import { ConfirmReasonDialog } from '../components/ConfirmReasonDialog'
import { formatDateTime, realtorReviewStatusLabel } from '../lib/format'
import type { AdminRealtorReviewListItem, ModerateRealtorReviewResult, RealtorReviewStatus } from '../types/admin'

const REALTOR_REVIEW_STATUSES: RealtorReviewStatus[] = ['pending', 'approved', 'rejected']

function canModerate(item: AdminRealtorReviewListItem): boolean {
  return item.status === 'pending'
}

function readStatusFromUrl(value: string | null): RealtorReviewStatus | '' {
  return value && (REALTOR_REVIEW_STATUSES as string[]).includes(value) ? (value as RealtorReviewStatus) : ''
}

export function RealtorReviewsPage() {
  const [searchParams] = useSearchParams()
  const [statusInput, setStatusInput] = useState<RealtorReviewStatus | ''>(() =>
    readStatusFromUrl(searchParams.get('status')),
  )
  const [activeFilter, setActiveFilter] = useState<{ status?: RealtorReviewStatus }>(() => {
    const status = readStatusFromUrl(searchParams.get('status'))
    return status ? { status } : {}
  })

  const { state, loadMore, applyModerated } = useAdminRealtorReviews(activeFilter)

  // Бэкенд не возвращает reason в ответе на /moderate — прокидываем его через
  // результат submitAction, чтобы показать причину в таблице сразу, без ожидания рефетча.
  const approvedAction = useConfirmReasonAction<AdminRealtorReviewListItem, ModerateRealtorReviewResult & { reason: string }>(
    async (review, reason) => ({ ...(await adminApi.moderateRealtorReview(review.id, { decision: 'approved', reason })), reason }),
    (result) => {
      applyModerated({ id: result.id, status: result.status, moderationReason: result.reason })
    },
  )

  const rejectedAction = useConfirmReasonAction<AdminRealtorReviewListItem, ModerateRealtorReviewResult & { reason: string }>(
    async (review, reason) => ({ ...(await adminApi.moderateRealtorReview(review.id, { decision: 'rejected', reason })), reason }),
    (result) => {
      applyModerated({ id: result.id, status: result.status, moderationReason: result.reason })
    },
  )

  function submitFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActiveFilter({ status: statusInput || undefined })
  }

  function resetFilter() {
    setStatusInput('')
    setActiveFilter({})
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>Отзывы о риелторах</h1>
        <p className="page-caption">
          Одобренный отзыв становится виден на публичном профиле риелтора и учитывается в его рейтинге. Право
          review.moderate — глобальное, не привязано к городу.
        </p>
      </div>

      <form className="filter-bar" onSubmit={submitFilter}>
        <div className="filter-field">
          <label htmlFor="filter-review-status">Статус</label>
          <select
            id="filter-review-status"
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value as RealtorReviewStatus | '')}
          >
            <option value="">По умолчанию (ожидают проверки)</option>
            {REALTOR_REVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {realtorReviewStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Применить</button>
        {activeFilter.status ? (
          <button type="button" className="secondary" onClick={resetFilter}>
            Сбросить
          </button>
        ) : null}
      </form>

      {state.status === 'loading' ? <div className="state-panel">Загружаем отзывы…</div> : null}
      {state.status === 'error' ? (
        <div className="state-panel state-panel--error">
          <p>{state.message}</p>
          <button type="button" onClick={state.retry}>Повторить</button>
        </div>
      ) : null}
      {state.status === 'empty' ? <div className="state-panel">Отзывов по этому фильтру нет.</div> : null}

      {state.status === 'ready' ? (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Оценка</th>
                  <th>Текст отзыва</th>
                  <th>Риелтор (positionId)</th>
                  <th>Автор (identityId)</th>
                  <th>Сделка (dealId)</th>
                  <th>Статус</th>
                  <th>Подан</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.id}>
                    <td>{'★'.repeat(item.rating)}</td>
                    <td>{item.text}</td>
                    <td><code>{item.realtorPositionId}</code></td>
                    <td><code>{item.reviewerIdentityId}</code></td>
                    <td><code>{item.completedDealId}</code></td>
                    <td>
                      <span className={`status-pill status-pill--${item.status}`}>{realtorReviewStatusLabel(item.status)}</span>
                      {item.moderationReason ? <p className="unpublish-reason">Причина: {item.moderationReason}</p> : null}
                    </td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>
                      {canModerate(item) ? (
                        <div className="row-actions">
                          <button type="button" className="secondary" onClick={() => approvedAction.open(item)}>Одобрить</button>
                          <button type="button" className="danger" onClick={() => rejectedAction.open(item)}>Отклонить</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.nextCursor ? (
            <button className="load-more" type="button" onClick={loadMore} disabled={state.loadingMore}>
              {state.loadingMore ? 'Загружаем…' : 'Показать ещё'}
            </button>
          ) : null}
        </>
      ) : null}

      <ConfirmReasonDialog
        dialog={approvedAction.dialog}
        title="Одобрить отзыв?"
        renderTarget={(review) => `Оценка ${review.rating}/5 — риелтор ${review.realtorPositionId}`}
        warning="Отзыв станет виден на публичном профиле риелтора и войдёт в расчёт его рейтинга. Действие необратимо и фиксируется в аудите."
        confirmLabel="Одобрить"
        confirmingLabel="Сохраняем…"
        minReasonLength={approvedAction.minReasonLength}
        canSubmit={approvedAction.canSubmit}
        onReasonChange={approvedAction.setReason}
        onCancel={approvedAction.close}
        onConfirm={() => void approvedAction.submit()}
      />

      <ConfirmReasonDialog
        dialog={rejectedAction.dialog}
        title="Отклонить отзыв?"
        renderTarget={(review) => `Оценка ${review.rating}/5 — риелтор ${review.realtorPositionId}`}
        warning="Отзыв не будет опубликован и не войдёт в рейтинг риелтора. Действие необратимо и фиксируется в аудите."
        confirmLabel="Отклонить"
        confirmingLabel="Отклоняем…"
        minReasonLength={rejectedAction.minReasonLength}
        canSubmit={rejectedAction.canSubmit}
        onReasonChange={rejectedAction.setReason}
        onCancel={rejectedAction.close}
        onConfirm={() => void rejectedAction.submit()}
      />
    </section>
  )
}
