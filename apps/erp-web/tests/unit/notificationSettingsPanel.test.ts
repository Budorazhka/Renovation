/** @vitest-environment jsdom */

/**
 * Уведомления в личном кабинете: почта из логина и привязка Telegram к боту
 * уведомлений — с сервера (/me/notifications), без выдуманных статусов.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  createTelegramLink: vi.fn(),
  unlinkTelegram: vi.fn(),
}))

vi.mock('@/services/notificationsApiV2', () => ({ notificationsApiV2: api }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const settings = (overrides: { linked?: boolean; address?: string | null; configured?: boolean } = {}) => ({
  email: { address: overrides.address === undefined ? 'owner@agency.ge' : overrides.address, news: true, configured: overrides.configured ?? true },
  telegram: { linked: overrides.linked ?? false, username: overrides.linked ? 'owner_tg' : null, news: true, configured: overrides.configured ?? true },
})

async function renderPanel() {
  const { NotificationSettingsPanel } = await import('@/components/settings/NotificationSettingsPanel')
  return render(createElement(NotificationSettingsPanel))
}

describe('NotificationSettingsPanel', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
  })

  afterEach(() => cleanup())

  it('показывает адрес из логина и статус Telegram', async () => {
    api.get.mockResolvedValue(settings({ linked: true }))
    await renderPanel()

    expect(await screen.findByText('owner@agency.ge')).toBeTruthy()
    expect(screen.getByText('notifications.telegramLinked: @owner_tg')).toBeTruthy()
    expect(screen.getByText('notifications.telegramUnlink')).toBeTruthy()
  })

  it('выключение новостей на почту сохраняется на сервере', async () => {
    api.get.mockResolvedValue(settings())
    api.update.mockResolvedValue({ ...settings(), email: { address: 'owner@agency.ge', news: false, configured: true } })
    await renderPanel()

    fireEvent.click(await screen.findByLabelText('notifications.emailNews'))

    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ newsEmail: false }))
  })

  it('«Подключить Telegram» открывает ссылку бота с одноразовым кодом', async () => {
    api.get.mockResolvedValue(settings())
    api.createTelegramLink.mockResolvedValue({ url: 'https://t.me/baza_notify_bot?start=abc', expiresAt: '2026-09-15T12:15:00.000Z' })
    const tab = { location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    await renderPanel()

    fireEvent.click(await screen.findByText('notifications.telegramConnect'))

    await waitFor(() => expect(tab.location.href).toBe('https://t.me/baza_notify_bot?start=abc'))
    expect(screen.getByText('notifications.telegramCheck')).toBeTruthy()
    open.mockRestore()
  })

  it('каналы не настроены на сервере — честно так и написано, переключатели недоступны', async () => {
    api.get.mockResolvedValue(settings({ configured: false }))
    await renderPanel()

    expect(await screen.findAllByText('notifications.notConfigured')).toHaveLength(2)
    expect((screen.getByLabelText('notifications.emailNews') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText('notifications.telegramConnect')).toBeNull()
  })
})
