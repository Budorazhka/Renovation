import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRolePermissions } from '@/hooks/useRolePermissions'
import { useCrmView } from '@/hooks/useCrmView'
import { LeadsCardTableView } from './LeadsCardTableView'
import { CrmViewSwitcher } from './CrmViewSwitcher'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

const ClassicCRMPage = lazy(() => import('@/features/crm/CRMPage'))

/** Единая страница CRM: стол, список или классический вид — один раздел, вид выбирается переключателем. */
export function LeadsPokerPage() {
  const navigate = useNavigate()
  const { isMarketer } = useRolePermissions()
  const { t } = useI18n()
  const [selectedManagerId, setSelectedManagerId] = useState<string>('_all')
  const [view, setView] = useCrmView()

  if (isMarketer) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[var(--app-bg)] px-4 py-8">
        <div className="flex max-w-sm flex-col items-center gap-5 rounded-2xl border border-[color:var(--hub-card-border-hover)] bg-[var(--green-card)] px-10 py-12 text-center shadow-lg">
          <div className="flex size-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] text-[color:var(--gold-light)]">
            <ShieldX className="size-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-normal text-[color:var(--app-text)]">{t('crmPoker.accessDeniedTitle')}</h2>
            <p className="text-sm text-[var(--app-text-muted)]">
              {t('crmPoker.accessDeniedDescription')}
            </p>
          </div>
          <Button
            onClick={() => navigate('/dashboard')}
            className="rounded-full px-6 bg-[var(--gold)]/25 text-[color:var(--app-text)] hover:bg-[var(--gold)]/35"
          >
            {t('crmPoker.goHome')}
          </Button>
        </div>
      </div>
    )
  }

  const switcher = <CrmViewSwitcher value={view} onChange={setView} />

  if (view === 'classic') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-end px-4 py-2">{switcher}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={null}>
            <ClassicCRMPage />
          </Suspense>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <LeadsCardTableView
        variant="page"
        selectedManagerId={selectedManagerId}
        onSelectedManagerIdChange={setSelectedManagerId}
        viewMode={view}
        viewSwitcher={switcher}
      />
    </div>
  )
}
