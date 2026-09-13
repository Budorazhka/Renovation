import { marketplaceApi } from '../api/marketplace-api'
import { listingAddress, listingPrice, listingTitle, developmentAddress, developmentTitle } from './format'
import type { Translate } from '../i18n'

export interface ResolvedMarketplaceTarget {
  id: string
  slug: string
  targetType: 'development' | 'listing'
  title: string
  dealType: 'sale' | 'rent_short' | 'rent_long'
  propertyType: string
  price: string
  pricePerSqm?: string
  address: string
  city: string
  rooms: number
  area: number
  floor: number
  imageUrl?: string
}

/**
 * Карточка избранного/подборки -> отображаемые поля. Общий resolver для
 * FavoritesPage и SelectionsPage (N-11) — обе страницы хранят только
 * {targetType, slug} и дочитывают карточку публичными эндпоинтами каталога,
 * поэтому цена и адрес всегда те же, что в каталоге, и разойтись с ним не
 * могут.
 *
 * `null` — объект снят с публикации или удалён: вызывающая страница
 * пропускает такой элемент, а не падает целиком.
 */
export async function resolveMarketplaceTarget(
  target: { targetType: 'development' | 'listing'; slug: string },
  t?: Translate,
): Promise<ResolvedMarketplaceTarget | null> {
  try {
    if (target.targetType === 'listing') {
      const card = await marketplaceApi.getListing(target.slug)
      return {
        id: `listing:${target.slug}`,
        slug: target.slug,
        targetType: 'listing',
        title: listingTitle(card, t),
        dealType: card.dealType ?? 'sale',
        propertyType: card.propertyType ?? '',
        price: listingPrice(card, t),
        address: listingAddress(card, t),
        city: card.location?.city ?? '',
        rooms: card.characteristics?.rooms ?? 0,
        area: card.characteristics?.area ?? 0,
        floor: card.characteristics?.floor ?? 0,
      }
    }
    const card = await marketplaceApi.getDevelopment(target.slug)
    return {
      id: `development:${target.slug}`,
      slug: target.slug,
      targetType: 'development',
      title: developmentTitle(card, t),
      dealType: 'sale',
      propertyType: card.classType ?? '',
      price: '',
      address: developmentAddress(card, t),
      city: card.location?.city ?? '',
      rooms: 0,
      area: 0,
      floor: 0,
    }
  } catch {
    return null
  }
}
