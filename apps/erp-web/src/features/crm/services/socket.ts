import type { Socket } from 'socket.io-client';

/**
 * Realtime-канал легаси-CRM отключён. Сокет подключался к api-crm.baza.sale,
 * которого у платформы нет: 6 попыток подключения, ошибки в консоли и
 * 15-секундные таймеры ack без единого полученного события. У apps/api нет
 * WebSocketGateway — обновления идут HTTP-опросом в use*RealtimeSync.
 * Интерфейс модуля сохранён, чтобы не трогать его потребителей.
 */

export type PushEnvelope<T = any> = {
  eventId: string;
  ts: string;
  data: T;
};

export const getSocket = (): Socket | null => null;

export const onPush = <T = any>(_event: string, handler: (env: PushEnvelope<T>) => void) => handler;

export const offPush = (_event: string, _listener: (...args: any[]) => void) => {};

export const fetchReplay = async (_opts?: { sinceTs?: string; lastEventId?: string; rooms?: string[]; onlyMine?: boolean; limit?: number }) =>
  [] as Array<{ event: string; envelope: PushEnvelope<any> }>;

export const subscribeRooms = async (_rooms: string[] | { type: 'task' | 'lead' | 'org'; id: string }[]) =>
  ({ success: false as const, message: 'Realtime отключён' });

export const unsubscribeRooms = async (_rooms: string[] | { type: 'task' | 'lead' | 'org'; id: string }[]) =>
  ({ success: false as const, message: 'Realtime отключён' });
