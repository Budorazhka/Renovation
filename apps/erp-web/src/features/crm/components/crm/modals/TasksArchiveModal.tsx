import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type Task, TaskPriority } from '../../../services/api';
import { tasksApiV2 } from '@/services/tasksApiV2';
import { mapTaskV2ToCrmTask } from '@/lib/task-v2-legacy-adapter';
import { useDisableScroll } from '../../../hooks/useDisableScroll';
import Tooltip from '../../common/Tooltip';
import { useI18n } from '@/i18n';

interface TasksArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskRestored?: (task: Task) => void;
}

const TasksArchiveModal: React.FC<TasksArchiveModalProps> = ({ isOpen, onClose, onTaskRestored }) => {
  const { t } = useI18n();
  useDisableScroll(isOpen);
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'personal' | 'work'>('all');
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const [confirmRestoreTask, setConfirmRestoreTask] = useState<Task | null>(null);
  // Версии задач для оптимистичной блокировки при восстановлении (PATCH требует expectedVersion).
  const versionsRef = useRef<Map<string, number>>(new Map());

  // Вычисляем дату 30 дней назад
  const getThirtyDaysAgo = () => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString();
  };

  const fetchArchivedTasks = useCallback(async (page: number = 1) => {
    try {
      setLoading(true);
      setError(null);

      // Архив — отменённые (удалённые) задачи за последние 30 дней.
      const thirtyDaysAgo = new Date(getThirtyDaysAgo());
      const { items } = await tasksApiV2.listAll({ status: 'cancelled' });
      const recent = items.filter((task) => {
        const changedAt = new Date(task.updatedAt ?? task.createdAt);
        return changedAt >= thirtyDaysAgo && (categoryFilter === 'all' || task.taskCategory === categoryFilter);
      });
      recent.forEach((task) => versionsRef.current.set(task.id, task.version));
      const filteredTasks = recent.map(mapTaskV2ToCrmTask);

      // Применяем пагинацию на клиенте
      const startIndex = (page - 1) * pagination.limit;
      const endIndex = startIndex + pagination.limit;
      const paginatedTasks = filteredTasks.slice(startIndex, endIndex);

      setTasks(paginatedTasks);
      setPagination({
        page,
        limit: pagination.limit,
        total: filteredTasks.length,
        totalPages: Math.ceil(filteredTasks.length / pagination.limit),
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      let message = t('tasksArchiveErrors.loadArchiveError');
      if (raw.includes('403')) message = t('tasksArchiveErrors.noAccessArchive');
      else if (raw.includes('401')) message = t('tasksArchiveErrors.authRequired');
      else if (raw.includes('500') || raw.includes('502') || raw.includes('503')) message = t('tasksArchiveErrors.serverUnavailable');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.limit, categoryFilter, t]);

  useEffect(() => {
    if (isOpen) {
      fetchArchivedTasks(1);
    } else {
      // Сбрасываем состояние при закрытии
      setTasks([]);
      setPagination(prev => ({ ...prev, page: 1, total: 0, totalPages: 0 }));
      setError(null);
      setCategoryFilter('all');
    }
  }, [isOpen, fetchArchivedTasks]);

  const handleRestoreTask = async (task: Task) => {
    try {
      setRestoringTaskId(task._id);
      setError(null);
      
      const restored = await tasksApiV2.setStatus(task._id, versionsRef.current.get(task._id) ?? 0, 'open');
      onTaskRestored?.(mapTaskV2ToCrmTask(restored));
      await fetchArchivedTasks(pagination.page);
      setConfirmRestoreTask(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('tasksArchiveErrors.restoreError');
      setError(errorMessage);
      console.error('Ошибка восстановления задачи:', err);
    } finally {
      setRestoringTaskId(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Модалка подтверждения восстановления */}
      {confirmRestoreTask && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-[25px] shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-normal mb-4 text-gray-800">{t('tasksArchiveErrors.confirmRestoreTitle')}</h3>
            <p className="text-gray-600 mb-6">
              {t('tasksArchiveErrors.confirmRestoreText').replace('{{title}}', confirmRestoreTask.title)}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmRestoreTask(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >{t('tasksArchiveErrors.confirmNo')}</button>
              <button
                onClick={() => handleRestoreTask(confirmRestoreTask)}
                disabled={restoringTaskId === confirmRestoreTask._id}
                className="px-4 py-2 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                  {restoringTaskId === confirmRestoreTask._id ? t('tasksArchive.restoring') : t('tasksArchiveErrors.confirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Основная модалка архива */}
      <div
        className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[90] p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div 
          className="bg-white rounded-[25px] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Заголовок */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.54 5.23L19.15 3.55C18.88 3.21 18.47 3 18 3H6C5.53 3 5.12 3.21 4.85 3.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V6.5C21 6.02 20.83 5.57 20.54 5.23ZM12 17.5L6.5 12H10V8H14V12H17.5L12 17.5Z" fill="#169600"/>
              </svg>
              <h2 className="text-2xl font-normal text-gray-800">{t('tasksArchive.title')}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Информационное сообщение о хранении данных */}
          <div className="px-6 pt-4 pb-2">
            <div className="flex items-start gap-3 bg-[rgba(230,195,100,0.08)] border border-[rgba(230,195,100,0.32)] rounded-lg p-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 mt-0.5">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="#e6c364"/>
              </svg>
              <p className="text-sm text-[rgba(255,255,255,0.82)]">
                <span className="text-[#e6c364]">{t('tasksArchive.storageInfoImportant')}</span> {t('tasksArchive.storageInfoText')}
              </p>
            </div>
          </div>

          {/* Фильтры */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  categoryFilter === 'all'
                    ? 'bg-dream-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={t('tasksArchive.filterAllTitle')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span className="text-sm font-medium">{t('tasksArchive.filterAll')}</span>
              </button>
              <button
                onClick={() => setCategoryFilter('personal')}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  categoryFilter === 'personal'
                    ? 'bg-dream-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={t('tasksArchive.filterPersonalTitle')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21M16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm font-medium">{t('tasksArchive.filterPersonal')}</span>
              </button>
              <button
                onClick={() => setCategoryFilter('work')}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  categoryFilter === 'work'
                    ? 'bg-dream-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={t('tasksArchive.filterWorkTitle')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M21 13V7C21 6.46957 20.7893 5.96086 20.4142 5.58579C20.0391 5.21071 19.5304 5 19 5H5C4.46957 5 3.96086 5.21071 3.58579 5.58579C3.21071 5.96086 3 6.46957 3 7V13M21 13L12 18L3 13M21 13V17C21 17.5304 20.7893 18.0391 20.4142 18.4142C20.0391 18.7893 19.5304 19 19 19H5C4.46957 19 3.96086 18.7893 3.58579 18.4142C3.21071 18.0391 3 17.5304 3 17V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm font-medium">{t('tasksArchive.filterWork')}</span>
              </button>
            </div>
          </div>

          {/* Контент */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">{t('tasksArchive.loading')}</div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-70">
                  <path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18A2 2 0 003.54 21H20.46A2 2 0 0022.18 18L13.71 3.86A2 2 0 0010.29 3.86Z" stroke="#e6c364" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="text-[rgba(255,255,255,0.82)] text-center">{error}</div>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">{t('tasksArchive.empty')}</div>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task, index) => {
                  // Преобразуем приоритет в иконки
                  const priorityToUrgencyImportance = (priority: TaskPriority) => {
                    switch (priority) {
                      case TaskPriority.URGENT_IMPORTANT:
                        return { urgency: 'urgent' as const, importance: 'important' as const };
                      case TaskPriority.NOT_URGENT_IMPORTANT:
                        return { urgency: 'notUrgent' as const, importance: 'important' as const };
                      case TaskPriority.URGENT_NOT_IMPORTANT:
                        return { urgency: 'urgent' as const, importance: 'notImportant' as const };
                      case TaskPriority.NOT_URGENT_NOT_IMPORTANT:
                        return { urgency: 'notUrgent' as const, importance: 'notImportant' as const };
                      default:
                        return { urgency: 'notUrgent' as const, importance: 'notImportant' as const };
                    }
                  };

                  const { urgency, importance } = priorityToUrgencyImportance(task.priority);
                  const icons: Array<'redLightning' | 'yellowBookmark'> = [];
                  if (urgency === 'urgent') icons.push('redLightning');
                  if (importance === 'important') icons.push('yellowBookmark');

                  // Определяем тип задачи и категорию (личная/рабочая) по массиву categories
                  let taskType: 'standard' | 'call' | 'meeting' = 'standard';
                  let workType: 'work' | 'personal' | undefined = undefined;
                  
                  // Проверяем категории для определения типа задачи и типа работы
                  if (task.categories && Array.isArray(task.categories)) {
                    const hasCall = task.categories.some(cat => 
                      cat.toLowerCase().includes('звонок') || cat.toLowerCase().includes('call')
                    );
                    const hasMeeting = task.categories.some(cat => 
                      cat.toLowerCase().includes('встреча') || cat.toLowerCase().includes('meeting')
                    );
                    const hasWork = task.categories.some(cat => cat.includes('Рабочие задачи'));
                    const hasPersonal = task.categories.some(cat => cat.includes('Личные задачи'));
                    
                    if (hasCall) {
                      taskType = 'call';
                    } else if (hasMeeting) {
                      taskType = 'meeting';
                    }
                    
                    if (hasWork) {
                      workType = 'work';
                    } else if (hasPersonal) {
                      workType = 'personal';
                    }
                  }

                  // Получаем назначенных пользователей для встреч
                  let assignedUsers: Array<{ name: string; image?: string }> | undefined = undefined;
                  if (task.assignedTo) {
                    if (typeof task.assignedTo === 'object' && task.assignedTo !== null) {
                      const assignedToObj = task.assignedTo as any;
                      assignedUsers = [{
                        name: assignedToObj.name || '',
                        image: assignedToObj.image || assignedToObj.avatar || undefined
                      }];
                    }
                  }

                  // Получаем имя лида
                  let leadName: string | undefined = undefined;
                  if (task.leadId && typeof task.leadId === 'object' && (task.leadId as any).name) {
                    leadName = (task.leadId as any).name;
                  } else if (task.clientName) {
                    leadName = task.clientName;
                  }

                  // Форматируем дату окончания
                  const formatDate = (dateStr: string) => {
                    const date = new Date(dateStr);
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    return `${day}.${month}.${year}`;
                  };

                  const endDateStr = task.endDate ? formatDate(task.endDate) : '';
                  const isEndDateUrgent = task.endDate ? (() => {
                    const endDate = new Date(task.endDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    endDate.setHours(0, 0, 0, 0);
                    return endDate <= tomorrow;
                  })() : false;

                  // Подсчитываем подзадачи
                  const progress = task.subtasks && task.subtasks.length > 0 ? {
                    current: task.subtasks.filter(s => s.completed).length,
                    total: task.subtasks.length,
                    completed: task.subtasks.every(s => s.completed)
                  } : undefined;

                  return (
                    <div
                      key={task._id}
                      className="bg-dream-secondary rounded-lg h-17.5 px-5 pr-4 flex justify-between items-center transition-all duration-300 ease-out overflow-hidden hover:shadow-md hover:scale-y-[1.01]"
                    >
                      <div className="flex h-flex gap-2.5 flex-1 min-w-0">
                        <div className="flex flex-col justify-between h-flex gap-0.5 flex-1 min-w-0">
                          <div className="flex justify-between items-center gap-2">
                            <div className="flex items-center flex-1 min-w-0">
                              <span
                                className="flex-1 min-w-0 transition-all duration-300 text-wrap text-black"
                                style={{
                                  fontFamily: 'var(--font-sans)',
                                  fontWeight: 400,
                                  fontStyle: 'normal',
                                  fontSize: '18px',
                                  lineHeight: '24px',
                                  letterSpacing: '0px',
                                  leadingTrim: 'none'
                                } as React.CSSProperties & { leadingTrim?: string }}
                              >
                                {task.title}
                              </span>
                            </div>
                          </div>
                          {(task.endDate || progress || leadName) && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {task.endDate && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span
                                    className={`text-left whitespace-nowrap ${isEndDateUrgent ? 'text-red-600' : 'text-gray-500'}`}
                                    style={{
                                      fontFamily: 'var(--font-sans)',
                                      fontWeight: 400,
                                      fontStyle: 'normal',
                                      fontSize: '11px',
                                      lineHeight: '100%',
                                      letterSpacing: '0px',
                                      leadingTrim: 'none'
                                    } as React.CSSProperties & { leadingTrim?: string }}
                                  >
                                    {endDateStr ? `${t('tasksArchive.deadlineUntil')} ${endDateStr}` : t('tasksArchive.noDeadline')}
                                  </span>
                                  {isEndDateUrgent && (
                                    <Tooltip text={t('tasksArchive.timeExpired')}>
                                      <div>
                                        <svg width="16" height="16" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <path d="M11 9.10938C8.51211 9.10938 6.48828 11.1332 6.48828 13.6211C6.48828 16.109 8.51211 18.1328 11 18.1328C13.4879 18.1328 15.5117 16.109 15.5117 13.6211C15.5117 11.1332 13.4879 9.10938 11 9.10938ZM13.5781 14.2656H11C10.6442 14.2656 10.3555 13.9769 10.3555 13.6211V11.043C10.3555 10.6872 10.6442 10.3984 11 10.3984C11.3558 10.3984 11.6445 10.6872 11.6445 11.043V12.9766H13.5781C13.9339 12.9766 14.2227 13.2653 14.2227 13.6211C14.2227 13.9769 13.9339 14.2656 13.5781 14.2656Z" fill="#F56161"/>
                                          <path d="M12.9336 0.644531C12.9336 0.28875 12.6448 0 12.2891 0C10.7963 0 10.2107 1.96281 9.74316 3.3868C9.41617 4.38238 8.92203 5.88672 8.42188 5.88672C8.03172 5.88672 7.77949 4.74117 7.77734 3.95312C7.77734 3.36102 7.04258 3.08301 6.65027 3.52602C4.61227 5.82828 2.62109 9.85316 2.62109 13.6211C2.62109 18.2037 6.34691 22 11 22C15.62 22 19.3789 18.2411 19.3789 13.6211C19.3789 8.23195 12.9336 4.16152 12.9336 0.644531ZM11 19.4219C7.80141 19.4219 5.19922 16.8197 5.19922 13.6211C5.19922 10.4225 7.80141 7.82031 11 7.82031C14.1986 7.82031 16.8008 10.4225 16.8008 13.6211C16.8008 16.8197 14.1986 19.4219 11 19.4219Z" fill="#F56161"/>
                                        </svg>
                                      </div>
                                    </Tooltip>
                                  )}
                                </div>
                              )}
                              {progress && progress.total > 0 && (
                                <Tooltip text={t('tasksArchive.subtasksProgress').replace('{{current}}', progress.current.toString()).replace('{{total}}', progress.total.toString())} position="top">
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {progress.completed ? (
                                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M10 1.875C8.39303 1.875 6.82214 2.35152 5.486 3.24431C4.14985 4.1371 3.10844 5.40605 2.49348 6.8907C1.87852 8.37535 1.71762 10.009 2.03112 11.5851C2.34463 13.1612 3.11846 14.6089 4.25476 15.7452C5.39106 16.8815 6.8388 17.6554 8.41489 17.9689C9.99099 18.2824 11.6247 18.1215 13.1093 17.5065C14.594 16.8916 15.8629 15.8502 16.7557 14.514C17.6485 13.1779 18.125 11.607 18.125 10C18.1227 7.84581 17.266 5.78051 15.7427 4.25727C14.2195 2.73403 12.1542 1.87727 10 1.875ZM13.5672 8.56719L9.19219 12.9422C9.13414 13.0003 9.06521 13.0464 8.98934 13.0778C8.91347 13.1093 8.83214 13.1255 8.75 13.1255C8.66787 13.1255 8.58654 13.1093 8.51067 13.0778C8.43479 13.0464 8.36586 13.0003 8.30782 12.9422L6.43282 11.0672C6.31554 10.9499 6.24966 10.7909 6.24966 10.625C6.24966 10.4591 6.31554 10.3001 6.43282 10.1828C6.55009 10.0655 6.70915 9.99965 6.875 9.99965C7.04086 9.99965 7.19992 10.0655 7.31719 10.1828L8.75 11.6164L12.6828 7.68281C12.7409 7.62474 12.8098 7.57868 12.8857 7.54725C12.9616 7.51583 13.0429 7.49965 13.125 7.49965C13.2071 7.49965 13.2884 7.51583 13.3643 7.54725C13.4402 7.57868 13.5091 7.62474 13.5672 7.68281C13.6253 7.74088 13.6713 7.80982 13.7027 7.88569C13.7342 7.96156 13.7504 8.04288 13.7504 8.125C13.7504 8.20712 13.7342 8.28844 13.7027 8.36431C13.6713 8.44018 13.6253 8.50912 13.5672 8.56719Z" fill="#169600"/>
                                      </svg>
                                    ) : (
                                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M10 1.875C8.39303 1.875 6.82214 2.35152 5.486 3.24431C4.14985 4.1371 3.10844 5.40605 2.49348 6.8907C1.87852 8.37535 1.71762 10.009 2.03112 11.5851C2.34463 13.1612 3.11846 14.6089 4.25476 15.7452C5.39106 16.8815 6.8388 17.6554 8.41489 17.9689C9.99099 18.2824 11.6247 18.1215 13.1093 17.5065C14.594 16.8916 15.8629 15.8502 16.7557 14.514C17.6485 13.1779 18.125 11.607 18.125 10C18.1227 7.84581 17.266 5.78051 15.7427 4.25727C14.2195 2.73403 12.1542 1.87727 10 1.875ZM13.5672 8.56719L9.19219 12.9422C9.13414 13.0003 9.06521 13.0464 8.98934 13.0778C8.91347 13.1093 8.83214 13.1255 8.75 13.1255C8.66787 13.1255 8.58654 13.1093 8.51067 13.0778C8.43479 13.0464 8.36586 13.0003 8.30782 12.9422L6.43282 11.0672C6.31554 10.9499 6.24966 10.7909 6.24966 10.625C6.24966 10.4591 6.31554 10.3001 6.43282 10.1828C6.55009 10.0655 6.70915 9.99965 6.875 9.99965C7.04086 9.99965 7.19992 10.0655 7.31719 10.1828L8.75 11.6164L12.6828 7.68281C12.7409 7.62474 12.8098 7.57868 12.8857 7.54725C12.9616 7.51583 13.0429 7.49965 13.125 7.49965C13.2071 7.49965 13.2884 7.51583 13.3643 7.54725C13.4402 7.57868 13.5091 7.62474 13.5672 7.68281C13.6253 7.74088 13.6713 7.80982 13.7027 7.88569C13.7342 7.96156 13.7504 8.04288 13.7504 8.125C13.7504 8.20712 13.7342 8.28844 13.7027 8.36431C13.6713 8.44018 13.6253 8.50912 13.5672 8.56719Z" fill="#B4BBC0"/>
                                      </svg>
                                    )}
                                    <span
                                      className="text-black"
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '13px',
                                        lineHeight: '20px',
                                        letterSpacing: '-0.007em',
                                        textAlign: 'center',
                                        verticalAlign: 'middle',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {progress.current}/{progress.total}
                                    </span>
                                  </div>
                                </Tooltip>
                              )}
                              {leadName && (
                                <>
                                  <div className="size-6 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[9px] text-gray-600 font-medium">
                                      {leadName.split(' ').map(word => word.charAt(0).toUpperCase()).join('').slice(0, 2)}
                                    </span>
                                  </div>
                                  <span
                                    className="text-nowrap text-black"
                                    style={{
                                      fontFamily: 'var(--font-sans)',
                                      fontWeight: 500,
                                      fontStyle: 'normal',
                                      fontSize: '13px',
                                      lineHeight: '20px',
                                      letterSpacing: '0px',
                                      leadingTrim: 'none'
                                    } as React.CSSProperties & { leadingTrim?: string }}
                                  >
                                    {leadName}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Иконки справа */}
                      <div className="flex items-center gap-1 md:gap-2 flex-shrink-0 overflow-hidden max-w-[45%] md:max-w-none">
                        {/* Файлы */}
                        {(task.files && task.files.length > 0) || task.hasFiles ? (
                          <Tooltip text={t('tasksArchive.hasFiles')}>
                            <div className="flex items-center justify-center flex-shrink-0">
                              <svg width="12" height="20" viewBox="0 0 14 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 0H5C3.6744 0.00156145 2.40353 0.528847 1.46619 1.46619C0.528847 2.40353 0.00156145 3.6744 0 5V25C0 25.2652 0.105357 25.5196 0.292893 25.7071C0.48043 25.8946 0.734784 26 1 26C1.26522 26 1.51957 25.8946 1.70711 25.7071C1.89464 25.5196 2 25.2652 2 25V5C2.00087 4.20462 2.31722 3.44206 2.87964 2.87964C3.44206 2.31722 4.20462 2.00087 5 2H9C9.79538 2.00087 10.5579 2.31722 11.1204 2.87964C11.6828 3.44206 11.9991 4.20462 12 5V21C12 21.7956 11.6839 22.5587 11.1213 23.1213C10.5587 23.6839 9.79565 24 9 24C8.20435 24 7.44129 23.6839 6.87868 23.1213C6.31607 22.5587 6 21.7956 6 21V8C6 7.73478 6.10536 7.48043 6.29289 7.29289C6.48043 7.10536 6.73478 7 7 7C7.26522 7 7.51957 7.10536 7.70711 7.29289C7.89464 7.48043 8 7.73478 8 8V20C8 20.2652 8.10536 20.5196 8.29289 20.7071C8.48043 20.8946 8.73478 21 9 21C9.26522 21 9.51957 20.8946 9.70711 20.7071C9.89464 20.5196 10 20.2652 10 20V8C10 7.20435 9.68393 6.44129 9.12132 5.87868C8.55871 5.31607 7.79565 5 7 5C6.20435 5 5.44129 5.31607 4.87868 5.87868C4.31607 6.44129 4 7.20435 4 8V21C4 22.3261 4.52678 23.5979 5.46447 24.5355C6.40215 25.4732 7.67392 26 9 26C10.3261 26 11.5979 25.4732 12.5355 24.5355C13.4732 23.5979 14 22.3261 14 21V5C13.9984 3.6744 13.4712 2.40353 12.5338 1.46619C11.5965 0.528847 10.3256 0.00156145 9 0Z" fill="#555454"/>
                              </svg>
                            </div>
                          </Tooltip>
                        ) : null}
                        {/* Тип задачи (звонок/встреча) */}
                        {taskType === 'call' && (
                          <Tooltip text={t('tasksArchive.callTooltip')}>
                            <div className="flex-shrink-0">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20.01 15.38C18.78 15.38 17.59 15.18 16.45 14.82C16.3 14.75 16.13 14.72 15.96 14.72C15.75 14.72 15.54 14.78 15.35 14.88L12.8 16.53C10.07 15.24 8.76 13.93 7.47 11.2L9.12 8.65C9.32 8.46 9.47 8.22 9.54 7.96C9.62 7.7 9.61 7.42 9.52 7.17C9.16 6.03 8.96 4.84 8.96 3.62C8.96 3.13 8.56 2.73 8.07 2.73H4.28C3.79 2.73 3 2.73 3 3.62C3 13.61 10.39 21 20.38 21C21.27 21 21.27 20.21 21.27 19.72V15.93C21.27 15.44 20.87 15.04 20.38 15.04L20.01 15.38Z" fill="#666666"/>
                              </svg>
                            </div>
                          </Tooltip>
                        )}
                        {taskType === 'meeting' && (
                          <Tooltip text={t('tasksArchive.meetingTooltip')}>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {assignedUsers && assignedUsers.length > 0 ? (
                                <>
                                  {assignedUsers.slice(0, 2).map((_user, idx) => (
                                    <div key={idx} className="flex-shrink-0">
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="#666666"/>
                                        <path d="M18 10C19.1 10 20 9.1 20 8C20 6.9 19.1 6 18 6C16.9 6 16 6.9 16 8C16 9.1 16.9 10 18 10ZM18 12C16.34 12 13 12.68 13 14.33V16H23V14.33C23 12.68 19.66 12 18 12Z" fill="#666666"/>
                                      </svg>
                                    </div>
                                  ))}
                                  {assignedUsers.length > 2 && (
                                    <div className="flex-shrink-0 text-xs text-gray-600 font-medium">
                                      +{assignedUsers.length - 2}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="flex-shrink-0">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="#666666"/>
                                    <path d="M18 10C19.1 10 20 9.1 20 8C20 6.9 19.1 6 18 6C16.9 6 16 6.9 16 8C16 9.1 16.9 10 18 10ZM18 12C16.34 12 13 12.68 13 14.33V16H23V14.33C23 12.68 19.66 12 18 12Z" fill="#666666"/>
                                  </svg>
                                </div>
                              )}
                            </div>
                          </Tooltip>
                        )}
                        {/* Бейдж типа задачи (Личная/Рабочая) - отображается для всех задач */}
                        {workType && (
                          <Tooltip text={workType === 'work' ? t('tasksArchive.workTooltip') : t('tasksArchive.personalTooltip')}>
                            <span
                              className="px-2 py-0.5 rounded text-base flex-shrink-0"
                              style={workType === 'work'
                                ? { background: 'rgba(230,195,100,0.15)', color: '#e6c364' }
                                : { background: 'rgba(180,204,195,0.15)', color: '#b4ccc3' }}
                            >
                              {workType === 'work' ? t('tasksArchive.workInitial') : t('tasksArchive.personalInitial')}
                            </span>
                          </Tooltip>
                        )}
                        {/* Иконки приоритета */}
                        {icons.includes('redLightning') && (
                          <Tooltip text={t('tasksArchive.urgentTooltip')}>
                            <div className="flex-shrink-0">
                              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M19.0723 11.1734C19.0231 11.0678 18.9172 11 18.8005 11H15.2455L18.754 5.46051C18.8125 5.36812 18.8161 5.25112 18.7633 5.15543C18.7105 5.05941 18.6097 5 18.5005 5H13.7005C13.5868 5 13.483 5.0642 13.432 5.1659L8.93202 14.1659C8.88551 14.2586 8.89061 14.369 8.94521 14.4575C9.00012 14.546 9.09642 14.6 9.20051 14.6H12.2854L8.9239 22.5836C8.8666 22.7201 8.91761 22.8785 9.04389 22.9559C9.09248 22.9856 9.14648 23 9.2002 23C9.28629 23 9.3712 22.9631 9.43001 22.8935L19.03 11.4935C19.1053 11.4041 19.1215 11.2793 19.0723 11.1734Z" fill="#FF070B"/>
                              </svg>
                            </div>
                          </Tooltip>
                        )}
                        {icons.includes('yellowBookmark') && (
                          <Tooltip text={t('tasksArchive.importantTooltip')}>
                            <div className="flex-shrink-0">
                              <svg width="27" height="27" viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <g clipPath={`url(#clip0_archive_${index}_${task._id})`}>
                                  <path d="M18.4582 5H8.59461C7.79129 5 7.08594 5.66085 7.08594 6.44309V21.0343C7.08594 21.2962 7.15881 21.5144 7.27627 21.683C7.41673 21.8846 7.64289 22.0001 7.88541 22C8.1147 22 8.35882 21.8979 8.58427 21.7054L12.9972 17.9585C13.1335 17.8421 13.3293 17.7754 13.5329 17.7754C13.7363 17.7754 13.9317 17.8421 14.0684 17.9589L18.4666 21.7048C18.6929 21.8979 18.9202 22.0001 19.149 22.0001C19.5361 22.0001 19.9134 21.7015 19.9134 21.0344V6.44309C19.9134 5.66085 19.2615 5 18.4582 5Z" fill="#F6B000"/>
                                </g>
                                <defs>
                                  <clipPath id={`clip0_archive_${index}_${task._id}`}>
                                    <rect width="17" height="17" fill="white" transform="translate(5 5)"/>
                                  </clipPath>
                                </defs>
                              </svg>
                            </div>
                          </Tooltip>
                        )}
                        {/* Цветовая метка */}
                        {task.colorLabel && (
                          <Tooltip text={t('tasksArchive.colorLabelTooltip')}>
                            <div className="flex-shrink-0">
                              <svg width="20" height="20" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="13" cy="13" r="8" fill={task.colorLabel}/>
                              </svg>
                            </div>
                          </Tooltip>
                        )}
                        {/* Кнопка восстановления вместо редактирования/удаления */}
                        <Tooltip text={t('tasksArchive.restoreTooltip')} position="top">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmRestoreTask(task);
                            }}
                            disabled={restoringTaskId === task._id}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed ml-2"
                          >
                            {restoringTaskId === task._id ? (
                              <>
                                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="32" strokeDashoffset="32" opacity="0.3"/>
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="32" strokeDashoffset="24"/>
                                </svg>
                                <span className="text-xs font-medium">{t('tasksArchive.restoring')}</span>
                              </>
                            ) : (
                              <>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M3 10H21M7 15L3 19L7 23M17 15L21 19L17 23M12 3V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                <span className="text-xs font-normal">{t('tasksArchive.restore')}</span>
                              </>
                            )}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Пагинация */}
          {pagination.totalPages > 1 && (
            <div className="p-4 border-t border-gray-200 flex items-center justify-between">
              <Tooltip text={t('tasksArchive.prevPage')}>
                <button
                  disabled={pagination.page === 1}
                  onClick={() => fetchArchivedTasks(pagination.page - 1)}
                  className="p-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </Tooltip>
              <span className="text-gray-600">
                {t('tasksArchive.pageInfo').replace('{{page}}', pagination.page.toString()).replace('{{totalPages}}', pagination.totalPages.toString())}
              </span>
              <Tooltip text={t('tasksArchive.nextPage')}>
                <button
                  disabled={pagination.page === pagination.totalPages}
                  onClick={() => fetchArchivedTasks(pagination.page + 1)}
                  className="p-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
};

export default TasksArchiveModal;

