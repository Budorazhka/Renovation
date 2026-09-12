import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { marketplaceApi } from '../api/marketplace-api'
import { DevelopmentCard } from '../components/DevelopmentCard'
import { ListingCard } from '../components/ListingCard'
import { ListingCardCompact } from '../components/ListingCardCompact'
import { useI18n } from '../i18n'
import type { PublicDevelopmentCard, PublicListingCard } from '../types/marketplace'

/**
 * Главная страница по утверждённому фрейму Figma `Home page` v4 long
 * (`3428:55239`, 1920x5544); решение владельца — MKT-SCR-001 в
 * docs/discovery/marketplace-screen-build-spec.md.
 *
 * Вёрстка снята с узлов макета, а не с их перечня: у каждой секции здесь
 * свой автолэйаут (`stackMode`/`stackSpacing`/`stackPadding`), свои
 * начертания и кегли, свои радиусы и тени. Значения перечислены рядом с
 * каждым блоком в home.css; инструмент выгрузки — analysis_tools/dump_spec.js.
 *
 * Секции фрейма (дети `3428:55241`):
 *   `3851:56175` hero 1920x905, VERTICAL gap 62, center
 *   `3428:55271` категории 1920x523, HORIZONTAL gap 19, padding 0/80
 *   `3428:55292` «Почему выбирают BAZA.sale?» 1920x352, HORIZONTAL gap 249
 *   `3428:55382` промо 1920x500, HORIZONTAL gap 50
 *   `3428:55605` «Горячие предложения» 1920x746, карточки 424x626 gap 21
 *   `3428:55845` «Новые объявления квартир» 1920x783, карточки 424x663
 *   `3428:56071` «Каталог проверенных риелторов» — нет публичного API
 *   `3428:56103` «Рейтинг застройщиков» — нет публичного API
 *   `3428:56129` footer 3 (на всех экранах утверждён `footer 1`, MKT-SCR-003)
 */

interface CategorySpec {
  titleKey: string
  to: string
  countKey: 'developments' | 'sale' | 'rent' | 'commercial'
  /** Ширина карточки в макете: 390/470/410/450/450 из ряда 1920. */
  width: number
  /**
   * Иллюстрация категории — 3D-картинка от владельца (12.09.2026) с
   * прозрачным фоном, WebP. Первые, извлечённые из макета, при пережатии в
   * JPEG потеряли прозрачность и легли на плитки чёрными прямоугольниками.
   */
  photo: string
}

const CATEGORIES: CategorySpec[] = [
  {
    titleKey: 'home.category.newBuild',
    to: '/newconstructions',
    countKey: 'developments',
    width: 390,
    photo: '/figma/category-new-buildings.webp',
  },
  { titleKey: 'home.category.secondary', to: '/secondary', countKey: 'sale', width: 470, photo: '/figma/category-secondary.webp' },
  { titleKey: 'home.category.rent', to: '/rent', countKey: 'rent', width: 410, photo: '/figma/category-rent.webp' },
  {
    titleKey: 'home.category.projects',
    to: '/newconstructions',
    countKey: 'developments',
    width: 450,
    photo: '/figma/category-projects.webp',
  },
  {
    titleKey: 'home.category.commercial',
    to: '/secondary?propertyType=commercial',
    countKey: 'commercial',
    width: 450,
    photo: '/figma/category-commercial.webp',
  },
]

/**
 * Постоянный фирменный кадр: hero не зависит от случайной первой публикации.
 * ИСПРАВЛЕНО 13.09.2026 (найдено ревью): исходный PNG весил 2.3 МБ и
 * грузился eager — WebP-варианты по ширине сжимают его в ~17 раз
 * (полноразмерный 1920w — 132 КБ), JPEG остаётся фолбэком для браузеров
 * без поддержки WebP. `loading="eager"` сохранён намеренно — это LCP-кадр
 * первого экрана, "lazy" здесь только ухудшил бы время отрисовки.
 */
const HERO_PHOTO_JPG = '/brand/batumi-editorial-hero.jpg'
const HERO_PHOTO_WEBP_SRCSET = [640, 960, 1280, 1920]
  .map((w) => `/brand/batumi-editorial-hero-${w}.webp ${w}w`)
  .join(', ')

/**
 * Три довода из `3428:55298`: иконка 139x139, заголовок 20px, текст 20px.
 * Иллюстрации — те же, что в макете: собраны из векторной геометрии узлов
 * `3428:55300`, `3428:55327`, `3428:55362` (analysis_tools/vector_to_svg.js).
 */
const ADVANTAGES = [
  {
    key: 'choice',
    titleKey: 'home.advantage.choice.title',
    textKey: 'home.advantage.choice.text',
    icon: '/figma/advantage-choice.svg',
  },
  {
    key: 'agents',
    titleKey: 'home.advantage.agents.title',
    textKey: 'home.advantage.agents.text',
    icon: '/figma/advantage-agents.svg',
  },
  {
    key: 'search',
    titleKey: 'home.advantage.search.title',
    textKey: 'home.advantage.search.text',
    icon: '/figma/advantage-search.svg',
  },
]

interface HomeData {
  developments: PublicDevelopmentCard[]
  listings: PublicListingCard[]
  rentals: PublicListingCard[]
  counts: Partial<Record<CategorySpec['countKey'], number>>
}

const EMPTY: HomeData = { developments: [], listings: [], rentals: [], counts: {} }

export function HomePage() {
  const [data, setData] = useState<HomeData>(EMPTY)
  const [loadError, setLoadError] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [developments, sale, rent, commercial] = await Promise.all([
          marketplaceApi.listDevelopments({ limit: 4 }, { signal: controller.signal }),
          marketplaceApi.listListings({ limit: 4, dealType: 'sale' }, { signal: controller.signal }),
          marketplaceApi.listListings({ limit: 2, dealType: 'rent_long' }, { signal: controller.signal }),
          marketplaceApi.listListings({ limit: 1, propertyType: 'commercial' }, { signal: controller.signal }),
        ])
        setData({
          developments: developments.items,
          listings: sale.items,
          rentals: rent.items,
          // Счётчик в скобках у категории — `total` из того же ответа,
          // отдельный запрос ради цифры не нужен.
          counts: {
            developments: developments.total,
            sale: sale.total,
            rent: rent.total,
            commercial: commercial.total,
          },
        })
        setLoadError(false)
      } catch {
        if (controller.signal.aborted) return
        setData(EMPTY)
        setLoadError(true)
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  return (
    <div className="home">
      {/* hero `3851:56175`: VERTICAL gap 62, center; логотип-плашка 557x180; слоган 50px */}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__head">
          <p className="home-hero__logo">
            {/* Знак из макета (`3851:56178`), а не нарисованный по памяти домик. */}
            <img src="/figma/logo-mark.svg" alt="" width={100} height={100} />
            <span className="home-hero__logo-text">BAZA.sale</span>
          </p>
          <h1 id="home-title" className="home-hero__slogan">{t('home.slogan')}</h1>
        </div>

        <div className="home-hero__photo">
          <picture>
            <source type="image/webp" srcSet={HERO_PHOTO_WEBP_SRCSET} sizes="100vw" />
            <img src={HERO_PHOTO_JPG} alt="" loading="eager" fetchPriority="high" />
          </picture>
        </div>
      </section>

      {/* категории `3428:55271`: HORIZONTAL gap 19, карточки radius 30, border 3px, тень */}
      <section className="home-categories" aria-label={t('home.categoriesAria')}>
        <div className="home-categories__row">
          {CATEGORIES.map((category) => {
            const count = data.counts[category.countKey]
            return (
              <Link key={category.titleKey} to={category.to} className="home-category">
                <span className="home-category__head">
                  <span className="home-category__title">{t(category.titleKey)}</span>
                  {count !== undefined ? <span className="home-category__count">({count})</span> : null}
                </span>
                <span className="home-category__photo">
                  <img src={category.photo} alt="" loading="lazy" />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* «Почему выбирают» `3428:55292`: слева пилюля + заголовок 50px ExtraBold, справа три довода */}
      <section className="home-why" aria-labelledby="home-why-title">
        <div className="home-why__intro">
          <p className="home-why__tag">{t('home.why.tag')}</p>
          <h2 id="home-why-title" className="home-why__title">{t('home.why.title')}</h2>
          <p className="home-why__lead">{t('home.why.lead')}</p>
        </div>
        <ul className="home-why__list">
          {ADVANTAGES.map((advantage) => (
            <li key={advantage.key} className="home-advantage">
              <img className="home-advantage__icon" src={advantage.icon} alt="" width={139} height={139} loading="lazy" />
              <h3 className="home-advantage__title">{t(advantage.titleKey)}</h3>
              <p className="home-advantage__text">{t(advantage.textKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* промо `3428:55382`: зелёный блок 670x500 и баннер 1040x500, оба radius 30 */}
      <section className="home-promo" aria-label={t('home.promoAria')}>
        <div className="home-promo__sell">
          <img className="home-promo__sell-art" src="/figma/promo-sell-art.svg" alt="" loading="lazy" />
          <h2 className="home-promo__sell-title">{t('home.promo.sellTitle')}</h2>
          <p className="home-promo__sell-text">{t('home.promo.sellText')}</p>
          <Link to="/publish" className="home-promo__sell-button">{t('home.promo.sellButton')}</Link>
        </div>

        {/*
          * `3428:55408` 1040x500: иллюстрация макета целиком (дом с лупой,
          * карточки риэлторов, зелёная диагональ), тексты лежат поверх неё
          * в правой части, как узлы `3428:55598`.
          */}
        <div className="home-promo__sale">
          <img className="home-promo__sale-art" src="/figma/promo-sale.svg" alt="" loading="lazy" />
          <div className="home-promo__sale-body">
            <p className="home-promo__sale-kicker">{t('home.promo.saleKicker')}</p>
            <p className="home-promo__sale-word">SALE</p>
            <p className="home-promo__sale-value">{t('home.promo.saleValue')}</p>
          </div>
        </div>
      </section>

      {/* рельса ЖК `3428:55605`: шапка 60px, ряд карточек 424x626 gap 21 */}
      <section className="home-rail" aria-labelledby="home-hot-title">
        <div className="home-rail__head">
          <h2 id="home-hot-title" className="home-rail__title">
            <img className="home-rail__badge" src="/figma/rail-badge.svg" alt="" width={47} height={60} />
            {t('home.rail.hotTitle')}
          </h2>
          <Link to="/newconstructions" className="home-rail__all">
            {t('home.rail.viewAll')}
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
        {data.developments.length > 0 ? (
          <div className="home-rail__items">
            {data.developments.slice(0, 4).map((item) => (
              <DevelopmentCard key={item.slug} item={item} />
            ))}
          </div>
        ) : (
          <p className="home-rail__empty">
            {loadError ? t('home.rail.emptyDevError') : t('home.rail.emptyDevNone')}
          </p>
        )}
      </section>

      {/* рельса вторички `3428:55845`: та же шапка, карточки 424x663 */}
      <section className="home-rail" aria-labelledby="home-new-title">
        <div className="home-rail__head">
          <h2 id="home-new-title" className="home-rail__title">
            <img className="home-rail__badge" src="/figma/rail-badge.svg" alt="" width={47} height={60} />
            {t('home.rail.newTitle')}
          </h2>
          <Link to="/secondary" className="home-rail__all">
            {t('home.rail.viewAll')}
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
        {data.listings.length > 0 ? (
          <div className="home-rail__items">
            {data.listings.slice(0, 4).map((item) => (
              <ListingCard key={item.slug} item={item} />
            ))}
          </div>
        ) : (
          <p className="home-rail__empty">
            {loadError ? t('home.rail.emptyListingsError') : t('home.rail.emptyListingsNone')}
          </p>
        )}
      </section>

      {/*
        * Мобильная главная — отдельный фрейм `mob_home` (`1035:18101`,
        * 375x3461), и она не сводится к десктопной в одну колонку: там нет
        * ни фотополотна, ни категорий, ни блока «Почему выбирают», ни
        * промо. Есть два списка объектов по две карточки, между ними
        * подборка горячих предложений компактными карточками, внизу
        * кнопка заявки и зелёное меню. Поэтому разметка своя, а видимость
        * переключается по ширине.
        */}
      <div className="home-mobile" aria-hidden={false}>
        <section className="home-mobile__block" aria-labelledby="m-new-title">
          <div className="home-mobile__head">
            <h2 id="m-new-title" className="home-mobile__title">{t('home.mobile.newBuild')}</h2>
            <Link to="/newconstructions" className="home-mobile__all">{t('home.mobile.viewShort')}</Link>
          </div>
          {data.developments.slice(0, 2).map((item) => (
            <DevelopmentCard key={item.slug} item={item} />
          ))}
          {data.developments.length === 0 ? (
            <p className="home-rail__empty">{t('home.rail.emptyDevNone')}</p>
          ) : null}
        </section>

        {/* `1035:18130` hot cards: кнопка-контур и три компактные карточки */}
        <section className="home-mobile__hot" aria-labelledby="m-hot-title">
          <h2 id="m-hot-title" className="home-mobile__pill">{t('home.mobile.hot')}</h2>
          <div className="home-mobile__compact">
            {data.listings.slice(0, 3).map((item) => (
              <ListingCardCompact key={item.slug} item={item} />
            ))}
            {data.listings.length === 0 ? (
              <p className="home-rail__empty">{t('home.rail.emptyListingsNone')}</p>
            ) : null}
          </div>
        </section>

        <section className="home-mobile__block" aria-labelledby="m-rent-title">
          <div className="home-mobile__head">
            <h2 id="m-rent-title" className="home-mobile__title">{t('home.mobile.rent')}</h2>
            <Link to="/rent" className="home-mobile__all">{t('home.mobile.viewShort')}</Link>
          </div>
          {data.rentals.slice(0, 2).map((item) => (
            <ListingCard key={item.slug} item={item} />
          ))}
          {data.rentals.length === 0 ? (
            <p className="home-rail__empty">{t('home.mobile.emptyRent')}</p>
          ) : null}
        </section>

        {/* `1035:18146` большая кнопка заявки */}
        <div className="home-mobile__cta">
          <Link to="/publish" className="home-mobile__cta-button">{t('home.mobile.ctaLabel')}</Link>
        </div>

        {/* `215:7733` нижнее меню: зелёная панель со скруглением 40 сверху */}
        <nav className="home-mobile__nav" aria-label={t('home.mobile.navAria')}>
          <Link to="/" aria-label={t('home.mobile.navHome')}><img src="/figma/nav-home.svg" alt="" width={48} height={49} /></Link>
          <Link to="/newconstructions" aria-label={t('home.mobile.navSearch')}><img src="/figma/nav-search.svg" alt="" width={48} height={49} /></Link>
          {/*
            * В макете третий пункт — шестерёнка настроек, но настроек в
            * продукте нет, а пункт ведёт в избранное: значок — сердце, в той
            * же обводке 1.5, что остальные значки панели.
            */}
          <Link to="/favorites" aria-label={t('home.mobile.navFavorites')}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link to="/account" aria-label={t('home.mobile.navAccount')}><img src="/figma/nav-account.svg" alt="" width={48} height={49} /></Link>
        </nav>
      </div>
    </div>
  )
}
