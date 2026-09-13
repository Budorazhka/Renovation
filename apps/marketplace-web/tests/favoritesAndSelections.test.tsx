/** @vitest-environment jsdom */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { FavoritesPage } from '../src/pages/FavoritesPage'
import { SelectionsPage } from '../src/pages/SelectionsPage'
import { SelectionDetailPage } from '../src/pages/SelectionDetailPage'
import { MySelectionDetailPage } from '../src/pages/MySelectionDetailPage'
import { marketplaceApi } from '../src/api/marketplace-api'
import { publishingApi, PublishingApiError } from '../src/features/publishing/api/publishing-api'

vi.mock('../src/features/publishing/api/publishing-api', async () => {
  const actual = await vi.importActual<typeof import('../src/features/publishing/api/publishing-api')>(
    '../src/features/publishing/api/publishing-api',
  )
  return {
    ...actual,
    publishingApi: {
      listFavorites: vi.fn(),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
      listSelections: vi.fn(),
      createSelection: vi.fn(),
      renameSelection: vi.fn(),
      deleteSelection: vi.fn(),
      addSelectionItem: vi.fn(),
      removeSelectionItem: vi.fn(),
    },
  }
})

vi.mock('../src/api/marketplace-api', () => ({
  marketplaceApi: {
    getPublicSelection: vi.fn(),
    getPublicMarketplaceSelection: vi.fn(),
    listDevelopments: vi.fn(),
    listListings: vi.fn(),
    getDevelopment: vi.fn(),
    getListing: vi.fn(),
    revealDevelopmentContact: vi.fn(),
    revealListingContact: vi.fn(),
  },
  MarketplaceApiError: class extends Error {
    constructor(msg: string, readonly status: number) {
      super(msg)
      this.name = 'MarketplaceApiError'
    }
  },
}))

describe('Favorites & Selections Acceptance (MKT-SCR-017, MKT-SCR-018)', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  /**
   * Избранное снято с фикстур 04.09.2026. До этого страница показывала
   * захардкоженный список, никак не связанный с тем, что человек нажимал на
   * карточках: сердечко было локальным useState(false) и ничего не сохраняло.
   */
  describe('Избранное покупателя (MKT-SCR-017)', () => {
    const ENTRIES = [
      { targetType: 'listing' as const, slug: 'kvartira-more', createdAt: '2026-09-02T10:00:00.000Z' },
    ]

    const LISTING = {
      slug: 'kvartira-more',
      dealType: 'sale' as const,
      propertyType: 'apartment' as const,
      price: { amountMinorUnits: 8_500_000, currency: 'USD' },
      characteristics: { rooms: 2, area: 65, floor: 12, totalFloors: 24 },
      location: { city: 'Батуми', address: 'ул. Химшиашвили, 15' },
    }

    it('показывает то, что пользователь действительно сохранил', async () => {
      ;(publishingApi.listFavorites as any).mockResolvedValue(ENTRIES)
      ;(marketplaceApi.getListing as any).mockResolvedValue(LISTING)

      render(
        <MemoryRouter>
          <FavoritesPage />
        </MemoryRouter>,
      )

      expect(await screen.findByText(/Химшиашвили/)).toBeDefined()
      expect((publishingApi.listFavorites as any)).toHaveBeenCalled()
    })

    it('удаление уходит на сервер, а не только из локального списка', async () => {
      ;(publishingApi.listFavorites as any).mockResolvedValue(ENTRIES)
      ;(marketplaceApi.getListing as any).mockResolvedValue(LISTING)
      ;(publishingApi.removeFavorite as any).mockResolvedValue({ removed: true })

      render(
        <MemoryRouter>
          <FavoritesPage />
        </MemoryRouter>,
      )

      await screen.findByText(/Химшиашвили/)
      fireEvent.click(screen.getAllByRole('button', { name: /Удалить/i })[0])

      expect(publishingApi.removeFavorite).toHaveBeenCalledWith({
        targetType: 'listing',
        slug: 'kvartira-more',
      })
    })

    it('гостю предлагает войти, а не пустой список', async () => {
      // Именно PublishingApiError, а не любая ошибка со status: страница
      // проверяет тип, и подделка прошла бы мимо этой ветки.
      ;(publishingApi.listFavorites as any).mockRejectedValue(
        new PublishingApiError('unauthorized', 401),
      )

      render(
        <MemoryRouter>
          <FavoritesPage />
        </MemoryRouter>,
      )

      expect(await screen.findByText(/Избранное хранится в вашем аккаунте/)).toBeDefined()
      expect(screen.getByRole('link', { name: 'Войти' }).getAttribute('href')).toContain('/auth/login')
    })

    it('снятый с публикации объект пропускается, страница не падает', async () => {
      ;(publishingApi.listFavorites as any).mockResolvedValue(ENTRIES)
      ;(marketplaceApi.getListing as any).mockRejectedValue(new Error('404'))

      render(
        <MemoryRouter>
          <FavoritesPage />
        </MemoryRouter>,
      )

      expect(await screen.findByRole('heading', { level: 1, name: /Избранное/i })).toBeDefined()
      expect(screen.queryByText(/Химшиашвили/)).toBeNull()
    })
  })

  /**
   * Страница подборки переписана 04.09.2026. Раньше она игнорировала токен и
   * всем показывала одну и ту же декорацию: выдуманные объекты, выдуманного
   * эксперта «Георгий Беридзе» и выдуманный номер WhatsApp. Тест это поведение
   * закреплял, поэтому переписан вместе со страницей.
   */
  describe('Персональная подборка по ссылке (MKT-SCR-018)', () => {
    const SELECTION = {
      title: 'Подборка для инвестора',
      clientName: 'Анна',
      agentNote: 'Отобрал по вашему бюджету',
      status: 'viewed',
      items: [
        {
          unitId: 'unit-1',
          agentNote: 'Лучший вид из этой линии',
          unit: {
            number: '42',
            kind: 'apartment',
            rooms: 2,
            area: 65,
            price: { amountMinorUnits: 8_500_000, currency: 'USD' },
            status: 'available',
          },
        },
      ],
      createdAt: '2026-09-01T10:00:00.000Z',
      viewCount: 1,
    }

    function renderSelection() {
      return render(
        <MemoryRouter initialEntries={['/selections/token-abc']}>
          <Routes>
            <Route path="/selections/:slug" element={<SelectionDetailPage />} />
          </Routes>
        </MemoryRouter>,
      )
    }

    it('показывает объекты и заметки из подборки, а не декорацию', async () => {
      ;(marketplaceApi.getPublicSelection as any).mockResolvedValue(SELECTION)
      renderSelection()

      expect(await screen.findByRole('heading', { level: 1, name: 'Подборка для инвестора' })).toBeDefined()
      expect(screen.getByText('Квартира №42')).toBeDefined()
      expect(screen.getByText('85 000 USD')).toBeDefined()
      expect(screen.getByText('Лучший вид из этой линии')).toBeDefined()
      // Выдуманного эксперта на странице больше нет.
      expect(screen.queryByText('Георгий Беридзе')).toBeNull()
    })

    it('запрашивает подборку именно по токену из адреса', async () => {
      ;(marketplaceApi.getPublicSelection as any).mockResolvedValue(SELECTION)
      renderSelection()

      await screen.findByText('Квартира №42')
      expect((marketplaceApi.getPublicSelection as any).mock.calls[0][0]).toBe('token-abc')
    })

    it('устаревшая ссылка честно говорит об этом', async () => {
      const notFound = Object.assign(new Error('not found'), { status: 404 })
      ;(marketplaceApi.getPublicSelection as any).mockRejectedValue(notFound)
      renderSelection()

      expect(await screen.findByText(/Подборка не найдена/)).toBeDefined()
    })

    it('пропавший объект показывается пометкой, а не пустой карточкой', async () => {
      ;(marketplaceApi.getPublicSelection as any).mockResolvedValue({
        ...SELECTION,
        items: [{ unitId: 'unit-gone' }],
      })
      renderSelection()

      expect(await screen.findByText('Объект больше недоступен')).toBeDefined()
    })
  })

  /**
   * N-11 (roadmap-2026-09.md, решение владельца 07.09.2026): подборки
   * покупателя переехали в localStorage-модели на сервер, у аккаунта —
   * открываются с любого устройства и по ссылке. До этой работы backend для
   * личных подборок покупателя не существовал вовсе (проверено 10.09.2026):
   * apps/api/src/modules/selections — CRM-подборки агента, organization-
   * scoped, не для marketplace-покупателя.
   */
  describe('Управление подборками клиента (SelectionsPage)', () => {
    const ENTRY = {
      id: 'sel-1',
      title: 'Для семьи',
      items: [],
      publicToken: 'token-abc',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    }

    it('по умолчанию показывает честное пустое состояние, без захардкоженных подборок', async () => {
      ;(publishingApi.listSelections as any).mockResolvedValue([])

      render(
        <MemoryRouter>
          <SelectionsPage />
        </MemoryRouter>,
      )

      expect(await screen.findByText(/У вас пока нет созданных подборок/)).toBeDefined()
      expect(screen.queryByText(/Orbi City/)).toBeNull()
    })

    it('гостю предлагает войти, а не пустой список', async () => {
      ;(publishingApi.listSelections as any).mockRejectedValue(new PublishingApiError('unauthorized', 401))

      render(
        <MemoryRouter>
          <SelectionsPage />
        </MemoryRouter>,
      )

      expect(await screen.findByText(/Подборки хранятся в вашем аккаунте/)).toBeDefined()
      expect(screen.getByRole('link', { name: 'Войти' }).getAttribute('href')).toContain('/auth/login')
    })

    it('создаёт новую подборку через сервер', async () => {
      ;(publishingApi.listSelections as any).mockResolvedValue([])
      ;(publishingApi.createSelection as any).mockResolvedValue({
        id: 'sel-new',
        title: 'Новая подборка (1)',
        items: [],
        publicToken: 'token-new',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
      })

      render(
        <MemoryRouter>
          <SelectionsPage />
        </MemoryRouter>,
      )

      await screen.findByText(/У вас пока нет созданных подборок/)
      fireEvent.click(screen.getByTestId('new-collection-btn'))

      expect(await screen.findByDisplayValue(/Новая подборка/)).toBeDefined()
      expect(publishingApi.createSelection).toHaveBeenCalledWith(expect.stringContaining('Новая подборка'))
    })

    it('переименование сохраняется на сервере по blur, не на каждую букву', async () => {
      ;(publishingApi.listSelections as any).mockResolvedValue([ENTRY])
      ;(publishingApi.renameSelection as any).mockResolvedValue({ ...ENTRY, title: 'Обновлённое название' })

      render(
        <MemoryRouter>
          <SelectionsPage />
        </MemoryRouter>,
      )

      const input = await screen.findByDisplayValue('Для семьи')
      fireEvent.change(input, { target: { value: 'Обновлённое название' } })
      expect(publishingApi.renameSelection).not.toHaveBeenCalled()

      fireEvent.blur(input)
      await waitFor(() => {
        expect(publishingApi.renameSelection).toHaveBeenCalledWith('sel-1', 'Обновлённое название')
      })
    })

    it('удаление уходит на сервер', async () => {
      ;(publishingApi.listSelections as any).mockResolvedValue([ENTRY])
      ;(publishingApi.deleteSelection as any).mockResolvedValue({ removed: true })

      render(
        <MemoryRouter>
          <SelectionsPage />
        </MemoryRouter>,
      )

      await screen.findByDisplayValue('Для семьи')
      fireEvent.click(screen.getByTitle('Удалить подборку'))

      expect(publishingApi.deleteSelection).toHaveBeenCalledWith('sel-1')
      await waitFor(() => {
        expect(screen.queryByDisplayValue('Для семьи')).toBeNull()
      })
    })

    it('ссылка «Витрина» ведёт на новый маршрут /my-selection/:token, не на /selections/:slug', async () => {
      ;(publishingApi.listSelections as any).mockResolvedValue([ENTRY])

      render(
        <MemoryRouter>
          <SelectionsPage />
        </MemoryRouter>,
      )

      await screen.findByDisplayValue('Для семьи')
      const showcaseLink = screen.getByRole('link', { name: /Витрина/ })
      expect(showcaseLink.getAttribute('href')).toBe('/my-selection/token-abc')
    })
  })

  /**
   * N-11: страница подборки покупателя по публичной ссылке — отдельная от
   * SelectionDetailPage (агентские CRM-подборки) во избежание коллизии
   * маршрутов /selections/:slug.
   */
  describe('Подборка покупателя по ссылке (MySelectionDetailPage, N-11)', () => {
    function renderMySelection() {
      return render(
        <MemoryRouter initialEntries={['/my-selection/token-abc']}>
          <Routes>
            <Route path="/my-selection/:token" element={<MySelectionDetailPage />} />
          </Routes>
        </MemoryRouter>,
      )
    }

    it('показывает объекты подборки, дочитанные публичным каталогом', async () => {
      ;(marketplaceApi.getPublicMarketplaceSelection as any).mockResolvedValue({
        title: 'Для семьи',
        items: [{ targetType: 'listing', slug: 'kvartira-more' }],
        createdAt: '2026-09-01T10:00:00.000Z',
      })
      ;(marketplaceApi.getListing as any).mockResolvedValue({
        slug: 'kvartira-more',
        dealType: 'sale',
        propertyType: 'apartment',
        price: { amountMinorUnits: 8_500_000, currency: 'USD' },
        characteristics: { rooms: 2, area: 65, floor: 12, totalFloors: 24 },
        location: { city: 'Батуми', address: 'ул. Химшиашвили, 15' },
      })

      renderMySelection()

      expect(await screen.findByRole('heading', { level: 1, name: 'Для семьи' })).toBeDefined()
      expect(await screen.findByText(/Химшиашвили/)).toBeDefined()
      expect(marketplaceApi.getPublicMarketplaceSelection).toHaveBeenCalledWith(
        'token-abc',
        expect.anything(),
      )
    })

    it('устаревшая ссылка честно говорит об этом', async () => {
      const notFound = Object.assign(new Error('not found'), { status: 404 })
      ;(marketplaceApi.getPublicMarketplaceSelection as any).mockRejectedValue(notFound)

      renderMySelection()

      expect(await screen.findByText(/Подборка не найдена/)).toBeDefined()
    })

    it('снятый с публикации объект пропускается, страница не падает', async () => {
      ;(marketplaceApi.getPublicMarketplaceSelection as any).mockResolvedValue({
        title: 'Для семьи',
        items: [{ targetType: 'listing', slug: 'ghost' }],
        createdAt: '2026-09-01T10:00:00.000Z',
      })
      ;(marketplaceApi.getListing as any).mockRejectedValue(new Error('404'))

      renderMySelection()

      expect(await screen.findByRole('heading', { level: 1, name: 'Для семьи' })).toBeDefined()
      expect(await screen.findByText(/В этой подборке пока нет объектов/)).toBeDefined()
    })
  })
})
