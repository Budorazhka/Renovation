import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Calendar from './Calendar';
import { useDisableScroll } from '../../hooks/useDisableScroll';
import { useAuth } from '../../hooks/useAuth';
import { type CalendarEvent, type Task, EventType, EventStatus, type UpdateCalendarEventDto, TaskPriority, TaskStatus } from '../../services/api';
import { calendarCrmService } from '../../services/calendarCrmV2';
import { crmTaskService } from '../../services/crmTasksV2';
import { compareCalendarEvents, compareArrays } from '../../utils/dataComparison';
import TaskViewModal from './TaskViewModal';
import Tooltip from '../common/Tooltip';
import { useI18n } from '@/i18n';
import TimePickerDropdown from './common/TimePickerDropdown';
import { useTaskRealtimeSync } from '../../hooks/useTaskRealtimeSync';
import { onPush, offPush } from '../../services/socket';
import type { PushEnvelope } from '../../services/socket';
import CircularProgress from './CircularProgress';

interface CalendarViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: Date;
}

const CalendarViewModal: React.FC<CalendarViewModalProps> = ({
  isOpen,
  onClose,
  initialDate,
}) => {
  useDisableScroll(isOpen);
  const { t } = useI18n();
  const { user } = useAuth();
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartElement = useRef<HTMLElement | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(t('calendarViewModal.week'));
  const [isCreateEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  
  // Состояние формы создания события (вынесено на уровень родителя, чтобы не сбрасывалось)
  const [, setEventFormTitle] = useState('');
  const [, setEventFormDescription] = useState('');
  const [eventFormStartDate, setEventFormStartDate] = useState('');
  const [, setEventFormStartTime] = useState('');
  const [, setEventFormEndDate] = useState('');
  const [, setEventFormEndTime] = useState('');
  const [, setEventFormType] = useState<EventType>(EventType.MEETING);
  const [, setEventFormIsAllDay] = useState(false);
  const [, setEventFormLocation] = useState('');
  const [, setEventFormMeetingUrl] = useState('');
  const [, setEventFormLeadId] = useState('');
  const [, setEventFormParticipants] = useState<string[]>([]);
  const [, setEventFormExternalParticipants] = useState<string[]>([]);
  const [, setEventFormReminderMinutes] = useState<number[]>([1440, 360, 60]); // По умолчанию: 24ч, 6ч, 1ч
  const [, setEventFormIsRecurring] = useState(false);
  const [, setEventFormRecurringRule] = useState('');
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [_tasks, setTasks] = useState<Task[]>([]);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]); // Объединенные события и задачи
  const [tasksDataMap, setTasksDataMap] = useState<Map<string, { priority?: TaskPriority; colorLabel?: string; category?: number; workType?: 'work' | 'personal'; hasFiles?: boolean }>>(new Map()); // Данные задач для отображения иконок
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<Date>(new Date()); // Текущая дата для навигации
  const [searchQuery, setSearchQuery] = useState<string>(''); // Поисковый запрос
  const [selectedTaskForView, setSelectedTaskForView] = useState<Task | null>(null);
  const [isTaskViewModalOpen, setIsTaskViewModalOpen] = useState(false);
  const [draggedEvent, setDraggedEvent] = useState<CalendarEvent | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [draggedEventTime, setDraggedEventTime] = useState<{ event: CalendarEvent; initialY: number } | null>(null);
  const [_dragTimePreview, setDragTimePreview] = useState<number | null>(null);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const [eventToEdit, setEventToEdit] = useState<CalendarEvent | null>(null);
  const isFirstLoadRef = useRef(true); // чтобы не дергать интерфейс индикатором загрузки при автообновлении
  
  // СИСТЕМА ОТСЛЕЖИВАНИЯ ИЗМЕНЕНИЙ: Храним Map уже отрендеренных событий для предотвращения лишних ререндеров
  const renderedEventsRef = useRef<Map<string, CalendarEvent>>(new Map());
  
  // РЕАЛТАЙМ СИНХРОНИЗАЦИЯ: Подписываемся на события задач через WebSocket
  useTaskRealtimeSync({
    onTaskCreated: useCallback(() => {
      // Перезагружаем события для синхронизации
      if (isOpen) {
        loadEvents();
      }
    }, [isOpen]),
    onTaskUpdated: useCallback(() => {
      // Перезагружаем события для синхронизации
      if (isOpen) {
        loadEvents();
      }
    }, [isOpen]),
    onTaskDeleted: useCallback((taskId: string) => {
      // Удаляем задачу из локального состояния
      const normalizeTaskId = (id: string) => id.startsWith('task_') ? id.replace('task_', '') : id;
      const normalizedTaskId = normalizeTaskId(taskId);
      
      setAllEvents(prevEvents => 
        prevEvents.filter(event => {
          if (event.type !== EventType.TASK) return true;
          
          const eventTaskId = typeof event.taskId === 'string' 
            ? event.taskId 
            : (event.taskId as any)?._id;
          
          const normalizedEventTaskId = normalizeTaskId(eventTaskId || event._id);
          
          return normalizedEventTaskId !== normalizedTaskId && 
                 event._id !== taskId && 
                 event._id !== `task_${normalizedTaskId}`;
        })
      );
      
      // Удаляем из tasksDataMap
      setTasksDataMap(prev => {
        const newMap = new Map(prev);
        newMap.delete(normalizedTaskId);
        newMap.delete(taskId);
        newMap.delete(`task_${normalizedTaskId}`);
        return newMap;
      });
    }, []),
    onError: (error) => {
      console.error('[CalendarViewModal] Realtime sync error:', error);
    }
  });
  
  // РЕАЛТАЙМ СИНХРОНИЗАЦИЯ: Подписываемся на события календаря через WebSocket
  useEffect(() => {
    if (!isOpen) return;
    
    const listeners: Array<{ event: string; fn: (env: PushEnvelope<any>) => void }> = [];
    
    // Подписываемся на создание событий календаря
    const onEventCreated = onPush<CalendarEvent>('calendar:event:created', () => {
      if (isOpen) {
        loadEvents();
      }
    });
    listeners.push({ event: 'calendar:event:created', fn: onEventCreated });
    
    // Подписываемся на обновление событий календаря
    const onEventUpdated = onPush<CalendarEvent>('calendar:event:updated', () => {
      if (isOpen) {
        loadEvents();
      }
    });
    listeners.push({ event: 'calendar:event:updated', fn: onEventUpdated });
    
    // Подписываемся на удаление событий календаря
    const onEventDeleted = onPush<{ id: string }>('calendar:event:deleted', (env) => {
      const eventId = env.data.id;
      
      // Удаляем событие из локального состояния
      setAllEvents(prevEvents => 
        prevEvents.filter(event => event._id !== eventId)
      );
    });
    listeners.push({ event: 'calendar:event:deleted', fn: onEventDeleted });
    
    // Отписываемся при размонтировании
    return () => {
      listeners.forEach(({ event, fn }) => {
        offPush(event, fn);
      });
    };
  }, [isOpen]);
  
  // УМНОЕ СРАВНЕНИЕ: Используем useMemo для стабильных версий событий на основе умного сравнения
  // Это предотвращает ререндеры модальных окон, если данные не изменились
  
  // Функция для определения urgency и importance из priority
  const getUrgencyImportance = useCallback((priority?: TaskPriority) => {
    if (!priority) return { urgency: false, importance: false };
    switch (priority) {
      case TaskPriority.URGENT_IMPORTANT:
        return { urgency: true, importance: true };
      case TaskPriority.NOT_URGENT_IMPORTANT:
        return { urgency: false, importance: true };
      case TaskPriority.URGENT_NOT_IMPORTANT:
        return { urgency: true, importance: false };
      case TaskPriority.NOT_URGENT_NOT_IMPORTANT:
        return { urgency: false, importance: false };
      default:
        return { urgency: false, importance: false };
    }
  }, []);

  // Функция для определения типа задачи по категории и названию
  const getTaskType = useCallback((_category?: number, eventType?: EventType, eventTitle?: string, eventParticipants?: any[], eventLeadId?: any) => {
    if (eventType === EventType.CALL) return 'call';
    if (eventType === EventType.MEETING) return 'meeting';
    
    // Для задач проверяем название и наличие данных
    if (eventType === EventType.TASK) {
      const title = eventTitle?.toLowerCase() || '';
      // Проверяем название события
      if (title.includes(t('calendarViewModal.meeting')) || title.includes('meeting')) {
        return 'meeting';
      }
      if (title.includes(t('calendarViewModal.call')) || title.includes('call')) {
        return 'call';
      }
      // Проверяем наличие участников (для встреч)
      if (eventParticipants && eventParticipants.length > 0) {
        return 'meeting';
      }
      // Проверяем наличие телефона в leadId (для звонков)
      if (eventLeadId && typeof eventLeadId === 'object' && eventLeadId.phone) {
        return 'call';
      }
    }
    
    return 'standard';
  }, []);

  // Мемоизированный компонент для отдельного события - рендерится только при изменении
  const EventItem = React.memo<{
    event: CalendarEvent;
    index: number;
    onSelect: (event: CalendarEvent) => void;
    onDelete: (event: CalendarEvent) => void;
    onDragStart: (event: CalendarEvent) => void;
    draggedEventId: string | null;
    tasksDataMap?: Map<string, { priority?: TaskPriority; colorLabel?: string; category?: number; workType?: 'work' | 'personal'; hasFiles?: boolean }>;
    isWeekView?: boolean;
  }>(({ event, index: _index, onSelect, onDelete, onDragStart, draggedEventId, tasksDataMap, isWeekView = false }) => {
    // Получаем данные задачи для отображения иконок и цветовой метки
    const taskData = useMemo(() => {
      // Проверяем наличие tasksDataMap
      if (!tasksDataMap || tasksDataMap.size === 0) {
        return null;
      }
      
      // Для событий типа TASK пробуем найти данные по разным ID
      if (event.type === EventType.TASK) {
        // 1. Сначала пробуем по taskId события
        if (event.taskId) {
          const taskIdString = typeof event.taskId === 'string' ? event.taskId : (event.taskId as any)?._id || (event.taskId as any)?.id || '';
          if (taskIdString) {
            const normalizedTaskId = normalizeTaskId(taskIdString);
            
            // Пробуем найти по всем возможным вариантам ID
            let found = tasksDataMap.get(normalizedTaskId);
            if (!found) found = tasksDataMap.get(taskIdString);
            if (!found && !normalizedTaskId.startsWith('task_')) found = tasksDataMap.get(`task_${normalizedTaskId}`);
            if (!found && taskIdString.startsWith('task_')) found = tasksDataMap.get(taskIdString.replace('task_', ''));
            
            if (found) return found;
          }
        }
        
        // 2. Пробуем по ID самого события (для задач из unified API с префиксом task_)
        const eventId = event._id;
        const normalizedEventId = normalizeTaskId(eventId);
        
        let found = tasksDataMap.get(normalizedEventId);
        if (!found) found = tasksDataMap.get(eventId);
        if (!found && !normalizedEventId.startsWith('task_')) found = tasksDataMap.get(`task_${normalizedEventId}`);
        if (!found && eventId.startsWith('task_')) found = tasksDataMap.get(eventId.replace('task_', ''));
        
        if (found) return found;
      }
      
      return null;
    }, [event.type, event.taskId, event._id, tasksDataMap]);

    // Определяем urgency и importance
    const { urgency, importance } = useMemo(() => getUrgencyImportance(taskData?.priority), [taskData?.priority, getUrgencyImportance]);
    
    // Определяем тип задачи
    const taskType = useMemo(() => getTaskType(taskData?.category, event.type, event.title, event.participants, event.leadId), [taskData?.category, event.type, event.title, event.participants, event.leadId, getTaskType]);

    // Мемоизируем вычисляемые значения, чтобы они не пересчитывались при каждом рендере
    // Используем color из события или colorLabel из задачи
    const eventColor = useMemo(() => {
      if (event.color) {
        return event.color;
      }
      // Для событий типа TASK проверяем colorLabel из tasksDataMap
      if (event.type === EventType.TASK && taskData?.colorLabel) {
        return taskData.colorLabel;
      }
      return getEventColor(event.type);
    }, [event.type, event.color, taskData?.colorLabel]);
    const eventBgColor = useMemo(() => {
      if (event.color) {
        // Добавляем прозрачность для фона (15 в hex = примерно 8% прозрачности)
        return `${event.color}15`;
      }
      // Для событий типа TASK проверяем colorLabel из tasksDataMap
      if (event.type === EventType.TASK && taskData?.colorLabel) {
        // Добавляем прозрачность для фона (15 в hex = примерно 8% прозрачности)
        return `${taskData.colorLabel}15`;
      }
      return getEventBgColor(event.type);
    }, [event.type, event.color, taskData?.colorLabel]);
    const isAllDay = useMemo(() => isAllDayEvent(event), [event.isAllDay, event.startTime, event.endTime]);
    const timeRange = useMemo(() => {
      return isAllDay 
        ? t('calendarViewModal.allDay'): `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`;
    }, [isAllDay, event.startTime, event.endTime]);
    
    // Используем useRef для хранения стабильных ссылок, чтобы обработчики не пересоздавались
    const eventRef = useRef(event);
    const onSelectRef = useRef(onSelect);
    const onDeleteRef = useRef(onDelete);
    const onDragStartRef = useRef(onDragStart);
    
    // Обновляем refs при изменении (но обработчики остаются стабильными)
    useEffect(() => {
      eventRef.current = event;
      onSelectRef.current = onSelect;
      onDeleteRef.current = onDelete;
      onDragStartRef.current = onDragStart;
    }, [event, onSelect, onDelete, onDragStart]);
    
    // Мемоизируем обработчики событий с пустыми зависимостями, используя refs
    const handleDragStart = useCallback(() => {
      onDragStartRef.current(eventRef.current);
    }, []);
    
    const handleClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectRef.current(eventRef.current);
    }, []);
    
    const handleDelete = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      onDeleteRef.current(eventRef.current);
    }, []);
    
    // Мемоизируем стили, чтобы они не пересчитывались при каждом рендере
    const isDragged = draggedEventId === event._id;
    const itemStyle = useMemo(() => {
      // Используем цвета, которые уже учитывают colorLabel из задачи
      const borderColor = eventColor;
      const backgroundColor = eventBgColor;
      
      const baseStyle: React.CSSProperties = {
        backgroundColor: backgroundColor,
        opacity: isDragged ? 0.5 : 1,
        cursor: 'grab' as const,
        borderLeft: `4px solid ${borderColor}`,
        // Добавляем легкий border для hover-эффекта без перерисовки
        borderRight: '1px solid transparent',
        borderTop: '1px solid transparent',
        borderBottom: '1px solid transparent',
      };
      // Добавляем transform только для перетаскиваемого элемента, чтобы не конфликтовать с hover
      if (isDragged) {
        baseStyle.transform = 'scale(0.95)';
      }
      return baseStyle;
    }, [eventBgColor, eventColor, isDragged]);
    
    // Мемоизируем className, чтобы он не пересчитывался при каждом рендере
    // Используем легкий hover-эффект через border, который не вызывает перерисовку
    const itemClassName = useMemo(() => {
      const baseClasses = 'min-h-13.5 flex-1 rounded-lg flex items-center p-4 gap-4 cursor-pointer group relative';
      if (isDragged) {
        return `${baseClasses} transition-transform duration-200`;
      }
      // Используем только border-color transition, который не вызывает перерисовку
      // Это более производительно, чем тени или transform
      return `${baseClasses} transition-colors duration-200 hover:border-gray-300`;
    }, [isDragged]);
    
    // Функция для рендеринга иконок (размеры как в TaskCard для десктопа)
    const renderIcon = (iconType: string) => {
      switch (iconType) {
        case 'redLightning':
          return (
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19.0723 11.1734C19.0231 11.0678 18.9172 11 18.8005 11H15.2455L18.754 5.46051C18.8125 5.36812 18.8161 5.25112 18.7633 5.15543C18.7105 5.05941 18.6097 5 18.5005 5H13.7005C13.5868 5 13.483 5.0642 13.432 5.1659L8.93202 14.1659C8.88551 14.2586 8.89061 14.369 8.94521 14.4575C9.00012 14.546 9.09642 14.6 9.20051 14.6H12.2854L8.9239 22.5836C8.8666 22.7201 8.91761 22.8785 9.04389 22.9559C9.09248 22.9856 9.14648 23 9.2002 23C9.28629 23 9.3712 22.9631 9.43001 22.8935L19.03 11.4935C19.1053 11.4041 19.1215 11.2793 19.0723 11.1734Z" fill="#FF070B"/>
            </svg>
          );
        case 'yellowBookmark':
          return (
            <svg width="27" height="27" viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g clipPath={`url(#clip0_event_${event._id})`}>
                <path d="M18.4582 5H8.59461C7.79129 5 7.08594 5.66085 7.08594 6.44309V21.0343C7.08594 21.2962 7.15881 21.5144 7.27627 21.683C7.41673 21.8846 7.64289 22.0001 7.88541 22C8.1147 22 8.35882 21.8979 8.58427 21.7054L12.9972 17.9585C13.1335 17.8421 13.3293 17.7754 13.5329 17.7754C13.7363 17.7754 13.9317 17.8421 14.0684 17.9589L18.4666 21.7048C18.6929 21.8979 18.9202 22.0001 19.149 22.0001C19.5361 22.0001 19.9134 21.7015 19.9134 21.0344V6.44309C19.9134 5.66085 19.2615 5 18.4582 5Z" fill="#F6B000"/>
              </g>
              <defs>
                <clipPath id={`clip0_event_${event._id}`}>
                  <rect width="17" height="17" fill="white" transform="translate(5 5)"/>
                </clipPath>
              </defs>
            </svg>
          );
        case 'call':
          return (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20.01 15.38C18.78 15.38 17.59 15.18 16.45 14.82C16.3 14.75 16.13 14.72 15.96 14.72C15.75 14.72 15.54 14.78 15.35 14.88L12.8 16.53C10.07 15.24 8.76 13.93 7.47 11.2L9.12 8.65C9.32 8.46 9.47 8.22 9.54 7.96C9.62 7.7 9.61 7.42 9.52 7.17C9.16 6.03 8.96 4.84 8.96 3.62C8.96 3.13 8.56 2.73 8.07 2.73H4.28C3.79 2.73 3 2.73 3 3.62C3 13.61 10.39 21 20.38 21C21.27 21 21.27 20.21 21.27 19.72V15.93C21.27 15.44 20.87 15.04 20.38 15.04L20.01 15.38Z" fill="#666666"/>
            </svg>
          );
        case 'meeting':
          return (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="#666666"/>
              <path d="M18 10C19.1 10 20 9.1 20 8C20 6.9 19.1 6 18 6C16.9 6 16 6.9 16 8C16 9.1 16.9 10 18 10ZM18 12C16.34 12 13 12.68 13 14.33V16H23V14.33C23 12.68 19.66 12 18 12Z" fill="#666666"/>
            </svg>
          );
        case 'paperclip':
          return (
            <svg width="12" height="20" viewBox="0 0 14 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 0H5C3.6744 0.00156145 2.40353 0.528847 1.46619 1.46619C0.528847 2.40353 0.00156145 3.6744 0 5V25C0 25.2652 0.105357 25.5196 0.292893 25.7071C0.48043 25.8946 0.734784 26 1 26C1.26522 26 1.51957 25.8946 1.70711 25.7071C1.89464 25.5196 2 25.2652 2 25V5C2.00087 4.20462 2.31722 3.44206 2.87964 2.87964C3.44206 2.31722 4.20462 2.00087 5 2H9C9.79538 2.00087 10.5579 2.31722 11.1204 2.87964C11.6828 3.44206 11.9991 4.20462 12 5V21C12 21.7956 11.6839 22.5587 11.1213 23.1213C10.5587 23.6839 9.79565 24 9 24C8.20435 24 7.44129 23.6839 6.87868 23.1213C6.31607 22.5587 6 21.7956 6 21V8C6 7.73478 6.10536 7.48043 6.29289 7.29289C6.48043 7.10536 6.73478 7 7 7C7.26522 7 7.51957 7.10536 7.70711 7.29289C7.89464 7.48043 8 7.73478 8 8V20C8 20.2652 8.10536 20.5196 8.29289 20.7071C8.48043 20.8946 8.73478 21 9 21C9.26522 21 9.51957 20.8946 9.70711 20.7071C9.89464 20.5196 10 20.2652 10 20V8C10 7.20435 9.68393 6.44129 9.12132 5.87868C8.55871 5.31607 7.79565 5 7 5C6.20435 5 5.44129 5.31607 4.87868 5.87868C4.31607 6.44129 4 7.20435 4 8V21C4 22.3261 4.52678 23.5979 5.46447 24.5355C6.40215 25.4732 7.67392 26 9 26C10.3261 26 11.5979 25.4732 12.5355 24.5355C13.4732 23.5979 14 22.3261 14 21V5C13.9984 3.6744 13.4712 2.40353 12.5338 1.46619C11.5965 0.528847 10.3256 0.00156145 9 0Z" fill="#555454"/>
            </svg>
          );
        default:
          return null;
      }
    };

    return (
      <div 
        key={event._id}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        data-event-item
        className={itemClassName}
        style={itemStyle}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
          <circle cx="11" cy="11" r="8" fill={eventColor}/>
        </svg>
        <span className='w-37.5 text-sm font-medium text-gray-700 flex-shrink-0'>{timeRange}</span>
        <span className='flex-1 min-w-37.5 text-xs font-medium text-gray-900 truncate' title={event.title}>
          {event.title.length > 35 ? `${event.title.substring(0, 35)}...` : event.title}
        </span>
        
        {/* Иконки с фиксированными слотами - каждая иконка занимает свое место */}
        <div className="flex items-center justify-end ml-2 gap-1 flex-shrink-0">
          {/* Слот 1: Иконка телефона/встречи (только в режиме недели) */}
          {isWeekView && (
            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
              {(event.type === EventType.CALL || (event.type === EventType.TASK && taskType === 'call')) && (
                <Tooltip text={t('calendarViewModal.call1')}>
                  <div className="flex-shrink-0">
                    {renderIcon('call')}
                  </div>
                </Tooltip>
              )}
              {(event.type === EventType.MEETING || (event.type === EventType.TASK && taskType === 'meeting')) && (
                <Tooltip text={t('calendarViewModal.meeting1')}>
                  <div className="flex-shrink-0">
                    {renderIcon('meeting')}
                  </div>
                </Tooltip>
              )}
            </div>
          )}
          
          {/* Слот 2: Бейдж типа задачи Л/Р */}
          <div className="w-6 h-5 flex items-center justify-center flex-shrink-0">
            {taskData?.workType && (
              <Tooltip text={taskData.workType === 'work' ? t('calendarViewModal.working'): t('calendarViewModal.personal')}>
                <span className={`px-1.5 py-0.5 rounded-[4px] text-base flex-shrink-0 ${
                  taskData.workType === 'work'
                    ? 'bg-[color-mix(in_srgb,var(--accent)_20%,var(--secondary))] text-[var(--accent)]'
                    : 'bg-[color-mix(in_srgb,var(--primary)_15%,var(--secondary))] text-[rgba(255,255,255,0.72)]'
                }`}>
                  {taskData.workType === 'work' ? t('calendarViewModal.r'): t('calendarViewModal.l')}
                </span>
              </Tooltip>
            )}
          </div>
          
          {/* Слот 3: Иконка срочно (redLightning) */}
          <div className="w-7 h-5 flex items-center justify-center flex-shrink-0">
            {urgency && (
              <Tooltip text={t('calendarViewModal.urgently')}>
                <div className="flex-shrink-0">{renderIcon('redLightning')}</div>
              </Tooltip>
            )}
          </div>
          
          {/* Слот 4: Иконка важно (yellowBookmark) */}
          <div className="w-7 h-5 flex items-center justify-center flex-shrink-0">
            {importance && (
              <Tooltip text={t('calendarViewModal.important')}>
                <div className="flex-shrink-0">{renderIcon('yellowBookmark')}</div>
              </Tooltip>
            )}
          </div>
          
          {/* Слот 5: Цветовая метка */}
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            {(taskData?.colorLabel || event.color) && (
              <Tooltip text={t('calendarViewModal.colorMark')}>
                <div className="flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="13" cy="13" r="8" fill={eventColor}/>
                  </svg>
                </div>
              </Tooltip>
            )}
          </div>
        </div>
        
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-red-100 rounded text-red-600 flex-shrink-0 ml-2"
          title={t('calendarViewModal.deleteEvent')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M4 12L12 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    );
  }, (prevProps, nextProps) => {
    // Кастомное сравнение: ререндерим только если событие действительно изменилось
    const eventChanged = compareCalendarEvents(prevProps.event, nextProps.event);
    const tasksDataChanged = prevProps.tasksDataMap !== nextProps.tasksDataMap;
    const weekViewChanged = prevProps.isWeekView !== nextProps.isWeekView;
    
    // Если изменились tasksDataMap или isWeekView, нужно проверить, изменились ли данные задачи
    if (tasksDataChanged || weekViewChanged) {
      const prevTaskId = prevProps.event.taskId ? (typeof prevProps.event.taskId === 'string' ? prevProps.event.taskId : prevProps.event.taskId._id) : null;
      const nextTaskId = nextProps.event.taskId ? (typeof nextProps.event.taskId === 'string' ? nextProps.event.taskId : nextProps.event.taskId._id) : null;
      
      if (prevTaskId && nextTaskId && prevTaskId === nextTaskId) {
        const prevTaskData = prevProps.tasksDataMap?.get(prevTaskId);
        const nextTaskData = nextProps.tasksDataMap?.get(nextTaskId);
        if (prevTaskData?.priority !== nextTaskData?.priority ||
            prevTaskData?.colorLabel !== nextTaskData?.colorLabel ||
            prevTaskData?.category !== nextTaskData?.category) {
          return false; // Данные задачи изменились, нужно ререндерить
        }
      }
    }
    
    return eventChanged &&
           prevProps.draggedEventId === nextProps.draggedEventId &&
           prevProps.index === nextProps.index &&
           prevProps.onSelect === nextProps.onSelect &&
           prevProps.onDelete === nextProps.onDelete &&
           prevProps.onDragStart === nextProps.onDragStart &&
           !tasksDataChanged &&
           !weekViewChanged;
  });
  
  EventItem.displayName = 'EventItem';

  // Функция для форматирования даты в формате "ноя, пн"
  const formatDateDay = (date: Date): string => {
    const monthNames = [t('calendarViewModal.jan'), t('calendarViewModal.feb'), t('calendarViewModal.mar'), t('calendarViewModal.apr'), t('calendarViewModal.may'), t('calendarViewModal.jun'), t('calendarViewModal.jul'), t('calendarViewModal.aug'), t('calendarViewModal.sep'), t('calendarViewModal.oct'), t('calendarViewModal.nov'), t('calendarViewModal.dec')];
    const dayNames = [t('calendarViewModal.sun'), t('calendarViewModal.mon'), t('calendarViewModal.tue'), t('calendarViewModal.wed'), t('calendarViewModal.thu'), t('calendarViewModal.fri'), t('calendarViewModal.sat')];
    const month = monthNames[date.getMonth()];
    const dayOfWeek = dayNames[date.getDay()];
    return `${month}, ${dayOfWeek}`;
  };

  // Группировка событий по дням (должна быть определена до использования в useMemo)
  const groupEventsByDay = useCallback((events: CalendarEvent[]): Map<string, CalendarEvent[]> => {
    const grouped = new Map<string, CalendarEvent[]>();
    
    events.forEach(event => {
      const eventDate = new Date(event.startTime);
      const dayKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`;
      
      if (!grouped.has(dayKey)) {
        grouped.set(dayKey, []);
      }
      grouped.get(dayKey)!.push(event);
    });
    
    // Сортируем события внутри каждого дня по времени начала
    grouped.forEach((dayEvents) => {
      dayEvents.sort((a, b) => {
        const timeA = new Date(a.startTime).getTime();
        const timeB = new Date(b.startTime).getTime();
        return timeA - timeB;
      });
    });
    
    return grouped;
  }, []);


  // Функция для получения начала и конца периода на основе currentDate
  const getPeriodDates = useCallback(() => {
    const date = new Date(currentDate);
    if (selectedPeriod === t('calendarViewModal.day')) {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
      const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
      return { start, end };
    } else if (selectedPeriod === t('calendarViewModal.week')) {
      // Неделя: начинаем с понедельника недели, в которой находится currentDate
      const dayOfWeek = date.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Понедельник = 1
      const monday = new Date(date);
      monday.setDate(date.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return { start: monday, end: sunday };
    } else if (selectedPeriod === t('calendarViewModal.month')) {
      // Месяц: первый и последний день месяца
      const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
      return { start, end };
    } else if (selectedPeriod === t('calendarViewModal.schedule')) {
      // Расписание: неделя (как в Google Calendar)
      const dayOfWeek = date.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Понедельник = 0
      const monday = new Date(date);
      monday.setDate(date.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return { start: monday, end: sunday };
    } else {
      // Год: первый и последний день года
      const start = new Date(date.getFullYear(), 0, 1, 0, 0, 0);
      const end = new Date(date.getFullYear(), 11, 31, 23, 59, 59);
      return { start, end };
    }
  }, [currentDate, selectedPeriod]);

  // Функция для форматирования даты для отображения периода
  const formatPeriodDate = (): string => {
    const monthNames = [t('calendarViewModal.january'), t('calendarViewModal.february'), t('calendarViewModal.march'), t('calendarViewModal.april'), t('calendarViewModal.may1'), t('calendarViewModal.june'), t('calendarViewModal.july'), t('calendarViewModal.august'), t('calendarViewModal.september'), t('calendarViewModal.october'), t('calendarViewModal.november'), t('calendarViewModal.december')];
    const monthNamesGenitive = [t('calendarViewModal.january1'), t('calendarViewModal.february1'), t('calendarViewModal.march1'), t('calendarViewModal.april1'), t('calendarViewModal.may'), t('calendarViewModal.june1'), t('calendarViewModal.july1'), t('calendarViewModal.august1'), t('calendarViewModal.september1'), t('calendarViewModal.october1'), t('calendarViewModal.november1'), t('calendarViewModal.december1')];
    
    if (selectedPeriod === t('calendarViewModal.day')) {
      // Для дня показываем текущий день
      const day = currentDate.getDate();
      const month = monthNames[currentDate.getMonth()];
      const year = currentDate.getFullYear();
      return `${day} ${month}, ${year}`;
    } else if (selectedPeriod === t('calendarViewModal.week')) {
      // Для недели показываем диапазон
      const { start, end } = getPeriodDates();
      const startDay = start.getDate();
      const endDay = end.getDate();
      const month = monthNames[start.getMonth()];
      const year = start.getFullYear();
      return `${startDay}-${endDay} ${month}, ${year}`;
    } else if (selectedPeriod === t('calendarViewModal.month')) {
      // Для месяца показываем месяц и год
      const month = monthNamesGenitive[currentDate.getMonth()];
      const year = currentDate.getFullYear();
      return `${month} ${year}`;
    } else if (selectedPeriod === t('calendarViewModal.schedule')) {
      // Для расписания показываем диапазон недели
      const { start, end } = getPeriodDates();
      const startDay = start.getDate();
      const endDay = end.getDate();
      const month = monthNames[start.getMonth()];
      const year = start.getFullYear();
      return `${startDay}-${endDay} ${month}, ${year}`;
    } else {
      // Для года показываем только год
      return `${currentDate.getFullYear()}`;
    }
  };

  // Функции навигации по календарю
  const handlePreviousPeriod = () => {
    const newDate = new Date(currentDate);
    if (selectedPeriod === t('calendarViewModal.day')) {
      newDate.setDate(newDate.getDate() - 1);
    } else if (selectedPeriod === t('calendarViewModal.week')) {
      // Для недели переходим на предыдущую неделю
      newDate.setDate(newDate.getDate() - 7);
    } else if (selectedPeriod === t('calendarViewModal.month')) {
      // Для месяца переходим на предыдущий месяц
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (selectedPeriod === t('calendarViewModal.schedule')) {
      // Для расписания переходим на предыдущую неделю
      newDate.setDate(newDate.getDate() - 7);
    } else {
      // Для года переходим на предыдущий год
      newDate.setFullYear(newDate.getFullYear() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNextPeriod = () => {
    const newDate = new Date(currentDate);
    if (selectedPeriod === t('calendarViewModal.day')) {
      newDate.setDate(newDate.getDate() + 1);
    } else if (selectedPeriod === t('calendarViewModal.week')) {
      // Для недели переходим на следующую неделю
      newDate.setDate(newDate.getDate() + 7);
    } else if (selectedPeriod === t('calendarViewModal.month')) {
      // Для месяца переходим на следующий месяц
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (selectedPeriod === t('calendarViewModal.schedule')) {
      // Для расписания переходим на следующую неделю
      newDate.setDate(newDate.getDate() + 7);
    } else {
      // Для года переходим на следующий год
      newDate.setFullYear(newDate.getFullYear() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    // Переключаемся на дневной вид с текущей датой
    setSelectedPeriod(t('calendarViewModal.day'));
  };

  // Обработчик клика на день в мини-календаре
  const handleCalendarDayClick = useCallback((_day: number, date: Date) => {
    // Создаем новую дату с нулевым временем в локальном часовом поясе
    
    // Устанавливаем дату начала и окончания
    // Календарь только отображает задачи, не создает их
    setCurrentDate(date);
    // Переключаем на режим "День", если был выбран "Неделя"
    if (selectedPeriod === t('calendarViewModal.week')) {
      setSelectedPeriod(t('calendarViewModal.day'));
    }
  }, [selectedPeriod]);

  // Преобразование задач в события календаря
  // ВАЖНО: Функция удалена, так как не используется.
  // Основная логика загрузки событий использует unified API и обрабатывает задачи отдельно в loadEvents()

  // Загрузка событий из API (использует unified API для событий и getTasks для полных данных задач)
  const loadEvents = useCallback(async () => {
    if (!user?.id) return;
    
    if (isFirstLoadRef.current) {
      setLoading(true);
    }
    setError(null);
    
    try {
      const { start, end } = getPeriodDates();
      
      // Загружаем события календаря через unified API
      const unifiedResponse = await calendarCrmService.getCalendarUnified({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        userId: user.id,
        userRole: user.role,
      });
      
      // Загружаем ВСЕ задачи пользователя через getTasks API (чтобы получить полные данные с категориями)
      const tasksResponse = await crmTaskService.getTasks({
        page: 1,
        limit: 500, // Увеличиваем лимит, чтобы получить все задачи
        assignedTo: user.id,
      });
      
      if (unifiedResponse.success && unifiedResponse.data && tasksResponse.success && tasksResponse.data) {
        const allTasksFromGetTasks = tasksResponse.data.items || [];

        // Устанавливаем события календаря
        const calendarEvents = unifiedResponse.data.events || [];
        const fieldsToCompareEvents = ['_id', 'title', 'startTime', 'endTime', 'type', 'status', 'description', 'location', 'meetingUrl', 'isAllDay', 'leadId', 'taskId', 'participants', 'externalParticipants', 'reminderMinutes', 'isRecurring', 'recurringRule'];
        setEvents(prevEvents => {
          if (prevEvents.length === calendarEvents.length && compareArrays(prevEvents, calendarEvents, '_id', fieldsToCompareEvents)) {
            return prevEvents; // данные идентичны — не трогаем состояние
          }
          return calendarEvents;
        });
        
        // Получаем ID задач, которые уже представлены как события календаря
        // (чтобы избежать дублирования)
        // Нормализуем ID: убираем префикс task_ для сравнения
        const normalizeTaskId = (id: string): string => {
          return id.startsWith('task_') ? id.replace('task_', '') : id;
        };
        
        const taskIdsInEvents = new Set<string>();
        const eventIdsFromTasks = new Set<string>(); // ID событий, которые уже связаны с задачами
        
        calendarEvents.forEach(event => {
          if (event.type === EventType.TASK && event.taskId) {
            const taskId = typeof event.taskId === 'string' ? event.taskId : event.taskId._id;
            // Нормализуем ID для сравнения (убираем префикс task_)
            const normalizedTaskId = normalizeTaskId(taskId);
            taskIdsInEvents.add(normalizedTaskId);
            // Также добавляем ID события, чтобы исключить задачи, которые уже связаны с этим событием
            eventIdsFromTasks.add(event._id);
          }
        });
        
        // Преобразуем только те задачи из unified API, которые еще не представлены как события
        const tasksFromUnified = unifiedResponse.data.tasks || [];
        
        const taskEvents: CalendarEvent[] = tasksFromUnified
          .filter(task => {
            // Исключаем задачи, которые:
            // 1. Не принадлежат текущему пользователю
            // 2. Уже есть в событиях календаря (проверяем по taskId)
            // 3. Уже связаны с событием календаря (проверяем по calendarEventId)
            // 4. Не имеют startDate или endDate (не могут быть отображены в календаре)
            
            // ВАЖНО: Проверяем, что задача принадлежит текущему пользователю
            // Ищем задачу в списке allTasksFromGetTasks (который уже отфильтрован по assignedTo)
            const normalizedTaskId = normalizeTaskId(task._id);
            const taskBelongsToUser = allTasksFromGetTasks.some(t => {
              const tNormalizedId = normalizeTaskId(t._id);
              return tNormalizedId === normalizedTaskId;
            });
            
            if (!taskBelongsToUser) {
              return false; // Задача не принадлежит текущему пользователю
            }
            
            // Задачи без startDate не могут быть отображены в календаре
            if (!task.startDate) {
              return false;
            }
            
            // Проверяем валидность startDate
            const startDateCheck = new Date(task.startDate);
            if (isNaN(startDateCheck.getTime())) {
              return false; // Невалидная дата начала
            }
            
            // endDate может отсутствовать - в этом случае будет использована дефолтная длительность
            
            // Проверяем, есть ли уже событие для этой задачи
            if (taskIdsInEvents.has(normalizedTaskId)) {
              return false; // Задача уже представлена как событие
            }
            
            // Проверяем, есть ли у задачи уже связанное событие календаря
            // Примечание: calendarEventId не существует в типе Task из unified API
            // Этот код закомментирован, так как структура данных изменилась
            // if ('calendarEventId' in task && task.calendarEventId) {
            //   const hasCalendarEvent = calendarEvents.some(e => e._id === task.calendarEventId);
            //   if (hasCalendarEvent) {
            //     return false;
            //   }
            // }
            
            return true; // Задача может быть преобразована в событие
          })
          .map(task => {
            // Согласно документации: задачи в unified view имеют ID с префиксом task_
            // Бэкенд уже возвращает ID с префиксом, но на всякий случай проверяем
            const taskId = task._id.startsWith('task_') ? task._id : `task_${task._id}`;
            // taskId в событии должен содержать нормализованный ID задачи (без префикса) для связи с tasksDataMap
            const normalizedTaskId = normalizeTaskId(task._id);
            
            // ВАЖНО: Используем данные из getTasks API для получения реальных startDate и endDate
            // Ищем полные данные задачи в allTasksFromGetTasks
            const fullTaskData = allTasksFromGetTasks.find(t => {
              const tNormalizedId = normalizeTaskId(t._id);
              return tNormalizedId === normalizedTaskId;
            });
            
            // Используем данные из getTasks API, если они есть, иначе используем данные из unified API
            const taskStartDate = fullTaskData?.startDate || task.startDate;
            const taskEndDate = fullTaskData?.endDate || task.endDate;
            
            // Проверяем валидность startDate (обязательна)
            if (!taskStartDate) {
              console.warn('[CalendarViewModal] ⚠️ Task without startDate, skipping:', {
                taskId: task._id,
                taskTitle: task.title
              });
              return null; // Пропускаем задачи без даты начала
            }
            
            const startDate = new Date(taskStartDate);
            if (isNaN(startDate.getTime())) {
              console.warn('[CalendarViewModal] ⚠️ Task with invalid startDate, skipping:', {
                taskId: task._id,
                taskTitle: task.title,
                taskStartDate
              });
              // Пропускаем задачи с невалидной датой начала
              return null;
            }
            
            // Вычисляем endDate: используем реальную дату окончания из задачи
            let endDate: Date;
            if (taskEndDate) {
              endDate = new Date(taskEndDate);
              if (isNaN(endDate.getTime())) {
                console.warn('[CalendarViewModal] ⚠️ Task with invalid endDate, using default duration:', {
                  taskId: task._id,
                  taskTitle: task.title,
                  taskEndDate
                });
                // endDate невалиден, используем дефолтную длительность (1 час)
                endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
              } else {
                // Используем реальную дату окончания, даже если она совпадает с началом
                // Это позволяет отображать задачи с реальной длительностью
                // Если endDate раньше startDate, это ошибка данных - используем дефолт
                if (endDate.getTime() < startDate.getTime()) {
                  console.warn('[CalendarViewModal] ⚠️ Task endDate is before startDate, using default duration:', {
                    taskId: task._id,
                    taskTitle: task.title,
                    taskStartDate,
                    taskEndDate,
                    startDateISO: startDate.toISOString(),
                    endDateISO: endDate.toISOString()
                  });
                  endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
                }
                // Если endDate равен startDate, это может быть задача без указанной длительности
                // Но мы используем реальную дату, чтобы не терять информацию
              }
            } else {
              console.warn('[CalendarViewModal] ⚠️ Task without endDate, using default duration (1 hour):', {
                taskId: task._id,
                taskTitle: task.title,
                taskStartDate
              });
              // endDate отсутствует, используем дефолтную длительность (1 час)
              endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
            }
            
            return {
              _id: taskId,
              title: task.title,
              description: task.description,
              startTime: startDate.toISOString(),
              endTime: endDate.toISOString(),
              type: EventType.TASK,
              status: task.status === 'completed' ? EventStatus.COMPLETED : EventStatus.SCHEDULED,
              isAllDay: false,
              // taskId содержит нормализованный ID задачи (без префикса) для связи с tasksDataMap
              taskId: normalizedTaskId,
              createdBy: user.id,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            } as CalendarEvent;
          })
          .filter((event): event is CalendarEvent => event !== null); // Убираем null значения (задачи с невалидными датами)
        
        // Сохраняем данные задач в Map для быстрого доступа
        // Используем данные из getTasks API, так как они содержат полную информацию о категориях
        const newTasksDataMap = new Map<string, { priority?: TaskPriority; colorLabel?: string; category?: number; workType?: 'work' | 'personal'; hasFiles?: boolean }>();
        
        // Сохраняем данные для всех задач из getTasks API (там полные данные с categories)
        allTasksFromGetTasks.forEach(task => {
          const taskTyped = task as any;
          const normalizedTaskId = normalizeTaskId(task._id);
          
          // Определяем hasFiles - проверяем оба варианта
          const hasFiles = taskTyped.hasFiles || (Array.isArray(taskTyped.files) && taskTyped.files.length > 0);
          
          // Определяем workType из categories
          let workType: 'work' | 'personal' | undefined = undefined;
          if (taskTyped.categories && Array.isArray(taskTyped.categories)) {
            const hasWork = (taskTyped.categories as string[]).some((cat: string) => cat.includes(t('calendarViewModal.workTasks')));
            const hasPersonal = (taskTyped.categories as string[]).some((cat: string) => cat.includes(t('calendarViewModal.personalTasks')));
            
            if (hasWork) {
              workType = 'work';
            } else if (hasPersonal) {
              workType = 'personal';
            }
            
          } else {
          }
          
          
          const taskData: { priority?: TaskPriority; colorLabel?: string; category?: number; workType?: 'work' | 'personal'; hasFiles?: boolean } = {
            priority: task.priority as TaskPriority,
            colorLabel: task.colorLabel,
            category: task.category,
            workType,
            hasFiles,
          };
          // Сохраняем с нормализованным ID (без префикса)
          newTasksDataMap.set(normalizedTaskId, taskData);
          // Также сохраняем с префиксом task_ для совместимости
          if (!normalizedTaskId.startsWith('task_')) {
            newTasksDataMap.set(`task_${normalizedTaskId}`, taskData);
          }
          // И с исходным ID, если он отличается
          if (task._id !== normalizedTaskId && task._id !== `task_${normalizedTaskId}`) {
            newTasksDataMap.set(task._id, taskData);
          }
        });
        
        // Также сохраняем/обновляем данные для задач, которые уже есть в событиях календаря
        // (на случай если в событии есть дополнительные данные, которых нет в списке задач)
        calendarEvents.forEach(event => {
          if (event.type === EventType.TASK && event.taskId) {
            const taskId = typeof event.taskId === 'string' ? event.taskId : event.taskId._id;
            const normalizedTaskId = normalizeTaskId(taskId);
            
            // Проверяем, есть ли уже данные для этой задачи
            if (!newTasksDataMap.has(normalizedTaskId)) {
              // Ищем задачу в списке задач из getTasks по ID
              const task = allTasksFromGetTasks.find(t => {
                const taskNormalizedId = normalizeTaskId(t._id);
                return taskNormalizedId === normalizedTaskId || t._id === taskId || t._id === normalizedTaskId;
              });
              
              if (task) {
                const taskTyped = task as any;
                const hasFiles = taskTyped.hasFiles || (Array.isArray(taskTyped.files) && taskTyped.files.length > 0);
                let workType: 'work' | 'personal' | undefined = undefined;
                if (taskTyped.categories && Array.isArray(taskTyped.categories)) {
                  const hasWork = (taskTyped.categories as string[]).some((cat: string) => cat.includes(t('calendarViewModal.workTasks')));
                  const hasPersonal = (taskTyped.categories as string[]).some((cat: string) => cat.includes(t('calendarViewModal.personalTasks')));
                  
                  if (hasWork) {
                    workType = 'work';
                  } else if (hasPersonal) {
                    workType = 'personal';
                  }
                  
                }

                const taskData: { priority?: TaskPriority; colorLabel?: string; category?: number; workType?: 'work' | 'personal'; hasFiles?: boolean } = {
                  priority: task.priority as TaskPriority,
                  colorLabel: task.colorLabel,
                  category: task.category,
                  workType,
                  hasFiles,
                };
                // Сохраняем с нормализованным ID
                if (!newTasksDataMap.has(normalizedTaskId)) {
                  newTasksDataMap.set(normalizedTaskId, taskData);
                }
                // Также сохраняем с префиксом task_ для совместимости
                if (!normalizedTaskId.startsWith('task_') && !newTasksDataMap.has(`task_${normalizedTaskId}`)) {
                  newTasksDataMap.set(`task_${normalizedTaskId}`, taskData);
                }
                // И с исходным ID
                if (taskId !== normalizedTaskId && taskId !== `task_${normalizedTaskId}` && !newTasksDataMap.has(taskId)) {
                  newTasksDataMap.set(taskId, taskData);
                }
              }
            }
          }
        });
        
        setTasksDataMap(newTasksDataMap);
        
        // Объединяем события календаря и задачи (без дублирования)
        const combinedEvents = [
          ...calendarEvents,
          ...taskEvents,
        ];
        
        // УМНОЕ СРАВНЕНИЕ: Обновляем только если данные действительно изменились
        // Это предотвращает лишние ререндеры и моргание модальных окон
        const fieldsToCompare = ['_id', 'title', 'startTime', 'endTime', 'type', 'status', 'description', 'location', 'meetingUrl', 'isAllDay', 'leadId', 'taskId', 'participants', 'externalParticipants', 'reminderMinutes', 'isRecurring', 'recurringRule'];
        
        setAllEvents(prevEvents => {
          // Сначала проверяем длину массивов для быстрой проверки
          if (prevEvents.length !== combinedEvents.length) {
            // Обновляем Map отрендеренных событий
            renderedEventsRef.current.clear();
            combinedEvents.forEach(event => {
              renderedEventsRef.current.set(event._id, event);
            });
            return combinedEvents; // Количество событий изменилось
          }
          
          // Используем глубокое сравнение всех полей
          if (compareArrays(prevEvents, combinedEvents, '_id', fieldsToCompare)) {
            return prevEvents; // Данные не изменились, возвращаем предыдущее состояние (предотвращает ререндер)
          }
          
          // Обновляем Map отрендеренных событий только для измененных событий
          combinedEvents.forEach(event => {
            const existing = renderedEventsRef.current.get(event._id);
            if (!existing || !compareCalendarEvents(existing, event)) {
              // Событие новое или изменилось - обновляем в Map
              renderedEventsRef.current.set(event._id, event);
            }
            // Если событие идентично - не трогаем Map, оно уже там есть
          });
          
          // Удаляем события, которых больше нет
          const currentIds = new Set(combinedEvents.map(e => e._id));
          renderedEventsRef.current.forEach((_, id) => {
            if (!currentIds.has(id)) {
              renderedEventsRef.current.delete(id);
            }
          });
          
          return combinedEvents; // Данные изменились, обновляем состояние
        });
        
        // УМНОЕ СРАВНЕНИЕ: Обновляем selectedEvent и eventToEdit ТОЛЬКО если они не null (модалки открыты) И данные изменились
        // НЕ вызываем setState если модалки закрыты - это предотвращает ненужные обновления
        // Используем нормализацию ID для поиска событий (учитываем префикс task_)
        const normalizeId = (id: string) => {
          if (id.startsWith('task_')) {
            return { withPrefix: id, withoutPrefix: id.replace('task_', '') };
          }
          return { withPrefix: `task_${id}`, withoutPrefix: id };
        };
        
        if (selectedEvent) {
          const selectedIdVariants = normalizeId(selectedEvent._id);
          const updated = combinedEvents.find(e => {
            const eventIdVariants = normalizeId(e._id);
            return e._id === selectedEvent._id ||
                   eventIdVariants.withPrefix === selectedIdVariants.withPrefix ||
                   eventIdVariants.withoutPrefix === selectedIdVariants.withoutPrefix;
          });
          if (updated && !compareCalendarEvents(selectedEvent, updated)) {
            // Данные изменились - обновляем
            setSelectedEvent(updated);
          }
          // Если данные идентичны - НЕ вызываем setState вообще
        }
        
        if (eventToEdit) {
          const editIdVariants = normalizeId(eventToEdit._id);
          const updated = combinedEvents.find(e => {
            const eventIdVariants = normalizeId(e._id);
            return e._id === eventToEdit._id ||
                   eventIdVariants.withPrefix === editIdVariants.withPrefix ||
                   eventIdVariants.withoutPrefix === editIdVariants.withoutPrefix;
          });
          if (updated && !compareCalendarEvents(eventToEdit, updated)) {
            // Данные изменились - обновляем
            setEventToEdit(updated);
          }
          // Если данные идентичны - НЕ вызываем setState вообще
        }
        
        // Сохраняем задачи для отображения (только задачи с валидными датами)
        const tasksList = (unifiedResponse.data.tasks || [])
          .filter(task => {
            // Фильтруем только задачи с валидными датами
            if (!task.startDate || !task.endDate) return false;
            const startDate = new Date(task.startDate);
            const endDate = new Date(task.endDate);
            return !isNaN(startDate.getTime()) && !isNaN(endDate.getTime());
          })
          .map(task => {
            // Даты уже проверены в фильтре, можно безопасно конвертировать
            const startDate = new Date(task.startDate!);
            const endDate = new Date(task.endDate!);
            
            return {
              _id: task._id,
              title: task.title,
              description: task.description,
              priority: task.priority as any,
              status: task.status as any,
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString(),
              assignedTo: user.id,
            } as Task;
          });
        setTasks(tasksList);
      } else {
        setError(unifiedResponse.message || t('calendarViewModal.errorLoadingEvents'));
      }
    } catch (err: any) {
      setError(err.message || t('calendarViewModal.errorLoadingEvents1'));
      console.error('Error loading calendar events:', err);
      // Fallback на старый метод при ошибке
      try {
        const { start: fallbackStart, end: fallbackEnd } = getPeriodDates();
        const eventsResponse = await calendarCrmService.getCalendarEventsView({
          startDate: fallbackStart.toISOString(),
          endDate: fallbackEnd.toISOString(),
          userId: user.id,
          userRole: user.role,
        });
        if (eventsResponse.success && eventsResponse.data) {
          const fallbackEvents = eventsResponse.data;
          const fieldsToCompare = ['_id', 'title', 'startTime', 'endTime', 'type', 'status', 'description', 'location', 'meetingUrl', 'isAllDay', 'leadId', 'taskId', 'participants', 'externalParticipants', 'reminderMinutes', 'isRecurring', 'recurringRule'];

          setEvents(prevEvents => {
            if (prevEvents.length === fallbackEvents.length && compareArrays(prevEvents, fallbackEvents, '_id', fieldsToCompare)) {
              return prevEvents; // данные идентичны — не трогаем состояние
            }
            return fallbackEvents;
          });
          
          // Используем сравнение для fallback случая тоже
          setAllEvents(prevEvents => {
            if (prevEvents.length !== fallbackEvents.length) {
              return fallbackEvents; // Количество событий изменилось
            }
            if (compareArrays(prevEvents, fallbackEvents, '_id', fieldsToCompare)) {
              return prevEvents; // Данные не изменились
            }
            return fallbackEvents; // Данные изменились
          });
        }
      } catch (fallbackErr) {
        console.error('Fallback error:', fallbackErr);
      }
    } finally {
      if (isFirstLoadRef.current) {
        isFirstLoadRef.current = false;
      }
      setLoading(false);
    }
  }, [user?.id, user?.role, currentDate, selectedPeriod, getPeriodDates]);

  // МЕМОИЗАЦИЯ: Фильтруем и группируем события только при изменении allEvents или searchQuery
  // Это предотвращает лишние пересчеты при каждом рендере
  // ВАЖНО: Должно быть определено ДО if (!isOpen) return null;
  const filteredEventsForWeek = useMemo(() => {
    return searchQuery 
      ? allEvents.filter(event => 
          event.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : allEvents;
  }, [allEvents, searchQuery]);
  
  const groupedEventsForWeek = useMemo(() => {
    return groupEventsByDay(filteredEventsForWeek);
  }, [filteredEventsForWeek, groupEventsByDay]);
  
  // МЕМОИЗАЦИЯ: Фильтруем события для дня только при изменении allEvents, currentDate или searchQuery
  const dayEventsForDay = useMemo(() => {
    // Определяем границы текущего дня
    const dayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 23, 59, 59, 999);
    
    return allEvents.filter(event => {
      const eventStart = new Date(event.startTime);
      const eventEnd = new Date(event.endTime);
      
      // Событие должно пересекаться с текущим днем (начинается до конца дня и заканчивается после начала дня)
      const intersectsDay = eventStart.getTime() <= dayEnd.getTime() && eventEnd.getTime() >= dayStart.getTime();
      
      // Фильтруем по поисковому запросу, если он есть
      const matchesSearch = !searchQuery || 
        event.title.toLowerCase().includes(searchQuery.toLowerCase());
      
      return intersectsDay && matchesSearch;
    });
  }, [allEvents, currentDate, searchQuery]);

  // Загружаем события при открытии модального окна
  useEffect(() => {
    if (isOpen && user?.id) {
      loadEvents();
    }
  }, [isOpen, user?.id]);
  
  // РЕАЛТАЙМ СИНХРОНИЗАЦИЯ: WebSocket + fallback polling
  // Основная синхронизация через WebSocket, но для надежности добавляем polling каждые 30 секунд
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    
    // Fallback polling каждые 30 секунд (на случай проблем с WebSocket)
    const interval = setInterval(() => {
      // Умное сравнение в loadEvents предотвратит лишние обновления
      loadEvents();
    }, 30000); // 30 секунд
    
    return () => clearInterval(interval);
  }, [isOpen, user?.id, loadEvents]);

  // Сбрасываем currentDate на сегодня и очищаем поиск при открытии модального окна
  useEffect(() => {
    if (isOpen) {
      setCurrentDate(new Date());
      setSearchQuery('');
    }
  }, [isOpen]);

  // Автоматическая прокрутка до 7:00 в режиме "День"
  useEffect(() => {
    if (!isOpen || selectedPeriod !== t('calendarViewModal.day')) return;
    
    // Небольшая задержка, чтобы дать время на рендеринг
    const timeoutId = setTimeout(() => {
      const timeline = document.getElementById('day-view-timeline');
      if (timeline) {
        // Прокрутка до 7:00 (7 * 60px = 420px)
        // Каждый час занимает 60px
        // Используем smooth scroll для плавной прокрутки
        timeline.scrollTo({
          top: 7 * 60,
          behavior: 'smooth'
        });
      }
    }, 150);
    
    return () => clearTimeout(timeoutId);
  }, [isOpen, selectedPeriod, currentDate]); // Добавляем currentDate, чтобы прокручивать при смене дня


  // Функция для сброса формы
  const resetEventForm = useCallback(() => {
    setEventFormTitle('');
    setEventFormDescription('');
    setEventFormLocation('');
    setEventFormMeetingUrl('');
    setEventFormLeadId('');
    setEventFormParticipants([]);
    setEventFormExternalParticipants([]);
    setEventFormReminderMinutes([1440, 360, 60]); // Сбрасываем на значения по умолчанию
    setEventFormIsRecurring(false);
    setEventFormRecurringRule('');
    setEventFormIsAllDay(false);
    setEventFormType(EventType.MEETING);
  }, []);

  // Функция для получения цвета события по типу
  const getEventColor = (type: EventType): string => {
    switch (type) {
      case EventType.MEETING:
        return '#246BFD'; // Синий
      case EventType.CALL:
        return '#F7C06D'; // Желтый
      case EventType.REMINDER:
        return '#FF88FA'; // Розовый
      case EventType.TASK:
        return '#9976FF'; // Фиолетовый
      default:
        return '#246BFD';
    }
  };

  // Функция для получения фона события по типу
  const getEventBgColor = (type: EventType): string => {
    switch (type) {
      case EventType.MEETING:
        return 'rgb(229,225,255)'; // Светло-синий
      case EventType.CALL:
        return 'rgb(247,239,226)'; // Светло-желтый
      case EventType.REMINDER:
        return 'rgb(249,228,254)'; // Светло-розовый
      case EventType.TASK:
        return 'rgb(240,235,255)'; // Светло-фиолетовый
      default:
        return 'rgb(229,225,255)';
    }
  };

  // Функция для нормализации ID задачи (убирает префикс task_)
  const normalizeTaskId = (id: string | undefined | null | any): string => {
    if (!id) return '';
    // Если id - объект, пытаемся извлечь строку
    if (typeof id !== 'string') {
      if (id && typeof id === 'object' && id._id) {
        id = id._id;
      } else if (id && typeof id === 'object' && id.id) {
        id = id.id;
      } else {
        return '';
      }
    }
    if (typeof id !== 'string') return '';
    return id.startsWith('task_') ? id.replace('task_', '') : id;
  };

  // Функция для получения цвета события с учетом color из события и colorLabel из задачи
  const getEventColorWithTaskLabel = (event: CalendarEvent): string => {
    // Используем color из события, если он есть (приходит с бэкенда)
    if (event.color) {
      return event.color;
    }
    
    // Для событий типа TASK проверяем colorLabel из tasksDataMap
    if (event.type === EventType.TASK && event.taskId && tasksDataMap && tasksDataMap.size > 0) {
      const taskIdString = typeof event.taskId === 'string' ? event.taskId : (event.taskId as any)?._id || (event.taskId as any)?.id || '';
      if (taskIdString) {
        const normalizedTaskId = normalizeTaskId(taskIdString);
        if (normalizedTaskId) {
          // Пробуем найти по всем возможным вариантам ID
          let taskData = tasksDataMap.get(normalizedTaskId);
          if (!taskData) {
            taskData = tasksDataMap.get(taskIdString);
          }
          if (!taskData && !normalizedTaskId.startsWith('task_')) {
            taskData = tasksDataMap.get(`task_${normalizedTaskId}`);
          }
          if (!taskData && taskIdString.startsWith('task_')) {
            taskData = tasksDataMap.get(taskIdString.replace('task_', ''));
          }
          
          if (taskData?.colorLabel) {
            return taskData.colorLabel;
          }
        }
      }
    }
    
    return getEventColor(event.type);
  };

  // Функция для получения цвета фона события с учетом color из события и colorLabel из задачи
  const getEventBgColorWithTaskLabel = (event: CalendarEvent): string => {
    // Используем color из события, если он есть (приходит с бэкенда)
    if (event.color) {
      // Добавляем прозрачность для фона (15 в hex = примерно 8% прозрачности)
      return `${event.color}15`;
    }
    
    // Для событий типа TASK проверяем colorLabel из tasksDataMap
    if (event.type === EventType.TASK && event.taskId && tasksDataMap && tasksDataMap.size > 0) {
      const taskIdString = typeof event.taskId === 'string' ? event.taskId : (event.taskId as any)?._id || (event.taskId as any)?.id || '';
      if (taskIdString) {
        const normalizedTaskId = normalizeTaskId(taskIdString);
        if (normalizedTaskId) {
          // Пробуем найти по всем возможным вариантам ID
          let taskData = tasksDataMap.get(normalizedTaskId);
          if (!taskData) {
            taskData = tasksDataMap.get(taskIdString);
          }
          if (!taskData && !normalizedTaskId.startsWith('task_')) {
            taskData = tasksDataMap.get(`task_${normalizedTaskId}`);
          }
          if (!taskData && taskIdString.startsWith('task_')) {
            taskData = tasksDataMap.get(taskIdString.replace('task_', ''));
          }
          
          if (taskData?.colorLabel) {
            // Добавляем прозрачность для фона (15 в hex = примерно 8% прозрачности)
            return `${taskData.colorLabel}15`;
          }
        }
      }
    }
    
    return getEventBgColor(event.type);
  };

  // Функция для форматирования времени
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Функция для проверки, длится ли событие больше 1 дня
  const isMultiDayEvent = (event: CalendarEvent): boolean => {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return startDate.getTime() !== endDate.getTime();
  };

  // Функция для проверки, является ли событие на весь день
  const isAllDayEvent = (event: CalendarEvent): boolean => {
    if (event.isAllDay) return true;
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    
    // Проверяем, начинается ли событие в начале дня (00:00:00)
    const startsAtMidnight = start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0 && start.getMilliseconds() === 0;
    
    // Проверяем, заканчивается ли событие в конце дня (23:59:59.xxx или 23:59:59.999)
    // Принимаем как конец дня, если часы = 23, минуты = 59, секунды = 59
    const endsAtEndOfDay = end.getHours() === 23 && end.getMinutes() === 59 && end.getSeconds() === 59;
    
    // Событие считается "весь день" только если:
    // 1. Оно начинается в начале дня (00:00:00) И
    // 2. Оно заканчивается в конце дня (23:59:59.xxx)
    // Это работает как для однодневных, так и для многосуточных событий
    // Для многосуточных событий: начинается в 00:00:00 первого дня и заканчивается в 23:59:59 последнего дня
    return startsAtMidnight && endsAtEndOfDay;
  };

  // Обработка перемещения задачи/события
  const handleDragStart = useCallback((event: CalendarEvent) => {
    setDraggedEvent(event);
  }, []);
  
  // Мемоизированная функция для удаления события из списка (используется в EventItem)
  const handleDeleteEventFromList = useCallback((event: CalendarEvent) => {
    setEventToDelete(event);
    setShowDeleteConfirm(true);
  }, []);
  
  // Стабильная функция для выбора события (обертка над setSelectedEvent)
  // Для задач открываем TaskViewModal, для остальных событий - EventDetailsModal
  const handleSelectEvent = useCallback(async (event: CalendarEvent) => {
    // Если это задача (EventType.TASK), открываем TaskViewModal
    if (event.type === EventType.TASK) {
      try {
        // Получаем ID задачи из события
        let taskId: string | null = null;
        
        // Вариант 1: taskId напрямую в событии
        if (event.taskId) {
          taskId = typeof event.taskId === 'string' ? event.taskId : event.taskId._id;
        }
        
        // Вариант 2: ID события начинается с task_ (unified view)
        if (!taskId && event._id.startsWith('task_')) {
          taskId = event._id.replace('task_', '');
        }
        
        // Вариант 3: ID события - это ID задачи (без префикса)
        if (!taskId) {
          taskId = event._id;
        }
        
        // Нормализуем ID (убираем префикс task_ если есть)
        const normalizedTaskId = normalizeTaskId(taskId);
        
        // Загружаем полные данные задачи
        const taskResponse = await crmTaskService.getTask(normalizedTaskId);
        
        if (taskResponse.success && taskResponse.data) {
          setSelectedTaskForView(taskResponse.data);
          setIsTaskViewModalOpen(true);
        } else {
          // Если не удалось загрузить задачу, показываем обычную модалку события
          console.warn('Failed to load task, showing event details instead:', taskResponse.message);
          setSelectedEvent(event);
        }
      } catch (error) {
        console.error('Error loading task from event:', error);
        // При ошибке показываем обычную модалку события
        setSelectedEvent(event);
      }
    } else {
      // Для обычных событий (встречи, звонки, напоминания) показываем EventDetailsModal
      setSelectedEvent(event);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    // Небольшая задержка для плавного завершения перетаскивания
    setTimeout(() => {
      setDraggedEvent(null);
      setDragOverDay(null);
      setDraggedEventTime(null);
      setDragTimePreview(null);
    }, 50);
  }, []);

  const handleDragOver = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDay(dayKey);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    
    if (!draggedEvent) return;
    
    try {
      const oldStart = new Date(draggedEvent.startTime);
      const oldEnd = new Date(draggedEvent.endTime);
      const duration = oldEnd.getTime() - oldStart.getTime();
      
      // Устанавливаем новую дату начала (сохраняем время если это не all-day событие)
      const newStart = new Date(targetDate);
      if (!draggedEvent.isAllDay) {
        newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
      } else {
        // Для all-day событий устанавливаем начало дня
        newStart.setHours(0, 0, 0, 0);
      }
      
      // Устанавливаем новую дату окончания с сохранением длительности
      const newEnd = new Date(newStart.getTime() + duration);
      if (draggedEvent.isAllDay) {
        // Для all-day событий устанавливаем конец дня
        newEnd.setHours(23, 59, 59, 999);
      }
      
      // Согласно документации: метод move поддерживает unified view
      // Если ID начинается с task_, перемещается задача через unified view
      // Если ID является обычным MongoDB ObjectId, перемещается событие календаря
      // API автоматически определяет тип объекта по ID и синхронизирует изменения
      const response = await calendarCrmService.moveCalendarEvent(
        draggedEvent._id,
        {
          newStartTime: newStart.toISOString(),
          newEndTime: newEnd.toISOString(),
        },
      );
      
      if (response.success && response.data) {
        // УМНОЕ СРАВНЕНИЕ: Обновляем событие в локальном состоянии только если данные изменились
        const movedEventId = draggedEvent._id;
        const updatedEvent = response.data;
        setAllEvents(prevEvents => {
          const updatedEvents = prevEvents.map(event => 
            event._id === movedEventId ? updatedEvent : event
          );
          
          // Сравниваем обновленный массив с предыдущим
          const fieldsToCompare = ['_id', 'title', 'startTime', 'endTime', 'type', 'status', 'description', 'location', 'meetingUrl', 'isAllDay', 'leadId', 'taskId', 'participants', 'externalParticipants', 'reminderMinutes', 'isRecurring', 'recurringRule'];
          if (compareArrays(prevEvents, updatedEvents, '_id', fieldsToCompare)) {
            return prevEvents; // Данные не изменились
          }
          return updatedEvents; // Данные изменились
        });
        
        // Для событий типа TASK не вызываем loadEvents сразу, так как это может привести к потере события
        // из-за логики фильтрации задач. Вместо этого полагаемся на реалтайм синхронизацию через WebSocket
        // или на обновление через оптимистичное обновление выше
        // Для обычных событий календаря можно обновить данные
        if (updatedEvent.type !== EventType.TASK) {
          // Умное сравнение в loadEvents предотвратит лишние обновления
          setTimeout(() => {
            loadEvents();
          }, 100);
        }
      } else {
        alert(response.message || t('calendarViewModal.errorMovingEvent'));
      }
    } catch (error: any) {
      console.error('Error moving event/task:', error);
      alert(error.message || t('calendarViewModal.errorWhileMoving'));
    }
    
    setDraggedEvent(null);
    setDragOverDay(null);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    touchStartElement.current = target;

    const scrollableContainer = target.closest('.overflow-x-auto, .overflow-y-auto');
    if (scrollableContainer) {
      const container = scrollableContainer as HTMLElement;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const hasVerticalScroll = scrollHeight > clientHeight;
      const isAtTopEdge = scrollTop <= 1;

      if (hasVerticalScroll && !isAtTopEdge) {
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }
    }

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;

    if (touchStartElement.current) {
      const scrollableContainer = touchStartElement.current.closest('.overflow-x-auto, .overflow-y-auto');
      if (scrollableContainer) {
        const container = scrollableContainer as HTMLElement;
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const hasVerticalScroll = scrollHeight > clientHeight;
        const isAtTopEdge = scrollTop <= 1;

        if (hasVerticalScroll && !isAtTopEdge) {
          touchStartX.current = null;
          touchStartY.current = null;
          touchStartElement.current = null;
          return;
        }
      }
    }

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX.current;
    const diffY = touchEndY - touchStartY.current;

    const minSwipeDistance = 50;

    if (Math.abs(diffY) > Math.abs(diffX) && diffY > minSwipeDistance) {
      let canClose = true;

      if (touchStartElement.current && modalContainerRef.current) {
        let currentElement: HTMLElement | null = touchStartElement.current;

        while (currentElement && currentElement !== modalContainerRef.current) {
          const style = window.getComputedStyle(currentElement);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                              style.overflow === 'auto' || style.overflow === 'scroll' ||
                              currentElement.classList.contains('overflow-y-auto') ||
                              currentElement.classList.contains('overflow-x-auto');

          if (isScrollable) {
            const scrollTop = currentElement.scrollTop;
            const scrollHeight = currentElement.scrollHeight;
            const clientHeight = currentElement.clientHeight;
            const hasVerticalScroll = scrollHeight > clientHeight;
            const isAtTopEdge = scrollTop <= 1;

            if (hasVerticalScroll && !isAtTopEdge) {
              canClose = false;
              break;
            }
          }

          currentElement = currentElement.parentElement;
        }

        if (canClose && modalContainerRef.current) {
          const modalContent = modalContainerRef.current;
          const scrollTop = modalContent.scrollTop;
          const scrollHeight = modalContent.scrollHeight;
          const clientHeight = modalContent.clientHeight;
          const hasVerticalScroll = scrollHeight > clientHeight;
          const isAtTopEdge = scrollTop <= 1;

          if (hasVerticalScroll && !isAtTopEdge) {
            canClose = false;
          }
        }
      } else if (modalContainerRef.current) {
        const modalContent = modalContainerRef.current;
        const scrollTop = modalContent.scrollTop;
        const scrollHeight = modalContent.scrollHeight;
        const clientHeight = modalContent.clientHeight;
        const hasVerticalScroll = scrollHeight > clientHeight;
        const isAtTopEdge = scrollTop <= 1;

        if (hasVerticalScroll && !isAtTopEdge) {
          canClose = false;
        }
      }

      if (canClose) {
        onClose();
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchStartElement.current = null;
  };

  useEffect(() => {
    if (!isOpen) return;

    const container = modalContainerRef.current;
    if (!container) return;

    const handleTouchMoveNative = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) {
        return;
      }

      const touchCurrentX = e.touches[0].clientX;
      const touchCurrentY = e.touches[0].clientY;
      const diffX = touchCurrentX - touchStartX.current;
      const diffY = touchCurrentY - touchStartY.current;

      if (Math.abs(diffX) < 5 && Math.abs(diffY) < 5) {
        return;
      }

      if (touchStartElement.current) {
        const scrollableContainer = touchStartElement.current.closest('.overflow-x-auto, .overflow-y-auto');
        if (scrollableContainer) {
          const container = scrollableContainer as HTMLElement;
          const scrollTop = container.scrollTop;
          const scrollHeight = container.scrollHeight;
          const clientHeight = container.clientHeight;
          const hasVerticalScroll = scrollHeight > clientHeight;
          const isAtTopEdge = scrollTop <= 1;

          if (hasVerticalScroll) {
            if (Math.abs(diffY) > Math.abs(diffX)) {
              return;
            }

            if (!isAtTopEdge) {
              return;
            }
          }//
        }
      }

      if (Math.abs(diffY) > Math.abs(diffX)) {
        return;
      }

      if (Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY) && e.cancelable) {
        e.preventDefault();
      }
    };

    container.addEventListener('touchmove', handleTouchMoveNative, { passive: false });

    return () => {
      container.removeEventListener('touchmove', handleTouchMoveNative);
    };
  }, [isOpen]);

  // Закрытие dropdown периода при клике вне его
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isPeriodDropdownOpen) {
        const target = event.target as HTMLElement;
        if (!target.closest('[data-period-dropdown-container]')) {
          setIsPeriodDropdownOpen(false);
        }
      }
    };

    if (isPeriodDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPeriodDropdownOpen]);

  if (!isOpen) return null;

  const modalContent = (
    <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-50 pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={onClose}>
      
      <div 
        ref={modalContainerRef}
        className="relative w-full md:w-[93.89%] h-[calc(100vh-1rem)] md:h-[96.89vh] flex flex-col gap-4 bg-white rounded-t-[25px] md:rounded-[25px] shadow-2xl md:p-4 md:bg-blue-50" 
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-5 -right-10 cursor-pointer"
          aria-label={t('calendarViewModal.close')}
        >
          <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M33.75 11.25L11.25 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            <path d="M11.25 11.25L33.75 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
          </svg>
        </button>
        <div className='flex w-full items-center gap-5'>
          <div className='flex items-center gap-5 w-78.5'>
          <svg
            className="w-[180px] h-auto text-[#169600]"
            viewBox="0 0 1284 300"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
<g clipPath="url(#clip0_5410_70887)">
<path d="M89.7309 79.0568C80.5033 87.9856 85.3169 93.9432 97.6554 90.4141C126.929 82.0431 177.422 70.349 200.405 81.3403C200.405 81.3403 133.189 134.607 143.32 239.949C144.546 252.729 154.129 262.947 163.356 262.947C172.589 262.947 178.724 252.595 178.695 239.752C178.638 210.723 183.551 156.63 212.998 90.0578C212.998 90.0578 234.9 118.84 241.483 150.249C244.118 162.813 249.017 164.573 252.432 152.191C256.168 138.593 257.35 119.854 246.417 100.217C246.417 100.217 288.235 122.888 315.474 152.109C324.231 161.499 329.438 159.917 326.024 147.541C318.844 121.556 297.673 81.2236 235.271 69.2228C235.271 69.2228 259.298 57.5145 288.437 58.6735C301.265 59.1783 305.483 53.1633 294.058 47.3021C280.157 40.1617 256.413 35.3772 217.835 46.4702C217.835 46.4702 199.247 1.14629 139.19 3.00278C126.362 3.40148 125.804 9.69585 137.339 15.3166C157.26 25.0242 184.788 40.6709 190.231 55.1877C190.239 55.1886 128.341 41.6866 89.7309 79.0568Z" fill="currentColor"/>
</g>
<g clipPath="url(#clip1_5410_70887)">
<path d="M143.973 155.442C149.367 160.662 146.553 164.145 139.34 162.082C122.226 157.188 92.7074 150.352 79.271 156.777C79.271 156.777 118.567 187.918 112.644 249.502C111.927 256.974 106.325 262.948 100.93 262.948C95.5329 262.948 91.9461 256.896 91.9627 249.387C91.9963 232.417 89.1238 200.793 71.9089 161.874C71.9089 161.874 59.1046 178.701 55.2563 197.062C53.7156 204.407 50.8514 205.436 48.8554 198.198C46.6713 190.248 45.9798 179.293 52.3719 167.813C52.3719 167.813 27.924 181.067 11.9997 198.15C6.88052 203.639 3.83643 202.715 5.8324 195.479C10.0295 180.288 22.4064 156.709 58.888 149.693C58.888 149.693 44.8412 142.848 27.8062 143.526C20.3066 143.821 17.8408 140.305 24.5202 136.878C32.6468 132.704 46.5276 129.907 69.0808 136.392C69.0808 136.392 79.9481 109.895 115.058 110.98C122.558 111.213 122.884 114.893 116.14 118.179C104.494 123.854 88.4007 133.001 85.2186 141.488C85.214 141.489 121.4 133.595 143.973 155.442Z" fill="currentColor"/>
</g>
<path d="M475.704 247C471.304 247 467.604 245.5 464.604 242.5C461.604 239.5 460.104 235.8 460.104 231.4V28.3C460.104 23.7 461.604 20 464.604 17.2C467.604 14.2 471.304 12.7 475.704 12.7H547.404C561.004 12.7 572.904 15.4 583.104 20.8C593.504 26 601.604 33.3 607.404 42.7C613.404 52.1 616.404 62.9 616.404 75.1C616.404 84.9 613.704 93.8 608.304 101.8C603.104 109.6 595.904 115.8 586.704 120.4C599.904 123.6 610.504 129.9 618.504 139.3C626.504 148.7 630.504 161 630.504 176.2C630.504 190 627.204 202.2 620.604 212.8C614.204 223.4 605.204 231.8 593.604 238C582.004 244 568.704 247 553.704 247H475.704ZM491.304 218.2H553.704C562.904 218.2 571.004 216.6 578.004 213.4C585.004 210.2 590.504 205.5 594.504 199.3C598.504 193.1 600.504 185.4 600.504 176.2C600.504 167.6 598.504 160.5 594.504 154.9C590.504 149.3 585.004 145.1 578.004 142.3C571.004 139.3 562.904 137.8 553.704 137.8H491.304V218.2ZM491.304 109H547.404C558.804 109 568.104 106.2 575.304 100.6C582.704 95 586.404 86.5 586.404 75.1C586.404 63.7 582.704 55.3 575.304 49.9C568.104 44.3 558.804 41.5 547.404 41.5H491.304V109ZM658.519 247C652.919 247 648.619 244.6 645.619 239.8C642.619 235 642.319 229.9 644.719 224.5L729.019 23.2C732.019 16.2 736.919 12.7 743.719 12.7C750.919 12.7 755.819 16.2 758.419 23.2L843.019 225.1C845.219 230.7 844.819 235.8 841.819 240.4C839.019 244.8 834.719 247 828.919 247C825.919 247 823.019 246.2 820.219 244.6C817.619 242.8 815.719 240.4 814.519 237.4L740.119 52.6H748.519L672.919 237.4C671.519 240.6 669.419 243 666.619 244.6C664.019 246.2 661.319 247 658.519 247ZM674.419 195.4L686.419 169.6H804.019L816.019 195.4H674.419ZM880.556 247C875.956 247 872.256 245.5 869.456 242.5C866.856 239.5 865.356 236.1 864.956 232.3C864.756 228.3 865.856 224.8 868.256 221.8L1014.96 40.3H883.556C878.556 40.3 874.756 39.1 872.156 36.7C869.756 34.1 868.656 30.9 868.856 27.1C868.656 22.9 870.056 19.5 873.056 16.9C876.056 14.1 879.756 12.7 884.156 12.7H1038.96C1043.56 12.7 1047.26 14.1 1050.06 16.9C1052.86 19.7 1054.46 23.1 1054.86 27.1C1055.26 30.9 1054.16 34.3 1051.56 37.3L904.256 219.4H1038.96C1043.56 219.4 1047.26 220.8 1050.06 223.6C1052.86 226.2 1054.26 229.3 1054.26 232.9C1054.26 237.3 1052.86 240.8 1050.06 243.4C1047.26 245.8 1043.56 247 1038.96 247H880.556ZM1092.11 247C1086.51 247 1082.21 244.6 1079.21 239.8C1076.21 235 1075.91 229.9 1078.31 224.5L1162.61 23.2C1165.61 16.2 1170.51 12.7 1177.31 12.7C1184.51 12.7 1189.41 16.2 1192.01 23.2L1276.61 225.1C1278.81 230.7 1278.41 235.8 1275.41 240.4C1272.61 244.8 1268.31 247 1262.51 247C1259.51 247 1256.61 246.2 1253.81 244.6C1251.21 242.8 1249.31 240.4 1248.11 237.4L1173.71 52.6H1182.11L1106.51 237.4C1105.11 240.6 1103.01 243 1100.21 244.6C1097.61 246.2 1094.91 247 1092.11 247ZM1108.01 195.4L1120.01 169.6H1237.61L1249.61 195.4H1108.01Z" fill="currentColor"/>
<defs>
<clipPath id="clip0_5410_70887">
<rect width="260" height="260" fill="white" transform="translate(76 2.948)"/>
</clipPath>
<clipPath id="clip1_5410_70887">
<rect width="152" height="152" fill="white" transform="matrix(-1 0 0 1 152 110.948)"/>
</clipPath>
</defs>
</svg>

            <span>{t('calendarViewModal.calendar')}</span>
          </div>
          <div className='flex flex-1 items-center gap-2.5 h-12.5'>
            <div className='relative flex-1 h-full'>
              <div className='absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none'>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <mask id="mask0_3929_58123" style={{maskType: 'alpha'}} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect width="24" height="24" fill="#D9D9D9"/>
                  </mask>
                  <g mask="url(#mask0_3929_58123)">
                    <path d="M9.5 16C7.68333 16 6.14583 15.3708 4.8875 14.1125C3.62917 12.8542 3 11.3167 3 9.5C3 7.68333 3.62917 6.14583 4.8875 4.8875C6.14583 3.62917 7.68333 3 9.5 3C11.3167 3 12.8542 3.62917 14.1125 4.8875C15.3708 6.14583 16 7.68333 16 9.5C16 10.2333 15.8833 10.925 15.65 11.575C15.4167 12.225 15.1 12.8 14.7 13.3L20.3 18.9C20.4833 19.0833 20.575 19.3167 20.575 19.6C20.575 19.8833 20.4833 20.1167 20.3 20.3C20.1167 20.4833 19.8833 20.575 19.6 20.575C19.3167 20.575 19.0833 20.4833 18.9 20.3L13.3 14.7C12.8 15.1 12.225 15.4167 11.575 15.65C10.925 15.8833 10.2333 16 9.5 16ZM9.5 14C10.75 14 11.8125 13.5625 12.6875 12.6875C13.5625 11.8125 14 10.75 14 9.5C14 8.25 13.5625 7.1875 12.6875 6.3125C11.8125 5.4375 10.75 5 9.5 5C8.25 5 7.1875 5.4375 6.3125 6.3125C5.4375 7.1875 5 8.25 5 9.5C5 10.75 5.4375 11.8125 6.3125 12.6875C7.1875 13.5625 8.25 14 9.5 14Z" fill="#1C1B1F"/>
                  </g>
                </svg>
              </div>
              <input
                type="text"
                placeholder={t('calendarViewModal.searchInCalendar')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='rounded-full border-2 border-dream-primary h-full w-full pl-12 pr-4 focus:outline-none placeholder:text-black text-black'
              />
            </div>
          </div>
        </div>
        <div className='overflow-y-auto flex-1 min-h-0 relative'>
          {loading && (
            <div className='absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50'>
              <CircularProgress 
                percentage={0}
                size={120}
                strokeWidth={12}
              />
              <span className='mt-4 text-gray-500'>{t('calendarViewModal.loadingEvents')}</span>
            </div>
          )}
          <div className='flex gap-5 h-full'>
            <div className='w-78.5 flex flex-col gap-4'>
              <div className="bg-white  rounded-2xl overflow-hidden">
                <Calendar
                  showHeader={true}
                  headerClassName="px-4 py-3"
                  bodyClassName="flex-1 bg-dream-secondary p-4 pb-6"
                  onDayClick={handleCalendarDayClick}
                  events={events}
                  initialDate={currentDate}
                />
              </div>
            </div>
            <div className='flex flex-col flex-1 gap-7'>
              <div className='p-5 bg-white rounded-2xl flex flex-col gap-5.5 h-full'>
                <div className='h-11 flex items-center justify-between'>
                  <div className='py-0.5 h-full'>
                    <div className='h-full flex items-center gap-2.5'>
                      <button 
                        onClick={handleToday}
                        className='flex items-center h-full px-4 rounded-full border-2 border-gray-300 cursor-pointer hover:opacity-80 transition-opacity'
                      >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <mask id="mask0_3929_58305" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                          <rect width="24" height="24" fill="#D9D9D9"/>
                          </mask>
                          <g mask="url(#mask0_3929_58305)">
                          <path d="M9 16.5C8.3 16.5 7.70833 16.2583 7.225 15.775C6.74167 15.2917 6.5 14.7 6.5 14C6.5 13.3 6.74167 12.7083 7.225 12.225C7.70833 11.7417 8.3 11.5 9 11.5C9.7 11.5 10.2917 11.7417 10.775 12.225C11.2583 12.7083 11.5 13.3 11.5 14C11.5 14.7 11.2583 15.2917 10.775 15.775C10.2917 16.2583 9.7 16.5 9 16.5ZM5 22C4.45 22 3.97917 21.8042 3.5875 21.4125C3.19583 21.0208 3 20.55 3 20V6C3 5.45 3.19583 4.97917 3.5875 4.5875C3.97917 4.19583 4.45 4 5 4H6V3C6 2.71667 6.09583 2.47917 6.2875 2.2875C6.47917 2.09583 6.71667 2 7 2C7.28333 2 7.52083 2.09583 7.7125 2.2875C7.90417 2.47917 8 2.71667 8 3V4H16V3C16 2.71667 16.0958 2.47917 16.2875 2.2875C16.4792 2.09583 16.7167 2 17 2C17.2833 2 17.5208 2.09583 17.7125 2.2875C17.9042 2.47917 18 2.71667 18 3V4H19C19.55 4 20.0208 4.19583 20.4125 4.5875C20.8042 4.97917 21 5.45 21 6V20C21 20.55 20.8042 21.0208 20.4125 21.4125C20.0208 21.8042 19.55 22 19 22H5ZM5 20H19V10H5V20ZM5 8H19V6H5V8Z" fill="black" fillOpacity="0.8"/>
                          </g>
                        </svg>
                        <span className='text-black'>{t('calendarViewModal.today')}</span>
                      </button>
                      <span className='text-black'>
                        {formatPeriodDate()}
                      </span>
                      <div className='flex items-center gap-5'>
                        <button
                          onClick={handlePreviousPeriod}
                          className='cursor-pointer hover:opacity-80 transition-opacity'
                          aria-label={t('calendarViewModal.previousPeriod')}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <mask id="mask0_3929_58312" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                            <rect width="24" height="24" fill="#D9D9D9"/>
                            </mask>
                            <g mask="url(#mask0_3929_58312)">
                            <path d="M9.54922 11.9996L16.8992 19.3496C17.1492 19.5996 17.2701 19.8913 17.2617 20.2246C17.2534 20.558 17.1242 20.8496 16.8742 21.0996C16.6242 21.3496 16.3326 21.4746 15.9992 21.4746C15.6659 21.4746 15.3742 21.3496 15.1242 21.0996L7.42422 13.4246C7.22422 13.2246 7.07422 12.9996 6.97422 12.7496C6.87422 12.4996 6.82422 12.2496 6.82422 11.9996C6.82422 11.7496 6.87422 11.4996 6.97422 11.2496C7.07422 10.9996 7.22422 10.7746 7.42422 10.5746L15.1242 2.87462C15.3742 2.62462 15.6701 2.50379 16.0117 2.51212C16.3534 2.52046 16.6492 2.64962 16.8992 2.89962C17.1492 3.14962 17.2742 3.44129 17.2742 3.77462C17.2742 4.10796 17.1492 4.39962 16.8992 4.64962L9.54922 11.9996Z" fill="black" fillOpacity="0.8"/>
                            </g>
                          </svg>
                        </button>
                        <button
                          onClick={handleNextPeriod}
                          className='cursor-pointer hover:opacity-80 transition-opacity'
                          aria-label={t('calendarViewModal.nextPeriod')}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <mask id="mask0_3929_58315" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                            <rect width="24" height="24" fill="#D9D9D9"/>
                            </mask>
                            <g mask="url(#mask0_3929_58315)">
                            <path d="M14.4746 12L7.12462 4.65C6.87462 4.4 6.75379 4.10417 6.76212 3.7625C6.77046 3.42083 6.89962 3.125 7.14962 2.875C7.39962 2.625 7.69546 2.5 8.03712 2.5C8.37879 2.5 8.67462 2.625 8.92462 2.875L16.5996 10.575C16.7996 10.775 16.9496 11 17.0496 11.25C17.1496 11.5 17.1996 11.75 17.1996 12C17.1996 12.25 17.1496 12.5 17.0496 12.75C16.9496 13 16.7996 13.225 16.5996 13.425L8.89962 21.125C8.64962 21.375 8.35796 21.4958 8.02462 21.4875C7.69129 21.4792 7.39962 21.35 7.14962 21.1C6.89962 20.85 6.77462 20.5542 6.77462 20.2125C6.77462 19.8708 6.89962 19.575 7.14962 19.325L14.4746 12Z" fill="black" fillOpacity="0.8"/>
                            </g>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className='relative' data-period-dropdown-container>
                    <button 
                      onClick={() => setIsPeriodDropdownOpen(!isPeriodDropdownOpen)}
                      className='h-11 flex-shrink-0 border-2 border-dream-primary flex items-center px-4 w-67 justify-between rounded-full cursor-pointer hover:opacity-80 transition-opacity'
                    >
                      <span className='text-dream-primary'>{t(`calendarViewModal.periods.${selectedPeriod}` as any)}</span>
                      <svg 
                        width="36" 
                        height="36" 
                        viewBox="0 0 36 36" 
                        fill="none" 
                        xmlns="http://www.w3.org/2000/svg"
                        className={`transition-transform duration-300 ${isPeriodDropdownOpen ? 'rotate-180' : ''}`}
                      >
                      <path d="M18.0009 19.757L25.4259 12.332L27.5469 14.453L18.0009 23.999L8.45488 14.453L10.5759 12.332L18.0009 19.757Z" fill="#169600"/>
                    </svg>
                  </button>
                    {isPeriodDropdownOpen && (
                      <div className='absolute top-full left-0 mt-2 w-67 bg-white border-2 border-dream-primary rounded-[25px] shadow-lg z-[100] overflow-hidden'>
                        <button
                          onClick={() => {
                            setSelectedPeriod(t('calendarViewModal.day'));
                            setIsPeriodDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                            selectedPeriod === t('calendarViewModal.day') ? 'bg-dream-secondary' : ''
                          }`}
                        >
                          <span className={`${selectedPeriod === t('calendarViewModal.day') ? 'text-dream-primary font-normal' : 'text-gray-700'}`}>{t('calendarViewModal.day')}</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPeriod(t('calendarViewModal.week'));
                            setIsPeriodDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 border-t border-gray-200 ${
                            selectedPeriod === t('calendarViewModal.week') ? 'bg-dream-secondary' : ''
                          }`}
                        >
                          <span className={`${selectedPeriod === t('calendarViewModal.week') ? 'text-dream-primary font-normal' : 'text-gray-700'}`}>{t('calendarViewModal.week')}</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPeriod(t('calendarViewModal.month'));
                            setIsPeriodDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 border-t border-gray-200 ${
                            selectedPeriod === t('calendarViewModal.month') ? 'bg-dream-secondary' : ''
                          }`}
                        >
                          <span className={`${selectedPeriod === t('calendarViewModal.month') ? 'text-dream-primary font-normal' : 'text-gray-700'}`}>{t('calendarViewModal.month')}</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPeriod(t('calendarViewModal.year'));
                            setIsPeriodDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 border-t border-gray-200 ${
                            selectedPeriod === t('calendarViewModal.year') ? 'bg-dream-secondary' : ''
                          }`}
                        >
                          <span className={`${selectedPeriod === t('calendarViewModal.year') ? 'text-dream-primary font-normal' : 'text-gray-700'}`}>{t('calendarViewModal.year')}</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPeriod(t('calendarViewModal.schedule'));
                            setIsPeriodDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 border-t border-gray-200 ${
                            selectedPeriod === t('calendarViewModal.schedule') ? 'bg-dream-secondary' : ''
                          }`}
                        >
                          <span className={`${selectedPeriod === t('calendarViewModal.schedule') ? 'text-dream-primary font-normal' : 'text-gray-700'}`}>{t('calendarViewModal.schedule')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className='flex flex-col gap-2.5 overflow-y-auto flex-1 min-h-0'>
                  {error ? (
                    <div className='flex items-center justify-center p-8'>
                      <span className='text-red-500'>{t('calendarViewModal.errorError')}</span>
                    </div>
                  ) : selectedPeriod === t('calendarViewModal.day') ? (
                    // Показываем выбранный день - используем мемоизированные данные
                    (() => {
                      const dayEvents = dayEventsForDay;
                      
                      return (
                        <div className="flex flex-col h-full">
                          {/* Заголовок дня */}
                          <div className='flex items-center p-2 border-b border-gray-200'>
                            <div className='flex items-center pl-5 text-black w-12'>
                              <span className="font-normal">{currentDate.getDate()}</span>
                            </div>
                            <div className='flex items-center pl-3 text-black w-35'>
                              <span>{formatDateDay(currentDate)}</span>
                            </div>
                          </div>
                          
                          {/* События на весь день */}
                          {(() => {
                            const allDayEvents = dayEvents.filter(event => isAllDayEvent(event));
                            if (allDayEvents.length > 0) {
                              return (
                                <div className="px-2 py-1.5 border-b border-gray-200 bg-gray-50">
                                  <div className="flex flex-col gap-1">
                                    {allDayEvents.map((event) => (
                                      <div
                                        key={event._id}
                                        data-event-item
                                        className="cursor-pointer rounded px-2 py-1 text-xs flex items-center gap-1.5"
                                        style={{
                                          backgroundColor: getEventBgColorWithTaskLabel(event),
                                          borderLeft: `3px solid ${getEventColorWithTaskLabel(event)}`
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          handleSelectEvent(event);
                                        }}
                                      >
                                        <span className="text-gray-700 font-normal flex-shrink-0 text-[10px] min-w-[50px]">{t('calendarViewModal.allDay')}</span>
                                        <span className="font-medium text-gray-900 truncate flex-1 min-w-0 text-[11px]">{event.title}</span>
                                        <span className="text-gray-500 text-[9px] flex-shrink-0 hidden sm:inline">
                                          {event.type === EventType.MEETING ? t('calendarViewModal.meeting1'):
                                           event.type === EventType.CALL ? t('calendarViewModal.call1'):
                                           event.type === EventType.REMINDER ? t('calendarViewModal.reminder'): ''}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })()}
                          
                          {/* Временная сетка в стиле Google Calendar */}
                          <div 
                            id="day-view-timeline"
                            className='flex-1 overflow-y-auto relative'
                          >
                            {/* Сетка часов - фон */}
                            <div className="relative flex flex-col" style={{ minHeight: '1440px' }}>
                              {Array.from({ length: 24 }, (_, i) => (
                                <div key={i} className="flex border-b border-gray-200" style={{ height: '60px', minHeight: '60px' }}>
                                  <div className="w-20 text-sm font-medium text-gray-600 px-3 py-2 flex-shrink-0 text-right bg-gray-50 border-r border-gray-200">
                                    {i.toString().padStart(2, '0')}:00
                                  </div>
                                  <div className="flex-1 relative border-l border-gray-200 bg-white">
                                    {/* Полчаса */}
                                    <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-gray-100"></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            
                            {/* События с улучшенным алгоритмом размещения (Google Calendar style) */}
                            <div className="absolute top-0 left-20 right-0" style={{ height: '1440px', minHeight: '1440px' }}>
                              {(() => {
                                const events = dayEvents.filter(event => !isAllDayEvent(event));
                                
                                // Сортируем события по времени начала
                                const sortedEvents = [...events].sort((a, b) => {
                                  const startA = new Date(a.startTime).getTime();
                                  const startB = new Date(b.startTime).getTime();
                                  if (startA !== startB) return startA - startB;
                                  // Если время начала одинаковое, сортируем по длительности (более длинные первыми)
                                  const endA = new Date(a.endTime).getTime();
                                  const endB = new Date(b.endTime).getTime();
                                  return endB - endA;
                                });
                                
                                // Улучшенный алгоритм размещения событий (Google Calendar style)
                                interface EventLayout {
                                  event: CalendarEvent;
                                  column: number;
                                  columns: number;
                                  startMinutes: number;
                                  endMinutes: number;
                                }
                                
                                const layouts: EventLayout[] = [];
                                const columns: Array<Array<CalendarEvent>> = [];
                                
                                sortedEvents.forEach(event => {
                                  // Используем реальные даты из события
                                  const start = new Date(event.startTime);
                                  const end = new Date(event.endTime);
                                  
                                  // Определяем границы текущего дня
                                  const currentDayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 0, 0, 0, 0);
                                  const currentDayEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 23, 59, 59, 999);
                                  
                                  // Проверяем, пересекается ли событие с текущим днем
                                  const eventStartTime = start.getTime();
                                  const eventEndTime = end.getTime();
                                  const dayStartTime = currentDayStart.getTime();
                                  const dayEndTime = currentDayEnd.getTime();
                                  
                                  // Событие должно пересекаться с текущим днем
                                  if (eventEndTime < dayStartTime || eventStartTime > dayEndTime) {
                                    return; // Пропускаем события не текущего дня
                                  }
                                  
                                  // Вычисляем реальную длительность события в минутах (используем абсолютное время)
                                  const realDurationMinutes = Math.max(1, Math.floor((eventEndTime - eventStartTime) / (1000 * 60)));
                                  
                                  // ВАЖНО: Используем локальное время для вычисления позиций на временной шкале
                                  // Парсим ISO строку и получаем локальные часы и минуты
                                  // Это правильно, потому что задача хранится в UTC, но должна отображаться в локальном времени
                                  const startLocalHours = start.getHours();
                                  const startLocalMinutes = start.getMinutes();
                                  const endLocalHours = end.getHours();
                                  const endLocalMinutes = end.getMinutes();
                                  
                                  // Вычисляем начало события в минутах от начала дня (0:00) используя локальное время
                                  let startMinutes = startLocalHours * 60 + startLocalMinutes;
                                  
                                  // Если событие начинается в предыдущий день (по локальному времени), начинаем с 0:00
                                  const startDayDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                                  const currentDayDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
                                  if (startDayDate.getTime() < currentDayDate.getTime()) {
                                    startMinutes = 0; // Начинаем с начала дня
                                  }
                                  
                                  // Вычисляем окончание события в минутах от начала дня
                                  let endMinutes: number;
                                  const endDayDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                                  if (endDayDate.getTime() > currentDayDate.getTime()) {
                                    // Событие заканчивается на следующий день - ограничиваем концом текущего дня
                                    endMinutes = 1440; // 24:00 = 1440 минут
                                  } else if (endDayDate.getTime() < currentDayDate.getTime()) {
                                    // Событие заканчивается в предыдущий день - не должно попасть сюда, но на всякий случай
                                    endMinutes = 0;
                                  } else {
                                    // Событие заканчивается в тот же день
                                    endMinutes = endLocalHours * 60 + endLocalMinutes;
                                  }
                                  
                                  // Ограничиваем значения в пределах дня (0-1440 минут)
                                  const clampedStartMinutes = Math.max(0, Math.min(1439, startMinutes));
                                  const clampedEndMinutes = Math.max(clampedStartMinutes + 1, Math.min(1440, endMinutes));
                                  
                                  // Используем вычисленные значения для отображения
                                  const finalEndMinutes = clampedEndMinutes;
                                  
                                  // Отладочная информация для проверки
                                  if (startMinutes < 0 || startMinutes >= 1440) {
                                    console.warn('Event time calculation:', {
                                      event: event.title,
                                      startTime: event.startTime,
                                      endTime: event.endTime,
                                      startMinutes,
                                      clampedStartMinutes,
                                      realDurationMinutes,
                                      finalEndMinutes
                                    });
                                  }
                                  
                                  // Находим первую доступную колонку
                                  let columnIndex = 0;
                                  while (columnIndex < columns.length) {
                                    const column = columns[columnIndex];
                                    // Проверяем, нет ли пересечений с событиями в этой колонке
                                    const hasOverlap = column.some(existingEvent => {
                                      const existingStart = new Date(existingEvent.startTime);
                                      const existingEnd = new Date(existingEvent.endTime);
                                      const existingStartTime = existingStart.getTime();
                                      const existingEndTime = existingEnd.getTime();
                                      
                                      // Вычисляем позицию существующего события относительно начала дня
                                      const existingEffectiveStartTime = Math.max(existingStartTime, dayStartTime);
                                      const existingStartFromDayStart = existingEffectiveStartTime - dayStartTime;
                                      const existingStartMinutes = Math.floor(existingStartFromDayStart / (1000 * 60));
                                      
                                      const existingEffectiveEndTime = Math.min(existingEndTime, dayEndTime);
                                      const existingEndFromDayStart = existingEffectiveEndTime - dayStartTime;
                                      const existingEndMinutes = Math.ceil(existingEndFromDayStart / (1000 * 60));
                                      
                                      const existingClampedStartMinutes = Math.max(0, Math.min(1439, existingStartMinutes));
                                      const existingClampedEndMinutes = Math.max(existingClampedStartMinutes + 1, Math.min(1440, existingEndMinutes));
                                      
                                      return clampedStartMinutes < existingClampedEndMinutes && existingClampedStartMinutes < finalEndMinutes;
                                    });
                                    
                                    if (!hasOverlap) {
                                      break;
                                    }
                                    columnIndex++;
                                  }
                                  
                                  // Если нужна новая колонка, создаем её
                                  if (columnIndex >= columns.length) {
                                    columns.push([]);
                                  }
                                  
                                  columns[columnIndex].push(event);
                                  
                                  // Вычисляем максимальное количество пересечений в диапазоне этого события
                                  // Это определяет ширину события (Google Calendar style)
                                  // Считаем все события, которые пересекаются с текущим
                                  let maxColumnsInRange = 1;
                                  sortedEvents.forEach(otherEvent => {
                                    if (otherEvent._id === event._id) return;
                                    
                                    const otherStart = new Date(otherEvent.startTime);
                                    const otherEnd = new Date(otherEvent.endTime);
                                    const otherStartTime = otherStart.getTime();
                                    const otherEndTime = otherEnd.getTime();
                                    
                                    // Вычисляем позицию другого события относительно начала дня
                                    const otherEffectiveStartTime = Math.max(otherStartTime, dayStartTime);
                                    const otherStartFromDayStart = otherEffectiveStartTime - dayStartTime;
                                    const otherStartMinutes = Math.floor(otherStartFromDayStart / (1000 * 60));
                                    
                                    const otherEffectiveEndTime = Math.min(otherEndTime, dayEndTime);
                                    const otherEndFromDayStart = otherEffectiveEndTime - dayStartTime;
                                    const otherEndMinutes = Math.ceil(otherEndFromDayStart / (1000 * 60));
                                    
                                    const otherClampedStartMinutes = Math.max(0, Math.min(1439, otherStartMinutes));
                                    const otherClampedEndMinutes = Math.max(otherClampedStartMinutes + 1, Math.min(1440, otherEndMinutes));
                                    
                                    // Проверяем пересечение
                                    if (clampedStartMinutes < otherClampedEndMinutes && otherClampedStartMinutes < finalEndMinutes) {
                                      // Считаем все события, которые пересекаются одновременно с event и otherEvent
                                      let overlappingCount = 2; // event и otherEvent
                                      sortedEvents.forEach(checkEvent => {
                                        if (checkEvent._id === event._id || checkEvent._id === otherEvent._id) return;
                                        
                                        const checkStart = new Date(checkEvent.startTime);
                                        const checkEnd = new Date(checkEvent.endTime);
                                        const checkStartTime = checkStart.getTime();
                                        const checkEndTime = checkEnd.getTime();
                                        
                                        // Вычисляем позицию проверяемого события относительно начала дня
                                        const checkEffectiveStartTime = Math.max(checkStartTime, dayStartTime);
                                        const checkStartFromDayStart = checkEffectiveStartTime - dayStartTime;
                                        const checkStartMinutes = Math.floor(checkStartFromDayStart / (1000 * 60));
                                        
                                        const checkEffectiveEndTime = Math.min(checkEndTime, dayEndTime);
                                        const checkEndFromDayStart = checkEffectiveEndTime - dayStartTime;
                                        const checkEndMinutes = Math.ceil(checkEndFromDayStart / (1000 * 60));
                                        
                                        const checkClampedStartMinutes = Math.max(0, Math.min(1439, checkStartMinutes));
                                        const checkClampedEndMinutes = Math.max(checkClampedStartMinutes + 1, Math.min(1440, checkEndMinutes));
                                        
                                        // Проверяем, пересекается ли checkEvent с обоими (event и otherEvent)
                                        const overlapsWithEvent = clampedStartMinutes < checkClampedEndMinutes && checkClampedStartMinutes < finalEndMinutes;
                                        const overlapsWithOther = otherClampedStartMinutes < checkClampedEndMinutes && checkClampedStartMinutes < otherClampedEndMinutes;
                                        
                                        if (overlapsWithEvent && overlapsWithOther) {
                                          overlappingCount++;
                                        }
                                      });
                                      
                                      maxColumnsInRange = Math.max(maxColumnsInRange, overlappingCount);
                                    }
                                  });
                                  
                                  layouts.push({
                                    event,
                                    column: columnIndex,
                                    columns: maxColumnsInRange,
                                    startMinutes: clampedStartMinutes,
                                    endMinutes: finalEndMinutes
                                  });
                                });
                                
                                // Рендерим события
                                return layouts.map((layout) => {
                                  const { event, column, columns: totalColumns, startMinutes, endMinutes } = layout;
                                  
                                  // Вычисляем реальную длительность события в минутах для отображения
                                  const start = new Date(event.startTime);
                                  const end = new Date(event.endTime);
                                  const realDurationMinutes = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60)));
                                  
                                  // Вычисляем позицию в пикселях (1 минута = 1px, так как высота контейнера 1440px для 24 часов)
                                  const topPx = startMinutes;
                                  // Вычисляем высоту в пикселях на основе разницы между началом и концом (в минутах)
                                  const durationMinutes = endMinutes - startMinutes;
                                  const heightPx = Math.max(durationMinutes, 15); // Минимум 15 пикселей
                                  
                                  // Вычисляем ширину и позицию с небольшим наложением для экономии места
                                  const overlapPercent = 3; // 3% наложение между событиями
                                  const baseWidth = 100 / totalColumns;
                                  const baseLeft = (column / totalColumns) * 100;
                                  const eventLeft = `${baseLeft}%`;
                                  const eventWidth = column === totalColumns - 1 
                                    ? `${100 - baseLeft}%` 
                                    : `${baseWidth + overlapPercent}%`;
                                  
                                  return (
                                    <div
                                      key={event._id}
                                      data-event-item
                                      className="absolute cursor-pointer"
                                      style={{
                                        left: eventLeft,
                                        width: eventWidth,
                                        top: `${topPx}px`,
                                        height: `${heightPx}px`,
                                        minHeight: '20px',
                                        pointerEvents: 'auto',
                                        transition: 'opacity 0.2s',
                                        marginRight: column < totalColumns - 1 ? `-${overlapPercent}%` : '0',
                                        zIndex: 10 + column,
                                        boxSizing: 'border-box'
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        handleSelectEvent(event);
                                      }}
                                    >
                                      <div 
                                        className="h-full rounded px-2.5 py-1.5 text-xs flex flex-col gap-0.5 mr-1 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                                        style={{
                                          backgroundColor: getEventBgColorWithTaskLabel(event),
                                          borderLeft: `3px solid ${getEventColorWithTaskLabel(event)}`
                                        }}
                                      >
                                        <div className="flex items-start gap-1.5">
                                          <div className="flex flex-col flex-1 min-w-0">
                                            {/* Время и название */}
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-gray-700 font-normal flex-shrink-0 text-[10px] leading-tight">
                                                {formatTime(event.startTime)}
                                              </span>
                                              <span className="font-medium text-gray-900 truncate flex-1 min-w-0 text-[11px] leading-tight">
                                                {event.title}
                                              </span>
                                            </div>
                                            {/* Продолжительность и тип события */}
                                            {heightPx >= 25 && (
                                              <div className="flex items-center gap-1.5 text-[9px] text-gray-500 mt-0.5">
                                                {/* Всегда показываем продолжительность если высота достаточная */}
                                                <span className="flex-shrink-0">
                                                  {formatTime(event.endTime)}
                                                </span>
                                                {realDurationMinutes > 0 && (
                                                  <>
                                                    <span className="text-gray-400">•</span>
                                                    <span className="flex-shrink-0">
                                                      {Math.floor(realDurationMinutes / 60) > 0 && `${Math.floor(realDurationMinutes / 60)}ч `}
                                                      {realDurationMinutes % 60 > 0 && `${realDurationMinutes % 60}м`}
                                                    </span>
                                                  </>
                                                )}
                                                {event.type !== EventType.TASK && heightPx >= 40 && (
                                                  <>
                                                    <span className="text-gray-400">•</span>
                                                    <span className="flex-shrink-0">
                                                      {event.type === EventType.MEETING ? t('calendarViewModal.meeting1'):
                                                       event.type === EventType.CALL ? t('calendarViewModal.call1'):
                                                       event.type === EventType.REMINDER ? t('calendarViewModal.reminder'): ''}
                                                    </span>
                                                  </>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                              
                            </div>
                            
                            {/* Кликабельная область для создания события - только для пустых мест */}
                            <div 
                              className="absolute inset-0 pl-20 cursor-pointer pointer-events-none"
                            >
                              <div
                                className="absolute inset-0"
                                onClick={(e) => {
                                  // Проверяем, что клик не на событии и не идет перетаскивание
                                  const clickedEvent = (e.target as HTMLElement).closest('[data-event-item]');
                                  if (clickedEvent === null && !draggedEventTime) {
                                    // Календарь только отображает задачи, не создаёт их
                                  }
                                }}
                                style={{ pointerEvents: 'auto' }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : selectedPeriod === t('calendarViewModal.week') ? (
                    (() => {
                      const { start, end } = getPeriodDates();
                      const weekDays: Date[] = [];
                      const currentDate = new Date(start);
                      while (currentDate <= end) {
                        weekDays.push(new Date(currentDate));
                        currentDate.setDate(currentDate.getDate() + 1);
                      }
                      
                      // Используем мемоизированные данные
                      const groupedEvents = groupedEventsForWeek;
                      
                      return (
                        <>
                          {weekDays.map((day) => {
                            const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                            const dayEvents = groupedEvents.get(dayKey) || [];
                            const dayFormatted = formatDateDay(day);
                            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                            
                            return (
                              <div 
                                key={dayKey} 
                                className={`flex items-center p-2 rounded-[6px] ${isWeekend ? 'bg-[var(--secondary)]' : 'bg-[var(--muted)]'} ${dayEvents.length > 0 ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${dragOverDay === dayKey ? 'ring-2 ring-dream-primary' : ''}`}
                                onDragOver={(e) => handleDragOver(e, dayKey)}
                                onDragLeave={() => setDragOverDay(null)}
                                onDrop={(e) => handleDrop(e, day)}
                                onClick={(e) => {
                                  // Если клик на пустое место (не на событие), создаем событие на этот день
                                  const clickedEvent = (e.target as HTMLElement).closest('[data-event-item]');
                                  if (clickedEvent === null) {
                                    // Календарь только отображает задачи, не создаёт их
                                  }
                                }}
                              >
                                <div className='flex items-center pl-5 text-black w-12'>
                                  <span>{day.getDate()}</span>
                                </div>
                                <div className='flex items-center pl-3 text-black w-35'>
                                  <span>{dayFormatted}</span>
                                </div>
                                <div className='flex flex-col gap-1.5 flex-1'>
                                  {dayEvents.length === 0 ? (
                                    <div className='min-h-13.5 flex-1 rounded-lg flex items-center py-4 gap-4'>
                                      <span className='flex-1 min-w-37.5'>{t('calendarViewModal.noEvents')}</span>
                                    </div>
                                  ) : (
                                    dayEvents.map((event, index) => (
                                      <EventItem
                                        key={event._id}
                                        event={event}
                                        index={index}
                                        onSelect={handleSelectEvent}
                                        onDelete={handleDeleteEventFromList}
                                        onDragStart={handleDragStart}
                                        draggedEventId={draggedEvent?._id || null}
                                        tasksDataMap={tasksDataMap}
                                        isWeekView={true}
                                      />
                                    ))
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      );
                    })()
                  ) : selectedPeriod === t('calendarViewModal.month') ? (
                    (() => {
                      // Календарная сетка для месяца
                      const year = currentDate.getFullYear();
                      const month = currentDate.getMonth();
                      const firstDay = new Date(year, month, 1);
                      const lastDay = new Date(year, month + 1, 0);
                      const daysInMonth = lastDay.getDate();
                      const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Понедельник = 0
                      
                      const prevMonthLastDay = new Date(year, month, 0).getDate();
                      const days: Array<{ day: number; date: Date; isCurrentMonth: boolean }> = [];
                      
                      // Дни предыдущего месяца
                      for (let i = startingDayOfWeek - 1; i >= 0; i--) {
                        const date = new Date(year, month - 1, prevMonthLastDay - i);
                        days.push({ day: prevMonthLastDay - i, date, isCurrentMonth: false });
                      }
                      
                      // Дни текущего месяца
                      for (let i = 1; i <= daysInMonth; i++) {
                        const date = new Date(year, month, i);
                        days.push({ day: i, date, isCurrentMonth: true });
                      }
                      
                      // Дни следующего месяца для заполнения сетки
                      const totalDays = days.length;
                      const remainingInWeek = totalDays % 7;
                      if (remainingInWeek > 0) {
                        const daysToAdd = 7 - remainingInWeek;
                        for (let i = 1; i <= daysToAdd; i++) {
                          const date = new Date(year, month + 1, i);
                          days.push({ day: i, date, isCurrentMonth: false });
                        }
                      }
                      
                      // Группируем события по дням
                      // Для задач с длительным сроком отображаем их в каждом дне, который они пересекают
                      const monthEventsMap = new Map<string, CalendarEvent[]>();
                      allEvents.forEach(event => {
                        // Фильтруем по поисковому запросу, если он есть
                        const matchesSearch = !searchQuery || 
                          event.title.toLowerCase().includes(searchQuery.toLowerCase());
                        
                        if (!matchesSearch) return;
                        
                        const eventStart = new Date(event.startTime);
                        const eventEnd = new Date(event.endTime);
                        
                        // Проверяем пересечение события с каждым днем месяца
                        days.forEach(dayInfo => {
                          // Определяем границы дня
                          const dayStart = new Date(dayInfo.date.getFullYear(), dayInfo.date.getMonth(), dayInfo.date.getDate(), 0, 0, 0, 0);
                          const dayEnd = new Date(dayInfo.date.getFullYear(), dayInfo.date.getMonth(), dayInfo.date.getDate(), 23, 59, 59, 999);
                          
                          // Проверяем, пересекается ли событие с этим днем
                          // Событие должно начинаться до конца дня и заканчиваться после начала дня
                          const intersectsDay = eventStart.getTime() <= dayEnd.getTime() && eventEnd.getTime() >= dayStart.getTime();
                          
                          if (intersectsDay) {
                            const dayKey = `${dayInfo.date.getFullYear()}-${dayInfo.date.getMonth()}-${dayInfo.date.getDate()}`;
                            if (!monthEventsMap.has(dayKey)) {
                              monthEventsMap.set(dayKey, []);
                            }
                            monthEventsMap.get(dayKey)!.push(event);
                          }
                        });
                      });
                      
                      const weekDaysLabels = [t('calendarViewModal.mon1'), t('calendarViewModal.w'), t('calendarViewModal.wed1'), t('calendarViewModal.thu1'), t('calendarViewModal.fri1'), t('calendarViewModal.sat1'), t('calendarViewModal.sun1')];
                      
                      return (
                        <div className="flex flex-col h-full">
                          {/* Заголовки дней недели */}
                          <div className="grid grid-cols-7 gap-1 border-b border-gray-200 pb-2 mb-2">
                            {weekDaysLabels.map((label) => (
                              <div key={label} className="text-center text-xs font-medium text-gray-600 py-1">
                                {label}
                              </div>
                            ))}
                          </div>
                          
                          {/* Календарная сетка */}
                          <div className="grid grid-cols-7 gap-1 flex-1 overflow-y-auto">
                            {days.map((dayInfo, index) => {
                                const { t } = useI18n();
                              const dayKey = `${dayInfo.date.getFullYear()}-${dayInfo.date.getMonth()}-${dayInfo.date.getDate()}`;
                              const dayEvents = monthEventsMap.get(dayKey) || [];
                              const today = new Date();
                              const isToday = dayInfo.isCurrentMonth &&
                                dayInfo.day === today.getDate() &&
                                month === today.getMonth() &&
                                year === today.getFullYear();
                              
                              return (
                                <div
                                  key={index}
                                  className={`flex flex-col border border-gray-200 rounded p-1 min-h-[80px] ${
                                    !dayInfo.isCurrentMonth ? 'bg-gray-50 opacity-50' : 'bg-white'
                                  } ${isToday ? 'ring-2 ring-dream-primary' : ''} ${dragOverDay === dayKey ? 'ring-2 ring-dream-primary' : ''}`}
                                  onDragOver={(e) => {
                                    // Разрешаем перетаскивание на любую видимую дату, включая дни следующего месяца
                                    handleDragOver(e, dayKey);
                                  }}
                                  onDragLeave={() => {
                                    setDragOverDay(null);
                                  }}
                                  onDrop={(e) => {
                                    // Разрешаем перетаскивание на любую видимую дату, включая дни следующего месяца
                                    handleDrop(e, dayInfo.date);
                                  }}
                                  onClick={(e) => {
                                    const clickedEvent = (e.target as HTMLElement).closest('[data-event-item]');
                                    if (clickedEvent === null && dayInfo.isCurrentMonth) {
                                      // Переключаемся на дневной вид с выбранной датой
                                      setCurrentDate(new Date(dayInfo.date.getFullYear(), dayInfo.date.getMonth(), dayInfo.date.getDate()));
                                      setSelectedPeriod(t('calendarViewModal.day'));
                                    }
                                  }}
                                >
                                  <div className={`text-xs font-medium mb-1 ${isToday ? 'text-dream-primary' : dayInfo.isCurrentMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                                    {dayInfo.day}
                                  </div>
                                  <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                                    {dayEvents.slice(0, 3).map((event) => {
                                      const isDragged = draggedEvent?._id === event._id;
                                      const isMultiDay = isMultiDayEvent(event);
                                      return (
                                        <div
                                          key={event._id}
                                          data-event-item
                                          draggable={true}
                                          onDragStart={() => handleDragStart(event)}
                                          onDragEnd={handleDragEnd}
                                          className="text-[9px] px-1 py-0.5 rounded truncate cursor-grab active:cursor-grabbing"
                                          style={{
                                            backgroundColor: getEventBgColorWithTaskLabel(event),
                                            borderLeft: `2px solid ${getEventColorWithTaskLabel(event)}`,
                                            color: '#374151',
                                            opacity: isDragged ? 0.5 : 1
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelectEvent(event);
                                          }}
                                        >
                                          {isMultiDay ? event.title : `${formatTime(event.startTime)} ${event.title}`}
                                        </div>
                                      );
                                    })}
                                    {dayEvents.length > 3 && (
                                      <div className="text-[9px] text-gray-500 px-1">
                                        +{dayEvents.length - 3} {t('crm.crm.calendarViewModal.еще')}</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()
                  ) : selectedPeriod === t('calendarViewModal.year') ? (
                    (() => {
                      // Отображение года - 12 месяцев
                      const year = currentDate.getFullYear();
                      const monthNames = [t('calendarViewModal.january2'), t('calendarViewModal.february2'), t('calendarViewModal.march2'), t('calendarViewModal.april2'), t('calendarViewModal.may2'), t('calendarViewModal.june2'), t('calendarViewModal.july2'), t('calendarViewModal.august2'), t('calendarViewModal.september2'), t('calendarViewModal.october2'), t('calendarViewModal.november2'), t('calendarViewModal.december2')];
                      
                      // Группируем события по месяцам
                      const yearEventsMap = new Map<number, CalendarEvent[]>();
                      allEvents.forEach(event => {
                        const eventDate = new Date(event.startTime);
                        if (eventDate.getFullYear() === year) {
                          const month = eventDate.getMonth();
                          if (!yearEventsMap.has(month)) {
                            yearEventsMap.set(month, []);
                          }
                          yearEventsMap.get(month)!.push(event);
                        }
                      });
                      
                      return (
                        <div className="grid grid-cols-3 gap-4 overflow-y-auto">
                          {Array.from({ length: 12 }, (_, monthIndex) => {
                              const { t } = useI18n();
                            const monthEvents = yearEventsMap.get(monthIndex) || [];
                            const firstDay = new Date(year, monthIndex, 1);
                            const lastDay = new Date(year, monthIndex + 1, 0);
                            const daysInMonth = lastDay.getDate();
                            const startingDayOfWeek = (firstDay.getDay() + 6) % 7;
                            
                            const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();
                            const days: Array<{ day: number; isCurrentMonth: boolean }> = [];
                            
                            for (let i = startingDayOfWeek - 1; i >= 0; i--) {
                              days.push({ day: prevMonthLastDay - i, isCurrentMonth: false });
                            }
                            
                            for (let i = 1; i <= daysInMonth; i++) {
                              days.push({ day: i, isCurrentMonth: true });
                            }
                            
                            const totalDays = days.length;
                            const remainingInWeek = totalDays % 7;
                            if (remainingInWeek > 0) {
                              const daysToAdd = 7 - remainingInWeek;
                              for (let i = 1; i <= daysToAdd; i++) {
                                days.push({ day: i, isCurrentMonth: false });
                              }
                            }
                            
                            return (
                              <div key={monthIndex} className="flex flex-col border border-gray-200 rounded-lg p-3 bg-white">
                                <div className="text-sm font-normal text-gray-900 mb-2">
                                  {monthNames[monthIndex]}
                                </div>
                                <div className="grid grid-cols-7 gap-1 text-[10px]">
                                  {[t('calendarViewModal.mon1'), t('calendarViewModal.w'), t('calendarViewModal.wed1'), t('calendarViewModal.thu1'), t('calendarViewModal.fri1'), t('calendarViewModal.sat1'), t('calendarViewModal.sun1')].map((label) => (
                                    <div key={label} className="text-center text-gray-500 font-medium">
                                      {label}
                                    </div>
                                  ))}
                                  {days.map((dayInfo, dayIndex) => {
                                    const dayEvents = monthEvents.filter(event => {
                                      const eventDate = new Date(event.startTime);
                                      return eventDate.getFullYear() === year &&
                                             eventDate.getMonth() === monthIndex &&
                                             eventDate.getDate() === dayInfo.day;
                                    });
                                    
                                    const today = new Date();
                                    const isToday = dayInfo.isCurrentMonth &&
                                      dayInfo.day === today.getDate() &&
                                      monthIndex === today.getMonth() &&
                                      year === today.getFullYear();
                                    
                                    return (
                                      <div
                                        key={dayIndex}
                                        className={`text-center py-1 rounded ${
                                          !dayInfo.isCurrentMonth ? 'text-gray-300' : ''
                                        } ${isToday ? 'bg-dream-primary text-white font-normal' : ''} ${
                                          dayEvents.length > 0 && dayInfo.isCurrentMonth ? 'bg-[var(--secondary)]' : ''
                                        }`}
                                        onClick={() => {
                                          if (dayInfo.isCurrentMonth) {
                                            // Переключаемся на режим "Месяц" с выбранным месяцем
                                            setCurrentDate(new Date(year, monthIndex, 1));
                                            setSelectedPeriod(t('calendarViewModal.month'));
                                          }
                                        }}
                                      >
                                        {dayInfo.day}
                                      </div>
                                    );
                                  })}
                                </div>
                                {monthEvents.length > 0 && (
                                  <div className="mt-2 text-xs text-gray-600">
                                    {t('crm.crm.calendarViewModal.событий')}{monthEvents.length}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : selectedPeriod === t('calendarViewModal.schedule') ? (
                    (() => {
                      const { start, end } = getPeriodDates();
                      const weekDays: Date[] = [];
                      const tempDate = new Date(start);
                      while (tempDate <= end) {
                        weekDays.push(new Date(tempDate));
                        tempDate.setDate(tempDate.getDate() + 1);
                      }
                      
                      // Группируем события по дням и сортируем по времени
                      const scheduleEventsByDay = new Map<string, CalendarEvent[]>();
                      
                      allEvents.forEach(event => {
                        const eventDate = new Date(event.startTime);
                        const dayKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`;
                        
                        // Проверяем, попадает ли событие в диапазон недели
                        if (eventDate >= start && eventDate <= end) {
                          if (!scheduleEventsByDay.has(dayKey)) {
                            scheduleEventsByDay.set(dayKey, []);
                          }
                          scheduleEventsByDay.get(dayKey)!.push(event);
                        }
                      });
                      
                      // Сортируем события по времени для каждого дня
                      scheduleEventsByDay.forEach((events) => {
                        events.sort((a, b) => {
                          const timeA = new Date(a.startTime).getTime();
                          const timeB = new Date(b.startTime).getTime();
                          return timeA - timeB;
                        });
                      });
                      
                      // Функция форматирования времени
                      const formatTime = (date: Date): string => {
                        const hours = date.getHours().toString().padStart(2, '0');
                        const minutes = date.getMinutes().toString().padStart(2, '0');
                        return `${hours}:${minutes}`;
                      };
                      
                      // Функция форматирования даты для заголовка
                      const formatScheduleDate = (date: Date): string => {
                        const dayNames = [t('calendarViewModal.sunday'), t('calendarViewModal.monday'), t('calendarViewModal.tuesday'), t('calendarViewModal.wednesday'), t('calendarViewModal.thursday'), t('calendarViewModal.friday'), t('calendarViewModal.saturday')];
                        const monthNames = [t('calendarViewModal.january'), t('calendarViewModal.february'), t('calendarViewModal.march'), t('calendarViewModal.april'), t('calendarViewModal.may1'), t('calendarViewModal.june'), t('calendarViewModal.july'), t('calendarViewModal.august'), t('calendarViewModal.september'), t('calendarViewModal.october'), t('calendarViewModal.november'), t('calendarViewModal.december')];
                        const dayName = dayNames[date.getDay()];
                        const day = date.getDate();
                        const month = monthNames[date.getMonth()];
                        return `${dayName}, ${day} ${month}`;
                      };
                      
                      return (
                        <div className="flex flex-col h-full overflow-y-auto">
                          {weekDays.map((day) => {
                            const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                            const dayEvents = scheduleEventsByDay.get(dayKey) || [];
                            const isToday = day.toDateString() === new Date().toDateString();
                            
                            return (
                              <div 
                                key={dayKey} 
                                className={`mb-6 ${dragOverDay === dayKey ? 'ring-2 ring-dream-primary rounded-lg p-2' : ''}`}
                                onDragOver={(e) => handleDragOver(e, dayKey)}
                                onDragLeave={() => setDragOverDay(null)}
                                onDrop={(e) => handleDrop(e, day)}
                              >
                                {/* Заголовок дня */}
                                <div className={`sticky top-0 z-10 bg-white border-b-2 pb-2 mb-3 ${
                                  isToday ? 'border-dream-primary' : 'border-gray-200'
                                }`}>
                                  <div className="flex items-center gap-3">
                                    <div className={`text-lg font-normal ${
                                      isToday ? 'text-dream-primary' : 'text-gray-900'
                                    }`}>
                                      {formatScheduleDate(day)}
                                    </div>
                                    {dayEvents.length > 0 && (
                                      <div className="text-sm text-gray-500">
                                        {dayEvents.length} {dayEvents.length === 1 ? t('calendarViewModal.event'): dayEvents.length < 5 ? t('calendarViewModal.events'): t('calendarViewModal.events1')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Список событий дня */}
                                {dayEvents.length === 0 ? (
                                  <div className="text-gray-400 text-sm py-4 pl-4">{t('calendarViewModal.noEvents')}</div>
                                ) : (
                                  <div className="space-y-2">
                                    {dayEvents.map((event) => {
                                      const startDate = new Date(event.startTime);
                                      const endDate = new Date(event.endTime);
                                      const isAllDay = event.isAllDay || false;
                                      const isDragged = draggedEvent?._id === event._id;
                                      
                                      return (
                                        <div
                                          key={event._id}
                                          data-event-item
                                          draggable={true}
                                          onDragStart={() => handleDragStart(event)}
                                          onDragEnd={handleDragEnd}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelectEvent(event);
                                          }}
                                          className="flex items-start gap-4 p-3 rounded-lg hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors border border-gray-200"
                                          style={{
                                            opacity: isDragged ? 0.5 : 1
                                          }}
                                        >
                                          {/* Время события */}
                                          <div className="flex-shrink-0 w-20 text-sm font-medium text-gray-700">
                                            {isAllDay ? (
                                              <span className="text-gray-500">{t('calendarViewModal.allDay')}</span>
                                            ) : (
                                              <div className="flex flex-col">
                                                <span>{formatTime(startDate)}</span>
                                                {endDate.getTime() !== startDate.getTime() && (
                                                  <span className="text-xs text-gray-500">{formatTime(endDate)}</span>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                          
                                          {/* Информация о событии */}
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-start gap-2">
                                              <div className="flex-1 min-w-0">
                                                <div className="font-normal text-gray-900 truncate">
                                                  {event.title}
                                                </div>
                                                {event.description && (
                                                  <div className="text-sm text-gray-600 mt-1 line-clamp-2">
                                                    {event.description}
                                                  </div>
                                                )}
                                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                  <span className="text-base px-2 py-1 rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_15%,var(--secondary))] text-[var(--accent)]">
                                                    {event.type === EventType.MEETING ? t('calendarViewModal.meeting1'):
                                                     event.type === EventType.CALL ? t('calendarViewModal.call1'):
                                                     event.type === EventType.REMINDER ? t('calendarViewModal.reminder'): ''}
                                                  </span>
                                                  {event.location && (
                                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                                        <circle cx="12" cy="10" r="3"></circle>
                                                      </svg>
                                                      {event.location}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Автоматическое открытие модалки создания события при открытии CalendarViewModal - убрано

  // Инициализация формы при открытии модального окна
  useEffect(() => {
    if (isCreateEventModalOpen) {
      // Если дата уже установлена (например, при клике на день), не перезаписываем её
      if (eventFormStartDate) {
        return;
      }
      
      // Если есть initialDate, используем его, иначе текущую дату
      if (initialDate) {
        // Убеждаемся, что initialDate - это объект Date
        const date = initialDate instanceof Date ? initialDate : new Date(initialDate);
        
        // Создаем новую дату с нулевым временем в локальном часовом поясе, чтобы избежать проблем с UTC
        const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        
        // Используем локальные методы для извлечения даты
        const year = localDate.getFullYear();
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const day = String(localDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        // Устанавливаем время 9:00 для начала
        const startTimeStr = '09:00';
        // Устанавливаем время 10:00 для окончания
        const endTimeStr = '10:00';
        
        setEventFormStartDate(dateStr);
        setEventFormStartTime(startTimeStr);
        setEventFormEndDate(dateStr);
        setEventFormEndTime(endTimeStr);
        // Сбрасываем остальные поля формы, включая externalParticipants
        setEventFormTitle('');
        setEventFormDescription('');
        setEventFormLocation('');
        setEventFormMeetingUrl('');
        setEventFormLeadId('');
        setEventFormParticipants([]);
        setEventFormExternalParticipants([]);
        setEventFormReminderMinutes([1440, 360, 60]);
        setEventFormIsRecurring(false);
        setEventFormRecurringRule('');
        setEventFormIsAllDay(false);
        setEventFormType(EventType.MEETING);
      } else {
        // Если нет initialDate, используем текущую дату и время
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const timeStr = now.toTimeString().slice(0, 5);
        setEventFormStartDate(dateStr);
        setEventFormStartTime(timeStr);
        setEventFormEndDate(dateStr);
        const endTimeDate = new Date(now.getTime() + 60 * 60 * 1000); // +1 час
        setEventFormEndTime(endTimeDate.toTimeString().slice(0, 5));
        // Сбрасываем форму при открытии модального окна
        resetEventForm();
      }
    }
  }, [isCreateEventModalOpen, resetEventForm, initialDate, eventFormStartDate]);

  // Состояние для удаления события
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<CalendarEvent | null>(null);

  // Функция удаления события
  const handleDeleteEvent = useCallback(async () => {
    if (!eventToDelete || !user?.id || !user?.role) {
      alert(t('calendarViewModal.errorNoUserRoleOrEventToDelete'));
      return;
    }

    setIsDeletingEvent(true);
    try {
      // Согласно документации: если ID начинается с task_, удаляется задача через unified view
      // Если ID является обычным MongoDB ObjectId, удаляется событие календаря
      // API автоматически определяет тип объекта по ID
      // userId обязателен согласно документации
      const eventId = eventToDelete._id;
      const response = await calendarCrmService.deleteCalendarEvent(eventId);
      
      if (response.success) {
        // УМНОЕ СРАВНЕНИЕ: Удаляем событие из локального состояния
        // Проверяем, действительно ли событие было удалено (может быть уже удалено)
        setAllEvents(prevEvents => {
          const filtered = prevEvents.filter(e => e._id !== eventId);
          // Если длина не изменилась, значит события не было в списке
          if (filtered.length === prevEvents.length) {
            return prevEvents; // Событие уже было удалено, не обновляем
          }
          return filtered; // Событие удалено, обновляем
        });
        
        // Удаляем из tasksDataMap, если это задача
        if (eventId.startsWith('task_')) {
          const normalizedTaskId = eventId.replace('task_', '');
          setTasksDataMap(prev => {
            const newMap = new Map(prev);
            newMap.delete(normalizedTaskId);
            newMap.delete(eventId);
            return newMap;
          });
        }
        
        setSelectedEvent(null);
        setShowDeleteConfirm(false);
        setEventToDelete(null);
        
        // Обновляем данные с бэкенда после закрытия модального окна
        // Умное сравнение предотвратит лишние обновления
        setTimeout(() => {
          loadEvents();
        }, 100);
      } else {
        alert(response.message || t('calendarViewModal.errorWhenDeletingEvent'));
      }
    } catch (error: any) {
      console.error('Error deleting event:', error);
      const errorMessage = error.response?.data?.message || error.message || t('calendarViewModal.errorWhenDeletingEvent');
      alert(errorMessage);
    } finally {
      setIsDeletingEvent(false);
    }
  }, [eventToDelete, user?.id, user?.role, loadEvents]);

  // Обработчик обновления события
  const handleUpdateEvent = useCallback(async (eventId: string, updateData: UpdateCalendarEventDto) => {
    if (!user?.id) return;

    try {
      const response = await calendarCrmService.updateCalendarEvent(eventId, updateData);
      
      if (response.success && response.data) {
        const updatedEvent = response.data;
        // УМНОЕ СРАВНЕНИЕ: Обновляем событие в локальном состоянии только если данные изменились
        setAllEvents(prevEvents => {
          // Для обычных событий (не TASK) ищем по точному совпадению ID
          // Для событий типа TASK учитываем префикс task_
          const isTaskEvent = updatedEvent.type === EventType.TASK;
          
          let updatedEvents: CalendarEvent[];
          
          if (isTaskEvent) {
            // Для событий типа TASK: нормализуем ID (учитываем префикс task_)
            const normalizeId = (id: string) => {
              if (id.startsWith('task_')) {
                return { withPrefix: id, withoutPrefix: id.replace('task_', '') };
              }
              return { withPrefix: `task_${id}`, withoutPrefix: id };
            };
            
            const oldIdVariants = normalizeId(eventId);
            const newIdVariants = normalizeId(updatedEvent._id);
            
            // Ищем событие по старому ID (в любом варианте)
            const eventIndex = prevEvents.findIndex(event => {
              const eventIdVariants = normalizeId(event._id);
              return event._id === eventId ||
                     event._id === oldIdVariants.withPrefix ||
                     event._id === oldIdVariants.withoutPrefix ||
                     eventIdVariants.withPrefix === oldIdVariants.withPrefix ||
                     eventIdVariants.withoutPrefix === oldIdVariants.withoutPrefix;
            });
            
            if (eventIndex !== -1) {
              // Событие найдено - обновляем его и удаляем старое, если ID изменился
              const foundEvent = prevEvents[eventIndex];
              if (foundEvent._id === updatedEvent._id) {
                // ID не изменился - просто обновляем
                updatedEvents = prevEvents.map(event => 
                  event._id === eventId ? updatedEvent : event
                );
              } else {
                // ID изменился - удаляем старое и добавляем новое
                updatedEvents = prevEvents
                  .filter(event => {
                    const eventIdVariants = normalizeId(event._id);
                    return !(event._id === eventId ||
                            event._id === oldIdVariants.withPrefix ||
                            event._id === oldIdVariants.withoutPrefix ||
                            eventIdVariants.withPrefix === oldIdVariants.withPrefix ||
                            eventIdVariants.withoutPrefix === oldIdVariants.withoutPrefix);
                  })
                  .concat(updatedEvent);
              }
            } else {
              // Событие не найдено по старому ID (возможно, ID изменился)
              // Проверяем, есть ли событие с новым ID
              const existsWithNewId = prevEvents.some(event => {
                const eventIdVariants = normalizeId(event._id);
                return event._id === updatedEvent._id ||
                       eventIdVariants.withPrefix === newIdVariants.withPrefix ||
                       eventIdVariants.withoutPrefix === newIdVariants.withoutPrefix;
              });
              
              if (existsWithNewId) {
                // Событие уже есть с новым ID - обновляем его
                updatedEvents = prevEvents.map(event => {
                  const eventIdVariants = normalizeId(event._id);
                  if (event._id === updatedEvent._id ||
                      eventIdVariants.withPrefix === newIdVariants.withPrefix ||
                      eventIdVariants.withoutPrefix === newIdVariants.withoutPrefix) {
                    return updatedEvent;
                  }
                  return event;
                });
              } else {
                // Событие не найдено ни по старому, ни по новому ID - добавляем его
                updatedEvents = [...prevEvents, updatedEvent];
              }
            }
          } else {
            // Для обычных событий (не TASK): ищем по точному совпадению ID
            const eventIndex = prevEvents.findIndex(event => event._id === eventId);
            
            if (eventIndex !== -1) {
              // Событие найдено - обновляем его
              updatedEvents = prevEvents.map(event => 
                event._id === eventId ? updatedEvent : event
              );
            } else {
              // Событие не найдено - проверяем, есть ли событие с новым ID
              const existsWithNewId = prevEvents.some(event => event._id === updatedEvent._id);
              
              if (existsWithNewId) {
                // Событие уже есть с новым ID - обновляем его
                updatedEvents = prevEvents.map(event => 
                  event._id === updatedEvent._id ? updatedEvent : event
                );
              } else {
                // Событие не найдено - добавляем его (возможно, ID изменился)
                updatedEvents = [...prevEvents, updatedEvent];
              }
            }
          }
          
          // Сравниваем обновленный массив с предыдущим
          const fieldsToCompare = ['_id', 'title', 'startTime', 'endTime', 'type', 'status', 'description', 'location', 'meetingUrl', 'isAllDay', 'leadId', 'taskId', 'participants', 'externalParticipants', 'reminderMinutes', 'isRecurring', 'recurringRule'];
          if (compareArrays(prevEvents, updatedEvents, '_id', fieldsToCompare)) {
            return prevEvents; // Данные не изменились
          }
          
          // ВАЖНО: Обновляем Map отрендеренных событий для обновленного события
          // Это критично для правильного отображения в календаре после редактирования
          updatedEvents.forEach(event => {
            const existing = renderedEventsRef.current.get(event._id);
            if (!existing || !compareCalendarEvents(existing, event)) {
              // Событие новое или изменилось - обновляем в Map
              renderedEventsRef.current.set(event._id, event);
            }
          });
          
          // Удаляем старые события из Map, если ID изменился
          const currentIds = new Set(updatedEvents.map(e => e._id));
          renderedEventsRef.current.forEach((_, id) => {
            if (!currentIds.has(id)) {
              renderedEventsRef.current.delete(id);
            }
          });
          
          return updatedEvents; // Данные изменились
        });
        
        // УМНОЕ СРАВНЕНИЕ: Обновляем selectedEvent ТОЛЬКО если данные действительно изменились
        // НЕ вызываем setState если данные идентичны
        // Также проверяем, если ID изменился (например, task_123 -> 123)
        if (selectedEvent && (selectedEvent._id === eventId || selectedEvent._id === updatedEvent._id)) {
          if (!compareCalendarEvents(selectedEvent, updatedEvent)) {
            // Данные изменились - обновляем
            setSelectedEvent(updatedEvent);
          }
          // Если данные идентичны - НЕ вызываем setState вообще
        }
        
        // Обновляем eventToEdit аналогично
        if (eventToEdit && (eventToEdit._id === eventId || eventToEdit._id === updatedEvent._id)) {
          if (!compareCalendarEvents(eventToEdit, updatedEvent)) {
            // Данные изменились - обновляем
            setEventToEdit(updatedEvent);
          }
          // Если данные идентичны - НЕ вызываем setState вообще
        }
        
        // Закрываем модальное окно редактирования
        setIsEditingEvent(false);
        setEventToEdit(null);
        
        // Для событий типа TASK не вызываем loadEvents сразу, так как это может привести к потере события
        // из-за логики фильтрации задач. Вместо этого полагаемся на реалтайм синхронизацию через WebSocket
        // или на обновление через оптимистичное обновление выше
        // Для обычных событий календаря можно обновить данные
        if (updatedEvent.type !== EventType.TASK) {
          // Обновляем данные с бэкенда после закрытия модального окна
          // Умное сравнение предотвратит лишние обновления
          setTimeout(() => {
            loadEvents();
          }, 100);
        }
      } else {
        alert(response.message || t('calendarViewModal.errorUpdatingEvent'));
      }
    } catch (error: any) {
      console.error('Error updating event:', error);
      alert(error.message || t('calendarViewModal.errorUpdatingEvent'));
    }
  }, [user?.id, loadEvents, selectedEvent]);

  // УМНОЕ СРАВНЕНИЕ: Используем useMemo для стабильных версий событий
  // Это предотвращает ререндеры модальных окон, если данные не изменились
  // Используем ref для хранения предыдущего значения, чтобы сравнивать только при реальных изменениях
  const prevSelectedEventRef = useRef<CalendarEvent | null>(null);
  const stableSelectedEvent = useMemo(() => {
    if (!selectedEvent) {
      prevSelectedEventRef.current = null;
      return null;
    }
    
    // Сравниваем с предыдущим значением - возвращаем старое, если данные идентичны
    if (prevSelectedEventRef.current && compareCalendarEvents(prevSelectedEventRef.current, selectedEvent)) {
      return prevSelectedEventRef.current; // Данные не изменились - возвращаем старое значение
    }
    
    // Данные изменились - обновляем ref и возвращаем новое значение
    prevSelectedEventRef.current = selectedEvent;
    return selectedEvent;
  }, [selectedEvent]);
  
  const prevEventToEditRef = useRef<CalendarEvent | null>(null);
  const stableEventToEdit = useMemo(() => {
    if (!eventToEdit || !isEditingEvent) {
      prevEventToEditRef.current = null;
      return null;
    }
    
    // Сравниваем с предыдущим значением - возвращаем старое, если данные идентичны
    if (prevEventToEditRef.current && compareCalendarEvents(prevEventToEditRef.current, eventToEdit)) {
      return prevEventToEditRef.current; // Данные не изменились - возвращаем старое значение
    }
    
    // Данные изменились - обновляем ref и возвращаем новое значение
    prevEventToEditRef.current = eventToEdit;
    return eventToEdit;
  }, [eventToEdit, isEditingEvent]);

  // Мемоизируем функции закрытия модальных окон для предотвращения ререндеров
  const handleCloseEventDetails = useCallback(() => {
    setSelectedEvent(null);
    setShowDeleteConfirm(false);
  }, []);
  
  const handleOpenEditFromDetails = useCallback((event: CalendarEvent) => {
    setEventToEdit(event);
    setIsEditingEvent(true);
  }, []);
  
  const handleOpenDeleteFromDetails = useCallback((event: CalendarEvent) => {
    setEventToDelete(event);
    setShowDeleteConfirm(true);
  }, []);
  
  // Открытие связанной задачи из события (детали/редактирование)
  const handleOpenTaskFromEvent = useCallback(async (taskId: string) => {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      alert(t('calendarViewModal.couldNotDetermineTheAssociated'));
      return;
    }

    try {
      // Прямое получение задачи
      const directResponse = await crmTaskService.getTask(normalizedTaskId);
      if (directResponse.success && directResponse.data) {
        setSelectedTaskForView(directResponse.data);
        setIsTaskViewModalOpen(true);
        return;
      }

      // Фолбек через unified API, если прямой запрос не вернул данные
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 60);

      const unifiedResponse = await calendarCrmService.getCalendarUnified({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

      if (unifiedResponse.success && unifiedResponse.data) {
        const taskInUnified = unifiedResponse.data.tasks?.find((t: any) => {
          const id = normalizeTaskId(t?._id);
          return id === normalizedTaskId;
        });

        if (taskInUnified) {
          setSelectedTaskForView(taskInUnified as unknown as Task);
          setIsTaskViewModalOpen(true);
          return;
        }

        const eventWithTask = unifiedResponse.data.events?.find((e: any) => {
          const eventId = normalizeTaskId(e?._id);
          return eventId === normalizedTaskId;
        });

        if (eventWithTask?.taskId) {
          const fallbackTaskId = normalizeTaskId(
            typeof eventWithTask.taskId === 'string'
              ? eventWithTask.taskId
              : eventWithTask.taskId?._id
          );

          if (fallbackTaskId) {
            const taskResponse = await crmTaskService.getTask(fallbackTaskId);
            if (taskResponse.success && taskResponse.data) {
              setSelectedTaskForView(taskResponse.data);
              setIsTaskViewModalOpen(true);
              return;
            }
          }
        }
      }

      alert(t('calendarViewModal.taskNotFoundOrDeleted'));
    } catch (error: any) {
      console.error('Error loading task from event:', error);
      alert(t('calendarViewModal.errorLoadingTask'));
    }
  }, []);
  
  const handleCloseTaskView = useCallback(() => {
    setSelectedTaskForView(null);
    setIsTaskViewModalOpen(false);
  }, []);
  
  const handleCloseEditModal = useCallback(() => {
    setIsEditingEvent(false);
    setEventToEdit(null);
  }, []);
  
  const handleCloseDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    setEventToDelete(null);
  }, []);

  // Модальное окно для просмотра деталей события (улучшенное с возможностью удаления)
  // УМНОЕ СРАВНЕНИЕ: Используем стабильную версию события на основе умного сравнения
  // Выносим в отдельный компонент с пропсами для правильной работы React.memo
  const EventDetailsModalContent = React.memo<{
    event: CalendarEvent;
    onClose: () => void;
    onEdit: (event: CalendarEvent) => void;
    onDelete: (event: CalendarEvent) => void;
    onOpenTask?: (taskId: string) => void;
    tasksDataMap?: Map<string, { priority?: TaskPriority; colorLabel?: string; category?: number }>;
  }>(({ event, onClose, onEdit, onDelete, onOpenTask, tasksDataMap }) => {
      const { t } = useI18n();
    const eventToDisplay = event;

    // Используем цвет из задачи, если есть
    const eventColor = useMemo(() => {
      if (eventToDisplay.type !== EventType.TASK || !eventToDisplay.taskId || !tasksDataMap || tasksDataMap.size === 0) {
        return getEventColor(eventToDisplay.type);
      }
      
      // Получаем taskId как строку
      const taskIdString = typeof eventToDisplay.taskId === 'string' ? eventToDisplay.taskId : (eventToDisplay.taskId as any)?._id || (eventToDisplay.taskId as any)?.id || '';
      if (!taskIdString) {
        return getEventColor(eventToDisplay.type);
      }
      
      const normalizedTaskId = normalizeTaskId(taskIdString);
      if (!normalizedTaskId) {
        return getEventColor(eventToDisplay.type);
      }
      
      // Пробуем найти по разным вариантам ID
      let taskData = tasksDataMap.get(normalizedTaskId);
      if (!taskData) {
        taskData = tasksDataMap.get(taskIdString);
      }
      if (!taskData && !normalizedTaskId.startsWith('task_')) {
        taskData = tasksDataMap.get(`task_${normalizedTaskId}`);
      }
      if (!taskData && taskIdString.startsWith('task_')) {
        taskData = tasksDataMap.get(taskIdString.replace('task_', ''));
      }
      
      if (taskData?.colorLabel) {
        return taskData.colorLabel;
      }
      
      return getEventColor(eventToDisplay.type);
    }, [eventToDisplay.type, eventToDisplay.taskId, tasksDataMap]);
    const isAllDay = isAllDayEvent(eventToDisplay);
    const timeRange = isAllDay 
      ? t('calendarViewModal.allDay'): `${formatTime(eventToDisplay.startTime)} - ${formatTime(eventToDisplay.endTime)}`;

    const eventTypeLabels: Partial<Record<EventType, string>> = {
      [EventType.MEETING]: t('calendarViewModal.meeting1'),
      [EventType.CALL]: t('calendarViewModal.call1'),
      [EventType.REMINDER]: t('calendarViewModal.reminder'),
    };

    const startDate = new Date(eventToDisplay.startTime);
    const dateFormat = new Intl.DateTimeFormat('ru-RU', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric',
      weekday: 'long'
    });
    
    // Функция для форматирования напоминаний
    const formatReminderTime = (minutes: number): string => {
      if (minutes >= 1440) {
        const days = Math.floor(minutes / 1440);
        return days === 1 ? t('calendarViewModal.in1Day'): `За ${days} ${days < 5 ? t('calendarViewModal.day1'): t('calendarViewModal.days')}`;
      } else if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return hours === 1 ? t('calendarViewModal.in1Hour'): `За ${hours} ${hours < 5 ? t('calendarViewModal.hours'): t('calendarViewModal.hours1')}`;
      } else {
        return minutes === 1 ? t('calendarViewModal.in1Minute'): `За ${minutes} ${minutes < 5 ? t('calendarViewModal.minutes'): t('calendarViewModal.minutes1')}`;
      }
    };
    
    // Сортируем напоминания по времени (от больших к меньшим)
    const sortedReminders = eventToDisplay.reminderMinutes 
      ? [...eventToDisplay.reminderMinutes].sort((a, b) => b - a)
      : [];

    return createPortal(
      <div 
        className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-300"
        onClick={onClose}
      >
        <div
          className="relative flex flex-col bg-white md:pb-0 rounded-t-[25px] md:rounded-[25px] shadow-2xl w-full md:w-[50%] max-h-[calc(100vh-1rem)] md:max-h-[85vh] border border-gray-100 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative flex justify-between items-center px-6 py-5 border-b border-[var(--border)] bg-[var(--secondary)] rounded-t-[8px]">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0">
                <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="12" fill={eventColor} opacity="0.2"/>
                  <circle cx="16" cy="16" r="8" fill={eventColor}/>
                </svg>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="font-normal text-lg text-dream-primary break-words">{eventToDisplay.title}</div>
                <div className="text-sm text-gray-600 font-medium">{eventTypeLabels[eventToDisplay.type]}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onEdit(eventToDisplay)}
                className="text-dream-primary hover:text-dream-primary/80 transition-all duration-200 ease-in-out p-2 hover:bg-dream-secondary rounded-lg"
                title={t('calendarViewModal.editEvent')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#169600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#169600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => onDelete(eventToDisplay)}
                className="text-dream-primary hover:text-dream-primary/80 transition-all duration-200 ease-in-out p-2 hover:bg-dream-secondary rounded-lg"
                title={t('calendarViewModal.deleteEvent')}
              >
                <svg width="20" height="20" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="#358CD2"/>
                  <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="#358CD2"/>
                  <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="#358CD2"/>
                  <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="#358CD2"/>
                </svg>
              </button>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <button
              onClick={onClose}
              className="hidden md:block absolute -right-5 -top-5 bg-black/70 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
              aria-label={t('calendarViewModal.close')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto pb-10">
            <div className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex-shrink-0">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="12" fill={eventColor} opacity="0.2"/>
                  <circle cx="16" cy="16" r="8" fill={eventColor}/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-normal text-xl text-dream-primary mb-1 break-words">{eventToDisplay.title}</div>
                <div className="text-sm text-gray-600 font-medium">{eventTypeLabels[eventToDisplay.type]}</div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide">{t('calendarViewModal.dateTime')}</div>
                <div className="text-gray-900 font-medium">{dateFormat.format(startDate)}</div>
                <div className="text-gray-700 mt-1">{timeRange}</div>
              </div>
              
              {eventToDisplay.description && (
                <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide">{t('calendarViewModal.description')}</div>
                  <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">{eventToDisplay.description}</div>
                </div>
              )}
              
              {eventToDisplay.location && (
                <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide">{t('calendarViewModal.location')}</div>
                  <div className="text-gray-900 flex items-center gap-2">
                    <span className="text-xl">📍</span>
                    <span>{eventToDisplay.location}</span>
                  </div>
                </div>
              )}
              
              {eventToDisplay.meetingUrl && (
                <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide">{t('calendarViewModal.meetingLink')}</div>
                  <a 
                    href={eventToDisplay.meetingUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-dream-primary hover:underline break-all flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M6 3H3C2.44772 3 2 3.44772 2 4V13C2 13.5523 2.44772 14 3 14H12C12.5523 14 13 13.5523 13 13V10M10 2H14M14 2V6M14 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    {eventToDisplay.meetingUrl}
                  </a>
                </div>
              )}

              {eventToDisplay.leadId && (
                <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide">{t('calendarViewModal.relatedLead')}</div>
                  <div className="text-gray-900">
                    {typeof eventToDisplay.leadId === 'object' ? (
                      <>
                        <div className="font-normal">{eventToDisplay.leadId.name}</div>
                        <div className="text-sm text-gray-600 mt-1">{eventToDisplay.leadId.phone}</div>
                      </>
                    ) : (
                      <div className="text-sm">ID: {eventToDisplay.leadId}</div>
                    )}
                  </div>
                </div>
              )}

              {sortedReminders.length > 0 && (
                <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-xs font-normal text-dream-primary mb-3 uppercase tracking-wide flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1V3M8 13V15M3 8H1M15 8H13M4.34315 4.34315L2.92893 2.92893M13.0711 13.0711L11.6569 11.6569M4.34315 11.6569L2.92893 13.0711M13.0711 2.92893L11.6569 4.34315M8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    {t('crm.crm.calendarViewModal.напоминания')}</div>
                  <div className="flex flex-wrap gap-2">
                    {sortedReminders.map((minutes, index) => {
                      const reminderTime = new Date(startDate.getTime() - minutes * 60 * 1000);
                      const timeStr = reminderTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div 
                          key={index}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-pink-200 rounded-lg text-sm font-medium text-gray-700"
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-pink-500">
                            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                            <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                          <span className="text-gray-900 font-normal">{formatReminderTime(minutes)}</span>
                          <span className="text-gray-500 text-xs">({timeStr})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {eventToDisplay.type === EventType.TASK && eventToDisplay.taskId && (
                (() => {
                                const { t } = useI18n();
                  const rawTaskId = typeof eventToDisplay.taskId === 'string'
                    ? eventToDisplay.taskId
                    : eventToDisplay.taskId?._id;
                  const normalizedTaskId = normalizeTaskId(rawTaskId);
                  
                  return (
                    <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                      <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide flex items-center justify-between">
                        <span>{t('calendarViewModal.relatedTask')}</span>
                        {onOpenTask && normalizedTaskId && (
                          <button
                            onClick={() => onOpenTask(normalizedTaskId)}
                            className="text-xs text-dream-primary hover:text-dream-primary/80 font-medium px-3 py-1 bg-white border border-yellow-200 rounded-lg hover:bg-yellow-50 transition-colors duration-200"
                          >
                            {t('crm.crm.calendarViewModal.открыть_задачу')}</button>
                        )}
                      </div>
                      <div className="text-gray-700 text-sm">
                        {typeof eventToDisplay.taskId === 'object' && eventToDisplay.taskId?.title ? (
                          <div className="font-normal mb-1 break-words">{eventToDisplay.taskId.title}</div>
                        ) : (
                          <div className="text-sm">ID: {typeof eventToDisplay.taskId === 'string' ? eventToDisplay.taskId : ''}</div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }, (prevProps, nextProps) => {
    // Кастомное сравнение: ререндерим только если событие действительно изменилось
    return compareCalendarEvents(prevProps.event, nextProps.event) &&
           prevProps.onClose === nextProps.onClose &&
           prevProps.onEdit === nextProps.onEdit &&
           prevProps.onDelete === nextProps.onDelete &&
           prevProps.onOpenTask === nextProps.onOpenTask;
  });
  
  EventDetailsModalContent.displayName = 'EventDetailsModalContent';
  
  // Мемоизируем рендеринг модального окна - создается только при изменении события
  // Используем ref для хранения предыдущего события, чтобы не пересоздавать при идентичных данных
  const prevEventDetailsEventRef = useRef<CalendarEvent | null>(null);
  const prevEventDetailsContentRef = useRef<React.ReactNode>(null);
  const eventDetailsModalContent = useMemo(() => {
    if (!stableSelectedEvent) {
      prevEventDetailsEventRef.current = null;
      prevEventDetailsContentRef.current = null;
      return null;
    }
    
    // Если событие идентично предыдущему, возвращаем старое содержимое
    if (prevEventDetailsEventRef.current && 
        compareCalendarEvents(prevEventDetailsEventRef.current, stableSelectedEvent) &&
        prevEventDetailsContentRef.current) {
      return prevEventDetailsContentRef.current; // Данные не изменились - возвращаем старое содержимое
    }
    
    // Данные изменились - создаем новое содержимое
    const newContent = (
      <EventDetailsModalContent
        event={stableSelectedEvent}
        onClose={handleCloseEventDetails}
        onEdit={handleOpenEditFromDetails}
        onDelete={handleOpenDeleteFromDetails}
        onOpenTask={handleOpenTaskFromEvent}
        tasksDataMap={tasksDataMap}
      />
    );
    prevEventDetailsEventRef.current = stableSelectedEvent;
    prevEventDetailsContentRef.current = newContent;
    return newContent;
  }, [stableSelectedEvent, handleCloseEventDetails, handleOpenEditFromDetails, handleOpenDeleteFromDetails, handleOpenTaskFromEvent, tasksDataMap]);

  // Модальное окно редактирования события - выносим в отдельный компонент с пропсами
  const EditEventModalContent = React.memo<{
    event: CalendarEvent;
    onClose: () => void;
    onUpdate: (eventId: string, updateData: UpdateCalendarEventDto) => Promise<void>;
    onOpenTask?: (taskId: string) => void;
  }>(({ event, onClose, onUpdate, onOpenTask }) => {
      const { t } = useI18n();
    const eventToEdit = event;

    // Инициализируем начальные значения формы напрямую из eventToEdit
    // Используем useMemo для вычисления начальных значений только при изменении ID события
    const initialFormData = useMemo(() => {
      const startDateTime = new Date(eventToEdit.startTime);
      const endDateTime = new Date(eventToEdit.endTime);
      return {
        title: eventToEdit.title || '',
        description: eventToEdit.description || '',
        type: eventToEdit.type,
        isAllDay: eventToEdit.isAllDay || false,
        location: eventToEdit.location || '',
        meetingUrl: eventToEdit.meetingUrl || '',
        leadId: typeof eventToEdit.leadId === 'object' ? eventToEdit.leadId._id : (eventToEdit.leadId || ''),
        participants: eventToEdit.participants || [],
        externalParticipants: eventToEdit.externalParticipants || [],
        reminderMinutes: eventToEdit.reminderMinutes || [],
        isRecurring: eventToEdit.isRecurring || false,
        recurringRule: eventToEdit.recurringRule || '',
        startDate: startDateTime.toISOString().split('T')[0],
        startTime: startDateTime.toTimeString().slice(0, 5),
        endDate: endDateTime.toISOString().split('T')[0],
        endTime: endDateTime.toTimeString().slice(0, 5),
      };
    }, [eventToEdit._id]); // Обновляем только при изменении ID
    
    // Инициализируем форму редактирования данными события (используем функцию инициализации для useState)
    // Функция инициализации вызывается только один раз при первом рендере
    const [editFormTitle, setEditFormTitle] = useState(initialFormData.title);
    const [editFormDescription, setEditFormDescription] = useState(initialFormData.description);
    const [editFormType, setEditFormType] = useState(initialFormData.type);
    const [editFormIsAllDay, setEditFormIsAllDay] = useState(initialFormData.isAllDay);
    const [editFormLocation, setEditFormLocation] = useState(initialFormData.location);
    const [editFormMeetingUrl, setEditFormMeetingUrl] = useState(initialFormData.meetingUrl);
    const [editFormLeadId, setEditFormLeadId] = useState(initialFormData.leadId);
    const [editFormParticipants, setEditFormParticipants] = useState(initialFormData.participants);
    const [editFormExternalParticipants, setEditFormExternalParticipants] = useState(initialFormData.externalParticipants);
    const [editFormReminderMinutes, setEditFormReminderMinutes] = useState(initialFormData.reminderMinutes);
    const [editFormIsRecurring, setEditFormIsRecurring] = useState(initialFormData.isRecurring);
    const [editFormRecurringRule, setEditFormRecurringRule] = useState(initialFormData.recurringRule);
    const [editFormStartDate, setEditFormStartDate] = useState(initialFormData.startDate);
    const [editFormStartTime, setEditFormStartTime] = useState(initialFormData.startTime);
    const [editFormEndDate, setEditFormEndDate] = useState(initialFormData.endDate);
    const [editFormEndTime, setEditFormEndTime] = useState(initialFormData.endTime);

    // Используем useRef для отслеживания предыдущего ID события
    const prevEventIdRef = useRef<string | null>(null);
    
    // Обновляем форму только при изменении ID события (открытие нового события для редактирования)
    // Это предотвращает моргание формы при обновлении allEvents
    useEffect(() => {
      // Обновляем форму только если изменился ID события
      if (eventToEdit._id !== prevEventIdRef.current) {
        prevEventIdRef.current = eventToEdit._id;
        setEditFormTitle(initialFormData.title);
        setEditFormDescription(initialFormData.description);
        setEditFormType(initialFormData.type);
        setEditFormIsAllDay(initialFormData.isAllDay);
        setEditFormLocation(initialFormData.location);
        setEditFormMeetingUrl(initialFormData.meetingUrl);
        setEditFormLeadId(initialFormData.leadId);
        setEditFormParticipants(initialFormData.participants);
        setEditFormExternalParticipants(initialFormData.externalParticipants);
        setEditFormReminderMinutes(initialFormData.reminderMinutes);
        setEditFormIsRecurring(initialFormData.isRecurring);
        setEditFormRecurringRule(initialFormData.recurringRule);
        setEditFormStartDate(initialFormData.startDate);
        setEditFormStartTime(initialFormData.startTime);
        setEditFormEndDate(initialFormData.endDate);
        setEditFormEndTime(initialFormData.endTime);
      }
    }, [eventToEdit._id, initialFormData]); // Обновляем только при изменении ID события

    const [isUpdating, setIsUpdating] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [externalEmailInput, setExternalEmailInput] = useState('');

    const reminderOptions = [
      { label: t('calendarViewModal.in24Hours'), value: 1440 },
      { label: t('calendarViewModal.in6Hours'), value: 360 },
      { label: t('calendarViewModal.in1Hour'), value: 60 },
      { label: t('calendarViewModal.in30Minutes'), value: 30 },
      { label: t('calendarViewModal.in15Minutes'), value: 15 },
    ];

    const handleToggleReminder = (minutes: number) => {
      setEditFormReminderMinutes(prev =>
        prev.includes(minutes)
          ? prev.filter(m => m !== minutes)
          : [...prev, minutes]
      );
    };

    const handleAddExternalEmail = () => {
      if (externalEmailInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(externalEmailInput.trim())) {
        setEditFormExternalParticipants([...editFormExternalParticipants, externalEmailInput.trim()]);
        setExternalEmailInput('');
      }
    };

    const handleRemoveExternalEmail = (email: string) => {
      setEditFormExternalParticipants(editFormExternalParticipants.filter(e => e !== email));
    };

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();

      // Валидация дат
      const startDateTime = new Date(`${editFormStartDate}T${editFormStartTime}`);
      let endDateTime = new Date(`${editFormEndDate}T${editFormEndTime}`);

      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        alert('Invalid date format');
        return;
      }

      // Если время начала и окончания совпадают, автоматически добавляем 1 час
      if (endDateTime.getTime() === startDateTime.getTime()) {
        endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // +1 час
        // Обновляем форму
        const newEndTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;
        const newEndDate = `${endDateTime.getFullYear()}-${(endDateTime.getMonth() + 1).toString().padStart(2, '0')}-${endDateTime.getDate().toString().padStart(2, '0')}`;
        setEditFormEndTime(newEndTime);
        setEditFormEndDate(newEndDate);
      }

      if (endDateTime < startDateTime) {
        alert(`Не удалось обновить событие. Время окончания должно быть позже времени начала.\n\nВремя начала: ${startDateTime.toLocaleString('ru-RU')}\nВремя окончания: ${endDateTime.toLocaleString('ru-RU')}`);
        return;
      }

      setIsUpdating(true);
      try {
        const normalizeParticipants = (items: any[]) => items
          .map(p => {
            if (typeof p === 'string') return p;
            if (p?.email) return p.email;
            if (p?.name) return p.name;
            if (p?._id) return p._id;
            return '';
          })
          .filter(Boolean);

        // ВАЖНО: Если тип меняется на TASK и у события нет taskId, не передаем taskId
        // чтобы API автоматически создал задачу (согласно документации: "Если type: 'task' и taskId не указан, автоматически создается задача")
        const wasTaskType = eventToEdit.type === EventType.TASK;
        const isChangingToTask = editFormType === EventType.TASK && !wasTaskType;
        const hasTaskId = eventToEdit.taskId;
        
        const updateData: UpdateCalendarEventDto = {
          title: editFormTitle,
          description: editFormDescription,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          type: editFormType,
          isAllDay: editFormIsAllDay,
          location: editFormLocation || undefined,
          meetingUrl: editFormMeetingUrl || undefined,
          leadId: editFormLeadId || undefined,
          participants: editFormParticipants.length > 0 ? normalizeParticipants(editFormParticipants) : undefined,
          externalParticipants: editFormExternalParticipants.length > 0 ? normalizeParticipants(editFormExternalParticipants) : undefined,
          reminderMinutes: editFormReminderMinutes.length > 0 ? editFormReminderMinutes : undefined,
          isRecurring: editFormIsRecurring || undefined,
          recurringRule: editFormRecurringRule || undefined,
        };
        
        // Обработка taskId в зависимости от изменения типа:
        // 1. Если тип меняется на TASK и у события нет taskId - не передаем taskId (undefined), чтобы API создал задачу
        // 2. Если тип уже был TASK и есть taskId - сохраняем его
        // 3. Если тип меняется с TASK на другой - удаляем связь (передаем null)
        // 4. Для остальных случаев - не передаем taskId (undefined)
        if (isChangingToTask && !hasTaskId) {
          // Тип меняется на TASK и нет taskId - не передаем taskId, чтобы API создал задачу
          // taskId не включается в updateData (undefined)
        } else if (editFormType === EventType.TASK && hasTaskId) {
          // Тип уже TASK и есть taskId - сохраняем существующий taskId
          updateData.taskId = typeof hasTaskId === 'string' ? hasTaskId : hasTaskId._id;
        } else if (editFormType !== EventType.TASK && wasTaskType) {
          // Тип меняется с TASK на другой - удаляем связь
          updateData.taskId = null;
        }
        // Для остальных случаев taskId не передается (undefined)

        await onUpdate(eventToEdit._id, updateData);
      } catch (error: any) {
        console.error('Error updating event:', error);
        alert(error.message || t('calendarViewModal.errorUpdatingEvent'));
      } finally {
        setIsUpdating(false);
      }
    };

    return createPortal(
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[65] p-4 modal-fade-in"
        onClick={onClose}
      >
        <div 
          className="relative flex flex-col bg-white md:pb-0 rounded-t-[25px] md:rounded-[25px] shadow-2xl w-full md:w-[50%] max-h-[calc(100vh-1rem)] md:max-h-[85vh] border border-gray-100 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative flex justify-between items-center px-6 py-5 border-b border-[var(--border)] bg-[var(--secondary)] rounded-t-[8px]">
            <h2 className="text-dream-primary text-lg font-normal">{t('calendarViewModal.editEvent')}</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-all duration-200 ease-in-out"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              className="hidden md:block absolute -right-5 -top-5 bg-black/70 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
              aria-label={t('calendarViewModal.close')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-5 overflow-y-auto pb-10">
            {/* Основная информация */}
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-dream-secondary to-white p-4 rounded-xl border border-dream-primary/20">
                <h3 className="text-dream-primary font-normal mb-4 text-lg">{t('calendarViewModal.basicInfo')}</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-dream-primary font-normal mb-2"> {t('calendarViewModal.titleStr')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editFormTitle}
                      onChange={(e) => setEditFormTitle(e.target.value)}
                      className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                      placeholder={t('calendarViewModal.titlePlaceholder')}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.description')}</label>
                    <textarea
                      value={editFormDescription}
                      onChange={(e) => setEditFormDescription(e.target.value)}
                      className="w-full px-5 py-3 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary resize-none transition-all"
                      rows={3}
                      placeholder={t('calendarViewModal.descriptionPlaceholder')}
                    />
                  </div>

                  <div>
                    <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.eventType')}</label>
                    <select
                      value={editFormType}
                      onChange={(e) => setEditFormType(e.target.value as EventType)}
                      className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                    >
                      <option value={EventType.MEETING}>{t('calendarViewModal.meeting')}</option>
                      <option value={EventType.CALL}>{t('calendarViewModal.call')}</option>
                      <option value={EventType.REMINDER}>{t('calendarViewModal.reminder')}</option>
                      <option value={EventType.TASK}>{t('calendarViewModal.task')}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Дата и время */}
              <div className="bg-gradient-to-r from-blue-50 to-white p-4 rounded-xl border border-blue-200">
                <h3 className="text-dream-primary font-normal mb-4 text-lg">{t('calendarViewModal.dateTime')}</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer p-3 bg-white rounded-xl border-2 border-dream-primary/30 hover:border-dream-primary transition-colors">
                      <input
                        type="checkbox"
                        checked={editFormIsAllDay}
                        onChange={(e) => setEditFormIsAllDay(e.target.checked)}
                        className="w-5 h-5 text-dream-primary border-2 border-dream-primary rounded focus:ring-dream-primary"
                      />
                      <span className="text-dream-primary font-medium">{t('calendarViewModal.allDay')}</span>
                    </label>
                  </div>

                  {!editFormIsAllDay ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.startDate')}</label>
                          <input
                            type="date"
                            value={editFormStartDate}
                            onChange={(e) => setEditFormStartDate(e.target.value)}
                            className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.startTime')}</label>
                          <TimePickerDropdown
                            value={editFormStartTime}
                            onChange={setEditFormStartTime}
                            ariaLabel={t('calendarViewModal.startTime')}
                            placeholder={t('calendarViewModal.selectTime')}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.endDate')}</label>
                          <input
                            type="date"
                            value={editFormEndDate}
                            onChange={(e) => setEditFormEndDate(e.target.value)}
                            className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.endTime')}</label>
                          <TimePickerDropdown
                            value={editFormEndTime}
                            onChange={setEditFormEndTime}
                            ariaLabel={t('calendarViewModal.endTime')}
                            placeholder={t('calendarViewModal.selectTime')}
                            disableBefore={editFormStartTime}
                            showDurationFrom={editFormStartTime}
                            scrollToValue={editFormStartTime}
                            quickAddMinutes={[15, 30, 45]}
                            quickAddBase={editFormStartTime}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.startDate')}</label>
                        <input
                          type="date"
                          value={editFormStartDate}
                          onChange={(e) => setEditFormStartDate(e.target.value)}
                          className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.endDate')}</label>
                        <input
                          type="date"
                          value={editFormEndDate}
                          onChange={(e) => setEditFormEndDate(e.target.value)}
                          className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Место и ссылка */}
              <div className="bg-gradient-to-r from-green-50 to-white p-4 rounded-xl border border-green-200">
                <h3 className="text-dream-primary font-normal mb-4 text-lg">{t('calendarViewModal.locationAndLink')}</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.location')}</label>
                    <input
                      type="text"
                      value={editFormLocation}
                      onChange={(e) => setEditFormLocation(e.target.value)}
                      className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                      placeholder={t('calendarViewModal.locationPlaceholder')}
                    />
                  </div>

                  <div>
                    <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.meetingLink')}</label>
                    <input
                      type="url"
                      value={editFormMeetingUrl}
                      onChange={(e) => setEditFormMeetingUrl(e.target.value)}
                      className="w-full h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                      placeholder="https://meet.google.com/..."
                    />
                  </div>
                </div>
              </div>

              {/* Дополнительные настройки */}
              <div className="bg-gradient-to-r from-purple-50 to-white p-4 rounded-xl border border-purple-200">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between text-dream-primary font-normal text-lg"
                >
                  <span>{t('calendarViewModal.advancedSettings')}</span>
                  <svg 
                    width="24" 
                    height="24" 
                    viewBox="0 0 24 24" 
                    fill="none"
                    className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.externalParticipants')}</label>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="email"
                          value={externalEmailInput}
                          onChange={(e) => setExternalEmailInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddExternalEmail())}
                          className="flex-1 h-12 px-5 border-2 border-dream-primary bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-dream-primary transition-all"
                          placeholder="email@example.com"
                        />
                        <button
                          type="button"
                          onClick={handleAddExternalEmail}
                          className="px-4 h-12 bg-dream-primary text-white rounded-xl hover:opacity-90 transition-opacity font-normal"
                        >{t('calendarViewModal.add')}</button>
                      </div>
                      {editFormExternalParticipants.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editFormExternalParticipants.map((email, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-2 px-3 py-1 bg-dream-secondary text-dream-primary rounded-full text-sm"
                            >
                              {email}
                              <button
                                type="button"
                                onClick={() => handleRemoveExternalEmail(email)}
                                className="hover:text-red-600 transition-colors"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-dream-primary font-normal mb-2">{t('calendarViewModal.reminders')}</label>
                      <div className="grid grid-cols-2 gap-2">
                        {reminderOptions.map((option) => (
                          <label
                            key={option.value}
                            className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                              editFormReminderMinutes.includes(option.value)
                                ? 'border-dream-primary bg-dream-secondary'
                                : 'border-gray-300 bg-white hover:border-dream-primary/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={editFormReminderMinutes.includes(option.value)}
                              onChange={() => handleToggleReminder(option.value)}
                              className="w-4 h-4 text-dream-primary border-2 border-dream-primary rounded focus:ring-dream-primary"
                            />
                            <span className="text-sm font-medium">{t(`calendarViewModal.timeRange.${option.label}` as any)}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Связанная задача */}
            {eventToEdit.type === EventType.TASK && eventToEdit.taskId && (
              <div className="p-4 bg-gradient-to-br from-yellow-50 to-white rounded-xl border border-yellow-100">
                <div className="text-xs font-normal text-dream-primary mb-2 uppercase tracking-wide flex items-center justify-between">
                  <span>{t('calendarViewModal.relatedTask')}</span>
                  {onOpenTask && (
                    <button
                      type="button"
                      onClick={() => {
                        const rawTaskId = typeof eventToEdit.taskId === 'string'
                          ? eventToEdit.taskId
                          : eventToEdit.taskId?._id;
                        const normalizedId = normalizeTaskId(rawTaskId);
                        if (normalizedId) {
                          onOpenTask(normalizedId);
                        } else {
                          alert(t('calendarViewModal.couldNotDetermineTaskId'));
                        }
                      }}
                      className="text-xs text-dream-primary hover:text-dream-primary/80 font-medium px-3 py-1.5 bg-white border border-yellow-200 rounded-lg hover:bg-yellow-50 transition-colors duration-200"
                    >
                      {t('crm.crm.calendarViewModal.открыть_задачу')}</button>
                  )}
                </div>
                <div className="text-gray-700 text-sm">
                  {typeof eventToEdit.taskId === 'object' && eventToEdit.taskId?.title ? (
                    <div className="font-normal mb-1 break-words">{eventToEdit.taskId.title}</div>
                  ) : (
                    <div className="text-sm">ID: {typeof eventToEdit.taskId === 'string' ? eventToEdit.taskId : ''}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    {t('crm.crm.calendarViewModal.сохраните_событие_чт')}</div>
                </div>
              </div>
            )}

            {/* Кнопки действий */}
            <div className="flex gap-3 pt-4 border-t-2 border-dream-primary/20">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-6 py-3 border-2 border-dream-primary rounded-xl hover:bg-dream-secondary transition-all duration-200 ease-in-out text-dream-primary font-normal hover:scale-105 active:scale-95"
              >{t('calendarViewModal.cancel')}</button>
              <button
                type="submit"
                disabled={isUpdating}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-dream-primary to-green-600 text-white rounded-xl hover:opacity-90 transition-all duration-200 ease-in-out font-normal shadow-lg hover:scale-105 active:scale-95 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdating ? t('calendarViewModal.saving'): t('calendarViewModal.saveChanges')}
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body
    );
  }, (prevProps, nextProps) => {
    // Кастомное сравнение: ререндерим только если событие действительно изменилось
    return compareCalendarEvents(prevProps.event, nextProps.event) &&
           prevProps.onClose === nextProps.onClose &&
           prevProps.onUpdate === nextProps.onUpdate &&
           prevProps.onOpenTask === nextProps.onOpenTask;
  });
  
  EditEventModalContent.displayName = 'EditEventModalContent';
  
  // Мемоизируем рендеринг модального окна редактирования
  // Используем ref для хранения предыдущего события, чтобы не пересоздавать при идентичных данных
  const prevEditEventRef = useRef<CalendarEvent | null>(null);
  const prevEditEventContentRef = useRef<React.ReactNode>(null);
  const editEventModalContent = useMemo(() => {
    if (!isEditingEvent || !stableEventToEdit) {
      prevEditEventRef.current = null;
      prevEditEventContentRef.current = null;
      return null;
    }
    
    // Если событие идентично предыдущему, возвращаем старое содержимое
    if (prevEditEventRef.current && 
        compareCalendarEvents(prevEditEventRef.current, stableEventToEdit) &&
        prevEditEventContentRef.current) {
      return prevEditEventContentRef.current; // Данные не изменились - возвращаем старое содержимое
    }
    
    // Данные изменились - создаем новое содержимое
    const newContent = (
      <EditEventModalContent
        event={stableEventToEdit}
        onClose={handleCloseEditModal}
        onUpdate={handleUpdateEvent}
        onOpenTask={handleOpenTaskFromEvent}
      />
    );
    prevEditEventRef.current = stableEventToEdit;
    prevEditEventContentRef.current = newContent;
    return newContent;
  }, [isEditingEvent, stableEventToEdit, handleCloseEditModal, handleUpdateEvent, handleOpenTaskFromEvent]);

  // Модальное окно подтверждения удаления - выносим в отдельный компонент с пропсами
  const DeleteConfirmModalContent = React.memo<{
    event: CalendarEvent;
    onClose: () => void;
    onConfirm: (event: CalendarEvent) => void;
    isDeleting: boolean;
  }>(({ event, onClose, onConfirm, isDeleting }) => {
    const eventToDelete = event;

    const isTaskEvent = eventToDelete.type === EventType.TASK;
    const isTaskFromUnifiedView = eventToDelete._id.startsWith('task_');
    
    // Согласно документации:
    // - Если ID начинается с task_ (unified view), удаляется задача
    // - Если событие типа TASK было создано из календаря (без изначальной связи с задачей), 
    //   при удалении события автоматически удаляется и связанная задача
    // - Если событие было создано из задачи (есть calendarEventId в задаче), 
    //   при удалении события только удаляется связь, задача остается
    const hasTaskId = isTaskEvent && eventToDelete.taskId;
    const deleteMessage = isTaskFromUnifiedView
      ? t('calendarViewModal.whenYouDeleteThisTaskItWillBeC'): isTaskEvent && hasTaskId
      ? t('calendarViewModal.whenThisEventIsDeletedTheConne'): isTaskEvent
      ? t('calendarViewModal.deletingThisEventWillAlsoDelet'): t('calendarViewModal.areYouSureYouWantToDeleteThisE');

    return createPortal(
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-300"
        onClick={handleCloseDeleteConfirm}
      >
        <div 
          className="bg-white rounded-[25px] shadow-2xl p-8 w-full max-w-md animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-red-600 text-xl font-normal">{t('calendarViewModal.deleteEvent1')}</h2>
            <button
              onClick={handleCloseDeleteConfirm}
              className="text-gray-500 hover:text-gray-700 transition-all duration-200 ease-in-out hover:scale-110 active:scale-95"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="mb-6">
            <div className="p-4 bg-red-50 rounded-xl border border-red-200 mb-4">
              <div className="font-normal text-gray-900 mb-2">{eventToDelete.title}</div>
              <div className="text-sm text-gray-600">
                {formatTime(eventToDelete.startTime)} - {formatTime(eventToDelete.endTime)}
              </div>
            </div>
            <p className="text-gray-700 leading-relaxed">{deleteMessage}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-full hover:bg-gray-50 transition-all duration-200 ease-in-out text-gray-700 font-normal hover:scale-105 active:scale-95"
              disabled={isDeleting}
            >{t('calendarViewModal.cancel')}</button>
            <button
              onClick={() => onConfirm(eventToDelete)}
              disabled={isDeleting}
              className="flex-1 px-6 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all duration-200 ease-in-out font-normal disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 disabled:hover:scale-100"
            >
              {isDeleting ? t('calendarViewModal.delete'): t('calendarViewModal.delete1')}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }, (prevProps, nextProps) => {
    // Кастомное сравнение: ререндерим только если событие действительно изменилось
    return compareCalendarEvents(prevProps.event, nextProps.event) &&
           prevProps.onClose === nextProps.onClose &&
           prevProps.onConfirm === nextProps.onConfirm &&
           prevProps.isDeleting === nextProps.isDeleting;
  });
  
  DeleteConfirmModalContent.displayName = 'DeleteConfirmModalContent';
  
  // Мемоизируем рендеринг модального окна удаления
  // Используем ref для хранения предыдущего события и состояния, чтобы не пересоздавать при идентичных данных
  const prevDeleteConfirmEventRef = useRef<CalendarEvent | null>(null);
  const prevDeleteConfirmIsDeletingRef = useRef<boolean>(false);
  const prevDeleteConfirmContentRef = useRef<React.ReactNode>(null);
  const deleteConfirmModalContent = useMemo(() => {
    if (!showDeleteConfirm || !eventToDelete) {
      prevDeleteConfirmEventRef.current = null;
      prevDeleteConfirmIsDeletingRef.current = false;
      prevDeleteConfirmContentRef.current = null;
      return null;
    }
    
    // Если событие и состояние идентичны предыдущему, возвращаем старое содержимое
    if (prevDeleteConfirmEventRef.current && 
        compareCalendarEvents(prevDeleteConfirmEventRef.current, eventToDelete) &&
        prevDeleteConfirmIsDeletingRef.current === isDeletingEvent &&
        prevDeleteConfirmContentRef.current) {
      return prevDeleteConfirmContentRef.current; // Данные не изменились - возвращаем старое содержимое
    }
    
    // Данные изменились - создаем новое содержимое
    const newContent = (
      <DeleteConfirmModalContent
        event={eventToDelete}
        onClose={handleCloseDeleteConfirm}
        onConfirm={handleDeleteEvent}
        isDeleting={isDeletingEvent}
      />
    );
    prevDeleteConfirmEventRef.current = eventToDelete;
    prevDeleteConfirmIsDeletingRef.current = isDeletingEvent;
    prevDeleteConfirmContentRef.current = newContent;
    return newContent;
  }, [showDeleteConfirm, eventToDelete, handleCloseDeleteConfirm, handleDeleteEvent, isDeletingEvent]);

  // Обработчик обновления задачи из TaskViewModal
  const handleTaskUpdate = useCallback((updatedTask: Task) => {
    // Обновляем задачу в tasksDataMap
    setTasksDataMap(prev => {
      const newMap = new Map(prev);
      const taskId = updatedTask._id;
      const normalizedTaskId = normalizeTaskId(taskId);
      
      // Определяем workType из категорий задачи (проверяем разные варианты)
      let workType: 'work' | 'personal' | undefined = undefined;
      if (updatedTask.categories && Array.isArray(updatedTask.categories)) {
        const hasWork = updatedTask.categories.some(cat => cat.includes(t('calendarViewModal.workTasks')));
        const hasPersonal = updatedTask.categories.some(cat => cat.includes(t('calendarViewModal.personalTasks')));
        
        if (hasWork) {
          workType = 'work';
        } else if (hasPersonal) {
          workType = 'personal';
        }
      }
      
      const taskData = {
        priority: updatedTask.priority,
        colorLabel: updatedTask.colorLabel,
        category: updatedTask.category,
        workType: workType,
        hasFiles: updatedTask.hasFiles || (updatedTask.files && updatedTask.files.length > 0) || false,
      };
      
      // Сохраняем с разными вариантами ID для совместимости
      newMap.set(normalizedTaskId, taskData);
      if (!normalizedTaskId.startsWith('task_')) {
        newMap.set(`task_${normalizedTaskId}`, taskData);
      }
      if (taskId !== normalizedTaskId) {
        newMap.set(taskId, taskData);
      }
      
      return newMap;
    });
    
    // Обновляем событие в allEvents
    setAllEvents(prevEvents => {
      return prevEvents.map(event => {
        // Нормализуем ID для сравнения (учитываем префикс task_)
        const eventTaskId = typeof event.taskId === 'string' 
          ? event.taskId 
          : (event.taskId as any)?._id;
        
        const normalizedEventTaskId = eventTaskId?.startsWith('task_') 
          ? eventTaskId.replace('task_', '') 
          : eventTaskId;
        
        const normalizedUpdatedTaskId = updatedTask._id.startsWith('task_') 
          ? updatedTask._id.replace('task_', '') 
          : updatedTask._id;
        
        if (normalizedEventTaskId === normalizedUpdatedTaskId) {
          // Обновляем событие с новыми данными задачи
          return {
            ...event,
            title: updatedTask.title,
            description: updatedTask.description,
            startTime: updatedTask.startDate || event.startTime,
            endTime: updatedTask.endDate || event.endTime,
            color: updatedTask.colorLabel,
          };
        }
        return event;
      });
    });
    
    // Обновляем выбранную задачу, если она открыта
    setSelectedTaskForView(updatedTask);
    
    // Перезагружаем события с сервера для синхронизации
    setTimeout(() => {
      loadEvents();
    }, 100);
  }, [loadEvents]);

  // Обработчик удаления задачи из TaskViewModal
  const handleTaskDelete = useCallback(async (taskId: string) => {
    try {
      // Нормализуем ID (убираем префикс task_ если есть)
      const normalizedTaskId = taskId.startsWith('task_') ? taskId.replace('task_', '') : taskId;
      
      // Удаляем событие из локального состояния (оптимистичное удаление)
      setAllEvents(prevEvents => 
        prevEvents.filter(event => {
          const eventTaskId = typeof event.taskId === 'string' 
            ? event.taskId 
            : (event.taskId as any)?._id;
          
          const normalizedEventTaskId = eventTaskId?.startsWith('task_') 
            ? eventTaskId.replace('task_', '') 
            : eventTaskId;
          
          return normalizedEventTaskId !== normalizedTaskId && event._id !== taskId && event._id !== `task_${normalizedTaskId}`;
        })
      );
      
      // Удаляем из tasksDataMap
      setTasksDataMap(prev => {
        const newMap = new Map(prev);
        newMap.delete(normalizedTaskId);
        newMap.delete(taskId);
        newMap.delete(`task_${normalizedTaskId}`);
        return newMap;
      });
      
      // Закрываем модальное окно
      setIsTaskViewModalOpen(false);
      setSelectedTaskForView(null);
      
      // Перезагружаем события с сервера для синхронизации
      setTimeout(() => {
        loadEvents();
      }, 100);
    } catch (error) {
      console.error('Error deleting task:', error);
      alert(t('calendarViewModal.errorWhenDeletingATask'));
    }
  }, [loadEvents]);

  // Обработчик изменения статуса задачи из TaskViewModal
  const handleTaskStatusUpdate = useCallback(async (taskId: string, status: TaskStatus) => {
    try {
      // Нормализуем ID (убираем префикс task_ если есть)
      const normalizedTaskId = taskId.startsWith('task_') ? taskId.replace('task_', '') : taskId;
      
      // Обновляем статус задачи на сервере
      const response = await crmTaskService.updateTask(normalizedTaskId, { status });
      
      if (response.success && response.data) {
        // Обновляем событие в локальном состоянии
        setAllEvents(prevEvents => 
          prevEvents.map(event => {
            const eventTaskId = typeof event.taskId === 'string' 
              ? event.taskId 
              : (event.taskId as any)?._id;
            
            const normalizedEventTaskId = eventTaskId?.startsWith('task_') 
              ? eventTaskId.replace('task_', '') 
              : eventTaskId;
            
            if (normalizedEventTaskId === normalizedTaskId || event._id === taskId || event._id === `task_${normalizedTaskId}`) {
              return {
                ...event,
                status: status === TaskStatus.COMPLETED ? EventStatus.COMPLETED : EventStatus.SCHEDULED,
              };
            }
            return event;
          })
        );
        
        // Обновляем выбранную задачу, если она открыта
        if (selectedTaskForView && selectedTaskForView._id === normalizedTaskId) {
          setSelectedTaskForView({
            ...selectedTaskForView,
            status,
          });
        }
        
        // Перезагружаем события с сервера для синхронизации
        setTimeout(() => {
          loadEvents();
        }, 100);
      } else {
        alert(response.message || t('calendarViewModal.errorUpdatingTaskStatus'));
      }
    } catch (error) {
      console.error('Error updating task status:', error);
      alert(t('calendarViewModal.errorUpdatingTaskStatus'));
    }
  }, [loadEvents, selectedTaskForView]);

  return (
    <>
      {createPortal(modalContent, document.body)}
      {/* УМНОЕ СРАВНЕНИЕ: Рендерим модальные окна только при изменении ID события */}
      {eventDetailsModalContent}
      {editEventModalContent}
      {deleteConfirmModalContent}
      {selectedTaskForView && (
        <TaskViewModal
          task={selectedTaskForView || undefined}
          isOpen={isTaskViewModalOpen}
          onClose={handleCloseTaskView}
          onTaskUpdate={handleTaskUpdate}
          onDeleteTask={handleTaskDelete}
          onUpdateTaskStatus={handleTaskStatusUpdate}
        />
      )}
    </>
  );
};

export default CalendarViewModal;

