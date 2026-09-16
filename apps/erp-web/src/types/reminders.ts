/**
 * Напоминание в превью рабочего стола. Это НЕ серверная модель: сервер хранит
 * напоминание как событие календаря типа `reminder`
 * (apps/api/src/modules/crm/schemas/calendar-event.schema.ts), а здесь —
 * плоская форма, которую рисует виджет «Напоминания» на втором экране.
 *
 * Полный экран напоминаний (components/info/RemindersPage.tsx) работает прямо
 * с CalendarEventV2 и в этой форме не нуждается.
 */
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
