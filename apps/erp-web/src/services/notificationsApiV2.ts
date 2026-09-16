import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Свои настройки уведомлений (apps/api/src/modules/notifications):
 *
 * - GET    /api/v1/me/notifications                — почта и Telegram
 * - PUT    /api/v1/me/notifications                — что присылать
 * - POST   /api/v1/me/notifications/telegram-link  — ссылка t.me/<бот>?start=<код> на 15 минут
 * - DELETE /api/v1/me/notifications/telegram       — отвязать Telegram
 */

export interface NotificationSettings {
  email: {
    /** Адрес из логина; null — логин не адрес почты, письма не придут. */
    address: string | null
    news: boolean
    /** Настроена ли почта на сервере. */
    configured: boolean
  }
  telegram: {
    linked: boolean
    username: string | null
    news: boolean
    /** Настроен ли бот уведомлений на сервере. */
    configured: boolean
  }
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

export const notificationsApiV2 = {
  async get(): Promise<NotificationSettings> {
    const { data } = await api.get<NotificationSettings>('/api/v1/me/notifications')
    return data
  },

  async update(preferences: { newsEmail?: boolean; newsTelegram?: boolean }): Promise<NotificationSettings> {
    const { data } = await api.put<NotificationSettings>('/api/v1/me/notifications', preferences)
    return data
  },

  async createTelegramLink(): Promise<{ url: string; expiresAt: string }> {
    const { data } = await api.post<{ url: string; expiresAt: string }>('/api/v1/me/notifications/telegram-link')
    return data
  },

  async unlinkTelegram(): Promise<void> {
    await api.delete('/api/v1/me/notifications/telegram')
  },
}
