/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../src/i18n'
import { hangerPlace, hangerRows } from '../src/features/referral/lib/team-tree-layout'

const person = (identityId: string, name: string) => ({
  identityId,
  name,
  organizationName: null,
  organizationType: 'independent_realtor',
})

function curatorNetwork() {
  return {
    rules: { ratePercent: 7, teamSizeMin: 5, teamSizeIdealMax: 20 },
    role: 'curator',
    curator: {
      inviteCode: 'ABCD2345',
      node: {
        person: person('cur1', 'Анна Кураторова'),
        appointedAt: '2026-09-01T10:00:00.000Z',
        teamSize: 2,
        teamStatus: 'recruiting',
        members: [
          { person: person('m1', 'Борис Агентов'), joinedAt: '2026-09-02T10:00:00.000Z', joinedVia: 'invite_link', status: 'active' },
          { person: person('m2', 'Вера Сменила'), joinedAt: '2026-09-03T10:00:00.000Z', joinedVia: 'admin', status: 'on_review' },
        ],
      },
      totals: {
        earned: [{ amountMinorUnits: 21000, currency: 'USD' }],
        paid: [],
        due: [{ amountMinorUnits: 21000, currency: 'USD' }],
      },
      accruals: [
        {
          id: 'acc1',
          curator: person('cur1', 'Анна Кураторова'),
          member: person('m1', 'Борис Агентов'),
          dealId: 'deal1',
          commission: { amountMinorUnits: 300000, currency: 'USD' },
          ratePercent: 7,
          amount: { amountMinorUnits: 21000, currency: 'USD' },
          status: 'accrued',
          accruedAt: '2026-09-15T10:00:00.000Z',
          paidAt: null,
          reversedAt: null,
        },
      ],
    },
    membership: null,
    requests: [],
  }
}

type Overrides = Record<string, (...args: never[]) => Promise<unknown>>

/** Ошибку API создаём из того же экземпляра модуля, что получает страница: иначе instanceof не сработает. */
function mockReferralApi(overrides: Overrides | ((actual: typeof import('../src/features/referral/api/referral-api')) => Overrides)) {
  vi.doMock('../src/features/referral/api/referral-api', async () => {
    const actual = await vi.importActual<typeof import('../src/features/referral/api/referral-api')>(
      '../src/features/referral/api/referral-api',
    )
    const extra = typeof overrides === 'function' ? overrides(actual) : overrides
    return { ...actual, referralApi: { ...actual.referralApi, ...extra } }
  })
}

async function renderTeamPage() {
  const { MyTeamPage } = await import('../src/pages/MyTeamPage')
  return render(
    <I18nProvider>
      <MemoryRouter>
        <MyTeamPage />
      </MemoryRouter>
    </I18nProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('../src/features/referral/api/referral-api')
  vi.doUnmock('../src/features/auth/model/useAuthSession')
})

describe('раскладка команды «вешалкой»', () => {
  it('ряд заполняется от стержня наружу: слева, справа, дальше слева, дальше справа', () => {
    expect([0, 1, 2, 3, 4].map((i) => hangerPlace(i, 2))).toEqual([
      { row: 1, column: 2, side: 'left', depth: 0 },
      { row: 1, column: 4, side: 'right', depth: 0 },
      { row: 1, column: 1, side: 'left', depth: 1 },
      { row: 1, column: 5, side: 'right', depth: 1 },
      { row: 2, column: 2, side: 'left', depth: 0 },
    ])
  })

  it('на узком экране по одному с каждой стороны — рядов вдвое больше', () => {
    expect(hangerPlace(3, 1)).toEqual({ row: 2, column: 3, side: 'right', depth: 0 })
    expect(hangerRows(22, 2)).toBe(6)
    expect(hangerRows(22, 1)).toBe(11)
    expect(hangerRows(0, 2)).toBe(1)
  })
})

describe('«Моя команда» у куратора', () => {
  it('показывает ссылку, статус набора, деньги, дерево и журнал начислений', async () => {
    mockReferralApi({ getMine: () => Promise.resolve(curatorNetwork()) })
    await renderTeamPage()

    const link = (await screen.findByLabelText('Ссылка-приглашение')) as HTMLInputElement
    expect(link.value).toMatch(/\/join\/ABCD2345$/)
    expect(screen.getByText('Идёт набор')).not.toBeNull()
    expect(screen.getAllByText(/210,00/).length).toBeGreaterThan(0)

    const tree = screen.getByRole('figure', { name: 'Команда куратора Анна Кураторова: участников 2' })
    expect(within(tree).getByLabelText('Вера Сменила, связь под вопросом')).not.toBeNull()
    expect(within(tree).getByText('Куратор · 1 в команде')).not.toBeNull()
    expect(screen.getByText(/× 7%/)).not.toBeNull()
  })
})

describe('«Моя команда» у риэлтора без команды', () => {
  it('вступление по коду: отказ по правилу компании объясняется словами', async () => {
    mockReferralApi(({ ReferralApiError }) => ({
      getMine: () => Promise.resolve({ ...curatorNetwork(), role: 'none', curator: null }),
      join: () => Promise.reject(new ReferralApiError('mismatch', 409, 'REFERRAL_COMPANY_MISMATCH')),
    }))
    await renderTeamPage()

    fireEvent.change(await screen.findByLabelText('Код приглашения'), { target: { value: 'ABCD2345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Вступить' }))

    await waitFor(() =>
      expect(
        screen.queryByText('Вы работаете в агентстве, а куратор — из другой компании: вступить в его команду нельзя.'),
      ).not.toBeNull(),
    )
  })

  it('заявка «стать куратором» уходит с причиной, повторную кнопку сменяет «ждёт решения»', async () => {
    const createRequest = vi.fn(() => Promise.resolve({}))
    let pending = false
    mockReferralApi({
      getMine: () =>
        Promise.resolve({
          ...curatorNetwork(),
          role: 'none',
          curator: null,
          requests: pending
            ? [
                {
                  id: 'r1',
                  type: 'become_curator',
                  applicant: person('me', 'Я'),
                  targetCurator: null,
                  reason: 'Есть команда из шести риэлторов',
                  status: 'pending',
                  decisionComment: null,
                  createdAt: '2026-09-16T10:00:00.000Z',
                  decidedAt: null,
                },
              ]
            : [],
        }),
      createRequest: (...args: never[]) => {
        pending = true
        return createRequest(...args)
      },
    })
    await renderTeamPage()

    const reason = await screen.findByLabelText('Расскажите, почему')
    const send = screen.getByRole('button', { name: 'Отправить заявку' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: 'Есть команда из шести риэлторов' } })
    fireEvent.click(send)

    await waitFor(() =>
      expect(createRequest).toHaveBeenCalledWith({ type: 'become_curator', reason: 'Есть команда из шести риэлторов' }),
    )
    await waitFor(() => expect(screen.queryByText('Заявка уже отправлена и ждёт решения BAZA.')).not.toBeNull())
    expect(screen.getByText('Ждёт решения')).not.toBeNull()
  })
})

describe('страница приглашения', () => {
  it('до входа показывает куратора и ведёт на регистрацию с возвратом сюда', async () => {
    mockReferralApi({ previewInvite: () => Promise.resolve({ curatorName: 'Анна Кураторова' }) })
    vi.doMock('../src/features/auth/model/useAuthSession', () => ({
      useAuthSession: () => ({ isAuthenticated: false, isChecking: false }),
    }))
    const { JoinTeamPage } = await import('../src/pages/JoinTeamPage')
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/join/ABCD2345']}>
          <Routes>
            <Route path="/join/:code" element={<JoinTeamPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Анна Кураторова' })).not.toBeNull()
    const register = screen.getByRole('link', { name: 'Зарегистрироваться и вступить' })
    expect(register.getAttribute('href')).toBe('/auth/register?next=%2Fjoin%2FABCD2345')
  })
})
