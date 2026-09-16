/** @vitest-environment jsdom */

/**
 * «Добавить клиента» (N-20) собирает POST /api/v1/contacts вместо
 * фиктивной карточки с выдуманными бюджетом/источником/типом. Проверяется
 * реальный payload, Idempotency-Key и честная ошибка на занятый телефон.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/services/contactsApiV2', () => ({
  contactsApiV2: { create: createMock },
  newIdempotencyKey: () => 'test-idempotency-key',
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderModal(onCreated = vi.fn()) {
  const { CreateClientModal } = await import('@/components/clients/CreateClientModal')
  render(createElement(CreateClientModal, { open: true, onClose: vi.fn(), onCreated }))
  return { onCreated }
}

describe('CreateClientModal', () => {
  it('отправляет имя/телефон/email/роли с Idempotency-Key, вызывает onCreated с ответом сервера', async () => {
    createMock.mockResolvedValue({ id: 'contact-1', name: 'Иван Иванов', phone: '+79990000000' })
    const { onCreated } = await renderModal()

    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Иван Иванов' } })
    fireEvent.change(screen.getByPlaceholderText('+7 …'), { target: { value: '+79990000000' } })
    fireEvent.click(screen.getByText('Покупатель'))
    fireEvent.click(screen.getByRole('button', { name: 'clients.createClientModal.создать' }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        { name: 'Иван Иванов', phone: '+79990000000', email: undefined, roles: ['buyer'] },
        'test-idempotency-key',
      ),
    )
    expect(onCreated).toHaveBeenCalledWith({ id: 'contact-1', name: 'Иван Иванов', phone: '+79990000000' })
  })

  it('пустой телефон — форма не отправляется, contactsApiV2.create не вызывается', async () => {
    await renderModal()

    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Иван' } })
    fireEvent.click(screen.getByRole('button', { name: 'clients.createClientModal.создать' }))

    expect(createMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Укажите телефон')).not.toBeNull()
  })

  it('CONTACT_PHONE_TAKEN — честная ошибка про занятый телефон, а не общая', async () => {
    const error = Object.assign(new Error('Conflict'), {
      isAxiosError: true,
      response: { status: 409, data: { error: { code: 'CONTACT_PHONE_TAKEN' } } },
    })
    createMock.mockRejectedValue(error)
    await renderModal()

    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Иван' } })
    fireEvent.change(screen.getByPlaceholderText('+7 …'), { target: { value: '+79990000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'clients.createClientModal.создать' }))

    expect(await screen.findByText('Клиент с таким телефоном уже есть в базе')).not.toBeNull()
  })
})
