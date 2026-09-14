import type { Task } from '../services/api';
import { usePolling } from './usePolling';

export interface TaskSyncOptions {
  onTaskCreated?: (task: Task) => void;
  onTaskUpdated?: (task: Task) => void;
  onTaskDeleted?: (id: string) => void;
  onTaskStatsChanged?: (stats: { total: number; completed: number; overdue: number }) => void;
  onTasksReload?: () => void;
  onError?: (error: Error) => void;
  fallbackInterval?: number;
}

/**
 * Push-событий задач у платформы нет (нет WebSocketGateway), поэтому
 * onTaskCreated/onTaskUpdated/onTaskDeleted не вызываются — синхронизация
 * идёт опросом onTasksReload.
 */
export const useTaskRealtimeSync = (options: TaskSyncOptions) => {
  usePolling(options.onTasksReload, options.fallbackInterval ?? 5000);
};
