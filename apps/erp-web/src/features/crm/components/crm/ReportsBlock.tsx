import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { CRM_ANALYTICS_BASE } from '@/features/crm/crmAnalyticsPaths';
import { TaskStatus } from '../../services/api';
import type { Task } from '../../services/api';
import CircularProgress from './CircularProgress';

interface ReportsBlockProps {
  tasks: Task[];
  onModalOpen?: () => void;
}

/**
 * Карточка «Отчёты» в боковой панели классической CRM: прогресс задач или
 * часы и переход в «Аналитику» (отчёты сервера, /dashboard/crm/analytics).
 * Модалка MLM-отчётов легаси-продукта (рефералы, объекты сети, рейтинг —
 * запросы к api-crm.baza.sale) удалена 15.09.2026: у платформы таких
 * данных нет, открывалась она только по ссылке ?modal=reports.
 */
const ReportsBlock = ({ tasks, onModalOpen }: ReportsBlockProps) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [isReportsBlockCollapsed, setIsReportsBlockCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [showClock, setShowClock] = useState(false);
  const [clockType, setClockType] = useState<'text' | 'circular'>('text');
  const [currentTime, setCurrentTime] = useState(new Date());

  const completedTasksCount = tasks.filter((task) => task.status === TaskStatus.COMPLETED).length;
  const totalTasksCount = tasks.length;
  const completionPercentage = totalTasksCount > 0 ? (completedTasksCount / totalTasksCount) * 100 : 0;

  // Обновление времени каждую секунду, пока показаны часы
  useEffect(() => {
    if (!showClock) return;
    const timeInterval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timeInterval);
  }, [showClock]);

  return (
    <div className="flex flex-col items-center rounded-lg bg-[var(--card)] px-4 py-5 md:px-4 md:pt-6 md:pb-8 gap-y-2 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)]" style={{ marginTop: '17px' }}>
      <button
        type="button"
        onClick={() => setIsReportsBlockCollapsed(!isReportsBlockCollapsed)}
        className="w-full md:hidden flex items-center justify-between cursor-pointer text-[rgba(255,255,255,0.92)]"
      >
        <div className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent)] shrink-0">
            <path d="M2.75 2C2.75 1.58579 2.41421 1.25 2 1.25C1.58579 1.25 1.25 1.58579 1.25 2V12.0574C1.24999 14.3658 1.24998 16.1748 1.43975 17.5863C1.63399 19.031 2.03933 20.1711 2.93414 21.0659C3.82895 21.9607 4.96897 22.366 6.41371 22.5603C7.82519 22.75 9.63423 22.75 11.9426 22.75H22C22.4142 22.75 22.75 22.4142 22.75 22C22.75 21.5858 22.4142 21.25 22 21.25H12C9.62178 21.25 7.91356 21.2484 6.61358 21.0736C5.33517 20.9018 4.56445 20.5749 3.9948 20.0052C3.42514 19.4355 3.09825 18.6648 2.92637 17.3864C2.75159 16.0864 2.75 14.3782 2.75 12V2Z" fill="currentColor"/>
            <path d="M19.5875 7.46641C19.8451 7.14204 19.791 6.67026 19.4666 6.41267C19.1422 6.15508 18.6704 6.20921 18.4128 6.53359L15.2948 10.46C15.0496 10.7688 14.8887 10.9708 14.7561 11.1162C14.6265 11.2585 14.5657 11.2989 14.538 11.3137C14.3272 11.4264 14.0754 11.4319 13.8599 11.3285C13.8316 11.3149 13.7691 11.2772 13.6333 11.1407C13.4946 11.0011 13.3251 10.8063 13.0666 10.5085L13.0505 10.4899C12.8126 10.2157 12.6098 9.98188 12.4308 9.80184C12.2448 9.6147 12.0414 9.4401 11.7894 9.31918C11.143 9.00898 10.3875 9.02541 9.75518 9.36342C9.50872 9.49518 9.31307 9.67845 9.13536 9.87351C8.96441 10.0612 8.77192 10.3036 8.54619 10.5878L5.41267 14.5336C5.15508 14.8579 5.20921 15.3297 5.53358 15.5873C5.85795 15.8449 6.32973 15.7908 6.58733 15.4664L9.70551 11.54C9.95077 11.2311 10.1116 11.0292 10.2442 10.8837C10.3738 10.7414 10.4347 10.7011 10.4623 10.6863C10.6731 10.5736 10.925 10.5681 11.1404 10.6715C11.1687 10.6851 11.2313 10.7228 11.367 10.8593C11.5057 10.9989 11.6752 11.1936 11.9337 11.4915L11.9498 11.5101C12.1877 11.7843 12.3906 12.0181 12.5695 12.1981C12.7555 12.3853 12.9589 12.5599 13.2109 12.6808C13.8573 12.991 14.6129 12.9746 15.2452 12.6365C15.4916 12.5048 15.6873 12.3215 15.865 12.1264C16.0359 11.9388 16.2284 11.6964 16.4541 11.4122L19.5875 7.46641Z" fill="currentColor"/>
          </svg>
          <span className="text-base">{t('reportsBlock.reportsTitle')}</span>
        </div>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`transition-transform duration-200 text-[var(--accent)] shrink-0 ${isReportsBlockCollapsed ? 'rotate-180' : ''}`}
        >
          <path d="M12.0007 10.8273L7.05072 15.7773L5.63672 14.3633L12.0007 7.99935L18.3647 14.3633L16.9507 15.7773L12.0007 10.8273Z" fill="currentColor"/>
        </svg>
      </button>
      <div className={`${isReportsBlockCollapsed ? 'hidden md:block' : 'block'}`}>
        <div className="flex items-center justify-center gap-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Циклическое переключение: если показываются круглые часы -> текстовое время, если текстовое время -> прогресс задач, если прогресс задач -> круглые часы
              if (showClock) {
                if (clockType === 'circular') {
                  setClockType('text');
                } else {
                  setShowClock(false);
                }
              } else {
                setShowClock(true);
                setClockType('circular');
              }
            }}
            className="cursor-pointer p-1 rounded-md hover:bg-[var(--secondary)] transition-colors"
            aria-label={t('reportsBlock.previous')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent)]">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="flex flex-col items-center justify-center" style={{ width: '140px', height: '198px', minHeight: '198px', maxHeight: '198px' }}>
            {showClock ? (
              clockType === 'circular' ? (
                /* Круглые часы */
                <div className="flex items-center justify-center w-full h-full">
                  <div className="relative" style={{ width: '140px', height: '140px' }}>
                    <svg width="140" height="140" viewBox="0 0 140 140" className="absolute inset-0">
                      {/* Циферблат */}
                      <circle cx="70" cy="70" r="65" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2"/>
                      {/* Метки часов */}
                      {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((hour) => {
                        const angle = (hour * 30 - 90) * (Math.PI / 180);
                        const x1 = 70 + 55 * Math.cos(angle);
                        const y1 = 70 + 55 * Math.sin(angle);
                        const x2 = 70 + 60 * Math.cos(angle);
                        const y2 = 70 + 60 * Math.sin(angle);
                        return (
                          <line
                            key={hour}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke="rgba(255,255,255,0.5)"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {/* Минутные метки */}
                      {Array.from({ length: 60 }, (_, i) => {
                        if (i % 5 === 0) return null; // Пропускаем часовые метки
                        const angle = (i * 6 - 90) * (Math.PI / 180);
                        const x1 = 70 + 57 * Math.cos(angle);
                        const y1 = 70 + 57 * Math.sin(angle);
                        const x2 = 70 + 60 * Math.cos(angle);
                        const y2 = 70 + 60 * Math.sin(angle);
                        return (
                          <line
                            key={i}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke="rgba(255,255,255,0.28)"
                            strokeWidth="1"
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {/* Центр часов */}
                      <circle cx="70" cy="70" r="4" fill="var(--accent)"/>
                      {/* Часовая стрелка */}
                      {(() => {
                        const hours = currentTime.getHours() % 12;
                        const minutes = currentTime.getMinutes();
                        const hourAngle = (hours * 30 + minutes * 0.5 - 90) * (Math.PI / 180);
                        const hourLength = 25;
                        const x2 = 70 + hourLength * Math.cos(hourAngle);
                        const y2 = 70 + hourLength * Math.sin(hourAngle);
                        return (
                          <line
                            x1="70"
                            y1="70"
                            x2={x2}
                            y2={y2}
                            stroke="rgba(255,255,255,0.92)"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        );
                      })()}
                      {/* Минутная стрелка */}
                      {(() => {
                        const minutes = currentTime.getMinutes();
                        const seconds = currentTime.getSeconds();
                        const minuteAngle = (minutes * 6 + seconds * 0.1 - 90) * (Math.PI / 180);
                        const minuteLength = 40;
                        const x2 = 70 + minuteLength * Math.cos(minuteAngle);
                        const y2 = 70 + minuteLength * Math.sin(minuteAngle);
                        return (
                          <line
                            x1="70"
                            y1="70"
                            x2={x2}
                            y2={y2}
                            stroke="rgba(255,255,255,0.85)"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        );
                      })()}
                      {/* Секундная стрелка */}
                      {(() => {
                        const seconds = currentTime.getSeconds();
                        const secondAngle = (seconds * 6 - 90) * (Math.PI / 180);
                        const secondLength = 45;
                        const x2 = 70 + secondLength * Math.cos(secondAngle);
                        const y2 = 70 + secondLength * Math.sin(secondAngle);
                        return (
                          <line
                            x1="70"
                            y1="70"
                            x2={x2}
                            y2={y2}
                            stroke="#ffb4ab"
                            strokeWidth="1"
                            strokeLinecap="round"
                          />
                        );
                      })()}
                    </svg>
                  </div>
                </div>
              ) : (
                /* Текстовое время */
                <div className="flex items-center justify-center w-full h-full">
                  <span
                    className="text-[rgba(255,255,255,0.92)] tabular-nums tracking-tight"
                    style={{
                      fontSize: '62px',
                      fontWeight: 400,
                      lineHeight: '1',
                    }}
                  >
                    {currentTime.toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })}
                  </span>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center w-full h-full justify-center">
                <CircularProgress
                  percentage={completionPercentage}
                  strokeWidth={25}
                  size={140}
                  startAngle={-80}
                />
                <div className="flex flex-col items-center text-center mt-2">
                  <span className="text-lg font-normal text-[rgba(255,255,255,0.92)]">
                    {completedTasksCount}
                    <span className="text-base text-[rgba(255,255,255,0.72)]">/{totalTasksCount}</span>
                  </span>
                  <span className="text-base text-[rgba(255,255,255,0.72)]">{t('reportsBlock.tasksCompleted')}</span>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Циклическое переключение: прогресс задач -> текстовое время -> круглые часы -> прогресс задач
              if (!showClock) {
                setShowClock(true);
                setClockType('text');
              } else if (clockType === 'text') {
                setClockType('circular');
              } else {
                // Если круглые часы, переходим обратно к прогрессу задач
                setShowClock(false);
              }
            }}
            className="cursor-pointer p-1 rounded-md hover:bg-[var(--secondary)] transition-colors"
            aria-label={t('reportsBlock.next')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent)]">
              <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            onModalOpen?.();
            navigate(CRM_ANALYTICS_BASE);
          }}
          className="flex text-base text-[rgba(255,255,255,0.72)] hover:text-[var(--accent)] items-center justify-center w-full cursor-pointer mt-2 transition-colors"
        >
          <span>{t('reportsBlock.seeAllReports')}</span>
        </button>
      </div>
    </div>
  );
};

export default ReportsBlock;
