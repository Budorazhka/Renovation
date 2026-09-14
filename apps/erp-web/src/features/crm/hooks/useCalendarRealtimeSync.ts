import { useCallback } from 'react';
import type { CalendarEvent, UserRole } from '../services/api';
import { loadCrmCalendarEvents, monthRange } from '@/lib/calendar-v2-crm-adapter';
import { usePolling } from './usePolling';

export interface CalendarSyncOptions {
  userId?: string;
  userRole?: UserRole;
  currentDate: Date;
  onEventsUpdated?: (events: CalendarEvent[]) => void;
  onError?: (error: Error) => void;
  fallbackInterval?: number;
}

/**
 * Календарь месяца с платформы (GET /api/v1/calendar/unified) опросом:
 * push-событий календаря у apps/api нет.
 */
export const useCalendarRealtimeSync = (options: CalendarSyncOptions) => {
  const { userId, currentDate, onEventsUpdated, onError } = options;

  const loadEvents = useCallback(async (): Promise<CalendarEvent[]> => {
    if (!userId) return [];
    const { start, end } = monthRange(currentDate);
    try {
      return await loadCrmCalendarEvents(start, end);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return [];
    }
  }, [userId, currentDate, onError]);

  usePolling(() => {
    void loadEvents().then((events) => onEventsUpdated?.(events));
  }, options.fallbackInterval ?? 5000);

  return {
    mode: 'http' as const,
    isConnected: false,
    loadEvents,
  };
};
