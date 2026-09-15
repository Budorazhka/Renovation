/** @vitest-environment jsdom */

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateProgress, buildHomeProgress, workingDaysThisWeek } from '@/lib/plan-progress'
import type { PlanProgressV2, PlanV2 } from '@/services/plansApiV2'

const labels = {
  leads: 'Лиды',
  deals: 'Сделки',
  calls: 'Звонки',
  meetings: 'Встречи',
  showings: 'Показы',
  dealsSubtitle: (won: number, target: number) => `сделок ${won} из ${target}`,
}
const money = (amount: number, currency: string) => `${amount} ${currency}`

function plan(positionId: string, overrides: Partial<PlanV2> = {}): PlanV2 {
  return {
    positionId,
    period: '2026-09',
    revenueTargetMinorUnits: 1_000_000,
    currency: 'USD',
    leadsTarget: 22,
    dealsTarget: 2,
    callsTarget: 44,
    meetingsTarget: 0,
    showingsTarget: 0,
    setByPositionId: positionId,
    version: 0,
    updatedAt: null,
    ...overrides,
  }
}

const actuals = (o: Partial<PlanProgressV2['positions'][number]['month']> = {}) => ({
  leads: 0,
  deals: 0,
  revenue: [],
  calls: 0,
  meetings: 0,
  showings: 0,
  ...o,
})

function progress(positions: PlanProgressV2['positions']): PlanProgressV2 {
  return { period: '2026-09', workingDays: 22, workingDaysElapsed: 11, positions, canManageTeam: true }
}

describe('buildHomeProgress — план и факт на экран', () => {
  it('без плана — нули и hasPlan:false, без выдуманных цифр', () => {
    const result = buildHomeProgress(progress([{ positionId: 'p1', plan: null, month: actuals({ leads: 3 }), week: actuals(), today: actuals() }]), ['p1'], labels, money)
    expect(result.hasPlan).toBe(false)
    expect(result.dayPlanPercent).toBe(0)
    expect(result.activityKpis).toEqual([])
    expect(result.revenue.percent).toBe(0)
  })

  it('выручка, сделки, дневная норма лидов и выполнение дня', () => {
    const result = buildHomeProgress(
      progress([
        {
          positionId: 'p1',
          plan: plan('p1'),
          month: actuals({ leads: 10, deals: 1, calls: 20, revenue: [{ currency: 'USD', amountMinorUnits: 250_000 }] }),
          week: actuals(),
          // дневная норма: лиды 22/22 = 1, звонки 44/22 = 2
          today: actuals({ leads: 1, calls: 1 }),
        },
      ]),
      ['p1'],
      labels,
      money,
      new Date('2026-09-15T10:00:00.000Z'),
    )
    expect(result.hasPlan).toBe(true)
    expect(result.revenue).toEqual({ currentLabel: '2500 USD', planLabel: '10000 USD', percent: 25 })
    expect(result.funnelProgress).toEqual({ percent: 50, subtitle: 'сделок 1 из 2' })
    expect(result.leadsToday).toEqual({ count: 1, plan: 1 })
    // (100% по лидам + 50% по звонкам) / 2
    expect(result.dayPlanPercent).toBe(75)
    expect(result.activityKpis.map((k) => k.label)).toEqual(['Лиды', 'Сделки', 'Звонки'])
  })

  it('команда: планы и факт складываются, выручка только в валюте первого плана', () => {
    const total = aggregateProgress([
      { positionId: 'a', plan: plan('a'), month: actuals({ leads: 2 }), week: actuals(), today: actuals() },
      { positionId: 'b', plan: plan('b', { currency: 'GEL', revenueTargetMinorUnits: 5 }), month: actuals({ leads: 3 }), week: actuals(), today: actuals() },
      { positionId: 'c', plan: null, month: actuals({ leads: 1 }), week: actuals(), today: actuals() },
    ])
    expect(total.plan).toEqual(expect.objectContaining({ currency: 'USD', revenueTargetMinorUnits: 1_000_000, leadsTarget: 44 }))
    expect(total.month.leads).toBe(6)
  })

  it('рабочие дни текущей недели не выходят за начало месяца', () => {
    expect(workingDaysThisWeek('2026-09', new Date('2026-09-17T10:00:00.000Z'))).toBe(4) // пн 14 — чт 17
    expect(workingDaysThisWeek('2026-10', new Date('2026-10-02T10:00:00.000Z'))).toBe(2) // чт 1 — пт 2
  })
})

const list = vi.fn()
const upsert = vi.fn()

vi.mock('@/services/plansApiV2', () => ({
  currentPlanPeriod: () => '2026-09',
  plansApiV2: {
    list: (...args: unknown[]) => list(...args),
    upsert: (...args: unknown[]) => upsert(...args),
  },
}))

vi.mock('@/services/teamApi', () => ({
  teamApi: {
    list: () =>
      Promise.resolve([
        { id: 'u1', positionId: 'pos-1', name: 'Анна Петрова', position: 'Менеджер' },
        { id: 'u2', positionId: 'pos-2', name: 'Вакансия', position: 'Менеджер', vacant: true },
      ]),
  },
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number> | string) =>
      params && typeof params === 'object' ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}))

describe('SetPlansModal — настоящая команда и сервер планов', () => {
  beforeEach(() => {
    list.mockReset()
    upsert.mockReset()
  })
  afterEach(() => cleanup())

  it('показывает занятые позиции, сохраняет план с версией и сообщает рабочему столу', async () => {
    list.mockResolvedValue({ items: [plan('pos-1', { version: 2, leadsTarget: 10 })], canManageTeam: true })
    upsert.mockResolvedValue(plan('pos-1', { version: 3, leadsTarget: 12 }))
    const onSaved = vi.fn()
    const { SetPlansModal } = await import('@/components/dashboard/SetPlansModal')
    render(createElement(SetPlansModal, { open: true, onOpenChange: vi.fn(), onSaved }))

    await waitFor(() => expect(screen.getByText('Анна Петрова')).toBeDefined())
    expect(screen.queryByText('Вакансия')).toBeNull()
    expect(list).toHaveBeenCalledWith('2026-09')

    fireEvent.click(screen.getByText('Анна Петрова'))
    fireEvent.change(screen.getByLabelText('plans.leadsTarget'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /plans\.save/ }))

    await waitFor(() => expect(screen.getByText('plans.saved')).toBeDefined())
    expect(upsert).toHaveBeenCalledWith('pos-1', '2026-09', expect.objectContaining({ leadsTarget: 12, revenueTargetMinorUnits: 1_000_000 }), 2)
    expect(onSaved).toHaveBeenCalled()
  })
})
