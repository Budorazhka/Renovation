import { Link } from 'react-router-dom'
import { Target } from 'lucide-react'
import { DeskShell, DeskHeader, MiniBar, DESK_HEADER_LINK_CLASS, REPORT_LINKS } from '../desk-shared'
import type { HomeProgressMetrics } from '@/lib/plan-progress'
import type { WidgetSlot } from '@/config/widgets-config'
import { cn } from '@/lib/utils'
import { useI18n } from "@/i18n";

function PlanGauge({ pct, color }: { pct: number; color: string }) {
    const { t } = useI18n();
  const p = Math.min(100, Math.max(0, pct))
  const arc = 113
  const angle = 180 - (p / 100) * 180
  const rad = (angle * Math.PI) / 180
  const cx = 50
  const cy = 52
  const needleLength = 28
  const nx = cx + needleLength * Math.cos(rad)
  const ny = cy - needleLength * Math.sin(rad)
  return (
    <div
      className="min-w-[7.75rem] rounded-lg border px-2.5 py-2"
      style={{ background: `${color}10`, borderColor: `${color}33` }}
      aria-label={`План дня: ${p}%`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{t('dashboard.widgets.widgetPlan.выполнение')}</span>
        <span className="text-[14px] font-normal leading-none" style={{ color }}>{p}%</span>
      </div>
      <svg viewBox="0 0 100 58" className="mt-1 h-12 w-full" aria-hidden>
        <path
          d="M 14 52 A 36 36 0 0 1 86 52"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M 14 52 A 36 36 0 0 1 86 52"
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * arc} ${arc}`}
        />
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="3.5" fill="var(--workspace-card-bg)" stroke={color} strokeWidth="1.5" />
      </svg>
    </div>
  )
}

export function WidgetPlan({ progress, slot }: { progress: HomeProgressMetrics; slot: WidgetSlot }) {
    const { t } = useI18n();
  const planRisk = progress.dayPlanPercent < 70

  if (slot === 'small') {
    return (
      <DeskShell
        accent="#fb923c"
        className={cn('flex flex-col', planRisk && 'ring-1 ring-amber-500/35')}
      >
        <DeskHeader
          icon={<Target className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetPlan.план')}
          accentColor="#fb923c"
          layout="compact"
          right={<Link to={REPORT_LINKS.personal} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetPlan.отч_т')}</Link>}
        />
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 px-3 py-2.5">
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{t('dashboard.widgets.widgetPlan.дневной_план')}</p>
              <p className="mt-1 text-[34px] font-light leading-none text-[#fb923c]">{progress.dayPlanPercent}%</p>
            </div>
            <PlanGauge pct={progress.dayPlanPercent} color="#fb923c" />
          </div>
          <div className="space-y-1.5">
            {[
              { label: 'Неделя', pct: progress.weekPlanPercent, value: `${progress.weekPlanPercent}%`, color: '#60a5fa' },
              { label: 'Выручка', pct: progress.revenue.percent, value: progress.revenue.currentLabel, color: '#4ade80' },
              { label: 'Лиды', pct: progress.leadsToday.plan > 0 ? (progress.leadsToday.count / progress.leadsToday.plan) * 100 : 0, value: `${progress.leadsToday.count}/${progress.leadsToday.plan}`, color: '#a78bfa' },
            ].map((row) => (
              <div key={row.label} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2">
                <span className="text-[11px] text-[color:var(--workspace-text-muted)]">{row.label}</span>
                <MiniBar pct={row.pct} color={row.color} />
                <span className="text-right text-[12px] tabular-nums text-[color:var(--workspace-text)]">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </DeskShell>
    )
  }

  if (slot === 'med') {
    return (
      <DeskShell accent="#fb923c" className={cn('flex flex-col', planRisk && 'ring-1 ring-amber-500/35')}>
        <DeskHeader
          icon={<Target className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetPlan.план_и_результат')}
          accentColor="#fb923c"
          layout="compact"
          right={<Link to={REPORT_LINKS.personal} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetPlan.отч_т')}</Link>}
        />
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">
                <span>{t('dashboard.widgets.widgetPlan.день')}</span>
                <span className="text-[15px] text-[color:var(--workspace-text)]">{progress.dayPlanPercent}%</span>
              </div>
              <PlanGauge pct={progress.dayPlanPercent} color="#fb923c" />
            </div>
            <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">
                <span>{t('dashboard.widgets.widgetPlan.неделя')}</span>
                <span className="text-[15px] text-[color:var(--workspace-text)]">{progress.weekPlanPercent}%</span>
              </div>
              <div className="mt-3"><MiniBar pct={progress.weekPlanPercent} color="#60a5fa" /></div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: 'Выручка', value: progress.revenue.currentLabel, sub: `/ ${progress.revenue.planLabel}`, pct: progress.revenue.percent, color: 'var(--gold)' },
              { label: 'Воронка', value: `${progress.funnelProgress.percent}%`, pct: progress.funnelProgress.percent, color: '#34d399' },
              { label: 'Лиды', value: `${progress.leadsToday.count}`, sub: `/ ${progress.leadsToday.plan}`, pct: progress.leadsToday.plan > 0 ? (progress.leadsToday.count / progress.leadsToday.plan) * 100 : 0, color: '#60a5fa' },
            ].map((m) => (
              <div key={m.label} className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{m.label}</p>
                <p className="text-[14px] leading-none text-[color:var(--workspace-text)]">
                  {m.value}
                  {m.sub && <span className="ml-1 text-[9px] text-[color:var(--workspace-text-muted)]">{m.sub}</span>}
                </p>
                <div className="mt-1"><MiniBar pct={m.pct} color={m.color} /></div>
              </div>
            ))}
          </div>
        </div>
      </DeskShell>
    )
  }

  return (
    <DeskShell accent="#fb923c" className={cn('flex flex-col', planRisk && 'ring-1 ring-amber-500/35')}>
      <DeskHeader
        icon={<Target className="size-5" strokeWidth={2} />}
        title={t('dashboard.widgets.widgetPlan.план_и_результат')}
        accentColor="#fb923c"
        right={<Link to={REPORT_LINKS.personal} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetPlan.отч_т')}</Link>}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">
              <span>{t('dashboard.widgets.widgetPlan.день')}</span>
              <span className="text-[15px] text-[color:var(--workspace-text)]">{progress.dayPlanPercent}%</span>
            </div>
            <PlanGauge pct={progress.dayPlanPercent} color="#fb923c" />
          </div>
          <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">
              <span>{t('dashboard.widgets.widgetPlan.неделя')}</span>
              <span className="text-[15px] text-[color:var(--workspace-text)]">{progress.weekPlanPercent}%</span>
            </div>
            <div className="mt-3"><MiniBar pct={progress.weekPlanPercent} color="#60a5fa" /></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: 'Выручка', value: progress.revenue.currentLabel, sub: `/ ${progress.revenue.planLabel}`, pct: progress.revenue.percent, color: 'var(--gold)' },
            { label: 'Воронка', value: `${progress.funnelProgress.percent}%`, pct: progress.funnelProgress.percent, color: '#34d399' },
            { label: 'Лиды',    value: `${progress.leadsToday.count}`, sub: `/ ${progress.leadsToday.plan}`, pct: progress.leadsToday.plan > 0 ? (progress.leadsToday.count / progress.leadsToday.plan) * 100 : 0, color: '#60a5fa' },
          ].map((m) => (
            <div key={m.label} className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{m.label}</p>
              <p className="text-[16px] leading-none text-[color:var(--workspace-text)]">
                {m.value}
                {m.sub && <span className="ml-1 text-[9px] text-[color:var(--workspace-text-muted)]">{m.sub}</span>}
              </p>
              <div className="mt-1"><MiniBar pct={m.pct} color={m.color} /></div>
            </div>
          ))}
        </div>
        {slot === 'big' && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{t('dashboard.widgets.widgetPlan.активности')}</p>
            <ul className="space-y-1">
              {progress.activityKpis.map((kpi) => {
                const pct = kpi.plan > 0 ? (kpi.current / kpi.plan) * 100 : 0
                return (
                  <li key={kpi.label} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <div>
                      <p className="text-[12px] text-[color:var(--workspace-text)]">{kpi.label}</p>
                      <MiniBar pct={pct} color={pct >= 100 ? '#4ade80' : pct >= 70 ? '#fbbf24' : '#f87171'} />
                    </div>
                    <span className="text-[11px] tabular-nums text-[color:var(--workspace-text-muted)]">{kpi.current}/{kpi.plan}</span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </DeskShell>
  )
}
