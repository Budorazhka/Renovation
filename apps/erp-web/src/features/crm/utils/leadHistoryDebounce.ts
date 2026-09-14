/**
 * Ручные записи истории лида («имя изменено…») писались в
 * POST /crm/leads/:id/history легаси-бэкенда api-crm.baza.sale, которого у
 * платформы нет. У платформы история лида — это события смены стадии
 * (GET /leads/:id/events), а правки полей фиксирует серверный аудит, поэтому
 * клиент их больше не отправляет. Интерфейс оставлен, чтобы не трогать вызовы.
 */

export const addLeadHistoryEntryDebounced: (leadId: string, data: { message: string; comment?: string }) => void = () => {};

export const flushLeadHistory: (leadId: string) => Promise<void> = async () => {};

export const cancelLeadHistoryEntry: (leadId: string) => void = () => {};
