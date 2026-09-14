import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { SidebarRailProvider } from '@/context/SidebarRailContext'
import { DashboardAppRail } from '@/components/layout/DashboardAppRail'
import { DashboardTopHeader } from '@/components/layout/DashboardTopHeader'
import { DashboardRouteGuard } from '@/components/layout/DashboardRouteGuard'
import { WorkspaceDeskScreenProvider } from '@/context/WorkspaceDeskScreenContext'
import { rememberDashboardRoute } from '@/lib/dashboard-route-history'
import { Toaster } from 'sonner'

export default function App() {
  const { isFeltStyle, isLightTheme } = useTheme()
  const location = useLocation()
  /** Покерный стол CRM заполняет колонку под шапкой без лишнего скролла оболочки. */
  const isPokerRoute = location.pathname === '/dashboard/leads/poker'
  const isNewBuildRegistrationsRoute = location.pathname === '/dashboard/new-buildings/registration'
  const isCrmAnalyticsRoute =
    location.pathname === '/dashboard/crm/analytics' ||
    location.pathname.startsWith('/dashboard/crm/analytics/')
  const isWizardRoute =
    location.pathname === '/dashboard/development/projects/new' ||
    /^\/dashboard\/development\/projects\/[^/]+\/edit$/.test(location.pathname)
  const isTeamRoute = location.pathname.startsWith('/dashboard/team')
  const isStretchRoute =
    isPokerRoute ||
    isNewBuildRegistrationsRoute ||
    isCrmAnalyticsRoute ||
    isWizardRoute ||
    isTeamRoute

  useEffect(() => {
    rememberDashboardRoute(location.pathname, location.search)
  }, [location.pathname, location.search])

  return (
    <SidebarRailProvider>
      <Toaster position="top-right" expand={false} richColors theme={isLightTheme ? 'light' : 'dark'} />
      <div
        className={cn(
          'flex h-screen min-h-0 min-w-[1280px] flex-row overflow-hidden bg-[var(--app-bg)] text-[color:var(--app-text)]',
          isFeltStyle ? 'app-theme-felt' : '',
        )}
      >
        <DashboardAppRail />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-bg)] p-0 text-[color:var(--app-text)]">
          <WorkspaceDeskScreenProvider>
            <DashboardTopHeader />
            <div
              className={cn(
                'relative min-h-0 flex-1 overflow-x-hidden',
                isStretchRoute ? 'flex min-h-0 flex-col overflow-hidden' : 'overflow-y-auto',
              )}
            >
              <DashboardRouteGuard />
            </div>
          </WorkspaceDeskScreenProvider>
        </main>
      </div>
    </SidebarRailProvider>
  )
}
