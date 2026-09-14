import { lazy, Suspense } from 'react'
import bazaLogo from '@/assets/baza-logo.png'
import '@/features/crm/styles/App.css'
import { useI18n } from "@/i18n";

const PageCrmFullDesign = lazy(() => import('@/features/crm/pages/crm/PageCrmFullDesign'))

/** Центрированный лоадер CRM: золотое кольцо крутится вокруг логотипа. */
function CrmLoader() {
    const { t } = useI18n();
  return (
    <div className="flex min-h-[78vh] w-full flex-1 items-center justify-center bg-[var(--app-bg)]">
      <div className="flex flex-col items-center gap-6">
        <img
          src={bazaLogo}
          alt="BAZA.sale"
          className="h-24 w-auto max-w-[260px] object-contain motion-safe:animate-pulse"
        />
        <div className="relative size-11">
          <span className="absolute inset-0 rounded-full border-[3px] border-[color:color-mix(in_srgb,var(--gold)_20%,transparent)]" /> {/* design-ok: кольцо-спиннер */}
          <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-[var(--gold)]" /> {/* design-ok: кольцо-спиннер */}
        </div>
        <p className="text-[16px] font-normal tracking-wide text-[color:var(--app-text-muted)]">
          {t('crm.cRMPage.загрузка_crm')}</p>
      </div>
    </div>
  )
}

/**
 * CRMPage — полноценная CRM из crm-code, встроенная в layout дашборда.
 * Рендерится ВНУТРИ текущего layout (через Outlet), без собственного BrowserRouter.
 *
 * Своей проверки авторизации здесь нет намеренно: весь /dashboard закрыт
 * платформенным RequireAuth (main.tsx), сюда доходит только вошедший
 * пользователь. Раньше поверх этого стоял второй гейт на легаси-токен
 * jwt_token из localStorage, которого реальный вход не выдаёт (сессия в
 * httpOnly cookie) — он показывал форму «вход по коду из портала» и делал
 * экран недостижимым для всех, кто вошёл честно.
 */
export default function CRMPage() {
  return (
    <div id="crm-root" className="min-w-0 max-w-full overflow-x-hidden">
      <div className="crm-app min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto">
        <Suspense fallback={<CrmLoader />}>
          <PageCrmFullDesign />
        </Suspense>
      </div>
    </div>
  )
}
