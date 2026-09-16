import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, Layers3 } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { developmentsApiV2, type BuildingV2, type DevelopmentV2, type UnitV2 } from '@/services/developmentsApiV2'
import { extractErrorMessage } from '@/features/developments-v2'
import { useI18n } from "@/i18n";

export default function NewBuildingsCatalogPage() {
  const { t } = useI18n();
  const [developments, setDevelopments] = useState<DevelopmentV2[]>([])
  const [complexId, setComplexId] = useState('')
  const [units, setUnits] = useState<UnitV2[]>([])
  const [loading, setLoading] = useState(true)
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDevelopments = useCallback(() => {
    setLoading(true)
    setError(null)
    let cancelled = false
    developmentsApiV2
      .list({ limit: 100 })
      .then(({ items }) => {
        if (cancelled) return
        setDevelopments(items)
        setComplexId((prev) => (prev && items.some((item) => item._id === prev) ? prev : items[0]?._id ?? ''))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(extractErrorMessage(err, 'Не удалось загрузить список ЖК').message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => loadDevelopments(), [loadDevelopments])

  const activeComplex = useMemo(
    () => developments.find((c) => c._id === complexId),
    [developments, complexId],
  )

  const loadUnits = useCallback((developmentId: string) => {
    if (!developmentId) {
      setUnits([])
      return () => {}
    }
    setUnitsLoading(true)
    let cancelled = false
    void (async () => {
      try {
        const buildings = await developmentsApiV2.listBuildings(developmentId)
        const unitsPerBuilding = await Promise.all(
          buildings.map((building: BuildingV2) => developmentsApiV2.listUnits(building._id, { limit: 500 })),
        )
        if (cancelled) return
        setUnits(unitsPerBuilding.flat())
        setUnitsLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(extractErrorMessage(err, 'Не удалось загрузить юниты ЖК').message)
        setUnitsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => loadUnits(complexId), [complexId, loadUnits])

  return (
    <DashboardShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <div>
            <h1 className="text-xl font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsCatalogPage.каталог_жк')}</h1>
            <p className="mt-1 text-sm text-[color:var(--app-text-muted)]">
              {t('newbuild.newBuildingsCatalogPage.проекты_новостроек_ю')}</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[rgba(255,180,171,0.3)] bg-[rgba(255,180,171,0.08)] px-3 py-2 text-sm text-[#ffb4ab]">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid min-h-[460px] grid-cols-1 gap-3 lg:grid-cols-[1.05fr_1fr]">
            <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="size-4 text-[color:var(--gold)]" />
                <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsCatalogPage.проекты')}</h2>
              </div>
              <div className="space-y-2">
                {loading && (
                  <p className="text-sm text-[color:var(--workspace-text-muted)]">Загрузка…</p>
                )}
                {!loading && developments.length === 0 && (
                  <p className="text-sm text-[color:var(--workspace-text-muted)]">Проектов пока нет.</p>
                )}
                {developments.map((complex) => (
                  <button
                    key={complex._id}
                    type="button"
                    onClick={() => setComplexId(complex._id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors hover:border-[color:var(--gold)]/35 ${
                      complex._id === complexId
                        ? 'border-[color:var(--gold)]/50 bg-[color:var(--gold)]/8'
                        : 'border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)]'
                    }`}
                  >
                    <p className="text-sm font-normal text-[color:var(--workspace-text)]">{complex.name}</p>
                    <p className="text-xs text-[color:var(--workspace-text-muted)]">{complex.location.city}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--hub-card-border)] bg-[var(--hub-card-bg)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <Layers3 className="size-4 text-[color:var(--gold)]" />
                <h2 className="text-sm font-normal text-[color:var(--theme-accent-heading)]">{t('newbuild.newBuildingsCatalogPage.юниты_проекта')}</h2>
              </div>
              {activeComplex && (
                <div className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] p-3">
                  <p className="text-sm font-normal text-[color:var(--workspace-text)]">{activeComplex.name}</p>
                  <p className="text-xs text-[color:var(--workspace-text-muted)]">{activeComplex.location.city}, {activeComplex.location.address}</p>
                </div>
              )}
              <div className="mt-2 space-y-2">
                {unitsLoading && (
                  <p className="text-sm text-[color:var(--workspace-text-muted)]">Загрузка юнитов…</p>
                )}
                {!unitsLoading && units.map((unit) => (
                  <div
                    key={unit._id}
                    className="rounded-md border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-3 py-2"
                  >
                    <p className="text-sm font-normal text-[color:var(--workspace-text)]">№{unit.number}</p>
                    <p className="text-xs text-[color:var(--workspace-text-muted)]">
                      {unit.rooms ? `${unit.rooms}-комн. · ` : ''}{unit.area} м²
                    </p>
                  </div>
                ))}
                {!unitsLoading && units.length === 0 && (
                  <p className="text-sm text-[color:var(--workspace-text-muted)]">{t('newbuild.newBuildingsCatalogPage.для_проекта_пока_нет')}</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
