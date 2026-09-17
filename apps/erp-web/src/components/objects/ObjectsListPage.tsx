import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlignJustify,
  AlertTriangle,
  Archive,
  ArrowUpDown,
  BedDouble,
  BookmarkPlus,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Crown,
  Eye,
  Heart,
  LayoutGrid,
  Mail,
  MapPin,
  Maximize2,
  MousePointerClick,
  Network,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Rows3,
  Search,
  Share2,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { isSecondarySelection } from '@/types/dev-selection'
import { ObjectEditWizard } from './ObjectEditWizard'
import type {
  ConditionState,
  Property,
  PropertyCategory,
  PropertyType,
  SaleStatus,
} from '@/components/management/my-properties/types'
import { getConditionState } from '@/components/management/my-properties/utils'
import { FMT_USD } from '@/lib/format-currency'
import { formatPropertyUnitPrice } from '@/lib/property-unit-price'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { mapPropertyAssetToUiProperty, type PropertyWithAssetInfo } from '@/lib/map-property-asset'
import { canDo } from '@/lib/permissions'
import { propertyAssetsApi } from '@/services/propertyAssetsApi'
import { MlsConfirmDialog, type MlsDialogMode } from './MlsConfirmDialog'
import { MlsJoinDialog } from './MlsJoinDialog'
import { ObjectPhotoCarousel } from './ObjectPhotoCarousel'
import { toggleFavorite, useFavorites } from './favorites-store'
import './objects-list.css'
import { useI18n } from "@/i18n";

const FMT_M2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

type StatPeriod = 'week' | 'month' | 'all'
type TypeFilter = PropertyType | 'all'
type StatusFilter = SaleStatus | 'all'
type FreshnessFilter = ConditionState | 'all'
type MlsFilter = 'all' | 'in' | 'out'
type ViewMode = 'cards' | 'compact' | 'table'

const PERIODS: { value: StatPeriod; label: string }[] = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
]

/** Редактирование, удаление и подтверждение актуальности — пока только disabled на клиенте. */
const CATALOG_EDIT_DELETE_DISABLED = false

const MARKET_TABS: { id: PropertyCategory; label: string }[] = [
  { id: 'secondary', label: 'Вторичка' },
  { id: 'rent', label: 'Аренда' },
  { id: 'commercial', label: 'Коммерция' },
  { id: 'other', label: 'Прочее' },
]

const ROOMS_FORMATS = ['Студия', '1+1', '2+1', '3+1', '4+1'] as const
type RoomsFormat = (typeof ROOMS_FORMATS)[number]

const STATUS_META: Record<SaleStatus, { label: string; tone: string }> = {
  for_sale: { label: 'В продаже', tone: 'positive' },
  booked: { label: 'Забронировано', tone: 'processing' },
  sold: { label: 'Продано', tone: 'neutral' },
  moderation: { label: 'На модерации', tone: 'processing' },
  draft: { label: 'Черновик', tone: 'neutral' },
  archive: { label: 'Архив', tone: 'neutral' },
}

const FRESHNESS_META = {
  up_to_date: {
    label: 'Актуально',
    tone: 'positive',
    Icon: CheckCircle2,
  },
  needs_attention: {
    label: 'Проверить скоро',
    tone: 'warning',
    Icon: Clock3,
  },
  needs_update: {
    label: 'Нужно обновить',
    tone: 'danger',
    Icon: AlertTriangle,
  },
} satisfies Record<
  ConditionState,
  { label: string; tone: string; Icon: typeof CheckCircle2 }
>

function getStats(id: string, period: StatPeriod) {
  const seed = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const multiplier = ({ week: 0.22, month: 0.65, all: 1 } as const)[period]

  return {
    views: Math.round(((seed * 43 % 3500) + 900) * multiplier),
    clicks: Math.round(((seed * 17 % 600) + 180) * multiplier),
    favorites: Math.round(((seed * 7 % 80) + 25) * multiplier),
    shares: Math.round(((seed * 5 % 60) + 15) * multiplier),
  }
}

function roomsLabel(rooms: number): RoomsFormat {
  if (rooms <= 1) return 'Студия'
  if (rooms >= 5) return '4+1'
  return `${rooms - 1}+1` as RoomsFormat
}

function formatDate(value: string) {
  return DATE_FORMATTER.format(new Date(value))
}

function getDaysSince(value: string) {
  const date = new Date(value)
  const today = new Date()
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000))
}

function todayIsoDate() {
  const now = new Date()
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return localNow.toISOString().slice(0, 10)
}

export function ObjectsListPage() {
    const { t } = useI18n();
  const navigate = useNavigate()
  const [marketTab, setMarketTab] = useState<PropertyCategory>('secondary')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  const [sortDesc, setSortDesc] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [areaMin, setAreaMin] = useState('')
  const [areaMax, setAreaMax] = useState('')
  const [floorMin, setFloorMin] = useState('')
  const [floorMax, setFloorMax] = useState('')
  const [roomsFmt, setRoomsFmt] = useState<RoomsFormat | 'all'>('all')
  const [cities, setCities] = useState<Set<string>>(new Set())
  const [mlsFilter, setMlsFilter] = useState<MlsFilter>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const favorites = useFavorites()
  const allSelections = useDevSelectionsStore((s) => s.selections)
  const fetchSelections = useDevSelectionsStore((s) => s.fetchAll)
  const addItemsToSelection = useDevSelectionsStore((s) => s.addItems)
  const secondarySelections = useMemo(() => allSelections.filter(isSecondarySelection), [allSelections])
  useEffect(() => {
    void fetchSelections()
  }, [fetchSelections])
  const [confirmRefreshId, setConfirmRefreshId] = useState<string | null>(null)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [selectionTargetId, setSelectionTargetId] = useState<string | null>(null)
  const [editWizardId, setEditWizardId] = useState<string | null>(null)
  const [createDraft, setCreateDraft] = useState<Property | null>(null)
  const [mlsDialog, setMlsDialog] = useState<{ id: string; mode: MlsDialogMode } | null>(null)
  const [mlsJoinOpen, setMlsJoinOpen] = useState(false)
  /** Переопределение статуса MLS поверх API-данных: id → в MLS или нет. */
  const [mlsOverrides, setMlsOverrides] = useState<Record<string, boolean>>({})
  const [list, setList] = useState<Property[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [tabTotals, setTabTotals] = useState<Partial<Record<PropertyCategory, number>>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const { currentUser } = useAuth()

  useEffect(() => {
    let cancelled = false

    async function loadInitial() {
      setIsLoading(true)
      setLoadError(null)
      setList([])
      setTotalCount(null)

      try {
        // Platform API scopes assets by the current cookie session and tenant;
        // no browser user id or public catalog fallback is allowed here.
        const result = await propertyAssetsApi.listAllAssetsWithListings()
        if (cancelled) return
        const mapped = result.items.map(({ asset, listings }) => mapPropertyAssetToUiProperty(asset, listings))
        const counts = mapped.reduce<Partial<Record<PropertyCategory, number>>>((acc, property) => {
          acc[property.category] = (acc[property.category] ?? 0) + 1
          return acc
        }, {})
        setTabTotals(counts)
        const categoryItems = mapped.filter((property) => property.category === marketTab)
        setList(categoryItems)
        setTotalCount(categoryItems.length)
      } catch (error) {
        console.error('[ObjectsListPage] Failed to fetch Platform property assets:', error)
        if (!cancelled) {
          setList([])
          setLoadError('Не удалось загрузить объекты. Попробуйте обновить страницу.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadInitial()
    return () => {
      cancelled = true
    }
  }, [marketTab])

  /** Право на публикацию в MLS — UX-проверка. Безопасность обеспечивает бэкенд. */
  const canPublishMls = currentUser ? canDo('publish_mls', currentUser.role) : false
  /** Верифицирован ли текущий пользователь в MLS-круге BAZA.sale (отдельно от роли). */
  const isMlsCircleMember = Boolean(currentUser?.mlsCircleVerified)

  const pool = list

  const allTypes = useMemo<PropertyType[]>(
    () => [...new Set(pool.map((property) => property.type))],
    [pool],
  )
  const allCities = useMemo(
    () => Array.from(new Set(pool.map((property) => property.city))).sort(),
    [pool],
  )

  const freshnessCounts = useMemo(() => {
    const activePool = pool.filter((property) => property.status !== 'archive')
    return {
      all: pool.length,
      up_to_date: activePool.filter(
        (property) => getConditionState(property.updatedAt, property.category) === 'up_to_date',
      ).length,
      needs_attention: activePool.filter(
        (property) => getConditionState(property.updatedAt, property.category) === 'needs_attention',
      ).length,
      needs_update: activePool.filter(
        (property) => getConditionState(property.updatedAt, property.category) === 'needs_update',
      ).length,
    }
  }, [pool])

  const filtered = useMemo(() => {
    const result = pool.filter((property) => {
      if (statusFilter !== 'all' && property.status !== statusFilter) return false
      if (typeFilter !== 'all' && property.type !== typeFilter) return false
      if (
        freshnessFilter !== 'all' &&
        getConditionState(property.updatedAt, property.category) !== freshnessFilter
      ) return false
      if (priceMin && property.price < Number(priceMin)) return false
      if (priceMax && property.price > Number(priceMax)) return false
      if (areaMin && property.area < Number(areaMin)) return false
      if (areaMax && property.area > Number(areaMax)) return false
      if (floorMin && property.floor < Number(floorMin)) return false
      if (floorMax && property.floor > Number(floorMax)) return false
      if (roomsFmt !== 'all' && roomsLabel(property.rooms) !== roomsFmt) return false
      if (cities.size > 0 && !cities.has(property.city)) return false
      if (mlsFilter !== 'all') {
        const inMls = Boolean(property.details?.isMls)
        if (mlsFilter === 'in' && !inMls) return false
        if (mlsFilter === 'out' && inMls) return false
      }
      if (favOnly && !favorites.has(property.id)) return false

      const query = search.trim().toLowerCase()
      if (
        query &&
        !property.title.toLowerCase().includes(query) &&
        !property.city.toLowerCase().includes(query) &&
        !property.street.toLowerCase().includes(query) &&
        !property.agentName.toLowerCase().includes(query)
      ) return false

      return true
    })

    return result.sort((left, right) => {
      const leftDate = new Date(left.listedAt).getTime()
      const rightDate = new Date(right.listedAt).getTime()
      return sortDesc ? rightDate - leftDate : leftDate - rightDate
    })
  }, [
    pool,
    statusFilter,
    typeFilter,
    freshnessFilter,
    priceMin,
    priceMax,
    areaMin,
    areaMax,
    floorMin,
    floorMax,
    roomsFmt,
    cities,
    mlsFilter,
    favOnly,
    favorites,
    search,
    sortDesc,
  ])

  const hasClientOnlyFilters =
    Boolean(search.trim()) ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    freshnessFilter !== 'all' ||
    mlsFilter !== 'all' ||
    favOnly ||
    Boolean(floorMin) ||
    Boolean(floorMax)

  const hasListFilters = hasClientOnlyFilters

  const displayTotal = hasClientOnlyFilters ? filtered.length : totalCount
  const displayLoaded = hasClientOnlyFilters ? filtered.length : list.length

  const activeFiltersCount =
    (priceMin ? 1 : 0) +
    (priceMax ? 1 : 0) +
    (areaMin ? 1 : 0) +
    (areaMax ? 1 : 0) +
    (floorMin ? 1 : 0) +
    (floorMax ? 1 : 0) +
    (roomsFmt !== 'all' ? 1 : 0) +
    cities.size +
    (mlsFilter !== 'all' ? 1 : 0) +
    (favOnly ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0)

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((property) => selectedIds.has(property.id))

  function resetFilters() {
    setPriceMin('')
    setPriceMax('')
    setAreaMin('')
    setAreaMax('')
    setFloorMin('')
    setFloorMax('')
    setRoomsFmt('all')
    setCities(new Set())
    setMlsFilter('all')
    setFavOnly(false)
    setStatusFilter('all')
  }

  function handleTabChange(tab: PropertyCategory) {
    setMarketTab(tab)
    setTypeFilter('all')
    setStatusFilter('all')
    setFreshnessFilter('all')
    setSearch('')
    setSelectedIds(new Set())
  }

  function handleDelete(id: string) {
    setList((current) => current.filter((property) => property.id !== id))
    setSelectedIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  function handleRefresh(id: string) {
    setConfirmRefreshId(id)
  }

  function confirmRefresh() {
    if (!confirmRefreshId) return
    const updatedAt = todayIsoDate()
    setList((current) =>
      current.map((property) =>
        property.id === confirmRefreshId ? { ...property, updatedAt } : property,
      ),
    )
    setConfirmRefreshId(null)
  }

  function handleUnpublish(id: string) {
    setList((current) =>
      current.map((property) =>
        property.id === id ? { ...property, status: 'draft' as const } : property,
      ),
    )
  }

  function handleEditSave(next: Property) {
    setList((current) => current.map((property) => (property.id === next.id ? next : property)))
    setEditWizardId(null)
    toast.success(`«${next.title}» обновлён`)
  }

  function handleAddObject() {
    const today = todayIsoDate()
    setCreateDraft({
      id: `obj-${Date.now()}`,
      title: '',
      type: 'Квартира',
      category: marketTab,
      country: 'Грузия',
      city: 'Батуми',
      street: '',
      floor: 0,
      totalFloors: 0,
      rooms: 1,
      area: 0,
      price: 0,
      pricePerM2: 0,
      listedAt: today,
      updatedAt: today,
      status: 'draft',
      agentId: currentUser?.id ?? '',
      agentName: currentUser?.name ?? '',
    })
  }

  function handleDuplicate(source: Property) {
    const today = todayIsoDate()
    setCreateDraft({
      ...source,
      id: `obj-${Date.now()}`,
      photo: undefined,
      listedAt: today,
      updatedAt: today,
      status: 'draft',
      details: source.details
        ? { ...source.details, description: '', mediaFileNames: [] }
        : undefined,
    })
  }

  function handleCreateSave(next: Property) {
    setList((current) => [next, ...current])
    setCreateDraft(null)
    setMarketTab(next.category)
    toast.success(`«${next.title}» добавлен`)
  }

  function addToSelection(selectionId: string, selectionTitle: string) {
    const target = list.find((property) => property.id === selectionTargetId) as PropertyWithAssetInfo | undefined
    setSelectionTargetId(null)
    const listingId = target?.primaryListing?._id
    if (!target) return
    if (!listingId) {
      toast.error(`У «${target.title}» нет активного объявления — сначала опубликуйте лот`)
      return
    }
    addItemsToSelection(selectionId, { listingIds: [listingId] })
    toast.success(`«${target.title}» добавлен в подборку «${selectionTitle}»`)
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        filtered.forEach((property) => next.delete(property.id))
      } else {
        filtered.forEach((property) => next.add(property.id))
      }
      return next
    })
  }

  function refreshSelected() {
    const updatedAt = todayIsoDate()
    setList((current) =>
      current.map((property) =>
        selectedIds.has(property.id) ? { ...property, updatedAt } : property,
      ),
    )
    setSelectedIds(new Set())
  }

  function archiveSelected() {
    setList((current) =>
      current.map((property) =>
        selectedIds.has(property.id) ? { ...property, status: 'archive' as const } : property,
      ),
    )
    setSelectedIds(new Set())
  }

  function deleteSelected() {
    setList((current) => current.filter((property) => !selectedIds.has(property.id)))
    setSelectedIds(new Set())
  }

  /** Статус MLS объекта с учётом локальных переопределений (демо). */
  function isInMls(property: Property) {
    return mlsOverrides[property.id] ?? Boolean(property.details?.isMls)
  }

  function openMlsDialog(property: Property) {
    if (!canPublishMls) return
    // Не верифицирован в MLS-круге BAZA.sale → заявка. Иначе добавить/убрать по текущему статусу.
    // Фронтовая проверка прав — UX. Сервер проверяет независимо (см. services/mlsApi.ts).
    const mode: MlsDialogMode = !isMlsCircleMember
      ? 'apply'
      : isInMls(property)
        ? 'remove'
        : 'publish'
    setMlsDialog({ id: property.id, mode })
  }

  function confirmMls(id: string, isMlsNow: boolean) {
    setMlsOverrides((prev) => ({ ...prev, [id]: isMlsNow }))
    setMlsDialog(null)
  }

  return (
    <DashboardShell hideSidebar>
      <main className="objects-list-page">
        <header className="objects-page-heading">
          <div>
            <h1>{t('objects.objectsListPage.объекты_вторичного_р')}</h1>
            <p>
              {displayTotal != null
                ? `${displayTotal.toLocaleString('ru-RU')} объектов${hasListFilters ? '' : ' в каталоге'} · показано ${displayLoaded.toLocaleString('ru-RU')}`
                : 'Загрузка каталога…'}
              {freshnessCounts.needs_update > 0 && (
                <> · {freshnessCounts.needs_update} {t('objects.objectsListPage.требуют_обновления')}</>
              )}
            </p>
          </div>
          <button type="button" className="objects-primary-button" onClick={handleAddObject}>
            <Plus aria-hidden />
            {t('objects.objectsListPage.добавить_объект')}</button>
        </header>

        {marketTab === 'secondary' && canPublishMls && (
          <div className={cn('objects-mls-promo', isMlsCircleMember && 'is-member')}>
            {isMlsCircleMember ? (
              <span className="objects-mls-member-badge" aria-label={t('objects.objectsListPage.вы_член_mls')} title={t('objects.objectsListPage.вы_член_mls')}>
                <Crown aria-hidden />
                {t('objects.objectsListPage.вы_член_mls')}</span>
            ) : (
              <>
                <span className="objects-mls-promo-icon" aria-hidden>
                  <Network />
                </span>
                <div className="objects-mls-promo-text">
                  <h2>{t('objects.objectsListPage.mls_круг_baza_sale')}</h2>
                  <p>
                    {t('objects.objectsListPage.сеть_верифицированны')}</p>
                </div>
                <button type="button" className="objects-primary-button" onClick={() => setMlsJoinOpen(true)}>
                  {t('objects.objectsListPage.вступить_в_mls')}</button>
              </>
            )}
          </div>
        )}

        <section className="objects-toolbar" aria-label={t('objects.objectsListPage.поиск_и_отображение')}>
          <div className="objects-market-tabs" aria-label={t('objects.objectsListPage.сегменты_рынка')}>
            {MARKET_TABS.map((tab) => {
              const count = tabTotals[tab.id]
              const active = marketTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn('objects-segment-button', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => handleTabChange(tab.id)}
                >
                  {tab.label}
                  <span>{count != null ? count.toLocaleString('ru-RU') : '…'}</span>
                </button>
              )
            })}
          </div>

          <div className="objects-toolbar-break" aria-hidden />

          <button
            type="button"
            className="objects-sort-button"
            onClick={() => setSortDesc((current) => !current)}
          >
            <ArrowUpDown aria-hidden />
            {sortDesc ? 'От новых к старым' : 'От старых к новым'}
          </button>

          <label className="objects-search">
            <Search aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('objects.objectsListPage.название_адрес_или_п')}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label={t('objects.objectsListPage.очистить_поиск')}>
                <X aria-hidden />
              </button>
            )}
          </label>

          <span className="objects-found-count">
            {t('objects.objectsListPage.найдено')}{(hasClientOnlyFilters ? filtered.length : displayTotal ?? filtered.length).toLocaleString('ru-RU')}
            {hasClientOnlyFilters && displayTotal != null && filtered.length !== list.length && (
              <> {t('objects.objectsListPage.из')}{list.length.toLocaleString('ru-RU')} {t('objects.objectsListPage.загруженных')}</>
            )}
          </span>

          <label className="objects-freshness-filter">
            <Clock3 aria-hidden />
            <select
              value={freshnessFilter}
              onChange={(event) => setFreshnessFilter(event.target.value as FreshnessFilter)}
              aria-label={t('objects.objectsListPage.фильтр_по_актуальнос')}
            >
              <option value="all">{t('objects.objectsListPage.все_по_актуальности')}{freshnessCounts.all}</option>
              <option value="up_to_date">{t('objects.objectsListPage.актуально')}{freshnessCounts.up_to_date}</option>
              <option value="needs_attention">
                {t('objects.objectsListPage.проверить_скоро')}{freshnessCounts.needs_attention}
              </option>
              <option value="needs_update">
                {t('objects.objectsListPage.нужно_обновить')}{freshnessCounts.needs_update}
              </option>
            </select>
          </label>

          <button
            type="button"
            className={cn(
              'objects-filter-button',
              (activeFiltersCount > 0 || showFilters) && 'is-active',
            )}
            onClick={() => setShowFilters((current) => !current)}
          >
            <SlidersHorizontal aria-hidden />
            {t('objects.objectsListPage.фильтры')}{activeFiltersCount > 0 && <span>{activeFiltersCount}</span>}
          </button>

          <div className="objects-view-switch" aria-label={t('objects.objectsListPage.режим_отображения')}>
            <button
              type="button"
              className={cn(viewMode === 'compact' && 'is-active')}
              aria-label={t('objects.objectsListPage.компактная_сетка')}
              aria-pressed={viewMode === 'compact'}
              onClick={() => {
                setViewMode('compact')
                setSelectedIds(new Set())
              }}
            >
              <LayoutGrid aria-hidden />
            </button>
            <button
              type="button"
              className={cn(viewMode === 'table' && 'is-active')}
              aria-label={t('objects.objectsListPage.таблица')}
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode('table')}
            >
              <AlignJustify aria-hidden />
            </button>
            <button
              type="button"
              className={cn(viewMode === 'cards' && 'is-active')}
              aria-label={t('objects.objectsListPage.большие_карточки')}
              aria-pressed={viewMode === 'cards'}
              onClick={() => {
                setViewMode('cards')
                setSelectedIds(new Set())
              }}
            >
              <Rows3 aria-hidden />
            </button>
          </div>
        </section>

        {showFilters && (
          <section className="objects-extended-filters" aria-label={t('objects.objectsListPage.расширенные_фильтры')}>
            <FilterField label={t('objects.objectsListPage.статус')}>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">{t('objects.objectsListPage.любой')}</option>
                <option value="for_sale">{t('objects.objectsListPage.в_продаже')}</option>
                <option value="booked">{t('objects.objectsListPage.забронировано')}</option>
                <option value="sold">{t('objects.objectsListPage.продано')}</option>
                <option value="draft">{t('objects.objectsListPage.черновик')}</option>
                <option value="archive">{t('objects.objectsListPage.архив')}</option>
              </select>
            </FilterField>

            <FilterField label={t('objects.objectsListPage.тип')}>
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              >
                <option value="all">{t('objects.objectsListPage.все_типы')}</option>
                {allTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </FilterField>

            <FilterField label={t('objects.objectsListPage.комнатность')}>
              <select
                value={roomsFmt}
                onChange={(event) => setRoomsFmt(event.target.value as RoomsFormat | 'all')}
              >
                <option value="all">{t('objects.objectsListPage.любая')}</option>
                {ROOMS_FORMATS.map((format) => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
            </FilterField>

            <FilterField label={t('objects.objectsListPage.город')}>
              <select
                value={cities.size === 1 ? Array.from(cities)[0] : 'all'}
                onChange={(event) => {
                  const value = event.target.value
                  setCities(value === 'all' ? new Set() : new Set([value]))
                }}
              >
                <option value="all">{t('objects.objectsListPage.любой')}</option>
                {allCities.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </FilterField>

            <FilterField label="MLS">
              <select
                value={mlsFilter}
                onChange={(event) => setMlsFilter(event.target.value as MlsFilter)}
              >
                <option value="all">{t('objects.objectsListPage.любой')}</option>
                <option value="in">{t('objects.objectsListPage.в_mls')}</option>
                <option value="out">{t('objects.objectsListPage.не_в_mls')}</option>
              </select>
            </FilterField>

            <RangeField
              label={t('objects.objectsListPage.цена')}
              minValue={priceMin}
              maxValue={priceMax}
              onMinChange={setPriceMin}
              onMaxChange={setPriceMax}
            />
            <RangeField
              label={t('objects.objectsListPage.площадь_м')}
              minValue={areaMin}
              maxValue={areaMax}
              onMinChange={setAreaMin}
              onMaxChange={setAreaMax}
            />
            <RangeField
              label={t('objects.objectsListPage.этаж')}
              minValue={floorMin}
              maxValue={floorMax}
              onMinChange={setFloorMin}
              onMaxChange={setFloorMax}
            />

            <FilterField label={t('objects.objectsListPage.избранное')}>
              <select
                value={favOnly ? 'only' : 'all'}
                onChange={(event) => setFavOnly(event.target.value === 'only')}
              >
                <option value="all">{t('objects.objectsListPage.все')}</option>
                <option value="only">{t('objects.objectsListPage.только_избранные')}</option>
              </select>
            </FilterField>

            {activeFiltersCount > 0 && (
              <button type="button" className="objects-reset-button" onClick={resetFilters}>
                {t('objects.objectsListPage.сбросить_фильтры')}</button>
            )}
          </section>
        )}

        {selectedIds.size > 0 && viewMode === 'table' && (
          <div className="objects-actionbar">
            <BulkActions
              selectedCount={selectedIds.size}
              onRefresh={refreshSelected}
              onArchive={archiveSelected}
              onDelete={deleteSelected}
              onClear={() => setSelectedIds(new Set())}
            />
          </div>
        )}

        {isLoading ? (
          <div className="objects-empty-state">
            <Building2 aria-hidden />
            <h2>{t('objects.objectsListPage.загрузка_объектов')}</h2>
            <p>{t('objects.objectsListPage.получаем_данные_из_b')}</p>
          </div>
        ) : loadError ? (
          <div className="objects-empty-state">
            <Building2 aria-hidden />
            <h2>{t('objects.objectsListPage.ошибка_загрузки')}</h2>
            <p>{loadError}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="objects-empty-state">
            <Building2 aria-hidden />
            <h2>{t('objects.objectsListPage.объекты_не_найдены')}</h2>
            <p>{t('objects.objectsListPage.измените_фильтры_или')}</p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="objects-cards-list">
            {filtered.map((property) => (
              <PropertyCardRow
                key={property.id}
                property={property}
                onNavigate={() => navigate(`/dashboard/objects/${property.id}`)}
                onDelete={() => handleDelete(property.id)}
                onRefresh={() => handleRefresh(property.id)}
                onPromote={() => setPromoteOpen(true)}
                onDuplicate={() => handleDuplicate(property)}
                onAddToSelection={() => setSelectionTargetId(property.id)}
                onUnpublish={() => handleUnpublish(property.id)}
                onEdit={() => setEditWizardId(property.id)}
                isMls={isInMls(property)}
                canPublishMls={canPublishMls}
                onAddToMls={() => openMlsDialog(property)}
                isFavorite={favorites.has(property.id)}
                onToggleFavorite={() => toggleFavorite(property.id)}
              />
            ))}
          </div>
        ) : viewMode === 'compact' ? (
          <div className="objects-compact-grid">
            {filtered.map((property) => (
              <PropertyCompactCard
                key={property.id}
                property={property}
                onNavigate={() => navigate(`/dashboard/objects/${property.id}`)}
                isMls={isInMls(property)}
                isFavorite={favorites.has(property.id)}
                onToggleFavorite={() => toggleFavorite(property.id)}
              />
            ))}
          </div>
        ) : (
          <PropertyTable
            properties={filtered}
            selectedIds={selectedIds}
            allSelected={allVisibleSelected}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAllVisible}
            onNavigate={(id) => navigate(`/dashboard/objects/${id}`)}
            onDelete={handleDelete}
            onRefresh={handleRefresh}
            onEdit={setEditWizardId}
          />
        )}

        {(() => {
          const editingProperty = editWizardId
            ? list.find((property) => property.id === editWizardId)
            : undefined
          const wizardProperty = editingProperty ?? createDraft
          if (!wizardProperty) return null
          return (
            <ObjectEditWizard
              key={`${createDraft ? 'create' : 'edit'}-${wizardProperty.id}`}
              property={wizardProperty}
              mode={createDraft ? 'create' : 'edit'}
              onClose={() => {
                setEditWizardId(null)
                setCreateDraft(null)
              }}
              onSave={createDraft ? handleCreateSave : handleEditSave}
            />
          )
        })()}

        {promoteOpen && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectsListPage.улучшить_объект')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setPromoteOpen(false)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectsListPage.улучшить_объект')}</h2>
              <p>{t('objects.objectsListPage.тут_будет_маркетинг')}</p>
              <div className="objects-confirm-actions">
                <button
                  type="button"
                  className="objects-confirm-back"
                  onClick={() => setPromoteOpen(false)}
                >
                  {t('objects.objectsListPage.назад')}</button>
              </div>
            </div>
          </div>
        )}

        {selectionTargetId && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectsListPage.добавить_объект_в_по')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectionTargetId(null)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectsListPage.в_подборку')}</h2>
              <div className="objects-selection-list">
                {secondarySelections.length === 0 && (
                  <p>Подборок вторички пока нет</p>
                )}
                {secondarySelections.map((selection) => (
                  <button
                    key={selection.id}
                    type="button"
                    onClick={() => addToSelection(selection.id, selection.title)}
                  >
                    {selection.title}
                    <span>{selection.clientName}</span>
                  </button>
                ))}
              </div>
              <div className="objects-confirm-actions">
                <button
                  type="button"
                  className="objects-confirm-back"
                  onClick={() => setSelectionTargetId(null)}
                >
                  {t('objects.objectsListPage.назад')}</button>
                <button
                  type="button"
                  className="objects-confirm-submit"
                  onClick={() => navigate('/dashboard/objects/selections/new')}
                >
                  <Plus aria-hidden />
                  {t('objects.objectsListPage.создать_новую')}</button>
              </div>
            </div>
          </div>
        )}

        {confirmRefreshId && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectsListPage.подтверждение_актуал')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setConfirmRefreshId(null)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectsListPage.подтвердить_актуальн')}</h2>
              <p>
                {t('objects.objectsListPage.я_подтверждаю_что_об')}{' '}«{list.find((property) => property.id === confirmRefreshId)?.title}»{' '}
                {t('objects.objectsListPage.актуален_и_вс_ещ_про')}</p>
              <div className="objects-confirm-actions">
                <button
                  type="button"
                  className="objects-confirm-back"
                  onClick={() => setConfirmRefreshId(null)}
                >
                  {t('objects.objectsListPage.назад')}</button>
                <button type="button" className="objects-confirm-submit" onClick={confirmRefresh}>
                  <RefreshCw aria-hidden />
                  {t('objects.objectsListPage.подтвердить')}</button>
              </div>
            </div>
          </div>
        )}

        {(() => {
          const target = mlsDialog ? list.find((property) => property.id === mlsDialog.id) : null
          return target && mlsDialog ? (
            <MlsConfirmDialog
              property={target}
              mode={mlsDialog.mode}
              onClose={() => setMlsDialog(null)}
              onConfirmed={confirmMls}
            />
          ) : null
        })()}

        {mlsJoinOpen && <MlsJoinDialog onClose={() => setMlsJoinOpen(false)} />}
      </main>
    </DashboardShell>
  )
}

function PropertyCardRow({
  property,
  onNavigate,
  onDelete,
  onRefresh,
  onPromote,
  onDuplicate,
  onAddToSelection,
  onUnpublish,
  onEdit,
  isMls,
  canPublishMls,
  onAddToMls,
  isFavorite,
  onToggleFavorite,
}: {
  property: Property
  onNavigate: () => void
  onDelete: () => void
  onRefresh: () => void
  onPromote: () => void
  onDuplicate: () => void
  onAddToSelection: () => void
  onUnpublish: () => void
  onEdit: () => void
  isMls: boolean
  canPublishMls: boolean
  onAddToMls: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
}) {
    const { t } = useI18n();
  const [period, setPeriod] = useState<StatPeriod>('all')
  const stats = getStats(property.id, period)
  const freshness = getConditionState(property.updatedAt, property.category)
  const freshnessMeta = FRESHNESS_META[freshness]
  const statusMeta = STATUS_META[property.status]
  const priceOnRequest = property.details?.priceOnRequest
  const priceLabel = priceOnRequest ? 'Цена по запросу' : FMT_USD.format(property.price)
  const pricePerM2Label = formatPropertyUnitPrice(property, FMT_M2, 'Прайс скрыт в витрине')
  const daysSinceUpdate = getDaysSince(property.updatedAt)
  const canEdit = ['for_sale', 'booked', 'sold', 'draft'].includes(property.status)
  const canDuplicate = property.status === 'for_sale'
  const canBookmark = property.status === 'for_sale'

  return (
    <article className="object-work-card">
      <section className="object-summary">
        <ObjectPhotoCarousel
          className="object-media"
          images={property.photos ?? (property.photo ? [property.photo] : [])}
          alt={property.title}
          onOpen={onNavigate}
          openLabel={`Открыть ${property.title}`}
          placeholder={
            <span className="object-media-placeholder">
              <Building2 aria-hidden />
              <span>{t('objects.objectsListPage.фото_не_загружено')}</span>
            </span>
          }
          overlay={
            <>
              <StatusLine label={statusMeta.label} tone={statusMeta.tone} />
              {isMls && (
                <span className="object-mls-badge">
                  <Check aria-hidden />
                  MLS
                </span>
              )}
              <button
                type="button"
                className={cn('object-fav-btn', isFavorite && 'is-active')}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                onClick={onToggleFavorite}
              >
                <Heart aria-hidden />
              </button>
              <span className="object-media-expand" aria-hidden>
                <Maximize2 />
              </span>
            </>
          }
        />

        <div className="object-summary-body">
          <div className="object-price-row">
            <strong>{priceLabel}</strong>
            <span>{pricePerM2Label}</span>
          </div>
          <button type="button" className="object-title-button" onClick={onNavigate}>
            {property.title}
          </button>
          <div className="object-location">
            <MapPin aria-hidden />
            <span className="object-location-lines">
              <span>{property.street}</span>
              <span>{property.city}, {property.country}</span>
            </span>
          </div>
          <div className="object-specs">
            {property.rooms > 0 && (
              <span><BedDouble aria-hidden />{property.rooms}+1</span>
            )}
            {(property.floor > 0 || property.totalFloors > 0) && (
              <span>
                <Building2 aria-hidden />
                {property.floor > 0
                  ? `${property.floor} из ${property.totalFloors}`
                  : `${property.totalFloors} этажей`}
              </span>
            )}
            {property.area > 0 && (
              <span><Maximize2 aria-hidden />{property.area} {t('objects.objectsListPage.м')}</span>
            )}
          </div>
        </div>
      </section>

      <section className="object-analytics">
        <div className="object-statistics">
          <div className="object-section-heading">
            <div className="object-periods" aria-label={t('objects.objectsListPage.период_статистики')}>
              {PERIODS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={cn(period === item.value && 'is-active')}
                  aria-pressed={period === item.value}
                  onClick={() => setPeriod(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="object-metrics">
            <Metric icon={<Eye aria-hidden />} label={t('objects.objectsListPage.просмотры_в_поиске')} value={stats.views} />
            <Metric
              icon={<MousePointerClick aria-hidden />}
              label={t('objects.objectsListPage.просмотры_объявления')}
              value={stats.clicks}
            />
            <Metric
              icon={<Heart aria-hidden />}
              label={t('objects.objectsListPage.добавили_в_избранное')}
              value={stats.favorites}
            />
            <Metric icon={<Share2 aria-hidden />} label={t('objects.objectsListPage.переслали_другим')} value={stats.shares} />
          </div>
        </div>

        <div className="object-information">
          <h2>{t('objects.objectsListPage.информация')}</h2>
          <div className="object-information-grid">
            <InfoItem label={t('objects.objectsListPage.тип')} value={property.type} />
            <InfoItem
              label={t('objects.objectsListPage.статус')}
              value={<StatusLine label={statusMeta.label} tone={statusMeta.tone} />}
            />
            <InfoItem label={t('objects.objectsListPage.дата_размещения')} value={formatDate(property.listedAt)} />
            <InfoItem
              label={t('objects.objectsListPage.дата_обновления')}
              value={`${formatDate(property.updatedAt)} · ${daysSinceUpdate} дн.`}
            />
            <InfoItem
              label={t('objects.objectsListPage.актуальность')}
              value={
                <span className={cn('freshness-inline', `tone-${freshnessMeta.tone}`)}>
                  <freshnessMeta.Icon aria-hidden />
                  {freshnessMeta.label}
                </span>
              }
            />
          </div>
        </div>
      </section>

      <section className="object-management">
        <h2>{t('objects.objectsListPage.управление')}</h2>
        <div className="object-management-primary">
          {property.status === 'for_sale' && (
            <button type="button" className="object-action-lg promote" onClick={onPromote}>
              <Star className="object-action-lg-icon" aria-hidden />
              <span className="object-action-lg-text">
                <span className="object-action-lg-title">{t('objects.objectsListPage.улучшить')}</span>
              </span>
              <ChevronRight className="object-action-lg-chevron" aria-hidden />
            </button>
          )}
          {property.status !== 'archive' && (
            <button
              type="button"
              className="object-action-lg refresh"
              disabled={CATALOG_EDIT_DELETE_DISABLED}
              onClick={onRefresh}
            >
              <RefreshCw className="object-action-lg-icon" aria-hidden />
              <span className="object-action-lg-text">
                <span className="object-action-lg-title">{t('objects.objectsListPage.подтвердить_актуальн')}</span>
              </span>
              <ChevronRight className="object-action-lg-chevron" aria-hidden />
            </button>
          )}
          {property.status === 'for_sale' && canPublishMls && (
            <button
              type="button"
              className={cn('object-action-lg mls', isMls && 'is-active')}
              onClick={onAddToMls}
            >
              <span className="object-action-mls-badge" aria-hidden>MLS</span>
              <span className="object-action-lg-text">
                <span className="object-action-lg-title">
                  {isMls ? 'Убрать из MLS' : 'Добавить в MLS'}
                </span>
              </span>
              <ChevronRight className="object-action-lg-chevron" aria-hidden />
            </button>
          )}
        </div>

        <div className="object-management-actions">
          <button
            type="button"
            className="object-action"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
          >
            <Share2 aria-hidden />
            {t('objects.objectsListPage.поделиться')}</button>
          <button type="button" className="object-action" onClick={() => window.print()}>
            <Printer aria-hidden />
            {t('objects.objectsListPage.печать')}</button>
          {canEdit && (
            <button
              type="button"
              className="object-action"
              disabled={CATALOG_EDIT_DELETE_DISABLED}
              onClick={onEdit}
            >
              <Pencil aria-hidden />
              {t('objects.objectsListPage.изменить')}</button>
          )}
          {canDuplicate && (
            <button type="button" className="object-action" onClick={onDuplicate}>
              <Copy aria-hidden />
              {t('objects.objectsListPage.дублировать')}</button>
          )}
          {property.status === 'for_sale' && (
            <button type="button" className="object-action" onClick={onUnpublish}>
              <XCircle aria-hidden />
              {t('objects.objectsListPage.снять_с_публикации')}</button>
          )}
          {canBookmark && (
            <button type="button" className="object-action" onClick={onAddToSelection}>
              <BookmarkPlus aria-hidden />
              {t('objects.objectsListPage.в_подборку')}</button>
          )}
          {property.status !== 'archive' && (
            <button type="button" className="object-action">
              <Archive aria-hidden />
              {t('objects.objectsListPage.в_архив')}</button>
          )}
          <button
            type="button"
            className="object-action danger"
            disabled={CATALOG_EDIT_DELETE_DISABLED}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
            {t('objects.objectsListPage.удалить')}</button>
        </div>

        <div className="object-agent-card">
          <span className="object-agent-avatar" aria-hidden>
            {property.agentName.split(' ').map((part) => part[0]).slice(0, 2).join('')}
          </span>
          <div className="object-agent-meta">
            <span>{t('objects.objectsListPage.ответственный')}</span>
            <span className="object-agent-name">{property.agentName}</span>
          </div>
          <div className="object-agent-contacts">
            <button type="button" aria-label={`Позвонить: ${property.agentName}`}>
              <Phone aria-hidden />
            </button>
            <button type="button" aria-label={`Написать: ${property.agentName}`}>
              <Mail aria-hidden />
            </button>
          </div>
        </div>
      </section>
    </article>
  )
}

function PropertyCompactCard({
  property,
  onNavigate,
  isMls,
  isFavorite,
  onToggleFavorite,
}: {
  property: Property
  onNavigate: () => void
  isMls: boolean
  isFavorite: boolean
  onToggleFavorite: () => void
}) {
    const { t } = useI18n();
  const statusMeta = STATUS_META[property.status]
  const freshness = getConditionState(property.updatedAt, property.category)
  const freshnessMeta = FRESHNESS_META[freshness]
  const priceOnRequest = property.details?.priceOnRequest
  const priceLabel = priceOnRequest ? 'Цена по запросу' : FMT_USD.format(property.price)
  const pricePerM2Label = formatPropertyUnitPrice(property, FMT_M2, 'Прайс скрыт')

  return (
    <article className="object-compact-card">
      <ObjectPhotoCarousel
        className="object-compact-media"
        images={property.photos ?? (property.photo ? [property.photo] : [])}
        alt={property.title}
        onOpen={onNavigate}
        openLabel={`Открыть ${property.title}`}
        placeholder={
          <span className="object-media-placeholder">
            <Building2 aria-hidden />
            <span>{t('objects.objectsListPage.нет_фото')}</span>
          </span>
        }
        overlay={
          <>
            <StatusLine label={statusMeta.label} tone={statusMeta.tone} />
            {isMls && (
              <span className="object-mls-badge">
                <Check aria-hidden />
                MLS
              </span>
            )}
            <button
              type="button"
              className={cn('object-fav-btn', isFavorite && 'is-active')}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
              onClick={onToggleFavorite}
            >
              <Heart aria-hidden />
            </button>
          </>
        }
      />

      <div className="object-compact-body">
        <div className="object-compact-price">
          <span className="object-compact-price-value">{priceLabel}</span>
          {!priceOnRequest && (
            <span className="object-compact-price-unit">{pricePerM2Label}</span>
          )}
        </div>

        <button type="button" className="object-compact-title" onClick={onNavigate}>
          {property.title}
        </button>

        <div className="object-compact-location">
          <MapPin aria-hidden />
          <span>{property.city}, {property.street}</span>
        </div>

        <div className="object-compact-specs">
          {property.rooms > 0 && (
            <span><BedDouble aria-hidden />{property.rooms}+1</span>
          )}
          {(property.floor > 0 || property.totalFloors > 0) && (
            <span>
              <Building2 aria-hidden />
              {property.floor > 0
                ? `${property.floor}/${property.totalFloors}`
                : property.totalFloors}
            </span>
          )}
          {property.area > 0 && (
            <span><Maximize2 aria-hidden />{property.area} {t('objects.objectsListPage.м')}</span>
          )}
        </div>

        <div className="object-compact-foot">
          <span className={cn('freshness-inline', `tone-${freshnessMeta.tone}`)}>
            <freshnessMeta.Icon aria-hidden />
            {freshnessMeta.label}
          </span>
        </div>
      </div>
    </article>
  )
}

function PropertyTable({
  properties,
  selectedIds,
  allSelected,
  onToggleSelected,
  onToggleAll,
  onNavigate,
  onDelete,
  onRefresh,
  onEdit,
}: {
  properties: Property[]
  selectedIds: Set<string>
  allSelected: boolean
  onToggleSelected: (id: string) => void
  onToggleAll: () => void
  onNavigate: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: (id: string) => void
  onEdit: (id: string) => void
}) {
    const { t } = useI18n();
  return (
    <div className="objects-table-shell">
      <table className="objects-table">
        <thead>
          <tr>
            <th className="objects-table-select">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={t('objects.objectsListPage.выбрать_все_видимые')}
              />
            </th>
            <th>{t('objects.objectsListPage.объект')}</th>
            <th>{t('objects.objectsListPage.параметры')}</th>
            <th>{t('objects.objectsListPage.цена')}</th>
            <th>{t('objects.objectsListPage.статус')}</th>
            <th>{t('objects.objectsListPage.актуальность')}</th>
            <th>{t('objects.objectsListPage.действия')}</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((property) => {
            const freshness = getConditionState(property.updatedAt, property.category)
            const freshnessMeta = FRESHNESS_META[freshness]
            const statusMeta = STATUS_META[property.status]
            const priceOnRequest = property.details?.priceOnRequest

            return (
              <tr key={property.id} className={cn(selectedIds.has(property.id) && 'is-selected')}>
                <td className="objects-table-select">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(property.id)}
                    onChange={() => onToggleSelected(property.id)}
                    aria-label={`Выбрать ${property.title}`}
                  />
                </td>
                <td className="objects-table-object-cell">
                  <button
                    type="button"
                    className="objects-table-photo"
                    onClick={() => onNavigate(property.id)}
                    aria-label={`Открыть ${property.title}`}
                  >
                    {property.photo ? (
                      <img src={property.photo} alt="" />
                    ) : (
                      <Building2 aria-hidden />
                    )}
                  </button>
                  <div>
                    <button
                      type="button"
                      className="objects-table-title"
                      onClick={() => onNavigate(property.id)}
                    >
                      {property.title}
                    </button>
                    <span className="objects-table-secondary">
                      {property.type} · {property.city}, {property.street}
                    </span>
                    <span className="objects-table-secondary">
                      {t('objects.objectsListPage.размещено')}{formatDate(property.listedAt)} · {property.agentName}
                    </span>
                  </div>
                </td>
                <td>
                  <span>{property.rooms > 0 ? `${property.rooms}+1` : 'Без комнат'}</span>
                  <span className="objects-table-secondary">
                    {property.area} {t('objects.objectsListPage.м')}{property.floor || '—'}/{property.totalFloors || '—'} {t('objects.objectsListPage.эт')}</span>
                </td>
                <td>
                  <strong>
                    {priceOnRequest ? 'По запросу' : FMT_USD.format(property.price)}
                  </strong>
                  <span className="objects-table-secondary">
                    {formatPropertyUnitPrice(property, FMT_M2, 'Прайс скрыт')}
                  </span>
                </td>
                <td>
                  <StatusLine label={statusMeta.label} tone={statusMeta.tone} />
                </td>
                <td>
                  <span className={cn('freshness-inline', `tone-${freshnessMeta.tone}`)}>
                    <freshnessMeta.Icon aria-hidden />
                    {freshnessMeta.label}
                  </span>
                  <span className="objects-table-secondary">
                    {formatDate(property.updatedAt)}
                  </span>
                </td>
                <td>
                  <div className="objects-table-actions">
                    {property.status !== 'archive' && (
                      <button
                        type="button"
                        disabled={CATALOG_EDIT_DELETE_DISABLED}
                        onClick={() => onRefresh(property.id)}
                        aria-label={`Подтвердить актуальность ${property.title}`}
                        title={t('objects.objectsListPage.подтвердить_актуальн')}
                      >
                        <RefreshCw aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={CATALOG_EDIT_DELETE_DISABLED}
                      onClick={() => onEdit(property.id)}
                      aria-label={`Изменить ${property.title}`}
                      title={t('objects.objectsListPage.изменить')}
                    >
                      <Pencil aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={CATALOG_EDIT_DELETE_DISABLED}
                      onClick={() => onDelete(property.id)}
                      aria-label={`Удалить ${property.title}`}
                      title={t('objects.objectsListPage.удалить')}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BulkActions({
  selectedCount,
  onRefresh,
  onArchive,
  onDelete,
  onClear,
}: {
  selectedCount: number
  onRefresh: () => void
  onArchive: () => void
  onDelete: () => void
  onClear: () => void
}) {
    const { t } = useI18n();
  return (
    <section className="objects-bulk-actions" aria-label={t('objects.objectsListPage.массовые_действия')}>
      <div className="objects-bulk-count">
        <button type="button" className="objects-bulk-clear" onClick={onClear} aria-label={t('objects.objectsListPage.снять_выделение')}>
          <X aria-hidden />
        </button>
        <span className="objects-bulk-count-value">{t('objects.objectsListPage.выбрано')}{selectedCount}</span>
      </div>
      <div>
        <button type="button" disabled={CATALOG_EDIT_DELETE_DISABLED} onClick={onRefresh}>
          <RefreshCw aria-hidden />
          {t('objects.objectsListPage.подтвердить_актуальн')}</button>
        <button type="button" onClick={onArchive}>
          <Archive aria-hidden />
          {t('objects.objectsListPage.в_архив')}</button>
        <button
          type="button"
          className="danger"
          disabled={CATALOG_EDIT_DELETE_DISABLED}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
          {t('objects.objectsListPage.удалить')}</button>
      </div>
    </section>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="object-metric">
      <strong>{value.toLocaleString('ru-RU')}</strong>
      <span className="object-metric-foot">
        <span className="object-metric-icon">{icon}</span>
        <span className="object-metric-label">{label}</span>
      </span>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="object-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StatusLine({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={cn('object-status-line', `tone-${tone}`)}>
      <span aria-hidden />
      {label}
    </span>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="objects-filter-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function RangeField({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
}: {
  label: string
  minValue: string
  maxValue: string
  onMinChange: (value: string) => void
  onMaxChange: (value: string) => void
}) {
    const { t } = useI18n();
  return (
    <fieldset className="objects-range-field">
      <legend>{label}</legend>
      <input
        type="number"
        placeholder={t('objects.objectsListPage.от')}
        value={minValue}
        onChange={(event) => onMinChange(event.target.value)}
      />
      <span>—</span>
      <input
        type="number"
        placeholder={t('objects.objectsListPage.до')}
        value={maxValue}
        onChange={(event) => onMaxChange(event.target.value)}
      />
    </fieldset>
  )
}
