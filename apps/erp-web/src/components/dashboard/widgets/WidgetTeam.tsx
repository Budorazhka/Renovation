import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users2 } from 'lucide-react'
import { DeskShell, DeskHeader, DeskTab, MiniBar, DESK_HEADER_LINK_CLASS, REPORT_LINKS } from '../desk-shared'
/**
 * Ростер менеджеров берётся из LeadsContext: он строится из реестра команды
 * (`teamApi.list()`), а id менеджера — это `positionId`, тот же, что в
 * `lead.managerId`. Раньше здесь стоял справочник `INITIAL_LEAD_MANAGERS` из
 * `leads-mock.ts`: пока лиды жили в моках, их `managerId` ссылался на 'lm-1' и
 * подменить справочник было нельзя. Лиды переехали на Platform API вместе с
 * ростером, и выдуманные фамилии в рейтинге команды стали чистой ложью —
 * настоящие лиды не находили ни одного из этих менеджеров.
 */
import { useLeads } from '@/context/LeadsContext'
import type { Lead } from '@/types/leads'
import type { WidgetSlot } from '@/config/widgets-config'
import { useI18n } from "@/i18n";

type TeamTab = 'rating' | 'load' | 'conversion'

export function WidgetTeam({ leads, slot }: { leads: Lead[]; slot: WidgetSlot }) {
    const { t } = useI18n();
  const [tab, setTab] = useState<TeamTab>('rating')
  const { leadManagers: managers, isLoading } = useLeads()

  const stats = useMemo(() => {
    return managers.map((m) => {
      const mLeads = leads.filter((l) => l.managerId === m.id)
      const active = mLeads.filter((l) => l.status !== 'lost' && l.status !== 'postponed').length
      const problems = mLeads.filter((l) => l.taskOverdue || !l.hasTask).length
      const deals = mLeads.filter((l) => l.stageId === 'deal' || l.stageId === 'deposit').length
      const commission = mLeads.reduce((s, l) => s + (l.commissionUsd ?? 0), 0)
      const conversion = mLeads.length > 0 ? Math.round((deals / mLeads.length) * 100) : 0
      return { manager: m, total: mLeads.length, active, problems, deals, commission, conversion }
    })
  }, [leads, managers])

  const sorted = useMemo(() => {
    switch (tab) {
      case 'rating':     return [...stats].sort((a, b) => b.commission - a.commission)
      case 'load':       return [...stats].sort((a, b) => b.total - a.total)
      case 'conversion': return [...stats].sort((a, b) => b.conversion - a.conversion)
    }
  }, [stats, tab])

  const maxVal = useMemo(() => {
    switch (tab) {
      case 'rating':     return Math.max(1, ...sorted.map((s) => s.commission))
      case 'load':       return Math.max(1, ...sorted.map((s) => s.total))
      case 'conversion': return 100
    }
  }, [sorted, tab])

  // Пустой ростер — это либо ещё не пришедший ответ, либо организация, где
  // кроме собственника никого нет. Оба случая честнее сказать словами, чем
  // нарисовать рейтинг из нуля строк.
  if (stats.length === 0) {
    return (
      <DeskShell accent="#60a5fa" className="flex flex-col">
        <DeskHeader
          icon={<Users2 className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetTeam.команда')}
          accentColor="#60a5fa"
          layout="compact"
          right={<Link to={REPORT_LINKS.team} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetTeam.отч_т')}</Link>}
        />
        <p className="px-2.5 py-3 text-[13px] text-[color:var(--workspace-text-muted)]">
          {t(isLoading ? 'dashboard.widgets.shared.loading' : 'dashboard.widgets.shared.empty')}
        </p>
      </DeskShell>
    )
  }

  if (slot === 'med') {
    const top5 = [...stats].sort((a, b) => b.commission - a.commission).slice(0, 5)
    const maxComm = Math.max(1, ...top5.map((s) => s.commission))
    return (
      <DeskShell accent="#60a5fa" className="flex flex-col">
        <DeskHeader
          icon={<Users2 className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetTeam.команда')}
          accentColor="#60a5fa"
          layout="compact"
          right={<Link to={REPORT_LINKS.team} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetTeam.отч_т')}</Link>}
        />
        <div className="grid shrink-0 grid-cols-2 gap-1.5 p-2 pb-1.5">
          <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{t('dashboard.widgets.widgetTeam.в_команде')}</p>
            <p className="text-[17px] leading-none text-[color:var(--workspace-text)]">{stats.length}</p>
          </div>
          <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--workspace-text-dim)]">{t('dashboard.widgets.widgetTeam.активных_лидов')}</p>
            <p className="text-[17px] leading-none text-[color:var(--workspace-text)]">{stats.reduce((s, m) => s + m.active, 0)}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <ul className="space-y-1">
            {top5.map((s, i) => {
              const pct = Math.round((s.commission / maxComm) * 100)
              return (
                <li key={s.manager.id} className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2 py-1.5">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="size-4 shrink-0 rounded-full text-center text-[10px] leading-4"
                      style={{ background: i === 0 ? '#fbbf24' : '#1e293b', color: i === 0 ? '#422006' : '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      {i + 1}
                    </span>
                    <Link
                      to={REPORT_LINKS.team}
                      className="min-w-0 flex-1 truncate text-left text-[12px] text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--workspace-text)] hover:underline"
                    >
                      {s.manager.name}
                    </Link>
                    <span className="shrink-0 text-[11px] text-[#4ade80]">${(s.commission / 1000).toFixed(0)}k</span>
                  </div>
                  <MiniBar pct={pct} color={i === 0 ? '#fbbf24' : '#60a5fa'} />
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 px-0.5 text-[10px] leading-snug text-[color:var(--workspace-text-dim)]">
            {t('dashboard.widgets.widgetTeam.рейтинг_суммарная_ус')}</p>
        </div>
      </DeskShell>
    )
  }

  if (slot === 'small') {
    const top3 = [...stats].sort((a, b) => b.commission - a.commission).slice(0, 3)
    return (
      <DeskShell accent="#60a5fa" className="flex flex-col">
        <DeskHeader
          icon={<Users2 className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetTeam.команда')}
          accentColor="#60a5fa"
          right={<Link to={REPORT_LINKS.team} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetTeam.отч_т')}</Link>}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          <ul className="space-y-1">
            {top3.map((s, i) => (
              <li key={s.manager.id} className="flex items-center gap-2 rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-1.5">
                <span className="size-4 shrink-0 rounded-full text-center text-[10px] leading-4" style={{ background: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : '#b45309', color: '#fff' }}>{i + 1}</span>
                <Link
                  to={REPORT_LINKS.team}
                  className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--workspace-text)] hover:underline"
                >
                  {s.manager.name}
                </Link>
                <span className="shrink-0 text-[11px] text-[#4ade80]">${(s.commission / 1000).toFixed(0)}k</span>
              </li>
            ))}
          </ul>
        </div>
      </DeskShell>
    )
  }

  return (
    <DeskShell accent="#60a5fa" className="flex flex-col">
      <DeskHeader
        icon={<Users2 className="size-5" strokeWidth={2} />}
        title={t('dashboard.widgets.widgetTeam.команда')}
        accentColor="#60a5fa"
        right={<Link to={REPORT_LINKS.team} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetTeam.отч_т')}</Link>}
      />
      <div className="flex shrink-0 gap-1 border-b border-[color:var(--workspace-row-border)] px-2.5 py-1.5">
        <DeskTab variant="main" active={tab === 'rating'} onClick={() => setTab('rating')}>{t('dashboard.widgets.widgetTeam.рейтинг')}</DeskTab>
        <DeskTab variant="main" active={tab === 'load'} onClick={() => setTab('load')}>{t('dashboard.widgets.widgetTeam.загрузка')}</DeskTab>
        <DeskTab variant="main" active={tab === 'conversion'} onClick={() => setTab('conversion')}>{t('dashboard.widgets.widgetTeam.конверсия')}</DeskTab>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        <ul className="space-y-1.5">
          {sorted.map((s, i) => {
            const val = tab === 'rating' ? s.commission : tab === 'load' ? s.total : s.conversion
            const display = tab === 'rating' ? `$${(val / 1000).toFixed(0)}k` : tab === 'conversion' ? `${val}%` : String(val)
            const pct = Math.round((val / maxVal) * 100)
            const barColor = i === 0 ? '#fbbf24' : '#60a5fa'
            return (
              <li key={s.manager.id} className="rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="size-5 shrink-0 rounded-full text-center text-[10px] leading-5" style={{ background: i === 0 ? '#fbbf24' : '#1e293b', color: i === 0 ? '#422006' : '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}>
                    {i + 1}
                  </span>
                  <Link
                    to={REPORT_LINKS.team}
                    className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--theme-accent-link-dim)] hover:text-[color:var(--workspace-text)] hover:underline"
                  >
                    {s.manager.name}
                  </Link>
                  <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--workspace-text)]">{display}</span>
                </div>
                <MiniBar pct={pct} color={barColor} />
                {slot === 'big' && (
                  <div className="mt-1 flex gap-3 text-[10px] text-[color:var(--workspace-text-muted)]">
                    <span>{t('dashboard.widgets.widgetTeam.активных')}{s.active}</span>
                    <span>{t('dashboard.widgets.widgetTeam.проблемных')}{s.problems}</span>
                    <span>{t('dashboard.widgets.widgetTeam.сделок')}{s.deals}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 px-1 text-[10px] leading-snug text-[color:var(--workspace-text-dim)]">
          {t('dashboard.widgets.widgetTeam.сортировка_рейтинг_п')}</p>
      </div>
    </DeskShell>
  )
}
