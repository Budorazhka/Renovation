import axios from 'axios';
import { CRM_API_BASE_URL } from '@/config/backend';
import type { DeveloperAnalyticsSummaryResponse } from '@/lib/developer-analytics';
import type { PromoDurationId } from '@/lib/promoActivations';
import type { IInstallmentPlan } from '@/types/installment';

export type { PromoDurationId };

const api = axios.create({
  baseURL: CRM_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

export type ProjectStatus = 'draft' | 'active' | 'archived';
export type ComplexStatus = 'draft' | 'active' | 'archived';
export type ComplexClass = 'econom' | 'comfort' | 'business' | 'premium' | 'elite';
export type UnitStatus = 'available' | 'reserved' | 'sold' | 'hidden';

export interface FileEntity {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Complex {
  id: string;
  projectId: string;
  /** Id пользователя-создателя ЖК (author в БД). */
  author?: string;
  name: string;
  slug: string;
  status: ComplexStatus;
  class?: ComplexClass;
  construction?: { startDate?: string; endDate?: string };
  startDate?: string;
  completionDate?: string;
  
  // Extended Passport Fields (moved here for frontend usage as 'Project')
  description?: string;
  descriptionSuccess?: string;
  descriptionAudience?: string;
  country?: string;
  city?: string;
  /** Street address of the complex, e.g. "ул. Адлия, 12". */
  location?: string;
  developer?: string;
  coastline?: string;
  propertyType?: string[];

  wallMaterial?: string;
  finishTypes?: string[];
  ceilingHeight?: string;
  elevatorTypes?: string[];
  parkingTypes?: string[];
  parkingSpots?: number;
  viewTypes?: string[];
  
  hasGas?: boolean;
  waterSupply?: string;
  sewerage?: string;
  buildingPermit?: boolean;
  
  infrastructureExternal?: string[];
  infrastructureInternal?: string[];
  infrastructureLocation?: string[];

  // Payment & Terms
  currency?: 'USD' | 'EUR' | 'RUB' | 'GEL' | 'KZT' | string;
  paymentTypes?: string[];
  installmentTerms?: { type: string; downPaymentPercent: number; durationMonths: number }[];
  installmentPlans?: IInstallmentPlan[];
  mortgageTerm?: { interestRateMin: number; downPaymentPercent: number; maxTermYears: number };
  realtorScripts?: { question: string; answer: string }[];

  // Media & External links
  youtubeLink?: string;
  areaPolygon?: [number, number][];
  locationCenter?: [number, number];
  coverFileId?: string;
  cover?: FileEntity;
  renderFileIds?: string[];
  renders?: FileEntity[] | string[];
  constructionProgressFileIds?: string[];
  constructionProgress?: FileEntity[] | string[];

  /** Фото района (галерея «О районе» в визитке), загружается в визарде ЖК. */
  districtGallery?: FileEntity[] | string[];
  districtGalleryImagesFileIds?: string[];
  /** Текст про район (блок «Информация о районе» в визитке). */
  districtText?: string;
  /** Документы ЖК (PDF): разрешения, договоры. */
  documents?: FileEntity[] | string[];
  /** Доходность краткосрочной аренды, % годовых. */
  rentalYieldShort?: number;
  /** Доходность долгосрочной аренды, % годовых. */
  rentalYieldLong?: number;
  /** Инвестиционная доходность / рост, %. */
  investmentYield?: number;
  /** Текст про арендный потенциал (вместо пресета по городу). */
  rentalText?: string;
  /** Текст про инвестиционный потенциал (вместо пресета). */
  investmentText?: string;

  /** Active paid-service promotions for this complex (see promotion-paid-services doc). */
  promotions?: PromotionActivation[];

  /** Aggregated catalog stats for card display (computed from units on the API). */
  areaFrom?: number;
  areaTo?: number;
  priceFrom?: string;
  priceTo?: string;
  priceFromUsd?: number;
  priceToUsd?: number;
  floorsFrom?: number;
  floorsTo?: number;

  createdAt: string;
  updatedAt: string;
}

export interface Building {
  id: string;
  complexId: string;
  name: string;
  number?: string;
  floors?: number;
  completionDate?: string;
  startDate?: string;
  polygon?: [number, number][];
  createdAt: string;
  updatedAt: string;
}

export function parsePlotToPolygon(plot: unknown): [number, number][] | undefined {
  if (Array.isArray(plot)) return plot as [number, number][];
  if (typeof plot === 'string') {
    try {
      const parsed = JSON.parse(plot);
      return Array.isArray(parsed) && parsed.length > 0 ? (parsed as [number, number][]) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface Unit {
  id: string;
  complexId: string;
  buildingId: string;
  sectionId?: string | null;
  sectionName?: string | null;
  floor: number;
  number: string;
  rooms: string;
  area: number;
  price: number;
  pricePerSqm?: number;
  /** Per-square-meter prices keyed by the UI finish type. Supported by newer APIs. */
  finishPrices?: Partial<Record<string, number>>;
  currency?: 'USD' | 'EUR' | 'RUB' | 'GEL' | 'KZT' | string;
  status: UnitStatus;
  finishing: string;
  windowsSide: string;
  layoutId?: string | null;
  /** CdnFile id плана лота (передаётся в PATCH как imageFileId). */
  imageFileId?: string | null;
  /** Планировка лота (картинка) — приходит из chessboard как unit.image */
  image?: { id?: string; name?: string; url?: string } | null;
  /** Поэтажный план этажа, на котором находится лот — из chessboard floor.planUrl */
  floorPlanUrl?: string | null;
  /** Контур лота на поэтажном плане (доли 0..1). Сохраняется через PUT /units/:id/plot. */
  plot?: [number, number][] | null;
  positionInFloor?: number;
  roomsStr?: string;
  createdAt: string;
  updatedAt: string;
}

/** One per-row issue reported by the Excel upload endpoint. */
export interface UnitsExcelRowIssue {
  row: number;
  aptNum?: string;
  field?: string;
  message: string;
}

/** Result of POST /api/development/units/upload-excel. */
export interface UnitsExcelUploadResult {
  status: string;
  totalRows?: number;
  totalCreated: number;
  totalUpdated: number;
  totalSkipped?: number;
  errors?: UnitsExcelRowIssue[];
  warnings?: UnitsExcelRowIssue[];
}

/** CDN file as returned by the floor/apartment plan endpoints. */
export interface CdnFileRef {
  id: string;
  name: string;
  type: string;
  url: string;
  createdAt: string;
}

/** One apartment contour on a floor map (structured record from the plans API). */
export interface FloorPlanApartment {
  id: string;
  aptNum: string;
  status?: string;
  plot: [number, number][];
}

/** One floor's interactive map entry (floor-plans-data record). */
export interface FloorPlansDataEntry {
  id: string;
  buildingId?: string;
  floorNum: string;
  imageId: string;
  image?: CdnFileRef;
  apartments: FloorPlanApartment[];
}

/** Aggregated response of GET /buildings/:id/plans. */
export interface BuildingPlansResponse {
  buildingId: string;
  floorPlansFiles: CdnFileRef[];
  apartmentsPlansFiles: CdnFileRef[];
  floorPlansData: FloorPlansDataEntry[];
}

export interface NewBuildingItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  developer: string;
  city: string;
  country: string;
  address?: string;
  delivery: string;
  priceFrom: string;
  priceTo: string;
  priceFromUsd: number;
  priceToUsd: number;
  totalUnits: number;
  freeUnits: number;
  soldUnits: number;
  floorsFrom?: number;
  floorsTo?: number;
  areaFrom?: number;
  areaTo?: number;
  images: string[];
  promos: { kind: 'top' | 'premium' | 'banner' | 'hot'; text?: string; color?: string }[];
  /** Active paid-service promotions for this complex (see promotion-paid-services doc). */
  promotions?: PromotionActivation[];
  commissionBeforeTax?: number;
  commissionAfterTax?: number;
  commissionBonus?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Promotion (paid services) — see docs/promotion-paid-services-api-integration.md ---

/** A single active paid-service record for a complex. */
export interface PromotionActivation {
  id: string;
  serviceId: string;
  durationId: PromoDurationId;
  priceUsd: number;
  activatedAt: string;
  expiresAt: string;
  config?: string | null;
}

export interface PromotionsResponse {
  complexId: string;
  activations: PromotionActivation[];
}

export interface ActivatePromotionPayload {
  serviceId: string;
  durationId: PromoDurationId;
  config?: string;
}

// --- Bookings (apartment booking) — see docs/booking-apartments-how-works-on-api.md ---

export type BookingStatus = 'pending' | 'booked' | 'rejected' | 'expired' | 'paid';

/** Booking record DTO returned by every /bookings endpoint. */
export interface Booking {
  id: string;
  complexId: string;
  buildingId: string;
  unitId: string;
  unitNumber: string | null;
  status: BookingStatus;
  realtorId: string | null;
  realtorName: string | null;
  agency: string | null;
  comment: string | null;
  manager: string | null;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingPayload {
  complexId: string;
  buildingId: string;
  unitId: string;
  unitNumber?: string;
  realtorName?: string;
  agency?: string;
  comment?: string;
  startsAt?: string;
  expiresAt?: string;
}

/** Регистрация клиента за риэлтором (коллекция development-sales-clients). */
export interface SalesClient {
  id: string;
  complexId: string;
  clientName: string;
  clientPhone: string;
  realtorId: string | null;
  realtorName: string;
  agency: string | null;
  comment: string | null;
  reservedUntil: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSalesClientPayload {
  complexId: string;
  clientName: string;
  clientPhone: string;
  realtorName: string;
  agency?: string;
  comment?: string;
  reservedUntil?: string;
}

export interface UpdateBookingPayload {
  expiresAt?: string;
  manager?: string;
  comment?: string;
}

/** Installment option as returned by chessboard / public unit landing. */
export interface InstallmentOptionDto {
  id: string;
  label: string;
  downPaymentPercent: number;
  termMonths: number;
  discountPercent?: number | null;
  paymentStep?: string;
  validUntil?: string | null;
  scope?: string;
  unitIds?: string[];
}

export interface PublicUnitInstallmentDto {
  base: InstallmentOptionDto;
  optional?: InstallmentOptionDto[];
}

/** CDN file resolved from imageFileId / estate coverFileId etc. */
export interface PublicCdnFileRef {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** Extended apartment fields from estatenewconstructionsapartments schema. */
export interface PublicUnitDetails {
  title?: string;
  identifier?: string;
  priceOld?: number;
  pricePerSqm?: number;
  finishPrices?: Partial<Record<string, number>>;
  currency?: string;
  livingArea?: number;
  kitchenArea?: number;
  balconyArea?: number;
  renovation?: string;
  bathroomsCount?: number;
  viewType?: string;
  viewTypes?: string[];
  isExclusive?: boolean;
  promo?: boolean;
}

/** Застройщик из коллекции `developers` (публичный лендинг). */
export interface PublicDeveloperProfile {
  name: string;
  description?: string;
  image?: string;
  website?: string;
}

/** Public landing payload for a single apartment (no auth). */
export interface PublicUnitLanding {
  unit: Unit & {
    floorPlanUrl?: string | null;
    floorPlanImage?: PublicCdnFileRef | null;
    details?: PublicUnitDetails;
    viewTypes?: string[];
  };
  building: {
    id: string;
    name: string;
    number?: string;
    address?: string;
  };
  complex: {
    id: string;
    name: string;
    city?: string;
    country?: string;
    district?: string;
    districtArea?: string;
    address?: string;
    coastline?: string;
    coordinates?: [number, number];
    /** Центр ЖК с визарда (`locationCenter`), [lng, lat]. */
    locationCenter?: [number, number];
    developer?: string;
    developerProfile?: PublicDeveloperProfile;
    classType?: string;
    completionDate?: string;
    developmentStage?: string;
    description?: string;
    descriptionWhy?: string;
    descriptionWho?: string;
    youtubeLink?: string;
    paymentTypes?: string[];
    finishTypes?: string[];
    wallMaterial?: string;
    ceilingHeight?: string;
    amenities?: string[];
    infrastructureInternal?: string[];
    infrastructureExternal?: string[];
    infrastructureLocation?: string[];
    areaPolygon?: [number, number][];
    /** Те же URL, что в каталоге новостроек (`GET /development/newbuildings` → `images`). */
    images?: string[];
    coverUrl?: string | null;
    cover?: PublicCdnFileRef | null;
    renders?: PublicCdnFileRef[];
    renderUrls?: string[];
    constructionProgress?: PublicCdnFileRef[];
    cityGallery?: PublicCdnFileRef[];
    districtGallery?: PublicCdnFileRef[];
    countryGallery?: PublicCdnFileRef[];
    /** Текст про район (вместо авто-сборки из инфраструктуры). */
    districtText?: string;
    /** Документы ЖК (PDF): разрешения, договоры. */
    documents?: string[];
    /** Доходность краткосрочной аренды, % годовых (из визарда). */
    rentalYieldShort?: number;
    /** Доходность долгосрочной аренды, % годовых. */
    rentalYieldLong?: number;
    /** Инвестиционная доходность / рост, %. */
    investmentYield?: number;
    /** Текст про арендный потенциал (вместо пресета по городу). */
    rentalText?: string;
    /** Текст про инвестиционный потенциал (вместо пресета). */
    investmentText?: string;
    currency?: 'USD' | 'EUR' | 'RUB' | 'GEL' | 'KZT' | string;
    installmentTerms?: { type: string; downPaymentPercent: number; durationMonths: number }[];
    installmentPlans?: IInstallmentPlan[];
  };
  installment?: PublicUnitInstallmentDto | null;
  /** Другие доступные лоты того же ЖК (сервер отдаёт до 6, ближайшие по площади). */
  similarUnits?: PublicSimilarUnitDto[];
}

/** Похожий лот из публичного лендинга (`similarUnits`). */
export interface PublicSimilarUnitDto {
  id: string;
  aptNum?: string;
  rooms?: string;
  floor?: number;
  area?: number;
  price?: number;
  price_old?: number;
  price_sqm?: number;
  image?: string | null;
  buildingId?: string | null;
}

export interface ComplexUnitStats {
  totalUnits: number;
  freeUnits: number;
  soldUnits: number;
}

type ChessboardPayload = {
  buildings?: Array<{
    sections?: Array<{
      floors?: Array<{
        units?: Array<{ id?: string; status?: string }>;
      }>;
    }>;
  }>;
};

function extractChessboardUnits(data: ChessboardPayload | null | undefined): Array<{ id: string; status: string }> {
  const units: Array<{ id: string; status: string }> = [];
  for (const building of data?.buildings ?? []) {
    for (const section of building.sections ?? []) {
      for (const floor of section.floors ?? []) {
        for (const unit of floor.units ?? []) {
          if (!unit?.id) continue;
          units.push({ id: unit.id, status: String(unit.status ?? '').toLowerCase() });
        }
      }
    }
  }
  return units;
}

function countComplexUnitStats(units: Array<{ status: string }>): ComplexUnitStats {
  let freeUnits = 0;
  let soldUnits = 0;
  for (const unit of units) {
    if (unit.status === 'available' || unit.status === 'free') freeUnits += 1;
    else if (unit.status === 'sold') soldUnits += 1;
  }
  return { totalUnits: units.length, freeUnits, soldUnits };
}

function mapPublicComplexToComplex(source: PublicUnitLanding['complex']): Complex {
  return {
    id: source.id,
    projectId: source.id,
    name: source.name,
    slug: '',
    status: 'active',
    class: source.classType as ComplexClass | undefined,
    completionDate: source.completionDate,
    startDate: source.developmentStage,
    description: source.description,
    descriptionSuccess: source.descriptionWhy,
    descriptionAudience: source.descriptionWho,
    country: source.country,
    city: source.city,
    developer: source.developer,
    coastline: source.coastline,
    propertyType: undefined,
    wallMaterial: source.wallMaterial,
    finishTypes: source.finishTypes,
    ceilingHeight: source.ceilingHeight,
    elevatorTypes: undefined,
    parkingTypes: undefined,
    parkingSpots: undefined,
    viewTypes: undefined,
    hasGas: undefined,
    waterSupply: undefined,
    sewerage: undefined,
    buildingPermit: undefined,
    infrastructureExternal: source.infrastructureExternal,
    infrastructureInternal: source.infrastructureInternal,
    infrastructureLocation: source.infrastructureLocation,
    currency: source.currency || 'USD',
    paymentTypes: source.paymentTypes,
    installmentTerms: source.installmentTerms,
    installmentPlans: source.installmentPlans,
    mortgageTerm: undefined,
    realtorScripts: undefined,
    youtubeLink: source.youtubeLink,
    areaPolygon: source.areaPolygon,
    locationCenter: source.locationCenter,
    districtText: source.districtText,
    rentalYieldShort: source.rentalYieldShort,
    rentalYieldLong: source.rentalYieldLong,
    investmentYield: source.investmentYield,
    rentalText: source.rentalText,
    investmentText: source.investmentText,
    createdAt: '',
    updatedAt: '',
  };
}

// --- Share links (docs/lot-landing-backend-api-recommendations.md §1) ---

/** Customization stored server-side: explicit map, no `blk` bitmask. */
export interface UnitShareLinkCustomizationDto {
  language?: string;
  currency?: string;
  theme?: string;
  brandingMode?: string;
  blocks?: Record<string, boolean>;
}

/** Sender card fields the API accepts (whitelisted; no email, no data-URLs). */
export interface UnitShareLinkSenderDto {
  name?: string;
  company?: string;
  role?: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  instagram?: string;
  website?: string;
  bio?: string;
  avatarUrl?: string;
  companyLogoUrl?: string;
}

export interface CreateUnitShareLinkPayload {
  unitId: string;
  customization?: UnitShareLinkCustomizationDto;
  sender?: UnitShareLinkSenderDto;
}

export interface UnitShareLinkDto {
  token: string;
  unitId: string;
  customization?: UnitShareLinkCustomizationDto | null;
  sender?: UnitShareLinkSenderDto | null;
  isRevoked?: boolean;
  viewCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

function unwrapMaybeEnvelope<T>(data: T | ApiResponse<T>): T {
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return (data as ApiResponse<T>).data;
  }
  return data as T;
}

export const developmentApi = {
  // Projects (mapped to Complexes in the UI usually, or top-level)
  getProjects: () => 
    api.get<ApiResponse<PaginatedResponse<Project>>>('/api/development/projects').then(r => r.data),

  // New Buildings (agent-facing catalog)
  getNewBuildings: (params?: { page?: number; limit?: number; search?: string; city?: string }) =>
    api.get<ApiResponse<PaginatedResponse<NewBuildingItem>>>('/api/development/newbuildings', { params }).then(r => r.data),

  // Complexes
  getComplexes: (params?: { page?: number; limit?: number; projectId?: string; status?: string; class?: string }) =>
    api.get<ApiResponse<PaginatedResponse<Complex>>>('/api/development/complexes', { params }).then(r => r.data),

  getComplexById: (id: string) =>
    api.get<ApiResponse<Complex>>(`/api/development/complexes/${id}`).then(r => r.data),

  /** Agent catalog: full passport for any active complex (owner API, then public landing fallback). */
  getComplexPassport: async (id: string): Promise<ApiResponse<Complex | null>> => {
    try {
      const resp = await api.get<ApiResponse<Complex>>(`/api/development/complexes/${id}`).then((r) => r.data);
      if (resp.success && resp.data) return resp;
    } catch (err: any) {
      const status = err.response?.status;
      if (status !== 403 && status !== 404) throw err;
    }

    try {
      const chessResp = await api
        .get<ApiResponse<ChessboardPayload>>(`/api/development/complexes/${id}/chessboard`)
        .then((r) => r.data);
      const units = extractChessboardUnits(chessResp.data);
      const sampleUnitId = units[0]?.id;
      if (!chessResp.success || !sampleUnitId) {
        return { success: false, data: null };
      }

      const pubResp = await api
        .get<ApiResponse<PublicUnitLanding>>(`/api/development/public/units/${sampleUnitId}`)
        .then((r) => r.data)
        .catch((err) => {
          const body = err.response?.data;
          if (body && typeof body === 'object' && 'success' in body) {
            return body as ApiResponse<PublicUnitLanding>;
          }
          throw err;
        });
      if (!pubResp.success || !pubResp.data?.complex) {
        return { success: false, data: null };
      }

      return { success: true, data: mapPublicComplexToComplex(pubResp.data.complex) };
    } catch {
      return { success: false, data: null };
    }
  },

  /** Real sold/available counts from the public chessboard (newbuildings list stats are often placeholders). */
  getComplexUnitStats: async (complexId: string): Promise<ComplexUnitStats | null> => {
    try {
      const resp = await api
        .get<ApiResponse<ChessboardPayload>>(`/api/development/complexes/${complexId}/chessboard`)
        .then((r) => r.data);
      if (!resp.success || !resp.data) return null;
      const units = extractChessboardUnits(resp.data);
      if (units.length === 0) return null;
      return countComplexUnitStats(units);
    } catch (error) {
      // ЧАСТИЧНАЯ мера. null здесь означает и «юнитов нет», и «не смогли
      // посчитать»: NewBuildingsListPage в обоих случаях оставляет числа из
      // списка, которые докстринг выше сам называет плейсхолдерами. То есть при
      // сбое пользователю показываются заведомо неточные счётчики проданного и
      // свободного без единого признака этого.
      //
      // Полное решение — различать два случая и показывать в списке, что
      // счётчики недоступны; это решение про интерфейс, а не про сервис.
      // Пока делаем сбой хотя бы диагностируемым.
      console.error(`[developmentApi.getComplexUnitStats] failed for ${complexId}:`, error);
      return null;
    }
  },

  createComplex: (data: Partial<Complex>) =>
    api.post<ApiResponse<Complex>>('/api/development/complexes', data).then(r => r.data),

  updateComplex: (id: string, data: Partial<Complex>) =>
    api.patch<ApiResponse<Complex>>(`/api/development/complexes/${id}`, data).then(r => r.data),

  deleteComplex: (id: string) =>
    api.delete<ApiResponse<{ deleted: boolean }>>(`/api/development/complexes/${id}`).then(r => r.data),

  // Buildings (Nested under Complex) — also extracts units from chessboard response
  getBuildings: async (complexId: string): Promise<ApiResponse<Building[]> & { units?: Unit[]; installment?: any }> => {
    const DEV_MOCK_IDS = ['c1', 'c2']
    if (DEV_MOCK_IDS.includes(complexId)) {
      return { success: true, data: [] }
    }

    const is404 = (err: any) => err.response?.status === 404;

    try {
      // The `/buildings` list endpoint holds the real, persisted per-building metadata
      // (floors, completionDate, startDate, plot). The `/chessboard` endpoint only carries
      // the actual filled-in units grid — its `sections/floors` count is NOT a reliable
      // stand-in for the building's own stored floor count, so we merge both responses below.
      const [chessResp, buildingsListResp] = await Promise.all([
        api.get<ApiResponse<any>>(`/api/development/complexes/${complexId}/chessboard`)
          .then(r => r.data)
          .catch(err => {
            if (is404(err)) return { success: false, _is404: true } as const;
            throw err;
          }),
        api.get<ApiResponse<{ items: any[]; total: number }>>(`/api/development/complexes/${complexId}/buildings`)
          .then(r => r.data)
          .catch(() => ({ success: false, data: { items: [], total: 0 } })),
      ]);

      const metaById = new Map<string, any>();
      if (buildingsListResp.success) {
        for (const item of buildingsListResp.data.items ?? []) {
          metaById.set(item.id, item);
        }
      }

      const resp = chessResp;
      if (resp.success && 'data' in resp && resp.data.buildings) {
        const buildings: Building[] = [];
        const units: Unit[] = [];

        for (const b of resp.data.buildings) {
          const allFloors: any[] = [];
          for (const section of (b.sections ?? [])) {
            for (const floor of (section.floors ?? [])) {
              allFloors.push(floor);
              for (const u of (floor.units ?? [])) {
                // Прокидываем поэтажный план этажа в каждый лот этого этажа,
                // т.к. в карточке лота "На этаже" берётся из unit, а planUrl лежит на уровне floor.
                units.push({
                  ...u,
                  buildingId: u.buildingId ?? b.id,
                  sectionId: u.sectionId ?? section.id ?? null,
                  sectionName: u.sectionName ?? section.name ?? null,
                  floorPlanUrl: floor.planUrl ?? null,
                });
              }
            }
          }

          const meta = metaById.get(b.id);

          buildings.push({
            id: b.id,
            complexId: complexId,
            name: meta?.name ?? b.name,
            number: b.number,
            // Prefer the building's own stored floor count from the buildings list endpoint;
            // only fall back to counting populated chessboard floors when it's missing
            // (e.g. legacy buildings created before `floors` was persisted).
            floors: typeof meta?.floors === 'number' && meta.floors > 0
              ? meta.floors
              : (typeof b.floors === 'number' && b.floors > 0 ? b.floors : (allFloors.length || 0)),
            completionDate: meta?.completionDate ?? b.completionDate,
            startDate: meta?.startDate,
            polygon: parsePlotToPolygon(meta?.plot) ?? b.polygon,
            createdAt: meta?.createdAt ?? b.createdAt,
            updatedAt: meta?.updatedAt ?? b.updatedAt,
          });
        }

        // Buildings that exist but have no chessboard data at all (e.g. brand new,
        // never opened in the chessboard editor) still need to show up in the wizard.
        for (const [id, meta] of metaById) {
          if (buildings.some((b) => b.id === id)) continue;
          buildings.push({
            id,
            complexId,
            name: meta.name,
            floors: meta.floors,
            completionDate: meta.completionDate,
            startDate: meta.startDate,
            polygon: parsePlotToPolygon(meta.plot),
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
          });
        }

        const installment = resp.data.installment ?? null;

        return { success: true, data: buildings, units, installment };
      }

      // No chessboard data yet — fall back to the plain buildings list so the wizard
      // still shows floors/dates for complexes that haven't opened the chessboard editor.
      if (metaById.size > 0) {
        const buildings: Building[] = Array.from(metaById.values()).map((meta) => ({
          id: meta.id,
          complexId,
          name: meta.name,
          floors: meta.floors,
          completionDate: meta.completionDate,
          startDate: meta.startDate,
          polygon: parsePlotToPolygon(meta.plot),
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        }));
        return { success: true, data: buildings };
      }

      return { success: true, data: [] };
    } catch (error) {
      // Раньше здесь возвращался success:true — то есть сбой выдавался за
      // успешный ответ «зданий нет». Вызывающий useCoreStore на success пишет
      // в стор результат, и обрыв сети превращал ЖК со зданиями в ЖК без
      // зданий, ничем не показав ошибку.
      //
      // success:false оба вызывающих (useCoreStore, ComplexAboutModal)
      // трактуют как «не обновлять» и сохраняют ранее загруженные данные.
      console.error('[developmentApi.getBuildings] failed:', error);
      return { success: false, data: [] };
    }
  },

  createBuilding: (complexId: string, data: { name: string; number?: string; floors?: number; completionDate?: string; startDate?: string; polygon?: [number, number][] }) =>
    api.post<ApiResponse<Building>>(`/api/development/complexes/${complexId}/buildings`, data).then(r => r.data),

  updateBuilding: (id: string, data: Partial<Building>) =>
    api.patch<ApiResponse<Building>>(`/api/development/buildings/${id}`, data).then(r => r.data),

  deleteBuilding: (id: string) =>
    api.delete<ApiResponse<{ deleted: boolean }>>(`/api/development/buildings/${id}`).then(r => r.data),

  // Units
  getUnits: (params?: any) =>
    api.get<ApiResponse<PaginatedResponse<Unit>>>('/api/development/units', { params })
      .then(r => r.data)
      .catch(err => {
        if (err.response?.status === 404) {
          return {
            success: true,
            data: { items: [], total: 0, page: 1, totalPages: 1 }
          } as ApiResponse<PaginatedResponse<Unit>>;
        }
        throw err;
      }),

  getUnitById: (id: string) =>
    api.get<ApiResponse<Unit>>(`/api/development/units/${id}`).then(r => r.data),

  /** Публичная карточка лота для клиентского лендинга (без обязательной авторизации). */
  getPublicUnitById: (id: string) =>
    api
      .get<ApiResponse<PublicUnitLanding>>(`/api/development/public/units/${id}`)
      .then((r) => r.data)
      .catch((err) => {
        const body = err.response?.data
        if (body && typeof body === 'object' && 'success' in body) {
          return body as ApiResponse<PublicUnitLanding>
        }
        throw err
      }),

  createUnit: (data: Partial<Unit>) =>
    api.post<ApiResponse<Unit>>('/api/development/units', data).then(r => r.data),

  updateUnit: (id: string, data: Partial<Unit>) =>
    api.patch<ApiResponse<Unit>>(`/api/development/units/${id}`, data).then(r => r.data),

  updateUnitStatus: (id: string, data: { status: UnitStatus; reason?: string; until?: string }) =>
    api.patch<ApiResponse<Unit>>(`/api/development/units/${id}/status`, data).then(r => r.data),

  /** Save the apartment contour (fractional 0..1 polygon points) for a single unit. */
  updateUnitPlot: (id: string, plot: [number, number][]) =>
    api.put<ApiResponse<Unit>>(`/api/development/units/${id}/plot`, { plot }).then(r => r.data),

  deleteUnit: (id: string) =>
    api.delete<ApiResponse<{ deleted: boolean }>>(`/api/development/units/${id}`).then(r => r.data),

  /**
   * Upload an Excel (.xlsx/.xls) spreadsheet of apartments for a building.
   * Each row becomes one apartment: existing apart numbers are updated, new ones created.
   * Only the first worksheet is read; row 1 = headers (case-insensitive); max 10MB.
   */
  uploadUnitsExcel: (file: File, estateId: string, buildingId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('estateId', estateId);
    formData.append('buildingId', buildingId);
    return api.post<ApiResponse<UnitsExcelUploadResult>>(
      '/api/development/units/upload-excel',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    ).then(r => r.data);
  },
  // Layouts
  getLayouts: (params: { complexId?: string; buildingId?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<PaginatedResponse<any>>>('/api/development/layouts', { params }).then(r => r.data),

  getLayoutById: (id: string) =>
    api.get<ApiResponse<any>>(`/api/development/layouts/${id}`).then(r => r.data),

  createLayout: (data: any) =>
    api.post<ApiResponse<any>>('/api/development/layouts', data).then(r => r.data),

  updateLayout: (id: string, data: any) =>
    api.patch<ApiResponse<any>>(`/api/development/layouts/${id}`, data).then(r => r.data),

  deleteLayout: (id: string) =>
    api.delete<ApiResponse<{ deleted: boolean }>>(`/api/development/layouts/${id}`).then(r => r.data),

  // Complexes — FormData (multipart, with images)
  createComplexWithFormData: (formData: FormData) =>
    api.post<ApiResponse<Complex>>('/api/development/complexes', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data),

  updateComplexWithFormData: (id: string, formData: FormData) =>
    api.patch<ApiResponse<Complex>>(`/api/development/complexes/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data),

  // Chessboard (Unified view)
  getChessboard: (complexId: string) =>
    api.get<ApiResponse<any>>(`/api/development/complexes/${complexId}/chessboard`).then(r => r.data),

  // Floor plans, apartment plans & interactive floor maps
  // See docs/creating-floorplans-and-apartment-plans.md
  getBuildingPlans: (buildingId: string) =>
    api.get<ApiResponse<BuildingPlansResponse>>(`/api/development/buildings/${buildingId}/plans`)
      .then(r => r.data)
      .catch(err => {
        if (err.response?.status === 404) {
          return {
            success: true,
            data: { buildingId, floorPlansFiles: [], apartmentsPlansFiles: [], floorPlansData: [] },
          } as ApiResponse<BuildingPlansResponse>;
        }
        throw err;
      }),

  uploadFloorPlans: (buildingId: string, files: File[], meta?: string[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('floorPlans', f));
    (meta ?? []).forEach(m => formData.append('floorPlanMeta', m));
    return api.post<ApiResponse<{ buildingId: string; uploaded: CdnFileRef[] }>>(
      `/api/development/buildings/${buildingId}/floor-plans`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ).then(r => r.data);
  },

  uploadApartmentPlans: (buildingId: string, files: File[], meta?: string[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('apartmentsPlans', f));
    (meta ?? []).forEach(m => formData.append('apartmentsPlanMeta', m));
    return api.post<ApiResponse<{ buildingId: string; uploaded: CdnFileRef[] }>>(
      `/api/development/buildings/${buildingId}/apartment-plans`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ).then(r => r.data);
  },

  deleteFloorPlanFile: (buildingId: string, fileId: string) =>
    api.delete<ApiResponse<{ buildingId: string; fileId: string; deleted: boolean }>>(
      `/api/development/buildings/${buildingId}/floor-plans/${fileId}`,
    ).then(r => r.data),

  deleteApartmentPlanFile: (buildingId: string, fileId: string) =>
    api.delete<ApiResponse<{ buildingId: string; fileId: string; deleted: boolean }>>(
      `/api/development/buildings/${buildingId}/apartment-plans/${fileId}`,
    ).then(r => r.data),

  updateFloormap: (buildingId: string, data: { imageId: string; floorNum: string; apartments?: string[] }) =>
    api.put<ApiResponse<FloorPlansDataEntry>>(
      `/api/development/buildings/${buildingId}/floormap`,
      data,
    ).then(r => r.data),

  deleteFloormap: (buildingId: string, floorNum: string) =>
    api.delete<ApiResponse<{ buildingId: string; floorNum: string; deleted: boolean }>>(
      `/api/development/buildings/${buildingId}/floormap/${floorNum}`,
    ).then(r => r.data),

  // Promotion (paid services) — see docs/promotion-paid-services-api-integration.md
  getPromotions: (complexId: string) =>
    api.get<ApiResponse<PromotionsResponse>>(`/api/development/complexes/${complexId}/promotions`)
      .then(r => r.data)
      .catch(err => {
        if (err.response?.status === 404) {
          return { success: true, data: { complexId, activations: [] } } as ApiResponse<PromotionsResponse>;
        }
        throw err;
      }),

  activatePromotion: (complexId: string, data: ActivatePromotionPayload) =>
    api.post<ApiResponse<PromotionActivation>>(
      `/api/development/complexes/${complexId}/promotions`,
      data,
    ).then(r => r.data),

  changePromotionDuration: (complexId: string, serviceId: string, durationId: PromoDurationId) =>
    api.patch<ApiResponse<PromotionActivation>>(
      `/api/development/complexes/${complexId}/promotions/${serviceId}`,
      { durationId },
    ).then(r => r.data),

  deactivatePromotion: (complexId: string, serviceId: string) =>
    api.delete<ApiResponse<{ serviceId: string; deleted: boolean }>>(
      `/api/development/complexes/${complexId}/promotions/${serviceId}`,
    ).then(r => r.data),

  // Аналитика девелопера — сводка по своим ЖК (см. docs/tracking/section-analytics.md)
  getAnalyticsSummary: (params?: { from?: string; to?: string; projectId?: string }) =>
    api.get<ApiResponse<DeveloperAnalyticsSummaryResponse>>('/api/development/analytics/summary', { params })
      .then(r => r.data),

  // Sales clients (регистрации клиентов за риэлторами)
  createSalesClient: (data: CreateSalesClientPayload) =>
    api.post<ApiResponse<SalesClient>>('/api/development/sales-clients', data).then(r => r.data),

  getSalesClients: (params?: { complexId?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<PaginatedResponse<SalesClient>>>('/api/development/sales-clients', { params })
      .then(r => r.data),

  // Bookings (apartment booking) — see docs/booking-apartments-how-works-on-api.md
  createBooking: (data: CreateBookingPayload) =>
    api.post<ApiResponse<Booking>>('/api/development/bookings', data).then(r => r.data),

  getBookings: (params?: { complexId?: string; status?: BookingStatus; page?: number; limit?: number }) =>
    api.get<ApiResponse<PaginatedResponse<Booking>>>('/api/development/bookings', { params })
      .then(r => r.data)
      .catch(err => {
        if (err.response?.status === 404) {
          return {
            success: true,
            data: { items: [], total: 0, page: 1, totalPages: 1 },
          } as ApiResponse<PaginatedResponse<Booking>>;
        }
        throw err;
      }),

  getBookingById: (id: string) =>
    api.get<ApiResponse<Booking>>(`/api/development/bookings/${id}`).then(r => r.data),

  updateBookingStatus: (id: string, data: { status: BookingStatus; comment?: string }) =>
    api.patch<ApiResponse<Booking>>(`/api/development/bookings/${id}/status`, data).then(r => r.data),

  updateBooking: (id: string, data: UpdateBookingPayload) =>
    api.patch<ApiResponse<Booking>>(`/api/development/bookings/${id}`, data).then(r => r.data),

  // Share links for public unit landings (`#/lot/:id?share=<token>`).
  // See docs/lot-landing-backend-api-recommendations.md §1. Responses may come
  // raw (berega-api) or wrapped in { success, data } (gateway) — unwrap both.
  createUnitShareLink: (payload: CreateUnitShareLinkPayload) =>
    api.post<UnitShareLinkDto | ApiResponse<UnitShareLinkDto>>('/api/share/unit-links', payload)
      .then(r => unwrapMaybeEnvelope<UnitShareLinkDto>(r.data)),

  getUnitShareLink: (token: string) =>
    api.get<UnitShareLinkDto | ApiResponse<UnitShareLinkDto>>(`/api/share/unit-links/${encodeURIComponent(token)}`)
      .then(r => unwrapMaybeEnvelope<UnitShareLinkDto>(r.data)),

  registerUnitShareLinkView: (token: string) =>
    api.post(`/api/share/unit-links/${encodeURIComponent(token)}/events`, { type: 'view' }).then(() => undefined),

  // Files
  uploadFile: (file: File, purpose?: string, entityType?: string, entityId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (purpose) formData.append('purpose', purpose);
    if (entityType) formData.append('entityType', entityType);
    if (entityId) formData.append('entityId', entityId);
    return api.post<ApiResponse<FileEntity>>('/api/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data);
  }
};
