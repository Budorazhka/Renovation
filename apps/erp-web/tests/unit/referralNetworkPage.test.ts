/** @vitest-environment jsdom */

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hangerPlace, hangerRows } from '@/lib/referral-team-layout'

const person = (identityId: string, name: string) => ({ identityId, name, organizationName: 'Агентство Один', organizationType: 'agency' })

const curatorNode = {
  person: person('cur1', 'Анна Кураторова'),
  appointedAt: '2026-09-01T10:00:00.000Z',
  teamSize: 1,
  teamStatus: 'recruiting',
  members: [
    { person: person('m1', 'Борис Агентов'), joinedAt: '2026-09-02T10:00:00.000Z', joinedVia: 'invite_link', status: 'active' },
    { person: person('m2', 'Вера Сменила'), joinedAt: '2026-09-03T10:00:00.000Z', joinedVia: 'admin', status: 'on_review' },
  ],
}

vi.mock('@/components/layout/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: unknown }) => children,
}))

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.doUnmock('@/services/referralNetworkApi')
})

async function renderPage(api: { getMine: () => Promise<unknown>; getOrganization: () => Promise<unknown> }) {
  vi.doMock('@/services/referralNetworkApi', () => ({ referralNetworkApi: api }))
  // Ключ выбора языка ERP (LanguageProvider): в тестовой среде по умолчанию английский.
  window.localStorage.setItem('erp.language', 'ru')
  const { default: Page } = await import('@/pages/modules/PartnersMlmAnalyticsPage')
  const { LanguageProvider } = await import('@/i18n/LanguageProvider')
  return render(createElement(LanguageProvider, null, createElement(MemoryRouter, null, createElement(Page))))
}

describe('раскладка команды ERP «вешалкой»', () => {
  it('ряд заполняется от стержня наружу; на узком экране по одному с каждой стороны', () => {
    expect([0, 1, 2, 3].map((i) => hangerPlace(i, 2).column)).toEqual([2, 4, 1, 5])
    expect(hangerPlace(4, 2)).toEqual({ row: 2, column: 2, side: 'left', depth: 0 })
    expect(hangerPlace(2, 1)).toEqual({ row: 2, column: 1, side: 'left', depth: 0 })
    expect(hangerRows(9, 2)).toBe(3)
    expect(hangerRows(9, 1)).toBe(5)
  })
})

describe('«Партнёры → MLM»', () => {
  it('куратор видит свою команду деревом и деньги от BAZA; сеть компании без денег', async () => {
    await renderPage({
      getMine: () =>
        Promise.resolve({
          rules: { ratePercent: 7, teamSizeMin: 5, teamSizeIdealMax: 20 },
          role: 'curator',
          curator: {
            inviteCode: 'ABCD2345',
            node: curatorNode,
            totals: { earned: [{ amountMinorUnits: 21000, currency: 'USD' }], paid: [], due: [{ amountMinorUnits: 21000, currency: 'USD' }] },
            accruals: [],
          },
          membership: null,
        }),
      getOrganization: () => Promise.resolve({ rules: { ratePercent: 7, teamSizeMin: 5, teamSizeIdealMax: 20 }, curators: [curatorNode] }),
    })

    const trees = await screen.findAllByRole('figure', { name: 'Команда куратора Анна Кураторова: участников 2' })
    expect(trees).toHaveLength(2)
    expect(within(trees[0]!).getByLabelText('Вера Сменила, связь под вопросом')).not.toBeNull()
    expect(within(trees[0]!).getByText('Куратор · 1 в команде')).not.toBeNull()

    // В списке компании команда свёрнута, пока её не раскроют.
    expect(within(trees[1]!).queryByLabelText('Вера Сменила, связь под вопросом')).toBeNull()
    const toggle = within(trees[1]!).getByRole('button', { name: 'Показать команду' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(within(trees[1]!).getByLabelText('Вера Сменила, связь под вопросом')).not.toBeNull()
    expect(within(trees[1]!).getByRole('button', { name: 'Свернуть команду' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText(/210,00/).length).toBeGreaterThan(0)
    expect(screen.getByText('Кураторы компании')).not.toBeNull()
  })

  it('сотрудник без права на сеть компании видит только своё, отказ сервера не показывается ошибкой', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403 } })
    await renderPage({
      getMine: () => Promise.resolve({ rules: { ratePercent: 7, teamSizeMin: 5, teamSizeIdealMax: 20 }, role: 'none', curator: null, membership: null }),
      getOrganization: () => Promise.reject(forbidden),
    })

    await waitFor(() => expect(screen.queryByText(/Вы пока не в реферальной сети/)).not.toBeNull())
    expect(screen.queryByText('Кураторы компании')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
