/** @vitest-environment jsdom */

/**
 * До 17.09.2026 сверял введённый пароль с MOCK_USERS локально — для любого
 * реального (не демо) пользователя currentUser.id никогда не совпадал ни с
 * одним id из MOCK_USERS, поэтому диалог всегда отвечал «неверный пароль»,
 * что бы человек ни ввёл. Массовое редактирование юнитов в шахматке
 * подтвердить было нельзя в принципе. Теперь сверяет через реальный
 * POST /auth/verify-password.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const verifyPasswordMock = vi.fn()

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/services/platformAuthApi', () => ({
  platformAuthApi: { verifyPassword: verifyPasswordMock },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderModal(onConfirm = vi.fn(), onCancel = vi.fn()) {
  const { PasswordConfirmModal } = await import('@/components/common/PasswordConfirmModal')
  render(createElement(PasswordConfirmModal, { onConfirm, onCancel }))
  return { onConfirm, onCancel }
}

describe('PasswordConfirmModal', () => {
  it('верный пароль — идёт через platformAuthApi.verifyPassword, вызывает onConfirm', async () => {
    verifyPasswordMock.mockResolvedValue(true)
    const { onConfirm } = await renderModal()

    fireEvent.change(screen.getByPlaceholderText('common.passwordConfirmModal.пароль'), { target: { value: 'real-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.passwordConfirmModal.подтвердить' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(verifyPasswordMock).toHaveBeenCalledWith('real-password')
  })

  it('неверный пароль по ответу сервера — показывает ошибку, не вызывает onConfirm', async () => {
    verifyPasswordMock.mockResolvedValue(false)
    const { onConfirm } = await renderModal()

    fireEvent.change(screen.getByPlaceholderText('common.passwordConfirmModal.пароль'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.passwordConfirmModal.подтвердить' }))

    await waitFor(() => expect(screen.getByText('common.passwordConfirmModal.неверный_пароль')).toBeTruthy())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('сетевая ошибка тоже считается неверным паролем, не роняет диалог', async () => {
    verifyPasswordMock.mockRejectedValue(new Error('network'))
    const { onConfirm } = await renderModal()

    fireEvent.change(screen.getByPlaceholderText('common.passwordConfirmModal.пароль'), { target: { value: 'anything' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.passwordConfirmModal.подтвердить' }))

    await waitFor(() => expect(screen.getByText('common.passwordConfirmModal.неверный_пароль')).toBeTruthy())
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
