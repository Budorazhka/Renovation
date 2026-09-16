import { Building2, FileText, Home, MapPin, Sparkles, TrendingUp } from 'lucide-react'

import type { ToggleGroup } from '@/components/selections/SelectionCustomizationPanel'
import type { SelectionCurrency, SelectionLanguage } from '@/lib/selection-display'
import {
  UNIT_SHARE_SWITCH_LABELS_RU,
  UNIT_VISIT_BLOCK_ORDER,
  type UnitShareVisitBlockKey,
  visitBlockLabel,
} from '@/lib/unit-visit-block-labels'
import { resolveUnitVisitTheme, type UnitVisitTheme } from '@/lib/unit-visit-theme'
import type { IProject, IUnit } from '@/types/core'

type LegacyShareBlockKey =
  | 'countryInfo'
  | 'cityInfo'
  | 'projectGallery'
  | 'projectOverview'
  | 'projectDescription'
  | 'amenities'
  | 'locationMap'
  | 'video'
  | 'constructionProgress'
  | 'unitPlan'
  | 'unitSpecs'
  | 'unitStatus'
  | 'unitPrice'
  | 'paymentPlans'
  | 'bazasaleLogo'
  | 'realtorLogo'
  | 'agentContacts'

/** Блоки клиентского портала дев-подборки и визитки лота. */
export type DevSelectionBlockKey =
  | LegacyShareBlockKey
  | 'shareObjectInfo'
  | 'shareHero'
  | 'shareBazaBranding'
  | 'shareBranding'
  | 'shareUnitCard'
  | 'shareUnitPlan'
  | 'shareUnitGallery'
  | 'shareUnitFinance'
  | 'shareInstallment'
  | 'shareFullPayment'
  | 'shareProjectInfo'
  | 'shareProjectGallery'
  | 'shareProjectInfrastructure'
  | 'shareProjectLocation'
  | 'shareDeveloperInfo'
  | 'shareLegalInfo'
  | 'sharePurchaseFlow'
  | 'shareCityInfo'
  | 'shareCityGallery'
  | 'shareDistrictInfo'
  | 'shareDistrictGallery'
  | 'shareCountryInfo'
  | 'shareCountryGallery'
  | 'shareInvestmentPotential'
  | 'shareRentalPotential'
  | 'shareSimilarUnits'
  | 'shareRealtorCard'
  | 'shareStickyContacts'
  | 'shareFinalCta'
  | 'shareProjectMap'
  | 'shareDistrict'
  | 'shareCity'
  | 'shareCountry'
  | 'shareRealtorAvatar'
  | 'shareRealtorInfo'
  | 'shareDeveloperCompanyName'
  | 'shareDeveloperLogo'

export type BrandingMode = 'baza' | 'agent'

export type UnitShareCustomizationInput = Partial<Omit<DevSelectionCustomization, 'blocks'>> & {
  blocks?: Partial<Record<DevSelectionBlockKey, boolean>>
}

export interface DevSelectionCustomization {
  language: SelectionLanguage
  currency: SelectionCurrency
  theme: UnitVisitTheme
  blocks: Record<DevSelectionBlockKey, boolean>
  brandingMode: BrandingMode
}

export type UnitSharePresetId =
  | 'short'
  | 'standard'
  | 'foreignBuyer'
  | 'investor'
  | 'maximal'

export interface UnitSharePreset {
  id: UnitSharePresetId
  label: string
  description: string
  enabledBlocks: UnitShareVisitBlockKey[]
}

const ALL_SHARE_BLOCKS_FALSE: Record<UnitShareVisitBlockKey, boolean> = UNIT_VISIT_BLOCK_ORDER.reduce(
  (acc, key) => {
    acc[key] = false
    return acc
  },
  {} as Record<UnitShareVisitBlockKey, boolean>,
)

const DEFAULT_SHARE_BLOCKS: Record<UnitShareVisitBlockKey, boolean> = {
  ...ALL_SHARE_BLOCKS_FALSE,
  shareObjectInfo: true,
  shareHero: true,
  shareBazaBranding: false,
  shareBranding: true,
  shareUnitCard: true,
  shareUnitPlan: true,
  shareUnitGallery: true,
  shareUnitFinance: true,
  shareInstallment: true,
  shareFullPayment: true,
  shareProjectInfo: true,
  shareProjectGallery: true,
  shareProjectInfrastructure: true,
  shareProjectLocation: true,
  shareDeveloperInfo: true,
  shareLegalInfo: true,
  sharePurchaseFlow: true,
  shareCityInfo: false,
  shareCityGallery: false,
  shareDistrictInfo: true,
  shareDistrictGallery: true,
  shareCountryInfo: false,
  shareCountryGallery: false,
  shareInvestmentPotential: false,
  shareRentalPotential: false,
  shareSimilarUnits: true,
  shareRealtorCard: false,
  shareStickyContacts: true,
  shareFinalCta: true,
  shareProjectMap: true,
  shareDistrict: true,
  shareCity: false,
  shareCountry: false,
  shareRealtorAvatar: true,
  shareRealtorInfo: true,
  shareDeveloperCompanyName: true,
  shareDeveloperLogo: true,
}

export const DEFAULT_DEV_CUSTOMIZATION: DevSelectionCustomization = {
  language: 'en',
  currency: 'USD',
  theme: 'dark',
  brandingMode: 'agent',
  blocks: {
    countryInfo: true,
    cityInfo: true,
    projectGallery: true,
    projectOverview: true,
    projectDescription: true,
    amenities: true,
    locationMap: true,
    video: true,
    constructionProgress: true,
    unitPlan: true,
    unitSpecs: true,
    unitStatus: true,
    unitPrice: true,
    paymentPlans: true,
    bazasaleLogo: true,
    realtorLogo: true,
    agentContacts: true,
    ...DEFAULT_SHARE_BLOCKS,
  },
}

export const UNIT_SHARE_PRESETS: UnitSharePreset[] = [
  {
    id: 'short',
    label: 'Короткая',
    description: 'Тёплому клиенту или быстрая отправка в WhatsApp / Telegram. Только самое нужное.',
    enabledBlocks: [
      'shareHero',
      'shareBranding',
      'shareRealtorAvatar',
      'shareRealtorInfo',
      'shareUnitCard',
      'shareUnitFinance',
      'shareInstallment',
      'shareFullPayment',
      'shareUnitGallery',
      'shareUnitPlan',
      'shareProjectInfo',
      'shareProjectGallery',
      'shareProjectLocation',
      'shareProjectMap',
      'shareStickyContacts',
      'shareFinalCta',
    ],
  },
  {
    id: 'standard',
    label: 'Стандартная',
    description: 'Полноценная презентация квартиры и проекта. Подходит для большинства клиентов.',
    enabledBlocks: [
      'shareHero',
      'shareBranding',
      'shareRealtorAvatar',
      'shareRealtorInfo',
      'shareUnitCard',
      'shareUnitFinance',
      'shareInstallment',
      'shareFullPayment',
      'shareUnitGallery',
      'shareUnitPlan',
      'shareProjectInfo',
      'shareProjectGallery',
      'shareProjectInfrastructure',
      'shareProjectLocation',
      'shareProjectMap',
      'shareDistrict',
      'shareDistrictInfo',
      'shareDistrictGallery',
      'shareDeveloperInfo',
      'shareDeveloperCompanyName',
      'shareDeveloperLogo',
      'sharePurchaseFlow',
      'shareLegalInfo',
      'shareSimilarUnits',
      'shareStickyContacts',
      'shareFinalCta',
    ],
  },
  {
    id: 'foreignBuyer',
    label: 'Иностранный покупатель',
    description: 'Для покупателей из другой страны. Объясняет объект, город, страну и процедуру покупки.',
    enabledBlocks: [
      'shareHero',
      'shareBranding',
      'shareRealtorAvatar',
      'shareRealtorInfo',
      'shareUnitCard',
      'shareUnitFinance',
      'shareInstallment',
      'shareFullPayment',
      'shareUnitGallery',
      'shareUnitPlan',
      'shareProjectInfo',
      'shareProjectGallery',
      'shareProjectInfrastructure',
      'shareProjectLocation',
      'shareProjectMap',
      'shareDistrict',
      'shareDistrictInfo',
      'shareDistrictGallery',
      'shareCity',
      'shareCityInfo',
      'shareCityGallery',
      'shareCountry',
      'shareCountryInfo',
      'shareCountryGallery',
      'shareDeveloperInfo',
      'shareDeveloperCompanyName',
      'shareDeveloperLogo',
      'shareLegalInfo',
      'sharePurchaseFlow',
      'shareStickyContacts',
      'shareFinalCta',
    ],
  },
  {
    id: 'investor',
    label: 'Инвестор',
    description: 'Показывает объект как инвестиционное решение. Акцент на доходности и ликвидности.',
    enabledBlocks: [
      'shareHero',
      'shareBranding',
      'shareRealtorAvatar',
      'shareRealtorInfo',
      'shareUnitCard',
      'shareUnitFinance',
      'shareInstallment',
      'shareFullPayment',
      'shareUnitGallery',
      'shareProjectInfo',
      'shareProjectGallery',
      'shareProjectInfrastructure',
      'shareProjectLocation',
      'shareProjectMap',
      'shareDistrict',
      'shareDistrictInfo',
      'shareDistrictGallery',
      'shareInvestmentPotential',
      'shareRentalPotential',
      'shareCity',
      'shareCityInfo',
      'shareCityGallery',
      'shareDeveloperInfo',
      'shareDeveloperCompanyName',
      'shareDeveloperLogo',
      'sharePurchaseFlow',
      'shareLegalInfo',
      'shareSimilarUnits',
      'shareStickyContacts',
      'shareFinalCta',
    ],
  },
  {
    id: 'maximal',
    label: 'Максимальная',
    description: 'Все разделы включены. Для дорогих объектов, иностранных клиентов и холодной аудитории.',
    enabledBlocks: UNIT_VISIT_BLOCK_ORDER.filter(
      (key) => key !== 'shareRealtorCard' && key !== 'shareBazaBranding',
    ),
  },
]

export const DEV_CUSTOMIZATION_GROUPS: ToggleGroup<DevSelectionBlockKey>[] = [
  {
    title: 'Проект',
    items: [
      { key: 'projectGallery', label: 'Галерея проекта' },
      { key: 'projectOverview', label: 'Обзор (класс, сдача, цены)' },
      { key: 'projectDescription', label: 'Описание комплекса' },
      { key: 'amenities', label: 'Удобства и инфраструктура' },
      { key: 'locationMap', label: 'Расположение на карте' },
      { key: 'video', label: 'Видео-презентация' },
      { key: 'constructionProgress', label: 'Ход строительства' },
    ],
  },
  {
    title: 'Объект',
    items: [
      { key: 'unitPlan', label: 'Планировка' },
      { key: 'unitSpecs', label: 'Характеристики' },
      { key: 'unitStatus', label: 'Статус продажи' },
      { key: 'unitPrice', label: 'Цена' },
      { key: 'paymentPlans', label: 'Способы оплаты' },
    ],
  },
  {
    title: 'Контакты',
    items: [{ key: 'agentContacts', label: 'Контакты агента' }],
  },
]

/**
 * Группы кастомизации подборки вторичного рынка (N-27). Листинг/объект вторички
 * не имеет проектных/девелоперских полей, поэтому из общего набора блоков лота
 * переиспользованы только применимые к вторичке ключи (unitSpecs/unitPrice —
 * трактуются как «характеристики»/«цена» листинга, а не юнита новостройки).
 */
export const SECONDARY_CUSTOMIZATION_GROUPS: ToggleGroup<DevSelectionBlockKey>[] = [
  {
    title: 'Объект',
    items: [
      { key: 'unitSpecs', label: 'Характеристики' },
      { key: 'unitPrice', label: 'Цена' },
    ],
  },
  {
    title: 'Контакты',
    items: [{ key: 'agentContacts', label: 'Контакты агента' }],
  },
]

/**
 * Группы кастомизации для PDF одного лота. Брошюра лота умеет рисовать только
 * эти блоки — поэтому из общего списка исключены те, которых в ней нет.
 */
export function buildUnitPdfGroups(
  _unit?: IUnit | null,
  _project?: IProject | null,
): ToggleGroup<DevSelectionBlockKey>[] {
  return [
    {
      title: 'Объект',
      items: [
        { key: 'unitPlan', label: 'Планировка' },
        { key: 'unitSpecs', label: 'Характеристики' },
        { key: 'unitPrice', label: 'Цена' },
      ],
    },
    {
      title: 'Проект',
      items: [
        { key: 'projectGallery', label: 'Фотогалерея проекта' },
        { key: 'projectDescription', label: 'Описание комплекса' },
        { key: 'amenities', label: 'Удобства и инфраструктура' },
        { key: 'paymentPlans', label: 'Способы оплаты' },
      ],
    },
    {
      title: 'Контакты',
      items: [{ key: 'agentContacts', label: 'Карточка консультанта' }],
    },
  ]
}

function buildPresetBlocks(enabledBlocks: UnitShareVisitBlockKey[]): Record<UnitShareVisitBlockKey, boolean> {
  const set = new Set(enabledBlocks)
  return UNIT_VISIT_BLOCK_ORDER.reduce(
    (acc, key) => {
      acc[key] = set.has(key)
      return acc
    },
    { ...ALL_SHARE_BLOCKS_FALSE },
  )
}

function applyShareBlocks(
  base: DevSelectionCustomization,
  blocks: Partial<Record<UnitShareVisitBlockKey, boolean>>,
): DevSelectionCustomization {
  return {
    ...base,
    blocks: {
      ...base.blocks,
      ...blocks,
    },
  }
}

export function getUnitSharePreset(id: UnitSharePresetId): UnitSharePreset {
  return UNIT_SHARE_PRESETS.find((preset) => preset.id === id) ?? UNIT_SHARE_PRESETS[1]
}

export function applyUnitSharePreset(
  presetId: UnitSharePresetId,
  customization?: Partial<DevSelectionCustomization> | null,
): DevSelectionCustomization {
  const base = resolveDevCustomization(customization)
  const preset = getUnitSharePreset(presetId)
  const result = applyShareBlocks(base, buildPresetBlocks(preset.enabledBlocks))
  result.blocks.shareRealtorCard = false
  return result
}

export function detectUnitSharePresetId(
  customization: DevSelectionCustomization,
): UnitSharePresetId | null {
  return (
    UNIT_SHARE_PRESETS.find((preset) =>
      UNIT_VISIT_BLOCK_ORDER.every(
        (key) => customization.blocks[key] === buildPresetBlocks(preset.enabledBlocks)[key],
      ),
    )?.id ?? null
  )
}

function hasExplicitModernShareBlocks(
  blocks?: Partial<Record<string, boolean>> | null,
): boolean {
  return UNIT_VISIT_BLOCK_ORDER.some((key) => typeof blocks?.[key] === 'boolean')
}

function migrateLegacyShareBlocks(
  blocks?: Partial<Record<string, boolean>> | null,
): Partial<Record<UnitShareVisitBlockKey, boolean>> {
  if (!blocks) return {}
  const next: Partial<Record<UnitShareVisitBlockKey, boolean>> = {}
  const set = (key: UnitShareVisitBlockKey, value: boolean | undefined) => {
    if (typeof value === 'boolean') next[key] = value
  }

  const anyLegacy =
    'bazasaleLogo' in blocks ||
    'agentContacts' in blocks ||
    'projectDescription' in blocks ||
    'amenities' in blocks ||
    'realtorLogo' in blocks ||
    'unitPlan' in blocks ||
    'paymentPlans' in blocks ||
    'locationMap' in blocks ||
    'countryInfo' in blocks ||
    'projectGallery' in blocks ||
    'cityInfo' in blocks ||
    'constructionProgress' in blocks

  if (!anyLegacy || hasExplicitModernShareBlocks(blocks)) return next

  set('shareHero', true)
  set('shareBranding', blocks.bazasaleLogo || blocks.agentContacts)
  set('shareUnitCard', blocks.unitPlan || blocks.unitSpecs || blocks.unitStatus || blocks.unitPrice)
  set('shareUnitPlan', blocks.unitPlan)
  set('shareUnitGallery', blocks.projectGallery || blocks.constructionProgress)
  set('shareUnitFinance', blocks.paymentPlans || blocks.unitPrice)
  set('shareProjectInfo', blocks.projectDescription || blocks.projectOverview)
  set('shareProjectGallery', blocks.projectGallery || blocks.constructionProgress)
  set('shareProjectInfrastructure', blocks.amenities)
  set('shareProjectLocation', blocks.locationMap)
  set('shareDeveloperInfo', blocks.realtorLogo)
  set('shareCityInfo', blocks.cityInfo)
  set('shareCityGallery', blocks.cityInfo)
  set('shareCountryInfo', blocks.countryInfo)
  set('shareCountryGallery', blocks.countryInfo)
  set('shareRealtorCard', blocks.agentContacts)
  set('shareStickyContacts', blocks.agentContacts)
  set('shareFinalCta', blocks.agentContacts)
  return next
}

/** Переключатели для модалки «Поделиться» — 25 подблоков мини-лендинга. */
export function buildUnitShareGroups(
  _unit?: IUnit | null,
  _project?: IProject | null,
): ToggleGroup<DevSelectionBlockKey>[] {
  return [
    {
      title: 'Первый экран',
      icon: Sparkles,
      items: [
        { key: 'shareObjectInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareObjectInfo ?? 'Презентация объекта' },
        { key: 'shareBazaBranding', label: UNIT_SHARE_SWITCH_LABELS_RU.shareBazaBranding ?? 'Отправитель BAZA.sale' },
        { key: 'shareBranding', label: UNIT_SHARE_SWITCH_LABELS_RU.shareBranding ?? visitBlockLabel('ru', 'shareBranding') },
        { key: 'shareRealtorAvatar', label: UNIT_SHARE_SWITCH_LABELS_RU.shareRealtorAvatar ?? visitBlockLabel('ru', 'shareRealtorAvatar') },
        { key: 'shareRealtorInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareRealtorInfo ?? visitBlockLabel('ru', 'shareRealtorInfo') },
        { key: 'shareStickyContacts', label: UNIT_SHARE_SWITCH_LABELS_RU.shareStickyContacts ?? visitBlockLabel('ru', 'shareStickyContacts') },
        { key: 'shareFinalCta', label: UNIT_SHARE_SWITCH_LABELS_RU.shareFinalCta ?? visitBlockLabel('ru', 'shareFinalCta') },
      ],
    },
    {
      title: 'Квартира / лот',
      icon: Home,
      items: [
        { key: 'shareUnitCard', label: UNIT_SHARE_SWITCH_LABELS_RU.shareUnitCard ?? visitBlockLabel('ru', 'shareUnitCard') },
        { key: 'shareUnitPlan', label: UNIT_SHARE_SWITCH_LABELS_RU.shareUnitPlan ?? visitBlockLabel('ru', 'shareUnitPlan') },
        { key: 'shareUnitFinance', label: UNIT_SHARE_SWITCH_LABELS_RU.shareUnitFinance ?? visitBlockLabel('ru', 'shareUnitFinance') },
        { key: 'shareInstallment', label: UNIT_SHARE_SWITCH_LABELS_RU.shareInstallment ?? visitBlockLabel('ru', 'shareInstallment') },
        { key: 'shareFullPayment', label: UNIT_SHARE_SWITCH_LABELS_RU.shareFullPayment ?? visitBlockLabel('ru', 'shareFullPayment') },
      ],
    },
    {
      title: 'Проект / жилой комплекс',
      icon: Building2,
      items: [
        { key: 'shareProjectInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareProjectInfo ?? visitBlockLabel('ru', 'shareProjectInfo') },
        { key: 'shareProjectGallery', label: UNIT_SHARE_SWITCH_LABELS_RU.shareProjectGallery ?? visitBlockLabel('ru', 'shareProjectGallery') },
        { key: 'shareProjectInfrastructure', label: UNIT_SHARE_SWITCH_LABELS_RU.shareProjectInfrastructure ?? visitBlockLabel('ru', 'shareProjectInfrastructure') },
        { key: 'shareProjectLocation', label: UNIT_SHARE_SWITCH_LABELS_RU.shareProjectLocation ?? visitBlockLabel('ru', 'shareProjectLocation') },
        { key: 'shareProjectMap', label: UNIT_SHARE_SWITCH_LABELS_RU.shareProjectMap ?? visitBlockLabel('ru', 'shareProjectMap') },
      ],
    },
    {
      title: 'Застройщик и документы',
      icon: FileText,
      items: [
        { key: 'shareDeveloperInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareDeveloperInfo ?? visitBlockLabel('ru', 'shareDeveloperInfo') },
        { key: 'shareDeveloperCompanyName', label: UNIT_SHARE_SWITCH_LABELS_RU.shareDeveloperCompanyName ?? visitBlockLabel('ru', 'shareDeveloperCompanyName') },
        { key: 'shareDeveloperLogo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareDeveloperLogo ?? visitBlockLabel('ru', 'shareDeveloperLogo') },
        { key: 'sharePurchaseFlow', label: UNIT_SHARE_SWITCH_LABELS_RU.sharePurchaseFlow ?? visitBlockLabel('ru', 'sharePurchaseFlow') },
        { key: 'shareLegalInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareLegalInfo ?? visitBlockLabel('ru', 'shareLegalInfo') },
      ],
    },
    {
      title: 'Район, город и страна',
      icon: MapPin,
      items: [
        { key: 'shareDistrict', label: UNIT_SHARE_SWITCH_LABELS_RU.shareDistrict ?? visitBlockLabel('ru', 'shareDistrict') },
        { key: 'shareDistrictInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareDistrictInfo ?? visitBlockLabel('ru', 'shareDistrictInfo') },
        { key: 'shareDistrictGallery', label: UNIT_SHARE_SWITCH_LABELS_RU.shareDistrictGallery ?? visitBlockLabel('ru', 'shareDistrictGallery') },
        { key: 'shareCity', label: UNIT_SHARE_SWITCH_LABELS_RU.shareCity ?? visitBlockLabel('ru', 'shareCity') },
        { key: 'shareCityInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareCityInfo ?? visitBlockLabel('ru', 'shareCityInfo') },
        { key: 'shareCityGallery', label: UNIT_SHARE_SWITCH_LABELS_RU.shareCityGallery ?? visitBlockLabel('ru', 'shareCityGallery') },
        { key: 'shareCountry', label: UNIT_SHARE_SWITCH_LABELS_RU.shareCountry ?? visitBlockLabel('ru', 'shareCountry') },
        { key: 'shareCountryInfo', label: UNIT_SHARE_SWITCH_LABELS_RU.shareCountryInfo ?? visitBlockLabel('ru', 'shareCountryInfo') },
        { key: 'shareCountryGallery', label: UNIT_SHARE_SWITCH_LABELS_RU.shareCountryGallery ?? visitBlockLabel('ru', 'shareCountryGallery') },
      ],
    },
    {
      title: 'Инвестиционная логика',
      icon: TrendingUp,
      items: [
        { key: 'shareInvestmentPotential', label: UNIT_SHARE_SWITCH_LABELS_RU.shareInvestmentPotential ?? visitBlockLabel('ru', 'shareInvestmentPotential') },
        { key: 'shareRentalPotential', label: UNIT_SHARE_SWITCH_LABELS_RU.shareRentalPotential ?? visitBlockLabel('ru', 'shareRentalPotential') },
        { key: 'shareSimilarUnits', label: UNIT_SHARE_SWITCH_LABELS_RU.shareSimilarUnits ?? visitBlockLabel('ru', 'shareSimilarUnits') },
      ],
    },
  ]
}

/** Кастомизация визитки с миграцией старых share-черновиков. */
export function resolveUnitShareCustomization(
  c?: UnitShareCustomizationInput | null,
): DevSelectionCustomization {
  const devBase = resolveDevCustomization(c)
  const devShareBlocks = devBase.blocks as Partial<Record<UnitShareVisitBlockKey, boolean>>
  const rawBlocks = c?.blocks as Partial<Record<UnitShareVisitBlockKey, boolean>> | undefined
  const legacyShareBlocks = migrateLegacyShareBlocks(rawBlocks)
  const presetBlocks = buildPresetBlocks(getUnitSharePreset('maximal').enabledBlocks)
  const shareBlocks = {} as Record<UnitShareVisitBlockKey, boolean>

  for (const key of UNIT_VISIT_BLOCK_ORDER) {
    const raw = rawBlocks?.[key]
    if (typeof raw === 'boolean') {
      shareBlocks[key] = raw
    } else if (typeof legacyShareBlocks[key] === 'boolean') {
      shareBlocks[key] = legacyShareBlocks[key]!
    } else if (typeof devShareBlocks[key] === 'boolean') {
      shareBlocks[key] = devShareBlocks[key]!
    } else {
      shareBlocks[key] = presetBlocks[key]
    }
  }

  const resolved = applyShareBlocks(devBase, shareBlocks)
  resolved.brandingMode = c?.brandingMode ?? resolved.brandingMode ?? 'agent'
  resolved.blocks.shareRealtorCard = false
  return resolved
}

export function getDefaultUnitShareCustomization(): DevSelectionCustomization {
  return applyUnitSharePreset('standard')
}

/** Достраивает кастомизацию дефолтами (обратная совместимость со старыми подборками). */
export function resolveDevCustomization(
  c?: UnitShareCustomizationInput | null,
): DevSelectionCustomization {
  return {
    language: c?.language ?? DEFAULT_DEV_CUSTOMIZATION.language,
    currency: c?.currency ?? DEFAULT_DEV_CUSTOMIZATION.currency,
    theme: resolveUnitVisitTheme(c?.theme),
    brandingMode: c?.brandingMode ?? DEFAULT_DEV_CUSTOMIZATION.brandingMode,
    blocks: { ...DEFAULT_DEV_CUSTOMIZATION.blocks, ...(c?.blocks ?? {}) },
  }
}
