/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFunnelGroups, buildReportBuckets, DAILY_BUCKET_LIMIT, periodRange } from '@/lib/crm-reports'

const getTeamPerformance = vi.fn()
const getLeadFunnel = vi.fn()
// Отказ сервера отдаёт обычная функция: промис из обёртки vi.fn в jsdom vitest считает необработанным.
let rejectReportWith: unknown = null

vi.mock('@/services/crmReportsApi', () => ({
  crmReportsApi: {
    getTeamPerformance: (...args: unknown[]) =>
      rejectReportWith ? Promise.reject(rejectReportWith) : getTeamPerformance(...args),
    getLeadFunnel: (...args: unknown[]) => (rejectReportWith ? Promise.reject(rejectReportWith) : getLeadFunnel(...args)),
  },
}))

vi.mock('@/services/leadsApiV2', () => ({
  leadsApiV2: {
    getStageDefinitions: () =>
      Promise.resolve({
        sales: [
          { id: 'refused', name: 'Отказ', order: 2, column: 'rejection' },
          { id: 'new', name: 'Новый лид', order: 6, column: 'in_progress' },
          { id: 'kp_sent', name: 'Отправлено КП', order: 12, column: 'in_progress' },
          { id: 'golden', name: 'Золотой фонд', order: 19, column: 'success' },
        ],
        network: [],
        owner: [],
        agent: [],
      }),
  },
}))

vi.mock('@/services/teamApi', () => ({
  teamApi: {
    list: () => Promise.resolve([{ id: 'u1', positionId: 'pos-1', name: 'Анна Петрова', position: 'Менеджер' }]),
  },
}))

vi.mock('@/components/layout/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number> | string) =>
      params && typeof params === 'object'
        ? `${key}:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}`
        : key,
    formatNumber: (value: number) => String(value),
    formatDate: (date: string) => String(date).slice(0, 10),
  }),
}))

const REPORT = {
  summary: {
    leadsTotal: 10,
    leadsConverted: 2,
    conversionRatePercent: 20,
    dealsTotal: 3,
    dealsWon: 1,
    dealsCommission: [{ currency: 'USD', amountMinorUnits: 150000 }],
    tasksTotal: 8,
    tasksCompleted: 6,
    slaPercent: 83.3,
  },
  positions: [
    {
      positionId: null,
      leadsAdded: 1,
      leadsInWork: 1,
      leadsConverted: 0,
      leadsLost: 0,
      conversionRatePercent: 0,
      dealsTotal: 0,
      dealsWon: 0,
      dealsLost: 0,
      dealsCommission: [],
      tasksTotal: 0,
      tasksCompleted: 0,
      tasksOverdue: 0,
      tasksCompletedOnTime: 0,
      slaPercent: 100,
    },
    {
      positionId: 'pos-1',
      leadsAdded: 9,
      leadsInWork: 5,
      leadsConverted: 2,
      leadsLost: 2,
      conversionRatePercent: 22.2,
      dealsTotal: 3,
      dealsWon: 1,
      dealsLost: 0,
      dealsCommission: [{ currency: 'USD', amountMinorUnits: 150000 }],
      tasksTotal: 8,
      tasksCompleted: 6,
      tasksOverdue: 1,
      tasksCompletedOnTime: 5,
      slaPercent: 83.3,
    },
  ],
  timeseries: [{ date: '2026-09-10', leads: 4, deals: 1, completedTasks: 2 }],
}

async function renderPage() {
  const { CrmReportsPage } = await import('@/components/reports/CrmReportsPage')
  render(createElement(CrmReportsPage))
}

describe('crm-reports: расчёты', () => {
  it('период «7 дней» начинается в полночь UTC шесть дней назад, «всё время» без границ', () => {
    const now = new Date('2026-09-15T10:30:00.000Z')
    expect(periodRange('7d', now)).toEqual({ from: '2026-09-09T00:00:00.000Z', to: '2026-09-15T10:30:00.000Z' })
    expect(periodRange('all', now)).toEqual({})
  })

  it('пустые дни добиваются нулями в пределах периода', () => {
    const { buckets, weekly } = buildReportBuckets([{ date: '2026-09-11', leads: 3, deals: 0, completedTasks: 1 }], {
      from: '2026-09-09T00:00:00.000Z',
      to: '2026-09-12T08:00:00.000Z',
    })
    expect(weekly).toBe(false)
    expect(buckets.map((b) => [b.date, b.leads])).toEqual([
      ['2026-09-09', 0],
      ['2026-09-10', 0],
      ['2026-09-11', 3],
      ['2026-09-12', 0],
    ])
  })

  it('длинный ряд складывается в недели с понедельника без потери сумм', () => {
    const points = [
      { date: '2026-01-05', leads: 2, deals: 1, completedTasks: 0 },
      { date: '2026-01-07', leads: 3, deals: 0, completedTasks: 4 },
      { date: '2026-06-01', leads: 1, deals: 0, completedTasks: 0 },
    ]
    const { buckets, weekly } = buildReportBuckets(points, {})
    expect(weekly).toBe(true)
    expect(buckets.length).toBeLessThan(DAILY_BUCKET_LIMIT)
    expect(buckets[0]).toEqual({ date: '2026-01-05', leads: 5, deals: 1, completedTasks: 4 })
    expect(buckets.reduce((sum, b) => sum + b.leads, 0)).toBe(6)
  })

  it('без событий и границ ряд пуст', () => {
    expect(buildReportBuckets([], {})).toEqual({ buckets: [], weekly: false })
  })

  it('воронка: колонки «в работе → успех → отказ», стадии по порядку, пропущенные стадии с нулём', () => {
    const groups = buildFunnelGroups(
      [
        { id: 'golden', name: 'Золотой фонд', order: 19, column: 'success' },
        { id: 'kp_sent', name: 'КП', order: 12, column: 'in_progress' },
        { id: 'refused', name: 'Отказ', order: 2, column: 'rejection' },
        { id: 'new', name: 'Новый', order: 6, column: 'in_progress' },
      ],
      [
        { stage: 'new', leadCount: 7 },
        { stage: 'golden', leadCount: 1 },
      ],
    )
    expect(groups.map((g) => [g.column, g.rows.map((r) => `${r.stage.id}=${r.leadCount}`)])).toEqual([
      ['in_progress', ['new=7', 'kp_sent=0']],
      ['success', ['golden=1']],
      ['rejection', ['refused=0']],
    ])
  })
})

describe('CrmReportsPage', () => {
  beforeEach(() => {
    getTeamPerformance.mockReset()
    getLeadFunnel.mockReset()
    rejectReportWith = null
  })
  afterEach(() => cleanup())

  it('показывает сводку, воронку, динамику и сотрудников из отчётов сервера', async () => {
    getTeamPerformance.mockResolvedValue(REPORT)
    getLeadFunnel.mockResolvedValue({ stages: [{ stage: 'new', leadCount: 7 }, { stage: 'golden', leadCount: 1 }] })
    await renderPage()

    await waitFor(() => expect(screen.getByText('crmReports.summaryLeadsMeta:count=2')).toBeDefined())
    expect(screen.getByText('20%')).toBeDefined()
    expect(getTeamPerformance).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }))
    expect(getLeadFunnel).toHaveBeenCalledWith(expect.objectContaining({ productType: 'sales' }))

    await waitFor(() => expect(screen.getAllByText('crmPoker.stages.RP.new').length).toBeGreaterThan(0))

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Анна Петрова')).toBeDefined()
    expect(within(rows[1]).getByText('Менеджер')).toBeDefined()
    expect(within(rows[2]).getByText('crmReports.unassigned')).toBeDefined()
  })

  it('смена периода и продукта перезапрашивает отчёты', async () => {
    getTeamPerformance.mockResolvedValue(REPORT)
    getLeadFunnel.mockResolvedValue({ stages: [] })
    await renderPage()
    await waitFor(() => expect(screen.getByText('crmReports.funnelEmpty')).toBeDefined())

    fireEvent.click(screen.getByRole('radio', { name: 'crmReports.periodAll' }))
    await waitFor(() => expect(getTeamPerformance).toHaveBeenLastCalledWith({}))

    fireEvent.click(screen.getByRole('radio', { name: 'crmPoker.product.Net' }))
    await waitFor(() => expect(getLeadFunnel).toHaveBeenLastCalledWith({ productType: 'network' }))
  })

  it('403 — объясняет, у кого есть доступ, без пустых нулей', async () => {
    rejectReportWith = Object.assign(new Error('Forbidden'), { response: { status: 403 } })
    await renderPage()

    await waitFor(() => expect(screen.getByText('crmReports.noAccessTitle')).toBeDefined())
    expect(screen.queryByText('crmReports.summaryLeads')).toBeNull()
  })

  it('сбой сервера — сообщение и повтор запроса', async () => {
    rejectReportWith = Object.assign(new Error('Server'), { response: { status: 500 } })
    await renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'crmReports.retry' })).toBeDefined())

    rejectReportWith = null
    getTeamPerformance.mockResolvedValue(REPORT)
    getLeadFunnel.mockResolvedValue({ stages: [] })
    fireEvent.click(screen.getByRole('button', { name: 'crmReports.retry' }))

    await waitFor(() => expect(screen.getByText('crmReports.summaryLeadsMeta:count=2')).toBeDefined())
  })
})
