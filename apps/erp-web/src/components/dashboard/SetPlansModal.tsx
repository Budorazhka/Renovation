import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ClipboardList, Save } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PlanFields } from '@/components/dashboard/PlanFields'
import { teamApi } from '@/services/teamApi'
import { currentPlanPeriod, plansApiV2, type PlanV2 } from '@/services/plansApiV2'
import { nextPlanPeriod, toPlanDraft, toPlanTargets, type PlanDraft } from '@/lib/plan-draft'
import type { TeamUser } from '@/types/team'
import { useI18n } from '@/i18n'

interface SetPlansModalProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** План сохранён — рабочий стол перечитывает прогресс. */
  onSaved?: () => void
}

type Loaded =
  | { period: string; failed: false; team: TeamUser[]; plans: Map<string, PlanV2> }
  | { period: string; failed: true }

const positionOf = (user: TeamUser) => user.positionId ?? user.id

/**
 * Руководитель ставит месячные планы сотрудникам своей организации
 * (реестр команды и /plans). Раньше — вымышленные сотрудники и
 * localStorage браузера.
 */
export function SetPlansModal({ open, onOpenChange, onSaved }: SetPlansModalProps) {
  const { t } = useI18n()
  const thisMonth = currentPlanPeriod()
  const [period, setPeriod] = useState(thisMonth)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Черновики по ключу `${period}:${positionId}` — смена месяца не смешивает правки.
  const [drafts, setDrafts] = useState<Map<string, PlanDraft>>(new Map())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([teamApi.list(), plansApiV2.list(period)])
      .then(([users, list]) => {
        if (cancelled) return
        setLoaded({
          period,
          failed: false,
          team: users.filter((user) => !user.vacant && positionOf(user)),
          plans: new Map(list.items.map((plan) => [plan.positionId, plan])),
        })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ period, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [open, period])

  const current = loaded?.period === period ? loaded : null
  const team = current && !current.failed ? current.team : []
  const plans = useMemo(() => (current && !current.failed ? current.plans : new Map<string, PlanV2>()), [current])
  const draftKey = (positionId: string) => `${period}:${positionId}`
  const dirtyIds = useMemo(
    () => [...drafts.keys()].filter((key) => key.startsWith(`${period}:`)).map((key) => key.slice(period.length + 1)),
    [drafts, period],
  )

  async function save() {
    if (!current || current.failed || dirtyIds.length === 0) return
    setSaving(true)
    setMessage(null)
    const failedIds: string[] = []
    const saved = new Map(plans)
    for (const positionId of dirtyIds) {
      try {
        const plan = await plansApiV2.upsert(
          positionId,
          period,
          toPlanTargets(drafts.get(draftKey(positionId))!),
          plans.get(positionId)?.version,
        )
        saved.set(positionId, plan)
      } catch {
        failedIds.push(positionId)
      }
    }
    setLoaded({ ...current, plans: saved })
    // Несохранённые черновики остаются, чтобы не потерять введённое.
    setDrafts((prev) => new Map([...prev].filter(([key]) => !dirtyIds.some((id) => key === draftKey(id) && !failedIds.includes(id)))))
    setSaving(false)
    const failedNames = failedIds.map((id) => team.find((user) => positionOf(user) === id)?.name ?? id)
    setMessage(
      failedIds.length
        ? { tone: 'error', text: t('plans.saveFailed', { names: failedNames.join(', ') }) }
        : { tone: 'ok', text: t('plans.saved') },
    )
    if (failedIds.length < dirtyIds.length) onSaved?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(92vh,760px)] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-lg border-0 bg-[var(--workspace-card-bg)] p-0 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]"
      >
        <div className="flex shrink-0 items-center gap-3 px-5 py-4 pr-14">
          <div className="flex size-9 items-center justify-center rounded-sm bg-[color-mix(in_srgb,var(--gold)_18%,transparent)]">
            <ClipboardList className="size-5 text-[color:var(--gold)]" strokeWidth={2} />
          </div>
          <DialogHeader className="min-w-0">
            <DialogTitle className="text-[20px] font-medium text-[color:var(--workspace-text)]">{t('plans.teamTitle')}</DialogTitle>
            <DialogDescription className="text-[16px] text-[color:var(--workspace-text-muted)]">{t('plans.teamHint')}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex shrink-0 items-center gap-2 bg-[var(--workspace-row-bg)] px-5 py-3">
          <span className="text-[16px] text-[color:var(--workspace-text-muted)]">{t('plans.month')}</span>
          {[thisMonth, nextPlanPeriod(thisMonth)].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setPeriod(value)
                setMessage(null)
              }}
              aria-pressed={period === value}
              className={`rounded-sm px-3 py-1 text-[16px] ${period === value ? 'bg-[var(--gold)] text-[color:var(--gold-btn-text)]' : 'text-[color:var(--workspace-text-muted)] hover:text-[color:var(--workspace-text)]'}`}
            >
              {value === thisMonth ? t('plans.thisMonth') : t('plans.nextMonth')}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!current ? <p className="text-[16px] text-[color:var(--workspace-text-muted)]">{t('common.loading')}</p> : null}
          {current?.failed ? <p role="alert" className="text-[16px] text-[#ffb4ab]">{t('plans.loadFailed')}</p> : null}
          {current && !current.failed && team.length === 0 ? (
            <p className="text-[16px] text-[color:var(--workspace-text-muted)]">{t('plans.noTeam')}</p>
          ) : null}
          <div className="space-y-1.5">
            {team.map((user) => {
              const positionId = positionOf(user)
              const isOpen = expanded === positionId
              const draft = drafts.get(draftKey(positionId))
              return (
                <div key={positionId} className="overflow-hidden rounded-md bg-[var(--workspace-row-bg)]">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : positionId)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--hub-action-hover)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px] text-[color:var(--workspace-text)]">{user.name}</p>
                      <p className="truncate text-[16px] text-[color:var(--workspace-text-muted)]">
                        {user.position} · {plans.has(positionId) ? t('plans.hasPlan') : t('plans.noPlanYet')}
                        {draft ? ` · ${t('plans.unsaved')}` : ''}
                      </p>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="size-4 text-[color:var(--workspace-text-muted)]" />
                    ) : (
                      <ChevronDown className="size-4 text-[color:var(--workspace-text-muted)]" />
                    )}
                  </button>
                  {isOpen ? (
                    <div className="bg-[var(--workspace-card-bg)] px-3 py-3">
                      <PlanFields
                        idPrefix={`plan-${positionId}`}
                        draft={draft ?? toPlanDraft(plans.get(positionId))}
                        onChange={(next) => setDrafts((prev) => new Map(prev).set(draftKey(positionId), next))}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-[var(--workspace-row-bg)] px-5 py-3">
          <p
            role={message?.tone === 'error' ? 'alert' : undefined}
            className={`text-[16px] ${message?.tone === 'error' ? 'text-[#ffb4ab]' : 'text-[color:var(--workspace-text-muted)]'}`}
          >
            {message?.text ?? t('plans.visibleToEmployee')}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-[16px]">
              {t('plans.close')}
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || dirtyIds.length === 0}
              className="gap-1.5 bg-[var(--gold)] text-[16px] text-[color:var(--gold-btn-text)] hover:brightness-105"
            >
              <Save className="size-4" strokeWidth={2} />
              {saving ? t('plans.saving') : t('plans.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
