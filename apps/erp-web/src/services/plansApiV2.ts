import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Клиент планов сотрудников (apps/api/src/modules/plans).
 *
 * - GET /api/v1/plans?period=YYYY-MM
 * - PUT /api/v1/plans/:positionId/:period   (expectedVersion — если план уже есть)
 * - GET /api/v1/plans/progress?period=YYYY-MM&positionId=
 *
 * Руководитель видит и ставит планы всей организации, сотрудник — свой.
 */

export type PlanCurrency = 'USD' | 'GEL' | 'RUB'

export interface PlanTargetsV2 {
  revenueTargetMinorUnits: number
  currency: PlanCurrency
  leadsTarget: number
  dealsTarget: number
  callsTarget: number
  meetingsTarget: number
  showingsTarget: number
}

export interface PlanV2 extends PlanTargetsV2 {
  positionId: string
  period: string
  setByPositionId: string
  version: number
  updatedAt: string | null
}

export interface PlanActualsV2 {
  leads: number
  deals: number
  revenue: Array<{ currency: string; amountMinorUnits: number }>
  calls: number
  meetings: number
  showings: number
}

export interface PlanProgressPositionV2 {
  positionId: string
  plan: PlanV2 | null
  month: PlanActualsV2
  week: PlanActualsV2
  today: PlanActualsV2
}

export interface PlanProgressV2 {
  period: string
  workingDays: number
  workingDaysElapsed: number
  positions: PlanProgressPositionV2[]
  canManageTeam: boolean
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

/** Текущий месяц `YYYY-MM` в UTC — так же считает сервер. */
export function currentPlanPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

export const plansApiV2 = {
  async list(period: string): Promise<{ items: PlanV2[]; canManageTeam: boolean }> {
    const { data } = await api.get<{ items: PlanV2[]; canManageTeam: boolean }>('/api/v1/plans', { params: { period } })
    return data
  },

  async upsert(positionId: string, period: string, targets: PlanTargetsV2, expectedVersion?: number): Promise<PlanV2> {
    const { data } = await api.put<PlanV2>(
      `/api/v1/plans/${positionId}/${period}`,
      expectedVersion === undefined ? targets : { ...targets, expectedVersion },
    )
    return data
  },

  async progress(period: string, positionId?: string): Promise<PlanProgressV2> {
    const { data } = await api.get<PlanProgressV2>('/api/v1/plans/progress', {
      params: positionId ? { period, positionId } : { period },
    })
    return data
  },
}
