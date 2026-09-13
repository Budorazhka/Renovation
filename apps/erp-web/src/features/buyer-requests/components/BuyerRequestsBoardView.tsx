import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, ClipboardList, Phone, RefreshCw } from 'lucide-react'
import { buyerRequestsApi } from '@/services/buyerRequestsApi'
import type { BuyerRequestDealType, BuyerRequestResponseView, BuyerRequestView } from '@/types/buyerRequests'
import { formatCurrency } from '@/lib/format-currency'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return DATE_FMT.format(d)
}

/** Единая точка чтения ошибки axios — тот же паттерн, что leadsApiV2/LeadsInboxV2View. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response
    if (response?.data?.message) return response.data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export function BuyerRequestsBoardView() {
  const { t } = useI18n()
  const [items, setItems] = useState<BuyerRequestView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dealType, setDealType] = useState<BuyerRequestDealType | 'all'>('all')
  const [cityInput, setCityInput] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [reloadTrigger, setReloadTrigger] = useState(0)
  /** Растёт на каждое действие пользователя (фильтр/обновить), даже если значение фильтра не изменилось — иначе повторный клик по тому же фильтру не переоткрыл бы эффект и loading остался бы «залипшим». */
  const [fetchTrigger, setFetchTrigger] = useState(0)
  const [responses, setResponses] = useState<Map<string, BuyerRequestResponseView>>(new Map())
  const [revealedPhones, setRevealedPhones] = useState<Map<string, string>>(new Map())
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [openFormId, setOpenFormId] = useState<string | null>(null)

  useEffect(() => {
    let isSubscribed = true
    // Честная деградация: если свои отклики не подгрузились, доска всё равно
    // работает — только без пометки «уже откликнулись» на карточках.
    buyerRequestsApi
      .listAllMyResponses()
      .then((result) => {
        if (!isSubscribed) return
        setResponses(new Map(result.items.map((r) => [r.buyerRequestId, r])))
      })
      .catch(() => undefined)
    return () => {
      isSubscribed = false
    }
  }, [reloadTrigger])

  useEffect(() => {
    let isSubscribed = true
    const params = { dealType: dealType === 'all' ? undefined : dealType, city: cityFilter || undefined }

    buyerRequestsApi
      .listPublic(params)
      .then((response) => {
        if (!isSubscribed) return
        setItems(response.items)
        setNextCursor(response.nextCursor)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!isSubscribed) return
        setItems([])
        setNextCursor(null)
        setError(extractErrorMessage(err, 'Unknown error'))
        setLoading(false)
      })

    return () => {
      isSubscribed = false
    }
    // dealType/cityFilter умышленно не в списке зависимостей: они меняются в
    // том же батче, что и fetchTrigger (см. handleDealTypeSelect и др.),
    // поэтому эффект видит уже новые значения через замыкание при перерендере.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger, reloadTrigger])

  /** setLoading/setError сбрасываются здесь, в обработчиках, а не в теле эффекта выше (react-hooks/set-state-in-effect) — тот же паттерн, что handleStageSelect/handleRefresh в LeadsInboxV2View. fetchTrigger растёт всегда, даже если значение фильтра не изменилось (повторный клик по тому же фильтру), иначе эффект не переоткрылся бы и loading «залип» бы навсегда. */
  function handleDealTypeSelect(next: BuyerRequestDealType | 'all') {
    setLoading(true)
    setError(null)
    setDealType(next)
    setFetchTrigger((v) => v + 1)
  }

  function handleRefresh() {
    setLoading(true)
    setError(null)
    setReloadTrigger((v) => v + 1)
  }

  function handleCitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setCityFilter(cityInput.trim())
    setFetchTrigger((v) => v + 1)
  }

  function handleCityReset() {
    setLoading(true)
    setError(null)
    setCityInput('')
    setCityFilter('')
    setFetchTrigger((v) => v + 1)
  }

  function handleLoadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    const params = { dealType: dealType === 'all' ? undefined : dealType, city: cityFilter || undefined, cursor: nextCursor }
    buyerRequestsApi.listPublic(params).then(
      (response) => {
        setItems((prev) => [...prev, ...response.items])
        setNextCursor(response.nextCursor)
        setLoadingMore(false)
      },
      () => {
        // Ошибка подгрузки следующей страницы не должна стирать уже показанные карточки.
        setLoadingMore(false)
      },
    )
  }

  async function handleReveal(id: string) {
    setRevealingId(id)
    try {
      const result = await buyerRequestsApi.revealPhone(id)
      setRevealedPhones((prev) => new Map(prev).set(id, result.phone))
    } catch {
      // Тихо: телефон мог быть не заполнен в запросе, кнопка просто не даёт результата.
    } finally {
      setRevealingId(null)
    }
  }

  function handleResponded(id: string, response: BuyerRequestResponseView) {
    setResponses((prev) => new Map(prev).set(id, response))
    setOpenFormId(null)
  }

  const dealTypeTabs: Array<{ key: BuyerRequestDealType | 'all'; label: string }> = [
    { key: 'all', label: t('buyerRequests.filters.all') },
    { key: 'buy', label: t('buyerRequests.filters.buy') },
    { key: 'rent', label: t('buyerRequests.filters.rent') },
  ]

  return (
    <div className="min-h-full bg-[var(--app-bg)] px-5 py-6 font-[Montserrat,sans-serif] sm:px-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-medium tracking-tight text-[color:var(--app-text)]">
              {t('buyerRequests.title')}
            </h1>
            <span className="rounded-sm border border-[color:color-mix(in_srgb,var(--gold)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)] px-2.5 py-0.5 text-[16px] font-normal text-[color:var(--gold)]">
              {t('buyerRequests.total')}: {items.length}
            </span>
          </div>
          <p className="mt-1 text-[16px] font-normal text-[color:var(--app-text-muted)]">{t('buyerRequests.subtitle')}</p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-[color:color-mix(in_srgb,var(--gold)_50%,transparent)] bg-[color-mix(in_srgb,var(--gold)_14%,transparent)] px-4 py-2 text-[16px] font-medium text-[color:var(--app-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--gold)_22%,transparent)] disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          {t('buyerRequests.refresh')}
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t('buyerRequests.filters.dealTypeAria')}>
          {dealTypeTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={dealType === tab.key}
              onClick={() => handleDealTypeSelect(tab.key)}
              className={cn(
                'flex min-h-9 items-center rounded-sm border px-3.5 py-1.5 text-[16px] font-normal transition-colors',
                dealType === tab.key
                  ? 'border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] text-[color:var(--app-text)]'
                  : 'border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text-muted)] hover:bg-[var(--dropdown-hover)] hover:text-[color:var(--app-text)]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleCitySubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder={t('buyerRequests.filters.cityPlaceholder')}
            aria-label={t('buyerRequests.filters.cityLabel')}
            className="min-h-9 rounded-sm border border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-1.5 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
          />
          <button
            type="submit"
            className="min-h-9 rounded-sm border border-[var(--green-border)] bg-[var(--green-card)] px-3.5 py-1.5 text-[16px] font-normal text-[color:var(--app-text-muted)] transition-colors hover:bg-[var(--dropdown-hover)] hover:text-[color:var(--app-text)]"
          >
            {t('buyerRequests.filters.cityApply')}
          </button>
          {cityFilter ? (
            <button
              type="button"
              onClick={handleCityReset}
              className="min-h-9 rounded-sm px-3.5 py-1.5 text-[16px] font-normal text-[color:var(--app-text-muted)] transition-colors hover:text-[color:var(--app-text)]"
            >
              {t('buyerRequests.filters.cityReset')}
            </button>
          ) : null}
        </form>
      </div>

      <div className="overflow-hidden rounded-md border border-[var(--green-border)] bg-[var(--green-card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.14)]">
        {loading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center" data-testid="buyer-requests-loading">
            <div className="relative size-10">
              <span className="absolute inset-0 rounded-full border-2 border-[color:color-mix(in_srgb,var(--gold)_20%,transparent)]" />
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--gold)]" />
            </div>
            <p className="text-[16px] font-normal text-[color:var(--app-text-muted)]">{t('buyerRequests.loading')}</p>
          </div>
        ) : error ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center" data-testid="buyer-requests-error">
            <div className="flex size-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
              <AlertCircle className="size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-[18px] font-medium text-[color:var(--app-text)]">{t('buyerRequests.errorTitle')}</h2>
              <p className="max-w-md text-[16px] font-normal text-[color:var(--app-text-muted)]">{error}</p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex min-h-10 items-center justify-center rounded-sm border border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] px-5 py-2 text-[16px] font-medium text-[color:var(--app-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--gold)_30%,transparent)]"
            >
              {t('buyerRequests.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center" data-testid="buyer-requests-empty">
            <div className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--gold)_12%,transparent)] text-[color:var(--gold)]">
              <ClipboardList className="size-6" />
            </div>
            <p className="text-[16px] font-normal text-[color:var(--app-text-muted)]">
              {dealType === 'all' && !cityFilter ? t('buyerRequests.empty') : t('buyerRequests.emptyFiltered')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4" data-testid="buyer-requests-list">
            {items.map((item, idx) => (
              <BuyerRequestCard
                key={item.id}
                item={item}
                zebra={idx % 2 === 0}
                response={responses.get(item.id) ?? null}
                phone={revealedPhones.get(item.id) ?? null}
                revealing={revealingId === item.id}
                formOpen={openFormId === item.id}
                onReveal={() => void handleReveal(item.id)}
                onOpenForm={() => setOpenFormId(item.id)}
                onCloseForm={() => setOpenFormId(null)}
                onResponded={(response) => handleResponded(item.id, response)}
              />
            ))}
          </div>
        )}
      </div>

      {!loading && !error && nextCursor ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex min-h-10 items-center justify-center rounded-sm border border-[var(--green-border)] bg-[var(--green-card)] px-5 py-2 text-[16px] font-normal text-[color:var(--app-text-muted)] transition-colors hover:bg-[var(--dropdown-hover)] hover:text-[color:var(--app-text)] disabled:opacity-50"
          >
            {loadingMore ? t('buyerRequests.loadingMore') : t('buyerRequests.loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function budgetLabel(item: BuyerRequestView, t: (key: string, params?: Record<string, string | number>) => string): string {
  const amount = formatCurrency(item.budget.amount, item.budget.currency)
  return item.budget.perMonth ? t('buyerRequests.card.budgetPerMonth', { amount }) : t('buyerRequests.card.budgetTotal', { amount })
}

function BuyerRequestCard({
  item,
  zebra,
  response,
  phone,
  revealing,
  formOpen,
  onReveal,
  onOpenForm,
  onCloseForm,
  onResponded,
}: {
  item: BuyerRequestView
  zebra: boolean
  response: BuyerRequestResponseView | null
  phone: string | null
  revealing: boolean
  formOpen: boolean
  onReveal: () => void
  onOpenForm: () => void
  onCloseForm: () => void
  onResponded: (response: BuyerRequestResponseView) => void
}) {
  const { t } = useI18n()
  const zebraClass = zebra ? 'bg-[#072821]' : 'bg-[#112d1c]'

  return (
    <article className={cn('rounded-[6px] p-4 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.14)]', zebraClass)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="rounded-sm px-2 py-1 text-[16px] font-normal uppercase tracking-[0.08em]"
          style={{
            color: item.dealType === 'buy' ? 'var(--gold)' : 'var(--mint, #b4ccc3)',
            background: `color-mix(in srgb, ${item.dealType === 'buy' ? 'var(--gold)' : 'var(--mint, #b4ccc3)'} 13%, transparent)`,
          }}
        >
          {item.dealType === 'buy' ? t('buyerRequests.card.dealTypeBuy') : t('buyerRequests.card.dealTypeRent')}
        </span>
        <span className="text-[16px] font-normal text-[color:var(--app-text-muted)]">{formatDate(item.createdAt)}</span>
      </div>

      <h3 className="mt-2.5 text-[18px] font-medium text-[color:var(--app-text)]">{item.title}</h3>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[16px] font-normal text-[color:var(--app-text-muted)] sm:grid-cols-4">
        <span>{t('buyerRequests.card.city')}</span>
        <span className="text-[color:var(--app-text)]">{item.city}</span>
        <span>{t('buyerRequests.card.propertyKind')}</span>
        <span className="text-[color:var(--app-text)]">{item.propertyKind}</span>
        <span>{t('buyerRequests.card.budget')}</span>
        <span className="text-[color:var(--gold)]">{budgetLabel(item, t)}</span>
      </div>

      {item.comment ? <p className="mt-2.5 text-[16px] font-normal text-[color:var(--app-text-muted)]">{item.comment}</p> : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        {phone ? (
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            className="inline-flex items-center gap-2 rounded-sm border border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] px-3.5 py-1.5 text-[16px] font-medium text-[color:var(--app-text)]"
          >
            <Phone className="size-4" />
            {phone}
          </a>
        ) : (
          <button
            type="button"
            onClick={onReveal}
            disabled={revealing}
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--green-border)] bg-transparent px-3.5 py-1.5 text-[16px] font-normal text-[color:var(--app-text-muted)] transition-colors hover:text-[color:var(--app-text)] disabled:opacity-50"
          >
            <Phone className="size-4" />
            {revealing ? t('buyerRequests.card.revealing') : t('buyerRequests.card.revealPhone')}
          </button>
        )}

        {!formOpen ? (
          response ? (
            <button
              type="button"
              onClick={onOpenForm}
              className="inline-flex items-center rounded-sm border border-[var(--green-border)] bg-transparent px-3.5 py-1.5 text-[16px] font-normal text-[color:var(--mint,#b4ccc3)] transition-colors hover:text-[color:var(--app-text)]"
            >
              {t('buyerRequests.card.editResponse')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenForm}
              className="inline-flex items-center rounded-sm border border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] px-3.5 py-1.5 text-[16px] font-medium text-[color:var(--app-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--gold)_30%,transparent)]"
            >
              {t('buyerRequests.card.respond')}
            </button>
          )
        ) : null}
      </div>

      {response && !formOpen ? (
        <p className="mt-2.5 text-[16px] font-normal text-[color:var(--app-text-muted)]">
          {t('buyerRequests.card.respondedLabel', { date: formatDate(response.updatedAt) })}
          {': '}
          <span className="text-[color:var(--app-text)]">{response.message}</span>
        </p>
      ) : null}

      {formOpen ? (
        <ResponseForm
          buyerRequestId={item.id}
          initialMessage={response?.message ?? ''}
          onCancel={onCloseForm}
          onResponded={onResponded}
        />
      ) : null}
    </article>
  )
}

function ResponseForm({
  buyerRequestId,
  initialMessage,
  onCancel,
  onResponded,
}: {
  buyerRequestId: string
  initialMessage: string
  onCancel: () => void
  onResponded: (response: BuyerRequestResponseView) => void
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState(initialMessage)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await buyerRequestsApi.respond(buyerRequestId, message.trim())
      onResponded(result)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, t('buyerRequests.form.error')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3.5 flex flex-col gap-2.5 rounded-[6px] bg-[color:var(--workspace-row-bg)] p-3.5">
      <label htmlFor={`response-message-${buyerRequestId}`} className="text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--app-text-muted)]">
        {t('buyerRequests.form.messageLabel')}
      </label>
      <textarea
        id={`response-message-${buyerRequestId}`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('buyerRequests.form.messagePlaceholder')}
        required
        minLength={1}
        rows={3}
        disabled={submitting}
        className="rounded-sm border border-[var(--green-border)] bg-[rgba(3,29,22,0.5)] px-3 py-2 text-[16px] font-normal text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-muted)] focus:border-[color:var(--gold)]"
      />
      {error ? <p className="text-[16px] font-normal text-[color:var(--error,#ffb4ab)]">{error}</p> : null}
      <div className="flex items-center gap-2.5">
        <button
          type="submit"
          disabled={submitting || message.trim().length === 0}
          className="inline-flex min-h-9 items-center justify-center rounded-sm border border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] px-4 py-1.5 text-[16px] font-medium text-[color:var(--app-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--gold)_30%,transparent)] disabled:opacity-50"
        >
          {submitting ? t('buyerRequests.form.submitting') : t('buyerRequests.form.submit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex min-h-9 items-center justify-center px-3 text-[16px] font-normal text-[color:var(--app-text-muted)] transition-colors hover:text-[color:var(--app-text)]"
        >
          {t('buyerRequests.form.cancel')}
        </button>
      </div>
    </form>
  )
}
