import { useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useAdminAuth } from './hooks/useAdminAuth'
import { RequireAdmin, RequireSuperAdmin } from './hooks/RequireAdmin'
import { LoginPage } from './pages/LoginPage'
import { PublicationsPage } from './pages/PublicationsPage'
import { ComplaintsPage } from './pages/ComplaintsPage'
import { DuplicateCandidatesPage } from './pages/DuplicateCandidatesPage'
import { RealtorReviewsPage } from './pages/RealtorReviewsPage'
import { AccountsPage } from './pages/AccountsPage'
import { AuditPage } from './pages/AuditPage'
import { OrganizationsPage } from './pages/OrganizationsPage'

function Shell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useAdminAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const isSuperAdmin = state.status === 'signed-in' && state.me.isSuperAdmin

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="wordmark" to="/publications">
          BAZA<span>.admin</span>
        </Link>
        {state.status === 'signed-in' ? (
          <nav className="site-nav">
            <NavLink to="/publications">Публикации</NavLink>
            <NavLink to="/organizations">Организации</NavLink>
            <NavLink to="/complaints">Жалобы</NavLink>
            <NavLink to="/duplicate-candidates">Дубликаты</NavLink>
            <NavLink to="/realtor-reviews">Отзывы</NavLink>
            <NavLink to="/audit">Журнал аудита</NavLink>
            {isSuperAdmin ? <NavLink to="/accounts">Аккаунты</NavLink> : null}
            <span className="session-role">{isSuperAdmin ? 'super_admin' : 'admin'}</span>
            <button type="button" className="secondary" onClick={() => void handleLogout()} disabled={loggingOut}>
              {loggingOut ? 'Выходим…' : 'Выйти'}
            </button>
          </nav>
        ) : null}
      </header>
      <main>{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/publications"
          element={
            <RequireAdmin>
              <PublicationsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/organizations"
          element={
            <RequireAdmin>
              <OrganizationsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/complaints"
          element={
            <RequireAdmin>
              <ComplaintsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/duplicate-candidates"
          element={
            <RequireAdmin>
              <DuplicateCandidatesPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/realtor-reviews"
          element={
            <RequireAdmin>
              <RealtorReviewsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/accounts"
          element={
            <RequireSuperAdmin>
              <AccountsPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/audit"
          element={
            <RequireAdmin>
              <AuditPage />
            </RequireAdmin>
          }
        />
        <Route path="/" element={<Navigate to="/publications" replace />} />
        <Route path="*" element={<Navigate to="/publications" replace />} />
      </Routes>
    </Shell>
  )
}
