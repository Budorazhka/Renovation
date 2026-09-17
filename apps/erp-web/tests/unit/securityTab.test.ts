/** @vitest-environment jsdom */

/**
 * До 17.09.2026 SecurityTab был полностью на MOCK_SESSIONS — три
 * захардкоженные сессии с вымышленными IP/городами/датой прямо в JSX, а
 * кнопки «Завершить» работали только над локальным React state, ни одного
 * вызова API. Теперь список читается через platformAuthApi.listSessions,
 * отзыв — через platformAuthApi.revokeSession.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const listSessionsMock = vi.fn()
const revokeSessionMock = vi.fn()

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string, paramsOrFallback?: string) => (typeof paramsOrFallback === 'string' ? paramsOrFallback : key) }),
}))

vi.mock('@/services/platformAuthApi', () => ({
  platformAuthApi: {
    listSessions: listSessionsMock,
    revokeSession: revokeSessionMock,
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderSecurityTab() {
  const { SecurityTab } = await import('@/components/settings/SecurityTab')
  render(createElement(SecurityTab))
}

const SESSIONS = [
  { id: 'sess-current', ipAddress: '10.0.0.1', userAgent: 'Mozilla/5.0 Chrome/128.0 Windows NT 10.0', createdAt: new Date().toISOString(), current: true },
  { id: 'sess-other', ipAddress: '10.0.0.2', userAgent: 'Mozilla/5.0 Firefox/128.0 Macintosh Mac OS X', createdAt: new Date().toISOString(), current: false },
]

describe('SecurityTab', () => {
  it('отрисовывает реальные сессии из platformAuthApi.listSessions', async () => {
    listSessionsMock.mockResolvedValue(SESSIONS)

    await renderSecurityTab()

    await waitFor(() => expect(screen.getByText('10.0.0.1', { exact: false })).toBeTruthy())
    expect(screen.getByText('10.0.0.2', { exact: false })).toBeTruthy()
  })

  it('текущая сессия помечена и без кнопки «завершить»', async () => {
    listSessionsMock.mockResolvedValue(SESSIONS)

    await renderSecurityTab()

    await waitFor(() => expect(screen.getByText('settings.securityTab.текущая')).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'settings.securityTab.завершить' })).toHaveLength(1)
  })

  it('отзыв конкретной сессии вызывает platformAuthApi.revokeSession(id) и убирает её из списка', async () => {
    listSessionsMock.mockResolvedValue(SESSIONS)
    revokeSessionMock.mockResolvedValue(undefined)

    await renderSecurityTab()

    await waitFor(() => expect(screen.getByText('10.0.0.2', { exact: false })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'settings.securityTab.завершить' }))

    await waitFor(() => expect(revokeSessionMock).toHaveBeenCalledWith('sess-other'))
    await waitFor(() => expect(screen.queryByText('10.0.0.2', { exact: false })).toBeNull())
  })

  it('ошибка загрузки списка показывает сообщение об ошибке, не пустой список молча', async () => {
    listSessionsMock.mockRejectedValue(new Error('network'))

    await renderSecurityTab()

    await waitFor(() => expect(screen.getByText(/Не удалось загрузить/)).toBeTruthy())
  })
})
