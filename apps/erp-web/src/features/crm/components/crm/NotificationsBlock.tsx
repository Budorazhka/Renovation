import { useI18n } from '@/i18n';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import NotificationsViewModal from './NotificationsViewModal';
import TasksGridModal from './modals/TasksGridModal';
import { apiService, NotificationType, type Task, EventType, TaskStatus, TaskPriority } from '../../services/api';
import { listCrmTasks, setCrmTaskStatus } from '../../services/crmTasksV2';
import { tasksApiV2 } from '@/services/tasksApiV2';
import { loadCrmCalendarEvents } from '@/lib/calendar-v2-crm-adapter';
import type { Notification, NotificationAttachment } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { useDisableScroll } from '../../hooks/useDisableScroll';

interface NotificationsBlockProps {
  onOpenTaskView?: (taskId: string) => void;
}

interface OptimizationSuggestion {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'suggestion';
  createdAt: Date;
  taskIds?: string[];
}

const NotificationsBlock: React.FC<NotificationsBlockProps> = ({ onOpenTaskView }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'notifications' | 'reminders' | 'news'>(() => {
    const tab = searchParams.get('notificationsTab') as 'notifications' | 'reminders' | 'news' | null;
    return tab || 'notifications';
  });
  const [isNotificationsBlockCollapsed, setIsNotificationsBlockCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(() => {
    return searchParams.get('modal') === 'notifications';
  });
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [remindersFromCalendar, setRemindersFromCalendar] = useState<Array<{ id: string; title: string; message: string; date: Date; taskId?: string }>>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isTasksGridModalOpen, setIsTasksGridModalOpen] = useState(false);
  const [tasksForModal, setTasksForModal] = useState<Task[]>([]);
  const [tasksGridModalTitle, setTasksGridModalTitle] = useState(t('notificationsBlock.tasks'));
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Notification | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  // Версии задач модалки — для оптимистичной блокировки PATCH /tasks/:id.
  const taskVersionsRef = useRef<Map<string, number>>(new Map());

  const truncateMessage = (message: string, maxLength: number = 50): string => {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };

  // Функция нормализации taskId - извлекает строку из объекта или возвращает строку
  const normalizeTaskId = (taskId: string | { _id?: string } | undefined): string | null => {
    if (!taskId) return null;
    if (typeof taskId === 'string') return taskId;
    if (typeof taskId === 'object' && taskId._id) return taskId._id;
    return null;
  };

  // Хелперы для вложений
  const getImageAttachments = (notif: Notification | null): NotificationAttachment[] => {
    if (!notif?.attachments) return [];
    return notif.attachments.filter((a) => (a?.mimeType || '').startsWith('image/') && a.url);
  };
  const getVideoAttachments = (notif: Notification | null): NotificationAttachment[] => {
    if (!notif?.attachments) return [];
    return notif.attachments.filter((a) => (a?.mimeType || '').startsWith('video/') && a.url);
  };
  const getOtherAttachments = (notif: Notification | null): NotificationAttachment[] => {
    if (!notif?.attachments) return [];
    return notif.attachments.filter((a) => {
      const m = a?.mimeType || '';
      return !m.startsWith('image/') && !m.startsWith('video/') && a.url;
    });
  };
  const decodeFilename = (name?: string): string => {
    if (!name) return '';
    try {
      return decodeURIComponent(escape(name)) || name;
    } catch {
      return name;
    }
  };
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  useDisableScroll(isTasksGridModalOpen || isDetailModalOpen);

  // Обновлять индекс при смене выбранного уведомления
  useEffect(() => {
    setImageIndex(0);
  }, [selectedItem?._id]);

  // ...existing code...

  const openDetails = async (item: Notification) => {
    // Если это напоминание с taskId, сразу открываем задачу
    if (item.type === NotificationType.REMINDER && item.taskId && onOpenTaskView) {
      try {
        const normalizedTaskId = normalizeTaskId(item.taskId);
        if (!normalizedTaskId) {
          console.error('Invalid taskId:', item.taskId);
          return;
        }
        await onOpenTaskView(normalizedTaskId);
        // Помечаем как прочитанное
        if (!item.isRead) {
          try {
            await apiService.markNotificationRead(item._id, true);
            setItems(prev => prev.map(n => n._id === item._id ? { ...n, isRead: true } : n));
          } catch (error) {
            console.error('Failed to mark reminder as read:', error);
          }
        }
        return;
      } catch (error) {
        console.error('Failed to open task:', error);
      }
    }
    
    setDetailLoading(true);
    try {
      // Если у уведомления есть taskIds в metadata, открываем модалку с задачами
      if (item.metadata?.taskIds && Array.isArray(item.metadata.taskIds) && item.metadata.taskIds.length > 0) {
        // Если title начинается с "Планы на", используем его, иначе форматируем дату
        const title = item.title || (() => {
          const now = new Date();
          const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
          return t('notificationsBlock.plansFor', { date: dateStr });
        })();
        await openTasksModal(item.metadata.taskIds, title);
        // Помечаем как прочитанное после открытия задач
        if (!item.isRead) {
          try {
            await apiService.markNotificationRead(item._id, true);
            setItems(prev => prev.map(n => n._id === item._id ? { ...n, isRead: true } : n));
          } catch {}
        }
      } else {
        // Для обычных уведомлений открываем детальную модалку
        let full: Notification | null = null;
        try {
          const res = await apiService.getNotification(item._id);
          if (res.success && res.data) full = res.data;
        } catch (e) {
          full = item;
        }
        const next = full || item;
        setSelectedItem(next);
        setIsDetailModalOpen(true);
        // Помечаем как прочитанное
        if (!next.isRead) {
          try {
            await apiService.markNotificationRead(next._id, true);
            setItems(prev => prev.map(n => n._id === next._id ? { ...n, isRead: true } : n));
          } catch {}
        }
      }
    } finally {
      setDetailLoading(false);
    }
  };

  // Функция открытия модалки с задачами по ID
  const openTasksModal = useCallback(async (taskIds: string[] | undefined, suggestionTitle: string) => {
    if (!taskIds || taskIds.length === 0) {
      return;
    }

    try {
      const { tasks, versions } = await listCrmTasks(userId);
      taskVersionsRef.current = versions;
      setTasksForModal(tasks.filter(t => taskIds.includes(t._id)));
      setTasksGridModalTitle(suggestionTitle);
      setIsTasksGridModalOpen(true);
    } catch (error) {
      console.error('Failed to load tasks for modal:', error);
    }
  }, [userId]);

  const listFilter = useMemo(() => {
    if (activeTab === 'reminders') return { type: NotificationType.REMINDER as const };
    if (activeTab === 'news') return { type: NotificationType.NEWS as const };
    return {} as { type?: NotificationType };
  }, [activeTab]);

  // Функция анализа планов на сегодня
  const analyzeTodayPlansData = useCallback(async (): Promise<OptimizationSuggestion[]> => {
    if (!userId) return [];

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { tasks } = await listCrmTasks(userId);

      const suggestions: OptimizationSuggestion[] = [];
      const now = new Date();

      {
        const todayTasks = tasks.filter(task => {
          if (!task.startDate && !task.endDate) return false;
          const taskDate = task.startDate ? new Date(task.startDate) : new Date(task.endDate!);
          return taskDate >= today && taskDate < tomorrow;
        });

        const activeTasks = todayTasks.filter(t => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED);
        const urgentAndImportantTasks = activeTasks.filter(t => t.priority === TaskPriority.URGENT_IMPORTANT);

        // Только одно предложение "Планы на сегодня" с информацией о задачах
        if (activeTasks.length > 0) {
          // Форматируем дату в формат DD.MM.YYYY
          const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
          suggestions.push({
            id: 'today-plans',
            title: t('notificationsBlock.plansFor', { date: dateStr }),
            message: `${t('notificationsBlock.tasksCount', { count: activeTasks.length })}\n${t('notificationsBlock.urgentImportantCount', { count: urgentAndImportantTasks.length })}`,
            type: 'info',
            createdAt: now,
            taskIds: activeTasks.map(t => t._id),
          });
        }
      }

      return suggestions;
    } catch (error) {
      console.error('Failed to analyze today plans:', error);
      return [];
    }
  }, [userId, t]);

  // Анализ планов на сегодня и генерация предложений по оптимизации
  const analyzeTodayPlans = useCallback(async () => {
    const suggestions = await analyzeTodayPlansData();
    setOptimizationSuggestions(suggestions);
  }, [analyzeTodayPlansData]);

  // Автообновление анализа планов раз в 30 секунд
  useAutoRefresh({
    fetchData: analyzeTodayPlansData,
    onDataUpdate: (newSuggestions) => {
      setOptimizationSuggestions(newSuggestions);
    },
    compareFn: (oldSuggestions, newSuggestions) => {
      if (oldSuggestions.length !== newSuggestions.length) return false;
      return oldSuggestions.every((old, index) => {
        const newSuggestion = newSuggestions[index];
        return old.id === newSuggestion.id && 
               old.title === newSuggestion.title && 
               old.message === newSuggestion.message &&
               old.type === newSuggestion.type &&
               JSON.stringify(old.taskIds) === JSON.stringify(newSuggestion.taskIds);
      });
    },
    interval: 30000,
    enabled: activeTab === 'notifications' && !!user?.id,
  });

  // Форматирование времени для отображения
  const formatTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('notificationsBlock.justNow');
    if (diffMins < 60) return t('notificationsBlock.minsAgo', { count: diffMins });
    if (diffHours < 24) return t('notificationsBlock.hoursAgo', { count: diffHours });
    if (diffDays === 1) return t('notificationsBlock.yesterday');
    if (diffDays < 7) return t('notificationsBlock.daysAgo', { count: diffDays });
    
    return date.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'short',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
    });
  };

  // Форматирование времени до напоминания (через сколько случится)
  const formatTimeUntilReminder = (reminderDate: Date): string => {
    const now = new Date();
    const diffMs = reminderDate.getTime() - now.getTime();
    
    if (diffMs < 0) return t('notificationsBlock.alreadyPassed');
    
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('notificationsBlock.rightNow');
    if (diffMins < 60) {
      const lastDigit = diffMins % 10;
      const lastTwoDigits = diffMins % 100;
      if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return t('notificationsBlock.inMins', { count: diffMins });
      }
      if (lastDigit === 1) {
        return t('notificationsBlock.inMin', { count: diffMins });
      }
      if (lastDigit >= 2 && lastDigit <= 4) {
        return t('notificationsBlock.inMins2', { count: diffMins });
      }
      return t('notificationsBlock.inMins', { count: diffMins });
    }
    if (diffHours < 24) {
      const lastDigit = diffHours % 10;
      const lastTwoDigits = diffHours % 100;
      if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return t('notificationsBlock.inHours', { count: diffHours });
      }
      if (lastDigit === 1) {
        return t('notificationsBlock.inHour', { count: diffHours });
      }
      if (lastDigit >= 2 && lastDigit <= 4) {
        return t('notificationsBlock.inHours2', { count: diffHours });
      }
      return t('notificationsBlock.inHours', { count: diffHours });
    }
    if (diffDays < 7) {
      const lastDigit = diffDays % 10;
      const lastTwoDigits = diffDays % 100;
      if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return t('notificationsBlock.inDays', { count: diffDays });
      }
      if (lastDigit === 1) {
        return t('notificationsBlock.inDay', { count: diffDays });
      }
      if (lastDigit >= 2 && lastDigit <= 4) {
        return t('notificationsBlock.inDays2', { count: diffDays });
      }
      return t('notificationsBlock.inDays', { count: diffDays });
    }
    const weeks = Math.floor(diffDays / 7);
    const lastDigit = weeks % 10;
    const lastTwoDigits = weeks % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
      return t('notificationsBlock.inWeeks', { count: weeks });
    }
    if (lastDigit === 1) {
      return t('notificationsBlock.inWeek', { count: weeks });
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
      return t('notificationsBlock.inWeeks2', { count: weeks });
    }
    return t('notificationsBlock.inWeeks', { count: weeks });
  };

  // Функция загрузки напоминаний
  const loadRemindersData = useCallback(async (): Promise<Array<{ id: string; title: string; message: string; date: Date; taskId?: string }>> => {
    if (!userId) return [];

    try {
      const now = new Date();
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + 7); // Напоминания на неделю вперед

      // Напоминания — события календаря платформы типа reminder. Событие не
      // ссылается на задачу (разные сущности), поэтому taskId у них нет.
      const events = await loadCrmCalendarEvents(now, futureDate);
      const reminders: Array<{ id: string; title: string; message: string; date: Date; taskId?: string }> = events
        .filter(event => event.type === EventType.REMINDER)
        .map(event => ({
          id: `reminder_${event._id}`,
          title: event.title,
          message: event.description || t('notificationsBlock.reminderTitle', { title: event.title }),
          date: new Date(event.startTime),
        }));

      // Сортируем по дате
      reminders.sort((a, b) => a.date.getTime() - b.date.getTime());
      return reminders;
    } catch (error) {
      console.error('Failed to load reminders:', error);
      return [];
    }
  }, [userId, t]);

  // Загрузка напоминаний из календаря и задач
  const loadReminders = useCallback(async () => {
    const reminders = await loadRemindersData();
    setRemindersFromCalendar(reminders);
  }, [loadRemindersData]);

  // Автообновление напоминаний раз в 30 секунд
  useAutoRefresh({
    fetchData: loadRemindersData,
    onDataUpdate: (newReminders) => {
      setRemindersFromCalendar(newReminders);
    },
    compareFn: (oldReminders, newReminders) => {
      if (oldReminders.length !== newReminders.length) return false;
      return oldReminders.every((old, index) => {
        const newReminder = newReminders[index];
        return old.id === newReminder.id && 
               old.title === newReminder.title && 
               old.message === newReminder.message &&
               old.date.getTime() === newReminder.date.getTime() &&
               old.taskId === newReminder.taskId;
      });
    },
    interval: 30000,
    enabled: activeTab === 'reminders' && !!user?.id,
  });

  // Серверных уведомлений (новости, системные, запросы) у платформы нет —
  // источник был только на легаси api-crm.baza.sale. Вкладка «Уведомления»
  // показывает «Планы на сегодня», вкладка «Напоминания» — календарь.
  const loadNotifications = useCallback(async (): Promise<Notification[]> => [], []);

  useEffect(() => {
    // Первая загрузка с индикатором загрузки
    setLoading(true);
    loadNotifications().then(loadedItems => {
      setItems(loadedItems);
      setLoading(false);
    });
    
    // Анализируем планы на сегодня для вкладки уведомлений
    if (activeTab === 'notifications') {
      analyzeTodayPlans();
    }
    
    // Загружаем напоминания из календаря и задач
    if (activeTab === 'reminders') {
      loadReminders();
    }
  }, [activeTab, listFilter, analyzeTodayPlans, loadReminders, loadNotifications]);

  return (
    <>
      {isNotificationsBlockCollapsed && (
        <button
          type="button"
          onClick={() => setIsNotificationsBlockCollapsed(false)}
          className="w-full md:hidden flex items-center justify-between border border-[var(--border)] bg-[var(--card)] rounded-[6px] p-5 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.0547 10.268V8.39844C16.0547 5.67102 14.2418 3.35934 11.7579 2.6043V1.75781C11.7579 0.788555 10.9693 0 10 0C9.03079 0 8.24223 0.788555 8.24223 1.75781V2.6043C5.75825 3.35934 3.94536 5.67098 3.94536 8.39844V10.268C3.94536 12.6638 3.03216 14.9355 1.37399 16.6648C1.21149 16.8342 1.16583 17.0843 1.25794 17.3002C1.35005 17.5161 1.56216 17.6562 1.79692 17.6562H7.1293C7.40149 18.9919 8.58524 20 10 20C11.4149 20 12.5986 18.9919 12.8708 17.6562H18.2032C18.4379 17.6562 18.65 17.5161 18.7421 17.3002C18.8342 17.0843 18.7886 16.8342 18.6261 16.6648C16.9679 14.9355 16.0547 12.6638 16.0547 10.268ZM9.41411 1.75781C9.41411 1.43473 9.67696 1.17188 10 1.17188C10.3231 1.17188 10.586 1.43473 10.586 1.75781V2.37219C10.3931 2.35359 10.1977 2.34375 10 2.34375C9.80239 2.34375 9.60696 2.35359 9.41411 2.37219V1.75781ZM10 18.8281C9.23618 18.8281 8.58489 18.3382 8.34301 17.6562H11.6571C11.4152 18.3382 10.7639 18.8281 10 18.8281ZM3.05981 16.4844C4.39423 14.6956 5.11723 12.5309 5.11723 10.268V8.39844C5.11723 5.70605 7.30766 3.51562 10 3.51562C12.6924 3.51562 14.8829 5.70605 14.8829 8.39844V10.268C14.8829 12.5309 15.6059 14.6956 16.9403 16.4844H3.05981Z" fill="#169600"/>
              <path d="M17.6175 8.39817C17.6175 8.72176 17.8798 8.98411 18.2034 8.98411C18.527 8.98411 18.7894 8.72176 18.7894 8.39817C18.7894 6.05051 17.8751 3.84336 16.2151 2.18333C15.9863 1.95454 15.6153 1.9545 15.3865 2.18333C15.1576 2.41215 15.1576 2.78313 15.3865 3.01196C16.8252 4.45067 17.6175 6.36352 17.6175 8.39817Z" fill="#169600"/>
              <path d="M1.79688 8.98408C2.12047 8.98408 2.38281 8.72174 2.38281 8.39814C2.38281 6.36353 3.17516 4.45068 4.61383 3.01197C4.84266 2.78314 4.84266 2.41217 4.61383 2.18334C4.38504 1.95451 4.01402 1.95451 3.7852 2.18334C2.12516 3.84338 1.21094 6.05049 1.21094 8.39814C1.21094 8.72174 1.47328 8.98408 1.79688 8.98408Z" fill="#169600"/>
            </svg>
            <span>{t('notificationsBlock.notificationsTab')}</span>
          </div>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="transition-transform duration-300 ease-in-out rotate-180"
          >
            <path d="M12.0007 10.8273L7.05072 15.7773L5.63672 14.3633L12.0007 7.99935L18.3647 14.3633L16.9507 15.7773L12.0007 10.8273Z" fill="#169600"/>
          </svg>
        </button>
      )}
      <div className={`border border-[var(--border)] bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.10)] flex flex-col flex-1 rounded-[6px] p-5 pb-5 h-81 md:min-w-80 md:max-w-md overflow-hidden ${isNotificationsBlockCollapsed ? 'hidden md:flex' : 'flex'}`}>
        <button
          type="button"
          onClick={() => setIsNotificationsBlockCollapsed(!isNotificationsBlockCollapsed)}
          className="w-full md:hidden flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.0547 10.268V8.39844C16.0547 5.67102 14.2418 3.35934 11.7579 2.6043V1.75781C11.7579 0.788555 10.9693 0 10 0C9.03079 0 8.24223 0.788555 8.24223 1.75781V2.6043C5.75825 3.35934 3.94536 5.67098 3.94536 8.39844V10.268C3.94536 12.6638 3.03216 14.9355 1.37399 16.6648C1.21149 16.8342 1.16583 17.0843 1.25794 17.3002C1.35005 17.5161 1.56216 17.6562 1.79692 17.6562H7.1293C7.40149 18.9919 8.58524 20 10 20C11.4149 20 12.5986 18.9919 12.8708 17.6562H18.2032C18.4379 17.6562 18.65 17.5161 18.7421 17.3002C18.8342 17.0843 18.7886 16.8342 18.6261 16.6648C16.9679 14.9355 16.0547 12.6638 16.0547 10.268ZM9.41411 1.75781C9.41411 1.43473 9.67696 1.17188 10 1.17188C10.3231 1.17188 10.586 1.43473 10.586 1.75781V2.37219C10.3931 2.35359 10.1977 2.34375 10 2.34375C9.80239 2.34375 9.60696 2.35359 9.41411 2.37219V1.75781ZM10 18.8281C9.23618 18.8281 8.58489 18.3382 8.34301 17.6562H11.6571C11.4152 18.3382 10.7639 18.8281 10 18.8281ZM3.05981 16.4844C4.39423 14.6956 5.11723 12.5309 5.11723 10.268V8.39844C5.11723 5.70605 7.30766 3.51562 10 3.51562C12.6924 3.51562 14.8829 5.70605 14.8829 8.39844V10.268C14.8829 12.5309 15.6059 14.6956 16.9403 16.4844H3.05981Z" fill="#169600"/>
              <path d="M17.6175 8.39817C17.6175 8.72176 17.8798 8.98411 18.2034 8.98411C18.527 8.98411 18.7894 8.72176 18.7894 8.39817C18.7894 6.05051 17.8751 3.84336 16.2151 2.18333C15.9863 1.95454 15.6153 1.9545 15.3865 2.18333C15.1576 2.41215 15.1576 2.78313 15.3865 3.01196C16.8252 4.45067 17.6175 6.36352 17.6175 8.39817Z" fill="#169600"/>
              <path d="M1.79688 8.98408C2.12047 8.98408 2.38281 8.72174 2.38281 8.39814C2.38281 6.36353 3.17516 4.45068 4.61383 3.01197C4.84266 2.78314 4.84266 2.41217 4.61383 2.18334C4.38504 1.95451 4.01402 1.95451 3.7852 2.18334C2.12516 3.84338 1.21094 6.05049 1.21094 8.39814C1.21094 8.72174 1.47328 8.98408 1.79688 8.98408Z" fill="#169600"/>
            </svg>
            <span>{t('notificationsBlock.notificationsTab')}</span>
          </div>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`transition-transform duration-300 ease-in-out ${isNotificationsBlockCollapsed ? 'rotate-180' : ''}`}
          >
            <path d="M12.0007 10.8273L7.05072 15.7773L5.63672 14.3633L12.0007 7.99935L18.3647 14.3633L16.9507 15.7773L12.0007 10.8273Z" fill="#169600"/>
          </svg>
        </button>
        <div className="hidden md:flex w-full items-center justify-between h-11 -mt-5">
          <div className="flex items-center gap-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.0547 10.268V8.39844C16.0547 5.67102 14.2418 3.35934 11.7579 2.6043V1.75781C11.7579 0.788555 10.9693 0 10 0C9.03079 0 8.24223 0.788555 8.24223 1.75781V2.6043C5.75825 3.35934 3.94536 5.67098 3.94536 8.39844V10.268C3.94536 12.6638 3.03216 14.9355 1.37399 16.6648C1.21149 16.8342 1.16583 17.0843 1.25794 17.3002C1.35005 17.5161 1.56216 17.6562 1.79692 17.6562H7.1293C7.40149 18.9919 8.58524 20 10 20C11.4149 20 12.5986 18.9919 12.8708 17.6562H18.2032C18.4379 17.6562 18.65 17.5161 18.7421 17.3002C18.8342 17.0843 18.7886 16.8342 18.6261 16.6648C16.9679 14.9355 16.0547 12.6638 16.0547 10.268ZM9.41411 1.75781C9.41411 1.43473 9.67696 1.17188 10 1.17188C10.3231 1.17188 10.586 1.43473 10.586 1.75781V2.37219C10.3931 2.35359 10.1977 2.34375 10 2.34375C9.80239 2.34375 9.60696 2.35359 9.41411 2.37219V1.75781ZM10 18.8281C9.23618 18.8281 8.58489 18.3382 8.34301 17.6562H11.6571C11.4152 18.3382 10.7639 18.8281 10 18.8281ZM3.05981 16.4844C4.39423 14.6956 5.11723 12.5309 5.11723 10.268V8.39844C5.11723 5.70605 7.30766 3.51562 10 3.51562C12.6924 3.51562 14.8829 5.70605 14.8829 8.39844V10.268C14.8829 12.5309 15.6059 14.6956 16.9403 16.4844H3.05981Z" fill="#169600"/>
              <path d="M17.6175 8.39817C17.6175 8.72176 17.8798 8.98411 18.2034 8.98411C18.527 8.98411 18.7894 8.72176 18.7894 8.39817C18.7894 6.05051 17.8751 3.84336 16.2151 2.18333C15.9863 1.95454 15.6153 1.9545 15.3865 2.18333C15.1576 2.41215 15.1576 2.78313 15.3865 3.01196C16.8252 4.45067 17.6175 6.36352 17.6175 8.39817Z" fill="#169600"/>
              <path d="M1.79688 8.98408C2.12047 8.98408 2.38281 8.72174 2.38281 8.39814C2.38281 6.36353 3.17516 4.45068 4.61383 3.01197C4.84266 2.78314 4.84266 2.41217 4.61383 2.18334C4.38504 1.95451 4.01402 1.95451 3.7852 2.18334C2.12516 3.84338 1.21094 6.05049 1.21094 8.39814C1.21094 8.72174 1.47328 8.98408 1.79688 8.98408Z" fill="#169600"/>
            </svg>
            <span>{t('notificationsBlock.notificationsTab')}</span>
          </div>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`transition-transform duration-300 ease-in-out ${isNotificationsBlockCollapsed ? 'rotate-180' : ''}`}
          >
            <path d="M12.0007 10.8273L7.05072 15.7773L5.63672 14.3633L12.0007 7.99935L18.3647 14.3633L16.9507 15.7773L12.0007 10.8273Z" fill="#169600"/>
          </svg>
        </div>
        <div className={`${isNotificationsBlockCollapsed ? 'hidden md:block' : 'block'} mt-5`}>
          <div className="flex flex-col gap-4 h-59 overflow-y-auto">
            {loading && (
              <div className="p-3 border border-[var(--border)] rounded-[6px] text-base text-[rgba(255,255,255,0.72)]">{t('notificationsBlock.loading')}</div>
            )}
            {!loading && activeTab === 'notifications' && items.length === 0 && optimizationSuggestions.length === 0 && (
              <div className="flex h-full items-center justify-center text-base text-[rgba(255,255,255,0.72)]">{t('notificationsBlock.noNotifications')}</div>
            )}
            {!loading && activeTab === 'reminders' && items.length === 0 && remindersFromCalendar.length === 0 && (
              <div className="flex h-full items-center justify-center text-base text-[rgba(255,255,255,0.72)]">{t('notificationsBlock.noReminders')}</div>
            )}
            {!loading && activeTab === 'news' && items.length === 0 && (
              <div className="flex h-full items-center justify-center text-base text-[rgba(255,255,255,0.72)]">{t('notificationsBlock.noNews')}</div>
            )}
            {!loading && activeTab === 'notifications' && optimizationSuggestions.length > 0 && (
              <>
                {optimizationSuggestions.map((suggestion) => (
                <div 
                  key={suggestion.id} 
                  onClick={() => {
                    if (suggestion.taskIds && suggestion.taskIds.length > 0) {
                      openTasksModal(suggestion.taskIds, suggestion.title);
                    }
                  }}
                  className={`min-h-17.5 px-5 pr-4 rounded-[6px] flex flex-col justify-center cursor-pointer bg-[var(--secondary)] border border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))]`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center pt-0.5">
                      {suggestion.type === 'warning' ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 0L0 16h16L8 0zm0 4v6h1V4H8zm0 8v-1h1v1H8z" fill="#F59E0B"/>
                        </svg>
                      ) : suggestion.type === 'suggestion' ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4V4h1v4H8z" fill="#3B82F6"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 6L7 10.5 4.5 8l1-1L7 8.5l3.5-3.5 1 1z" fill="#10B981"/>
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-normal text-[rgba(255,255,255,0.92)]">{suggestion.title}</span>
                        <span className="text-base text-[rgba(255,255,255,0.72)] whitespace-nowrap">{formatTime(suggestion.createdAt)}</span>
                      </div>
                      <span className="text-base text-[rgba(255,255,255,0.72)]">{suggestion.message}</span>
                    </div>
                  </div>
                </div>
                ))}
              </>
            )}
            {!loading && activeTab === 'reminders' && remindersFromCalendar.length > 0 && (
              <>
                {remindersFromCalendar.map((reminder) => {
                const isToday = reminder.date.toDateString() === new Date().toDateString();
                const isTomorrow = reminder.date.toDateString() === new Date(Date.now() + 86400000).toDateString();
                const dateLabel = isToday ? t('notificationsBlock.today') : isTomorrow ? t('notificationsBlock.tomorrow') : reminder.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
                const timeLabel = reminder.date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const timeUntil = formatTimeUntilReminder(reminder.date);
                const reminderTitleWithTime = `${reminder.title} (${timeUntil})`;
                
                const taskId = reminder.taskId;
                
                return (
                  <div 
                    key={reminder.id} 
                    onClick={async () => {
                      if (taskId && onOpenTaskView) {
                        // Если это напоминание о задаче, открываем задачу через глобальный обработчик
                        try {
                          const normalizedTaskId = normalizeTaskId(taskId);
                          if (!normalizedTaskId) {
                            console.error('Invalid taskId:', taskId);
                            return;
                          }
                          await onOpenTaskView(normalizedTaskId);
                          // Помечаем соответствующее уведомление-напоминание как прочитанное только если задача успешно открыта
                          const reminderNotification = items.find(n => n.type === NotificationType.REMINDER && n.taskId === taskId);
                          if (reminderNotification && !reminderNotification.isRead) {
                            try {
                              await apiService.markNotificationRead(reminderNotification._id, true);
                              setItems(prev => prev.map(n => n._id === reminderNotification._id ? { ...n, isRead: true } : n));
                            } catch (error) {
                              console.error('Failed to mark reminder as read:', error);
                            }
                          }
                        } catch (error) {
                          // Ошибка уже обработана в handleOpenTaskView
                          console.error('Failed to open task:', error);
                        }
                      }
                    }}
                    className={`min-h-17.5 px-5 pr-4 bg-[var(--secondary)] border border-[var(--border)] rounded-[6px] flex flex-col justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] cursor-pointer`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex items-center mt-1 flex-shrink-0">
                        <div className="h-3 w-3 rounded-full bg-dream-primary shadow-[0_0_10px_var(--color-dream-primary)]"></div>
                      </div>
                      <div className="flex-1 flex flex-col gap-2 min-w-0 overflow-hidden">
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <span className="font-normal text-[rgba(255,255,255,0.92)] flex-1 min-w-0 line-clamp-1">{reminderTitleWithTime}</span>
                          <span className="text-base text-[rgba(255,255,255,0.72)] whitespace-nowrap flex-shrink-0">{dateLabel} {timeLabel}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
                })}
              </>
            )}
            {!loading && items.length > 0 && (
              <>
                {items.map((n) => {
                  const isNews = n.type === NotificationType.NEWS;
                  const isReminder = n.type === NotificationType.REMINDER;
                  return (
                    <div 
                      key={n._id} 
                      onClick={async () => {
                        if (isReminder && n.taskId && onOpenTaskView) {
                          // Если это напоминание о задаче, открываем задачу через глобальный обработчик
                          try {
                            const normalizedTaskId = normalizeTaskId(n.taskId);
                            if (!normalizedTaskId) {
                              console.error('Invalid taskId:', n.taskId);
                              return;
                            }
                            await onOpenTaskView(normalizedTaskId);
                            // Помечаем как прочитанное только если задача успешно открыта
                            if (!n.isRead) {
                              try {
                                await apiService.markNotificationRead(n._id, true);
                                setItems(prev => prev.map(item => item._id === n._id ? { ...item, isRead: true } : item));
                              } catch (error) {
                                console.error('Failed to mark reminder as read:', error);
                              }
                            }
                          } catch (error) {
                            // Ошибка уже обработана в handleOpenTaskView
                            console.error('Failed to open task:', error);
                          }
                        } else if (isNews) {
                          // Для новостей открываем детали
                          openDetails(n);
                        } else {
                          openDetails(n);
                        }
                      }}
                      className={`min-h-17.5 px-5 pr-4 ${n.isRead ? 'border border-[var(--border)] bg-[var(--card)]' : 'bg-[var(--muted)] border border-[var(--border)]'} rounded-[6px] flex flex-col justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] cursor-pointer`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex items-center mt-1 flex-shrink-0">
                          <div className={`h-3 w-3 rounded-full ${n.isRead ? 'bg-[var(--primary)]/30' : 'bg-[var(--primary)] shadow-[0_0_10px_var(--color-primary)]'}`}></div>
                        </div>
                        <div className="flex-1 flex flex-col gap-2 min-w-0 overflow-hidden">
                          <div className="flex items-start justify-between gap-2 min-w-0">
                            {isNews ? (
                              <span 
                                className="font-normal text-[var(--foreground)] flex-1 min-w-0 line-clamp-2"
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  wordBreak: 'break-word'
                                }}
                              >
                                {n.title}
                              </span>
                            ) : (
                              <span className="font-normal text-[var(--foreground)] flex-1 min-w-0 line-clamp-1">
                                {isReminder && n.metadata?.eventStartTime ? (() => {
                                  const eventDate = new Date(n.metadata.eventStartTime);
                                  const timeUntil = formatTimeUntilReminder(eventDate);
                                  return `${n.title} (${timeUntil})`;
                                })() : n.title}
                              </span>
                            )}
                            <span className="text-base text-[rgba(255,255,255,0.72)] whitespace-nowrap flex-shrink-0">{formatTime(new Date(n.createdAt))}</span>
                          </div>
                          {/* Для новостей и напоминаний не показываем message на плашке */}
                          {!isNews && !isReminder && n.message && <span className="text-base text-[rgba(255,255,255,0.72)] line-clamp-2">{truncateMessage(n.message)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
      {isNotificationsModalOpen && (
        <NotificationsViewModal
          activeTab={activeTab}
          isOpen={isNotificationsModalOpen}
          onClose={() => {
            setIsNotificationsModalOpen(false);
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('modal');
            newParams.delete('notificationsTab');
            setSearchParams(newParams, { replace: true });
          }}
          onTabChange={(t) => {
            setActiveTab(t);
            const newParams = new URLSearchParams(searchParams);
            newParams.set('notificationsTab', t);
            setSearchParams(newParams, { replace: true });
          }}
          onOpenTaskView={onOpenTaskView}
        />
      )}
      {isTasksGridModalOpen && (
        <TasksGridModal
          isOpen={isTasksGridModalOpen}
          onClose={() => {
            setIsTasksGridModalOpen(false);
            setTasksForModal([]);
          }}
          tasks={tasksForModal}
          onUpdateTaskStatus={async (taskId, status) => {
            try {
              const updated = await setCrmTaskStatus(taskId, taskVersionsRef.current.get(taskId) ?? 0, status);
              taskVersionsRef.current.set(taskId, updated.version);
            } catch (error) {
              console.error('Failed to update task status:', error);
            }
          }}
          onDeleteTask={async (taskId) => {
            try {
              await setCrmTaskStatus(taskId, taskVersionsRef.current.get(taskId) ?? 0, TaskStatus.CANCELLED);
              taskVersionsRef.current.delete(taskId);
              setTasksForModal(prev => prev.filter(t => t._id !== taskId));
            } catch (error) {
              console.error('Failed to delete task:', error);
            }
          }}
          onTaskUpdate={(updatedTask) => {
            setTasksForModal(prev => 
              prev.map(t => t._id === updatedTask._id ? updatedTask : t)
            );
          }}
          onUpdateTaskEndDate={async (taskId, endDate) => {
            try {
              const updated = await tasksApiV2.setDueAt(taskId, taskVersionsRef.current.get(taskId) ?? 0, endDate || undefined);
              taskVersionsRef.current.set(taskId, updated.version);
            } catch (error) {
              console.error('Failed to update task end date:', error);
            }
          }}
          title={tasksGridModalTitle}
          forceViewMode="columns"
        />
      )}
      {isDetailModalOpen && createPortal((
        <div 
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-[60] pt-[15px] md:pt-4 pb-0 md:pb-4 px-0 md:px-4 transition-all duration-300 ease-out animate-in fade-in" 
          onClick={() => { setIsDetailModalOpen(false); setSelectedItem(null); }}
        >
          <div 
            className="relative flex flex-col bg-[var(--card)] rounded-t-[25px] md:rounded-[25px] shadow-2xl overflow-hidden w-full md:w-[70%] md:max-w-4xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 my-auto border border-[var(--border)]" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className='py-2.5 px-5 rounded-2xl border border-[var(--border)] flex flex-col gap-5 w-full max-w-full min-w-0'>
              <div className="flex justify-center items-center w-full min-w-0">
                <div className='flex items-center gap-2.5 p-2.5 w-full min-w-0'>
                  <h2 className="text-xl font-normal flex-1 text-[var(--foreground)] break-words overflow-wrap-anywhere min-w-0" title={selectedItem?.title || ''}>
                    {detailLoading ? t('notificationsBlock.loading') : (selectedItem?.title || t('notificationsBlock.noTitle'))}
                  </h2>
                </div>
              </div>

              {/* Карусель изображений */}
              {(() => {
                const images = getImageAttachments(selectedItem);
                if (images.length === 0) return null;
                const goPrev = () => setImageIndex(prev => (prev - 1 + images.length) % images.length);
                const goNext = () => setImageIndex(prev => (prev + 1) % images.length);
                return (
                  <div className='relative w-full h-[308px] rounded-2xl overflow-hidden bg-[var(--muted)]'>
                    <div
                      className='flex h-full transition-transform duration-500 ease-in-out'
                      style={{ transform: `translateX(-${imageIndex * 100}%)` }}
                    >
                      {images.map((img: NotificationAttachment, idx: number) => (
                        <div key={img.url + idx} className='min-w-full h-full'>
                          <img src={img.url} alt={img.originalName || 'image'} className='w-full h-full object-cover' />
                        </div>
                      ))}
                    </div>
                    {images.length > 1 && (
                      <>
                        <button
                          type='button'
                          onClick={goPrev}
                          aria-label={t('notificationsBlock.prev')}
                          className='absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center'
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                        <button
                          type='button'
                          onClick={goNext}
                          aria-label={t('notificationsBlock.next')}
                          className='absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center'
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                );
              })()}

              <div className='flex flex-col gap-y-4 pb-2 w-full min-w-0'>
                {selectedItem?.message ? (
                  <div className="whitespace-pre-line break-words overflow-wrap-anywhere w-full min-w-0">{selectedItem.message}</div>
                ) : (
                  !detailLoading && <span className="text-[rgba(255,255,255,0.72)]">{t('notificationsBlock.noContent')}</span>
                )}
                {selectedItem?.metadata?.taskIds && Array.isArray(selectedItem.metadata.taskIds) && selectedItem.metadata.taskIds.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedItem?.metadata?.taskIds) {
                        openTasksModal(selectedItem.metadata.taskIds, selectedItem.title || t('notificationsBlock.tasks'));
                      }
                    }}
                    className="self-start text-sm text-dream-primary font-medium hover:text-dream-primary/80 transition-all duration-200 hover:underline active:scale-95 flex items-center gap-2"
                  >
                    {selectedItem.metadata.taskIds.length === 1 ? t('notificationsBlock.viewTask_one').replace('{{count}}', String(selectedItem.metadata.taskIds.length)) : selectedItem.metadata.taskIds.length < 5 ? t('notificationsBlock.viewTask_few').replace('{{count}}', String(selectedItem.metadata.taskIds.length)) : t('notificationsBlock.viewTask_many').replace('{{count}}', String(selectedItem.metadata.taskIds.length))}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 7l5 5-5 5M6 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Видео-вложения */}
              {(() => {
                const videos = getVideoAttachments(selectedItem);
                if (videos.length === 0) return null;
                return (
                  <div className='flex flex-col gap-3'>
                    {videos.map((v: NotificationAttachment, idx: number) => (
                      <video key={v.url + idx} controls className='w-full rounded-2xl bg-black'>
                        <source src={v.url} type={v.mimeType} />
                        {t('crm.crm.notificationsBlock.ваш_браузер_не_подде')}</video>
                    ))}
                  </div>
                );
              })()}

              {/* Другие вложения */}
              {(() => {
                const others = getOtherAttachments(selectedItem);
                if (others.length === 0) return null;
                return (
                  <div className='flex flex-col gap-2'>
                    {others.map((a: NotificationAttachment, idx: number) => (
                      <a
                        key={a.url + idx}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className='flex items-center gap-3 p-3 border border-[var(--border)] rounded-[6px] hover:bg-[var(--secondary)] transition-colors'
                      >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <div className='flex-1 min-w-0'>
                          <div className='text-base text-[rgba(255,255,255,0.92)] truncate'>{decodeFilename(a.originalName)}</div>
                          {a.size && <div className='text-base text-[rgba(255,255,255,0.72)]'>{formatFileSize(a.size)}</div>}
                        </div>
                      </a>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
};

export default NotificationsBlock;
