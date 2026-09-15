/**
 * Экран 2 дашборда — bento-grid виджеты.
 *
 * CSS-сетка: 6 равных колонок × 2 строки.
 * Единый паттерн 1-2-4 для каждой роли:
 *   big   → colSpan 2, rowSpan 2 (2×2, самый крупный виджет — 4 ячейки)
 *   med   → colSpan 2            (2×1, средний — 2 ячейки)
 *   small → 1×1                  (компактный hero — 1 ячейка)
 */
import { ROLE_BENTO, WIDGET_META, type WidgetId, type WidgetSlot, type BentoCell } from '@/config/widgets-config'
import type { AccountType, UserRole } from '@/types/auth'
import type { Lead } from '@/types/leads'
import type { Deal } from '@/types/deals'
import type { HomeProgressMetrics } from '@/lib/plan-progress'
import { cn } from '@/lib/utils'

import { WidgetFunnel }        from './widgets/WidgetFunnel'
import { WidgetOpportunities } from './widgets/WidgetOpportunities'
import { WidgetNextActions }   from './widgets/WidgetNextActions'
import { WidgetClients }       from './widgets/WidgetClients'
import { WidgetProspectLeads } from './widgets/WidgetProspectLeads'
import { WidgetProblemLeads }  from './widgets/WidgetProblemLeads'
import { WidgetProblemDeals }  from './widgets/WidgetProblemDeals'
import { WidgetDeals }         from './widgets/WidgetDeals'
import { WidgetPlan }          from './widgets/WidgetPlan'
import { WidgetIncome }        from './widgets/WidgetIncome'
import { WidgetTeam }          from './widgets/WidgetTeam'
import { WidgetMarketing }     from './widgets/WidgetMarketing'
import { WidgetObjects }       from './widgets/WidgetObjects'
import { WidgetObjectQuality } from './widgets/WidgetObjectQuality'
import { WidgetDocuments }     from './widgets/WidgetDocuments'
import { WidgetOwnerPulse }    from './widgets/WidgetOwnerPulse'

import { WidgetDevFunnel }       from './widgets/WidgetDevFunnel'
import { WidgetDevInventory }    from './widgets/WidgetDevInventory'
import { WidgetDevPartners }     from './widgets/WidgetDevPartners'
import { WidgetDevBookings }     from './widgets/WidgetDevBookings'
import { WidgetDevMarketing }    from './widgets/WidgetDevMarketing'
import { WidgetDevSalesPlan }    from './widgets/WidgetDevSalesPlan'

import { DeskShell, DeskHeader } from './desk-shared'
import { Construction } from 'lucide-react'
import { useI18n } from "@/i18n";

interface ScreenTwoProps {
  role: UserRole
  accountType?: AccountType
  leads: Lead[]
  allLeads: Lead[]
  deals: Deal[]
  progress: HomeProgressMetrics
}

function WidgetRenderer({
  widgetId,
  slot,
  leads,
  deals,
  progress,
  className,
}: {
  widgetId: WidgetId
  slot: WidgetSlot
  leads: Lead[]
  deals: Deal[]
  progress: HomeProgressMetrics
  className?: string
}) {
    const { t } = useI18n();
  const inner = (() => {
    switch (widgetId) {
      case 'funnel':         return <WidgetFunnel leads={leads} deals={deals} slot={slot} />
      case 'opportunities':  return <WidgetOpportunities leads={leads} slot={slot} />
      case 'next_actions':   return <WidgetNextActions leads={leads} slot={slot} />
      case 'clients':        return <WidgetClients leads={leads} slot={slot} />
      case 'prospect_leads': return <WidgetProspectLeads leads={leads} slot={slot} />
      case 'problem_leads':  return <WidgetProblemLeads leads={leads} slot={slot} />
      case 'problem_deals':  return <WidgetProblemDeals deals={deals} slot={slot} />
      case 'deals':          return <WidgetDeals deals={deals} slot={slot} />
      case 'plan_result':    return <WidgetPlan progress={progress} slot={slot} />
      case 'income':         return <WidgetIncome deals={deals} slot={slot} />
      case 'team':           return <WidgetTeam leads={leads} slot={slot} />
      case 'marketing':      return <WidgetMarketing leads={leads} slot={slot} />
      case 'objects':        return <WidgetObjects slot={slot} />
      case 'object_quality': return <WidgetObjectQuality slot={slot} />
      case 'documents':      return <WidgetDocuments slot={slot} />
      case 'owner_pulse':    return <WidgetOwnerPulse leads={leads} deals={deals} progress={progress} slot={slot} />
      case 'dev_funnel':       return <WidgetDevFunnel slot={slot} />
      case 'dev_inventory':    return <WidgetDevInventory slot={slot} />
      case 'dev_partners':     return <WidgetDevPartners slot={slot} />
      case 'dev_bookings':     return <WidgetDevBookings slot={slot} />
      case 'dev_marketing':    return <WidgetDevMarketing slot={slot} />
      case 'dev_sales_plan':   return <WidgetDevSalesPlan slot={slot} />
      default: {
        const meta = WIDGET_META[widgetId as WidgetId]
        return (
          <DeskShell accent={meta?.accent ?? '#60a5fa'} className={cn('flex flex-col', className)}>
            <DeskHeader
              icon={<Construction className="size-5" strokeWidth={2} />}
              title={meta?.label ?? widgetId}
              accentColor={meta?.accent}
            />
            <div className="flex flex-1 items-center justify-center p-4 text-[13px] text-[color:var(--workspace-text-muted)]">
              {t('dashboard.screenTwo.виджет_в_разработке')}</div>
          </DeskShell>
        )
      }
    }
  })()
  return <div className={cn('min-h-0 min-w-0 [&>*]:h-full', className)}>{inner}</div>
}

function BentoGrid({
  cells,
  leads,
  deals,
  progress,
}: {
  cells: BentoCell[]
  leads: Lead[]
  deals: Deal[]
  progress: HomeProgressMetrics
}) {
  const sharedProps = { leads, deals, progress }
  const rowCount = Math.max(2, ...cells.map((cell) => cell.row + (cell.rowSpan ?? 1) - 1))

  return (
    <div
      className="grid h-full min-h-0 grid-cols-6 gap-2.5"
      style={{ gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}
    >
      {cells.map((cell) => (
        <div
          key={cell.widgetId}
          className="min-h-0 min-w-0"
          style={{
            gridColumn: cell.colSpan && cell.colSpan > 1
              ? `${cell.col} / span ${cell.colSpan}`
              : String(cell.col),
            gridRow: cell.rowSpan && cell.rowSpan > 1
              ? `${cell.row} / span ${cell.rowSpan}`
              : String(cell.row),
          }}
        >
          <WidgetRenderer
            widgetId={cell.widgetId}
            slot={cell.slot}
            {...sharedProps}
            className="h-full"
          />
        </div>
      ))}
    </div>
  )
}

export function ScreenTwo({ role, accountType, leads, allLeads: _allLeads, deals, progress }: ScreenTwoProps) {
    const { t } = useI18n();
  const cells = accountType === 'developer' ? ROLE_BENTO.developer : ROLE_BENTO[role]

  if (!cells || cells.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[14px] text-[color:var(--workspace-text-muted)]">
        {t('dashboard.screenTwo.экран_2_для_роли')}{role}{t('dashboard.screenTwo.не_настроен')}</div>
    )
  }

  return (
    <BentoGrid
      cells={cells}
      leads={leads}
      deals={deals}
      progress={progress}
    />
  )
}
