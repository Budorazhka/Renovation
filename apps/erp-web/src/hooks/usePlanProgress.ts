import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useI18n } from '@/i18n'
import { currentPlanPeriod, plansApiV2, type PlanProgressV2 } from '@/services/plansApiV2'
import { buildHomeProgress, type HomeProgressMetrics } from '@/lib/plan-progress'

export type PlanProgressScope = 'self' | 'team'

/**
 * План и факт текущего месяца с сервера. `team` — руководитель видит сумму
 * по всей команде (сотруднику сервер отдаёт только его самого, так что для
 * него это то же, что `self`); `self` — только своя позиция.
 */
export function usePlanProgress(scope: PlanProgressScope = 'team') {
  const { t, formatNumber } = useI18n()
  const { currentUser } = useAuth()
  const [progress, setProgress] = useState<PlanProgressV2 | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const period = currentPlanPeriod()

  useEffect(() => {
    let cancelled = false
    plansApiV2
      .progress(period)
      .then((data) => {
        if (!cancelled) {
          setProgress(data)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [period, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const myPositionId = currentUser?.positionId ?? null

  const metrics: HomeProgressMetrics | null = useMemo(() => {
    if (!progress) return null
    const positionIds = scope === 'team' && progress.canManageTeam ? 'all' : myPositionId ? [myPositionId] : []
    return buildHomeProgress(
      progress,
      positionIds,
      {
        leads: t('planProgress.leads'),
        deals: t('planProgress.deals'),
        calls: t('planProgress.calls'),
        meetings: t('planProgress.meetings'),
        showings: t('planProgress.showings'),
        dealsSubtitle: (won, target) => t('planProgress.dealsSubtitle', { won, target }),
      },
      (amount, currency) =>
        formatNumber(amount, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }),
    )
  }, [formatNumber, myPositionId, progress, scope, t])

  return { period, progress, metrics, failed, reload, myPositionId, canManageTeam: progress?.canManageTeam ?? false }
}
