import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthSession } from '../features/auth/model/useAuthSession'
import { useI18n } from '../i18n'

interface HeaderProps {
  onCityChange?: (city: string) => void
  onCurrencyChange?: (currency: string) => void
  onLanguageChange?: (lang: string) => void
}

type OpenMenu = 'lang' | 'currency' | 'city' | 'account' | null

const CURRENCY_SIGN: Record<string, string> = { USD: '$', GEL: '₾', RUB: '₽' }

/** Знак логотипа из макета (`3851:56178`): крыша и дом, заливка текущим цветом. */
function LogoMark() {
  return (
    <svg className="bz-header__logo-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path
        transform="translate(6.25 12.55)"
        d="M45.66 0.65C44.53-0.22 42.97-0.22 41.84 0.65L1.22 31.9C-0.15 32.95-0.4 34.91 0.65 36.28C1.7 37.65 3.66 37.9 5.03 36.85L43.75 7.07L82.47 36.85C83.04 37.29 83.71 37.5 84.37 37.5C85.31 37.5 86.24 37.08 86.85 36.28C87.9 34.91 87.65 32.95 86.28 31.9Z"
      />
      <path
        transform="translate(15.94 27.52)"
        d="M43.44 59.94L65 59.94C66.72 59.94 68.13 58.53 68.13 56.81L68.13 26.19L34.06 0L0 26.19L0 56.81C0 58.53 1.41 59.94 3.13 59.94L24.69 59.94C26.41 59.94 27.81 58.53 27.81 56.81L27.81 38.06L40.31 38.06L40.31 56.81C40.31 58.53 41.72 59.94 43.44 59.94Z"
      />
    </svg>
  )
}

function Chevron() {
  return (
    <svg className="bz-header__chevron" viewBox="0 0 12 8" aria-hidden="true" focusable="false">
      <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Шапка витрины по компоненту `Property 1=Default` (`299:4629`, 1920x74).
 *
 * Зелёная полоса во всю ширину со скруглением 50 снизу; слева знак и
 * «BAZA», по центру семь разделов с шагом 30, справа белая пилюля
 * «+ Разместить», контурная «Войти» со значком в зелёном квадрате, язык,
 * валюта и город с булавкой.
 *
 * 12.09.2026 собрана заново со своими классами `bz-header*`: прежняя
 * вёрстка жила на четырёх наборах правил (`.site-header` в app.css
 * трижды, figma-surface.css, header-footer.css), которые перебивали друг
 * друга, — отсюда пляшущие размеры и точки вместо значков.
 *
 * Отступление от макета одно: колокольчик уведомлений (`299:4655`) не
 * выводится — уведомлений в продукте нет, и значок обещал бы то, чего нет.
 * Знак логотипа добавлен к надписи по просьбе владельца.
 */
export function Header({ onCityChange, onCurrencyChange, onLanguageChange }: HeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, isChecking, logout } = useAuthSession()
  const { language, setLanguage, t } = useI18n()
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [currentCity, setCurrentCity] = useState('Тбилиси')
  const [currentCurrency, setCurrentCurrency] = useState('USD')
  const actionsRef = useRef<HTMLDivElement>(null)

  const currentLang = language.toUpperCase()

  // Выпадающий список закрывается кликом мимо и по Escape — раньше он
  // оставался висеть, пока не нажмёшь ту же кнопку ещё раз.
  useEffect(() => {
    if (!openMenu) return
    const onPointer = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  useEffect(() => {
    setMobileMenuOpen(false)
    setOpenMenu(null)
  }, [location.pathname, location.search])

  const toggle = (menu: Exclude<OpenMenu, null>) => setOpenMenu((current) => (current === menu ? null : menu))

  const isRent = location.pathname.startsWith('/rent') || location.search.includes('dealType=rent_long')
  const isCommercial = location.search.includes('propertyType=commercial')
  // Каталог держит вкладку объявлений в `?tab=listings` и на маршруте
  // новостроек — тогда активен раздел «Вторичка», как было и прежде.
  const onListingsTab = location.search.includes('tab=listings')
  const isSecondary =
    (location.pathname.startsWith('/secondary') || location.pathname.startsWith('/listings') || onListingsTab) &&
    !isCommercial &&
    !isRent
  const isDevelopments =
    (location.pathname.startsWith('/newconstructions') || location.pathname.startsWith('/developments')) &&
    !onListingsTab

  const navItems = [
    { to: '/newconstructions', label: t('nav.newConstructions'), active: isDevelopments },
    { to: '/secondary', label: t('nav.secondary'), active: isSecondary },
    { to: '/newconstructions', label: t('nav.projects'), active: false },
    { to: '/rent', label: t('nav.rent'), active: isRent },
    { to: '/secondary?propertyType=commercial', label: t('nav.commercial'), active: isCommercial },
    { to: '/requests', label: t('nav.requests'), active: location.pathname.startsWith('/requests') },
    { to: '/banks', label: t('nav.banks'), active: location.pathname.startsWith('/banks') },
  ]

  const handleCitySelect = (city: string) => {
    setCurrentCity(city)
    setOpenMenu(null)
    onCityChange?.(city)
  }

  const handleCurrencySelect = (currency: string) => {
    setCurrentCurrency(currency)
    setOpenMenu(null)
    onCurrencyChange?.(currency)
  }

  const handleLangSelect = (lang: string) => {
    setLanguage(lang.toLowerCase() as 'ru' | 'en' | 'ka')
    setOpenMenu(null)
    onLanguageChange?.(lang)
  }

  const handleLogout = async () => {
    setOpenMenu(null)
    setMobileMenuOpen(false)
    await logout()
    navigate('/')
  }

  return (
    <header className="bz-header" role="banner">
      <div className="bz-header__bar">
        <Link to="/" className="bz-header__logo" aria-label={t('header.logoAria')}>
          <LogoMark />
          <span className="bz-header__logo-text">BAZA</span>
        </Link>

        <nav className="bz-header__nav" aria-label={t('home.mobile.navAria')}>
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={`bz-header__nav-link${item.active ? ' is-active' : ''}`}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="bz-header__actions" ref={actionsRef}>
          <Link className="bz-header__publish" to="/publish" data-testid="header-publish-cta">
            {t('header.publish')}
          </Link>

          {isChecking ? (
            // Пока сессия проверяется, не утверждаем ни «Войти», ни «Кабинет»:
            // место держим, чтобы шапку не дёргало.
            <span className="bz-header__account bz-header__account--pending" aria-label={t('header.checking')} aria-busy="true" />
          ) : isAuthenticated ? (
            <div className="bz-header__menu-wrap">
              <button
                className="bz-header__account"
                type="button"
                aria-label={t('header.accountMenuAria')}
                aria-expanded={openMenu === 'account'}
                data-testid="header-account-btn"
                onClick={() => toggle('account')}
              >
                <span className="bz-header__account-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" focusable="false">
                    <circle cx="8" cy="5.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M2.5 14c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
                <span>{t('header.cabinet')}</span>
                <Chevron />
              </button>
              {openMenu === 'account' ? (
                <div className="bz-header__dropdown bz-header__dropdown--right" role="menu">
                  <Link role="menuitem" to="/account/properties">{t('header.myProperties')}</Link>
                  <Link role="menuitem" to="/account/favorites">{t('header.favorites')}</Link>
                  <Link role="menuitem" to="/account/team">{t('header.myTeam')}</Link>
                  <button type="button" role="menuitem" data-testid="header-logout-btn" onClick={() => void handleLogout()}>
                    {t('header.logout')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link className="bz-header__account" to="/auth/login" data-testid="header-login-link">
              {/* `299:4644`: значок входа в зелёном квадрате со скруглением 8 */}
              <span className="bz-header__account-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <circle cx="5.5" cy="10.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M7.7 8.3 13.5 2.5M11 5l1.6 1.6M12.4 3.6 14 5.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span>{t('header.login')}</span>
            </Link>
          )}

          <div className="bz-header__menu-wrap">
            <button
              className="bz-header__select"
              type="button"
              aria-label={t('header.selectLanguage')}
              aria-expanded={openMenu === 'lang'}
              onClick={() => toggle('lang')}
            >
              {currentLang}
              <Chevron />
            </button>
            {openMenu === 'lang' ? (
              <div className="bz-header__dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => handleLangSelect('RU')}>RU ({t('header.langRussian')})</button>
                <button type="button" role="menuitem" onClick={() => handleLangSelect('EN')}>EN ({t('header.langEnglish')})</button>
                <button type="button" role="menuitem" onClick={() => handleLangSelect('KA')}>KA ({t('header.langGeorgian')})</button>
              </div>
            ) : null}
          </div>

          <div className="bz-header__menu-wrap">
            <button
              className="bz-header__select"
              type="button"
              aria-label={t('header.selectCurrency')}
              aria-expanded={openMenu === 'currency'}
              onClick={() => toggle('currency')}
            >
              {CURRENCY_SIGN[currentCurrency] ?? currentCurrency}
              <Chevron />
            </button>
            {openMenu === 'currency' ? (
              <div className="bz-header__dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => handleCurrencySelect('USD')}>$ USD</button>
                <button type="button" role="menuitem" onClick={() => handleCurrencySelect('GEL')}>₾ GEL</button>
                <button type="button" role="menuitem" onClick={() => handleCurrencySelect('RUB')}>₽ RUB</button>
              </div>
            ) : null}
          </div>

          <div className="bz-header__menu-wrap">
            <button
              className="bz-header__city"
              type="button"
              aria-label={t('header.selectCity')}
              aria-expanded={openMenu === 'city'}
              onClick={() => toggle('city')}
            >
              {/* `299:4653`: булавка карты */}
              <svg className="bz-header__pin" viewBox="0 0 16 20" aria-hidden="true" focusable="false">
                <path d="M8 0a8 8 0 0 0-8 8c0 5.6 6.7 11.3 7.3 11.8a1 1 0 0 0 1.4 0C9.3 19.3 16 13.6 16 8a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor" />
              </svg>
              <span>{currentCity}</span>
            </button>
            {openMenu === 'city' ? (
              <div className="bz-header__dropdown bz-header__dropdown--right" role="menu">
                <button type="button" role="menuitem" onClick={() => handleCitySelect('Тбилиси')}>{t('header.cityTbilisi')}</button>
                <button type="button" role="menuitem" onClick={() => handleCitySelect('Батуми')}>{t('header.cityBatumi')}</button>
                <button type="button" role="menuitem" onClick={() => handleCitySelect('Бакуриани')}>{t('header.cityBakuriani')}</button>
              </div>
            ) : null}
          </div>

          <button
            className="bz-header__burger"
            type="button"
            aria-label={t('header.navMenuAria')}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="bz-header__drawer" role="dialog" aria-label={t('header.mobileMenuAria')}>
          <nav className="bz-header__drawer-links" aria-label={t('header.sectionsAria')}>
            {navItems.map((item) => (
              <Link key={item.label} to={item.to} className={item.active ? 'is-active' : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="bz-header__drawer-account">
            {isAuthenticated ? (
              <>
                <Link to="/account/properties">{t('header.myProperties')}</Link>
                <Link to="/account/favorites">{t('header.favorites')}</Link>
                <button type="button" onClick={() => void handleLogout()}>{t('header.logout')}</button>
              </>
            ) : (
              <Link to="/auth/login">{t('header.login')}</Link>
            )}
          </div>
          <Link to="/publish" className="bz-header__drawer-cta">{t('header.publish')}</Link>
        </div>
      ) : null}
    </header>
  )
}
