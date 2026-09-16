import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSelectionsBasePath } from '@/hooks/useSelectionsBasePath'
import { Home, Send, Trash2, Users, X } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useAgencyBranding } from '@/hooks/useAgencyBranding'
import { useLeads } from '@/context/LeadsContext'
import { useDevSelectionsStore } from '@/store/useDevSelectionsStore'
import { propertyAssetsApi, type PropertyAsset, type Listing } from '@/services/propertyAssetsApi'
import { LEAD_STAGE_COLUMN } from '@/data/leads-mock'
import { formatCurrency } from '@/lib/format-currency'
import { SelectionCustomizationPanel } from '@/components/selections/SelectionCustomizationPanel'
import {
  DEFAULT_DEV_CUSTOMIZATION,
  SECONDARY_CUSTOMIZATION_GROUPS,
  resolveDevCustomization,
  type DevSelectionCustomization,
} from '@/config/dev-selection-customization'
import { useTheme } from '@/context/ThemeContext'
import { useI18n } from "@/i18n";

type BasketItem = { key: string; asset: PropertyAsset; listing: Listing }

const DEAL_TYPE_LABEL: Record<Listing['dealType'], string> = {
  sale: 'Продажа',
  rent_long: 'Аренда (длительная)',
  rent_short: 'Аренда (посуточно)',
}

function listingPriceLabel(listing: Listing): string {
  return formatCurrency(listing.price.amountMinorUnits / 100, listing.price.currency)
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[color:var(--divider-subtle)] py-1.5 text-sm last:border-0">
      <span className="text-[color:var(--hub-body)]">{label}</span>
      <span className="text-right font-medium text-[color:var(--app-text)]">{value}</span>
    </div>
  )
}

function SecondaryLotPreview({ asset, listing, index, c }: { asset: PropertyAsset; listing: Listing; index: number; c: DevSelectionCustomization }) {
  const { blocks } = c
  return (
    <article className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-normal"
          style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}
        >
          {index}
        </span>
        <div>
          <p className="text-xs font-normal uppercase tracking-wide" style={{ color: '#60a5fa' }}>
            {DEAL_TYPE_LABEL[listing.dealType]}
          </p>
          <h3 className="text-base font-normal text-[color:var(--app-text)]">{asset.location.address}</h3>
        </div>
      </div>
      <div className="rounded-lg bg-[var(--green-card)] p-3 ring-1 ring-[color:var(--green-border)]">
        {blocks.unitSpecs && <ParamRow label="Комнат" value={String(asset.characteristics.rooms ?? '—')} />}
        {blocks.unitSpecs && <ParamRow label="Площадь" value={`${asset.characteristics.area} м²`} />}
        {blocks.unitSpecs && asset.characteristics.floor != null && (
          <ParamRow label="Этаж" value={String(asset.characteristics.floor)} />
        )}
        {blocks.unitPrice && <ParamRow label="Цена" value={listingPriceLabel(listing)} />}
      </div>
    </article>
  )
}

function SelectionSendPreview({
  title,
  recipientLabel,
  basket,
  agencyName,
  logoDataUrl,
  c,
}: {
  title: string
  recipientLabel: string
  basket: BasketItem[]
  agencyName: string
  logoDataUrl: string | null
  c: DevSelectionCustomization
}) {
    const { t: tApp } = useI18n();
  return (
    <div
      className="rounded-xl border border-[color:var(--hub-card-border)] bg-[var(--hub-card-bg)] text-[color:var(--app-text)] shadow-[inset_0_0_0_1px_var(--hub-card-border)]"
      style={{ fontFamily: "'Montserrat', system-ui, sans-serif" }}
    >
      <div className="border-b border-[color:var(--divider-subtle)] px-6 py-5">
        {logoDataUrl ? (
          <img src={logoDataUrl} alt="" className="max-h-14 max-w-[200px] object-contain object-left" />
        ) : (
          <div className="text-xs font-normal uppercase tracking-widest text-[color:var(--hub-desc)]">{tApp('selections.selectionsNewPage.логотип_агентства')}</div>
        )}
        <h2 className="mt-4 text-lg font-normal text-[color:var(--app-text)]">{title || 'Подборка объектов'}</h2>
        {recipientLabel && (
          <p className="mt-1 text-sm text-[color:var(--hub-body)]">{tApp('selections.selectionsNewPage.для')}{recipientLabel}</p>
        )}
      </div>

      <div className="space-y-0 px-6 py-4">
        {basket.length === 0 ? (
          <p className="py-8 text-center text-sm text-[color:var(--app-text-muted)]">{tApp('selections.selectionsNewPage.добавьте_лоты_из_пер')}</p>
        ) : (
          basket.map((item, i) => (
            <div key={item.key}>
              {i > 0 && <div className="my-6 border-t-2 border-dashed border-[color:var(--divider-subtle)]" aria-hidden />}
              <SecondaryLotPreview asset={item.asset} listing={item.listing} index={i + 1} c={c} />
            </div>
          ))
        )}
      </div>

      {c.blocks.agentContacts && (
      <div className="border-t border-[color:var(--divider-subtle)] bg-[var(--green-deep)] px-6 py-4 text-center">
        <p className="text-xs font-normal uppercase tracking-[0.2em] text-[color:var(--hub-desc)]">
          {agencyName || 'Название агентства'}
        </p>
        <p className="mt-1 text-[11px] text-[color:var(--app-text-subtle)]">{tApp('selections.selectionsNewPage.подборка_сформирован')}</p>
      </div>
      )}
    </div>
  )
}

export function SelectionsNewPage() {
    const { t: tApp } = useI18n();
  const navigate = useNavigate()
  const selectionsBase = useSelectionsBasePath()
  const { state: leadsState } = useLeads()
  const branding = useAgencyBranding()
  const { isLightTheme } = useTheme()
  const createSelection = useDevSelectionsStore((s) => s.create)

  const [title, setTitle] = useState('')
  const [leadQuery, setLeadQuery] = useState('')
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())
  const [inventory, setInventory] = useState<{ asset: PropertyAsset; listings: Listing[] }[]>([])
  const [basket, setBasket] = useState<BasketItem[]>([])
  const [secQuery, setSecQuery] = useState('')
  const [sentOk, setSentOk] = useState(false)
  const [customization, setCustomization] = useState<DevSelectionCustomization>(DEFAULT_DEV_CUSTOMIZATION)

  useEffect(() => {
    let cancelled = false
    propertyAssetsApi.listAllAssetsWithListings().then(({ items }) => {
      if (!cancelled) setInventory(items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const availableListings = useMemo(() => {
    const rows: { asset: PropertyAsset; listing: Listing }[] = []
    for (const { asset, listings } of inventory) {
      for (const listing of listings) {
        if (listing.status === 'active') rows.push({ asset, listing })
      }
    }
    return rows
  }, [inventory])

  const leadRecipients = useMemo(() => {
    const q = leadQuery.trim().toLowerCase()
    return leadsState.leadPool.filter((l) => {
      if (!l.name?.trim()) return false
      if (LEAD_STAGE_COLUMN[l.stageId] === 'rejection') return false
      if (q.length < 2) return true
      return l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)
    })
  }, [leadsState.leadPool, leadQuery])

  const secondaryFiltered = useMemo(() => {
    const q = secQuery.trim().toLowerCase()
    if (q.length < 2) return availableListings
    return availableListings.filter(({ asset }) => asset.location.address.toLowerCase().includes(q))
  }, [availableListings, secQuery])

  function toggleLead(id: string) {
    setSelectedLeadIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function addListing(asset: PropertyAsset, listing: Listing) {
    const key = listing._id
    setBasket((prev) => (prev.some((b) => b.key === key) ? prev : [...prev, { key, asset, listing }]))
  }

  function removeBasket(i: number) {
    setBasket((prev) => prev.filter((_, idx) => idx !== i))
  }

  const recipientLabel = useMemo(() => {
    const names = leadsState.leadPool
      .filter((l) => selectedLeadIds.has(l.id))
      .map((l) => l.name ?? l.id)
    if (names.length === 0) return ''
    if (names.length <= 2) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}`
  }, [leadsState.leadPool, selectedLeadIds])

  function handleSend() {
    if (!title.trim() || basket.length === 0) return
    const listingIds = basket.map((b) => b.listing._id)

    if (selectedLeadIds.size === 0) {
      createSelection({ title: title.trim(), listingIds, customization })
    } else {
      for (const leadId of selectedLeadIds) {
        const lead = leadsState.leadPool.find((l) => l.id === leadId)
        if (!lead?.name) continue
        createSelection({
          title: title.trim(),
          listingIds,
          leadId,
          clientName: lead.name,
          clientPhone: lead.phone,
          customization,
        })
      }
    }

    setSentOk(true)
    setTimeout(() => navigate(`${selectionsBase}/list`), 600)
  }

  const canSend = title.trim().length > 0 && basket.length > 0

  return (
    <DashboardShell hideSidebar>
      <div
        className="min-h-full w-full max-w-[1600px] box-border bg-[var(--app-bg)] px-6 py-8 text-[color:var(--app-text)]"
        style={{ fontFamily: "'Montserrat', system-ui, sans-serif" }}
      >
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--divider-subtle)] pb-6">
          <div>
            <h1 className="text-2xl font-normal tracking-tight text-[color:var(--app-text)]">
              Новая подборка · вторичка
            </h1>
          </div>
          {sentOk && <span className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{tApp('selections.selectionsNewPage.сохранено_переход_к')}</span>}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_min(440px,42vw)]">
          <div className="space-y-8">
            <section className="rounded-xl border border-[color:var(--hub-card-border)] bg-[var(--hub-card-bg)] p-5 shadow-[inset_0_0_0_1px_var(--hub-card-border)]">
              <label className="block text-xs font-normal uppercase tracking-wider text-[color:var(--hub-desc)]">
                {tApp('selections.selectionsNewPage.название_подборки')}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tApp('selections.selectionsNewPage.2к_у_метро_до_8m')}
                className="mt-2 w-full rounded-lg border border-[color:var(--green-border)] bg-[var(--green-deep)] px-3 py-2.5 text-sm text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-subtle)] focus:border-[color:var(--hub-card-border-hover)]"
              />
            </section>

            <section className="rounded-xl border border-[color:var(--hub-card-border)] bg-[var(--hub-card-bg)] p-5 shadow-[inset_0_0_0_1px_var(--hub-card-border)]">
              <div className="flex items-center gap-2 text-[color:var(--theme-accent-heading)]">
                <Users className="size-5" />
                <h2 className="text-sm font-normal uppercase tracking-wide">{tApp('selections.selectionsNewPage.получатели_из_лидов')}</h2>
              </div>
              <input
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                placeholder={tApp('selections.selectionsNewPage.поиск_по_имени_или_i')}
                className="mt-3 w-full rounded-lg border border-[color:var(--green-border)] bg-[var(--green-deep)] px-3 py-2 text-sm text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-subtle)] focus:border-[color:var(--hub-card-border-hover)]"
              />
              <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-[color:var(--green-border)]">
                {leadRecipients.length === 0 ? (
                  <p className="p-4 text-center text-sm text-[color:var(--app-text-muted)]">{tApp('selections.selectionsNewPage.никого_не_найдено')}</p>
                ) : (
                  leadRecipients.slice(0, 80).map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-[color:var(--divider-subtle)] px-3 py-2 last:border-0 hover:bg-[var(--dropdown-hover)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(l.id)}
                        onChange={() => toggleLead(l.id)}
                        className="size-4 accent-[var(--gold)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--app-text)]">{l.name}</span>
                      <span className="shrink-0 text-[10px] uppercase text-[color:var(--app-text-subtle)]">{l.id}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-2 text-xs text-[color:var(--app-text-muted)]">{tApp('selections.selectionsNewPage.выбрано')}{selectedLeadIds.size}</p>
            </section>

            <section className="rounded-xl border border-[color:var(--hub-card-border)] bg-[var(--hub-card-bg)] p-5 shadow-[inset_0_0_0_1px_var(--hub-card-border)]">
              <div className="flex items-center gap-2" style={{ color: '#60a5fa' }}>
                <Home className="size-5" />
                <h2 className="text-sm font-normal uppercase tracking-wide">{tApp('selections.selectionsNewPage.вторичка_квартиры')}</h2>
              </div>
              <input
                value={secQuery}
                onChange={(e) => setSecQuery(e.target.value)}
                placeholder={tApp('selections.selectionsNewPage.поиск_по_адресу')}
                className="mt-3 w-full rounded-lg border border-[color:var(--green-border)] bg-[var(--green-deep)] px-3 py-2 text-sm text-[color:var(--app-text)] outline-none placeholder:text-[color:var(--app-text-subtle)] focus:border-[color:var(--hub-card-border-hover)]"
              />
              <div className="mt-4 space-y-3">
                {secondaryFiltered.length === 0 && (
                  <p className="py-4 text-center text-sm text-[color:var(--app-text-muted)]">Активных объектов не найдено</p>
                )}
                {secondaryFiltered.map(({ asset, listing }) => {
                  const key = listing._id
                  const inBasket = basket.some((b) => b.key === key)
                  return (
                    <div
                      key={key}
                      className="flex gap-3 rounded-lg border border-[color:var(--green-border)] bg-[var(--green-deep)] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-normal text-[color:var(--app-text)]">{asset.location.address}</p>
                        <p className="text-xs text-[color:var(--hub-body)]">
                          {asset.characteristics.rooms ?? '—'}{tApp('selections.selectionsNewPage.к')}{asset.characteristics.area} {tApp('selections.selectionsNewPage.м')}
                          {asset.characteristics.floor != null && ` · ${asset.characteristics.floor} эт`}
                        </p>
                        <p className="text-xs font-medium text-[color:var(--gold)]">
                          {listingPriceLabel(listing)} · {DEAL_TYPE_LABEL[listing.dealType]}
                        </p>
                        <button
                          type="button"
                          disabled={inBasket}
                          onClick={() => addListing(asset, listing)}
                          className="mt-2 rounded-md border border-sky-500/40 px-3 py-1 text-[11px] font-normal uppercase tracking-wide text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
                        >
                          {inBasket ? 'В подборке' : 'Добавить'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="rounded-xl border border-[color:var(--hub-card-border)] bg-[var(--hub-card-bg)] p-5 shadow-[inset_0_0_0_1px_var(--hub-card-border)]">
              <h2 className="text-sm font-normal uppercase tracking-wide text-[color:var(--app-text)]">{tApp('selections.selectionsNewPage.порядок_в_подборке')}{basket.length})</h2>
              {basket.length === 0 ? (
                <p className="mt-4 text-sm text-[color:var(--app-text-muted)]">{tApp('selections.selectionsNewPage.пока_пусто')}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {basket.map((item, i) => (
                    <li
                      key={item.key}
                      className="flex items-center gap-2 rounded-lg border border-[color:var(--green-border)] bg-[var(--green-deep)] px-3 py-2 text-sm text-[color:var(--app-text)]"
                    >
                      <span className="text-xs text-[color:var(--app-text-subtle)]">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{item.asset.location.address}</span>
                      <button
                        type="button"
                        onClick={() => removeBasket(i)}
                        className="shrink-0 rounded p-1 text-red-400/80 hover:bg-red-500/10"
                        aria-label={tApp('selections.selectionsNewPage.убрать')}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap gap-3 pb-8">
              <button
                type="button"
                disabled={!canSend}
                onClick={handleSend}
                className="alphabase-section-primary disabled:pointer-events-none"
              >
                <Send className="size-4" />
                Сформировать и отправить
              </button>
              <button
                type="button"
                onClick={() => {
                  setBasket([])
                  setSelectedLeadIds(new Set())
                  setTitle('')
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--green-border)] px-4 py-3 text-sm text-[color:var(--app-text-muted)] hover:bg-[var(--dropdown-hover)]"
              >
                <X className="size-4" />
                {tApp('selections.selectionsNewPage.очистить')}</button>
            </div>
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
            <SelectionCustomizationPanel
              value={customization}
              groups={SECONDARY_CUSTOMIZATION_GROUPS}
              variant={isLightTheme ? 'light' : 'dark'}
              onChange={(next) => setCustomization(resolveDevCustomization({ ...customization, ...next }))}
            />
            <p className="mb-2 text-center text-[10px] font-normal uppercase tracking-widest text-[color:var(--hub-desc)]">
              {tApp('selections.selectionsNewPage.предпросмотр_письма')}</p>
            <SelectionSendPreview
              title={title}
              recipientLabel={recipientLabel}
              basket={basket}
              agencyName={branding.name || 'Ваше агентство'}
              logoDataUrl={branding.logoDataUrl}
              c={customization}
            />
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
