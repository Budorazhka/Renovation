import { useMemo, useState } from 'react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useAuth } from '@/context/AuthContext'
import { useI18n } from '@/i18n'
import { usePlanProgress } from '@/hooks/usePlanProgress'
import { EMPTY_HOME_PROGRESS } from '@/lib/plan-progress'
import { plansApiV2, type PlanActualsV2 } from '@/services/plansApiV2'
import { PlanFields } from '@/components/dashboard/PlanFields'
import { toPlanDraft, toPlanTargets, type PlanDraft } from '@/lib/plan-draft'

const PANEL = 'rounded-md bg-[var(--hub-card-bg)] p-5 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]'
const MUTED = 'text-[color:var(--app-text-muted)]'

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-[var(--hub-progress-track)]">
      <div className="h-full rounded-sm bg-[var(--gold)]" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

type ActivityKey = 'leads' | 'deals' | 'calls' | 'meetings' | 'showings'
const ACTIVITY_ROWS: readonly ActivityKey[] = ['leads', 'deals', 'calls', 'meetings', 'showings']

/**
 * «Мой отчёт»: свой месячный план (ставит руководитель или сам сотрудник)
 * и факт за сегодня, неделю и месяц с сервера (/plans/progress). Раньше
 * здесь были мок-проценты, выдуманная история недели и серия дней.
 */
export function MyReportPage() {
  const { t, formatDate } = useI18n()
  const { currentUser } = useAuth()
  const { period, progress, metrics, failed, reload, myPositionId } = usePlanProgress('self')
  const p = metrics ?? EMPTY_HOME_PROGRESS
  const own = useMemo(
    () => progress?.positions.find((position) => position.positionId === myPositionId) ?? null,
    [myPositionId, progress],
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PlanDraft>(() => toPlanDraft(null))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const monthLabel = formatDate(`${period}-01T00:00:00.000Z`, { month: 'long', year: 'numeric', timeZone: 'UTC' })

  function startEditing() {
    setDraft(toPlanDraft(own?.plan))
    setMessage(null)
    setEditing(true)
  }

  async function saveOwnPlan() {
    if (!myPositionId) return
    setSaving(true)
    setMessage(null)
    try {
      await plansApiV2.upsert(myPositionId, period, toPlanTargets(draft), own?.plan?.version)
      setEditing(false)
      setMessage({ tone: 'ok', text: t('plans.saved') })
      reload()
    } catch {
      setMessage({ tone: 'error', text: t('plans.saveOwnFailed') })
    } finally {
      setSaving(false)
    }
  }

  const actualsFor = (bucket: PlanActualsV2 | undefined, key: ActivityKey) => bucket?.[key] ?? 0
  const targetFor = (key: ActivityKey) => (own?.plan ? own.plan[`${key}Target` as const] : 0)

  return (
    <DashboardShell>
      <div className="flex w-full flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[30px] font-normal leading-tight text-[color:var(--theme-accent-heading)]">{t('myReport.title')}</h1>
            <p className={`mt-1 text-[17px] ${MUTED}`}>
              {currentUser?.name ?? ''} · {monthLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : startEditing())}
            className="rounded-sm bg-[var(--gold)] px-4 py-2 text-[16px] font-medium text-[color:var(--gold-btn-text)]"
          >
            {editing ? t('plans.close') : own?.plan ? t('myReport.editPlan') : t('myReport.setOwnPlan')}
          </button>
        </header>

        {failed ? <p role="alert" className="text-[17px] text-[#ffb4ab]">{t('plans.loadFailed')}</p> : null}
        {message ? (
          <p role={message.tone === 'error' ? 'alert' : undefined} className={`text-[17px] ${message.tone === 'error' ? 'text-[#ffb4ab]' : MUTED}`}>
            {message.text}
          </p>
        ) : null}

        {editing ? (
          <section className={`${PANEL} flex flex-col gap-4`}>
            <div>
              <h2 className="text-[24px] font-medium">{t('myReport.ownPlanTitle')}</h2>
              <p className={`mt-1 text-[17px] ${MUTED}`}>{t('myReport.ownPlanHint')}</p>
            </div>
            <PlanFields idPrefix="own-plan" draft={draft} onChange={setDraft} />
            <div>
              <button
                type="button"
                onClick={() => void saveOwnPlan()}
                disabled={saving || !myPositionId}
                className="rounded-sm bg-[var(--gold)] px-4 py-2 text-[16px] font-medium text-[color:var(--gold-btn-text)] disabled:opacity-72"
              >
                {saving ? t('plans.saving') : t('plans.save')}
              </button>
            </div>
          </section>
        ) : null}

        {!p.hasPlan && !editing ? (
          <section className={PANEL}>
            <h2 className="text-[24px] font-medium">{t('planProgress.noPlan')}</h2>
            <p className={`mt-2 max-w-[70ch] text-[17px] ${MUTED}`}>{t('myReport.noPlanText')}</p>
          </section>
        ) : null}

        {p.hasPlan ? (
          <section aria-label={t('myReport.summary')} className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              { label: t('myReport.dayPlan'), value: `${p.dayPlanPercent}%`, pct: p.dayPlanPercent },
              { label: t('myReport.weekPlan'), value: `${p.weekPlanPercent}%`, pct: p.weekPlanPercent },
              { label: t('myReport.revenue'), value: `${p.revenue.currentLabel} / ${p.revenue.planLabel}`, pct: p.revenue.percent },
              { label: t('planProgress.deals'), value: p.funnelProgress.subtitle, pct: p.funnelProgress.percent },
            ].map((card) => (
              <div key={card.label} className={PANEL}>
                <p className={`text-[16px] ${MUTED}`}>{card.label}</p>
                <p className="mt-2 text-[24px] font-normal leading-tight">{card.value}</p>
                <div className="mt-3">
                  <Bar pct={card.pct} />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-[24px] font-medium">{t('myReport.activityTitle')}</h2>
          <div className="overflow-x-auto rounded-md shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]">
            <table className="w-full border-collapse text-left">
              <thead className="bg-[var(--green-card-hover)]">
                <tr>
                  {['activity', 'today', 'week', 'month', 'plan'].map((key, index) => (
                    <th
                      key={key}
                      scope="col"
                      className={`whitespace-nowrap px-4 py-3 text-[16px] font-medium uppercase tracking-[0.04em] text-[color:var(--theme-accent-heading)] ${index === 0 ? '' : 'text-right'}`}
                    >
                      {t(`myReport.col.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACTIVITY_ROWS.map((key, index) => {
                  const month = actualsFor(own?.month, key)
                  const target = targetFor(key)
                  return (
                    <tr key={key} className={index % 2 === 0 ? 'bg-[var(--workspace-row-bg)]' : 'bg-[var(--green-card)]'}>
                      <th scope="row" className="px-4 py-3 text-[18px] font-normal">{t(`planProgress.${key}`)}</th>
                      <td className="px-4 py-3 text-right text-[18px] tabular-nums">{actualsFor(own?.today, key)}</td>
                      <td className="px-4 py-3 text-right text-[18px] tabular-nums">{actualsFor(own?.week, key)}</td>
                      <td className="px-4 py-3 text-right text-[18px] tabular-nums">{month}</td>
                      <td className={`px-4 py-3 text-right text-[18px] tabular-nums ${MUTED}`}>
                        {target > 0 ? `${Math.round((month / target) * 100)}% · ${target}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className={`max-w-[70ch] text-[16px] ${MUTED}`}>{t('myReport.howCounted')}</p>
        </section>
      </div>
    </DashboardShell>
  )
}
