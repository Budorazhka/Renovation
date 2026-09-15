import { type ReactNode, Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom'
import { DashboardProvider } from '@/context/DashboardContext'
import { LeadsProvider } from '@/context/LeadsContext'
import { DealsProvider } from '@/context/DealsContext'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { NewsFeedProvider } from '@/context/NewsFeedContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { CrmSyncProvider } from '@/features/crm/context/CrmSyncContext'
import { LanguageProvider } from '@/i18n'
import { ru as ruDictionary } from '@/i18n/dictionaries/ru'
import { en as enDictionary } from '@/i18n/dictionaries/en'
import { ka as kaDictionary } from '@/i18n/dictionaries/ka'
import { es as esDictionary } from '@/i18n/dictionaries/es'
import { tr as trDictionary } from '@/i18n/dictionaries/tr'
import { MockProvider } from '@/providers/MockProvider'
import { LoadingProvider } from '@/providers/LoadingProvider'
import App from './App'
import HomePage from '@/pages/HomePage'
import { DashboardAccessDeniedPage } from '@/pages/DashboardAccessDeniedPage'
import { OverviewGuard } from '@/components/dashboard/OverviewGuard'
import { MyReportPage } from '@/components/dashboard/MyReportPage'
import { CityPage } from '@/components/city/CityPage'
import { CityMailingsPage } from '@/components/city/CityMailingsPage'
import { SupremeOwnerDashboardPage } from '@/components/owner/SupremeOwnerDashboardPage'
import { ProductPage } from '@/components/product/ProductPage'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { LeadsPokerPage } from '@/components/leads/LeadsPokerPage'
import BuyerRequestsBoardPage from '@/pages/buyer-requests/BuyerRequestsBoardPage'
import { RuntimeErrorBoundary } from '@/components/common/RuntimeErrorBoundary'
import {
  LeadsErrorBoundary,
  DashboardErrorBoundary,
  ProductErrorBoundary,
  SettingsErrorBoundary,
} from '@/components/common/ModuleErrorBoundary'
import { RegisterPage } from '@/components/auth/RegisterPage'
import { LoginPage } from '@/components/auth/LoginPage'
import { InviteActivatePage } from '@/components/auth/InviteActivatePage'
import { LMSPage } from '@/components/lms/LMSPage'
import { MyPropertiesPage } from '@/components/management/my-properties/MyPropertiesPage'
import { ClientsListPage } from '@/components/clients/ClientsListPage'
import { DealsKanbanPage } from '@/components/deals/DealsKanbanPage'
import { DealCardPage } from '@/components/deals/DealCardPage'
import { DealsReportPage } from '@/components/deals/DealsReportPage'
import { TasksPage as TasksPageFull } from '@/components/tasks/TasksPage'
import { BookingsPage as BookingsPageFull } from '@/components/bookings/BookingsPage'
import { CalendarPage as CalendarPageFull } from '@/components/calendar/CalendarPage'
import { PartnersListPage } from '@/components/partners/PartnersListPage'
import { PartnerCardPage } from '@/components/partners/PartnerCardPage'
import { TeamOrgPage } from '@/components/team/TeamOrgPage'
import { TeamAccessPage } from '@/components/team/TeamAccessPage'
import BranchesPage from '@/components/team/BranchesPage'
import { NotificationsSettingsPage } from '@/components/settings/NotificationsSettingsPage'
import { ThemeSettingsPage } from '@/components/settings/ThemeSettingsPage'
import { AccountSettingsPage } from '@/components/settings/AccountSettingsPage'
import { TariffPage } from '@/components/settings/TariffPage'
import { NewsPage } from '@/components/info/NewsPage'
import { RemindersPage } from '@/components/info/RemindersPage'
import { ObjectsListPage } from '@/components/objects/ObjectsListPage'
import { ObjectCardPage } from '@/components/objects/ObjectCardPage'
import { CoursePage } from '@/components/lms/CoursePage'
import { LessonPage } from '@/components/lms/LessonPage'
import { TestPage } from '@/components/lms/TestPage'
import { SelectionsListPage } from '@/components/selections/SelectionsListPage'
import { SelectionCardPage } from '@/components/selections/SelectionCardPage'
import { SelectionsNewPage } from '@/components/selections/SelectionsNewPage'
import { SelectionsHubPage } from '@/components/selections/SelectionsHubPage'
import ClientsPage from '@/pages/modules/ClientsPage'
import PartnersMlmAnalyticsPage from '@/pages/modules/PartnersMlmAnalyticsPage'
import ChatsPage from '@/pages/modules/ChatsPage'
import FinanceHubPage from '@/pages/modules/FinanceHubPage'

import NewBuildingsListPage from '@/pages/modules/NewBuildingsListPage'
import InstallmentsPage from '@/pages/modules/InstallmentsPage'
import BookingsHubPage from '@/pages/modules/BookingsHubPage'
import DealsPage from '@/pages/modules/DealsPage'
import TasksHubPage from '@/pages/modules/TasksHubPage'
import CalendarPage from '@/pages/modules/CalendarPage'
import InfoPage from '@/pages/modules/InfoPage'
import SettingsHubPage from '@/pages/modules/SettingsHubPage'
import SettingsNewsMailingsHubPage from '@/pages/modules/SettingsNewsMailingsHubPage'
import NewsManagementSettingsPage from '@/pages/modules/NewsManagementSettingsPage'
import MailingsManagementSettingsPage from '@/pages/modules/MailingsManagementSettingsPage'
import RegistrationsPage from '@/components/newbuild/RegistrationsPage'
import NewBuildingsCatalogPage from '@/components/newbuild/NewBuildingsCatalogPage'
import NewBuildingsObjectsCommissionsPage from '@/components/newbuild/NewBuildingsObjectsCommissionsPage'
import NewBuildingsPartnersPage from '@/components/newbuild/NewBuildingsPartnersPage'
import PrimaryPartnersReportPage from '@/components/newbuild/PrimaryPartnersReportPage'
import NewBuildingsBookingsRegistrationsPage from '@/pages/modules/NewBuildingsBookingsRegistrationsPage'
import { CrmReportsPage } from '@/components/reports/CrmReportsPage'
import AgencyStatusesPage from '@/components/settings/AgencyStatusesPage'
import FinancePanelPage from '@/components/finance/FinancePanelPage'
import FinanceReportPage from '@/components/finance/FinanceReportPage'
import ForumHomePage from '@/components/community/forum/ForumHomePage'
import ExchangeBoardPage from '@/components/community/forum/ExchangeBoardPage'
import SectionPage from '@/components/community/forum/SectionPage'
import ThreadPage from '@/components/community/forum/ThreadPage'
import MemberProfilePage from '@/components/community/forum/MemberProfilePage'
import NewThreadPage from '@/components/community/forum/NewThreadPage'
import ObjectsReportPage from '@/components/objects/ObjectsReportPage'
import AutomationTriggersPage from '@/components/settings/AutomationTriggersPage'
import AiAutomationsPage from '@/components/settings/AiAutomationsPage'
import SystemSettingsPage from '@/components/settings/SystemSettingsPage'
import LeadSourcesPage from '@/components/leads/LeadSourcesPage'
import LeadsGeneralReportPage from '@/components/leads/LeadsGeneralReportPage'
import LeadsMarketingReportPage from '@/components/leads/LeadsMarketingReportPage'
import { ProjectsPage } from '@/pages/projects/ProjectsPage'
import { ProjectWizardV2Page } from '@/pages/projects/ProjectWizardV2Page'
import { DevelopmentManagementV2Page } from '@/pages/projects/DevelopmentManagementV2Page'
import { InteractiveChessboard } from '@/pages/inventory/InteractiveChessboard'
import FloorPlansPage from '@/pages/inventory/FloorPlansPage'

import { SalesBookingsPage } from '@/pages/development/SalesBookingsPage'
import { SalesBroadcastsPage } from '@/pages/development/SalesBroadcastsPage'
import { SalesPromotionPage } from '@/pages/development/SalesPromotionPage'
import { SalesClientRegistrationsPage } from '@/pages/development/SalesClientRegistrationsPage'
import { SelectionsDevPage } from '@/pages/development/SelectionsDevPage'
import { ClientSelectionPage } from '@/pages/public/ClientSelectionPage'
import { ClientUnitPage } from '@/pages/public/ClientUnitPage'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/600.css'
import '@fontsource/montserrat/700.css'
import 'sonner/dist/styles.css'
import './index.css'
import '@/styles/unit-visit-scrollbar.css'

function LegacySelectionCardRedirect() {
  const { selectionId } = useParams<{ selectionId: string }>()
  const to = selectionId
    ? `/dashboard/objects/selections/${selectionId}`
    : '/dashboard/objects/selections'
  return <Navigate to={to} replace />
}

function RequireAuth() {
  const { currentUser } = useAuth()
  if (!currentUser) return <Navigate to="/" replace />
  return <Outlet />
}

function EntryRoute() {
  const { currentUser } = useAuth()
  if (currentUser) return <Navigate to="/dashboard" replace />
  return <LoginPage />
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    console.error('RootErrorBoundary:', error)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "'Montserrat', sans-serif", maxWidth: 560 }}>
          <ErrorFallbackText error={this.state.error} />
        </div>
      )
    }
    return this.props.children
  }
}

// LanguageProvider оборачивает приложение внутри RootErrorBoundary, поэтому в
// аварийном экране useI18n использовать нельзя. Читаем язык из localStorage и
// достаём перевод напрямую из словарей.
function pickErrorDictionary(): any {
  try {
    const saved = localStorage.getItem('erp.language')
    if (saved === 'en') return enDictionary
    if (saved === 'ka') return kaDictionary
    if (saved === 'es') return esDictionary
    if (saved === 'tr') return trDictionary
  } catch {
    // ignore
  }
  return ruDictionary
}

function ErrorFallbackText({ error }: { error: Error }) {
  const { appLoadErrorTitle, appLoadErrorHint } = pickErrorDictionary().common
  return (
    <>
      <h2 style={{ color: '#b91c1c' }}>{appLoadErrorTitle}</h2>
      <p style={{ marginTop: 8, color: '#374151' }}>{error.message}</p>
      <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>{appLoadErrorHint}</p>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <CrmSyncProvider>
          <MockProvider>
            <LoadingProvider>
              <HashRouter>
                <ThemeProvider>
                  <LanguageProvider>
                    <DashboardProvider>
                      <LeadsProvider>
                      <DealsProvider>
                        <Routes>
                        {/* Публичные маршруты */}
                        <Route element={<Outlet />}>
                          <Route path="/" element={<EntryRoute />} />
                          <Route path="/login" element={<LoginPage />} />
                          <Route path="/register" element={<RegisterPage />} />
                          <Route path="/register/agency" element={<RegisterPage />} />
                          <Route path="/s/:token" element={<ClientSelectionPage />} />
                          <Route path="/lot/:unitId" element={<ClientUnitPage />} />
                          <Route path="/invite/:token" element={<InviteActivatePage />} />
                        </Route>

                        {/* Защищённые маршруты */}
                        <Route element={<RequireAuth />}>
                          <Route path="/analytics/*" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                          <Route path="/dashboard" element={<NewsFeedProvider><App /></NewsFeedProvider>}>
                            {/* Главный экран — наша новая HomePage */}
                            <Route index element={<DashboardErrorBoundary><HomePage /></DashboardErrorBoundary>} />
                            <Route path="access-denied" element={<DashboardAccessDeniedPage />} />

                            <Route path="development" element={<Outlet />}>
                              <Route index element={<Navigate to="projects" replace />} />
                              <Route path="projects" element={<Outlet />}>
                                <Route
                                  index
                                  element={(
                                    <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                      <ProjectsPage />
                                    </div>
                                  )}
                                />
                                <Route
                                  path="new"
                                  element={(
                                    <div className="developer-workspace flex h-full flex-col px-6 pt-0 lg:px-8 lg:pt-0">
                                      <ProjectWizardV2Page />
                                    </div>
                                  )}
                                />
                                <Route
                                  path=":id/management-v2"
                                  element={(
                                    <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                      <DevelopmentManagementV2Page />
                                    </div>
                                  )}
                                />
                                <Route
                                  path=":id/edit"
                                  element={(
                                    <div className="developer-workspace flex h-full flex-col px-6 pt-0 lg:px-8 lg:pt-0">
                                      <ProjectWizardV2Page />
                                    </div>
                                  )}
                                />
                              </Route>
                              <Route
                                path="chessboard"
                                element={(
                                  <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                    <InteractiveChessboard />
                                  </div>
                                )}
                              />
                              <Route
                                path="floorplans"
                                element={(
                                  <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                    <FloorPlansPage />
                                  </div>
                                )}
                              />
                              <Route path="management" element={<div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0"><Outlet /></div>}>
                                <Route index element={<Navigate to="bookings" replace />} />
                                <Route
                                  path="bookings"
                                  element={<SalesBookingsPage />}
                                />
                                <Route
                                  path="registrations"
                                  element={<SalesClientRegistrationsPage />}
                                />
                                <Route
                                  path="broadcasts"
                                  element={<SalesBroadcastsPage />}
                                />
                                <Route
                                  path="promotion"
                                  element={<SalesPromotionPage />}
                                />
                              </Route>
                              <Route
                                path="selections"
                                element={(
                                  <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                    <SelectionsDevPage />
                                  </div>
                                )}
                              />
                            </Route>
                            <Route path="new-buildings" element={<Outlet />}>
                              <Route index element={<NewBuildingsListPage />} />
                              <Route
                                path="objects"
                                element={<NewBuildingsObjectsCommissionsPage />}
                              />
                              <Route
                                path="bookings-registrations"
                                element={<NewBuildingsBookingsRegistrationsPage />}
                              />
                              <Route path="registration" element={<RegistrationsPage />} />
                              <Route
                                path="catalog"
                                element={<NewBuildingsCatalogPage />}
                              />
                              <Route
                                path="partners"
                                element={<NewBuildingsPartnersPage />}
                              />
                              <Route
                                path="report-partners"
                                element={<PrimaryPartnersReportPage />}
                              />
                              <Route
                                path="installments"
                                element={(
                                  <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                    <InstallmentsPage />
                                  </div>
                                )}
                              />
                              <Route
                                path="selections"
                                element={(
                                  <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                    <SelectionsDevPage />
                                  </div>
                                )}
                              />
                              <Route path="selections/list" element={<Navigate to="/dashboard/new-buildings/selections" replace />} />
                              {/* Подборки новостроек создаются из шахматки (как в Девелопменте), отдельной формы нет. */}
                              <Route path="selections/new" element={<Navigate to="/dashboard/new-buildings/chessboard?pick=1" replace />} />
                              <Route path="selections/:selectionId" element={<Navigate to="/dashboard/new-buildings/selections" replace />} />
                              <Route
                                path="chessboard"
                                element={(
                                  <div className="developer-workspace min-h-full px-6 pb-6 pt-0 lg:px-8 lg:pb-8 lg:pt-0">
                                    <InteractiveChessboard />
                                  </div>
                                )}
                              />
                            </Route>
                            <Route path="finance" element={<Outlet />}>
                              <Route index element={<FinanceHubPage />} />
                              <Route
                                path="panel"
                                element={<FinancePanelPage />}
                              />
                              <Route
                                path="report"
                                element={<FinanceReportPage />}
                              />
                            </Route>
                            <Route path="community" element={<Outlet />}>
                              <Route index element={<Navigate to="/dashboard/community/forum" replace />} />
                              <Route path="forum" element={<Outlet />}>
                                <Route index element={<ForumHomePage />} />
                                <Route path="exchange" element={<ExchangeBoardPage />} />
                                <Route path="new" element={<NewThreadPage />} />
                                <Route path="c/:sectionId" element={<SectionPage />} />
                                <Route path="t/:threadId" element={<ThreadPage />} />
                                <Route path="u/:memberId" element={<MemberProfilePage />} />
                              </Route>
                            </Route>
                            <Route path="crm" element={<Outlet />}>
                              <Route index element={<Navigate to="/dashboard/leads/poker" replace />} />
                              <Route path="classic" element={<Navigate to="/dashboard/leads/poker?view=classic" replace />} />
                              <Route path="old-leads" element={<Navigate to="/dashboard/leads/poker" replace />} />
                              <Route path="analytics" element={<CrmReportsPage />} />
                              <Route path="analytics/*" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                            </Route>
                            <Route path="clients" element={<ClientsPage />} />
                            <Route path="clients/list" element={<ClientsListPage />} />
                            <Route path="deals/kanban" element={<DealsKanbanPage />} />
                            <Route path="deals/report" element={<DealsReportPage />} />
                            <Route path="deals/:dealId" element={<DealCardPage />} />
                            <Route path="tasks/new" element={<TasksPageFull />} />
                            <Route path="tasks/my" element={<TasksPageFull />} />
                            <Route path="tasks/team" element={<TasksPageFull />} />
                            <Route path="tasks/auto" element={<TasksPageFull />} />
                            <Route path="bookings/register-client" element={<BookingsPageFull />} />
                            <Route path="bookings/register-buyer" element={<BookingsPageFull />} />
                            <Route path="bookings/client" element={<BookingsPageFull />} />
                            <Route path="bookings/apartment" element={<BookingsPageFull />} />
                            <Route path="bookings/history" element={<BookingsPageFull />} />
                            <Route path="calendar/personal" element={<CalendarPageFull />} />
                            <Route path="calendar/team" element={<CalendarPageFull />} />
                            <Route path="chats" element={<ChatsPage />} />
                            <Route path="partners" element={<Navigate to="/dashboard/partners/list" replace />} />
                            <Route path="partners/mlm" element={<PartnersMlmAnalyticsPage />} />
                            <Route path="partners/list" element={<PartnersListPage />} />
                            <Route path="partners/:partnerId" element={<PartnerCardPage />} />
                            <Route path="selections" element={<Navigate to="/dashboard/objects/selections" replace />} />
                            <Route path="selections/list" element={<Navigate to="/dashboard/objects/selections/list" replace />} />
                            <Route path="selections/new" element={<Navigate to="/dashboard/objects/selections/new" replace />} />
                            <Route path="selections/:selectionId" element={<LegacySelectionCardRedirect />} />
                            <Route path="objects" element={<Navigate to="/dashboard/objects/list" replace />} />
                            <Route path="objects/selections" element={<SelectionsHubPage market="secondary" />} />
                            <Route path="objects/selections/list" element={<SelectionsListPage />} />
                            <Route path="objects/selections/new" element={<SelectionsNewPage />} />
                            <Route path="objects/selections/:selectionId" element={<SelectionCardPage />} />
                            <Route path="objects/list" element={<ObjectsListPage />} />
                            <Route
                              path="objects/report"
                              element={<ObjectsReportPage />}
                            />
                            <Route path="objects/:propertyId" element={<ObjectCardPage />} />
                            <Route path="bookings" element={<BookingsHubPage />} />
                            <Route path="deals" element={<DealsPage />} />
                            <Route path="tasks" element={<TasksHubPage />} />
                            <Route path="calendar" element={<CalendarPage />} />
                            <Route path="team" element={<TeamOrgPage />} />
                            <Route path="team/org" element={<Navigate to="/dashboard/team" replace />} />
                            <Route path="team/branches" element={<BranchesPage />} />
                            <Route path="team/kpi" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                            <Route path="team/access" element={<TeamAccessPage />} />
                            <Route path="analytics" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                            <Route path="reports/registry" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                            <Route path="reports/manager" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                            <Route path="reports/team" element={<Navigate to="/dashboard/crm/analytics" replace />} />
                            <Route path="learning" element={<Navigate to="/dashboard/lms/browse" replace />} />
                            <Route path="lms/browse" element={<LMSPage />} />
                            <Route path="lms/add" element={<LMSPage />} />
                            <Route path="lms/course/:courseId" element={<CoursePage />} />
                            <Route path="lms/lesson/:lessonId" element={<LessonPage />} />
                            <Route path="lms/test/:lessonId" element={<TestPage />} />
                            <Route path="info" element={<Navigate to="/dashboard/settings/info" replace />} />
                            <Route path="info/news" element={<Navigate to="/dashboard/settings/info/news" replace />} />
                            <Route path="info/reminders" element={<Navigate to="/dashboard/settings/info/reminders" replace />} />
                            <Route path="settings/info" element={<InfoPage />} />
                            <Route path="settings/info/news" element={<NewsPage />} />
                            <Route path="settings/info/reminders" element={<RemindersPage />} />
                            <Route path="settings-hub" element={<SettingsHubPage />} />
                            <Route path="settings/pipeline" element={<Navigate to="/dashboard/settings-hub" replace />} />
                            <Route
                              path="settings/automation"
                              element={<AutomationTriggersPage />}
                            />
                            <Route
                              path="settings/ai-automation"
                              element={<AiAutomationsPage />}
                            />
                            <Route
                              path="settings/agency-statuses"
                              element={<AgencyStatusesPage />}
                            />
                            <Route
                              path="settings/system"
                              element={<SystemSettingsPage />}
                            />
                            <Route path="settings/notifications" element={<NotificationsSettingsPage />} />
                            <Route path="settings/theme" element={<ThemeSettingsPage />} />
                            <Route path="settings/profile" element={<AccountSettingsPage />} />
                            <Route path="settings/tariff" element={<TariffPage />} />
                            <Route path="settings/news-mailings" element={<SettingsNewsMailingsHubPage />} />
                            <Route path="settings/news-mailings/news" element={<NewsManagementSettingsPage />} />
                            <Route path="settings/news-mailings/mailings" element={<MailingsManagementSettingsPage />} />

                            {/* Рабочие страницы из agency */}
                            <Route path="overview" element={<DashboardErrorBoundary><OverviewGuard /></DashboardErrorBoundary>} />
                            <Route path="my-report" element={<MyReportPage />} />
                            <Route
                              path="leads/sources"
                              element={<LeadSourcesPage />}
                            />
                            <Route
                              path="leads/report/general"
                              element={<LeadsGeneralReportPage />}
                            />
                            <Route
                              path="leads/report/marketing"
                              element={<LeadsMarketingReportPage />}
                            />
                            <Route path="leads" element={<Navigate to="/dashboard/leads/poker" replace />} />
                            <Route path="leads/poker" element={<LeadsErrorBoundary><RuntimeErrorBoundary><LeadsPokerPage /></RuntimeErrorBoundary></LeadsErrorBoundary>} />
                            <Route path="leads/inbox" element={<Navigate to="/dashboard/leads/poker?view=list" replace />} />
                            <Route path="buyer-requests" element={<RuntimeErrorBoundary><BuyerRequestsBoardPage /></RuntimeErrorBoundary>} />
                            <Route path="leads/analytics" element={<Navigate to="/dashboard/leads/report/general" replace />} />
                            <Route path="my-properties" element={<MyPropertiesPage />} />
                            <Route path="lms" element={<Navigate to="/dashboard/lms/browse" replace />} />
                            <Route
                              path="settings/branding"
                              element={(
                                <SettingsErrorBoundary>
                                  <SettingsPage key="settings-branding" initialSection="branding" />
                                </SettingsErrorBoundary>
                              )}
                            />
                            <Route
                              path="settings/chats"
                              element={(
                                <SettingsErrorBoundary>
                                  <SettingsPage key="settings-chats" initialSection="chats" />
                                </SettingsErrorBoundary>
                              )}
                            />
                            <Route
                              path="settings"
                              element={(
                                <SettingsErrorBoundary>
                                  <SettingsPage key="settings-root" />
                                </SettingsErrorBoundary>
                              )}
                            />
                            <Route path="product" element={<ProductErrorBoundary><RuntimeErrorBoundary><ProductPage /></RuntimeErrorBoundary></ProductErrorBoundary>} />
                            <Route path="city/:cityId" element={<CityPage />} />
                            <Route path="city/:cityId/mailings" element={<CityMailingsPage />} />
                            <Route path="city/:cityId/partner" element={<RuntimeErrorBoundary><SupremeOwnerDashboardPage /></RuntimeErrorBoundary>} />
                            <Route path="city/:cityId/partner/:partnerId" element={<RuntimeErrorBoundary><SupremeOwnerDashboardPage /></RuntimeErrorBoundary>} />
                          </Route>
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                      </DealsProvider>
                      </LeadsProvider>
                    </DashboardProvider>
                  </LanguageProvider>
                </ThemeProvider>
              </HashRouter>
            </LoadingProvider>
          </MockProvider>
        </CrmSyncProvider>
      </AuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
