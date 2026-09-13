export interface PublicMediaItem {
  url: string
  role: 'cover' | 'gallery'
  sortOrder: number
  alt?: string
}

export interface PublicLocation {
  country?: string
  city?: string
  address?: string
  geo?: PublicGeoPoint
}

export interface PublicGeoPoint {
  type: 'Point'
  coordinates: [number, number]
}

/**
 * Публикатор объекта: застройщик или агентство.
 *
 * Отдельных публичных страниц у них нет (решение владельца от 04.09.2026, как
 * на действующем baza.sale) — клик по названию ведёт в каталог,
 * отфильтрованный по `id`. У объектов частных собственников поле пустое.
 */
export interface PublicPublisher {
  id: string
  name: string
  type: string
}

export interface PublicDevelopmentUnit {
  id?: string
  number?: string
  kind?: string
  rooms?: number
  area?: number
  floor?: number
  buildingName?: string
  price?: {
    amountMinorUnits: number
    currency: string
  }
  planImageUrl?: string
}

export interface PublicDevelopmentCard {
  slug?: string
  name?: string
  location?: PublicLocation
  classType?: string
  completionDate?: string
  description?: string
  publisher?: PublicPublisher
  priceFrom?: {
    amountMinorUnits: number
    currency: string
  }
  units?: PublicDevelopmentUnit[]
  seo?: {
    title?: string
    description?: string
    canonicalUrl?: string
  }
}

export interface PublicDevelopmentList {
  items: PublicDevelopmentCard[]
  nextCursor: string | null
  total: number
}

export interface BoundingBox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export interface CatalogueQuery {
  city?: string
  cursor?: string
  limit?: number
  /** MKT-SCR-005: map viewport filter, serialized as minLng,minLat,maxLng,maxLat. */
  bbox?: BoundingBox
  /** Фильтр «объекты этого застройщика»: id организации-публикатора. */
  publisher?: string
  sort?: 'newest'
}

export type ListingDealType = 'sale' | 'rent_long' | 'rent_short'
export type ListingPropertyType = 'apartment' | 'house' | 'land' | 'commercial'

export interface PublicListingPrice {
  amountMinorUnits?: number
  currency?: string
}

export interface PublicListingCharacteristics {
  area?: number
  rooms?: number
  floor?: number
  totalFloors?: number
}

export interface PublicListingCard {
  slug?: string
  dealType?: ListingDealType
  price?: PublicListingPrice
  propertyType?: ListingPropertyType
  commercialSubtype?: string
  location?: PublicLocation
  characteristics?: PublicListingCharacteristics
  media?: PublicMediaItem[]
  isVerified?: boolean
  isMls?: boolean
  publisher?: PublicPublisher
  seo?: {
    title?: string
    description?: string
    canonicalUrl?: string
    structuredData?: Record<string, unknown>
  }
}

export interface PublicListingList {
  items: PublicListingCard[]
  nextCursor: string | null
  total: number
}

export type PublicListingSort = 'newest' | 'price_asc' | 'price_desc' | 'area_asc' | 'area_desc'

export interface ListingCatalogueQuery {
  city?: string
  dealType?: ListingDealType
  propertyType?: ListingPropertyType
  commercialSubtype?: string
  cursor?: string
  limit?: number
  bbox?: BoundingBox
  sort?: PublicListingSort
  /** Фильтр «объявления этой компании»: id организации-публикатора. */
  publisher?: string
}

/**
 * N-13: доска запросов покупателей. `phone` намеренно отсутствует —
 * раскрывается только по клику через отдельный reveal-эндпоинт
 * (GET /public/requests/:id/reveal-phone), не входит в общий список.
 */
export interface PublicBuyerRequest {
  id: string
  dealType: 'buy' | 'rent'
  city: string
  propertyKind: string
  title: string
  comment: string
  budget: { amount: number; currency: string; perMonth: boolean }
  status: 'published' | 'closed' | 'moderated'
  createdAt: string
}

export interface PublicBuyerRequestList {
  items: PublicBuyerRequest[]
  nextCursor: string | null
}

export interface BuyerRequestQuery {
  cursor?: string
  dealType?: 'buy' | 'rent'
  city?: string
  propertyKind?: string
}

export interface CreateBuyerRequestPayload {
  dealType: 'buy' | 'rent'
  city: string
  propertyKind: string
  title: string
  comment: string
  phone: string
  budgetAmount: number
  budgetCurrency: string
  budgetPerMonth: boolean
}

/** Отзыв о риэлторе — только одобренные попадают в публичный список (GET /public/realtors/:positionId/reviews). */
export interface PublicRealtorReview {
  id: string
  realtorPositionId: string
  rating: number
  text: string
  createdAt: string
}

/**
 * N-13 (owner decision 14.09.2026): "риэлтор" — занятая позиция в
 * организации типа agency/independent_realtor, не отдельный флаг согласия.
 * Телефон намеренно отсутствует — раскрывается по клику через отдельный
 * reveal-эндпоинт. Рейтинг — реальный агрегат по approved-отзывам, не
 * выдуманное число: `null`, если отзывов ещё нет.
 */
export interface PublicRealtorProfile {
  id: string
  name: string
  fixedRole: 'owner' | 'director' | 'rop' | 'manager'
  organizationName: string
  organizationType: 'agency' | 'developer' | 'independent_realtor'
  city: string | null
  aboutMe: string | null
  avatarUrl: string | null
  socials: { telegram: string | null; whatsapp: string | null; instagram: string | null; website: string | null }
  rating: { average: number; count: number } | null
}

export interface PublicRealtorList {
  items: PublicRealtorProfile[]
  nextCursor: string | null
}

export interface PublicRealtorQuery {
  cursor?: string
  city?: string
}


/**
 * Персональная подборка, как её видит клиент по ссылке от риэлтора.
 *
 * `unit` необязателен: объект мог быть удалён или переехать в другую
 * организацию. Подборка в этом случае показывается без него, а не падает
 * целиком — ронять страницу клиента из-за одной пропавшей квартиры нельзя.
 */
export interface PublicSelectionUnit {
  number: string
  kind: string
  rooms?: number
  area: number
  price?: { amountMinorUnits: number; currency: string }
  status: string
}

export interface PublicSelectionItem {
  unitId: string
  agentNote?: string
  reaction?: string
  viewedAt?: string
  unit?: PublicSelectionUnit
}

export interface PublicSelection {
  title: string
  clientName?: string
  clientPhone?: string
  agentNote?: string
  status: string
  items: PublicSelectionItem[]
  createdAt: string
  sentAt?: string
  viewCount: number
}

/**
 * N-11: подборка покупателя по публичной ссылке. В отличие от PublicSelection
 * (агентская, CRM-подборка) элемент — только тип и slug: карточка
 * дочитывается публичными эндпоинтами каталога, тот же принцип, что
 * FavoriteEntry.
 */
export interface PublicMarketplaceSelectionItem {
  targetType: 'development' | 'listing'
  slug: string
}

export interface PublicMarketplaceSelection {
  title: string
  items: PublicMarketplaceSelectionItem[]
  createdAt: string
}
