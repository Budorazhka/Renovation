import { useEffect, useState, useCallback, useRef } from 'react';
import { TaskPriority, TaskStatus } from '../../../services/api';
import type { Task, Lead } from '../../../services/api';
import { useTaskSync } from '../../../hooks/useTaskSync';
import { useLeadSync } from '../../../hooks/useLeadSync';
import { useTaskRealtimeSync } from '../../../hooks/useTaskRealtimeSync';
import { useLeadRealtimeSync } from '../../../hooks/useLeadRealtimeSync';
import { leadsApiV2 } from '@/services/leadsApiV2';
import { tasksApiV2 } from '@/services/tasksApiV2';
import type { TaskV2 } from '@/types/tasksV2';
import { mapLeadV2ToCrmLead } from '@/lib/lead-v2-legacy-adapter';
import { mapTaskV2ToCrmTask } from '@/lib/task-v2-legacy-adapter';
import { isDisplayableTaskV2 } from '@/lib/map-task-v2';

export interface UseCrmDataParams {
  isAuthenticated: boolean;
}

/**
 * `[phase 4]` Лиды и задачи классической CRM переведены на новый Platform API
 * (leadsApiV2/tasksApiV2, apps/api) — легаси api-crm.baza.sale (apiService)
 * здесь больше не читается. Тот же принцип и те же адаптеры, что уже
 * применены к карточному столу (LeadsContext) и LeadViewModal.tsx.
 */
export function useCrmData({ isAuthenticated }: UseCrmDataParams) {
  const taskSync = useTaskSync();
  const leadSync = useLeadSync();
  const backendTasks = taskSync.tasks;
  const backendLeads = leadSync.leads;

  const [dataLoading, setDataLoading] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [taskCategoriesMap, setTaskCategoriesMap] = useState<Map<number, string>>(new Map());
  const [, setLeadsMap] = useState<Map<string, Lead>>(new Map());

  /**
   * `[phase 4]` version задачи на новом backend — expectedVersion для
   * complete/setStatus/setDueAt (CAS, тот же паттерн, что
   * LeadViewModal.taskVersionsRef). Задачи легаси-типа (`Task`), которыми
   * оперирует остальной экран, version не несут — кэш живёт отдельно.
   */
  const taskVersionsRef = useRef<Map<string, number>>(new Map());

  const loadTasks = useCallback(async (leadId?: string) => {
    try {
      let items: TaskV2[];
      if (leadId) {
        const response = await tasksApiV2.list({ leadId, limit: 100 });
        if (response.nextCursor) {
          console.warn('[useCrmData] Показаны не все задачи лида — упёрлись в лимит одной страницы (tasksApiV2.list)', leadId);
        }
        items = response.items;
      } else {
        const { items: allItems, complete } = await tasksApiV2.listAll();
        if (!complete) {
          console.warn('[useCrmData] Показаны не все задачи — упёрлись в предел страниц (tasksApiV2.listAll)');
        }
        items = allItems;
      }
      const visible = items.filter(isDisplayableTaskV2);
      visible.forEach((task) => taskVersionsRef.current.set(task.id, task.version));
      taskSync.syncWithBackend(visible.map(mapTaskV2ToCrmTask));
    } catch {
      // ignore
    }
  }, [taskSync]);

  const loadLeads = useCallback(async () => {
    try {
      const { items, complete } = await leadsApiV2.listAll();
      if (!complete) {
        console.warn('[useCrmData] Показаны не все лиды — упёрлись в предел страниц (leadsApiV2.listAll)');
      }
      leadSync.syncWithBackend(items.map(mapLeadV2ToCrmLead));
    } catch {
      // ignore
    }
  }, [leadSync]);

  useEffect(() => {
    if (!isAuthenticated) {
      setDataLoading(false);
      return;
    }
    let cancelled = false;
    /**
     * `[phase 4]` Легаси getTaskCategories/getOrCreateTaskCategory позволяли
     * произвольные именованные категории (в т.ч. 4 "быстрых" — "Задача дня",
     * "Срочные", "Личные дела", "Спорт"), которых создавала эта функция при
     * отсутствии. Новый backend хранит `taskCategory` как фиксированный enum
     * `'work'|'personal'` (apps/api/.../schemas/task.schema.ts) — ни списка
     * категорий, ни создания новых на лету у него нет и не будет (это была
     * бы отдельная, не запрошенная фича). Честный пробел: карта сведена к
     * двум существующим значениям без сетевого вызова; произвольные
     * "быстрые" категории для задач нового backend недоступны.
     */
    const loadTaskCategories = async (): Promise<Map<number, string>> => {
      return new Map<number, string>([
        [1, 'Работа'],
        [2, 'Личное'],
      ]);
    };
    const loadLeadsMap = async (): Promise<Map<string, Lead>> => {
      const { items, complete } = await leadsApiV2.listAll();
      if (!complete) {
        console.warn('[useCrmData] Показаны не все лиды — упёрлись в предел страниц (leadsApiV2.listAll)');
      }
      const map = new Map<string, Lead>();
      items.forEach((lead) => map.set(lead.id, mapLeadV2ToCrmLead(lead)));
      return map;
    };
    (async () => {
      try {
        setDataLoading(true);
        await Promise.all([loadTasks(), loadLeads()]);
        if (cancelled) return;
        const [categories, leadsMap] = await Promise.all([loadTaskCategories(), loadLeadsMap()]);
        if (cancelled) return;
        setTaskCategoriesMap(categories);
        setLeadsMap(leadsMap);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Запускаем только при смене авторизации; loadTasks/loadLeads намеренно не в deps,
    // иначе эффект перезапускается каждый рендер (taskSync/leadSync — новые объекты) и dataLoading не сбрасывается.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  /**
   * `[phase 4]` DELETE /tasks/:id не существует на новом backend — ближайший
   * эквивалент, отмена (status:'cancelled'); loadTasks уже отфильтровывает
   * отменённые задачи (isDisplayableTaskV2), поэтому для этого экрана
   * выглядит как настоящее удаление. `addLeadHistoryEntry` про удаление
   * задачи больше не пишется — GET /leads/:id/events хранит только переходы
   * стадии лида, эти записи уже были невидимы в истории лида до миграции
   * (тот же честный пробел, что задокументирован в LeadViewModal.tsx).
   */
  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!taskId) throw new Error('Task ID is required');
    taskSync.removeTask(taskId);
    try {
      const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
      await tasksApiV2.setStatus(taskId, expectedVersion, 'cancelled');
      taskVersionsRef.current.delete(taskId);
    } catch (error) {
      await loadTasks();
      throw error;
    }
  }, [taskSync, loadTasks]);

  /** `[phase 4]` addLeadHistoryEntry про изменение задачи убран — тот же честный пробел, что в handleDeleteTask выше. */
  const handleTaskUpdate = useCallback(async (updatedTask: Task) => {
    taskSync.updateTaskAfterSync(updatedTask._id, updatedTask);
  }, [taskSync]);

  const handleTaskRestored = useCallback(async (restoredTask: Task) => {
    taskSync.addTask(restoredTask);
    setLastUpdateTime(new Date());
    await handleTaskUpdate(restoredTask);
    await loadTasks();
    setLastUpdateTime(new Date());
  }, [taskSync, handleTaskUpdate, loadTasks]);

  const handleUpdateLeads = useCallback((updatedLeads: Lead[]) => {
    leadSync.syncWithBackend(updatedLeads);
  }, [leadSync]);

  const handleUpdateLead = useCallback((leadId: string, updates: Partial<Lead>, modifiedFields: string[]) => {
    leadSync.updateLead(leadId, updates, modifiedFields);
  }, [leadSync]);

  const handleUpdateLeadAfterSync = useCallback((leadId: string, syncedLead: Lead) => {
    leadSync.updateLeadAfterSync(leadId, syncedLead);
  }, [leadSync]);

  const handleLeadDeleted = useCallback(async (leadId: string) => {
    leadSync.removeLead(leadId);
    await loadLeads();
  }, [leadSync, loadLeads]);

  const refreshData = useCallback(async (showLoader = false) => {
    if (showLoader) setIsDataLoading(true);
    try {
      const [tasksResult, leadsResult] = await Promise.all([
        tasksApiV2.listAll(),
        leadsApiV2.listAll(),
      ]);
      if (!tasksResult.complete) {
        console.warn('[useCrmData] Показаны не все задачи — упёрлись в предел страниц (tasksApiV2.listAll)');
      }
      if (!leadsResult.complete) {
        console.warn('[useCrmData] Показаны не все лиды — упёрлись в предел страниц (leadsApiV2.listAll)');
      }
      const visibleTasks = tasksResult.items.filter(isDisplayableTaskV2);
      visibleTasks.forEach((task) => taskVersionsRef.current.set(task.id, task.version));
      taskSync.syncWithBackend(visibleTasks.map(mapTaskV2ToCrmTask));
      leadSync.syncWithBackend(leadsResult.items.map(mapLeadV2ToCrmLead));
      setLastUpdateTime(new Date());
    } catch {
      // ignore
    } finally {
      if (showLoader) setIsDataLoading(false);
    }
  }, [taskSync, leadSync]);

  useTaskRealtimeSync({
    onTaskCreated: (task) => {
      taskSync.addTask(task);
      setLastUpdateTime(new Date());
    },
    onTaskUpdated: (task) => {
      taskSync.updateTaskAfterSync(task._id, task);
      setLastUpdateTime(new Date());
    },
    onTaskDeleted: (id) => {
      taskSync.removeTask(id);
      setLastUpdateTime(new Date());
    },
    onTasksReload: () => loadTasks(),
    fallbackInterval: 5000,
  });

  useLeadRealtimeSync({
    onLeadCreated: (lead) => {
      leadSync.addLead(lead);
      setLastUpdateTime(new Date());
    },
    onLeadUpdated: (lead) => {
      leadSync.updateLeadAfterSync(lead._id, lead);
      setLastUpdateTime(new Date());
    },
    onLeadDeleted: () => setLastUpdateTime(new Date()),
    onLeadsReload: () => loadLeads(),
    fallbackInterval: 5000,
  });

  /**
   * `[phase 4]` COMPLETED — отдельная команда `complete` (не просто смена
   * статуса, см. tasksApiV2.complete докстринг), обратный переход и прочие
   * статусы — `setStatus`. Тот же маппинг, что onUpdateTaskStatus в
   * LeadViewModal.tsx. `addLeadHistoryEntry` про изменение статуса не
   * пишется — честный пробел, см. handleDeleteTask докстринг выше.
   */
  const updateTaskStatus = useCallback(async (taskId: string, status: TaskStatus) => {
    taskSync.updateTask(taskId, { status } as Partial<Task>, ['status']);
    try {
      const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
      const updated = status === TaskStatus.COMPLETED
        ? await tasksApiV2.complete(taskId, expectedVersion)
        : await tasksApiV2.setStatus(
            taskId,
            expectedVersion,
            status === TaskStatus.CANCELLED ? 'cancelled' : status === TaskStatus.IN_PROGRESS ? 'in_progress' : 'open',
          );
      taskVersionsRef.current.set(taskId, updated.version);
      taskSync.updateTaskAfterSync(taskId, mapTaskV2ToCrmTask(updated));
    } catch {
      await loadTasks();
    }
  }, [taskSync, loadTasks]);

  /** Квадрант матрицы Эйзенхауэра → пара isUrgent/isImportant в PATCH /tasks/:id. */
  const updateTaskPriority = useCallback(async (taskId: string, priority: TaskPriority) => {
    taskSync.updateTask(taskId, { priority } as Partial<Task>, ['priority']);
    try {
      const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
      const updated = await tasksApiV2.update(taskId, expectedVersion, {
        isUrgent: priority === TaskPriority.URGENT_IMPORTANT || priority === TaskPriority.URGENT_NOT_IMPORTANT,
        isImportant: priority === TaskPriority.URGENT_IMPORTANT || priority === TaskPriority.NOT_URGENT_IMPORTANT,
      });
      taskVersionsRef.current.set(taskId, updated.version);
      taskSync.updateTaskAfterSync(taskId, mapTaskV2ToCrmTask(updated));
    } catch {
      await loadTasks();
    }
  }, [taskSync, loadTasks]);

  const updateTaskEndDate = useCallback(async (taskId: string, endDate: string | undefined) => {
    taskSync.updateTask(taskId, { endDate } as Partial<Task>, ['endDate']);
    try {
      const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
      const updated = await tasksApiV2.setDueAt(taskId, expectedVersion, endDate || undefined);
      taskVersionsRef.current.set(taskId, updated.version);
      taskSync.updateTaskAfterSync(taskId, mapTaskV2ToCrmTask(updated));
    } catch {
      await loadTasks();
    }
  }, [taskSync, loadTasks]);

  return {
    taskSync,
    leadSync,
    backendTasks,
    backendLeads,
    taskCategoriesMap,
    setTaskCategoriesMap,
    dataLoading,
    setDataLoading,
    lastUpdateTime,
    setLastUpdateTime,
    isDataLoading,
    setIsDataLoading,
    loadTasks,
    loadLeads,
    handleDeleteTask,
    handleTaskUpdate,
    handleTaskRestored,
    handleUpdateLeads,
    handleUpdateLead,
    handleUpdateLeadAfterSync,
    handleLeadDeleted,
    refreshData,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskEndDate,
  };
}

export type UseCrmDataReturn = ReturnType<typeof useCrmData>;
