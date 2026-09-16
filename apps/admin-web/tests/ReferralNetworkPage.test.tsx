/** @vitest-environment jsdom */

import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const person = (identityId: string, name: string, extra: Record<string, unknown> = {}) => ({
  identityId,
  name,
  login: `${identityId}@example.test`,
  organizationName: 'ИП',
  organizationType: 'independent_realtor',
  ...extra,
})

function makeNetwork(overrides: Record<string, unknown> = {}) {
  return {
    rules: { ratePercent: 7, teamSizeMin: 5, teamSizeIdealMax: 20 },
    curators: [
      {
        person: person('cur1', 'Анна Кураторова'),
        appointedAt: '2026-09-01T10:00:00.000Z',
        teamSize: 1,
        teamStatus: 'recruiting',
        inviteCode: 'ABCD2345',
        totals: { earned: [{ amountMinorUnits: 21000, currency: 'USD' }], paid: [], due: [{ amountMinorUnits: 21000, currency: 'USD' }] },
        members: [
          { person: person('mem1', 'Борис Агентов'), joinedAt: '2026-09-02T10:00:00.000Z', joinedVia: 'invite_link', status: 'active' },
          { person: person('mem2', 'Вера Сменила'), joinedAt: '2026-09-03T10:00:00.000Z', joinedVia: 'admin', status: 'on_review' },
        ],
      },
    ],
    summary: { curators: 1, members: 1, membersOnReview: 1, pendingRequests: 2 },
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
        me: () => Promise.resolve({ adminAccountId: 'a1', isSuperAdmin: true, publicationReadScope: 'all' }),
        getReferralNetwork: () => Promise.resolve(makeNetwork()),
        getReferralHistory: () => Promise.resolve({ items: [] }),
        listReferralRequests: () => Promise.resolve({ items: [] }),
        ...(typeof overrides === 'function' ? overrides(actual) : overrides),
      },
    }
  })
}

async function renderPage() {
  const { AdminAuthProvider } = await import('../src/hooks/useAdminAuth')
  const { RequireAdmin } = await import('../src/hooks/RequireAdmin')
  const { ReferralNetworkPage } = await import('../src/pages/ReferralNetworkPage')
  return render(
    <MemoryRouter initialEntries={['/referral-network']}>
      <AdminAuthProvider>
        <RequireAdmin>
          <ReferralNetworkPage />
        </RequireAdmin>
      </AdminAuthProvider>
    </MemoryRouter>,
  )
}

// Первый рендер ждёт холодный импорт страницы: под параллельной нагрузкой всего воркспейса это дольше секунды по умолчанию.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('ReferralNetworkPage', () => {
  it('рисует дерево: BAZA, куратор; команда раскрывается, участник под вопросом отмечен', async () => {
    mockAdminApi()
    await renderPage()

    const tree = await screen.findByRole('region', { name: 'Дерево сети: кураторов 1, участников 2' })
    expect(within(tree).getByRole('button', { name: 'BAZA: вся сеть' })).not.toBeNull()
    expect(within(tree).getByRole('button', { name: 'Куратор Анна Кураторова, в команде 1' })).not.toBeNull()
    expect(within(tree).queryByRole('button', { name: 'Вера Сменила, связь под вопросом' })).toBeNull()

    const toggle = within(tree).getByRole('button', { name: 'Показать команду: 1 из 20, 1 под вопросом' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(within(tree).getByRole('button', { name: 'Вера Сменила, связь под вопросом' })).not.toBeNull()
    expect(within(tree).getByRole('button', { name: 'Свернуть команду: 1 из 20, 1 под вопросом' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('заявок ждут решения')).not.toBeNull()
  })

  it('клик по куратору открывает карточку с кодом, статусом команды и деньгами', async () => {
    mockAdminApi()
    await renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Куратор Анна Кураторова, в команде 1' }))

    await waitFor(() => expect(screen.queryByText('ABCD2345')).not.toBeNull())
    expect(screen.getAllByText('Идёт набор').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/210,00/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Снять куратора' })).not.toBeNull()
  })

  it('найденного по почте назначают куратором только с причиной', async () => {
    const appointCurator = vi.fn(() => Promise.resolve(makeNetwork()))
    mockAdminApi({
      findReferralPerson: () =>
        Promise.resolve({ person: person('new1', 'Новый Риэлтор'), isCurator: false, membership: null }),
      appointCurator,
    })
    await renderPage()

    await screen.findByRole('region', { name: /Дерево сети/ })
    fireEvent.change(screen.getByLabelText('Найти человека по почте'), { target: { value: 'new1@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Назначить куратором' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Назначить' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Проверен BAZA' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => expect(appointCurator).toHaveBeenCalledWith('new1', 'Проверен BAZA'))
    await waitFor(() => expect(screen.queryByText('Новый Риэлтор назначен куратором.')).not.toBeNull())
  })

  it('имя меняют в карточке человека: новое имя и причина обязательны', async () => {
    const renamePerson = vi.fn(() =>
      Promise.resolve({ ...person('cur1', 'Анна Кураторова-Беридзе'), login: 'cur1@example.test' }),
    )
    mockAdminApi({ renamePerson })
    await renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Куратор Анна Кураторова, в команде 1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить имя' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Сохранить имя' }) as HTMLButtonElement
    // То же имя сохранять нечего.
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Причина/ }), { target: { value: 'Вышла замуж' } })
    expect(confirm.disabled).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Новое имя'), { target: { value: 'Анна Кураторова-Беридзе' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => expect(renamePerson).toHaveBeenCalledWith('cur1', 'Анна Кураторова-Беридзе', 'Вышла замуж'))
    await waitFor(() => expect(screen.queryByText('Имя изменено: Анна Кураторова-Беридзе.')).not.toBeNull())
  })

  it('отказ сервера по правилу компании показывается словами', async () => {
    mockAdminApi(({ AdminApiError }) => ({
      assignReferralMember: () => Promise.reject(new AdminApiError('mismatch', 409, 'REFERRAL_COMPANY_MISMATCH')),
      getReferralNetwork: () =>
        Promise.resolve(
          makeNetwork({
            curators: [
              makeNetwork().curators[0],
              { ...makeNetwork().curators[0], person: person('cur2', 'Второй Куратор'), members: [], teamSize: 0, inviteCode: 'XYZW2345' },
            ],
          }),
        ),
    }))
    await renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Показать команду: 1 из 20/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Борис Агентов' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Перевести к другому куратору' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Переезд' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(within(dialog).queryByText('Сотрудник агентства не может состоять в команде куратора из другой компании.')).not.toBeNull(),
    )
  })

  it('вид списком: кураторы и вложенные участники, выбор открывает карточку', async () => {
    mockAdminApi()
    await renderPage()

    fireEvent.click(await screen.findByRole('radio', { name: 'Списком' }))
    const list = screen.getByRole('tree', { name: 'Сеть списком' })
    expect(screen.queryByRole('region', { name: /Дерево сети/ })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Показать команду' }))
    fireEvent.click(within(list).getByRole('button', { name: 'Вера Сменила' }))
    await waitFor(() => expect(screen.getAllByText(/под вопросом/).length).toBeGreaterThan(1))
    expect(within(list).getByRole('button', { name: 'Свернуть команду' })).not.toBeNull()
  })
})
