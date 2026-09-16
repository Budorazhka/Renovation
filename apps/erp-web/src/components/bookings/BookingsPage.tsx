import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertCircle, Building2, CheckCircle, Clock, Loader2, XCircle } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useModulePermissions } from '@/hooks/useModulePermissions'
import { useRolePermissions } from '@/hooks/useRolePermissions'
import { useLeads } from '@/context/LeadsContext'
import { bookingsApiV2, type BookingStatusV2, type BookingV2 } from '@/services/bookingsApiV2'
import { developmentsApiV2, type DevelopmentV2 } from '@/services/developmentsApiV2'
import { extractErrorMessage } from '@/features/developments-v2'
import type { Lead, LeadSource } from '@/types/leads'
import { LEAD_STAGES } from '@/data/leads-mock'
import { useI18n } from "@/i18n";

const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  primary: 'Первичка',
  secondary: 'Вторичка',
  rent: 'Аренда',
  ad_campaigns: 'Реклама',
}

const NO_LEAD_VALUE = '__no_lead__'

const STATUS_LABEL: Record<BookingStatusV2, string> = {
  pending: 'В процессе',
  booked: 'Бронь',
  rejected: 'Отказ',
  expired: 'Истекла',
  paid: 'Оплачена',
}

const STATUS_COLOR: Record<BookingStatusV2, string> = {
  pending: '#fb923c',
  booked: '#c9a84c',
  rejected: '#f87171',
  expired: '#f87171',
  paid: '#a78bfa',
}

function stageName(stageId: string): string {
  return LEAD_STAGES.find(s => s.id === stageId)?.name ?? stageId
}

function LeadBookingSelect({
  value,
  onChange,
  leads,
}: {
  value: string
  onChange: (id: string) => void
  leads: Lead[]
}) {
  const { t } = useI18n();
  return (
    <Select
      value={value ? value : NO_LEAD_VALUE}
      onValueChange={v => onChange(v === NO_LEAD_VALUE ? '' : v)}
    >
      <SelectTrigger className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]">
        <SelectValue placeholder={t('bookings.bookingsPage.выберите_лида')} />
      </SelectTrigger>
      <SelectContent className="max-h-[min(320px,50vh)] border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)]">
        <SelectItem value={NO_LEAD_VALUE} className="focus:bg-[var(--dropdown-hover)]">
          {t('bookings.bookingsPage.без_лида')}</SelectItem>
        {leads.map(lead => (
          <SelectItem key={lead.id} value={lead.id} className="focus:bg-[var(--dropdown-hover)]">
            <span className="font-mono text-[11px] text-[color:var(--app-text-subtle)]">{lead.id}</span>
            {' · '}
            {lead.name ?? 'Без имени'}
            {' · '}
            {LEAD_SOURCE_LABELS[lead.source]}
            {' · '}
            {stageName(lead.stageId)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function BookingHoursField({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id: string
}) {
  const { t } = useI18n();
  const parsed = parseInt(value, 10)
  const safe = Number.isFinite(parsed) && parsed >= 1 ? Math.min(720, parsed) : 72

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={e => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 3)
            onChange(d)
          }}
          onBlur={() => {
            const x = parseInt(value, 10)
            if (!Number.isFinite(x) || x < 1) onChange('72')
            else onChange(String(Math.min(720, x)))
          }}
          className="border-[var(--green-border)] bg-[var(--green-deep)] text-center text-[color:var(--app-text)] tabular-nums max-w-[5rem]"
        />
        <span className="text-sm text-[color:var(--app-text-muted)] shrink-0">{t('bookings.bookingsPage.ч')}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {[24, 48, 72, 120, 168].map(h => (
          <button
            key={h}
            type="button"
            onClick={() => onChange(String(h))}
            className={`rounded-[var(--section-cta-radius)] border px-3 py-1.5 text-xs font-normal transition-colors ${
              safe === h
                ? 'border-[var(--gold)] bg-[var(--nav-item-bg-active)] text-[color:var(--theme-accent-heading)]'
                : 'border-[var(--green-border)] bg-transparent text-[color:var(--app-text-muted)] hover:bg-[var(--dropdown-hover)]'
            }`}
          >
            {h} {t('bookings.bookingsPage.ч')}</button>
        ))}
      </div>
    </div>
  )
}

const C = {
  gold: 'var(--gold)',
  white: 'var(--app-text)',
  whiteMid: 'var(--app-text-muted)',
  whiteLow: 'var(--app-text-subtle)',
  border: 'var(--green-border)',
  card: 'var(--green-card)',
}

function useCountdown(expiresAt: string) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    function calc() {
      const diff = new Date(expiresAt).getTime() - Date.now()
      setRemaining(Math.max(0, diff))
    }
    calc()
    const t = setInterval(calc, 1000)
    return () => clearInterval(t)
  }, [expiresAt])

  const totalHours = Math.floor(remaining / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return { totalHours, minutes, seconds, isExpired: remaining === 0 }
}

function CountdownTimer({ expiresAt, status }: { expiresAt: string; status: BookingStatusV2 }) {
  const { totalHours, minutes, seconds, isExpired } = useCountdown(expiresAt)

  if (status !== 'pending' && status !== 'booked') return null

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Clock size={12} color="rgba(255,255,255,0.72)" />
      <span style={{
        fontSize: 14, fontWeight: 400,
        color: 'rgba(255,255,255,0.72)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {isExpired ? 'Истекает' : `${totalHours}ч ${pad(minutes)}мин ${pad(seconds)}сек`}
      </span>
    </div>
  )
}

type FilterTab = 'all' | 'active' | 'closed'

interface UnitOption {
  id: string
  label: string
}

/**
 * BOOK-002/N-21: реальный флоу — только бронь юнита новостройки. "Фиксация
 * клиента" (без юнита) редиректит на client-registrations (main.tsx), у
 * реальной Booking-модели такого понятия нет. "Вторичка" убрана из демо по
 * решению владельца — у брони на сервере нет listingId, только unitId
 * (Booking завязана на Development/Building/Unit, не на @baza/property-assets).
 */
export function BookingsPage() {
  const { t } = useI18n();
  const location = useLocation()
  const isHistoryRoute = location.pathname.includes('/bookings/history')
  const { canEdit: canEditModule } = useModulePermissions()
  const canCreate = canEditModule('bookings')
  const { role } = useRolePermissions()
  const canConfirm = role !== 'administrator' && role !== 'marketer'
  const canCancel = canConfirm && role !== 'manager'
  const { state: leadsState } = useLeads()

  const [bookings, setBookings] = useState<BookingV2[]>([])
  const [unitLabels, setUnitLabels] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [tab, setTab] = useState<FilterTab>(isHistoryRoute ? 'closed' : 'all')

  const [createOpen, setCreateOpen] = useState(false)
  const [developments, setDevelopments] = useState<DevelopmentV2[]>([])
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([])
  const [devId, setDevId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [leadId, setLeadId] = useState('')
  const [hours, setHours] = useState('72')
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setTab(isHistoryRoute ? 'closed' : 'all')
  }, [isHistoryRoute])

  const leadsSorted = useMemo(() => {
    return [...leadsState.leadPool].sort((a, b) => {
      const an = (a.name ?? a.id).toLocaleLowerCase()
      const bn = (b.name ?? b.id).toLocaleLowerCase()
      return an.localeCompare(bn, 'ru')
    })
  }, [leadsState.leadPool])

  const leadsById = useMemo(() => new Map(leadsState.leadPool.map(l => [l.id, l])), [leadsState.leadPool])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const [{ items: devItems }, { items: bookingItems }] = await Promise.all([
          developmentsApiV2.list({ limit: 100 }),
          bookingsApiV2.list({ limit: 200 }),
        ])
        if (cancelled) return
        setDevelopments(devItems)

        const buildingsPerDev = await Promise.all(
          devItems.map((dev) => developmentsApiV2.listBuildings(dev._id)),
        )
        const unitsPerBuilding = await Promise.all(
          buildingsPerDev.flat().map((building) =>
            developmentsApiV2.listUnits(building._id, { limit: 500 }).then((units) => ({ building, units })),
          ),
        )
        if (cancelled) return

        const labels = new Map<string, string>()
        for (const { building, units } of unitsPerBuilding) {
          for (const unit of units) {
            labels.set(unit._id, `${building.name} · №${unit.number}`)
          }
        }
        setUnitLabels(labels)
        setBookings(bookingItems)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setLoadError(extractErrorMessage(err, 'Не удалось загрузить брони').message)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadTrigger])

  useEffect(() => {
    if (!devId) {
      setUnitOptions([])
      return
    }
    let cancelled = false
    setUnitsLoading(true)
    void (async () => {
      try {
        const buildings = await developmentsApiV2.listBuildings(devId)
        const unitsPerBuilding = await Promise.all(
          buildings.map((building) =>
            developmentsApiV2.listUnits(building._id, { status: 'available', limit: 500 }).then((units) =>
              units.map((unit) => ({ id: unit._id, label: `${building.name} · №${unit.number}` })),
            ),
          ),
        )
        if (cancelled) return
        setUnitOptions(unitsPerBuilding.flat())
        setUnitsLoading(false)
      } catch (err) {
        if (cancelled) return
        setSubmitError(extractErrorMessage(err, 'Не удалось загрузить юниты').message)
        setUnitsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [devId])

  function openCreateModal() {
    setDevId('')
    setUnitId('')
    setLeadId('')
    setHours('72')
    setSubmitError(null)
    setCreateOpen(true)
  }

  const submitBooking = useCallback(async () => {
    if (!devId || !unitId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const hoursNum = Math.max(1, Number.parseInt(hours, 10) || 72)
      const now = new Date()
      const expiresAt = new Date(now.getTime() + hoursNum * 60 * 60 * 1000).toISOString()
      const created = await bookingsApiV2.create({
        unitId,
        leadId: leadId || undefined,
        startsAt: now.toISOString(),
        expiresAt,
      })
      setBookings((prev) => [created, ...prev])
      setCreateOpen(false)
    } catch (err) {
      setSubmitError(extractErrorMessage(err, 'Не удалось создать бронь').message)
    } finally {
      setSubmitting(false)
    }
  }, [devId, unitId, leadId, hours])

  const handleConfirm = useCallback(async (bookingId: string) => {
    setPendingActionId(bookingId)
    setActionError(null)
    try {
      const updated = await bookingsApiV2.confirm(bookingId)
      setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Не удалось подтвердить бронь').message)
    } finally {
      setPendingActionId(null)
    }
  }, [])

  const handleCancel = useCallback(async (bookingId: string) => {
    setPendingActionId(bookingId)
    setActionError(null)
    try {
      const updated = await bookingsApiV2.cancel(bookingId)
      setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Не удалось отменить бронь').message)
    } finally {
      setPendingActionId(null)
    }
  }, [])

  const sortedBookings = useMemo(
    () => [...bookings].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [bookings],
  )

  const filtered = useMemo(() => {
    return sortedBookings.filter(b => {
      if (tab === 'active') return b.status === 'pending' || b.status === 'booked'
      if (tab === 'closed') return b.status === 'rejected' || b.status === 'expired' || b.status === 'paid'
      return true
    })
  }, [sortedBookings, tab])

  const activeCount = useMemo(
    () => bookings.filter(b => b.status === 'pending' || b.status === 'booked').length,
    [bookings],
  )

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'active', label: 'Активные' },
    { key: 'closed', label: 'Завершённые' },
  ]

  return (
    <DashboardShell>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '28px 24px 48px',
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 0,
        }}
      >
        <div style={{ width: '100%', maxWidth: 920, margin: '0 auto', boxSizing: 'border-box' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
              marginBottom: 8,
            }}
          >
            <div style={{ textAlign: 'left' as const, flex: '1 1 240px' }}>
              <div style={{ fontSize: 26, fontWeight: 400, color: C.white, letterSpacing: '-0.01em' }}>
                {isHistoryRoute ? 'История броней' : 'Брони квартир · новостройки'}
              </div>
              <div style={{ fontSize: 13, color: C.whiteLow, marginTop: 4, maxWidth: 560, lineHeight: 1.45 }}>
                <span style={{ color: C.gold, fontWeight: 400 }}>{activeCount}</span> {t('bookings.bookingsPage.активных')}
              </div>
            </div>
            {canCreate && (
              <button type="button" onClick={openCreateModal} className="alphabase-section-primary">
                <Building2 size={18} strokeWidth={2.25} />
                {t('bookings.bookingsPage.новостройка')}
              </button>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24, padding: '4px 0' }}>
            {TABS.map(tabDef => (
              <button
                key={tabDef.key}
                type="button"
                onClick={() => setTab(tabDef.key)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--section-cta-radius)',
                  border: `1px solid ${tab === tabDef.key ? 'var(--hub-card-border-hover)' : 'var(--hub-card-border)'}`,
                  background: tab === tabDef.key ? 'var(--nav-item-bg-active)' : 'var(--hub-card-bg)',
                  color: tab === tabDef.key ? C.gold : C.whiteLow,
                  fontSize: 12,
                  fontWeight: tab === tabDef.key ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {tabDef.label}
              </button>
            ))}
          </div>

          {loadError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', marginBottom: 16, borderRadius: 8, border: '1px solid rgba(255,180,171,0.3)', background: 'rgba(255,180,171,0.08)', color: '#ffb4ab', fontSize: 13 }}>
              <AlertCircle size={16} />
              {loadError}
              <button type="button" onClick={() => setReloadTrigger(v => v + 1)} style={{ marginLeft: 'auto', color: C.gold, fontSize: 12, cursor: 'pointer' }}>
                Повторить
              </button>
            </div>
          )}

          {actionError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', marginBottom: 16, borderRadius: 8, border: '1px solid rgba(255,180,171,0.3)', background: 'rgba(255,180,171,0.08)', color: '#ffb4ab', fontSize: 13 }}>
              {actionError}
              <button type="button" onClick={() => setActionError(null)} style={{ marginLeft: 'auto', textDecoration: 'underline', cursor: 'pointer' }}>
                Скрыть
              </button>
            </div>
          )}

          {/* Bookings cards */}
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: C.whiteLow }}>Загрузка…</div>
            )}
            {!loading && filtered.map(booking => (
              <BookingCard
                key={booking.id}
                booking={booking}
                unitLabel={unitLabels.get(booking.unitId) ?? booking.unitId}
                leadName={booking.leadId ? (leadsById.get(booking.leadId)?.name ?? booking.leadId) : undefined}
                canConfirm={canConfirm}
                canCancel={canCancel}
                busy={pendingActionId === booking.id}
                onConfirm={() => void handleConfirm(booking.id)}
                onCancel={() => void handleCancel(booking.id)}
              />
            ))}
            {!loading && filtered.length === 0 && (
              <div
                style={{
                  padding: '48px 24px',
                  textAlign: 'center' as const,
                  color: C.whiteLow,
                  border: `1px dashed ${C.border}`,
                  borderRadius: 12,
                  background: 'var(--workspace-row-bg)',
                }}
              >
                {t('bookings.bookingsPage.бронирований_не_найд')}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#f5f5f5]">Бронь квартиры · новостройка</DialogTitle>
            <DialogDescription className="text-[color:var(--app-text-muted)]">
              Сначала ЖК, затем свободная квартира. Срок брони — до 720 часов.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-[color:var(--app-text)]">{t('bookings.bookingsPage.1_жилой_комплекс')}</Label>
              <Select
                value={devId || undefined}
                onValueChange={v => { setDevId(v); setUnitId('') }}
              >
                <SelectTrigger className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)]">
                  <SelectValue placeholder={t('bookings.bookingsPage.выберите_жк')} />
                </SelectTrigger>
                <SelectContent className="border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)]">
                  {developments.map(dev => (
                    <SelectItem key={dev._id} value={dev._id} className="focus:bg-[var(--dropdown-hover)]">
                      {dev.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[color:var(--app-text)]">{t('bookings.bookingsPage.2_квартира_лот')}</Label>
              <Select
                value={unitId || undefined}
                onValueChange={setUnitId}
                disabled={!devId || unitsLoading || unitOptions.length === 0}
              >
                <SelectTrigger className="border-[var(--green-border)] bg-[var(--green-deep)] text-[color:var(--app-text)] disabled:opacity-50">
                  <SelectValue placeholder={!devId ? 'Сначала выберите ЖК' : unitsLoading ? 'Загрузка…' : unitOptions.length === 0 ? 'Свободных юнитов нет' : 'Выберите квартиру'} />
                </SelectTrigger>
                <SelectContent className="border-[var(--green-border)] bg-[var(--green-card)] text-[color:var(--app-text)]">
                  {unitOptions.map(opt => (
                    <SelectItem key={opt.id} value={opt.id} className="focus:bg-[var(--dropdown-hover)]">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[color:var(--app-text)]">{t('bookings.bookingsPage.лид_из_вашей_базы_не')}</Label>
              <LeadBookingSelect value={leadId} onChange={setLeadId} leads={leadsSorted} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-hours" className="text-[color:var(--app-text)]">{t('bookings.bookingsPage.срок_брони')}</Label>
              <BookingHoursField id="booking-hours" value={hours} onChange={setHours} />
            </div>

            {submitError && (
              <div style={{ fontSize: 13, color: '#ffb4ab' }}>{submitError}</div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="border-[var(--green-border)] bg-transparent text-[color:var(--app-text)]">
              {t('bookings.bookingsPage.отмена')}</Button>
            <Button type="button" onClick={() => void submitBooking()} disabled={!devId || !unitId || submitting} variant="sectionPrimary">
              {submitting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {t('bookings.bookingsPage.создать')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}

function BookingCard({
  booking,
  unitLabel,
  leadName,
  canConfirm,
  canCancel,
  busy,
  onConfirm,
  onCancel,
}: {
  booking: BookingV2
  unitLabel: string
  leadName?: string
  canConfirm: boolean
  canCancel: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n();
  const statusColor = STATUS_COLOR[booking.status]
  const isOpen = booking.status === 'pending' || booking.status === 'booked'

  return (
    <div style={{
      background: 'var(--green-card)',
      border: `1px solid ${isOpen ? 'rgba(201,168,76,0.2)' : 'var(--green-border)'}`,
      borderRadius: 10,
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 400,
              padding: '2px 8px',
              borderRadius: 20,
              background: `${statusColor}18`,
              border: `1px solid ${statusColor}44`,
              color: statusColor,
            }}>
              {STATUS_LABEL[booking.status]}
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 400, color: 'var(--app-text)' }}>{unitLabel}</div>
          <div style={{ fontSize: 13, color: 'var(--app-text-muted)', marginTop: 2 }}>
            {leadName ? `Лид: ${leadName}` : 'Без лида'}
          </div>
        </div>

        <div style={{ textAlign: 'right' as const }}>
          <CountdownTimer expiresAt={booking.dateRange.expiresAt} status={booking.status} />
          <div style={{ fontSize: 10, color: 'var(--app-text-subtle)', marginTop: 4 }}>
            {t('bookings.bookingsPage.истекает')}{new Date(booking.dateRange.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: 'var(--app-text-subtle)' }}>
          {booking.manager} · {new Date(booking.createdAt).toLocaleDateString('ru-RU')}
        </div>
        {isOpen && (
          <div style={{ display: 'flex', gap: 8 }}>
            {canConfirm && booking.status === 'pending' && (
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                style={{
                  padding: '5px 12px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                  borderRadius: 'var(--section-cta-radius)', color: '#4ade80', fontSize: 11, fontWeight: 400,
                  cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: busy ? 0.5 : 1,
                }}
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />} {t('bookings.bookingsPage.подтвердить')}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                style={{
                  padding: '5px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                  borderRadius: 'var(--section-cta-radius)', color: '#f87171', fontSize: 11, fontWeight: 400,
                  cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: busy ? 0.5 : 1,
                }}
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />} {t('bookings.bookingsPage.отменить')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
