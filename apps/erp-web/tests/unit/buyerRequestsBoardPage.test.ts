/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buyerRequestsApi } from '@/services/buyerRequestsApi'
import type { BuyerRequestResponseView, BuyerRequestView } from '@/types/buyerRequests'
import BuyerRequestsBoardPage from '@/pages/buyer-requests/BuyerRequestsBoardPage'

const DICT: Record<string, string> = {
  'buyerRequests.title': 'Запросы покупателей',
  'buyerRequests.subtitle': 'Публичная доска запросов на покупку и аренду',
  'buyerRequests.refresh': 'Обновить',
  'buyerRequests.total': 'Всего запросов',
  'buyerRequests.loading': 'Загружаем запросы…',
  'buyerRequests.empty': 'Запросов пока нет',
  'buyerRequests.emptyFiltered': 'По этим условиям запросов не нашлось',
  'buyerRequests.errorTitle': 'Не удалось загрузить запросы',
  'buyerRequests.retry': 'Попробовать снова',
  'buyerRequests.loadMore': 'Показать ещё',
  'buyerRequests.loadingMore': 'Загружаем…',
  'buyerRequests.filters.dealTypeAria': 'Фильтр по типу сделки',
  'buyerRequests.filters.all': 'Все',
  'buyerRequests.filters.buy': 'Покупка',
  'buyerRequests.filters.rent': 'Аренда',
  'buyerRequests.filters.cityLabel': 'Город',
  'buyerRequests.filters.cityPlaceholder': 'Город',
  'buyerRequests.filters.cityApply': 'Применить',
  'buyerRequests.filters.cityReset': 'Сбросить',
  'buyerRequests.card.dealTypeBuy': 'Покупка',
  'buyerRequests.card.dealTypeRent': 'Аренда',
  'buyerRequests.card.city': 'Город',
  'buyerRequests.card.propertyKind': 'Тип объекта',
  'buyerRequests.card.budget': 'Бюджет',
  'buyerRequests.card.budgetTotal': 'до {amount}',
  'buyerRequests.card.budgetPerMonth': '{amount} / мес',
  'buyerRequests.card.revealPhone': 'Показать телефон',
  'buyerRequests.card.revealing': 'Показываем…',
  'buyerRequests.card.respond': 'Откликнуться',
  'buyerRequests.card.editResponse': 'Изменить отклик',
  'buyerRequests.card.respondedLabel': 'Вы откликнулись {date}',
  'buyerRequests.form.messageLabel': 'Сообщение покупателю',
  'buyerRequests.form.messagePlaceholder': 'Опишите, что вы можете предложить',
  'buyerRequests.form.submit': 'Отправить отклик',
  'buyerRequests.form.submitting': 'Отправляем…',
  'buyerRequests.form.cancel': 'Отмена',
  'buyerRequests.form.error': 'Не удалось отправить отклик. Попробуйте ещё раз.',
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, key) => (params[key] !== undefined ? String(params[key]) : match))
}

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => interpolate(DICT[key] || key, params),
  }),
}))

vi.mock('@/services/buyerRequestsApi', () => ({
  buyerRequestsApi: {
    listPublic: vi.fn(),
    revealPhone: vi.fn(),
    respond: vi.fn(),
    listMyResponses: vi.fn(),
    listAllMyResponses: vi.fn(),
  },
}))

const REQUEST_A: BuyerRequestView = {
  id: 'req-1',
  dealType: 'buy',
  city: 'Батуми',
  propertyKind: 'newbuild',
  title: 'Куплю двушку в центре Батуми',
  comment: 'Рассмотрю варианты в новостройках.',
  budget: { amount: 90000, currency: 'USD', perMonth: false },
  status: 'published',
  createdAt: '2026-09-14T00:00:00.000Z',
}

const REQUEST_B: BuyerRequestView = {
  id: 'req-2',
  dealType: 'rent',
  city: 'Тбилиси',
  propertyKind: 'secondary',
  title: 'Сниму квартиру в Ваке',
  comment: 'От года, с ремонтом.',
  budget: { amount: 700, currency: 'USD', perMonth: true },
  status: 'published',
  createdAt: '2026-09-13T00:00:00.000Z',
}

describe('BuyerRequestsBoardPage', () => {
  beforeEach(() => {
    vi.mocked(buyerRequestsApi.listPublic).mockReset()
    vi.mocked(buyerRequestsApi.revealPhone).mockReset()
    vi.mocked(buyerRequestsApi.respond).mockReset()
    vi.mocked(buyerRequestsApi.listAllMyResponses).mockReset()
    vi.mocked(buyerRequestsApi.listAllMyResponses).mockResolvedValue({ items: [], complete: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('отображает состояние загрузки при первом рендере', async () => {
    let resolvePromise: (value: { items: BuyerRequestView[]; nextCursor: string | null }) => void = () => {}
    const pending = new Promise<{ items: BuyerRequestView[]; nextCursor: string | null }>((resolve) => {
      resolvePromise = resolve
    })
    vi.mocked(buyerRequestsApi.listPublic).mockReturnValue(pending)

    render(createElement(BuyerRequestsBoardPage))

    expect(screen.getByTestId('buyer-requests-loading')).toBeDefined()

    await act(async () => {
      resolvePromise({ items: [], nextCursor: null })
    })
  })

  it('отображает список запросов, полученных из реального API', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [REQUEST_A, REQUEST_B], nextCursor: null })

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => {
      expect(screen.getByTestId('buyer-requests-list')).toBeDefined()
    })

    expect(screen.getByText('Куплю двушку в центре Батуми')).toBeDefined()
    expect(screen.getByText('Сниму квартиру в Ваке')).toBeDefined()
    expect(buyerRequestsApi.listPublic).toHaveBeenCalledWith({ dealType: undefined, city: undefined })
  })

  it('отображает состояние пустого списка при отсутствии запросов', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [], nextCursor: null })

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => {
      expect(screen.getByTestId('buyer-requests-empty')).toBeDefined()
    })
    expect(screen.getByText('Запросов пока нет')).toBeDefined()
  })

  it('отображает ошибку API и даёт возможность повторить запрос', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockRejectedValueOnce(new Error('Network unavailable'))

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => {
      expect(screen.getByTestId('buyer-requests-error')).toBeDefined()
    })
    expect(screen.getByText('Network unavailable')).toBeDefined()

    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [REQUEST_A], nextCursor: null })
    await act(async () => {
      fireEvent.click(screen.getByText('Попробовать снова'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('buyer-requests-list')).toBeDefined()
    })
  })

  it('переключение вкладки типа сделки перезапрашивает доску с фильтром', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [REQUEST_A], nextCursor: null })

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => {
      expect(screen.getByTestId('buyer-requests-list')).toBeDefined()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }))
    })

    expect(buyerRequestsApi.listPublic).toHaveBeenLastCalledWith({ dealType: 'rent', city: undefined })
  })

  it('раскрывает телефон только по клику на кнопку', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [REQUEST_A], nextCursor: null })
    vi.mocked(buyerRequestsApi.revealPhone).mockResolvedValue({ phone: '+995 599 00 00 01' })

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => expect(screen.getByText('Куплю двушку в центре Батуми')).toBeDefined())
    expect(screen.queryByText(/\+995/)).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Показать телефон' }))
    })

    await waitFor(() => expect(screen.getByText('+995 599 00 00 01')).toBeDefined())
    expect(buyerRequestsApi.revealPhone).toHaveBeenCalledWith('req-1')
  })

  it('отправляет отклик через реальный API и переключает карточку в режим «уже откликнулись»', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [REQUEST_A], nextCursor: null })
    const responseView: BuyerRequestResponseView = {
      id: 'resp-1',
      buyerRequestId: 'req-1',
      message: 'Есть студия за $85000 в этом же районе',
      updatedAt: '2026-09-14T10:00:00.000Z',
    }
    vi.mocked(buyerRequestsApi.respond).mockResolvedValue(responseView)

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => expect(screen.getByText('Куплю двушку в центре Батуми')).toBeDefined())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Откликнуться' }))
    })

    const textarea = screen.getByLabelText('Сообщение покупателю')
    fireEvent.change(textarea, { target: { value: responseView.message } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить отклик' }))
    })

    expect(buyerRequestsApi.respond).toHaveBeenCalledWith('req-1', responseView.message)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Изменить отклик' })).toBeDefined()
      expect(screen.getByText(responseView.message)).toBeDefined()
    })
  })

  it('уже загруженные свои отклики помечают карточку как отвеченную сразу при открытии доски', async () => {
    vi.mocked(buyerRequestsApi.listPublic).mockResolvedValue({ items: [REQUEST_A], nextCursor: null })
    vi.mocked(buyerRequestsApi.listAllMyResponses).mockResolvedValue({
      items: [{ id: 'resp-1', buyerRequestId: 'req-1', message: 'Уже предложили вариант', updatedAt: '2026-09-14T09:00:00.000Z' }],
      complete: true,
    })

    render(createElement(BuyerRequestsBoardPage))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Изменить отклик' })).toBeDefined()
    })
    expect(screen.queryByRole('button', { name: 'Откликнуться' })).toBeNull()
  })
})
