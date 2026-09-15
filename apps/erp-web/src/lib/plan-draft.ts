import type { PlanCurrency, PlanTargetsV2, PlanV2 } from '@/services/plansApiV2'

/** Черновик формы плана: выручка в целых единицах валюты, как её вводит человек. */
export interface PlanDraft {
  revenue: number
  currency: PlanCurrency
  leadsTarget: number
  dealsTarget: number
  callsTarget: number
  meetingsTarget: number
  showingsTarget: number
}

export const PLAN_COUNT_FIELDS = ['leadsTarget', 'dealsTarget', 'callsTarget', 'meetingsTarget', 'showingsTarget'] as const
export const PLAN_CURRENCIES: readonly PlanCurrency[] = ['USD', 'GEL', 'RUB']

const EMPTY_DRAFT: PlanDraft = {
  revenue: 0,
  currency: 'USD',
  leadsTarget: 0,
  dealsTarget: 0,
  callsTarget: 0,
  meetingsTarget: 0,
  showingsTarget: 0,
}

export function toPlanDraft(plan: PlanV2 | undefined | null): PlanDraft {
  if (!plan) return EMPTY_DRAFT
  return {
    revenue: Math.round(plan.revenueTargetMinorUnits / 100),
    currency: plan.currency,
    leadsTarget: plan.leadsTarget,
    dealsTarget: plan.dealsTarget,
    callsTarget: plan.callsTarget,
    meetingsTarget: plan.meetingsTarget,
    showingsTarget: plan.showingsTarget,
  }
}

export function toPlanTargets(draft: PlanDraft): PlanTargetsV2 {
  return {
    revenueTargetMinorUnits: Math.round(draft.revenue * 100),
    currency: draft.currency,
    leadsTarget: draft.leadsTarget,
    dealsTarget: draft.dealsTarget,
    callsTarget: draft.callsTarget,
    meetingsTarget: draft.meetingsTarget,
    showingsTarget: draft.showingsTarget,
  }
}

/** Следующий месяц `YYYY-MM` — план часто ставят заранее. */
export function nextPlanPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number]
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}
