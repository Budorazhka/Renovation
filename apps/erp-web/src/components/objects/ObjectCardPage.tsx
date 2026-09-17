import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  BookmarkPlus,
  Building2,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Heart,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Share2,
  ShieldAlert,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useAuth } from '@/context/AuthContext'
import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { isSecondarySelection } from '@/types/dev-selection'
import { mapEstateApartmentToProperty } from '@/lib/map-estate-apartment'
import { formatPropertyUnitPrice } from '@/lib/property-unit-price'
import { secondaryObjectsApi } from '@/services/secondaryObjectsApi'
import {
  propertyAssetsApi,
  type PropertyAsset,
  type Listing,
  type DuplicateCandidateResult,
} from '@/services/propertyAssetsApi'
import { mapPropertyAssetToUiProperty, type PropertyWithAssetInfo } from '@/lib/map-property-asset'
import { ObjectPhotoCarousel } from './ObjectPhotoCarousel'
import { ObjectEditWizard } from './ObjectEditWizard'
import { MlsConfirmDialog, type MlsDialogMode } from './MlsConfirmDialog'
import { toggleFavorite, useFavorites } from './favorites-store'
import type { Property, SaleStatus } from '@/components/management/my-properties/types'
import { FMT_USD } from '@/lib/format-currency'
import { canDo } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import './objects-list.css'
import './objects-card.css'
import { useI18n } from "@/i18n";

const FMT_M2 = new Intl.NumberFormat('ru', { maximumFractionDigits: 0 })

const STATUS_META: Record<SaleStatus, { label: string; tone: 'positive' | 'warning' | 'neutral' }> = {
  for_sale: { label: 'В продаже', tone: 'positive' },
  booked: { label: 'Забронирован', tone: 'warning' },
  sold: { label: 'Продан', tone: 'neutral' },
  moderation: { label: 'На модерации', tone: 'warning' },
  draft: { label: 'Черновик', tone: 'neutral' },
  archive: { label: 'Архив', tone: 'neutral' },
}

type Tab = 'overview' | 'history' | 'docs'

function todayIsoDate() {
  const now = new Date()
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return localNow.toISOString().slice(0, 10)
}

export function ObjectCardPage() {
  const { t } = useI18n();
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const { currentUser } = useAuth()

  const [property, setProperty] = useState<PropertyWithAssetInfo | Property | undefined>()
  const allSelections = useDevSelectionsStore((s) => s.selections)
  const fetchSelections = useDevSelectionsStore((s) => s.fetchAll)
  const addItemsToSelection = useDevSelectionsStore((s) => s.addItems)
  const secondarySelections = useMemo(() => allSelections.filter(isSecondarySelection), [allSelections])
  useEffect(() => {
    void fetchSelections()
  }, [fetchSelections])
  const [rawAsset, setRawAsset] = useState<PropertyAsset | null>(null)
  const [rawListings, setRawListings] = useState<Listing[]>([])
  const [publicationStatus, setPublicationStatus] = useState<string | null>(null)
  const [publicationSlug, setPublicationSlug] = useState<string | null>(null)
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidateResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  /** Ошибка Platform API, при которой подставлять legacy-данные нельзя (см. loadProperty). */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isMls, setIsMls] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [mlsMode, setMlsMode] = useState<MlsDialogMode | null>(null)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectionOpen, setSelectionOpen] = useState(false)

  // Publication & dedupe state
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishStatusMessage, setPublishStatusMessage] = useState<string | null>(null)
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<DuplicateCandidateResult | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [isOverriding, setIsOverriding] = useState(false)

  // Unpublish modal
  const [unpublishModalOpen, setUnpublishModalOpen] = useState(false)
  const [unpublishReason, setUnpublishReason] = useState('Снято по просьбе клиента')
  const [isUnpublishing, setIsUnpublishing] = useState(false)

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null)

  const clearPolling = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
      pollingTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => clearPolling()
  }, [])

  const loadProperty = useCallback(async () => {
    if (!propertyId) {
      setProperty(undefined)
      setIsLoading(false)
      return
    }

    const id = propertyId
    setIsLoading(true)
    setLoadError(null)

    try {
      // 1. Try real property assets API first
      try {
        const asset = await propertyAssetsApi.getAsset(id)
        const listings = await propertyAssetsApi.listListings(id)
        setRawAsset(asset)
        setRawListings(listings)

        if (listings.length > 0) {
          try {
            const pub = await propertyAssetsApi.getPublicationStatus(asset._id, listings[0]._id)
            setPublicationStatus(pub.status)
            setPublicationSlug(pub.slug ?? null)
          } catch {
            setPublicationStatus(null)
            setPublicationSlug(null)
          }
        }

        try {
          const dupes = await propertyAssetsApi.getDuplicateCandidates(id)
          setDuplicateCandidates(dupes)
        } catch {
          setDuplicateCandidates([])
        }

        const mapped = mapPropertyAssetToUiProperty(asset, listings)
        setProperty(mapped)
        setIsMls(Boolean(mapped.details?.isMls))
        setIsLoading(false)
        return
      } catch (assetErr) {
        // Сюда проваливалась ЛЮБАЯ ошибка Platform API, и карточка молча
        // подставляла legacy-данные, а getEstateApartment начинается с
        // DEMO_APARTMENTS. То есть при протухшей сессии (401), нехватке прав
        // (403) или сбое сервера пользователь видел демо-объект, неотличимый
        // от настоящего. Для ERP это худший вид отказа: не ошибка, а тихая
        // подмена данных.
        //
        // Проваливаться в legacy допустимо ТОЛЬКО когда Platform однозначно
        // ответил «такого актива нет» (404): на время миграции часть объектов
        // ещё живёт в старом каталоге. Всё остальное — честная ошибка.
        const status = (assetErr as { response?: { status?: number } })?.response?.status
        if (status !== 404) {
          console.error('[ObjectCardPage] Platform API failed, no legacy fallback:', assetErr)
          setProperty(undefined)
          setLoadError(t('objects.objectCardPage.не_удалось_загрузить_объект'))
          return
        }
      }

      const apartment = await secondaryObjectsApi.getEstateApartment(id)
      if (!apartment) {
        setProperty(undefined)
        return
      }
      const mapped = mapEstateApartmentToProperty(apartment)
      setProperty(mapped)
      setIsMls(Boolean(mapped.details?.isMls))
    } catch (error) {
      console.error('[ObjectCardPage] Failed to fetch object:', error)
      setProperty(undefined)
    } finally {
      setIsLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    void loadProperty()
  }, [loadProperty])

  const activeListing = rawListings[0] ?? null
  const isMarketplacePublished = publicationStatus === 'published'
  const isDraftListing = activeListing?.status === 'draft'
  const isActiveListing = activeListing?.status === 'active'

  /** Право на публикацию в MLS — UX-проверка. Безопасность обеспечивает бэкенд. */
  const canPublishMls = currentUser ? canDo('publish_mls', currentUser.role) : false
  const isMlsCircleMember = Boolean(currentUser?.mlsCircleVerified)
  const favorites = useFavorites()

  // ─── Publication Workflow Handlers ──────────────────────────────────────────

  async function handleActivateListing() {
    if (!rawAsset || !activeListing) return
    try {
      await propertyAssetsApi.activateListing(rawAsset._id, activeListing._id)
      toast.success('Листинг переведён в статус «Активен»')
      await loadProperty()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Ошибка активации листинга')
    }
  }

  async function pollPublicationStatus(assetId: string, listingId: string) {
    clearPolling()
    let attempts = 0
    pollingTimerRef.current = setInterval(async () => {
      attempts++
      try {
        const pubStatus = await propertyAssetsApi.getPublicationStatus(assetId, listingId)
        setPublicationStatus(pubStatus.status)
        if (pubStatus.slug) setPublicationSlug(pubStatus.slug)

        if (pubStatus.status === 'published') {
          clearPolling()
          setIsPublishing(false)
          setPublishStatusMessage(null)
          toast.success('Объект успешно опубликован на публичном маркетплейсе!')
          await loadProperty()
        } else if (pubStatus.status === 'build_failed') {
          clearPolling()
          setIsPublishing(false)
          setPublishStatusMessage(null)
          toast.error('Ошибка сборки карточки на маркетплейсе')
        } else {
          setPublishStatusMessage('Генерация публичной карточки в CDN маркетплейса…')
        }
      } catch (err) {
        if (attempts >= 15) {
          clearPolling()
          setIsPublishing(false)
          setPublishStatusMessage(null)
          toast.info('Публикация обрабатывается в фоновом режиме')
          await loadProperty()
        }
      }
    }, 1500)
  }

  async function handlePublishToMarketplace() {
    if (!rawAsset || !activeListing) return

    setIsPublishing(true)
    setPublishStatusMessage('Проверка дублей и регистрация публикации…')

    try {
      await propertyAssetsApi.publishListing(rawAsset._id, activeListing._id)
      setPublishStatusMessage('Публикация принята, ожидаем генерацию маркетплейса…')
      await pollPublicationStatus(rawAsset._id, activeListing._id)
    } catch (err: any) {
      setIsPublishing(false)
      setPublishStatusMessage(null)
      const status = err?.response?.status
      if (status === 409) {
        // Duplicate detected!
        try {
          const dupes = await propertyAssetsApi.getDuplicateCandidates(rawAsset._id)
          setDuplicateCandidates(dupes)
          if (dupes.length > 0) {
            setSelectedCandidate(dupes[0])
            setDuplicateModalOpen(true)
          } else {
            toast.error('Обнаружен конфликт дублирования при публикации')
          }
        } catch {
          toast.error('Обнаружен конфликт дублирования при публикации')
        }
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Ошибка отправки публикации')
      }
    }
  }

  async function handleOverrideDuplicate() {
    if (!selectedCandidate) return
    if (!overrideReason.trim() || overrideReason.trim().length < 10) {
      toast.error('Укажите подробную причину (минимум 10 символов)')
      return
    }

    setIsOverriding(true)
    const candidateId = selectedCandidate.id || selectedCandidate._id || ''
    try {
      await propertyAssetsApi.overrideDuplicate(candidateId, {
        reason: overrideReason.trim(),
      })
      toast.success('Право собственности подтверждено (Owner Override). Повторяем публикацию…')
      setDuplicateModalOpen(false)
      setOverrideReason('')
      await handlePublishToMarketplace()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Ошибка снятия флага дубля')
    } finally {
      setIsOverriding(false)
    }
  }

  async function handleUnpublish() {
    if (!rawAsset || !activeListing) {
      doUnpublish()
      return
    }
    if (!unpublishReason.trim() || unpublishReason.trim().length < 10) {
      toast.error('Укажите причину снятия с публикации (минимум 10 символов)')
      return
    }

    setIsUnpublishing(true)
    try {
      await propertyAssetsApi.unpublishListing(rawAsset._id, activeListing._id, {
        reason: unpublishReason.trim(),
      })
      toast.success('Объект успешно снят с публикации')
      setUnpublishModalOpen(false)
      setPublicationStatus('unpublished')
      await loadProperty()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Ошибка снятия с публикации')
    } finally {
      setIsUnpublishing(false)
    }
  }

  async function doRefresh() {
    if (rawAsset && activeListing) {
      try {
        await propertyAssetsApi.confirmActuality(rawAsset._id, activeListing._id, {
          expectedVersion: activeListing.version,
        })
        toast.success('Актуальность объекта подтверждена')
        setConfirmRefresh(false)
        await loadProperty()
        return
      } catch (err: any) {
        toast.error(err?.response?.data?.message || err?.message || 'Ошибка подтверждения актуальности')
        setConfirmRefresh(false)
        return
      }
    }
    setProperty((p) => (p ? { ...p, updatedAt: todayIsoDate() } : p))
    setConfirmRefresh(false)
    toast.success('Актуальность подтверждена')
  }

  function openMls() {
    if (!canPublishMls) return
    const mode: MlsDialogMode = !isMlsCircleMember ? 'apply' : isMls ? 'remove' : 'publish'
    setMlsMode(mode)
  }

  function doUnpublish() {
    setProperty((p) => (p ? { ...p, status: 'draft' } : p))
    toast.success('Объект снят с публикации')
  }

  function doArchive() {
    setProperty((p) => (p ? { ...p, status: 'archive' } : p))
    toast.success('Объект перенесён в архив')
  }

  function doDelete() {
    setConfirmDelete(false)
    toast.success(`«${property?.title}» удалён`)
    navigate('/dashboard/objects')
  }

  function doDuplicate() {
    toast.success('Создан черновик-копия объекта')
  }

  function doShare() {
    navigator.clipboard?.writeText(window.location.href)
    toast.success('Ссылка на объект скопирована')
  }

  function handleEditSave(next: Property) {
    setProperty(next)
    setEditOpen(false)
    toast.success(`«${next.title}» обновлён`)
    void loadProperty()
  }

  function addToSelection(selectionId: string, selectionTitle: string) {
    setSelectionOpen(false)
    const listingId = (property as PropertyWithAssetInfo | undefined)?.primaryListing?._id
    if (!listingId) {
      toast.error(`У «${property?.title}» нет активного объявления — сначала опубликуйте лот`)
      return
    }
    addItemsToSelection(selectionId, { listingIds: [listingId] })
    toast.success(`«${property?.title}» добавлен в подборку «${selectionTitle}»`)
  }

  if (isLoading) {
    return (
      <DashboardShell hideSidebar>
        <div className="oc-page">
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--objects-muted)' }}>
            {t('objects.objectCardPage.загрузка_объекта')}</div>
        </div>
      </DashboardShell>
    )
  }

  // Ошибка отделена от «не найден» намеренно: «объект не найден» — это ответ
  // системы о состоянии данных, а сбой доступа или сети данными не является.
  if (loadError) {
    return (
      <DashboardShell hideSidebar>
        <div className="oc-page">
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--objects-muted)' }}>
            {loadError}</div>
        </div>
      </DashboardShell>
    )
  }

  if (!property) {
    return (
      <DashboardShell hideSidebar>
        <div className="oc-page">
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--objects-muted)' }}>
            {t('objects.objectCardPage.объект_не_найден')}</div>
        </div>
      </DashboardShell>
    )
  }

  const d = property.details
  const status = STATUS_META[property.status]
  const isFav = favorites.has(property.id)
  const canEdit = ['for_sale', 'booked', 'sold', 'draft'].includes(property.status)
  const canDuplicate = property.status === 'for_sale'
  const canBookmark = property.status === 'for_sale'

  const effectiveSlug = publicationSlug || activeListing?.slug

  return (
    <DashboardShell hideSidebar>
      <div className="oc-page">
        {/* Marketplace banner / duplicate warnings */}
        {isMarketplacePublished && effectiveSlug && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-[#53c993] bg-[rgba(83,201,147,0.12)] p-4 text-[#e2fbe8]">
            <div className="flex items-center gap-3">
              <Globe className="size-5 text-[#53c993]" />
              <div>
                <div className="text-[16px] font-medium text-[#53c993]">Опубликовано на витрине маркетплейса</div>
                <div className="text-[14px] text-[rgba(242,207,141,0.85)]">
                  Слаг: <code className="rounded bg-[rgba(0,0,0,0.3)] px-1.5 py-0.5 text-[#fcecc8]">{effectiveSlug}</code>
                </div>
              </div>
            </div>
            <a
              href={`http://localhost:5173/listings/${effectiveSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-[#53c993] px-3.5 py-2 text-[14px] font-medium text-[#061e14] transition-colors hover:bg-[#6be0aa]"
            >
              <ExternalLink size={15} />
              Открыть карточку
            </a>
          </div>
        )}

        {isPublishing && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#e6c364] bg-[rgba(230,195,100,0.12)] p-4 text-[#fcecc8]">
            <Loader2 className="size-5 animate-spin text-[#e6c364]" />
            <span className="text-[15px]">{publishStatusMessage || 'Публикация...'}</span>
          </div>
        )}

        {duplicateCandidates.some((c) => c.status === 'detected' || c.status === 'confirmed_duplicate') && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-[#f08d89] bg-[rgba(240,141,137,0.12)] p-4 text-[#fcecc8]">
            <div className="flex items-center gap-3">
              <ShieldAlert className="size-5 text-[#f08d89]" />
              <div>
                <div className="text-[16px] font-medium text-[#f08d89]">Обнаружен потенциальный дубль объекта</div>
                <div className="text-[14px] text-[rgba(242,207,141,0.85)]">
                  Совпадение по контактам или адресу с существующим объектом в системе.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedCandidate(duplicateCandidates[0])
                setDuplicateModalOpen(true)
              }}
              className="inline-flex items-center gap-2 rounded-md border border-[#f08d89] bg-[rgba(240,141,137,0.2)] px-3.5 py-2 text-[14px] font-medium text-[#fcecc8] transition-colors hover:bg-[rgba(240,141,137,0.3)]"
            >
              Подтвердить право собственности
            </button>
          </div>
        )}

        {/* Hero */}
        <div className="oc-hero">
          <ObjectPhotoCarousel
            className="oc-photo"
            images={property.photos ?? (property.photo ? [property.photo] : [])}
            alt={property.title}
            placeholder={<Building2 aria-hidden />}
            overlay={
              isMls && (
                <span className="object-mls-badge">
                  <Check aria-hidden />
                  MLS
                </span>
              )
            }
          />

          <div className="oc-main">
            <div className="flex items-center gap-2">
              <span className={`oc-status tone-${status.tone}`}>{status.label}</span>
              {publicationStatus && (
                <span className="rounded bg-[rgba(201,168,76,0.15)] px-2 py-0.5 text-xs text-[#fcecc8]">
                  Витрина: {publicationStatus}
                </span>
              )}
            </div>

            <h1 className="oc-title">{property.title}</h1>

            <div className="oc-location">
              <MapPin aria-hidden />
              {property.city}, {property.street}
            </div>

            <div className="oc-price">{FMT_USD.format(property.price)}</div>
            <div className="oc-price-sub">
              {property.details?.priceOnRequest
                ? 'Прайс скрыт'
                : formatPropertyUnitPrice(property, FMT_M2)}
            </div>

            <div className="oc-chips">
              {[
                property.rooms > 0 && `${property.rooms} комн.`,
                `${property.area} м²`,
                property.floor > 0 && `${property.floor} / ${property.totalFloors} эт.`,
                property.type,
                property.country,
              ]
                .filter(Boolean)
                .map((s, i) => (
                  <span key={i} className="oc-chip">{s}</span>
                ))}
            </div>
          </div>
        </div>

        {/* Управление */}
        <section className="oc-manage" aria-label={t('objects.objectCardPage.управление_объектом')}>
          <h2 className="oc-panel-title">{t('objects.objectCardPage.управление')}</h2>

          <div className="oc-manage-primary">
            {/* Primary promote / activate or publish buttons */}
            {property.status === 'for_sale' && (
              <button type="button" className="object-action-lg promote" onClick={() => setPromoteOpen(true)}>
                <Star className="object-action-lg-icon" aria-hidden />
                <span className="object-action-lg-text">
                  <span className="object-action-lg-title">{t('objects.objectCardPage.улучшить')}</span>
                </span>
                <ChevronRight className="object-action-lg-chevron" aria-hidden />
              </button>
            )}

            {isDraftListing && (
              <button
                type="button"
                className="object-action-lg promote"
                onClick={handleActivateListing}
              >
                <Check className="object-action-lg-icon" aria-hidden />
                <span className="object-action-lg-text">
                  <span className="object-action-lg-title">Активировать листинг</span>
                </span>
                <ChevronRight className="object-action-lg-chevron" aria-hidden />
              </button>
            )}

            {isActiveListing && !isMarketplacePublished && (
              <button
                type="button"
                disabled={isPublishing}
                className="object-action-lg promote"
                onClick={handlePublishToMarketplace}
              >
                <Globe className="object-action-lg-icon" aria-hidden />
                <span className="object-action-lg-text">
                  <span className="object-action-lg-title">
                    {isPublishing ? 'Публикуется…' : 'Опубликовать на маркетплейсе'}
                  </span>
                </span>
                <ChevronRight className="object-action-lg-chevron" aria-hidden />
              </button>
            )}

            {property.status !== 'archive' && (
              <button type="button" className="object-action-lg refresh" onClick={() => setConfirmRefresh(true)}>
                <RefreshCw className="object-action-lg-icon" aria-hidden />
                <span className="object-action-lg-text">
                  <span className="object-action-lg-title">{t('objects.objectCardPage.подтвердить_актуальн')}</span>
                </span>
                <ChevronRight className="object-action-lg-chevron" aria-hidden />
              </button>
            )}
            {property.status === 'for_sale' && canPublishMls && (
              <button
                type="button"
                className={cn('object-action-lg mls', isMls && 'is-active')}
                onClick={openMls}
              >
                <span className="object-action-mls-badge" aria-hidden>MLS</span>
                <span className="object-action-lg-text">
                  <span className="object-action-lg-title">{isMls ? 'Убрать из MLS' : 'Добавить в MLS'}</span>
                </span>
                <ChevronRight className="object-action-lg-chevron" aria-hidden />
              </button>
            )}
          </div>

          <div className="oc-manage-actions">
            <button
              type="button"
              className={cn('object-action', isFav && 'is-fav')}
              aria-pressed={isFav}
              onClick={() => toggleFavorite(property.id)}
            >
              <Heart aria-hidden />
              {isFav ? 'В избранном' : 'В избранное'}
            </button>
            <button type="button" className="object-action" onClick={doShare}>
              <Share2 aria-hidden />
              {t('objects.objectCardPage.поделиться')}</button>
            <button type="button" className="object-action" onClick={() => window.print()}>
              <Printer aria-hidden />
              {t('objects.objectCardPage.печать')}</button>
            {canEdit && (
              <button type="button" className="object-action" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden />
                {t('objects.objectCardPage.изменить')}</button>
            )}
            {canDuplicate && (
              <button type="button" className="object-action" onClick={doDuplicate}>
                <Copy aria-hidden />
                {t('objects.objectCardPage.дублировать')}</button>
            )}
            {(isMarketplacePublished || property.status === 'for_sale') && (
              <button
                type="button"
                className="object-action"
                onClick={() => setUnpublishModalOpen(true)}
              >
                <XCircle aria-hidden />
                {t('objects.objectCardPage.снять_с_публикации')}</button>
            )}
            {canBookmark && (
              <button type="button" className="object-action" onClick={() => setSelectionOpen(true)}>
                <BookmarkPlus aria-hidden />
                {t('objects.objectCardPage.в_подборку')}</button>
            )}
            {property.status !== 'archive' && (
              <button type="button" className="object-action" onClick={doArchive}>
                <Archive aria-hidden />
                {t('objects.objectCardPage.в_архив')}</button>
            )}
            <button type="button" className="object-action danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden />
              {t('objects.objectCardPage.удалить')}</button>
          </div>
        </section>

        {/* Tabs */}
        <div className="oc-tabs" role="tablist">
          {([['overview', 'Обзор'], ['history', 'История цены'], ['docs', 'Документы']] as [Tab, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`oc-tab${tab === id ? ' is-active' : ''}`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="oc-grid">
            <div className="oc-panel">
              <h2 className="oc-panel-title">{t('objects.objectCardPage.характеристики')}</h2>
              {[
                { label: 'Тип недвижимости', value: property.type },
                { label: 'Площадь', value: `${property.area} м²` },
                { label: 'Комнат', value: property.rooms > 0 ? property.rooms : '—' },
                {
                  label: 'Этаж / Всего',
                  value: property.floor > 0 ? `${property.floor} / ${property.totalFloors}` : '—',
                },
                { label: 'Адрес', value: `${property.city}, ${property.street}` },
                { label: 'Страна', value: property.country },
                d?.renovation && { label: 'Ремонт', value: d.renovation },
                d?.ceilingHeight && { label: 'Потолки', value: `${d.ceilingHeight} м` },
                d?.bathroomType && { label: 'Санузел', value: d.bathroomType },
                { label: 'Ипотека', value: d?.mortgageAvailable ? 'Да' : 'Нет' },
                { label: 'Рассрочка', value: d?.installmentAvailable ? 'Да' : 'Нет' },
              ]
                .filter(Boolean)
                .map((row, i) => {
                  const r = row as { label: string; value: string | number }
                  return (
                    <div key={i} className="oc-row">
                      <span className="oc-row-label">{r.label}</span>
                      <span className="oc-row-value">{r.value}</span>
                    </div>
                  )
                })}
            </div>

            <div className="oc-col">
              <div className="oc-panel">
                <h2 className="oc-panel-title">{t('objects.objectCardPage.ответственный')}</h2>
                <div className="oc-agent">
                  <span className="oc-agent-avatar" aria-hidden>{property.agentName[0]}</span>
                  <div>
                    <div className="oc-agent-name">{property.agentName}</div>
                    <div className="oc-agent-role">{t('objects.objectCardPage.агент')}</div>
                  </div>
                </div>
              </div>

              <div className="oc-panel">
                <h2 className="oc-panel-title">{t('objects.objectCardPage.даты')}</h2>
                <div className="oc-row">
                  <span className="oc-row-label"><Calendar aria-hidden />{t('objects.objectCardPage.добавлен')}</span>
                  <span className="oc-row-value">{new Date(property.listedAt).toLocaleDateString('ru')}</span>
                </div>
                <div className="oc-row">
                  <span className="oc-row-label"><Calendar aria-hidden />{t('objects.objectCardPage.обновл_н')}</span>
                  <span className="oc-row-value">{new Date(property.updatedAt).toLocaleDateString('ru')}</span>
                </div>
              </div>

              <div className="oc-panel" style={{ flex: 1 }}>
                <h2 className="oc-panel-title">{t('objects.objectCardPage.описание')}</h2>
                <div className="oc-desc">
                  {d?.description ?? d?.summary ?? 'Нет описания'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Price history */}
        {tab === 'history' && (
          <div className="oc-panel">
            <h2 className="oc-panel-title">{t('objects.objectCardPage.история_изменения_це')}</h2>
            {[
              { date: '2026-03-01', price: property.price, note: 'Текущая цена' },
              { date: '2026-01-15', price: Math.round(property.price * 1.04), note: 'Снижение цены' },
              { date: '2025-11-23', price: Math.round(property.price * 1.08), note: 'Первоначальная цена' },
            ].map((row, i) => (
              <div key={i} className="oc-row">
                <span className="oc-hist-info">
                  <span className={`oc-hist-price${i === 0 ? ' is-accent' : ''}`}>
                    {FMT_USD.format(row.price)}
                  </span>
                  <span className="oc-hist-meta">
                    {new Date(row.date).toLocaleDateString('ru')} · {row.note}
                  </span>
                </span>
                {i > 0 && (
                  <span className="oc-row-delta">
                    −{Math.round(((row.price - property.price) / row.price) * 100)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Docs */}
        {tab === 'docs' && (
          <div className="oc-panel">
            <div className="oc-panel-head">
              <h2 className="oc-panel-title">{t('objects.objectCardPage.документы')}</h2>
              <button type="button" className="oc-upload-btn">{t('objects.objectCardPage.загрузить')}</button>
            </div>
            {[
              { name: 'Правоустанавливающий документ', type: 'PDF', date: '2025-11-23' },
              { name: 'Технический паспорт', type: 'PDF', date: '2025-11-23' },
              { name: 'Договор поручения', type: 'DOCX', date: '2025-12-01' },
            ].map((doc, i) => (
              <div key={i} className="oc-doc">
                <FileText aria-hidden />
                <div className="oc-doc-body">
                  <div className="oc-doc-name">{doc.name}</div>
                  <div className="oc-doc-meta">{doc.type} · {new Date(doc.date).toLocaleDateString('ru')}</div>
                </div>
                <button type="button" className="oc-doc-download">{t('objects.objectCardPage.скачать')}</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Диалоги управления ──────────────────────────────────────────── */}

        {editOpen && (
          <ObjectEditWizard
            property={property}
            mode="edit"
            onClose={() => setEditOpen(false)}
            onSave={handleEditSave}
          />
        )}

        {mlsMode && (
          <MlsConfirmDialog
            property={property}
            mode={mlsMode}
            onClose={() => setMlsMode(null)}
            onConfirmed={(_, isMlsNow) => {
              setIsMls(isMlsNow)
              setMlsMode(null)
            }}
          />
        )}

        {promoteOpen && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectCardPage.улучшить_объект')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setPromoteOpen(false)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectCardPage.улучшить_объект')}</h2>
              <p>{t('objects.objectCardPage.тут_будет_маркетинг')}</p>
              <div className="objects-confirm-actions">
                <button type="button" className="objects-confirm-back" onClick={() => setPromoteOpen(false)}>
                  {t('objects.objectCardPage.назад')}</button>
              </div>
            </div>
          </div>
        )}

        {confirmRefresh && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectCardPage.подтверждение_актуал')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setConfirmRefresh(false)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectCardPage.подтвердить_актуальн')}</h2>
              <p>{t('objects.objectCardPage.я_подтверждаю_что_об')}{property.title}{t('objects.objectCardPage.актуален_и_вс_ещ_пр')}</p>
              <div className="objects-confirm-actions">
                <button type="button" className="objects-confirm-back" onClick={() => setConfirmRefresh(false)}>
                  {t('objects.objectCardPage.назад')}</button>
                <button type="button" className="objects-confirm-submit" onClick={doRefresh}>
                  <RefreshCw aria-hidden />
                  {t('objects.objectCardPage.подтвердить')}</button>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectCardPage.удаление_объекта')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setConfirmDelete(false)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectCardPage.удалить_объект')}</h2>
              <p>{t('objects.objectCardPage.объект')}{property.title}{t('objects.objectCardPage.будет_удал_н_без_во')}</p>
              <div className="objects-confirm-actions">
                <button type="button" className="objects-confirm-back" onClick={() => setConfirmDelete(false)}>
                  {t('objects.objectCardPage.назад')}</button>
                <button type="button" className="objects-confirm-danger" onClick={doDelete}>
                  <Trash2 aria-hidden />
                  {t('objects.objectCardPage.удалить')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Duplicate Candidate & Owner Override Modal */}
        {duplicateModalOpen && selectedCandidate && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Обнаружен дубль объекта"
          >
            <div className="objects-confirm-modal max-w-lg">
              <div className="flex items-center gap-2 text-[#f08d89]">
                <ShieldAlert className="size-6 shrink-0" />
                <h2 className="!mb-0 text-lg font-medium text-[#fcecc8]">Обнаружен потенциальный дубль</h2>
              </div>
              <p className="text-[14px] leading-relaxed text-[rgba(242,207,141,0.8)]">
                Система обнаружила совпадение сигналов с существующим активом:
              </p>
              <div className="rounded border border-[rgba(240,141,137,0.3)] bg-[rgba(0,0,0,0.35)] p-3 text-[13px] text-[#fcecc8]">
                <div className="font-mono text-xs text-[rgba(242,207,141,0.6)]">
                  Кандидат: {selectedCandidate.candidateAssetId || selectedCandidate.id}
                </div>
                <div className="mt-2 space-y-1">
                  <div>Совпадение номера телефона: <strong>{selectedCandidate.signals.phoneMatch ? 'Да (+40 баллов)' : 'Нет'}</strong></div>
                  <div>Совпадение адреса: <strong>{selectedCandidate.signals.addressMatch ? 'Да (+40 баллов)' : 'Нет'}</strong></div>
                  <div>Совпадение комнат/площади/этажа: <strong>{selectedCandidate.signals.roomsAreaFloorMatch ? 'Да (+20 баллов)' : 'Нет'}</strong></div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-[rgba(242,207,141,0.9)]">
                  Обоснование права публикации (Owner Override):
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Укажите подтверждение эксклюзивного договора или права собственника (минимум 10 символов)..."
                  rows={3}
                  className="w-full rounded-md border border-[rgba(242,207,141,0.25)] bg-[rgba(0,0,0,0.4)] p-2.5 text-[14px] text-[#fcecc8] placeholder:text-[rgba(242,207,141,0.4)] focus:border-[#e6c364] focus:outline-none"
                />
              </div>
              <div className="objects-confirm-actions">
                <button
                  type="button"
                  className="objects-confirm-back"
                  onClick={() => setDuplicateModalOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isOverriding || overrideReason.trim().length < 10}
                  className="objects-confirm-submit !bg-[#e6c364] !text-[#072821] hover:!bg-[#e2c97e] disabled:opacity-50"
                  onClick={handleOverrideDuplicate}
                >
                  {isOverriding ? 'Сохранение...' : 'Подтвердить право собственности'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unpublish Modal */}
        {unpublishModalOpen && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Снять объект с публикации"
          >
            <div className="objects-confirm-modal max-w-md">
              <h2 className="text-lg font-medium text-[#fcecc8]">Снять с публикации</h2>
              <p className="text-[14px] text-[rgba(242,207,141,0.8)]">
                Укажите причину снятия объекта с витрины маркетплейса:
              </p>
              <textarea
                value={unpublishReason}
                onChange={(e) => setUnpublishReason(e.target.value)}
                placeholder="Причина снятия (минимум 10 символов)..."
                rows={3}
                className="w-full rounded-md border border-[rgba(242,207,141,0.25)] bg-[rgba(0,0,0,0.4)] p-2.5 text-[14px] text-[#fcecc8] placeholder:text-[rgba(242,207,141,0.4)] focus:border-[#e6c364] focus:outline-none"
              />
              <div className="objects-confirm-actions">
                <button
                  type="button"
                  className="objects-confirm-back"
                  onClick={() => setUnpublishModalOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isUnpublishing || unpublishReason.trim().length < 10}
                  className="objects-confirm-submit"
                  onClick={handleUnpublish}
                >
                  {isUnpublishing ? 'Снятие...' : 'Снять с публикации'}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectionOpen && (
          <div
            className="objects-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('objects.objectCardPage.добавить_объект_в_по')}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectionOpen(false)
            }}
          >
            <div className="objects-confirm-modal">
              <h2>{t('objects.objectCardPage.в_подборку')}</h2>
              <div className="objects-selection-list">
                {secondarySelections.length === 0 && (
                  <p>Подборок вторички пока нет</p>
                )}
                {secondarySelections.map((selection) => (
                  <button key={selection.id} type="button" onClick={() => addToSelection(selection.id, selection.title)}>
                    {selection.title}
                    <span>{selection.clientName}</span>
                  </button>
                ))}
              </div>
              <div className="objects-confirm-actions">
                <button type="button" className="objects-confirm-back" onClick={() => setSelectionOpen(false)}>
                  {t('objects.objectCardPage.назад')}</button>
                <button
                  type="button"
                  className="objects-confirm-submit"
                  onClick={() => navigate('/dashboard/objects/selections/new')}
                >
                  <Plus aria-hidden />
                  {t('objects.objectCardPage.создать_новую')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
