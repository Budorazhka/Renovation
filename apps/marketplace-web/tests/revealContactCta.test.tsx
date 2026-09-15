/** @vitest-environment jsdom */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RevealContactCTA } from '../src/components/RevealContactCTA'
import { ListingContactForm } from '../src/components/ListingContactForm'
import { marketplaceApi, MarketplaceApiError } from '../src/api/marketplace-api'

/**
 * «Показать телефон» раньше слал на сервер фейкового «Посетителя сайта»
 * (+995500000000) — каждое нажатие давало мусорный лид, а при ошибке
 * показывался выдуманный номер. Лид создаётся только из формы заявки.
 */
describe('RevealContactCTA — только показ номера', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it('ЖК: запрос без данных посетителя, показывается номер застройщика с сервера', async () => {
    const spy = vi.spyOn(marketplaceApi, 'revealDevelopmentContact').mockResolvedValue({ phone: '+995 555 11 22 33' })
    render(<RevealContactCTA slug="sunset-towers" type="development" />)

    fireEvent.click(screen.getByRole('button', { name: /Показать телефон/i }))

    await waitFor(() => expect(screen.getByText('+995 555 11 22 33')).toBeDefined())
    expect(spy).toHaveBeenCalledWith('sunset-towers', {})
    expect(screen.getByText('Прямой номер застройщика:')).toBeDefined()
  })

  it('объект: подпись — номер менеджера объекта', async () => {
    const spy = vi.spyOn(marketplaceApi, 'revealListingContact').mockResolvedValue({ phone: '+995 555 44 55 66' })
    render(<RevealContactCTA slug="batumi-flat" type="listing" />)

    fireEvent.click(screen.getByRole('button', { name: /Показать телефон/i }))

    await waitFor(() => expect(screen.getByText('+995 555 44 55 66')).toBeDefined())
    expect(spy).toHaveBeenCalledWith('batumi-flat', {})
    expect(screen.getByText('Номер менеджера объекта:')).toBeDefined()
  })

  it('ошибка сервера — сообщение и повтор, выдуманного номера нет', async () => {
    vi.spyOn(marketplaceApi, 'revealDevelopmentContact').mockImplementation(() =>
      Promise.reject(new MarketplaceApiError('Слишком много запросов', 429)),
    )
    render(<RevealContactCTA slug="sunset-towers" type="development" />)

    fireEvent.click(screen.getByRole('button', { name: /Показать телефон/i }))

    await waitFor(() => expect(screen.getByText('Слишком много запросов')).toBeDefined())
    expect(screen.queryByText(/\+995 599 12 34 56/)).toBeNull()
    expect(screen.getByRole('button', { name: /Попробовать/i })).toBeDefined()
  })
})

describe('Форма заявки на странице ЖК', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it('отправляет заявку застройщику с телефоном посетителя', async () => {
    const spy = vi
      .spyOn(marketplaceApi, 'revealDevelopmentContact')
      .mockResolvedValue({ phone: '+995 555 11 22 33', leadId: 'lead-1' })
    render(<ListingContactForm slug="sunset-towers" type="development" />)

    fireEvent.change(screen.getByLabelText(/Телефон/i), { target: { value: '+995 599 00 11 22' } })
    fireEvent.change(screen.getByLabelText(/Ваше имя/i), { target: { value: 'Нино' } })
    fireEvent.click(screen.getByRole('button', { name: 'Оставить заявку' }))

    await waitFor(() => expect(screen.getByText('✓ Заявка отправлена')).toBeDefined())
    expect(spy).toHaveBeenCalledWith('sunset-towers', expect.objectContaining({ requesterPhone: '+995 599 00 11 22', requesterName: 'Нино' }))
    expect(screen.getByText('+995 555 11 22 33')).toBeDefined()
  })
})
