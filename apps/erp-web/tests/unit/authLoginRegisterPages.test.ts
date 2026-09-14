/** @vitest-environment jsdom */

import { createElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const DICT: Record<string, string> = {
  'shell.language': 'Язык',
  'auth.login.title': 'Вход в BAZA',
  'auth.login.subtitle': 'Войдите в кабинет по логину и паролю',
  'auth.login.loginLabel': 'Логин',
  'auth.login.loginPlaceholder': 'Логин',
  'auth.login.passwordLabel': 'Пароль',
  'auth.login.passwordPlaceholder': 'Пароль',
  'auth.login.showPassword': 'Показать пароль',
  'auth.login.hidePassword': 'Скрыть пароль',
  'auth.login.submit': 'Войти',
  'auth.login.submitting': 'Входим…',
  'auth.login.errorInvalid': 'Неверный логин или пароль',
  'auth.login.errorBlocked': 'Аккаунт заблокирован. Обратитесь к руководителю.',
  'auth.login.noAccount': 'Нет аккаунта?',
  'auth.login.registerLink': 'Зарегистрироваться',
  'auth.register.title': 'Регистрация в BAZA',
  'auth.register.subtitle': 'Создайте организацию и станьте её владельцем',
  'auth.register.typeLabel': 'Тип кабинета',
  'auth.register.typeAgency': 'Агентство',
  'auth.register.typeRealtor': 'Частный риелтор',
  'auth.register.typeDeveloper': 'Застройщик',
  'auth.register.orgNameLabel': 'Название организации',
  'auth.register.orgNamePlaceholder': 'Например, Союз Недвижимости',
  'auth.register.loginLabel': 'Логин',
  'auth.register.loginPlaceholder': 'Логин для входа',
  'auth.register.passwordLabel': 'Пароль',
  'auth.register.passwordPlaceholder': 'Пароль',
  'auth.register.passwordHint': 'Минимум 8 символов',
  'auth.register.confirmPasswordLabel': 'Повторите пароль',
  'auth.register.confirmPasswordPlaceholder': 'Повторите пароль',
  'auth.register.submit': 'Зарегистрироваться',
  'auth.register.submitting': 'Регистрируем…',
  'auth.register.errorPasswordTooShort': 'Пароль должен быть не короче 8 символов',
  'auth.register.errorPasswordMismatch': 'Пароли не совпадают',
  'auth.register.errorLoginTaken': 'Этот логин уже занят. Попробуйте другой или войдите в свой аккаунт.',
  'auth.register.errorGeneric': 'Не удалось завершить регистрацию. Попробуйте ещё раз.',
  'auth.register.hasAccount': 'Уже есть аккаунт?',
  'auth.register.loginLink': 'Войти',
}

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    language: 'ru',
    setLanguage: vi.fn(),
    t: (key: string) => DICT[key] || key,
  }),
}))

const mockLogin = vi.fn()
const mockRegisterOrganization = vi.fn()
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, registerOrganization: mockRegisterOrganization }),
}))

// Радикс-компоненты чувствительны к matchMedia/ResizeObserver в jsdom — стаб для этого теста не нужен,
// переключатель языка не открывается в проверяемых сценариях.

async function renderApp(initialPath: string) {
  const { LoginPage } = await import('@/components/auth/LoginPage')
  const { RegisterPage } = await import('@/components/auth/RegisterPage')
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [initialPath] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/login', element: createElement(LoginPage) }),
        createElement(Route, { path: '/register', element: createElement(RegisterPage) }),
        createElement(Route, { path: '/dashboard', element: createElement('div', null, 'DASHBOARD_MARKER') }),
      ),
    ),
  )
}

describe('LoginPage — реальный вход, без демо-входа по ролям', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('не содержит демо-панель входа по роли и быстрый вход', async () => {
    await renderApp('/login')
    expect(screen.queryByText(/демо/i)).toBeNull()
    expect(screen.queryByText('Быстрый вход:')).toBeNull()
  })

  it('поля логина и пароля имеют autoComplete-атрибуты для E2E-локаторов', async () => {
    await renderApp('/login')
    expect(screen.getByPlaceholderText('Логин').getAttribute('autocomplete')).toBe('username')
    expect(screen.getByPlaceholderText('Пароль').getAttribute('autocomplete')).toBe('current-password')
  })

  it('успешный вход переводит на /dashboard', async () => {
    mockLogin.mockResolvedValue('ok')
    await renderApp('/login')

    fireEvent.change(screen.getByPlaceholderText('Логин'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => expect(screen.getByText('DASHBOARD_MARKER')).toBeDefined())
    expect(mockLogin).toHaveBeenCalledWith('owner', 'secret123')
  })

  it('неверный логин/пароль показывает честную ошибку, не пускает дальше', async () => {
    mockLogin.mockResolvedValue('invalid')
    await renderApp('/login')

    fireEvent.change(screen.getByPlaceholderText('Логин'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => expect(screen.getByText('Неверный логин или пароль')).toBeDefined())
    expect(screen.queryByText('DASHBOARD_MARKER')).toBeNull()
  })

  it('заблокированный аккаунт показывает отдельное честное сообщение', async () => {
    mockLogin.mockResolvedValue('blocked')
    await renderApp('/login')

    fireEvent.change(screen.getByPlaceholderText('Логин'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => expect(screen.getByText('Аккаунт заблокирован. Обратитесь к руководителю.')).toBeDefined())
  })

  it('ссылка "Зарегистрироваться" ведёт на реальный экран регистрации', async () => {
    await renderApp('/login')
    fireEvent.click(screen.getByRole('link', { name: 'Зарегистрироваться' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Регистрация в BAZA' })).toBeDefined())
  })
})

describe('RegisterPage — реальная регистрация организации (POST /auth/register + /organizations/register)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('по умолчанию выбран тип "Агентство", доступны все три типа кабинета', async () => {
    await renderApp('/register')
    expect(screen.getByRole('radio', { name: 'Агентство' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Частный риелтор' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'Застройщик' })).toBeDefined()
  })

  it('успешная регистрация вызывает registerOrganization с введёнными данными и переводит на /dashboard', async () => {
    mockRegisterOrganization.mockResolvedValue('ok')
    await renderApp('/register')

    fireEvent.click(screen.getByRole('radio', { name: 'Частный риелтор' }))
    fireEvent.change(screen.getByPlaceholderText('Например, Союз Недвижимости'), { target: { value: 'Тестовое агентство' } })
    fireEvent.change(screen.getByPlaceholderText('Логин для входа'), { target: { value: 'new-owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль', { selector: '#reg-password' }), { target: { value: 'longpass123' } })
    fireEvent.change(screen.getByPlaceholderText('Повторите пароль'), { target: { value: 'longpass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    await waitFor(() => expect(screen.getByText('DASHBOARD_MARKER')).toBeDefined())
    expect(mockRegisterOrganization).toHaveBeenCalledWith({
      login: 'new-owner',
      password: 'longpass123',
      type: 'independent_realtor',
      name: 'Тестовое агентство',
    })
  })

  it('короткий пароль отклоняется на клиенте — registerOrganization не вызывается', async () => {
    await renderApp('/register')

    fireEvent.change(screen.getByPlaceholderText('Например, Союз Недвижимости'), { target: { value: 'Тестовое агентство' } })
    fireEvent.change(screen.getByPlaceholderText('Логин для входа'), { target: { value: 'new-owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль', { selector: '#reg-password' }), { target: { value: 'short' } })
    fireEvent.change(screen.getByPlaceholderText('Повторите пароль'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    await waitFor(() => expect(screen.getByText('Пароль должен быть не короче 8 символов')).toBeDefined())
    expect(mockRegisterOrganization).not.toHaveBeenCalled()
  })

  it('несовпадающие пароли отклоняются на клиенте — registerOrganization не вызывается', async () => {
    await renderApp('/register')

    fireEvent.change(screen.getByPlaceholderText('Например, Союз Недвижимости'), { target: { value: 'Тестовое агентство' } })
    fireEvent.change(screen.getByPlaceholderText('Логин для входа'), { target: { value: 'new-owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль', { selector: '#reg-password' }), { target: { value: 'longpass123' } })
    fireEvent.change(screen.getByPlaceholderText('Повторите пароль'), { target: { value: 'different123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    await waitFor(() => expect(screen.getByText('Пароли не совпадают')).toBeDefined())
    expect(mockRegisterOrganization).not.toHaveBeenCalled()
  })

  it('занятый логин показывает честную ошибку от сервера, а не общую', async () => {
    mockRegisterOrganization.mockResolvedValue('login_taken')
    await renderApp('/register')

    fireEvent.change(screen.getByPlaceholderText('Например, Союз Недвижимости'), { target: { value: 'Тестовое агентство' } })
    fireEvent.change(screen.getByPlaceholderText('Логин для входа'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль', { selector: '#reg-password' }), { target: { value: 'longpass123' } })
    fireEvent.change(screen.getByPlaceholderText('Повторите пароль'), { target: { value: 'longpass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    await waitFor(() => expect(screen.getByText('Этот логин уже занят. Попробуйте другой или войдите в свой аккаунт.')).toBeDefined())
  })

  it('ссылка "Войти" ведёт обратно на реальный экран входа', async () => {
    await renderApp('/register')
    fireEvent.click(screen.getByRole('link', { name: 'Войти' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Вход в BAZA' })).toBeDefined())
  })
})
