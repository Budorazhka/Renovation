import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth as useCrmAuth } from '../hooks/useAuth';
import type { Task } from '@/types/tasks';
import type { DashboardNotifPreview } from '@/data/home-workspace-mock';
import type { Reminder, NewsArticle } from '@/data/info-mock';
import type { CalEvent } from '@/data/calendar-events-mock';
import { calendarApiV2 } from '@/services/calendarApiV2';
import { tasksApiV2 } from '@/services/tasksApiV2';
import { mapCalendarEventV2ToLegacy, mapUnifiedTaskV2ToLegacy } from '@/lib/calendar-v2-legacy-adapter';
import { isDisplayableTaskV2, mapTaskV2ToUiTask } from '@/lib/map-task-v2';
import { teamApi } from '@/services/teamApi';

interface CrmSyncContextValue {
  tasks: Task[];
  notifications: DashboardNotifPreview[];
  reminders: Reminder[];
  news: NewsArticle[];
  calendarEvents: CalEvent[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  archiveReminder: (id: string) => Promise<void>;
}

const CrmSyncContext = createContext<CrmSyncContextValue | null>(null);

// Новостей у платформы нет — источник был только на легаси api-crm.baza.sale.
const NO_NEWS: NewsArticle[] = [];

function todayLocalDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Уведомления рабочего стола строятся из задач: просроченные и назначенные на сегодня.
function buildTaskNotifications(tasks: Task[]): DashboardNotifPreview[] {
  const today = todayLocalDate();
  const overdue = tasks.filter((t) => t.status === 'overdue');
  const dueToday = tasks.filter((t) => t.status !== 'done' && t.status !== 'overdue' && t.dueDate === today);
  return [
    ...overdue.map((t) => ({ id: `task-${t.id}`, type: 'alert' as const, title: t.title, body: t.dueDate, time: t.dueTime ?? '' })),
    ...dueToday.map((t) => ({ id: `task-${t.id}`, type: 'info' as const, title: t.title, body: t.dueDate, time: t.dueTime ?? '' })),
  ];
}

export function CrmSyncProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useCrmAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<DashboardNotifPreview[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    try {
      const today = new Date();
      // Широкий диапазон (3 месяца), чтобы календарь листался без дозагрузки.
      const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0);

      // Каждый источник ловит свою ошибку: раньше один упавший запрос ронял
      // весь Promise.all и календарь с напоминаниями оставались пустыми.
      // Ростер команды нужен только для имён по positionId — CrmSyncProvider
      // смонтирован снаружи LeadsProvider и его ростер не видит.
      const [tasksRes, calendarRes, teamRoster] = await Promise.all([
        tasksApiV2.listAll().catch((error: unknown) => {
          console.error('[CrmSyncContext] Tasks sync failed:', error);
          return null;
        }),
        calendarApiV2
          .getUnified({ startDate: startDate.toISOString(), endDate: endDate.toISOString() })
          .catch((error: unknown) => {
            console.error('[CrmSyncContext] Calendar sync failed:', error);
            return null;
          }),
        teamApi.list().catch(() => []),
      ]);

      const agentNameById = new Map<string, string>();
      for (const member of teamRoster) {
        if (member.vacant) continue;
        agentNameById.set(member.positionId ?? member.id, member.name || member.position || 'Без имени');
      }

      if (tasksRes) {
        const uiTasks = tasksRes.items.filter(isDisplayableTaskV2).map((t) => mapTaskV2ToUiTask(t, agentNameById));
        setTasks(uiTasks);
        setNotifications(buildTaskNotifications(uiTasks));
      }

      if (calendarRes) {
        const mappedEvents = calendarRes.events.map((e) => mapCalendarEventV2ToLegacy(e, agentNameById));
        const mappedTasks = calendarRes.tasks
          .map((t) => mapUnifiedTaskV2ToLegacy(t, agentNameById))
          .filter((e): e is CalEvent => e !== null);
        setCalendarEvents([...mappedEvents, ...mappedTasks]);

        // Напоминания берутся из сырых событий type:'reminder' до перевода в
        // легаси-типы: там 'reminder' схлопывается в 'call' и отличить его уже нельзя.
        setReminders(calendarRes.events
          .filter((e) => e.type === 'reminder')
          .map((e) => ({
            id: e.id,
            title: e.title,
            body: e.description ?? undefined,
            dueAt: e.startTime,
            done: false,
            priority: 'medium' as const,
            // Событие календаря не ссылается на задачу — названия задачи здесь нет.
            entityLabel: 'Задача',
          }))
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchData();
    // Реального времени у платформы нет — полное обновление раз в 5 минут.
    const interval = setInterval(() => void fetchData(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchData]);

  // Уведомления и напоминания производные (из задач и календаря), серверного
  // флага «прочитано» у них нет — скрываются до следующей синхронизации.
  const markNotificationRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const archiveReminder = useCallback(async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const value = useMemo(() => ({
    tasks,
    notifications,
    reminders,
    news: NO_NEWS,
    calendarEvents,
    isLoading,
    refresh: fetchData,
    markNotificationRead,
    archiveReminder,
  }), [tasks, notifications, reminders, calendarEvents, isLoading, fetchData, markNotificationRead, archiveReminder]);

  return (
    <CrmSyncContext.Provider value={value}>
      {children}
    </CrmSyncContext.Provider>
  );
}

export function useCrmSync() {
  const ctx = useContext(CrmSyncContext);
  if (!ctx) throw new Error('useCrmSync must be used within CrmSyncProvider');
  return ctx;
}
