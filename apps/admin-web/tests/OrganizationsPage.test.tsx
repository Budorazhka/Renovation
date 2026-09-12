/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminOrganizationListItem } from '../src/types/admin'

function makeOrganization(overrides: Partial<AdminOrganizationListItem> = {}): AdminOrganizationListItem {
  return {
    id: 'org1',
    name: 'Батуми Риелт',
    type: 'agency',
    status: 'active',
    mlsVerified: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    positionsCount: 5,
    ...overrides,
  }
}

function mockAdminApi(overrides: {
  listOrganizations?: (...args: unknown[]) => Promise<unknown>
  freezeOrganization?: (...args: unknown[]) => Promise<unknown>
  unfreezeOrganization?: (...args: unknown[]) => Promise<unknown>
  verifyMls?: (...args: unknown[]) => Promise<unknown>
  revokeMlsVerification?: (...args: unknown[]) => Promise<unknown>
}) {
  vi.doMock('../src/api/admin-api', async () => {
    const actual = await vi.importActual<typeof import('../src/api/admin-api')>('../src/api/admin-api')
    return {
      ...actual,
      adminApi: {
        ...actual.adminApi,
        me: () => Promise.resolve({ adminAccountId: 'a1', isSuperAdmin: false, publicationReadScope: 'all' }),
        listOrganizations:
          overrides.listOrganizations ?? (() => Promise.resolve({ items: [makeOrganization()], nextCursor: null })),
        freezeOrganization:
          overrides.freezeOrganization ??
          ((id: string) => Promise.resolve({ id, status: 'frozen' })),
        unfreezeOrganization:
          overrides.unfreezeOrganization ??
          ((id: string) => Promise.resolve({ id, status: 'active' })),
        verifyMls:
          overrides.verifyMls ?? ((id: string) => Promise.resolve({ id, mlsVerified: true })),
        revokeMlsVerification:
          overrides.revokeMlsVerification ?? ((id: string) => Promise.resolve({ id, mlsVerified: false })),
      },
    }
  })
}

async function renderOrganizationsPage() {
  const { AdminAuthProvider } = await import('../src/hooks/useAdminAuth')
  const { RequireAdmin } = await import('../src/hooks/RequireAdmin')
  const { OrganizationsPage } = await import('../src/pages/OrganizationsPage')

  return render(
    <MemoryRouter initialEntries={['/organizations']}>
      <AdminAuthProvider>
        <RequireAdmin>
          <OrganizationsPage />
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

describe('OrganizationsPage', () => {
  it('loads and displays organizations in the table', async () => {
    mockAdminApi({})
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Батуми Риелт')).not.toBeNull()
      expect(screen.queryAllByText('Агентство').length).toBeGreaterThan(0)
      expect(screen.queryAllByText('Активна').length).toBeGreaterThan(0)
      expect(screen.queryByText('5')).not.toBeNull()
      expect(screen.queryByText('Заморозить')).not.toBeNull()
    })
  })

  it('filters organizations by type, status, and search', async () => {
    const listOrganizations = vi.fn(() =>
      Promise.resolve({
        items: [makeOrganization({ id: 'org2', name: 'Elite Developer', type: 'developer', status: 'frozen' })],
        nextCursor: null,
      }),
    )
    mockAdminApi({ listOrganizations })
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Организации')).not.toBeNull()
    })

    const typeSelect = screen.getByLabelText('Тип')
    fireEvent.change(typeSelect, { target: { value: 'developer' } })

    const statusSelect = screen.getByLabelText('Статус')
    fireEvent.change(statusSelect, { target: { value: 'frozen' } })

    const searchInput = screen.getByLabelText('Поиск')
    fireEvent.change(searchInput, { target: { value: 'Elite' } })

    const submitBtn = screen.getByRole('button', { name: 'Применить' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(listOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'developer',
          status: 'frozen',
          search: 'Elite',
        }),
      )
    })
  })

  it('executes freeze action requiring reason >= 10 chars', async () => {
    const freezeOrganization = vi.fn((id: string) => Promise.resolve({ id, status: 'frozen' }))
    mockAdminApi({ freezeOrganization })
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Заморозить')).not.toBeNull()
    })

    fireEvent.click(screen.getByText('Заморозить'))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeNull()
      expect(screen.queryByText('Заморозить организацию?')).not.toBeNull()
    })

    const confirmBtn = screen.getAllByRole('button', { name: 'Заморозить' }).find(
      (btn) => btn.closest('.dialog-actions') !== null,
    ) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    const reasonInput = screen.getByLabelText(/Причина/)
    fireEvent.change(reasonInput, { target: { value: 'Коротко' } })
    expect(confirmBtn.disabled).toBe(true)

    fireEvent.change(reasonInput, { target: { value: 'Нарушение правил платформы: спам' } })
    expect(confirmBtn.disabled).toBe(false)

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(freezeOrganization).toHaveBeenCalledWith('org1', 'Нарушение правил платформы: спам')
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryAllByText('Заморожена').length).toBeGreaterThan(0)
      expect(screen.queryByText('Разморозить')).not.toBeNull()
    })
  })

  it('executes unfreeze action for frozen organization', async () => {
    const unfreezeOrganization = vi.fn((id: string) => Promise.resolve({ id, status: 'active' }))
    mockAdminApi({
      listOrganizations: () =>
        Promise.resolve({
          items: [makeOrganization({ id: 'org-f', status: 'frozen' })],
          nextCursor: null,
        }),
      unfreezeOrganization,
    })
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Разморозить')).not.toBeNull()
    })

    fireEvent.click(screen.getByText('Разморозить'))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeNull()
      expect(screen.queryByText('Разморозить организацию?')).not.toBeNull()
    })

    const confirmBtn = screen.getAllByRole('button', { name: 'Разморозить' }).find(
      (btn) => btn.closest('.dialog-actions') !== null,
    ) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    const reasonInput = screen.getByLabelText(/Причина/)
    fireEvent.change(reasonInput, { target: { value: 'Предоставлены подтверждающие документы' } })
    expect(confirmBtn.disabled).toBe(false)

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(unfreezeOrganization).toHaveBeenCalledWith('org-f', 'Предоставлены подтверждающие документы')
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryAllByText('Активна').length).toBeGreaterThan(0)
    })
  })

  it('executes verify MLS action requiring reason >= 10 chars (N-10)', async () => {
    const verifyMls = vi.fn((id: string) => Promise.resolve({ id, mlsVerified: true }))
    mockAdminApi({ verifyMls })
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Верифицировать MLS')).not.toBeNull()
    })

    fireEvent.click(screen.getByText('Верифицировать MLS'))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeNull()
      expect(screen.queryByText('Верифицировать MLS-биржу?')).not.toBeNull()
    })

    const confirmBtn = screen.getAllByRole('button', { name: 'Верифицировать' }).find(
      (btn) => btn.closest('.dialog-actions') !== null,
    ) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    const reasonInput = screen.getByLabelText(/Причина/)
    fireEvent.change(reasonInput, { target: { value: 'Проверено по телефону и документам' } })
    expect(confirmBtn.disabled).toBe(false)

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(verifyMls).toHaveBeenCalledWith('org1', 'Проверено по телефону и документам')
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryAllByText('Проверено').length).toBeGreaterThan(0)
      expect(screen.queryByText('Отозвать MLS')).not.toBeNull()
    })
  })

  it('executes revoke MLS verification for a verified organization (N-10)', async () => {
    const revokeMlsVerification = vi.fn((id: string) => Promise.resolve({ id, mlsVerified: false }))
    mockAdminApi({
      listOrganizations: () =>
        Promise.resolve({
          items: [makeOrganization({ id: 'org-v', mlsVerified: true })],
          nextCursor: null,
        }),
      revokeMlsVerification,
    })
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Отозвать MLS')).not.toBeNull()
    })

    fireEvent.click(screen.getByText('Отозвать MLS'))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeNull()
      expect(screen.queryByText('Отозвать MLS-верификацию?')).not.toBeNull()
    })

    const reasonInput = screen.getByLabelText(/Причина/)
    fireEvent.change(reasonInput, { target: { value: 'Документы больше не действительны' } })

    const confirmBtn = screen.getAllByRole('button', { name: 'Отозвать' }).find(
      (btn) => btn.closest('.dialog-actions') !== null,
    ) as HTMLButtonElement
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(revokeMlsVerification).toHaveBeenCalledWith('org-v', 'Документы больше не действительны')
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryAllByText('Не проверено').length).toBeGreaterThan(0)
      expect(screen.queryByText('Верифицировать MLS')).not.toBeNull()
    })
  })

  it('does not show MLS verification actions for a developer organization (N-10)', async () => {
    mockAdminApi({
      listOrganizations: () =>
        Promise.resolve({
          items: [makeOrganization({ id: 'org-dev', type: 'developer', name: 'Elite Developer' })],
          nextCursor: null,
        }),
    })
    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Elite Developer')).not.toBeNull()
    })

    expect(screen.queryByText('Не применимо')).not.toBeNull()
    expect(screen.queryByText('Верифицировать MLS')).toBeNull()
    expect(screen.queryByText('Отозвать MLS')).toBeNull()
  })

  it('opens billing modal and activates subscription', async () => {
    const getOrganizationBilling = vi.fn(() =>
      Promise.resolve({
        subscription: {
          organizationId: 'org1',
          planCode: 'agency_trial',
          status: 'trial',
          startedAt: '2026-08-20T10:00:00.000Z',
          expiresAt: '2026-09-03T10:00:00.000Z',
          currentUsage: { activeListings: 15, teamPositions: 3 },
        },
        plan: {
          code: 'agency_trial',
          name: 'Agency Trial',
          limits: { maxActiveListings: 30, maxTeamPositions: 5, crmAccess: true, chessboardAccess: true, landingAccess: false },
          pricePerMonth: { amountMinorUnits: 0, currency: 'USD' },
          isActive: true,
        },
        effectiveLimits: { maxActiveListings: 30, maxTeamPositions: 5, crmAccess: true, chessboardAccess: true, landingAccess: false },
        ledger: [],
      }),
    )
    const activateSubscription = vi.fn(() =>
      Promise.resolve({
        organizationId: 'org1',
        planCode: 'agency_pro',
        status: 'active',
        startedAt: '2026-09-09T10:00:00.000Z',
        expiresAt: '2026-10-09T10:00:00.000Z',
        currentUsage: { activeListings: 15, teamPositions: 3 },
      }),
    )

    mockAdminApi({
      listOrganizations: () =>
        Promise.resolve({
          items: [makeOrganization({ id: 'org1', name: 'Батуми Риелт' })],
          nextCursor: null,
        }),
    })

    vi.doMock('../src/api/admin-api', async () => {
      const actual = await vi.importActual<typeof import('../src/api/admin-api')>('../src/api/admin-api')
      return {
        ...actual,
        adminApi: {
          ...actual.adminApi,
          me: () => Promise.resolve({ adminAccountId: 'a1', isSuperAdmin: false, publicationReadScope: 'all' }),
          listOrganizations: () => Promise.resolve({ items: [makeOrganization({ id: 'org1', name: 'Батуми Риелт' })], nextCursor: null }),
          getOrganizationBilling,
          activateSubscription,
        },
      }
    })

    await renderOrganizationsPage()

    await waitFor(() => {
      expect(screen.queryByText('Тариф / Биллинг')).not.toBeNull()
    })

    fireEvent.click(screen.getByText('Тариф / Биллинг'))

    await waitFor(() => {
      expect(screen.queryByText(/Биллинг и тариф: Батуми Риелт/)).not.toBeNull()
      expect(getOrganizationBilling).toHaveBeenCalledWith('org1')
    })

    const reasonTextarea = screen.getByLabelText(/Обоснование ручной операции/)
    fireEvent.change(reasonTextarea, { target: { value: 'Оплата тарифа по безналичному расчёту' } })

    const activateBtn = screen.getByRole('button', { name: 'Активировать / Продлить' })
    expect(activateBtn.hasAttribute('disabled')).toBe(false)

    fireEvent.click(activateBtn)

    await waitFor(() => {
      expect(activateSubscription).toHaveBeenCalledWith(
        'org1',
        expect.objectContaining({
          reason: 'Оплата тарифа по безналичному расчёту',
        }),
      )
    })
  })
})
