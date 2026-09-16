import { useMemo, useState } from 'react'
import { BarChart3, Briefcase, Filter, TrendingUp } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useDeals } from '@/context/DealsContext'
import { STAGE_LABELS, STAGE_ORDER, SUCCESS_DEAL_STAGE_SET, type Deal, type DealStage, type DealType } from '@/types/deals'
import { useI18n } from "@/i18n";

const money = new Intl.NumberFormat('ru-RU')

const TYPE_LABEL: Record<DealType, string> = {
  primary: 'Первичка',
  secondary: 'Вторичка',
  rental: 'Аренда',
  assignment: 'Переуступка',
}

function isInsidePeriod(deal: Deal, period: '30d' | '90d' | 'all') {
  if (period === 'all') return true
  const days = period === '30d' ? 30 : 90
  const updated = new Date(deal.updatedAt).getTime()
  if (Number.isNaN(updated)) return true
  return updated >= Date.now() - days * 24 * 60 * 60 * 1000
}

export default function FinanceReportPage() {
    const { t } = useI18n();
  const { deals } = useDeals()
  const [period, setPeriod] = useState<'30d' | '90d' | 'all'>('90d')
  const [stage, setStage] = useState<'all' | DealStage>('all')
  const [agent, setAgent] = useState<'all' | string>('all')

  const agentOptions = useMemo(() => Array.from(new Set(deals.map((deal) => deal.agentName))).sort(), [deals])

  const filtered = useMemo(() => {
    let rows = deals.filter((deal) => isInsidePeriod(deal, period))
    if (stage !== 'all') rows = rows.filter((deal) => deal.stage === stage)
    if (agent !== 'all') rows = rows.filter((deal) => deal.agentName === agent)
    return rows
  }, [agent, deals, period, stage])

  const kpi = useMemo(() => {
    const commission = filtered.reduce((sum, deal) => sum + deal.commission, 0)
    const volume = filtered.reduce((sum, deal) => sum + deal.price, 0)
    const completed = filtered.filter((deal) => SUCCESS_DEAL_STAGE_SET.has(deal.stage)).length
    const active = filtered.length - completed
    const avgCommission = filtered.length > 0 ? Math.round(commission / filtered.length) : 0
    return { commission, volume, completed, active, avgCommission }
  }, [filtered])

  const byAgent = useMemo(() => {
    const map = new Map<string, { agent: string; deals: number; commission: number }>()
    filtered.forEach((deal) => {
      const row = map.get(deal.agentName) ?? { agent: deal.agentName, deals: 0, commission: 0 }
      row.deals += 1
      row.commission += deal.commission
      map.set(deal.agentName, row)
    })
    return Array.from(map.values()).sort((a, b) => b.commission - a.commission)
  }, [filtered])

  const maxAgentCommission = Math.max(1, ...byAgent.map((row) => row.commission))

  return (
    <DashboardShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="w-full space-y-4">
          <div>
            <h1 className="text-xl font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financeReportPage.сделки')}</h1>
            <p className="mt-1 text-sm text-[color:var(--app-text-muted)]">
              {t('finance.financeReportPage.простая_сводка_по_сд')}</p>
          </div>

          <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
            <div className="mb-3 flex items-center gap-2">
              <Filter className="size-4 text-[color:var(--gold)]" />
              <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financeReportPage.фильтры')}</h2>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <select value={period} onChange={(e) => setPeriod(e.target.value as '30d' | '90d' | 'all')} className="rounded-md border border-[var(--hub-card-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]">
                <option value="30d">{t('finance.financeReportPage.период_30_дней')}</option>
                <option value="90d">{t('finance.financeReportPage.период_90_дней')}</option>
                <option value="all">{t('finance.financeReportPage.период_весь')}</option>
              </select>
              <select value={stage} onChange={(e) => setStage(e.target.value as 'all' | DealStage)} className="rounded-md border border-[var(--hub-card-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]">
                <option value="all">{t('finance.financeReportPage.этап_все')}</option>
                {STAGE_ORDER.map((stageId) => (
                  <option key={stageId} value={stageId}>{STAGE_LABELS[stageId]}</option>
                ))}
              </select>
              <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-md border border-[var(--hub-card-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]">
                <option value="all">{t('finance.financeReportPage.менеджер_все')}</option>
                {agentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase text-[color:var(--app-text-subtle)]">{t('finance.financeReportPage.сделок')}</p>
              <p className="text-xl font-normal text-[color:var(--workspace-text)]">{filtered.length}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase text-[color:var(--app-text-subtle)]">{t('finance.financeReportPage.в_работе')}</p>
              <p className="text-xl font-normal text-sky-300">{kpi.active}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase text-[color:var(--app-text-subtle)]">{t('finance.financeReportPage.закрытые')}</p>
              <p className="text-xl font-normal text-emerald-300">{kpi.completed}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase text-[color:var(--app-text-subtle)]">{t('finance.financeReportPage.комиссия')}</p>
              <p className="text-xl font-normal text-[color:var(--gold)]">{money.format(kpi.commission)} $</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase text-[color:var(--app-text-subtle)]">{t('finance.financeReportPage.средняя')}</p>
              <p className="text-xl font-normal text-[color:var(--workspace-text)]">{money.format(kpi.avgCommission)} $</p>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
            <div className="mb-3 flex items-center gap-2">
              <Briefcase className="size-4 text-[color:var(--gold)]" />
              <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financeReportPage.список_сделок')}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--workspace-row-border)] text-left text-[11px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">
                    <th className="px-2 py-2">{t('finance.financeReportPage.клиент_объект')}</th>
                    <th className="px-2 py-2">{t('finance.financeReportPage.этап')}</th>
                    <th className="px-2 py-2">{t('finance.financeReportPage.тип')}</th>
                    <th className="px-2 py-2">{t('finance.financeReportPage.менеджер')}</th>
                    <th className="px-2 py-2">{t('finance.financeReportPage.сумма')}</th>
                    <th className="px-2 py-2">{t('finance.financeReportPage.комиссия')}</th>
                    <th className="px-2 py-2">{t('finance.financeReportPage.обновлено')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((deal) => (
                    <tr key={deal.id} className="border-b border-[color:var(--workspace-row-border)]">
                      <td className="px-2 py-2">
                        <p className="font-normal text-[color:var(--workspace-text)]">{deal.clientName}</p>
                        <p className="mt-0.5 text-xs text-[color:var(--workspace-text-muted)]">{deal.propertyAddress}</p>
                      </td>
                      <td className="px-2 py-2 text-[color:var(--workspace-text)]">{STAGE_LABELS[deal.stage]}</td>
                      <td className="px-2 py-2 text-[color:var(--workspace-text-muted)]">{TYPE_LABEL[deal.type]}</td>
                      <td className="px-2 py-2 text-[color:var(--workspace-text-muted)]">{deal.agentName}</td>
                      <td className="px-2 py-2 text-[color:var(--workspace-text)]">{money.format(deal.price)} $</td>
                      <td className="px-2 py-2 text-[color:var(--gold)]">{money.format(deal.commission)} $</td>
                      <td className="px-2 py-2 text-[color:var(--workspace-text-muted)]">{deal.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <p className="mt-3 text-sm text-[color:var(--workspace-text-muted)]">{t('finance.financeReportPage.нет_сделок_по_выбран')}</p>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="size-4 text-[color:var(--gold)]" />
                <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financeReportPage.комиссия_по_менеджер')}</h2>
              </div>
              <div className="space-y-2">
                {byAgent.map((row) => (
                  <div key={row.agent}>
                    <div className="mb-1 flex items-center justify-between text-xs text-[color:var(--workspace-text-muted)]">
                      <span>{row.agent}</span>
                      <span>{row.deals} {t('finance.financeReportPage.сдел')}{money.format(row.commission)} $</span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(255,255,255,0.07)]">
                      <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${Math.round((row.commission / maxAgentCommission) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <BarChart3 className="size-4 text-[color:var(--gold)]" />
                <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financeReportPage.итого_по_выборке')}</h2>
              </div>
              <div className="space-y-3 text-sm text-[color:var(--workspace-text-muted)]">
                <p>{t('finance.financeReportPage.объ_м_сделок')}<span className="text-[color:var(--workspace-text)]">{money.format(kpi.volume)} $</span></p>
                <p>{t('finance.financeReportPage.комиссия_агентства')}<span className="text-[color:var(--gold)]">{money.format(kpi.commission)} $</span></p>
                <p>{t('finance.financeReportPage.в_выборке_учитываютс')}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DashboardShell>
  )
}
