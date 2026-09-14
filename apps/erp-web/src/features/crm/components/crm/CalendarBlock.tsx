import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import CalendarViewModal from './CalendarViewModal';
import Calendar, { type CalendarRef } from './Calendar';
import { useAuth } from '../../hooks/useAuth';
import { type CalendarEvent } from '../../services/api';
import { loadCrmCalendarEvents, monthRange } from '@/lib/calendar-v2-crm-adapter';
import { compareArrays } from '../../utils/dataComparison';
import { useCalendarRealtimeSync } from '../../hooks/useCalendarRealtimeSync';

interface CalendarBlockProps {
  onModalOpen?: () => void;
}

const CalendarBlock = ({ onModalOpen }: CalendarBlockProps = {}) => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(() => {
    return searchParams.get('modal') === 'calendar';
  });
  const [isMobile, setIsMobile] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const calendarRef = useRef<CalendarRef>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDateForEvent, setSelectedDateForEvent] = useState<Date | null>(null);
  const [_shouldOpenCreateModal, setShouldOpenCreateModal] = useState(false); // Зарезервировано для будущего использования

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Восстановление состояния из URL
  useEffect(() => {
    const modalParam = searchParams.get('modal');
    if (modalParam === 'calendar' && !isCalendarModalOpen) {
      setIsCalendarModalOpen(true);
    } else if (modalParam !== 'calendar' && isCalendarModalOpen) {
      setIsCalendarModalOpen(false);
    }
  }, [searchParams]);


  // События и задачи месяца — с календаря платформы (GET /api/v1/calendar/unified).
  const loadEvents = useCallback(async (): Promise<CalendarEvent[]> => {
    if (!user?.id) return [];
    const { start, end } = monthRange(currentDate);
    try {
      return await loadCrmCalendarEvents(start, end);
    } catch (err) {
      console.error('Error loading calendar events:', err);
      return [];
    }
  }, [currentDate, user?.id]);

  // Реалтайм синхронизация календаря
  useCalendarRealtimeSync({
    userId: user?.id,
    userRole: user?.role,
    currentDate,
    onEventsUpdated: (newEvents) => {
      setEvents(prevEvents => {
        // Обновляем только если данные изменились
        if (compareArrays(prevEvents, newEvents, '_id', ['title', 'startTime', 'endTime', 'type', 'status'])) {
          return prevEvents; // Возвращаем старое для предотвращения ререндера
        }
        return newEvents;
      });
    },
    fallbackInterval: 5000,
  });

  // Загружаем события при открытии компонента и изменении месяца
  useEffect(() => {
    if (user?.id) {
      loadEvents().then(newEvents => {
        setEvents(prevEvents => {
          // Обновляем только если данные изменились
          if (compareArrays(prevEvents, newEvents, '_id', ['title', 'startTime', 'endTime', 'type', 'status'])) {
            return prevEvents; // Возвращаем старое для предотвращения ререндера
          }
          return newEvents;
        });
      });
    }
  }, [user?.id, currentDate, loadEvents]);

  const handleHeaderClick = (e: React.MouseEvent) => {
    if (isMobile) {
      e.stopPropagation();
      setIsCollapsed(!isCollapsed);
    }
  };

  return (
    <div className="rounded-lg overflow-hidden bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)]">
      {}
      
      <div 
        className="bg-dream-secondary block cursor-pointer"
        onClick={() => {
          if (!isMobile) {
            onModalOpen?.();
            setIsCalendarModalOpen(true);
            const newParams = new URLSearchParams(searchParams);
            newParams.set('modal', 'calendar');
            setSearchParams(newParams, { replace: true });
          }
        }}
      >
        <Calendar
          ref={calendarRef}
          initialDate={currentDate}
          showHeader={isMobile}
          headerClassName={isMobile ? "bg-[var(--secondary)] p-4 cursor-pointer rounded-t-lg text-[rgba(255,255,255,0.92)]" : ""}
          onHeaderClick={isMobile ? handleHeaderClick : undefined}
          isCollapsed={isMobile ? isCollapsed : false}
          bodyClassName={isMobile && isCollapsed ? "hidden" : "p-4 pb-6"}
          onDateChange={setCurrentDate}
          onDayClick={(_day, _date) => {
            if (!isMobile) {
              // Просто открываем календарь без создания события
              onModalOpen?.();
              setIsCalendarModalOpen(true);
              const newParams = new URLSearchParams(searchParams);
              newParams.set('modal', 'calendar');
              setSearchParams(newParams, { replace: true });
            }
          }}
          events={events}
        />
      </div>
      {isCalendarModalOpen && (
        <CalendarViewModal
          isOpen={isCalendarModalOpen}
          onClose={() => {
            setIsCalendarModalOpen(false);
            setSelectedDateForEvent(null);
            setShouldOpenCreateModal(false);
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('modal');
            setSearchParams(newParams, { replace: true });
          }}
          initialDate={selectedDateForEvent || undefined}
        />
      )}
    </div>
  );
};

export default CalendarBlock;
