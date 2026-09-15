import type { LeadFunnelStage, TeamPerformanceTimeseriesPoint } from '@/types/crmReports'
import type { LeadStageDefinitionV2 } from '@/types/leadsV2'

export type CrmReportPeriod = '7d' | '30d' | '90d' | 'all'

export const CRM_REPORT_PERIODS: readonly CrmReportPeriod[] = ['7d', '30d', '90d', 'all']

const PERIOD_DAYS: Record<Exclude<CrmReportPeriod, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

const DAY_MS = 86_400_000

/** Сервер группирует динамику по дням UTC — длиннее этого числа дней столбики склеиваются по неделям. */
export const DAILY_BUCKET_LIMIT = 92

/** Параметры from/to запроса отчёта. Период «N дней» включает сегодняшний день; «всё время» — без границ. */
export function periodRange(period: CrmReportPeriod, now: Date = new Date()): { from?: string; to?: string } {
  if (period === 'all') return {}
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (PERIOD_DAYS[period] - 1) * DAY_MS)
  return { from: from.toISOString(), to: now.toISOString() }
}

export interface ReportBucket {
  /** YYYY-MM-DD первого дня корзины (UTC). */
  date: string
  leads: number
  deals: number
  completedTasks: number
}

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

/**
 * Непрерывный ряд по дням: сервер отдаёт только дни с событиями, пустые дни
 * добиваются нулями, чтобы ось времени не сжималась. Ряд длиннее
 * DAILY_BUCKET_LIMIT складывается в недели (с понедельника).
 */
export function buildReportBuckets(
  points: TeamPerformanceTimeseriesPoint[],
  range: { from?: string; to?: string },
): { buckets: ReportBucket[]; weekly: boolean } {
  const dated = points.filter((point) => Number.isFinite(dayStart(point.date)))
  const first = range.from ? dayStart(dayKey(Date.parse(range.from))) : Math.min(...dated.map((p) => dayStart(p.date)))
  const last = range.to ? dayStart(dayKey(Date.parse(range.to))) : Math.max(...dated.map((p) => dayStart(p.date)))
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return { buckets: [], weekly: false }

  const byDay = new Map(dated.map((point) => [point.date.slice(0, 10), point]))
  const days: ReportBucket[] = []
  for (let time = first; time <= last; time += DAY_MS) {
    const date = dayKey(time)
    const point = byDay.get(date)
    days.push({ date, leads: point?.leads ?? 0, deals: point?.deals ?? 0, completedTasks: point?.completedTasks ?? 0 })
  }
  if (days.length <= DAILY_BUCKET_LIMIT) return { buckets: days, weekly: false }

  const weeks = new Map<string, ReportBucket>()
  for (const day of days) {
    const time = dayStart(day.date)
    const weekday = (new Date(time).getUTCDay() + 6) % 7
    const week = dayKey(time - weekday * DAY_MS)
    const bucket = weeks.get(week) ?? { date: week, leads: 0, deals: 0, completedTasks: 0 }
    bucket.leads += day.leads
    bucket.deals += day.deals
    bucket.completedTasks += day.completedTasks
    weeks.set(week, bucket)
  }
  return { buckets: [...weeks.values()], weekly: true }
}

export type FunnelColumn = LeadStageDefinitionV2['column']

export interface FunnelGroup {
  column: FunnelColumn
  rows: Array<{ stage: LeadStageDefinitionV2; leadCount: number }>
}

const FUNNEL_COLUMN_ORDER: readonly FunnelColumn[] = ['in_progress', 'success', 'rejection']

/** Стадии продукта в порядке воронки с числом лидов (0 для стадий без событий), сгруппированные по колонкам стола. */
export function buildFunnelGroups(definitions: LeadStageDefinitionV2[], stages: LeadFunnelStage[]): FunnelGroup[] {
  const counts = new Map(stages.map((row) => [row.stage, row.leadCount]))
  return FUNNEL_COLUMN_ORDER.map((column) => ({
    column,
    rows: definitions
      .filter((stage) => stage.column === column)
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({ stage, leadCount: counts.get(stage.id) ?? 0 })),
  })).filter((group) => group.rows.length > 0)
}
