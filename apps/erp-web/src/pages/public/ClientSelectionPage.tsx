import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Heart, Phone, Building2, MapPin, Calendar, Layers, Check } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibregl from 'maplibre-gl'

import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { useCoreStore } from '@/store/useCoreStore'
import { resolveDevCustomization } from '@/config/dev-selection-customization'
import { formatMoney, t, unitStatusLabel } from '@/lib/selection-display'
import { optionLabelRu, type OptionGroup } from '@/lib/project-options'
import { parseSelectionShare } from '@/lib/selection-share'
import { getUnitShareSearchQuery } from '@/lib/unit-share'
import { loadPublicUnitLanding } from '@/lib/unit-landing'
import type { PublicUnitLanding } from '@/services/developmentApi'
import type { DevSelectionItem } from '@/types/dev-selection'
import type { PublicSelectionItem, PublicSelectionListing } from '@/services/publicSelectionsApi'
import type { IBuilding, IProject, IUnit, UnitStatus } from '@/types/core'
import { useI18n } from "@/i18n";

const DEAL_TYPE_LABEL_RU: Record<PublicSelectionListing['dealType'], string> = {
  sale: 'Продажа',
  rent_long: 'Аренда (длительная)',
  rent_short: 'Аренда (посуточно)',
}

function formatListingPrice(price: PublicSelectionListing['price']): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: price.currency, maximumFractionDigits: 0 }).format(
    price.amountMinorUnits / 100,
  )
}

function ListingCard({ item, listing }: { item: DevSelectionItem; listing: PublicSelectionListing }) {
  const reaction = item.reaction
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border p-4 transition-all ${
        reaction === 'liked'
          ? 'border-emerald-500/50 bg-[rgba(16,185,129,0.05)]'
          : reaction === 'disliked'
            ? 'border-[rgba(242,207,141,0.08)] bg-[rgba(0,0,0,0.3)] opacity-60'
            : 'border-[rgba(242,207,141,0.12)] bg-[rgba(0,0,0,0.25)]'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-[rgba(96,165,250,0.9)]">{DEAL_TYPE_LABEL_RU[listing.dealType]}</p>
      <p className="mt-1 text-base font-normal text-[#fcecc8]">{listing.address}</p>
      {listing.city && <p className="mt-1 text-[11px] text-[rgba(242,207,141,0.4)]">{listing.city}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {listing.rooms != null && (
          <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
            {listing.rooms} комн.
          </span>
        )}
        <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
          {listing.area} м²
        </span>
        {listing.floor != null && (
          <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
            {listing.floor} эт.
          </span>
        )}
      </div>
      <p className="mt-3 text-base font-normal text-[#c9a84c]">{formatListingPrice(listing.price)}</p>
      {item.agentNote && <p className="mt-2 text-xs italic text-[rgba(242,207,141,0.55)]">«{item.agentNote}»</p>}
    </div>
  )
}

/* ─── Map Constants ────────────────────────────────────────── */
// const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
// const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL?.replace('${VITE_MAPTILER_KEY}', MAPTILER_KEY)
const STYLE_URL = 'https://api.maptiler.com/maps/streets-v2/style.json?key=en6NJwkot3tUa0Z2O9v9'

const STATUS_COLOR: Record<string, string> = {
  free: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  booked: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  sold: 'bg-rose-500/20 text-rose-300 border-rose-400/40',
  withdrawn: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
}

interface ResolvedSelectionItem {
  item: DevSelectionItem
  unit?: IUnit
  building?: IBuilding
  project?: IProject
  listing?: PublicSelectionListing
}

const PUBLIC_STATUS_TO_UNIT: Record<string, UnitStatus> = {
  available: 'free',
  reserved: 'booked',
  sold: 'sold',
  hidden: 'withdrawn',
}

/** Публичный лендинг лота → форма стора (IUnit/IBuilding/IProject), которую рендерит страница. */
function landingToSelectionShape(landing: PublicUnitLanding): {
  unit: IUnit
  building: IBuilding
  project: IProject
} {
  const u = landing.unit
  const c = landing.complex
  const renders = c.renderUrls?.length
    ? c.renderUrls
    : c.images?.length
      ? c.images
      : (c.renders ?? []).map((r) => r.url).filter((url): url is string => !!url)

  const unit = {
    _id: u.id,
    building: landing.building.id,
    floor: u.floor,
    number: u.number,
    rooms: u.roomsStr ?? u.rooms,
    area: u.area,
    viewType: u.details?.viewType,
    price: u.price,
    pricePerSqm: u.details?.pricePerSqm,
    status: PUBLIC_STATUS_TO_UNIT[u.status] ?? 'free',
    layoutImageUrl: u.image?.url ?? u.floorPlanUrl ?? undefined,
  } as IUnit

  const building = {
    _id: landing.building.id,
    project: c.id,
    name: landing.building.name,
  } as IBuilding

  const project = {
    _id: c.id,
    name: c.name,
    location: c.address ?? c.city ?? '',
    classType: c.classType,
    completionDate: c.completionDate,
    description: c.description,
    youtubeLink: c.youtubeLink,
    paymentTypes: c.paymentTypes ?? [],
    amenities: c.amenities,
    infrastructureInternal: c.infrastructureInternal,
    infrastructureExternal: c.infrastructureExternal,
    areaPolygon: c.areaPolygon,
    constructionProgress: (c.constructionProgress ?? []).map((r) => r.url).filter((url): url is string => !!url),
    renders,
  } as IProject

  return { unit, building, project }
}

function ProjectVideo({ youtubeLink }: { youtubeLink?: string }) {
    const { t: tApp } = useI18n();
  if (!youtubeLink) return null
  
  // Extract video ID from link
  let videoId = ''
  try {
    const url = new URL(youtubeLink)
    if (url.hostname === 'youtu.be') {
      videoId = url.pathname.slice(1)
    } else if (url.searchParams.has('v')) {
      videoId = url.searchParams.get('v') || ''
    }
  } catch { /* ignore */ }

  if (!videoId) return null

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-[rgba(242,207,141,0.12)]">
      <div className="flex items-center gap-2 border-b border-[rgba(242,207,141,0.08)] bg-[rgba(201,168,76,0.05)] px-4 py-3">
        <Building2 size={14} className="text-[#c9a84c]" />
        <span className="text-sm font-normal text-[rgba(242,207,141,0.85)]">{tApp('public.clientSelectionPage.видео_презентация_пр')}</span>
      </div>
      <div className="aspect-video w-full bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
function ProjectMap({ location, areaPolygon }: { location?: string; areaPolygon?: [number, number][] }) {
    const { t: tApp } = useI18n();
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !areaPolygon || areaPolygon.length === 0) return

    // const map = new maplibregl.Map({
    //   container: mapContainerRef.current,
    //   style: STYLE_URL || 'https://demotiles.maplibre.org/style.json',
    //   center: areaPolygon[0],
    //   zoom: 15,
    //   interactive: false,
    // })


    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL,
      center: areaPolygon[0],
      zoom: 15,
      interactive: false,
    })

    map.on('load', () => {
      map.addSource('project-area', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[...areaPolygon, areaPolygon[0]]]
          }
        }
      })

      map.addLayer({
        id: 'project-area-fill',
        type: 'fill',
        source: 'project-area',
        paint: {
          'fill-color': '#c9a84c',
          'fill-opacity': 0.2
        }
      })

      map.addLayer({
        id: 'project-area-outline',
        type: 'line',
        source: 'project-area',
        paint: {
          'line-color': '#c9a84c',
          'line-width': 2
        }
      })

      const lons = areaPolygon.map(p => p[0])
      const lats = areaPolygon.map(p => p[1])
      map.fitBounds([
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)]
      ], { padding: 40, animate: false })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [areaPolygon])

  if (!areaPolygon || areaPolygon.length === 0) return null

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-[rgba(242,207,141,0.12)]">
      <div className="flex items-center gap-2 border-b border-[rgba(242,207,141,0.08)] bg-[rgba(201,168,76,0.05)] px-4 py-3">
        <MapPin size={14} className="text-[#c9a84c]" />
        <span className="text-sm font-normal text-[rgba(242,207,141,0.85)]">{tApp('public.clientSelectionPage.расположение_и_терри')}</span>
      </div>
      <div ref={mapContainerRef} className="h-64 w-full" />
      {location && (
        <div className="bg-[rgba(0,0,0,0.2)] px-4 py-2 text-xs text-[rgba(242,207,141,0.5)]">
          {location}
        </div>
      )}
    </div>
  )
}

export function ClientSelectionPage() {
    const { t: tApp } = useI18n();
  const { token } = useParams<{ token: string }>()
  const routerLocation = useLocation()
  const [searchParams] = useSearchParams()

  const markViewed = useDevSelectionsStore((s) => s.markViewed)
  const localSelection = useDevSelectionsStore((s) => (token ? s.getByToken(token) : undefined))

  // Состав подборки из payload `?d=` — для пересылаемой ссылки (другое устройство / без авторизации).
  const shareSearch = useMemo(
    () => getUnitShareSearchQuery(searchParams, routerLocation.hash),
    [searchParams, routerLocation.hash],
  )
  const sharedSelection = useMemo(() => parseSelectionShare(shareSearch), [shareSearch])
  const selection = localSelection ?? sharedSelection

  const allUnits = useCoreStore((s) => s.allUnits)
  const allBuildings = useCoreStore((s) => s.allBuildings)
  const projects = useCoreStore((s) => s.projects)

  const [copiedPhone, setCopiedPhone] = useState(false)
  const [items, setItems] = useState<ResolvedSelectionItem[]>([])

  const { language, currency, blocks } = resolveDevCustomization(selection?.customization)
  const money = (n?: number) => formatMoney(n, currency, language)
  // Опции проекта/лота хранятся каноническими слагами; для русского клиента
  // показываем русскую подпись, для остальных языков — канонический вариант.
  const optLabel = (group: OptionGroup, value: string) =>
    language === 'ru' ? optionLabelRu(group, value) : value

  useEffect(() => {
    if (token) markViewed(token)
  }, [token, markViewed])

  // Юниты тянем через публичный API лота (как визитка) — иначе у клиента без авторизации карточки пустые.
  // Листинги вторички сервер уже денормализует прямо в ответе подборки (item.listing) — доп. запрос не нужен.
  useEffect(() => {
    if (!selection) {
      setItems([])
      return
    }
    let cancelled = false
    const ctx = { allUnits, buildings: allBuildings, projects }
    const rawItems = selection.items as PublicSelectionItem[]
    Promise.all(
      rawItems.map(async (item): Promise<ResolvedSelectionItem | null> => {
        if (item.targetType === 'listing') {
          return item.listing ? { item, listing: item.listing } : null
        }
        if (!item.unitId) return null
        const { data } = await loadPublicUnitLanding(item.unitId, ctx)
        if (!data) return null
        return { item, ...landingToSelectionShape(data) }
      }),
    ).then((resolved) => {
      if (cancelled) return
      setItems(resolved.filter((e): e is ResolvedSelectionItem => !!e && (!!e.unit || !!e.listing)))
    })
    return () => {
      cancelled = true
    }
  }, [selection, allUnits, allBuildings, projects])

  const project = useMemo(() => {
    const first = items[0]?.project
    return first ?? null
  }, [items])

  const priceRange = useMemo(() => {
    const prices = items.map((e) => e.unit?.price ?? 0).filter(Boolean)
    if (!prices.length) return null
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    return min === max ? money(min) : `${money(min)} — ${money(max)}`
  }, [items, currency, language])

  const amenities = useMemo(() => {
    if (!project) return []
    return [
      ...(project.amenities ?? []),
      ...(project.infrastructureInternal ?? []).map((v) => optLabel('infraInternal', v)),
      ...(project.infrastructureExternal ?? []).map((v) => optLabel('infraExternal', v)),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, language])
  const payments = project?.paymentTypes ?? []
  const construction = project?.constructionProgress ?? []

  const handleCopyPhone = () => {
    if (!selection?.clientPhone) return
    navigator.clipboard.writeText(selection.clientPhone).then(() => {
      setCopiedPhone(true)
      setTimeout(() => setCopiedPhone(false), 2000)
    })
  }

  if (!selection) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#07120a] px-4 text-center">
        <Building2 size={48} className="mb-4 text-[rgba(242,207,141,0.2)]" />
        <h1 className="text-xl font-normal text-[#fcecc8]">{t(language, 'notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-[rgba(242,207,141,0.45)]">
          {t(language, 'notFoundSub')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#07120a] text-[#fcecc8]">

      {/* ── Hero: renders + info ── */}
      <div className="relative overflow-hidden">
        {/* Renders strip */}
        {blocks.projectGallery && project?.renders && project.renders.length > 0 ? (
          <div className="flex h-52 gap-1 md:h-72">
            {project.renders.slice(0, 3).map((url, i) => (
              <div
                key={i}
                className="flex-1 bg-cover bg-center"
                style={{ backgroundImage: `url(${url})` }}
              />
            ))}
          </div>
        ) : (
          <div className="h-40 bg-gradient-to-b from-[#0f2318] to-[#07120a]" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07120a] via-[rgba(7,18,10,0.5)] to-transparent" />

        {/* Project info overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 md:px-10">
          <div className="mx-auto max-w-4xl">
            {blocks.projectOverview && (
            <div className="mb-1 flex items-center gap-2 text-xs text-[rgba(242,207,141,0.5)]">
              <MapPin size={11} />
              {project?.location ?? t(language, 'locationUnknown')}
              {project?.classType && (
                <span className="rounded-full border border-[#c9a84c]/40 px-2 py-0.5 text-[#c9a84c]">
                  {optLabel('classTypes', project.classType)}
                </span>
              )}
            </div>
            )}
            <h1 className="text-2xl font-normal text-[#fcecc8] md:text-3xl">
              {project?.name ?? 'Объект'}
            </h1>
            {blocks.projectOverview && project?.completionDate && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-[rgba(242,207,141,0.5)]">
                <Calendar size={11} />
                {t(language, 'completion')}: {project.completionDate}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Selection header ── */}
      <div className="border-b border-[rgba(242,207,141,0.08)] px-4 py-5 md:px-10">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-[rgba(242,207,141,0.45)]">{tApp('public.clientSelectionPage.персональная_подборк')}</p>
              {selection.clientName && (
                <h2 className="text-lg font-normal text-[#fcecc8]">
                  {t(language, 'forClient')} {selection.clientName}
                </h2>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[rgba(242,207,141,0.55)]">
              {blocks.unitPrice && priceRange && (
                <span className="rounded-full border border-[rgba(242,207,141,0.2)] px-3 py-1 text-[rgba(242,207,141,0.85)]">
                  {priceRange}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Layers size={12} />
                {items.length} {language === 'ru' ? (items.length === 1 ? 'вариант' : items.length < 5 ? 'варианта' : 'вариантов') : t(language, 'variantsCount')}
              </span>
            </div>
          </div>

          {selection.agentNote && (
            <div className="mt-3 rounded-xl border border-[rgba(242,207,141,0.12)] bg-[rgba(201,168,76,0.06)] px-4 py-3 text-sm text-[rgba(242,207,141,0.8)]">
              {selection.agentNote}
            </div>
          )}
        </div>
      </div>

      {/* ── Apartment cards ── */}
      <div className="px-4 py-8 md:px-10">
        <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ item, unit, building, listing }) => {
            if (listing) {
              return <ListingCard key={item.listingId} item={item} listing={listing} />
            }
            if (!unit) return null
            const reaction = item.reaction
            const price = unit.price ?? (unit.pricePerSqm && unit.area ? Math.round(unit.pricePerSqm * unit.area) : undefined)
            return (
              <div
                key={item.unitId}
                className={`flex flex-col overflow-hidden rounded-2xl border transition-all ${
                  reaction === 'liked'
                    ? 'border-emerald-500/50 bg-[rgba(16,185,129,0.05)]'
                    : reaction === 'disliked'
                      ? 'border-[rgba(242,207,141,0.08)] bg-[rgba(0,0,0,0.3)] opacity-60'
                      : 'border-[rgba(242,207,141,0.12)] bg-[rgba(0,0,0,0.25)]'
                }`}
              >
                {/* Floor plan image */}
                <div className="relative h-40 bg-[rgba(0,0,0,0.4)]">
                  {blocks.unitPlan && unit.layoutImageUrl ? (
                    <img
                      src={unit.layoutImageUrl}
                      alt={`${t(language, 'block')} ${unit.number}`}
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Building2 size={32} className="text-[rgba(242,207,141,0.1)]" />
                    </div>
                  )}

                  {/* Status badge */}
                  {blocks.unitStatus && (
                  <div className="absolute right-2 top-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[unit.status] ?? STATUS_COLOR.free}`}>
                      {unitStatusLabel(language, unit.status)}
                    </span>
                  </div>
                  )}

                  {/* Reaction overlay if liked */}
                  {reaction === 'liked' && (
                    <div className="absolute left-2 top-2 rounded-full bg-emerald-500/30 p-1">
                      <Heart size={12} className="fill-emerald-400 text-emerald-400" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] text-[rgba(242,207,141,0.4)]">
                          {building?.name ?? 'Корпус'}
                        </p>
                        <p className="text-base font-normal text-[#fcecc8]">{unit.number}</p>
                      </div>
                      {blocks.unitPrice && price ? (
                        <p className="text-base font-normal text-[#c9a84c]">{money(price)}</p>
                      ) : null}
                    </div>

                    {blocks.unitSpecs && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {unit.rooms && (
                        <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
                          {optLabel('rooms', unit.rooms)}
                        </span>
                      )}
                      {unit.area != null && (
                        <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
                          {unit.area} {tApp('public.clientSelectionPage.м')}</span>
                      )}
                      {unit.floor && (
                        <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
                          {unit.floor} {t(language, 'floor')}
                        </span>
                      )}
                      {unit.viewType && (
                        <span className="rounded-lg border border-[rgba(242,207,141,0.15)] px-2 py-0.5 text-[11px] text-[rgba(242,207,141,0.75)]">
                          {optLabel('views', unit.viewType)}
                        </span>
                      )}
                    </div>
                    )}
                  </div>

                  {item.agentNote && (
                    <p className="text-xs italic text-[rgba(242,207,141,0.55)]">
                      «{item.agentNote}»
                    </p>
                  )}

                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Project content ── */}
      {(
        (blocks.projectDescription && project?.description) ||
        (blocks.amenities && amenities.length > 0) ||
        (blocks.paymentPlans && payments.length > 0) ||
        (blocks.constructionProgress && construction.length > 0) ||
        (blocks.locationMap && project?.areaPolygon) ||
        (blocks.video && project?.youtubeLink)
      ) && (
        <div className="border-t border-[rgba(242,207,141,0.08)] px-4 py-8 md:px-10">
          <div className="mx-auto max-w-4xl">
            {blocks.projectDescription && project?.description && (
              <>
                <h3 className="mb-3 text-[16px] font-normal uppercase tracking-wider text-[rgba(242,207,141,0.72)]">
                  {t(language, 'aboutComplex')}
                </h3>
                <p className="text-[16px] leading-relaxed text-[rgba(242,207,141,0.72)]">{project.description}</p>
              </>
            )}

            {blocks.amenities && amenities.length > 0 && (
              <section className="mt-8">
                <h3 className="mb-3 text-[16px] font-normal uppercase tracking-wider text-[rgba(242,207,141,0.72)]">
                  {t(language, 'amenitiesSection')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {amenities.map((a) => (
                    <span
                      key={a}
                      className="rounded-md border border-[rgba(242,207,141,0.18)] bg-[rgba(201,168,76,0.06)] px-3 py-1.5 text-[16px] text-[rgba(242,207,141,0.85)]"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {blocks.paymentPlans && payments.length > 0 && (
              <section className="mt-8">
                <h3 className="mb-3 text-[16px] font-normal uppercase tracking-wider text-[rgba(242,207,141,0.72)]">
                  {t(language, 'paymentsSection')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {payments.map((p) => (
                    <span
                      key={p}
                      className="rounded-md border border-[rgba(242,207,141,0.18)] bg-[rgba(201,168,76,0.06)] px-3 py-1.5 text-[16px] text-[rgba(242,207,141,0.85)]"
                    >
                      {optLabel('paymentTypes', p)}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {blocks.constructionProgress && construction.length > 0 && (
              <section className="mt-8">
                <h3 className="mb-3 text-[16px] font-normal uppercase tracking-wider text-[rgba(242,207,141,0.72)]">
                  {t(language, 'constructionSection')}
                </h3>
                <ul className="flex flex-col gap-2">
                  {construction.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-[16px] text-[rgba(242,207,141,0.85)]">
                      <Check size={16} className="mt-0.5 shrink-0 text-[#c9a84c]" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {blocks.locationMap && (
              <ProjectMap location={project?.location} areaPolygon={project?.areaPolygon} />
            )}
            {blocks.video && <ProjectVideo youtubeLink={project?.youtubeLink} />}
          </div>
        </div>
      )}

      {/* ── Footer: agent contact ── */}
      {blocks.agentContacts && (
      <div className="border-t border-[rgba(242,207,141,0.08)] px-4 py-8 md:px-10">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center">
          <p className="text-xs text-[rgba(242,207,141,0.4)]">{tApp('public.clientSelectionPage.подборка_подготовлен')}</p>
          <p className="text-sm font-medium text-[#fcecc8]">{tApp('public.clientSelectionPage.baza_sale_девелопмен')}</p>

          {selection.clientPhone && (
            <button
              type="button"
              onClick={handleCopyPhone}
              className="flex items-center gap-2 rounded-xl bg-[#c9a84c] px-6 py-3 text-sm font-normal text-[#0a1f12] transition-colors hover:bg-[#e2c97e]"
            >
              {copiedPhone ? <Check size={16} /> : <Phone size={16} />}
              {copiedPhone ? t(language, 'copied') : selection.clientPhone}
            </button>
          )}

        </div>
      </div>
      )}

    </div>
  )
}
