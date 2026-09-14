import { useMemo } from 'react';
import { useAuth as usePlatformAuth } from '@/context/AuthContext';
import type { UserRole as PlatformRole } from '@/types/auth';
import { UserRole } from '../services/api';

interface UseAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { id: string; role: UserRole } | null;
  logout: () => void;
}

// Легаси-CRM знает только четыре роли; руководящие роли платформы
// сворачиваются в ADMIN, РОП — в MANAGER, остальные — в AGENT.
function toCrmRole(role: PlatformRole): UserRole {
  if (role === 'owner' || role === 'director' || role === 'administrator') return UserRole.ADMIN;
  if (role === 'rop') return UserRole.MANAGER;
  return UserRole.AGENT;
}

/**
 * Сессия классической CRM — это платформенная сессия (httpOnly cookie,
 * AuthContext). Раньше хук жил на своём jwt_token в localStorage, который
 * выдавал вход по коду из портала api-crm.baza.sale; реальный вход его не
 * выдаёт, поэтому CRM показывала «Необходима авторизация» любому, кто вошёл
 * честно. Интерфейс сохранён, чтобы не трогать компоненты CRM.
 */
export const useAuth = (): UseAuthReturn => {
  const { currentUser, logout } = usePlatformAuth();

  const user = useMemo(
    () =>
      currentUser
        ? { id: currentUser.positionId ?? currentUser.id, role: toCrmRole(currentUser.role) }
        : null,
    [currentUser],
  );

  return {
    isAuthenticated: user !== null,
    isLoading: false,
    user,
    logout,
  };
};
