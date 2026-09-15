import { useEffect, useState, useCallback, useRef, startTransition } from 'react';
import { tasksApiV2 } from '@/services/tasksApiV2';
import { saveFilesToIndexedDB } from '../../../utils/taskDraftStorage';
import type { UseCrmDataReturn } from './useCrmData';
import type { UseCrmTaskFormReturn } from './useCrmTaskForm';
import type { UseCrmLeadOverlayReturn } from './useCrmLeadOverlay';
import type { ModalTaskCategory } from './types';

export interface UseCrmModalsParams {
  data: UseCrmDataReturn;
  taskForm: UseCrmTaskFormReturn;
  leadOverlay: UseCrmLeadOverlayReturn;
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams), opts?: { replace?: boolean }) => void;
  isAuthenticated: boolean;
}

export function useCrmModals({
  data,
  taskForm,
  leadOverlay: _leadOverlay,
  searchParams,
  setSearchParams,
  isAuthenticated,
}: UseCrmModalsParams) {
  const { backendTasks, loadTasks } = data;
  const {
    taskForm: formState,
    selectedTaskFiles,
    resetTaskForm,
    setCarouselSlide,
    setNoteIdToDelete,
    setIsDraftLoaded,
    setTaskForm,
    setSelectedTaskFiles: _setSelectedTaskFiles,
  } = taskForm;

  const [isNewTaskModalOpen, setIsNewTaskModalOpenState] = useState(() => searchParams.get('modal') === 'newTask');
  const [taskViewMode, setTaskViewMode] = useState<'grid' | 'columns' | 'list'>('grid');
  const [isSearchChecked, setIsSearchChecked] = useState(() => localStorage.getItem('taskSearchFilterEnabled') === 'true');
  const [selectedTaskFilter, setSelectedTaskFilter] = useState<ModalTaskCategory>('all');
  const [showCreateTask, setShowCreateTaskState] = useState(() => searchParams.get('taskView') !== 'management');
  const [isTaskManagementOpened, setIsTaskManagementOpenedState] = useState(
    () => searchParams.get('modal') === 'newTask' && searchParams.get('taskView') === 'management',
  );
  const [showTaskTypeSelection, setShowTaskTypeSelectionState] = useState(false);
  const [selectedTaskTypeState, setSelectedTaskTypeState] = useState<'standard' | 'call' | 'meeting' | null>(() => {
    const modalType = searchParams.get('modalType');
    return modalType === 'call' || modalType === 'meeting' ? modalType : null;
  });
  const [isCallMeetingModalOpen, setIsCallMeetingModalOpenState] = useState(() => searchParams.get('modal') === 'callMeeting');
  const [selectedTaskForView, setSelectedTaskForView] = useState<string | null>(() => searchParams.get('taskId') || null);
  const [isTaskViewModalOpen, setIsTaskViewModalOpen] = useState(() => searchParams.get('modal') === 'task' && !!searchParams.get('taskId'));
  const [isUnsavedChangesModalOpen, setIsUnsavedChangesModalOpen] = useState(false);
  const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileLoadingProgress, setFileLoadingProgress] = useState({
    loaded: 0,
    total: 0,
    percentage: 0,
    remainingFiles: 0,
    estimatedTimeRemaining: 0,
    currentFileName: '',
  });

  const lastOpenedTaskIdRef = useRef<string | null>(null);
  const wasModalExplicitlyClosedRef = useRef(false);

  const closeTaskModals = useCallback(() => {
    wasModalExplicitlyClosedRef.current = true;
    setIsNewTaskModalOpenState(false);
    setIsCallMeetingModalOpenState(false);
    setShowCreateTaskState(false);
    setIsTaskManagementOpenedState(false);
    setShowTaskTypeSelectionState(false);
    setSelectedTaskTypeState(null);
    setCarouselSlide(0);
    setNoteIdToDelete(null);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('modal');
    newParams.delete('modalType');
    newParams.delete('taskId');
    newParams.delete('taskView');
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams, setCarouselSlide, setNoteIdToDelete]);

  const handleCloseModal = useCallback(() => {
    wasModalExplicitlyClosedRef.current = true;

    const hasData =
      formState.title.trim() ||
      formState.description.trim() ||
      formState.subtasks.length > 0 ||
      formState.startDate ||
      formState.endDate ||
      formState.leadId ||
      selectedTaskFiles.length > 0;

    if (hasData) {
      try {
        const fileMetadata = selectedTaskFiles.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
          lastModified: f.lastModified,
        }));
        const draftData = { ...formState, fileMetadata, savedAt: new Date().toISOString() };
        let currentTaskType = formState.taskType || selectedTaskTypeState;
        if (!currentTaskType) {
          const category = formState.category || '';
          if (category === 'Звонок') currentTaskType = 'call';
          else if (category === 'Встреча') currentTaskType = 'meeting';
          else currentTaskType = 'standard';
        }
        const draftKey =
          currentTaskType === 'call' ? 'callTaskDraft' : currentTaskType === 'meeting' ? 'meetingTaskDraft' : 'taskDraft';
        localStorage.setItem(draftKey, JSON.stringify(draftData));
        if (selectedTaskFiles.length > 0) {
          saveFilesToIndexedDB(draftKey, selectedTaskFiles).catch((err) => console.error('Failed to save files to IndexedDB:', err));
        }
      } catch (error) {
        console.error('Failed to save task draft:', error);
      }
    }

    resetTaskForm();
    setIsDraftLoaded(false);
    setIsNewTaskModalOpenState(false);
    setIsCallMeetingModalOpenState(false);
    setCarouselSlide(0);
    setIsTaskManagementOpenedState(false);
    setShowTaskTypeSelectionState(false);
    setSelectedTaskTypeState(null);
    setNoteIdToDelete(null);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('modal');
    newParams.delete('modalType');
    newParams.delete('taskId');
    newParams.delete('taskView');
    setSearchParams(newParams, { replace: true });
  }, [
    formState,
    selectedTaskFiles,
    selectedTaskTypeState,
    resetTaskForm,
    setIsDraftLoaded,
    setCarouselSlide,
    setNoteIdToDelete,
    searchParams,
    setSearchParams,
  ]);

  const handleOpenTaskView = useCallback(
    async (taskId: string) => {
      if (isTaskViewModalOpen && selectedTaskForView === taskId) return;
      // Явно сбрасываем флаг "модалка была закрыта руками",
      // чтобы URL снова мог управлять её открытием
      wasModalExplicitlyClosedRef.current = false;

      const foundTask = backendTasks.find((t) => t._id === taskId);
      if (foundTask) {
        setSelectedTaskForView(taskId);
        setIsTaskViewModalOpen(true);
        lastOpenedTaskIdRef.current = taskId;
        const newParams = new URLSearchParams(searchParams);
        newParams.set('modal', 'task');
        newParams.set('taskId', taskId);
        setSearchParams(newParams, { replace: true });
      } else {
        try {
          // Бросает 404, если задачи нет или она чужой организации.
          await tasksApiV2.getById(taskId);
          setSelectedTaskForView(taskId);
          setIsTaskViewModalOpen(true);
          lastOpenedTaskIdRef.current = taskId;
          const newParams = new URLSearchParams(searchParams);
          newParams.set('modal', 'task');
          newParams.set('taskId', taskId);
          setSearchParams(newParams, { replace: true });
          await data.loadTasks();
        } catch (error: unknown) {
          const err = error as { response?: { status?: number } };
          if (err.response?.status === 404) alert('Задача не найдена или была удалена');
          else if (err.response?.status === 403 || err.response?.status === 401) alert('Нет доступа к этой задаче');
          else alert('Не удалось загрузить задачу. Попробуйте обновить страницу.');
        }
      }
    },
    [backendTasks, searchParams, setSearchParams, isTaskViewModalOpen, selectedTaskForView, data],
  );

  const handleCloseTaskView = useCallback(() => {
    // Помечаем, что модалку закрыли "руками", чтобы эффект,
    // который читает состояние из URL, не переоткрывал её на этом же тике
    wasModalExplicitlyClosedRef.current = true;

    setSelectedTaskForView(null);
    setIsTaskViewModalOpen(false);
    lastOpenedTaskIdRef.current = null;
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('modal');
    newParams.delete('taskId');
    newParams.delete('editing');
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleOpenNewTaskModal = useCallback(() => {
    wasModalExplicitlyClosedRef.current = false;
    taskForm.resetTaskForm();
    setShowTaskTypeSelectionState(true);
    setIsNewTaskModalOpenState(true);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('modal', 'newTask');
    setSearchParams(newParams, { replace: true });
  }, [taskForm, searchParams, setSearchParams]);

  const handleOpenTaskManagementModal = useCallback(() => {
    wasModalExplicitlyClosedRef.current = false;
    taskForm.resetTaskForm();
    setShowCreateTaskState(false);
    setIsTaskManagementOpenedState(true);
    if (window.innerWidth < 768) {
      setCarouselSlide(0);
    }
    setIsNewTaskModalOpenState(true);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('modal', 'newTask');
    newParams.set('taskView', 'management');
    setSearchParams(newParams, { replace: true });
  }, [taskForm, setCarouselSlide, searchParams, setSearchParams]);

  const handleTaskTypeSelected = useCallback(
    (taskType: 'standard' | 'call' | 'meeting') => {
      wasModalExplicitlyClosedRef.current = false;
      const newParams = new URLSearchParams(searchParams);
      if (taskType === 'call' || taskType === 'meeting') {
        newParams.set('modal', 'callMeeting');
        newParams.set('modalType', taskType);
      } else {
        newParams.set('modal', 'newTask');
        newParams.delete('modalType');
      }
      setSearchParams(newParams, { replace: true });
      setShowTaskTypeSelectionState(false);
      setSelectedTaskTypeState(taskType);
      if (taskType === 'call') {
        setTaskForm((prev) => ({ ...prev, category: 'Звонок', taskType: 'call' }));
      } else if (taskType === 'meeting') {
        setTaskForm((prev) => ({ ...prev, category: 'Встреча', taskType: 'meeting' }));
      }
      setIsCallMeetingModalOpenState(taskType === 'call' || taskType === 'meeting');
    },
    [searchParams, setSearchParams, setTaskForm, setIsCallMeetingModalOpenState],
  );

  const handleOpenNewTaskModalFromNote = useCallback(
    (noteData: {
      title: string;
      description: string;
      leadId?: string;
      taskType?: 'standard' | 'call' | 'meeting';
      noteId?: string;
      files?: Array<{ originalName: string; filename: string; mimeType: string; size: number }>;
    }) => {
      wasModalExplicitlyClosedRef.current = false;
      taskForm.resetTaskForm();
      if (noteData.noteId) setNoteIdToDelete(noteData.noteId);
      setTaskForm((prev) => ({
        ...prev,
        title: noteData.title || prev.title,
        description: noteData.description || prev.description,
        leadId: noteData.leadId || prev.leadId,
        taskType: noteData.taskType ?? prev.taskType,
      }));
      setShowTaskTypeSelectionState(false);
      setSelectedTaskTypeState('standard');
      setIsCallMeetingModalOpenState(false);
      setShowCreateTaskState(true);
      setIsTaskManagementOpenedState(true);
      setIsNewTaskModalOpenState(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.set('modal', 'newTask');
      setSearchParams(newParams, { replace: true });
    },
    [taskForm, setNoteIdToDelete, setTaskForm, searchParams, setSearchParams],
  );

  const handleOpenNewTaskModalWithLead = useCallback(
    (leadId: string) => {
      const lead = data.backendLeads.find((l) => l._id === leadId);
      if (!lead) return;
      wasModalExplicitlyClosedRef.current = false;
      taskForm.resetTaskForm();
      setTaskForm((prev) => ({
        ...prev,
        leadId: lead._id,
        clientName: lead.name || '',
        phone: lead.phone || '',
        email: lead.email || '',
      }));
      setShowTaskTypeSelectionState(false);
      setSelectedTaskTypeState('standard');
      setIsCallMeetingModalOpenState(false);
      setShowCreateTaskState(true);
      setIsTaskManagementOpenedState(true);
      setIsNewTaskModalOpenState(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.set('modal', 'newTask');
      setSearchParams(newParams, { replace: true });
    },
    [data.backendLeads, taskForm, setTaskForm, searchParams, setSearchParams],
  );

  const handleSaveAndClose = useCallback(async () => {
    await taskForm.handleCreateTask();
    closeTaskModals();
  }, [taskForm, closeTaskModals]);

  const handleDiscardChanges = useCallback(() => {
    if (pendingCloseAction) {
      pendingCloseAction();
      setPendingCloseAction(null);
    }
    setIsUnsavedChangesModalOpen(false);
    closeTaskModals();
  }, [pendingCloseAction, closeTaskModals]);

  const handleAddProperty = useCallback(() => {
    setNewPropertyName('');
    setIsPropertyModalOpen(false);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const modalParam = searchParams.get('modal');
    const taskIdParam = searchParams.get('taskId');
    const modalTypeParam = searchParams.get('modalType') as 'call' | 'meeting' | null;
    const taskViewParam = searchParams.get('taskView');
    const isAlreadyOpen =
      isTaskViewModalOpen && selectedTaskForView === taskIdParam && lastOpenedTaskIdRef.current === taskIdParam;

    const applyModalState = () => {
      if (
        modalParam === 'task' &&
        taskIdParam &&
        !isAlreadyOpen &&
        !wasModalExplicitlyClosedRef.current &&
        (!isTaskViewModalOpen || selectedTaskForView !== taskIdParam)
      ) {
        const foundTask = backendTasks.find((t) => t._id === taskIdParam);
        if (foundTask) {
          setSelectedTaskForView(taskIdParam);
          setIsTaskViewModalOpen(true);
          // Модалка открыта на основе URL — считаем, что это "осознанное" открытие
          wasModalExplicitlyClosedRef.current = false;
          lastOpenedTaskIdRef.current = taskIdParam;
        } else {
          const loadTaskFromAPI = async () => {
            try {
              await tasksApiV2.getById(taskIdParam);
              startTransition(() => {
                setSelectedTaskForView(taskIdParam);
                setIsTaskViewModalOpen(true);
              });
              lastOpenedTaskIdRef.current = taskIdParam;
              await loadTasks();
            } catch {
              const newParams = new URLSearchParams(searchParams);
              newParams.delete('modal');
              newParams.delete('taskId');
              newParams.delete('editing');
              setSearchParams(newParams, { replace: true });
              lastOpenedTaskIdRef.current = null;
            }
          };
          loadTaskFromAPI();
        }
      } else if (modalParam === 'newTask') {
        if (!isNewTaskModalOpen && !wasModalExplicitlyClosedRef.current) {
          setShowTaskTypeSelectionState(true);
          setIsNewTaskModalOpenState(true);
          wasModalExplicitlyClosedRef.current = false;
        }
        if (taskViewParam === 'management') {
          setShowCreateTaskState(false);
          setIsTaskManagementOpenedState(true);
        }
      } else if (modalParam === 'callMeeting' && modalTypeParam && !isCallMeetingModalOpen) {
        if (!wasModalExplicitlyClosedRef.current) {
          setSelectedTaskTypeState(modalTypeParam);
          setIsCallMeetingModalOpenState(true);
          setIsNewTaskModalOpenState(true);
          wasModalExplicitlyClosedRef.current = false;
        }
      }
    };

    startTransition(applyModalState);
  }, [
    isAuthenticated,
    searchParams,
    showTaskTypeSelection,
    showCreateTask,
    isNewTaskModalOpen,
    isCallMeetingModalOpen,
    isTaskViewModalOpen,
    selectedTaskForView,
    backendTasks,
    loadTasks,
    setSearchParams,
  ]);

  useEffect(() => {
    localStorage.setItem('taskSearchFilterEnabled', String(isSearchChecked));
  }, [isSearchChecked]);

  return {
    isNewTaskModalOpen,
    setIsNewTaskModalOpen: setIsNewTaskModalOpenState,
    isCallMeetingModalOpen,
    setIsCallMeetingModalOpen: setIsCallMeetingModalOpenState,
    showCreateTask,
    setShowCreateTask: setShowCreateTaskState,
    isTaskManagementOpened,
    setIsTaskManagementOpened: setIsTaskManagementOpenedState,
    showTaskTypeSelection,
    setShowTaskTypeSelection: setShowTaskTypeSelectionState,
    selectedTaskType: selectedTaskTypeState,
    setSelectedTaskType: setSelectedTaskTypeState,
    taskViewMode,
    setTaskViewMode,
    isSearchChecked,
    setIsSearchChecked,
    selectedTaskFilter,
    setSelectedTaskFilter,
    selectedTaskForView,
    setSelectedTaskForView,
    isTaskViewModalOpen,
    setIsTaskViewModalOpen,
    handleOpenTaskView,
    handleCloseTaskView,
    handleOpenNewTaskModal,
    handleOpenTaskManagementModal,
    handleTaskTypeSelected,
    handleOpenNewTaskModalFromNote,
    handleOpenNewTaskModalWithLead,
    handleCloseModal,
    closeTaskModals,
    isUnsavedChangesModalOpen,
    setIsUnsavedChangesModalOpen,
    pendingCloseAction,
    setPendingCloseAction,
    handleSaveAndClose,
    handleDiscardChanges,
    isPropertyModalOpen,
    setIsPropertyModalOpen,
    newPropertyName,
    setNewPropertyName,
    handleAddProperty,
    isLoadingFiles,
    setIsLoadingFiles,
    fileLoadingProgress,
    setFileLoadingProgress,
  };
}

export type UseCrmModalsReturn = ReturnType<typeof useCrmModals>;
