import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  CircleDollarSign,
  Filter,
  Home,
  Loader2,
  Pencil,
  Percent,
  Plus,
  Trash2,
} from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { developmentsApiV2, type DevelopmentV2, type UnitStatusV2, type UnitV2 } from '@/services/developmentsApiV2'
import { commissionRulesApiV2, type CommissionRuleV2 } from '@/services/commissionRulesApiV2'
import { extractErrorMessage } from '@/features/developments-v2'
import { useI18n } from "@/i18n";

const UNIT_STATUS_LABEL: Record<UnitStatusV2, string> = {
  available: 'Свободен',
  reserved: 'Бронь',
  sold: 'Продан',
  hidden: 'Скрыт',
}

const FORM_SELECT_CLASS =
  "rounded-md border border-[var(--hub-card-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]"
const FORM_INPUT_CLASS =
  "rounded-md border border-[var(--workspace-row-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] px-2 py-2 text-sm text-[color:var(--workspace-text)]"

interface DevelopmentRow {
  development: DevelopmentV2
  units: UnitV2[]
  unitCount: number
  byStatus: Record<UnitStatusV2, number>
  rules: CommissionRuleV2[]
  avgPct: number
}

export default function NewBuildingsObjectsCommissionsPage() {
  const { t } = useI18n();
  const [developments, setDevelopments] = useState<DevelopmentV2[]>([])
  const [unitsByDev, setUnitsByDev] = useState<Map<string, UnitV2[]>>(new Map())
  const [rulesByDev, setRulesByDev] = useState<Map<string, CommissionRuleV2[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)

  const [city, setCity] = useState<string>('all')
  const [noRulesOnly, setNoRulesOnly] = useState(false)
  const [selectedDevId, setSelectedDevId] = useState<string | null>(null)

  const [newPartnerType, setNewPartnerType] = useState('Агентство-партнёр')
  const [newPercent, setNewPercent] = useState('2.5')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPartnerType, setEditPartnerType] = useState('')
  const [editPercent, setEditPercent] = useState('')
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    let cancelled = false
    void (async () => {
      try {
        const { items: devItems } = await developmentsApiV2.list({ limit: 100 })
        if (cancelled) return
        setDevelopments(devItems)
        if (devItems.length > 0) {
          setSelectedDevId((prev) => (prev && devItems.some((d) => d._id === prev) ? prev : devItems[0]!._id))
        }

        const [unitsEntries, rulesEntries] = await Promise.all([
          Promise.all(
            devItems.map(async (dev) => {
              const buildings = await developmentsApiV2.listBuildings(dev._id)
              const unitsPerBuilding = await Promise.all(
                buildings.map((b) => developmentsApiV2.listUnits(b._id, { limit: 500 })),
              )
              return [dev._id, unitsPerBuilding.flat()] as const
            }),
          ),
          Promise.all(
            devItems.map(async (dev) => [dev._id, await commissionRulesApiV2.list(dev._id)] as const),
          ),
        ])
        if (cancelled) return
        setUnitsByDev(new Map(unitsEntries))
        setRulesByDev(new Map(rulesEntries))
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(extractErrorMessage(err, 'Не удалось загрузить проекты и комиссии').message)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => load(), [load, reloadTrigger])

  const rows = useMemo<DevelopmentRow[]>(() => {
    return developments.map((development) => {
      const units = unitsByDev.get(development._id) ?? []
      const byStatus = units.reduce(
        (acc, u) => {
          acc[u.status] = (acc[u.status] ?? 0) + 1
          return acc
        },
        {} as Record<UnitStatusV2, number>,
      )
      const rules = rulesByDev.get(development._id) ?? []
      const avgPct =
        rules.length > 0 ? Math.round((rules.reduce((s, r) => s + r.commissionPercent, 0) / rules.length) * 10) / 10 : 0
      return { development, units, unitCount: units.length, byStatus, rules, avgPct }
    })
  }, [developments, unitsByDev, rulesByDev])

  const cityOptions = useMemo(
    () => Array.from(new Set(developments.map((d) => d.location.city))).sort(),
    [developments],
  )

  const filtered = useMemo(() => {
    let list = [...rows]
    if (city !== 'all') list = list.filter((r) => r.development.location.city === city)
    if (noRulesOnly) list = list.filter((r) => r.rules.length === 0)
    return list
  }, [city, noRulesOnly, rows])

  const selectedRow = useMemo(() => {
    if (!selectedDevId) return null
    return rows.find((r) => r.development._id === selectedDevId) ?? null
  }, [rows, selectedDevId])

  const kpi = useMemo(() => {
    const totalUnits = filtered.reduce((s, r) => s + r.unitCount, 0)
    const withRules = filtered.filter((r) => r.rules.length > 0).length
    const withRulesRows = filtered.filter((r) => r.rules.length > 0)
    const avgAcross =
      withRulesRows.length > 0
        ? Math.round((withRulesRows.reduce((s, r) => s + r.avgPct, 0) / withRulesRows.length) * 10) / 10
        : 0
    return { totalUnits, withRules, avgAcross, projects: filtered.length }
  }, [filtered])

  const missingRules = useMemo(() => rows.filter((r) => r.rules.length === 0), [rows])

  const refreshRulesFor = useCallback((developmentId: string) => {
    return commissionRulesApiV2.list(developmentId).then((rules) => {
      setRulesByDev((prev) => new Map(prev).set(developmentId, rules))
    })
  }, [])

  const addRule = useCallback(async () => {
    if (!selectedRow) return
    const pct = Number.parseFloat(newPercent.replace(',', '.'))
    if (!newPartnerType.trim() || Number.isNaN(pct) || pct < 0 || pct > 100) return
    setMutating(true)
    setMutationError(null)
    try {
      await commissionRulesApiV2.create(selectedRow.development._id, {
        partnerType: newPartnerType.trim(),
        commissionPercent: pct,
      })
      await refreshRulesFor(selectedRow.development._id)
      setNewPercent('2.5')
    } catch (err) {
      setMutationError(extractErrorMessage(err, 'Не удалось добавить правило').message)
    } finally {
      setMutating(false)
    }
  }, [newPartnerType, newPercent, selectedRow, refreshRulesFor])

  const startEdit = useCallback((r: CommissionRuleV2) => {
    setEditingId(r._id)
    setEditPartnerType(r.partnerType)
    setEditPercent(String(r.commissionPercent))
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editingId || !selectedRow) return
    const rule = selectedRow.rules.find((r) => r._id === editingId)
    if (!rule) return
    const pct = Number.parseFloat(editPercent.replace(',', '.'))
    if (!editPartnerType.trim() || Number.isNaN(pct) || pct < 0 || pct > 100) return
    setMutating(true)
    setMutationError(null)
    try {
      await commissionRulesApiV2.update(selectedRow.development._id, editingId, {
        expectedVersion: rule.version,
        partnerType: editPartnerType.trim(),
        commissionPercent: pct,
      })
      await refreshRulesFor(selectedRow.development._id)
      setEditingId(null)
    } catch (err) {
      setMutationError(extractErrorMessage(err, 'Не удалось изменить правило').message)
    } finally {
      setMutating(false)
    }
  }, [editingId, editPartnerType, editPercent, selectedRow, refreshRulesFor])

  const removeRule = useCallback(async (rule: CommissionRuleV2) => {
    if (!selectedRow) return
    setMutating(true)
    setMutationError(null)
    try {
      await commissionRulesApiV2.remove(selectedRow.development._id, rule._id, rule.version)
      await refreshRulesFor(selectedRow.development._id)
      if (editingId === rule._id) setEditingId(null)
    } catch (err) {
      setMutationError(extractErrorMessage(err, 'Не удалось удалить правило').message)
    } finally {
      setMutating(false)
    }
  }, [selectedRow, editingId, refreshRulesFor])

  return (
    <DashboardShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="w-full space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsObjectsCommissionsPage.объекты_и_комиссии')}</h1>
              <p className="mt-1 text-sm text-[color:var(--app-text-muted)]">
                {t('newbuild.newBuildingsObjectsCommissionsPage.реестр_проектов_перв')}</p>
            </div>
            <Link
              to="/dashboard/new-buildings/report-partners"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] px-3 py-2 text-sm font-normal text-[color:var(--theme-accent-heading)] hover:border-[var(--hub-card-border-hover)]"
            >
              {t('newbuild.newBuildingsObjectsCommissionsPage.отч_т_по_партн_рам_п')}</Link>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[rgba(255,180,171,0.3)] bg-[rgba(255,180,171,0.08)] px-3 py-2 text-sm text-[#ffb4ab]">
              <AlertCircle className="size-4 shrink-0" />
              {error}
              <button type="button" onClick={() => setReloadTrigger((v) => v + 1)} className="ml-auto text-[color:var(--gold)]">Повторить</button>
            </div>
          )}

          <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
            <div className="mb-3 flex items-center gap-2">
              <Filter className="size-4 text-[color:var(--gold)]" />
              <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsObjectsCommissionsPage.фильтры')}</h2>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <select value={city} onChange={(e) => setCity(e.target.value)} className={FORM_SELECT_CLASS}>
                <option value="all">Город: все</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--hub-card-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] px-2 py-2 text-sm text-[color:var(--workspace-text)] [color-scheme:dark]">
                <input
                  type="checkbox"
                  checked={noRulesOnly}
                  onChange={(e) => setNoRulesOnly(e.target.checked)}
                  className="size-4 appearance-none rounded border border-[var(--hub-card-border)] bg-[color-mix(in_srgb,var(--rail-bg)_82%,transparent)] checked:border-[var(--gold)] checked:bg-[var(--gold)]"
                />
                {t('newbuild.newBuildingsObjectsCommissionsPage.только_без_комиссион')}</label>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('newbuild.newBuildingsObjectsCommissionsPage.проектов_в_выборке')}</p>
              <p className="text-xl font-normal text-[color:var(--theme-accent-heading)]">{kpi.projects}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('newbuild.newBuildingsObjectsCommissionsPage.юнитов')}</p>
              <p className="text-xl font-normal text-emerald-400">{kpi.totalUnits}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('newbuild.newBuildingsObjectsCommissionsPage.с_правилами')}</p>
              <p className="text-xl font-normal text-[color:var(--workspace-text)]">{kpi.withRules}</p>
            </div>
            <div className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">{t('newbuild.newBuildingsObjectsCommissionsPage.ср_где_задано')}</p>
              <p className="text-xl font-normal text-amber-300">{kpi.avgAcross}%</p>
            </div>
          </section>

          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-[color:var(--app-text-muted)]">
              <Loader2 className="size-4 animate-spin" /> Загрузка…
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_minmax(300px,380px)] xl:items-start">
            <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <div className="mb-3 flex items-center gap-2">
                <Home className="size-4 text-[color:var(--gold)]" />
                <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsObjectsCommissionsPage.реестр_объектов_перв')}</h2>
              </div>
              <p className="mb-2 text-xs text-[color:var(--app-text-muted)]">{t('newbuild.newBuildingsObjectsCommissionsPage.выберите_проект_спра')}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--workspace-row-border)] text-left text-[11px] uppercase tracking-wide text-[color:var(--app-text-subtle)]">
                      <th className="px-2 py-2">{t('newbuild.newBuildingsObjectsCommissionsPage.проект')}</th>
                      <th className="px-2 py-2">{t('newbuild.newBuildingsObjectsCommissionsPage.город')}</th>
                      <th className="px-2 py-2">{t('newbuild.newBuildingsObjectsCommissionsPage.юниты')}</th>
                      <th className="px-2 py-2">{t('newbuild.newBuildingsObjectsCommissionsPage.своб_бронь')}</th>
                      <th className="px-2 py-2">{t('newbuild.newBuildingsObjectsCommissionsPage.ср')}</th>
                      <th className="px-2 py-2">{t('newbuild.newBuildingsObjectsCommissionsPage.правила')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const sel = row.development._id === selectedDevId
                      const free = row.byStatus.available ?? 0
                      const reserved = row.byStatus.reserved ?? 0
                      return (
                        <tr
                          key={row.development._id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedDevId(row.development._id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedDevId(row.development._id)
                            }
                          }}
                          className={
                            sel
                              ? 'cursor-pointer border-b border-[color:var(--workspace-row-border)] bg-[color:var(--gold)]/12'
                              : 'cursor-pointer border-b border-[color:var(--workspace-row-border)] hover:bg-[var(--workspace-row-bg)]'
                          }
                        >
                          <td className="px-2 py-2 font-medium text-[color:var(--workspace-text)]">{row.development.name}</td>
                          <td className="px-2 py-2 text-[color:var(--workspace-text-muted)]">{row.development.location.city}</td>
                          <td className="px-2 py-2">
                            <span className="inline-flex items-center gap-1 text-[color:var(--workspace-text)]">
                              <CircleDollarSign className="size-3.5 text-emerald-400" />
                              {row.unitCount}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs text-[color:var(--workspace-text-muted)]">
                            {free} / {reserved}
                          </td>
                          <td className="px-2 py-2 text-[color:var(--workspace-text)]">{row.rules.length ? `${row.avgPct}%` : '—'}</td>
                          <td className="px-2 py-2 text-[color:var(--workspace-text-muted)]">{row.rules.length} {t('newbuild.newBuildingsObjectsCommissionsPage.шт')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && <p className="mt-2 text-sm text-[color:var(--app-text-muted)]">{t('newbuild.newBuildingsObjectsCommissionsPage.нет_строк_по_фильтра')}</p>}
            </section>

            <div className="space-y-3">
              {selectedRow ? (
                <>
                  <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
                    <h2 className="mb-2 text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsObjectsCommissionsPage.карточка_объекта')}</h2>
                    <p className="text-base font-normal text-[color:var(--workspace-text)]">{selectedRow.development.name}</p>
                    <p className="mt-1 text-sm text-[color:var(--workspace-text-muted)]">{selectedRow.development.location.city}</p>
                    <p className="mt-2 text-xs text-[color:var(--app-text-subtle)]">ID: {selectedRow.development._id}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {(Object.keys(UNIT_STATUS_LABEL) as UnitStatusV2[]).map((st) => (
                        <div
                          key={st}
                          className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2 py-1.5 text-center"
                        >
                          <p className="text-[10px] uppercase text-[color:var(--app-text-subtle)]">{UNIT_STATUS_LABEL[st]}</p>
                          <p className="text-lg font-normal text-[color:var(--workspace-text)]">{selectedRow.byStatus[st] ?? 0}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Percent className="size-4 text-[color:var(--gold)]" />
                      <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsObjectsCommissionsPage.комиссионные_условия')}</h2>
                    </div>
                    {mutationError && (
                      <p className="mb-3 text-xs text-[#ffb4ab]">{mutationError}</p>
                    )}
                    <ul className="mb-3 space-y-2">
                      {selectedRow.rules.map((rule) => (
                        <li
                          key={rule._id}
                          className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] p-2"
                        >
                          {editingId === rule._id ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                              <input
                                value={editPartnerType}
                                onChange={(e) => setEditPartnerType(e.target.value)}
                                className={`flex-1 ${FORM_INPUT_CLASS}`}
                              />
                              <input
                                value={editPercent}
                                onChange={(e) => setEditPercent(e.target.value)}
                                type="text"
                                inputMode="decimal"
                                className={`w-24 shrink-0 text-right ${FORM_INPUT_CLASS}`}
                              />
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  disabled={mutating}
                                  onClick={() => void saveEdit()}
                                  className="rounded-md border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] px-2 py-1.5 text-xs font-normal text-[color:var(--workspace-text)] disabled:opacity-50"
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="rounded-md border border-[var(--hub-card-border)] px-2 py-1.5 text-xs text-[color:var(--app-text-muted)]"
                                >
                                  {t('newbuild.newBuildingsObjectsCommissionsPage.отмена')}</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-[color:var(--workspace-text)]">
                                {rule.partnerType}: <strong>{rule.commissionPercent}%</strong>
                              </span>
                              <div className="flex shrink-0 gap-1">
                                <button
                                  type="button"
                                  onClick={() => startEdit(rule)}
                                  className="rounded p-1 text-[color:var(--gold)] hover:bg-[var(--workspace-row-bg)]"
                                  aria-label={t('newbuild.newBuildingsObjectsCommissionsPage.изменить')}
                                >
                                  <Pencil className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={mutating}
                                  onClick={() => void removeRule(rule)}
                                  className="rounded p-1 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                                  aria-label={t('newbuild.newBuildingsObjectsCommissionsPage.удалить')}
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                      {selectedRow.rules.length === 0 && (
                        <li className="text-sm text-amber-300">{t('newbuild.newBuildingsObjectsCommissionsPage.нет_условий_добавьте')}</li>
                      )}
                    </ul>
                    <div className="flex flex-col gap-2 border-t border-[color:var(--workspace-row-border)] pt-3 sm:flex-row sm:items-end">
                      <input
                        value={newPartnerType}
                        onChange={(e) => setNewPartnerType(e.target.value)}
                        placeholder={t('newbuild.newBuildingsObjectsCommissionsPage.тип_партн_ра')}
                        className={`flex-1 ${FORM_INPUT_CLASS}`}
                      />
                      <input
                        value={newPercent}
                        onChange={(e) => setNewPercent(e.target.value)}
                        placeholder="%"
                        className={`w-24 shrink-0 text-right sm:w-28 ${FORM_INPUT_CLASS}`}
                      />
                      <button
                        type="button"
                        disabled={mutating}
                        onClick={() => void addRule()}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] px-3 py-2 text-sm font-normal text-[color:var(--theme-accent-heading)] disabled:opacity-50"
                      >
                        {mutating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        {t('newbuild.newBuildingsObjectsCommissionsPage.добавить')}</button>
                    </div>
                  </section>
                </>
              ) : (
                <section className="rounded-lg border border-dashed border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-6 text-center text-sm text-[color:var(--app-text-muted)]">
                  {t('newbuild.newBuildingsObjectsCommissionsPage.выберите_проект_в_ре')}</section>
              )}
            </div>
          </div>
          )}

          {!loading && missingRules.length > 0 && (
            <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-400" />
                <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsObjectsCommissionsPage.сигнал_нет_комиссион')}</h2>
              </div>
              <p className="mb-2 text-xs text-[color:var(--app-text-muted)]">{t('newbuild.newBuildingsObjectsCommissionsPage.проекты_без_настроен')}</p>
              <ul className="space-y-2">
                {missingRules.map((r) => (
                  <li
                    key={r.development._id}
                    className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2 text-sm text-[color:var(--workspace-text)]"
                  >
                    {r.development.name} · {r.development.location.city}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
