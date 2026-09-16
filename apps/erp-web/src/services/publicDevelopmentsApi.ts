import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Каталог опубликованных ЖК платформы
 * (apps/api/src/modules/publication/public.controller.ts, без авторизации).
 *
 * Нужен там, где агентство выбирает ЧУЖОЙ комплекс: фиксация клиента у
 * застройщика. Карточка витрины адресуется slug'ом — идентификатора у неё
 * нет, поэтому наружу отдаётся и принимается именно он.
 */

export interface PublicDevelopmentCard {
  slug: string
  name: string
  location: { country?: string; city?: string; address?: string } | null
  publisher: { name?: string } | null
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

export const publicDevelopmentsApi = {
  /** GET /api/v1/public/developments?city=&limit= — поиска по названию на сервере нет, фильтр по городу есть. */
  async list(params: { city?: string; limit?: number } = {}): Promise<PublicDevelopmentCard[]> {
    const { data } = await api.get<{ items: PublicDevelopmentCard[] }>('/api/v1/public/developments', {
      params: { city: params.city || undefined, limit: params.limit ?? 50 },
    })
    return data.items
  },
}
