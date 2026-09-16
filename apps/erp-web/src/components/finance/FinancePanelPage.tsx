import { useMemo, useState } from 'react'
import { Briefcase, Filter, Wallet } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useDeals } from '@/context/DealsContext'
import { STAGE_LABELS, STAGE_ORDER, SUCCESS_DEAL_STAGE_SET, type DealStage, type DealType } from '@/types/deals'
import { useI18n } from "@/i18n";

const money = new Intl.NumberFormat('ru-RU')

const TYPE_LABEL: Record<DealType, string> = {
  primary: 'Первичка',
  secondary: 'Вторичка',
  rental: 'Аренда',
  assignment: 'Переуступка',
}

export default function FinancePanelPage() {
    const { t } = useI18n();
  const { deals } = useDeals()
  const [stage, setStage] = useState<'all' | DealStage>('all')
  const [type, setType] = useState<'all' | DealType>('all')

  const filtered = useMemo(() => {
    let rows = [...deals]
    if (stage !== 'all') rows = rows.filter((deal) => deal.stage === stage)
    if (type !== 'all') rows = rows.filter((deal) => deal.type === type)
    return rows
  }, [deals, stage, type])

  const kpi = useMemo(() => {
    const active = filtered.filter((deal) => !SUCCESS_DEAL_STAGE_SET.has(deal.stage)).length
    const completed = filtered.length - active
    const commission = filtered.reduce((sum, deal) => sum + deal.commission, 0)
    const volume = filtered.reduce((sum, deal) => sum + deal.price, 0)
    return { active, completed, commission, volume }
  }, [filtered])

  const latestDeals = useMemo(
    () => [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
    [filtered],
  )

  return (
    <DashboardShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <div>
            <h1 className="text-xl font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financePanelPage.сделки_и_комиссии')}</h1>
            <p className="mt-1 text-sm text-[color:var(--app-text-muted)]">
              {t('finance.financePanelPage.короткий_экран_по_те')}</p>
          </div>

          <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
            <div className="mb-3 flex items-center gap-2">
              <Filter className="size-4 text-[color:var(--gold)]" />
              <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financePanelPage.фильтры')}</h2>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as 'all' | DealStage)}
                className="rounded-md border border-[var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]"
              >
                <option value="all">{t('finance.financePanelPage.этап_все')}</option>
                {STAGE_ORDER.map((stageId) => (
                  <option key={stageId} value={stageId}>{STAGE_LABELS[stageId]}</option>
                ))}
              </select>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'all' | DealType)}
                className="rounded-md border border-[var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]"
              >
                <option value="all">{t('finance.financePanelPage.тип_все')}</option>
                <option value="primary">{TYPE_LABEL.primary}</option>
                <option value="secondary">{TYPE_LABEL.secondary}</option>
                <option value="rental">{TYPE_LABEL.rental}</option>
                <option value="assignment">{TYPE_LABEL.assignment}</option>
              </select>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('finance.financePanelPage.сделок')}</p>
              <p className="text-xl font-normal text-[color:var(--workspace-text)]">{filtered.length}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('finance.financePanelPage.активные')}</p>
              <p className="text-xl font-normal text-sky-300">{kpi.active}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('finance.financePanelPage.закрытые')}</p>
              <p className="text-xl font-normal text-emerald-300">{kpi.completed}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('finance.financePanelPage.комиссия')}</p>
              <p className="text-xl font-normal text-[color:var(--gold)]">{money.format(kpi.commission)} $</p>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
            <div className="mb-3 flex items-center gap-2">
              <Briefcase className="size-4 text-[color:var(--gold)]" />
              <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('finance.financePanelPage.ближайшие_сделки')}</h2>
            </div>
            <div className="space-y-2">
              {latestDeals.map((deal) => (
                <div key={deal.id} className="grid gap-2 rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2 text-sm md:grid-cols-[minmax(0,1.7fr)_140px_140px_140px] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-normal text-[color:var(--workspace-text)]">{deal.clientName}</p>
                    <p className="truncate text-xs text-[color:var(--workspace-text-muted)]">{deal.propertyAddress}</p>
                  </div>
                  <span className="text-[color:var(--workspace-text-muted)]">{STAGE_LABELS[deal.stage]}</span>
                  <span className="text-[color:var(--workspace-text)]">{money.format(deal.price)} $</span>
                  <span className="text-[color:var(--gold)]">{money.format(deal.commission)} $</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
            <p className="flex items-center gap-2 text-sm font-normal text-[color:var(--theme-accent-heading)]">
              <Wallet className="size-4 text-[color:var(--gold)]" />
              {t('finance.financePanelPage.объ_м_по_выборке')}</p>
            <p className="mt-2 text-sm text-[color:var(--workspace-text-muted)]">
              {t('finance.financePanelPage.сумма_объектов')}<span className="text-[color:var(--workspace-text)]">{money.format(kpi.volume)} $</span>{t('finance.financePanelPage.в_выборке_учитывают')}</p>
          </section>
        </div>
      </div>
    </DashboardShell>
  )
}
