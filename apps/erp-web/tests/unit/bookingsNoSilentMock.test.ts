/**
 * Брони квартир новостройки (N-21) переведены с `data/bookings-mock`
 * (BOOKINGS_MOCK, локальный React-state) на реальный API `/api/v1/bookings`
 * через `bookingsApiV2` + `developmentsApiV2` (тот же реальный контур, что
 * уже был у SalesBookingsPage/BookingsPanelV2). "Фиксация клиента" и "бронь
 * вторички" убраны из экрана по решению владельца — у Booking на сервере нет
 * ни client-only записи (для неё есть отдельный реальный модуль
 * client-registrations), ни listingId. Ловит регресс: если кто-то снова
 * заимпортирует мок-источник в экран броней или каталог ЖК, они опять начнут
 * молча показывать вымышленные данные.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const DEAD_MOCK_MARKERS = ['bookings-mock', 'bookings-catalog-mock', 'BOOKINGS_MOCK']

describe('брони и каталог ЖК ERP не импортируют мок-источники броней', () => {
  it('BookingsPage.tsx не ссылается на мок-хранилище броней', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/bookings/BookingsPage.tsx'), 'utf8')
    for (const marker of DEAD_MOCK_MARKERS) {
      expect(source).not.toContain(marker)
    }
    expect(source).toContain("from '@/services/bookingsApiV2'")
    expect(source).toContain("from '@/services/developmentsApiV2'")
  })

  it('NewBuildingsCatalogPage.tsx не ссылается на мок-хранилище броней', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/newbuild/NewBuildingsCatalogPage.tsx'), 'utf8')
    for (const marker of DEAD_MOCK_MARKERS) {
      expect(source).not.toContain(marker)
    }
    expect(source).toContain("from '@/services/developmentsApiV2'")
  })

  it('NewBuildingsObjectsCommissionsPage.tsx не ссылается на мок-хранилище и читает комиссии через реальный API', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/newbuild/NewBuildingsObjectsCommissionsPage.tsx'), 'utf8')
    for (const marker of DEAD_MOCK_MARKERS) {
      expect(source).not.toContain(marker)
    }
    expect(source).toContain("from '@/services/developmentsApiV2'")
    expect(source).toContain("from '@/services/commissionRulesApiV2'")
  })

  it('маршруты фиксации клиента редиректят на реальный client-registrations экран', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    expect(source).toContain('bookings/register-client')
    expect(source).toContain('/dashboard/development/management/registrations')
  })
})
