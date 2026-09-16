import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { DeskShell, DeskHeader, DeskTab, DeskKpi, DeskHero, DeskMiniStats, DESK_HEADER_LINK_CLASS, REPORT_LINKS } from '../desk-shared'
import { getConditionState } from '@/components/management/my-properties/utils'
import { useOrganizationProperties } from '@/hooks/useOrganizationProperties'
import type { WidgetSlot } from '@/config/widgets-config'
import { useI18n } from "@/i18n";

type ObjTab = 'active' | 'demand' | 'stale'

export function WidgetObjects({ slot }: { slot: WidgetSlot }) {
    const { t } = useI18n();
  const [tab, setTab] = useState<ObjTab>('active')
  // Реестр объектов организации — тот же, что на экране «Мои объекты».
  // Раньше здесь лежали вшитые квартиры из mock-data.
  const { properties: all, status } = useOrganizationProperties()

  const active   = useMemo(() => all.filter((p) => p.status !== 'archive' && p.status !== 'sold'), [all])
  const stale    = useMemo(() => active.filter((p) => getConditionState(p.updatedAt, p.category) === 'needs_update'), [active])
  const fresh    = useMemo(() => active.filter((p) => getConditionState(p.updatedAt, p.category) === 'up_to_date'), [active])

  if (status !== 'ready') {
    return (
      <DeskShell accent="#38bdf8" className="flex flex-col">
        <DeskHeader
          icon={<Building2 className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetObjects.объекты')}
          accentColor="#38bdf8"
          layout={slot === 'big' ? undefined : 'compact'}
          right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjects.отч_т')}</Link>}
        />
        <p className="px-2.5 py-3 text-[13px] text-[color:var(--workspace-text-muted)]">
          {t(status === 'loading' ? 'dashboard.widgets.shared.loading' : 'dashboard.widgets.shared.loadFailed')}
        </p>
      </DeskShell>
    )
  }

  if (slot === 'small') {
    return (
      <DeskShell accent="#38bdf8" className="flex flex-col">
        <DeskHeader
          icon={<Building2 className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetObjects.объекты')}
          accentColor="#38bdf8"
          layout="compact"
          right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjects.отч_т')}</Link>}
        />
        <DeskHero
          label={t('dashboard.widgets.widgetObjects.активных_объектов')}
          value={String(active.length)}
          color="#38bdf8"
          pct={all.length > 0 ? (active.length / all.length) * 100 : 0}
        />
        <DeskMiniStats
          items={[
            { label: 'Актуальных', value: String(fresh.length), color: '#4ade80' },
            { label: 'Устаревших', value: String(stale.length), color: '#f87171' },
            { label: 'Всего', value: String(all.length), color: '#94a3b8' },
          ]}
        />
      </DeskShell>
    )
  }

  if (slot === 'med') {
    const recent = active.slice(0, 5)
    return (
      <DeskShell accent="#38bdf8" className="flex flex-col">
        <DeskHeader
          icon={<Building2 className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetObjects.объекты')}
          accentColor="#38bdf8"
          layout="compact"
          right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjects.отч_т')}</Link>}
        />
        <div className="grid shrink-0 grid-cols-2 gap-1.5 p-2.5 pb-1.5">
          <DeskKpi label={t('dashboard.widgets.widgetObjects.активных')} value={String(active.length)} color="#38bdf8" />
          <DeskKpi label={t('dashboard.widgets.widgetObjects.без_активности')} value={String(stale.length)} color="#f87171" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5">
          {recent.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-[color:var(--workspace-text-muted)]">{t('dashboard.widgets.widgetObjects.нет_объектов')}</p>
          ) : (
            <ul className="space-y-1">
              {recent.map((p) => {
                const isStale = getConditionState(p.updatedAt, p.category) === 'needs_update'
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-[color:var(--workspace-text)]">{p.title}</p>
                      <p className="text-[10px] text-[color:var(--workspace-text-muted)]">{p.city} · {p.type}</p>
                    </div>
                    <span className="shrink-0 rounded px-1.5 py-px text-[10px] uppercase" style={{
                      color: isStale ? '#f87171' : '#4ade80',
                      border: `1px solid ${isStale ? '#f8717155' : '#4ade8055'}`,
                    }}>
                      {isStale ? 'Устарел' : 'Актуален'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DeskShell>
    )
  }

  const displayed = tab === 'active' ? active.slice(0, 12) : tab === 'stale' ? stale.slice(0, 12) : fresh.slice(0, 12)

  return (
    <DeskShell accent="#38bdf8" className="flex flex-col">
      <DeskHeader
        icon={<Building2 className="size-5" strokeWidth={2} />}
        title={t('dashboard.widgets.widgetObjects.объекты_спрос_и_акти')}
        accentColor="#38bdf8"
        right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjects.отч_т')}</Link>}
      />
      <div className="flex shrink-0 gap-1 border-b border-[color:var(--workspace-row-border)] px-2.5 py-1.5">
        <DeskTab variant="main" active={tab === 'active'} onClick={() => setTab('active')}>{t('dashboard.widgets.widgetObjects.активные')}</DeskTab>
        <DeskTab variant="main" active={tab === 'demand'} onClick={() => setTab('demand')}>{t('dashboard.widgets.widgetObjects.с_активностью')}</DeskTab>
        <DeskTab variant="main" active={tab === 'stale'} onClick={() => setTab('stale')}>{t('dashboard.widgets.widgetObjects.без_движения')}</DeskTab>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          <DeskKpi label={t('dashboard.widgets.widgetObjects.активных')} value={String(active.length)} color="#38bdf8" />
          <DeskKpi label={t('dashboard.widgets.widgetObjects.актуальных')} value={String(fresh.length)} color="#4ade80" />
          <DeskKpi label={t('dashboard.widgets.widgetObjects.без_активности')} value={String(stale.length)} color="#f87171" />
        </div>
        {displayed.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[color:var(--workspace-text-muted)]">{t('dashboard.widgets.widgetObjects.нет_объектов')}</p>
        ) : (
          <ul className="space-y-1">
            {displayed.map((p) => {
              const isStale = getConditionState(p.updatedAt, p.category) === 'needs_update'
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--workspace-row-border)] bg-[var(--workspace-row-bg)] px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-[color:var(--workspace-text)]">{p.title}</p>
                    <p className="text-[10px] text-[color:var(--workspace-text-muted)]">{p.city} · {p.type}</p>
                  </div>
                  <span className="shrink-0 rounded px-1.5 py-px text-[10px] uppercase" style={{
                    color: isStale ? '#f87171' : '#4ade80',
                    border: `1px solid ${isStale ? '#f8717155' : '#4ade8055'}`,
                  }}>
                    {isStale ? 'Устарел' : 'Актуален'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DeskShell>
  )
}
