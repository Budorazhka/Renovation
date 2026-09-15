import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ShieldAlert, TrendingUp } from 'lucide-react'
import { DESK_HEADER_LINK_CLASS, DeskHeader, DeskKpi, DeskShell, MiniBar, REPORT_LINKS } from '../desk-shared'
import { LEAD_STAGE_COLUMN } from '@/data/leads-mock'
import type { HomeProgressMetrics } from '@/lib/plan-progress'
import type { Deal } from '@/types/deals'
import type { Lead } from '@/types/leads'
import type { WidgetSlot } from '@/config/widgets-config'
import { useI18n } from "@/i18n";

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  return `$${Math.round(value / 1000)}k`
}

export function WidgetOwnerPulse({
  leads,
  deals,
  progress,
  slot,
}: {
  leads: Lead[]
  deals: Deal[]
  progress: HomeProgressMetrics
  slot: WidgetSlot
}) {
    const { t } = useI18n();
  const metrics = useMemo(() => {
    const activeLeads = leads.filter((lead) => LEAD_STAGE_COLUMN[lead.stageId] === 'in_progress')
    const successLeads = leads.filter((lead) => LEAD_STAGE_COLUMN[lead.stageId] === 'success')
    const leadRisk = leads.filter((lead) => lead.taskOverdue || !lead.hasTask || !lead.managerId).length
    const activeDeals = deals.filter((deal) => deal.stage !== 'deal')
    const dealRisk = deals.filter((deal) => deal.checklist.some((item) => item.required && !item.done)).length
    const pipelineCommission = activeDeals.reduce((sum, deal) => sum + deal.commission, 0)
    const closedCommission = deals
      .filter((deal) => deal.stage === 'deal')
      .reduce((sum, deal) => sum + deal.commission, 0)
    const conversion = leads.length > 0 ? Math.round((successLeads.length / leads.length) * 100) : 0
    const riskLoad = Math.min(100, Math.round(((leadRisk + dealRisk) / Math.max(1, leads.length + deals.length)) * 100))

    return {
      activeLeads: activeLeads.length,
      leadRisk,
      activeDeals: activeDeals.length,
      dealRisk,
      pipelineCommission,
      closedCommission,
      conversion,
      riskLoad,
    }
  }, [deals, leads])

  const compact = slot === 'small'

  return (
    <DeskShell accent="#22d3ee" className="flex flex-col">
      <DeskHeader
        icon={<Activity className="size-5" strokeWidth={2} />}
        title={t('dashboard.widgets.widgetOwnerPulse.пульс_бизнеса')}
        accentColor="#22d3ee"
        layout={compact ? 'compact' : 'comfort'}
        right={<Link to={REPORT_LINKS.manager} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetOwnerPulse.отч_т')}</Link>}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2.5 py-2">
        <div className="grid grid-cols-3 gap-1.5">
          <DeskKpi label={t('dashboard.widgets.widgetOwnerPulse.конверсия')} value={`${metrics.conversion}%`} color="#22d3ee" pct={metrics.conversion} />
          <DeskKpi label={t('dashboard.widgets.widgetOwnerPulse.план')} value={`${progress.weekPlanPercent}%`} color="#fbbf24" pct={progress.weekPlanPercent} />
          <DeskKpi label={t('dashboard.widgets.widgetOwnerPulse.риск')} value={`${metrics.riskLoad}%`} color={metrics.riskLoad > 18 ? '#fb7185' : '#4ade80'} pct={metrics.riskLoad} />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] gap-2">
          <div className="flex min-h-0 flex-col justify-between rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] font-normal uppercase tracking-wide text-[color:var(--workspace-text-dim)]">
              <TrendingUp className="size-4 text-[#4ade80]" strokeWidth={2} />
              {t('dashboard.widgets.widgetOwnerPulse.денежный_контур')}</div>
            <div className="mt-1.5 space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <span className="text-[12px] text-[color:var(--workspace-text-muted)]">{t('dashboard.widgets.widgetOwnerPulse.закрыто')}</span>
                <span className="text-[18px] leading-none text-[#4ade80]">{formatMoney(metrics.closedCommission)}</span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <span className="text-[12px] text-[color:var(--workspace-text-muted)]">{t('dashboard.widgets.widgetOwnerPulse.в_работе')}</span>
                <span className="text-[18px] leading-none text-[#fbbf24]">{formatMoney(metrics.pipelineCommission)}</span>
              </div>
            </div>
            <MiniBar pct={progress.revenue.percent} color="#4ade80" />
          </div>

          <div className="flex min-h-0 flex-col justify-between rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] font-normal uppercase tracking-wide text-[color:var(--workspace-text-dim)]">
              <ShieldAlert className="size-4 text-[#fb7185]" strokeWidth={2} />
              {t('dashboard.widgets.widgetOwnerPulse.контроль_рисков')}</div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <div>
                <p className="text-[22px] leading-none text-[#fb7185]">{metrics.leadRisk}</p>
                <p className="text-[11px] leading-tight text-[color:var(--workspace-text-muted)]">{t('dashboard.widgets.widgetOwnerPulse.лиды')}</p>
              </div>
              <div>
                <p className="text-[22px] leading-none text-[#fbbf24]">{metrics.dealRisk}</p>
                <p className="text-[11px] leading-tight text-[color:var(--workspace-text-muted)]">{t('dashboard.widgets.widgetOwnerPulse.сделки')}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--workspace-text-muted)]">
              <span>{metrics.activeLeads} {t('dashboard.widgets.widgetOwnerPulse.лидов_в_работе')}</span>
              <span>{metrics.activeDeals} {t('dashboard.widgets.widgetOwnerPulse.активных_сделок')}</span>
            </div>
          </div>
        </div>
      </div>
    </DeskShell>
  )
}
