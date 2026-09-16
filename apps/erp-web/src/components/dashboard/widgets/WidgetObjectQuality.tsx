import { Link } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { DeskShell, DeskHeader, DeskKpi, DeskHero, DeskMiniStats, DESK_HEADER_LINK_CLASS, REPORT_LINKS } from '../desk-shared'
import { useOrganizationProperties } from '@/hooks/useOrganizationProperties'
import type { Property } from '@/components/management/my-properties/types'
import type { WidgetSlot } from '@/config/widgets-config'
import { useI18n } from "@/i18n";

/** Объект неполон, если не заполнено то, без чего его нельзя показать покупателю. */
function isIncomplete(property: Property): boolean {
  return !property.area || !property.city || !property.street
}

export function WidgetObjectQuality({ slot }: { slot: WidgetSlot }) {
    const { t } = useI18n();
  // Реестр объектов организации вместо вшитого mock-data: доля «качественных»
  // считалась как 18% от списка примеров — число, не означавшее ничего.
  const { properties: all, status } = useOrganizationProperties()
  const noPhoto    = all.filter((p) => !p.photo).length
  const noPrice    = all.filter((p) => !p.price).length
  const incomplete = all.filter(isIncomplete).length
  const ok         = all.filter((p) => p.photo && p.price && !isIncomplete(p)).length
  const qualityPct = all.length > 0 ? Math.round((ok / all.length) * 100) : 0

  if (status !== 'ready') {
    return (
      <DeskShell accent="#fb7185" className="flex flex-col">
        <DeskHeader
          icon={<ClipboardCheck className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetObjectQuality.качество_базы')}
          accentColor="#fb7185"
          layout="compact"
          right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjectQuality.отч_т')}</Link>}
        />
        <p className="px-2.5 py-3 text-[13px] text-[color:var(--workspace-text-muted)]">
          {t(status === 'loading' ? 'dashboard.widgets.shared.loading' : 'dashboard.widgets.shared.loadFailed')}
        </p>
      </DeskShell>
    )
  }

  if (slot === 'small') {
    return (
      <DeskShell accent="#fb7185" className="flex flex-col">
        <DeskHeader
          icon={<ClipboardCheck className="size-4" strokeWidth={2} />}
          title={t('dashboard.widgets.widgetObjectQuality.качество_базы')}
          accentColor="#fb7185"
          layout="compact"
          right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjectQuality.отч_т')}</Link>}
        />
        <DeskHero
          label={t('dashboard.widgets.widgetObjectQuality.качественных_объекто')}
          value={String(ok)}
          sub={`/ ${all.length}`}
          color="#4ade80"
          pct={qualityPct}
        />
        <DeskMiniStats
          items={[
            { label: 'Без фото', value: String(noPhoto), color: '#f87171' },
            { label: 'Без цены', value: String(noPrice), color: '#fb923c' },
            { label: 'Неполных', value: String(incomplete), color: '#fbbf24' },
          ]}
        />
      </DeskShell>
    )
  }

  return (
    <DeskShell accent="#fb7185" className="flex flex-col">
      <DeskHeader
        icon={<ClipboardCheck className="size-5" strokeWidth={2} />}
        title={t('dashboard.widgets.widgetObjectQuality.качество_объектов')}
        accentColor="#fb7185"
        right={<Link to={REPORT_LINKS.objects} className={DESK_HEADER_LINK_CLASS}>{t('dashboard.widgets.widgetObjectQuality.отч_т')}</Link>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        <div className="grid grid-cols-2 gap-1.5">
          <DeskKpi label={t('dashboard.widgets.widgetObjectQuality.без_фото')}      value={String(noPhoto)}    color="#f87171" />
          <DeskKpi label={t('dashboard.widgets.widgetObjectQuality.без_цены')}      value={String(noPrice)}    color="#fb923c" />
          <DeskKpi label={t('dashboard.widgets.widgetObjectQuality.неполные')}      value={String(incomplete)} color="#fbbf24" />
          <DeskKpi label={t('dashboard.widgets.widgetObjectQuality.качественных')}  value={String(ok)}         color="#4ade80" pct={qualityPct} />
        </div>
      </div>
    </DeskShell>
  )
}
