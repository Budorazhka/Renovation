/** @vitest-environment jsdom */

/**
 * До 17.09.2026 TeamAccessPage был полностью бутафорским: ростер шёл из
 * MOCK_USERS (тот же фейковый массив, из которого в этой же сессии убрали
 * бэкдор-логин), а переключение прав писало только в локальный React state
 * `overrides`, ни одного вызова API. Теперь ростер читается через
 * teamApi.list(), а выдача/отзыв прав — через реальные три эндпоинта
 * organizations.controller.ts (GET/POST grants, POST grants/:id/revoke).
 * Тест мокает не сами *Api-клиенты, а HTTP-клиент (axios.create) — тот же
 * приём, что personnelPageLiveApi.test.ts — чтобы закрепить границу целиком.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({ get: getMock, post: postMock, patch: vi.fn(), delete: vi.fn() }),
  },
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key) }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'pos-owner', role: 'owner', teamRole: 'owner', companyId: 'org-1' },
    updateProfile: vi.fn(),
  }),
}))

const TEAM_USER = {
  id: 'pos-1',
  platformUserId: 'ident-1',
  teamId: 'org-1',
  name: 'Иван Петров',
  role: 'manager',
  position: 'Менеджер',
  managerId: null,
  loginEmail: 'ivan@example.com',
  email: 'ivan@example.com',
  status: 'active',
  skills: [],
  permissionOverrides: {},
  positionId: 'pos-1',
  parentPositionId: null,
  vacant: false,
  occupancyHistory: [],
}

let grantsItems: unknown[] = []

function setupGetMock() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/api/v1/team-users') {
      return { data: { success: true, data: [TEAM_USER] } }
    }
    if (url.endsWith('/grants')) {
      return { data: { items: grantsItems } }
    }
    throw new Error(`unexpected GET ${url}`)
  })
}

function setupPostMock() {
  postMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revoke')) return { data: { revoked: true } }
    if (url.endsWith('/grants')) return { data: { granted: true } }
    throw new Error(`unexpected POST ${url}`)
  })
}

async function renderPage() {
  const { TeamAccessPage } = await import('@/components/team/TeamAccessPage')
  return render(createElement(TeamAccessPage))
}

async function findResourceActionsRow(resourceLabel: string) {
  const labelEl = await screen.findByText(resourceLabel)
  const infoDiv = labelEl.parentElement!
  return infoDiv.nextElementSibling as HTMLElement
}

describe('TeamAccessPage', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    vi.resetModules()
    grantsItems = [
      { id: 'g-1', resource: 'lead', action: 'read', scope: 'organization', version: 1 },
      {
        id: 'g-2',
        resource: 'lead',
        action: 'create',
        scope: 'organization',
        version: 3,
        revokedAt: '2026-09-01T00:00:00.000Z',
        revokeReason: 'ушёл в отпуск',
      },
    ]
    setupGetMock()
    setupPostMock()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('ростер сотрудников идёт через teamApi.list(), не MOCK_USERS', async () => {
    await renderPage()

    expect((await screen.findAllByText('Иван Петров')).length).toBeGreaterThan(0)
    expect(getMock).toHaveBeenCalledWith('/api/v1/team-users')
  })

  it('активный грант позиции показан как выданный, отозванный — как невыданный', async () => {
    await renderPage()

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants'))

    const leadActions = await findResourceActionsRow('Лиды')
    const readButton = within(leadActions).getByRole('button', { name: /Просмотр/ })
    const createButton = within(leadActions).getByRole('button', { name: /Создать/ })

    expect(readButton.getAttribute('title')).toBe('Отозвать право')
    expect(createButton.getAttribute('title')).toBe('Выдать право')
  })

  it('выдача права (клик по невыданному) зовёт POST .../grants с дефолтным scope organization и перезапрашивает список', async () => {
    await renderPage()
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants'))
    getMock.mockClear()

    const leadActions = await findResourceActionsRow('Лиды')
    const createButton = within(leadActions).getByRole('button', { name: /Создать/ })
    fireEvent.click(createButton)

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants', {
        resource: 'lead',
        action: 'create',
        scope: 'organization',
      }),
    )
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants'))
  })

  it('booking.create получает дефолтный scope own (не organization) — по факту из default-role-grants.ts', async () => {
    await renderPage()
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants'))

    const bookingActions = await findResourceActionsRow('Брони')
    const createButton = within(bookingActions).getByRole('button', { name: /Создать/ })
    fireEvent.click(createButton)

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants', {
        resource: 'booking',
        action: 'create',
        scope: 'own',
      }),
    )
  })

  it('отзыв права (клик по выданному) спрашивает причину и зовёт POST .../revoke с id/version гранта', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('ушёл на другую позицию')
    await renderPage()
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants'))

    const leadActions = await findResourceActionsRow('Лиды')
    const readButton = within(leadActions).getByRole('button', { name: /Просмотр/ })
    fireEvent.click(readButton)

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants/g-1/revoke', {
        expectedVersion: 1,
        reason: 'ушёл на другую позицию',
      }),
    )
    promptSpy.mockRestore()
  })

  it('пустая причина отмены отзыва — revoke не вызывается', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('   ')
    await renderPage()
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/v1/organizations/org-1/positions/pos-1/grants'))

    const leadActions = await findResourceActionsRow('Лиды')
    const readButton = within(leadActions).getByRole('button', { name: /Просмотр/ })
    fireEvent.click(readButton)

    await new Promise((r) => setTimeout(r, 0))
    expect(postMock).not.toHaveBeenCalledWith(expect.stringContaining('/revoke'), expect.anything())
    promptSpy.mockRestore()
  })

  it('строки без реального resource.action задизейблены (текст виден, кнопки нет)', async () => {
    await renderPage()

    expect(await screen.findByText('Рассылки, блокировки, подмены')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Рассылки/ })).toBeNull()
  })
})

describe('TeamAccessPage.tsx не импортирует MOCK_USERS', () => {
  it('исходник компонента не ссылается на MOCK_USERS', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/team/TeamAccessPage.tsx'),
      'utf8',
    )
    expect(source).not.toContain('MOCK_USERS')
  })
})
