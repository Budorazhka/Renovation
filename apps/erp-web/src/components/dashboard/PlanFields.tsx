import { useI18n } from '@/i18n'
import type { PlanCurrency } from '@/services/plansApiV2'
import { PLAN_COUNT_FIELDS, PLAN_CURRENCIES, type PlanDraft } from '@/lib/plan-draft'

const NUMBER_INPUT =
  'w-full rounded-sm border-0 bg-[var(--workspace-row-bg)] px-2 py-1.5 text-[16px] text-[color:var(--workspace-text)] shadow-[inset_0_-1px_0_var(--green-border)] outline-none focus:shadow-[inset_0_-1px_0_var(--gold)]'

/** Поля месячного плана: выручка с валютой и пять количественных целей. */
export function PlanFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: PlanDraft
  onChange: (next: PlanDraft) => void
  idPrefix: string
}) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label className="flex flex-col gap-1 sm:col-span-2" htmlFor={`${idPrefix}-revenue`}>
        <span className="text-[16px] text-[color:var(--workspace-text-muted)]">{t('plans.revenue')}</span>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-revenue`}
            type="number"
            min={0}
            value={draft.revenue}
            onChange={(e) => onChange({ ...draft, revenue: Math.max(0, Number(e.target.value) || 0) })}
            className={NUMBER_INPUT}
          />
          <select
            aria-label={t('plans.currency')}
            value={draft.currency}
            onChange={(e) => onChange({ ...draft, currency: e.target.value as PlanCurrency })}
            className="rounded-sm border-0 bg-[var(--workspace-row-bg)] px-2 text-[16px] text-[color:var(--workspace-text)]"
          >
            {PLAN_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
      </label>
      {PLAN_COUNT_FIELDS.map((field) => (
        <label key={field} className="flex flex-col gap-1" htmlFor={`${idPrefix}-${field}`}>
          <span className="text-[16px] text-[color:var(--workspace-text-muted)]">{t(`plans.${field}`)}</span>
          <input
            id={`${idPrefix}-${field}`}
            type="number"
            min={0}
            value={draft[field]}
            onChange={(e) => onChange({ ...draft, [field]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            className={NUMBER_INPUT}
          />
        </label>
      ))}
    </div>
  )
}
