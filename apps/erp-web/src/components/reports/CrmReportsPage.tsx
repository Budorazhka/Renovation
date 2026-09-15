import { useEffect, useMemo, useState } from 'react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useI18n } from '@/i18n'
import { crmReportsApi } from '@/services/crmReportsApi'
import { leadsApiV2 } from '@/services/leadsApiV2'
import { teamApi } from '@/services/teamApi'
import { mapLeadStageV2ToPokerId } from '@/lib/lead-v2-poker-adapter'
import {
  buildFunnelGroups,
  buildReportBuckets,
  CRM_REPORT_PERIODS,
  periodRange,
  type CrmReportPeriod,
  type FunnelColumn,
  type ReportBucket,
} from '@/lib/crm-reports'
import type { LeadFunnelStage, MoneyAmountSum, TeamPerformanceReportResponse } from '@/types/crmReports'
import type { LeadProductTypeV2, LeadStageDefinitionsV2Response } from '@/types/leadsV2'
import type { TeamUser } from '@/types/team'

const PRODUCTS: readonly LeadProductTypeV2[] = ['sales', 'network', 'owner', 'agent']

/** Ключи подписей продукта и стадий — те же, что у стола CRM (crmPoker.product.*, crmPoker.stages.*). */
const PRODUCT_I18N_KEY: Record<LeadProductTypeV2, 'RP' | 'Net' | 'Owner' | 'Agent'> = {
  sales: 'RP',
  network: 'Net',
  owner: 'Owner',
  agent: 'Agent',
}

const PERIOD_LABEL_KEY: Record<CrmReportPeriod, string> = {
  '7d': 'crmReports.period7',
  '30d': 'crmReports.period30',
  '90d': 'crmReports.period90',
  all: 'crmReports.periodAll',
}

const COLUMN_LABEL_KEY: Record<FunnelColumn, string> = {
  in_progress: 'crmReports.columnInProgress',
  success: 'crmReports.columnSuccess',
  rejection: 'crmReports.columnRejection',
}

const PANEL = 'rounded-md bg-[var(--green-card)] p-5 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]'
const MUTED = 'text-[color:var(--app-text-muted)]'

type LoadState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | {
      status: 'ready'
      report: TeamPerformanceReportResponse
      roster: TeamUser[]
      range: { from?: string; to?: string }
    }

const LOADING: LoadState = { status: 'loading' }

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  renderLabel,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  renderLabel: (option: T) => string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-sm bg-[var(--workspace-row-bg)] p-1">
      {options.map((option) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`rounded-sm px-3 py-1.5 text-[16px] font-medium transition-colors ${
              active
                ? 'bg-[var(--gold)] text-[color:var(--gold-btn-text)]'
                : 'text-[color:var(--app-text-muted)] hover:bg-[var(--hub-action-hover)] hover:text-[color:var(--app-text)]'
            }`}
          >
            {renderLabel(option)}
          </button>
        )
      })}
    </div>
  )
}

function StatTile({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className={PANEL}>
      <p className={`text-[16px] ${MUTED}`}>{label}</p>
      <p className="mt-2 text-[30px] font-normal leading-tight text-[color:var(--app-text)]">{value}</p>
      <p className={`mt-1 text-[16px] ${MUTED}`}>{meta}</p>
    </div>
  )
}

function SeriesChart({
  title,
  buckets,
  field,
  hovered,
  onHover,
  formatBucket,
}: {
  title: string
  buckets: ReportBucket[]
  field: 'leads' | 'deals' | 'completedTasks'
  hovered: number | null
  onHover: (index: number | null) => void
  formatBucket: (bucket: ReportBucket) => string
}) {
  const { t, formatNumber } = useI18n()
  const max = Math.max(1, ...buckets.map((bucket) => bucket[field]))
  const total = buckets.reduce((sum, bucket) => sum + bucket[field], 0)
  const active = hovered !== null ? buckets[hovered] : undefined

  return (
    <figure className={`${PANEL} flex min-w-0 flex-col gap-3`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[18px] font-medium text-[color:var(--app-text)]">{title}</span>
        <span className={`text-[16px] ${MUTED}`}>
          {active
            ? `${formatBucket(active)}: ${formatNumber(active[field])}`
            : t('crmReports.dynamicsTotal', { count: formatNumber(total) })}
        </span>
      </figcaption>
      <div className="flex h-32 items-end gap-[2px]" onMouseLeave={() => onHover(null)}>
        {buckets.map((bucket, index) => {
          const value = bucket[field]
          return (
            <div
              key={bucket.date}
              className={`flex h-full min-w-0 flex-1 items-end rounded-t-[2px] ${
                hovered === index ? 'bg-[var(--hub-action-hover)]' : ''
              }`}
              onMouseEnter={() => onHover(index)}
              title={`${formatBucket(bucket)}: ${formatNumber(value)}`}
            >
              <div
                className="w-full rounded-t-[2px] bg-[var(--gold)]"
                style={{ height: value > 0 ? `max(2px, ${(value / max) * 100}%)` : 0 }}
              />
            </div>
          )
        })}
      </div>
      {buckets.length > 0 ? (
        <div className={`flex justify-between gap-2 text-[16px] ${MUTED}`}>
          <span>{formatBucket(buckets[0])}</span>
          {buckets.length > 1 ? <span>{formatBucket(buckets[buckets.length - 1])}</span> : null}
        </div>
      ) : null}
    </figure>
  )
}

/**
 * «Аналитика» CRM — только отчёты сервера (GET /crm/reports/*, право crm_report.read):
 * сводка команды за период, воронка лидов по стадиям продукта, динамика по дням
 * и таблица по сотрудникам. Ничего не досчитывается и не подставляется на клиенте.
 */
export function CrmReportsPage() {
  const { t, formatDate, formatNumber } = useI18n()
  const [period, setPeriod] = useState<CrmReportPeriod>('30d')
  const [product, setProduct] = useState<LeadProductTypeV2>('sales')
  const [reloadKey, setReloadKey] = useState(0)
  const [definitions, setDefinitions] = useState<LeadStageDefinitionsV2Response | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  // Ответ хранится вместе с ключом своего запроса: пока ключ не совпал с текущим, экран в загрузке.
  const reportKey = `${period}:${reloadKey}`
  const funnelKey = `${period}:${product}:${reloadKey}`
  const [reportResult, setReportResult] = useState<{ key: string; state: LoadState } | null>(null)
  const [funnelResult, setFunnelResult] = useState<{ key: string; stages: LeadFunnelStage[] | null } | null>(null)
  const state: LoadState = reportResult?.key === reportKey ? reportResult.state : LOADING
  const funnel = funnelResult?.key === funnelKey ? funnelResult.stages : null
  const funnelFailed = funnelResult?.key === funnelKey && funnelResult.stages === null

  useEffect(() => {
    let cancelled = false
    leadsApiV2
      .getStageDefinitions()
      .then((defs) => {
        if (!cancelled) setDefinitions(defs)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const range = periodRange(period)
    Promise.all([crmReportsApi.getTeamPerformance(range), teamApi.list().catch((): TeamUser[] => [])])
      .then(([report, roster]) => {
        if (!cancelled) setReportResult({ key: reportKey, state: { status: 'ready', report, roster, range } })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setReportResult({ key: reportKey, state: { status: httpStatus(error) === 403 ? 'forbidden' : 'error' } })
        }
      })
    return () => {
      cancelled = true
    }
  }, [period, reportKey])

  useEffect(() => {
    let cancelled = false
    crmReportsApi
      .getLeadFunnel({ productType: product, ...periodRange(period) })
      .then((response) => {
        if (!cancelled) setFunnelResult({ key: funnelKey, stages: response.stages })
      })
      .catch(() => {
        if (!cancelled) setFunnelResult({ key: funnelKey, stages: null })
      })
    return () => {
      cancelled = true
    }
  }, [period, product, funnelKey])

  const series = useMemo(
    () => (state.status === 'ready' ? buildReportBuckets(state.report.timeseries, state.range) : null),
    [state],
  )

  const funnelGroups = useMemo(() => {
    if (!funnel) return []
    const productDefinitions =
      definitions?.[product] ??
      funnel.map((row, index) => ({ id: row.stage, name: row.stage, order: index, column: 'in_progress' as const }))
    return buildFunnelGroups(productDefinitions, funnel)
  }, [definitions, funnel, product])
  const funnelMax = Math.max(1, ...funnelGroups.flatMap((group) => group.rows.map((row) => row.leadCount)))
  const funnelTotal = funnelGroups.reduce((sum, group) => sum + group.rows.reduce((s, row) => s + row.leadCount, 0), 0)

  const rosterByPosition = useMemo(() => {
    const map = new Map<string, TeamUser>()
    if (state.status === 'ready') for (const user of state.roster) map.set(user.positionId ?? user.id, user)
    return map
  }, [state])

  const formatBucket = (bucket: ReportBucket) => {
    const label = formatDate(`${bucket.date}T00:00:00.000Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    return series?.weekly ? t('crmReports.weekOf', { date: label }) : label
  }

  const formatCommission = (sums: MoneyAmountSum[]) =>
    sums.length === 0
      ? '0'
      : sums
          .map((sum) =>
            formatNumber(sum.amountMinorUnits / 100, { style: 'currency', currency: sum.currency, maximumFractionDigits: 0 }),
          )
          .join(' · ')

  const stageLabel = (stageId: string, fallback: string) =>
    t(`crmPoker.stages.${PRODUCT_I18N_KEY[product]}.${mapLeadStageV2ToPokerId(stageId, product)}`, fallback)

  return (
    <DashboardShell>
      <div className="flex w-full flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[30px] font-normal leading-tight">{t('crmReports.title')}</h1>
            <p className={`mt-1 max-w-[70ch] text-[17px] ${MUTED}`}>{t('crmReports.subtitle')}</p>
          </div>
          <Segmented
            label={t('crmReports.period')}
            options={CRM_REPORT_PERIODS}
            value={period}
            onChange={(next) => {
              setPeriod(next)
              setHovered(null)
            }}
            renderLabel={(option) => t(PERIOD_LABEL_KEY[option])}
          />
        </header>

        {state.status === 'loading' ? <p className={`text-[17px] ${MUTED}`}>{t('common.loading')}</p> : null}

        {state.status === 'forbidden' ? (
          <section className={PANEL}>
            <h2 className="text-[24px] font-medium">{t('crmReports.noAccessTitle')}</h2>
            <p className={`mt-2 max-w-[70ch] text-[17px] ${MUTED}`}>{t('crmReports.noAccessText')}</p>
          </section>
        ) : null}

        {state.status === 'error' ? (
          <section className={`${PANEL} flex flex-wrap items-center justify-between gap-4`}>
            <p className="text-[17px]">{t('crmReports.loadFailed')}</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="rounded-sm bg-[var(--gold)] px-4 py-2 text-[16px] font-medium text-[color:var(--gold-btn-text)]"
            >
              {t('crmReports.retry')}
            </button>
          </section>
        ) : null}

        {state.status === 'ready' ? (
          <>
            <section
              aria-label={t('crmReports.summaryTitle')}
              className="grid grid-cols-3 gap-4 2xl:grid-cols-6"
            >
              <StatTile
                label={t('crmReports.summaryLeads')}
                value={formatNumber(state.report.summary.leadsTotal)}
                meta={t('crmReports.summaryLeadsMeta', { count: formatNumber(state.report.summary.leadsConverted) })}
              />
              <StatTile
                label={t('crmReports.summaryConversion')}
                value={`${formatNumber(state.report.summary.conversionRatePercent)}%`}
                meta={t('crmReports.summaryConversionMeta')}
              />
              <StatTile
                label={t('crmReports.summaryDeals')}
                value={formatNumber(state.report.summary.dealsTotal)}
                meta={t('crmReports.summaryDealsMeta', { count: formatNumber(state.report.summary.dealsWon) })}
              />
              <StatTile
                label={t('crmReports.summaryCommission')}
                value={formatCommission(state.report.summary.dealsCommission)}
                meta={t('crmReports.summaryCommissionMeta')}
              />
              <StatTile
                label={t('crmReports.summaryTasks')}
                value={formatNumber(state.report.summary.tasksTotal)}
                meta={t('crmReports.summaryTasksMeta', { count: formatNumber(state.report.summary.tasksCompleted) })}
              />
              <StatTile
                label={t('crmReports.summarySla')}
                value={state.report.summary.tasksCompleted > 0 ? `${formatNumber(state.report.summary.slaPercent)}%` : '—'}
                meta={t('crmReports.summarySlaMeta')}
              />
            </section>

            <section className={`${PANEL} flex flex-col gap-4`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-[24px] font-medium">{t('crmReports.funnelTitle')}</h2>
                  <p className={`mt-1 max-w-[70ch] text-[17px] ${MUTED}`}>{t('crmReports.funnelHint')}</p>
                </div>
                <Segmented
                  label={t('crmReports.product')}
                  options={PRODUCTS}
                  value={product}
                  onChange={setProduct}
                  renderLabel={(option) => t(`crmPoker.product.${PRODUCT_I18N_KEY[option]}`)}
                />
              </div>

              {funnelFailed ? <p className="text-[17px]">{t('crmReports.loadFailed')}</p> : null}
              {!funnel && !funnelFailed ? <p className={`text-[17px] ${MUTED}`}>{t('common.loading')}</p> : null}
              {funnel && funnelTotal === 0 ? <p className={`text-[17px] ${MUTED}`}>{t('crmReports.funnelEmpty')}</p> : null}

              {funnel && funnelTotal > 0
                ? funnelGroups.map((group) => (
                    <div key={group.column} className="flex flex-col gap-1">
                      <h3 className="text-[16px] font-medium uppercase tracking-[0.08em] text-[color:var(--theme-accent-heading)]">
                        {t(COLUMN_LABEL_KEY[group.column])}
                      </h3>
                      <ul className="flex flex-col">
                        {group.rows.map((row) => (
                          <li
                            key={row.stage.id}
                            className="grid items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-[var(--hub-action-hover)] [grid-template-columns:minmax(9rem,18rem)_1fr_3.5rem]"
                          >
                            <span className="truncate text-[17px]" title={stageLabel(row.stage.id, row.stage.name)}>
                              {stageLabel(row.stage.id, row.stage.name)}
                            </span>
                            <span className="h-3 overflow-hidden rounded-sm bg-[var(--hub-progress-track)]">
                              <span
                                className="block h-full rounded-sm bg-[var(--gold)]"
                                style={{ width: row.leadCount > 0 ? `max(4px, ${(row.leadCount / funnelMax) * 100}%)` : 0 }}
                              />
                            </span>
                            <span className="text-right text-[17px] tabular-nums">{formatNumber(row.leadCount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                : null}
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[24px] font-medium">
                {series?.weekly ? t('crmReports.dynamicsWeeklyTitle') : t('crmReports.dynamicsTitle')}
              </h2>
              {series && series.buckets.length > 0 ? (
                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                  <SeriesChart
                    title={t('crmReports.seriesLeads')}
                    buckets={series.buckets}
                    field="leads"
                    hovered={hovered}
                    onHover={setHovered}
                    formatBucket={formatBucket}
                  />
                  <SeriesChart
                    title={t('crmReports.seriesDeals')}
                    buckets={series.buckets}
                    field="deals"
                    hovered={hovered}
                    onHover={setHovered}
                    formatBucket={formatBucket}
                  />
                  <SeriesChart
                    title={t('crmReports.seriesTasks')}
                    buckets={series.buckets}
                    field="completedTasks"
                    hovered={hovered}
                    onHover={setHovered}
                    formatBucket={formatBucket}
                  />
                </div>
              ) : (
                <p className={`text-[17px] ${MUTED}`}>{t('crmReports.dynamicsEmpty')}</p>
              )}
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[24px] font-medium">{t('crmReports.teamTitle')}</h2>
              {state.report.positions.length === 0 ? (
                <p className={`text-[17px] ${MUTED}`}>{t('crmReports.teamEmpty')}</p>
              ) : (
                <div className="overflow-x-auto rounded-md shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-[var(--green-card-hover)]">
                      <tr>
                        {(
                          [
                            'colEmployee',
                            'colLeads',
                            'colInWork',
                            'colConverted',
                            'colLost',
                            'colConversion',
                            'colDeals',
                            'colCommission',
                            'colTasks',
                            'colOverdue',
                            'colSla',
                          ] as const
                        ).map((key, index) => (
                          <th
                            key={key}
                            scope="col"
                            className={`whitespace-nowrap px-3 py-3 text-[16px] font-medium uppercase tracking-[0.04em] text-[color:var(--theme-accent-heading)] ${
                              index === 0 ? '' : 'text-right'
                            }`}
                          >
                            {t(`crmReports.${key}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...state.report.positions]
                        .sort((a, b) => b.leadsAdded - a.leadsAdded || b.dealsTotal - a.dealsTotal)
                        .map((row, index) => {
                          const user = row.positionId ? rosterByPosition.get(row.positionId) : undefined
                          const name = row.positionId
                            ? (user?.name ?? t('crmReports.unknownPosition'))
                            : t('crmReports.unassigned')
                          return (
                            <tr
                              key={row.positionId ?? 'unassigned'}
                              className={`${index % 2 === 0 ? 'bg-[var(--workspace-row-bg)]' : 'bg-[var(--green-card)]'} hover:bg-[var(--green-card-hover)]`}
                            >
                              <th scope="row" className="px-3 py-3 font-normal">
                                <span className="block text-[18px] text-[color:var(--app-text)]">{name}</span>
                                {user?.position ? (
                                  <span className="block text-[17px] text-[color:var(--app-text-muted)]">{user.position}</span>
                                ) : null}
                              </th>
                              {[
                                formatNumber(row.leadsAdded),
                                formatNumber(row.leadsInWork),
                                formatNumber(row.leadsConverted),
                                formatNumber(row.leadsLost),
                                `${formatNumber(row.conversionRatePercent)}%`,
                                t('crmReports.dealsCell', { won: formatNumber(row.dealsWon), total: formatNumber(row.dealsTotal) }),
                                formatCommission(row.dealsCommission),
                                t('crmReports.tasksCell', {
                                  completed: formatNumber(row.tasksCompleted),
                                  total: formatNumber(row.tasksTotal),
                                }),
                                formatNumber(row.tasksOverdue),
                                row.tasksCompleted > 0 ? `${formatNumber(row.slaPercent)}%` : '—',
                              ].map((cell, cellIndex) => (
                                <td key={cellIndex} className="whitespace-nowrap px-3 py-3 text-right text-[18px] tabular-nums text-[color:var(--app-text)]">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </DashboardShell>
  )
}
