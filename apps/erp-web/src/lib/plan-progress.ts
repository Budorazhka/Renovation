import type { PlanActualsV2, PlanProgressPositionV2, PlanProgressV2, PlanTargetsV2 } from '@/services/plansApiV2'

/** Показатели блока прогресса рабочего стола, «Моего отчёта» и виджета плана. */
export interface HomeProgressMetrics {
  /** Выставлен ли план: без него все проценты — ноль, а экран предлагает поставить план. */
  hasPlan: boolean
  /** Выручка (комиссия по выигранным сделкам): факт / план за месяц. */
  revenue: { currentLabel: string; planLabel: string; percent: number }
  /** Сделки: факт / план за месяц. */
  funnelProgress: { percent: number; subtitle: string }
  /** Лиды за сегодня и дневная норма (месячный план / рабочие дни). */
  leadsToday: { count: number; plan: number }
  /** Выполнение дневной и недельной нормы по активностям, %. */
  dayPlanPercent: number
  weekPlanPercent: number
  dayPlanStatus: 'done' | 'on_track' | 'at_risk'
  /** Активности за месяц: факт / план. */
  activityKpis: { label: string; current: number; plan: number }[]
  gamificationHint: string
}

export interface ProgressLabels {
  leads: string
  deals: string
  calls: string
  meetings: string
  showings: string
  /** Подпись под сделками, например «сделок {won} из {target}». */
  dealsSubtitle: (won: number, target: number) => string
}

const EMPTY: PlanActualsV2 = { leads: 0, deals: 0, revenue: [], calls: 0, meetings: 0, showings: 0 }
const DAY_MS = 86_400_000

function addActuals(a: PlanActualsV2, b: PlanActualsV2): PlanActualsV2 {
  const revenue = new Map<string, number>()
  for (const item of [...a.revenue, ...b.revenue]) revenue.set(item.currency, (revenue.get(item.currency) ?? 0) + item.amountMinorUnits)
  return {
    leads: a.leads + b.leads,
    deals: a.deals + b.deals,
    revenue: [...revenue].map(([currency, amountMinorUnits]) => ({ currency, amountMinorUnits })),
    calls: a.calls + b.calls,
    meetings: a.meetings + b.meetings,
    showings: a.showings + b.showings,
  }
}

/**
 * Сумма по позициям (команда руководителя). Выручка плана складывается
 * только в валюте первого плана — суммы в разных валютах без курса не
 * складываются.
 */
export function aggregateProgress(positions: PlanProgressPositionV2[]): {
  plan: PlanTargetsV2 | null
  month: PlanActualsV2
  week: PlanActualsV2
  today: PlanActualsV2
} {
  const plans = positions.map((position) => position.plan).filter((plan): plan is NonNullable<typeof plan> => plan !== null)
  const currency = plans[0]?.currency
  const plan: PlanTargetsV2 | null = plans.length
    ? plans.reduce<PlanTargetsV2>(
        (sum, p) => ({
          currency: sum.currency,
          revenueTargetMinorUnits: sum.revenueTargetMinorUnits + (p.currency === currency ? p.revenueTargetMinorUnits : 0),
          leadsTarget: sum.leadsTarget + p.leadsTarget,
          dealsTarget: sum.dealsTarget + p.dealsTarget,
          callsTarget: sum.callsTarget + p.callsTarget,
          meetingsTarget: sum.meetingsTarget + p.meetingsTarget,
          showingsTarget: sum.showingsTarget + p.showingsTarget,
        }),
        { currency: currency!, revenueTargetMinorUnits: 0, leadsTarget: 0, dealsTarget: 0, callsTarget: 0, meetingsTarget: 0, showingsTarget: 0 },
      )
    : null
  return {
    plan,
    month: positions.reduce((sum, p) => addActuals(sum, p.month), EMPTY),
    week: positions.reduce((sum, p) => addActuals(sum, p.week), EMPTY),
    today: positions.reduce((sum, p) => addActuals(sum, p.today), EMPTY),
  }
}

/** Рабочие дни текущей недели (пн–сегодня) внутри месяца периода, UTC. */
export function workingDaysThisWeek(period: string, now: Date): number {
  const [year, month] = period.split('-').map(Number) as [number, number]
  const monthStart = Date.UTC(year, month - 1, 1)
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const weekday = (new Date(dayStart).getUTCDay() + 6) % 7
  let count = 0
  for (let time = Math.max(dayStart - weekday * DAY_MS, monthStart); time <= dayStart; time += DAY_MS) {
    const d = new Date(time).getUTCDay()
    if (d !== 0 && d !== 6) count += 1
  }
  return count
}

function ratioPercent(current: number, plan: number): number {
  return plan > 0 ? Math.round((current / plan) * 100) : 0
}

/** Средняя доля выполнения норм по активностям (каждая не больше 100%), только по заданным целям. */
function paceOf(actual: PlanActualsV2, plan: PlanTargetsV2, days: number, workingDays: number): number {
  if (days <= 0 || workingDays <= 0) return 0
  const pairs: Array<[number, number]> = [
    [actual.leads, plan.leadsTarget],
    [actual.calls, plan.callsTarget],
    [actual.meetings, plan.meetingsTarget],
    [actual.showings, plan.showingsTarget],
  ].filter(([, target]) => target > 0) as Array<[number, number]>
  if (pairs.length === 0) return 0
  const share = pairs.reduce((sum, [current, target]) => sum + Math.min(1, current / ((target * days) / workingDays)), 0)
  return Math.round((share / pairs.length) * 100)
}

/**
 * План и факт → показатели экрана. `positionIds` — чьи позиции учитывать
 * (своя для сотрудника, все для руководителя); без плана — нули и
 * hasPlan:false.
 */
export function buildHomeProgress(
  progress: PlanProgressV2,
  positionIds: 'all' | string[],
  labels: ProgressLabels,
  formatMoney: (amount: number, currency: string) => string,
  now: Date = new Date(),
): HomeProgressMetrics {
  const scoped =
    positionIds === 'all' ? progress.positions : progress.positions.filter((p) => positionIds.includes(p.positionId))
  const { plan, month, week, today } = aggregateProgress(scoped)
  const target: PlanTargetsV2 = plan ?? {
    currency: 'USD',
    revenueTargetMinorUnits: 0,
    leadsTarget: 0,
    dealsTarget: 0,
    callsTarget: 0,
    meetingsTarget: 0,
    showingsTarget: 0,
  }
  const revenueMinor = month.revenue.find((item) => item.currency === target.currency)?.amountMinorUnits ?? 0
  const dayPlanPercent = plan ? paceOf(today, target, 1, progress.workingDays) : 0
  const weekPlanPercent = plan
    ? paceOf(week, target, workingDaysThisWeek(progress.period, now), progress.workingDays)
    : 0

  return {
    hasPlan: plan !== null,
    revenue: {
      currentLabel: formatMoney(revenueMinor / 100, target.currency),
      planLabel: formatMoney(target.revenueTargetMinorUnits / 100, target.currency),
      percent: ratioPercent(revenueMinor, target.revenueTargetMinorUnits),
    },
    funnelProgress: {
      percent: ratioPercent(month.deals, target.dealsTarget),
      subtitle: labels.dealsSubtitle(month.deals, target.dealsTarget),
    },
    leadsToday: {
      count: today.leads,
      plan: progress.workingDays > 0 ? Math.ceil(target.leadsTarget / progress.workingDays) : 0,
    },
    dayPlanPercent,
    weekPlanPercent,
    dayPlanStatus: dayPlanPercent >= 100 ? 'done' : dayPlanPercent >= 70 ? 'on_track' : 'at_risk',
    activityKpis: [
      { label: labels.leads, current: month.leads, plan: target.leadsTarget },
      { label: labels.deals, current: month.deals, plan: target.dealsTarget },
      { label: labels.calls, current: month.calls, plan: target.callsTarget },
      { label: labels.meetings, current: month.meetings, plan: target.meetingsTarget },
      { label: labels.showings, current: month.showings, plan: target.showingsTarget },
    ].filter((kpi) => kpi.plan > 0),
    gamificationHint: '',
  }
}

/** Пока план и факт не загрузились или план не выставлен — нули, без выдуманных цифр. */
export const EMPTY_HOME_PROGRESS: HomeProgressMetrics = {
  hasPlan: false,
  revenue: { currentLabel: '—', planLabel: '—', percent: 0 },
  funnelProgress: { percent: 0, subtitle: '' },
  leadsToday: { count: 0, plan: 0 },
  dayPlanPercent: 0,
  weekPlanPercent: 0,
  dayPlanStatus: 'at_risk',
  activityKpis: [],
  gamificationHint: '',
}
