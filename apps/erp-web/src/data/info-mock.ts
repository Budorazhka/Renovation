export interface Reminder {
  id: string
  title: string
  body?: string
  dueAt: string
  done: boolean
  priority: 'low' | 'medium' | 'high'
  entityType?: 'deal' | 'client' | 'task' | 'booking'
  entityLabel?: string
}

export const REMINDERS_MOCK: Reminder[] = [
  {
    id: 'rem-1',
    title: 'Перезвонить Иванову по сделке',
    body: 'Клиент ждёт ответ по задатку — уточнить готовность документов',
    dueAt: '2026-03-22T11:00',
    done: false,
    priority: 'high',
    entityType: 'deal',
    entityLabel: 'Иванов А. · Мясницкая 22',
  },
  {
    id: 'rem-2',
    title: 'Истекает бронь по квартире №47',
    body: 'ЖК Солнечный берег, кв. 47 — срок брони заканчивается через 6 часов',
    dueAt: '2026-03-22T18:00',
    done: false,
    priority: 'high',
    entityType: 'booking',
    entityLabel: 'ЖК Солнечный берег · кв. 47',
  },
  {
    id: 'rem-3',
    title: 'Отправить КП клиенту Петровой',
    dueAt: '2026-03-22T14:00',
    done: false,
    priority: 'medium',
    entityType: 'client',
    entityLabel: 'Петрова М.И.',
  },
  {
    id: 'rem-4',
    title: 'Подготовить отчёт по сделкам за март',
    dueAt: '2026-03-31T18:00',
    done: false,
    priority: 'medium',
  },
  {
    id: 'rem-5',
    title: 'Встреча с партнёром — агентство НовоСтрой',
    body: 'Обсудить совместные показы на первичке в апреле',
    dueAt: '2026-03-25T10:00',
    done: false,
    priority: 'low',
  },
  {
    id: 'rem-6',
    title: 'Пройти тест по LMS — Скрипты продаж',
    dueAt: '2026-03-28T23:59',
    done: true,
    priority: 'low',
  },
]
