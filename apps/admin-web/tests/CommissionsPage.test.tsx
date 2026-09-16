/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

function makeDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal1',
    organizationId: 'org1',
    ownerPositionId: 'pos1',
    title: 'Квартира в ЖК Солнечный',
    stage: 'deal',
    dealType: 'primary',
    expectedCommission: { amountMinorUnits: 300000, currency: 'USD' },
    commissionReceived: null,
    commissionReceivedAt: null,
    version: 3,
    createdAt: '2026-09-10T10:00:00.000Z',
    organizationName: 'Агентство Один',
    agentName: 'Борис Агентов',
    curatorAccrual: null,
    ...overrides,
  }
}

type Overrides = Record<string, (...args: never[]) => Promise<unknown>>

/** Ошибку API создаём из того же экземпляра модуля, что получает страница: иначе instanceof не сработает. */
function mockAdminApi(overrides: Overrides | ((actual: typeof import('../src/api/admin-api')) => Overrides) = {}) {
  vi.doMock('../src/api/admin-api', async () => {
    const actual = await vi.importActual<typeof import('../src/api/admin-api')>('../src/api/admin-api')
    return {
      ...actual,
      adminApi: {
        ...actual.adminApi,
        me: () => Promise.resolve({ adminAccountId: 'a1', isSuperAdmin: false, publicationReadScope: 'all' }),
        listCommissions: () => Promise.resolve({ items: [makeDeal()] }),
        ...(typeof overrides === 'function' ? overrides(actual) : overrides),
      },
    }
  })
}

async function renderPage() {
  const { AdminAuthProvider } = await import('../src/hooks/useAdminAuth')
  const { RequireAdmin } = await import('../src/hooks/RequireAdmin')
  const { CommissionsPage } = await import('../src/pages/CommissionsPage')
  return render(
    <MemoryRouter initialEntries={['/commissions']}>
      <AdminAuthProvider>
        <RequireAdmin>
          <CommissionsPage />
        </RequireAdmin>
      </AdminAuthProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('CommissionsPage', () => {
  it('отметка «деньги пришли» отправляет фактическую сумму с версией и показывает начисление куратору', async () => {
    const markCommissionReceived = vi.fn(() =>
      Promise.resolve({
        deal: makeDeal({ version: 4 }),
        accrual: { accrued: true, accrualId: 'acc1', curatorIdentityId: 'cur1', amount: { amountMinorUnits: 17500, currency: 'USD' } },
      }),
    )
    mockAdminApi({ markCommissionReceived })
    await renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Деньги пришли' }))
    const dialog = screen.getByRole('dialog')
    const amount = within(dialog).getByLabelText('Сумма') as HTMLInputElement
    expect(amount.value).toBe('3000.00')

    fireEvent.change(amount, { target: { value: '2 500,00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отметить' }))

    await waitFor(() =>
      expect(markCommissionReceived).toHaveBeenCalledWith(
        'deal1',
        expect.objectContaining({ expectedVersion: 3, amount: { amountMinorUnits: 250000, currency: 'USD' } }),
      ),
    )
    await waitFor(() => expect(screen.queryByText(/куратору начислено 175,00/)).not.toBeNull())
  })

  it('без куратора отметка проходит, а страница объясняет, почему начисления нет', async () => {
    mockAdminApi({
      markCommissionReceived: () =>
        Promise.resolve({ deal: makeDeal({ version: 4 }), accrual: { accrued: false, reason: 'not_in_team' } }),
    })
    await renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Деньги пришли' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отметить' }))

    await waitFor(() => expect(screen.queryByText(/агент не состоит в команде куратора/)).not.toBeNull())
  })

  it('сторно уже выплаченного обычным администратором — понятный отказ', async () => {
    mockAdminApi(({ AdminApiError }) => ({
      listCommissions: () =>
        Promise.resolve({
          items: [makeDeal({ commissionReceived: { amountMinorUnits: 300000, currency: 'USD' }, commissionReceivedAt: '2026-09-15T10:00:00.000Z' })],
        }),
      cancelCommissionReceived: () => Promise.reject(new AdminApiError('paid', 409, 'CURATOR_ACCRUAL_ALREADY_PAID')),
    }))
    await renderPage()

    fireEvent.click(await screen.findByRole('tab', { name: 'Деньги пришли' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Снять отметку' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Ошибся суммой' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Снять отметку' }))

    await waitFor(() =>
      expect(within(dialog).queryByText('Куратору уже выплачено по этой сделке: отменить может только суперадмин.')).not.toBeNull(),
    )
  })
})
