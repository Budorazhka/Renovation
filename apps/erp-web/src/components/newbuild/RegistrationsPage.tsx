import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, CheckCircle2, Clock3, ShieldCheck, UserPlus, XCircle } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useLeads } from '@/context/LeadsContext'
import { useI18n } from '@/i18n'
import {
  clientRegistrationsApi,
  newIdempotencyKey,
  type ClientRegistration,
  type ClientRegistrationStatus,
} from '@/services/clientRegistrationsApi'
import { publicDevelopmentsApi, type PublicDevelopmentCard } from '@/services/publicDevelopmentsApi'

const MUTED = 'text-[color:var(--app-text-muted)]'
const FIELD =
  'h-10 w-full rounded-sm bg-[var(--workspace-row-bg)] px-3 text-[16px] text-[color:var(--app-text)] outline-none'
const GOLD_BTN =
  'rounded-sm bg-[var(--gold)] px-3 py-1.5 text-[16px] font-medium text-[color:var(--gold-btn-text)] disabled:opacity-60'
const QUIET_BTN = `rounded-sm px-3 py-1.5 text-[16px] ${MUTED} hover:text-[color:var(--app-text)] disabled:opacity-60`

type StatusFilter = 'all' | ClientRegistrationStatus

/**
 * Фиксация клиента у застройщика — реестр агентства.
 *
 * Раньше экран работал на вшитых примерах и localStorage: заявка не уходила
 * никуда, застройщик её не видел, а «активная бронь» жила до перезагрузки
 * страницы. Теперь это серверный модуль: заявка по ЖК платформы приходит
 * застройщику в его ERP, он подтверждает или отклоняет, подтверждение
 * закрепляет клиента за агентством на шесть месяцев.
 */
export default function RegistrationsPage() {
  const { t, formatDate } = useI18n()
  const { state: leadsState } = useLeads()

  const [items, setItems] = useState<ClientRegistration[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const [target, setTarget] = useState<'platform' | 'external'>('platform')
  const [city, setCity] = useState('')
  const [catalog, setCatalog] = useState<PublicDevelopmentCard[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [developmentSlug, setDevelopmentSlug] = useState('')
  const [developerName, setDeveloperName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [leadId, setLeadId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setItems(await clientRegistrationsApi.list())
      setStatus('ready')
    } catch {
      setItems([])
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadCatalog = useCallback(async () => {
    setCatalogStatus('loading')
    try {
      setCatalog(await publicDevelopmentsApi.list({ city }))
      setCatalogStatus('idle')
    } catch {
      setCatalog([])
      setCatalogStatus('error')
    }
  }, [city])

  useEffect(() => {
    if (target === 'platform') void loadCatalog()
  }, [loadCatalog, target])

  /**
   * Отказ сервера остаётся отказом: список перечитывается, чтобы на экране не
   * осталось решение, которого нет в базе. 409 — заявку изменили в другом
   * месте, 400 — она уже в другом статусе; это разные сообщения.
   */
  const runAction = useCallback(
    async (registration: ClientRegistration, action: () => Promise<ClientRegistration>) => {
      setBusyId(registration.id)
      setActionError(null)
      try {
        const updated = await action()
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      } catch (error) {
        const code = (error as { response?: { status?: number } }).response?.status
        setActionError(
          code === 409
            ? t('registrations.conflict')
            : code === 400
              ? t('registrations.alreadyDecided')
              : t('registrations.actionFailed'),
        )
        await load()
      } finally {
        setBusyId(null)
      }
    },
    [load, t],
  )

  const submit = async () => {
    if (!clientName.trim() || !clientPhone.trim()) return
    if (target === 'platform' ? !developmentSlug : !developerName.trim() || !projectName.trim()) return
    setSaving(true)
    setActionError(null)
    try {
      const created = await clientRegistrationsApi.create(
        {
          ...(target === 'platform'
            ? { developmentSlug }
            : { developerName: developerName.trim(), projectName: projectName.trim() }),
          unitLabel: unitLabel.trim() || undefined,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          leadId: leadId || undefined,
          notes: notes.trim() || undefined,
        },
        newIdempotencyKey(),
      )
      setItems((prev) => [created, ...prev])
      setClientName('')
      setClientPhone('')
      setUnitLabel('')
      setLeadId('')
      setNotes('')
    } catch (error) {
      const code = (error as { response?: { status?: number } }).response?.status
      setActionError(code === 409 ? t('registrations.alreadyRegistered') : t('registrations.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.status === filter)),
    [filter, items],
  )

  const counts = useMemo(
    () => ({
      pending: items.filter((item) => item.status === 'pending').length,
      active: items.filter((item) => item.status === 'active' && !item.isExpired).length,
      expired: items.filter((item) => item.isExpired).length,
    }),
    [items],
  )

  const leadOptions = useMemo(() => leadsState.leadPool.slice(0, 150), [leadsState.leadPool])

  return (
    <DashboardShell>
      <div className="flex w-full max-w-[1000px] flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header>
          <h1 className="text-[30px] font-normal leading-tight text-[color:var(--theme-accent-heading)]">
            {t('registrations.title')}
          </h1>
          <p className={`mt-1 text-[17px] ${MUTED}`}>{t('registrations.subtitle')}</p>
          <p className={`mt-1 text-[16px] ${MUTED}`}>
            {t('registrations.counts', { pending: counts.pending, active: counts.active, expired: counts.expired })}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-[16px]">
            <Link to="/dashboard/new-buildings/report-partners" className="flex items-center gap-1 text-[color:var(--gold)]">
              {t('registrations.linkPartnersReport')} <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to="/dashboard/bookings" className="flex items-center gap-1 text-[color:var(--gold)]">
              {t('registrations.linkBookings')} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-md bg-[var(--hub-card-bg)] p-4">
          <h2 className="flex items-center gap-2 text-[17px]">
            <UserPlus className="size-4 text-[color:var(--gold)]" aria-hidden /> {t('registrations.newTitle')}
          </h2>

          <div className="flex flex-wrap gap-1">
            {(['platform', 'external'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTarget(key)}
                aria-pressed={target === key}
                className={`rounded-sm px-3 py-1.5 text-[16px] ${
                  target === key
                    ? 'bg-[var(--gold)] font-medium text-[color:var(--gold-btn-text)]'
                    : `${MUTED} hover:text-[color:var(--app-text)]`
                }`}
              >
                {t(`registrations.target.${key}`)}
              </button>
            ))}
          </div>

          {target === 'platform' ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder={t('registrations.cityPlaceholder')}
                aria-label={t('registrations.cityPlaceholder')}
                className={`${FIELD} sm:max-w-[220px]`}
              />
              <select
                value={developmentSlug}
                onChange={(event) => setDevelopmentSlug(event.target.value)}
                aria-label={t('registrations.developmentLabel')}
                className={FIELD}
              >
                <option value="">
                  {catalogStatus === 'loading'
                    ? t('common.loading')
                    : catalogStatus === 'error'
                      ? t('registrations.catalogFailed')
                      : catalog.length === 0
                        ? t('registrations.catalogEmpty')
                        : t('registrations.developmentPlaceholder')}
                </option>
                {catalog.map((card) => (
                  <option key={card.slug} value={card.slug}>
                    {card.name}
                    {card.publisher?.name ? ` · ${card.publisher.name}` : ''}
                    {card.location?.city ? ` · ${card.location.city}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={developerName}
                onChange={(event) => setDeveloperName(event.target.value)}
                placeholder={t('registrations.developerPlaceholder')}
                aria-label={t('registrations.developerPlaceholder')}
                className={FIELD}
              />
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder={t('registrations.projectPlaceholder')}
                aria-label={t('registrations.projectPlaceholder')}
                className={FIELD}
              />
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder={t('registrations.clientNamePlaceholder')}
              aria-label={t('registrations.clientNamePlaceholder')}
              className={FIELD}
            />
            <input
              value={clientPhone}
              onChange={(event) => setClientPhone(event.target.value)}
              placeholder={t('registrations.clientPhonePlaceholder')}
              aria-label={t('registrations.clientPhonePlaceholder')}
              className={FIELD}
            />
            <input
              value={unitLabel}
              onChange={(event) => setUnitLabel(event.target.value)}
              placeholder={t('registrations.unitPlaceholder')}
              aria-label={t('registrations.unitPlaceholder')}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={leadId}
              onChange={(event) => setLeadId(event.target.value)}
              aria-label={t('registrations.leadLabel')}
              className={FIELD}
            >
              <option value="">{t('registrations.leadNone')}</option>
              {leadOptions.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name || lead.phone || lead.id}
                </option>
              ))}
            </select>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('registrations.notesPlaceholder')}
              aria-label={t('registrations.notesPlaceholder')}
              className={FIELD}
            />
            <button type="button" onClick={() => void submit()} disabled={saving} className={GOLD_BTN}>
              {saving ? t('registrations.saving') : t('registrations.submit')}
            </button>
          </div>
          <p className={`text-[16px] ${MUTED}`}>
            {t(target === 'platform' ? 'registrations.hintPlatform' : 'registrations.hintExternal')}
          </p>
        </section>

        {actionError ? (
          <p role="alert" className="text-[17px] text-[#ffb4ab]">
            {actionError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1">
          {(['all', 'pending', 'active', 'rejected', 'completed', 'cancelled'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`rounded-sm px-3 py-1.5 text-[16px] ${
                filter === key
                  ? 'bg-[var(--gold)] font-medium text-[color:var(--gold-btn-text)]'
                  : `${MUTED} hover:text-[color:var(--app-text)]`
              }`}
            >
              {key === 'all' ? t('registrations.filterAll') : t(`registrations.status.${key}`)}
            </button>
          ))}
        </div>

        {status === 'loading' ? <p className={`text-[17px] ${MUTED}`}>{t('common.loading')}</p> : null}
        {status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[17px] text-[#ffb4ab]">
            {t('registrations.loadFailed')}
            <button type="button" onClick={() => void load()} className={GOLD_BTN}>
              {t('registrations.retry')}
            </button>
          </div>
        ) : null}
        {status === 'ready' && visible.length === 0 ? (
          <p className={`text-[17px] ${MUTED}`}>{t('registrations.empty')}</p>
        ) : null}

        <section className="flex flex-col gap-2">
          {visible.map((item) => {
            const busy = busyId === item.id
            return (
              <article key={item.id} className="flex flex-col gap-2 rounded-md bg-[var(--hub-card-bg)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[220px] flex-1">
                    <h3 className="text-[17px]">{item.clientName}</h3>
                    <p className={`text-[16px] ${MUTED}`}>{item.clientPhone}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-3 text-[16px]">
                      <span className={MUTED}>
                        <Building2 className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                        {item.developerName} · {item.projectName}
                        {item.unitLabel ? ` · ${item.unitLabel}` : ''}
                      </span>
                      <span className={statusTone(item)}>
                        {item.isExpired ? t('registrations.status.expired') : t(`registrations.status.${item.status}`)}
                      </span>
                      {item.awaitsDeveloper ? (
                        <span className={MUTED}>
                          <Clock3 className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                          {t('registrations.awaitsDeveloper')}
                        </span>
                      ) : null}
                      {item.reservedUntil ? (
                        <span className={MUTED}>
                          <ShieldCheck className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                          {t('registrations.reservedUntil', {
                            date: formatDate(item.reservedUntil, { day: 'numeric', month: 'long', year: 'numeric' }),
                          })}
                        </span>
                      ) : null}
                    </p>
                    {item.decisionNote ? (
                      <p className="mt-1 text-[16px] text-[#ffb4ab]">
                        <XCircle className="mr-1 inline size-4 align-text-bottom" aria-hidden />
                        {item.decisionNote}
                      </p>
                    ) : null}
                    {item.notes ? <p className={`mt-1 text-[16px] ${MUTED}`}>{item.notes}</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {item.status === 'pending' && !item.awaitsDeveloper ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(item, () => clientRegistrationsApi.confirmExternal(item.id, item.version))
                        }
                        className={GOLD_BTN}
                      >
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="size-4" aria-hidden /> {t('registrations.actions.confirm')}
                        </span>
                      </button>
                    ) : null}
                    {item.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runAction(item, () => clientRegistrationsApi.complete(item.id, item.version))}
                        className={GOLD_BTN}
                      >
                        {t('registrations.actions.complete')}
                      </button>
                    ) : null}
                    {item.status === 'pending' || item.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runAction(item, () => clientRegistrationsApi.cancel(item.id, item.version))}
                        className={QUIET_BTN}
                      >
                        {t('registrations.actions.cancel')}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </DashboardShell>
  )
}

function statusTone(item: ClientRegistration): string {
  if (item.isExpired || item.status === 'rejected') return 'text-[#ffb4ab]'
  if (item.status === 'active') return 'text-[color:var(--gold)]'
  return MUTED
}
