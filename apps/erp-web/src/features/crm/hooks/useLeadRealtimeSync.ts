import type { Lead } from '../services/api';
import { usePolling } from './usePolling';

export interface LeadRealtimeSyncOptions {
  onLeadCreated?: (lead: Lead) => void;
  onLeadUpdated?: (lead: Lead) => void;
  onLeadDeleted?: (id: string) => void;
  onLeadsReload?: () => void;
  onError?: (error: Error) => void;
  fallbackInterval?: number;
}

/**
 * Push-событий лидов у платформы нет (нет WebSocketGateway), поэтому
 * onLeadCreated/onLeadUpdated/onLeadDeleted не вызываются — синхронизация
 * идёт опросом onLeadsReload.
 */
export const useLeadRealtimeSync = (options: LeadRealtimeSyncOptions) => {
  usePolling(options.onLeadsReload, options.fallbackInterval ?? 5000);
};
