/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const me = vi.fn()
const login = vi.fn()
const ensureSelf = vi.fn()
const developersEnsureSelf = vi.fn()

vi.mock('@/services/platformAuthApi', () => ({
  platformAuthApi: {
    login: (...args: unknown[]) => login(...args),
    logout: vi.fn().mockResolvedValue({ loggedOut: true }),
    me: () => me(),
  },
}))

vi.mock('@/services/teamApi', () => ({
  teamApi: {
    ensureSelf: () => ensureSelf(),
    ensureTeam: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('@/services/developersApi', () => ({
  developersApi: { ensureSelf: () => developersEnsureSelf() },
}))

vi.mock('@/services/messengerApi', () => ({
  messengerApi: {
    login: vi.fn().mockResolvedValue({}),
    syncTeam: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('@/services/messengerSocket', () => ({
  authenticateMessengerSocket: vi.fn(),
}))

import { AuthProvider, useAuth } from '@/context/AuthContext'

const ME_RESPONSE = {
  identity: { id: 'id-1', login: 'owner@agency.com', status: 'active' },
  organization: { id: 'org-42', name: 'АН Премиум', type: 'agency', status: 'active' },
  position: {
    id: 'pos-7',
    role: 'owner',
    displayName: 'Артём Власов',
    parentPositionId: null,
  },
  permissions: [{ resource: 'lead', action: 'read', scope: 'organization' }],
}

/** Пробник: даёт тесту дотянуться до currentUser и до login() из контекста. */
function Probe(): ReactElement {
  const { currentUser, login: doLogin } = useAuth()
  return createElement(
    'div',
    null,
    createElement('button', { onClick: () => void doLogin('owner@agency.com', 'pw') }, 'войти'),
    createElement('span', { 'data-testid': 'company-id' }, currentUser?.companyId ?? '—'),
    createElement('span', { 'data-testid': 'company-name' }, currentUser?.companyName ?? '—'),
    createElement('span', { 'data-testid': 'role' }, currentUser?.role ?? '—'),
    createElement('span', { 'data-testid': 'position-id' }, currentUser?.positionId ?? '—'),
    createElement(
      'span',
      { 'data-testid': 'permissions' },
      currentUser?.serverPermissions ? String(currentUser.serverPermissions.length) : 'нет',
    ),
  )
}

async function loginAndSettle(): Promise<void> {
  render(createElement(AuthProvider, null, createElement(Probe)))
  await act(async () => {
    screen.getByText('войти').click()
  })
}

describe('AuthContext: контекст сессии приходит из GET /me', () => {
  beforeEach(() => {
    // В проекте нет общего setup-файла для vitest, поэтому автоочистки DOM
    // между тестами не происходит — без этого второй render находит два
    // одинаковых узла и падает на getByText.
    cleanup()
    window.localStorage.clear()
    vi.clearAllMocks()
    login.mockResolvedValue({ identityId: 'id-1', requires2fa: false })
    developersEnsureSelf.mockResolvedValue(null)
  })

  it('организация, роль и права берутся из /me, а не из team-users', async () => {
    me.mockResolvedValue(ME_RESPONSE)
    // team-users отдаёт другую организацию и другую роль: /me должен победить.
    ensureSelf.mockResolvedValue({
      id: 'team-user-1',
      name: 'Устаревшее имя',
      role: 'manager',
      teamId: 'org-устаревший',
      positionId: 'pos-устаревший',
      phone: '+995000000',
    })

    await loginAndSettle()

    await waitFor(() => expect(screen.getByTestId('company-id').textContent).toBe('org-42'))
    expect(screen.getByTestId('company-name').textContent).toBe('АН Премиум')
    expect(screen.getByTestId('role').textContent).toBe('owner')
    expect(screen.getByTestId('position-id').textContent).toBe('pos-7')
    expect(screen.getByTestId('permissions').textContent).toBe('1')
  })

  // developersApi.ensureSelf() ходил в легаси /api/developers/ensure-self
  // (у платформы его нет, всегда 404) и мог перетереть companyName заголовком
  // публичной карточки. С 14.09.2026 при входе он не вызывается вовсе.
  it('организация берётся из /me, легаси-профиль застройщика не запрашивается', async () => {
    me.mockResolvedValue(ME_RESPONSE)
    ensureSelf.mockResolvedValue(null)
    // Публичная карточка застройщика существует и отдаёт другой заголовок —
    // /me уже ответил и должен победить.
    developersEnsureSelf.mockResolvedValue({
      _id: 'dev-profile-1',
      title: 'Маркетинговое название карточки',
      email: 'dev@example.test',
      status: 'active',
      rating: 0,
      author: null,
      createdAt: null,
      updatedAt: null,
    })

    await loginAndSettle()

    await waitFor(() => expect(screen.getByTestId('company-id').textContent).toBe('org-42'))
    expect(screen.getByTestId('company-name').textContent).toBe('АН Премиум')
    expect(developersEnsureSelf).not.toHaveBeenCalled()
  })

  it('при недоступном /me реальный пользователь не попадает в мок-компанию c1', async () => {
    me.mockRejectedValue(new Error('503'))
    // Ни /me, ни team-users не дали организацию — раньше здесь подставлялся
    // идентификатор мок-компании Estate Group, и человек молча оказывался в
    // чужом скоупе.
    ensureSelf.mockResolvedValue(null)

    await loginAndSettle()

    await waitFor(() => expect(screen.getByTestId('role').textContent).not.toBe('—'))
    expect(screen.getByTestId('company-id').textContent).not.toBe('c1')
    expect(screen.getByTestId('permissions').textContent).toBe('нет')
  })
})

/**
 * До 17.09.2026 login() принимал пары вида (owner, '1') из MOCK_USERS в обход
 * platformAuthApi — реальная сессия и cookie не требовались вовсе. Ловит
 * регресс: если бэкдор вернётся, эти пароли снова начнут работать без
 * обращения к реальному backend.
 */
describe('AuthContext: бэкдор-логин MOCK_USERS закрыт', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.clearAllMocks()
    developersEnsureSelf.mockResolvedValue(null)
  })

  it.each(['owner', 'director', 'rop', 'manager', 'administrator', 'developer'])(
    'login(%s, "1") идёт через platformAuthApi, а не подменяется локальным списком',
    async (mockLogin) => {
      login.mockRejectedValue(new Error('401'))
      ensureSelf.mockResolvedValue(null)

      let result: string | undefined
      function Probe(): ReactElement {
        const { login: doLogin } = useAuth()
        return createElement('button', {
          onClick: () => void doLogin(mockLogin, '1').then((r) => { result = r }),
        }, 'войти')
      }

      render(createElement(AuthProvider, null, createElement(Probe)))
      await act(async () => {
        screen.getByText('войти').click()
      })

      // Реальный login() был вызван с этими же login/password — не перехвачен раньше.
      expect(login).toHaveBeenCalledWith({ login: mockLogin, password: '1' })
      // Раз platformAuthApi отклонил пароль — результат должен быть 'invalid', а
      // не 'ok' от локального совпадения с MOCK_USERS.
      expect(result).toBe('invalid')
    },
  )
})
