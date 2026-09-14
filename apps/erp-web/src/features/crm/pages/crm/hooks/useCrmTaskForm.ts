import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { TaskPriority, TaskStatus } from '../../../services/api';
import { categoryFields, crmTaskService } from '../../../services/crmTasksV2';
import type { Task } from '../../../services/api';
import { newIdempotencyKey, tasksApiV2 } from '@/services/tasksApiV2';
import type { CreateTaskV2Payload, TaskAttachmentV2 } from '@/types/tasksV2';
import { mediaApiV2 } from '@/services/mediaApiV2';
import { mapTaskV2ToCrmTask } from '@/lib/task-v2-legacy-adapter';
import { notesService } from '../../../services/notesV2';
import { clearFilesFromIndexedDB } from '../../../utils/taskDraftStorage';
import { createInitialTaskFormState, excelColorPalette, formatFileSize, type TaskFormState } from '../../../utils/taskFormUtils';
import type { ModalTaskData } from '../../../components/crm/TaskCard';
import { sanitizeCategories } from './helpers';
import type { UseCrmDataReturn } from './useCrmData';
import type { ModalTaskCategory } from './types';

export interface UseCrmTaskFormParams {
  data: UseCrmDataReturn;
  user: { id: string } | null;
  /** Called after task is created successfully (close modals, clear URL). */
  onTaskCreatedRef?: React.MutableRefObject<(() => void) | null>;
  /** Called on swipe-to-close (close modal and save draft). */
  onRequestCloseModalRef?: React.MutableRefObject<(() => void) | null>;
}

const MODAL_TASK_CATEGORIES: { key: ModalTaskCategory; label: string }[] = [
  { key: 'work', label: 'Рабочие задачи' },
  { key: 'personal', label: 'Личные задачи' },
  { key: 'all', label: 'Все' },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const MODAL_TASKS_CATEGORIES_BY_INDEX: ModalTaskCategory[] = [
  'personal', 'work', 'personal', 'work', 'personal', 'work',
];

export function useCrmTaskForm({ data, user, onTaskCreatedRef, onRequestCloseModalRef }: UseCrmTaskFormParams) {
  const userId = user?.id;
  const {
    backendTasks,
    taskSync,
    taskCategoriesMap,
    loadTasks,
  } = data;

  const [taskForm, setTaskForm] = useState(createInitialTaskFormState);
  const [showDescriptionField, setShowDescriptionField] = useState(false);
  const [selectedTaskFiles, setSelectedTaskFiles] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const taskFileInputRef = useRef<HTMLInputElement>(null);
  const [isSubtaskInputVisible, setIsSubtaskInputVisible] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  const [isStartDateExpanded, setIsStartDateExpanded] = useState(false);
  const [isStartTimeExpanded, setIsStartTimeExpanded] = useState(false);
  const [isEndDateExpanded, setIsEndDateExpanded] = useState(false);
  const [isEndTimeExpanded, setIsEndTimeExpanded] = useState(false);

  const startDateRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<HTMLDivElement>(null);
  const endDateRef = useRef<HTMLDivElement>(null);
  const endTimeRef = useRef<HTMLDivElement>(null);

  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [isPhoneSearchOpen, setIsPhoneSearchOpen] = useState(false);
  const phoneSearchRef = useRef<HTMLDivElement>(null);

  const [colorPalette, setColorPalette] = useState<string[]>(excelColorPalette);
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [isColorPaletteModalOpen, setIsColorPaletteModalOpen] = useState(false);
  const [newColorHex, setNewColorHex] = useState('#169600');

  const [carouselSlide, setCarouselSlide] = useState(0);
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [noteIdToDelete, setNoteIdToDelete] = useState<string | null>(null);

  const [taskCategoryFilter, setTaskCategoryFilter] = useState<'all' | 'work' | 'personal'>('all');
  const [taskCategoryById, setTaskCategoryById] = useState<Record<string, ModalTaskCategory>>({});
  const [modalTaskChecked, setModalTaskChecked] = useState<boolean[]>([]);
  const [draggedOverQuadrant, setDraggedOverQuadrant] = useState<string | null>(null);
  const [editingSubtaskIndex, setEditingSubtaskIndex] = useState<number | 'new' | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState<string>('');

  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isDragging = useRef(false);
  const isDragOperation = useRef(false);
  const touchStartElement = useRef<HTMLElement | null>(null);
  const recentlyChangedCategoriesRef = useRef<Map<string, number>>(new Map());

  const mapBackendTaskToCategory = useCallback((backendTask?: Task): ModalTaskCategory => {
    if (!backendTask) return 'personal';
    if (backendTask.categories && Array.isArray(backendTask.categories)) {
      if (backendTask.categories.includes('Рабочие задачи')) return 'work';
      if (backendTask.categories.includes('Личные задачи')) return 'personal';
    }
    if (backendTask.category !== undefined) {
      const categoryName = taskCategoriesMap.get(backendTask.category);
      if (categoryName === 'Рабочие задачи') return 'work';
      if (categoryName === 'Личные задачи') return 'personal';
    }
    return 'personal';
  }, [taskCategoriesMap]);

  const transformTaskToModalData = useCallback((task: Task): ModalTaskData => {
    const priorityToUrgencyImportance = (priority: TaskPriority) => {
      switch (priority) {
        case TaskPriority.URGENT_IMPORTANT:
          return { urgency: 'urgent' as const, importance: 'important' as const };
        case TaskPriority.NOT_URGENT_IMPORTANT:
          return { urgency: 'notUrgent' as const, importance: 'important' as const };
        case TaskPriority.URGENT_NOT_IMPORTANT:
          return { urgency: 'urgent' as const, importance: 'notImportant' as const };
        case TaskPriority.NOT_URGENT_NOT_IMPORTANT:
        default:
          return { urgency: 'notUrgent' as const, importance: 'notImportant' as const };
      }
    };
    const { urgency, importance } = priorityToUrgencyImportance(task.priority);
    const icons: Array<'redLightning' | 'yellowBookmark'> = [];
    if (urgency === 'urgent') icons.push('redLightning');
    if (importance === 'important') icons.push('yellowBookmark');

    const leadName = task.clientName || (task.leadId && typeof task.leadId === 'object' ? (task.leadId as { name?: string }).name : undefined);
    const leadPhone = task.leadId && typeof task.leadId === 'object' ? (task.leadId as { phone?: string }).phone : undefined;

    let taskType: 'standard' | 'call' | 'meeting' = 'standard';
    let workType: 'work' | 'personal' | undefined = undefined;
    if (task.categories && Array.isArray(task.categories)) {
      const hasCall = task.categories.some((c: string) => c.toLowerCase().includes('звонок') || c.toLowerCase().includes('call'));
      const hasMeeting = task.categories.some((c: string) => c.toLowerCase().includes('встреча') || c.toLowerCase().includes('meeting'));
      const hasWork = task.categories.some((c: string) => c.includes('Рабочие задачи'));
      const hasPersonal = task.categories.some((c: string) => c.includes('Личные задачи'));
      if (hasCall) taskType = 'call';
      else if (hasMeeting) taskType = 'meeting';
      if (hasWork) workType = 'work';
      else if (hasPersonal) workType = 'personal';
    } else if (task.category !== undefined) {
      const categoryName = taskCategoriesMap.get(task.category);
      if (categoryName) {
        const lower = categoryName.toLowerCase();
        if (lower.includes('звонок') || lower.includes('call')) taskType = 'call';
        else if (lower.includes('встреча') || lower.includes('meeting')) taskType = 'meeting';
        if (categoryName.includes('Рабочие задачи')) workType = 'work';
        else if (categoryName.includes('Личные задачи')) workType = 'personal';
      }
    }

    return {
      id: task._id,
      title: task.title,
      dateTime: task.endDate ? new Date(task.endDate).toLocaleDateString('ru-RU') : 'Без срока',
      dateTimeColor: 'gray',
      startDate: task.startDate,
      endDate: task.endDate,
      progress: {
        current: task.subtasks?.filter(s => s.completed).length || 0,
        total: task.subtasks?.length || 0,
        completed: task.status === TaskStatus.COMPLETED,
      },
      icons,
      colorLabel: task.colorLabel,
      user: task.clientName ? { name: task.clientName, image: '' } : undefined,
      leadName,
      taskType,
      workType,
      phone: leadPhone,
      files: task.files,
      urgency,
      importance,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }, [taskCategoriesMap]);

  const modalTasksData = useMemo(() => backendTasks.map(transformTaskToModalData), [backendTasks, transformTaskToModalData]);

  const filteredModalTasksData = useMemo(() => {
    if (taskCategoryFilter === 'all') return modalTasksData;
    return modalTasksData.filter(task => {
      const backendTask = backendTasks.find(t => t._id === task.id);
      if (!backendTask) return false;
      if (backendTask.categories && Array.isArray(backendTask.categories)) {
        if (taskCategoryFilter === 'work') return backendTask.categories.includes('Рабочие задачи');
        if (taskCategoryFilter === 'personal') return backendTask.categories.includes('Личные задачи');
      }
      if (backendTask.category !== undefined) {
        const categoryName = taskCategoriesMap.get(backendTask.category);
        if (taskCategoryFilter === 'work') return categoryName === 'Рабочие задачи';
        if (taskCategoryFilter === 'personal') return categoryName === 'Личные задачи';
      }
      return false;
    });
  }, [taskCategoryFilter, modalTasksData, backendTasks, taskCategoriesMap]);

  useEffect(() => {
    const checkedStates = backendTasks.map(task => task.status === TaskStatus.COMPLETED);
    setModalTaskChecked(checkedStates);
  }, [backendTasks]);

  useEffect(() => {
    if (Object.keys(taskCategoryById).length === 0 && modalTasksData.length > 0) {
      const init: Record<string, ModalTaskCategory> = {};
      for (let i = 0; i < modalTasksData.length; i += 1) {
        init[modalTasksData[i].id] = MODAL_TASKS_CATEGORIES_BY_INDEX[i] || 'personal';
      }
      setTaskCategoryById(init);
    } else {
      const updated = { ...taskCategoryById };
      let hasChanges = false;
      const newTasks = modalTasksData.filter(task => !updated[task.id]);
      newTasks.forEach(task => {
        const backendTask = backendTasks.find(t => t._id === task.id);
        updated[task.id] = mapBackendTaskToCategory(backendTask);
        hasChanges = true;
      });
      const now = Date.now();
      const categoryChangeBlockDelay = 3000;
      recentlyChangedCategoriesRef.current.forEach((timestamp, taskId) => {
        if (now - timestamp > categoryChangeBlockDelay) {
          recentlyChangedCategoriesRef.current.delete(taskId);
        }
      });
      modalTasksData.forEach(task => {
        if (updated[task.id]) {
          const categoryChangedAt = recentlyChangedCategoriesRef.current.get(task.id);
          if (categoryChangedAt && (now - categoryChangedAt) < categoryChangeBlockDelay) return;
          const backendTask = backendTasks.find(t => t._id === task.id);
          const expectedCategory = mapBackendTaskToCategory(backendTask);
          if (updated[task.id] !== expectedCategory) {
            updated[task.id] = expectedCategory;
            hasChanges = true;
          }
        }
      });
      if (hasChanges) setTaskCategoryById(updated);
    }
  }, [modalTasksData, taskCategoryById, backendTasks, mapBackendTaskToCategory]);

  // Задача создаётся в apps/api (POST /api/v1/tasks). Легаси-категории
  // «Звонок»/«Встреча» у платформы не хранятся — остаётся только пара
  // «рабочая/личная» (taskCategory). Создание задачи с leadId само попадает
  // в таймлайн лида, отдельная запись истории не нужна.
  const createBackendTask = useCallback(async (
    title: string,
    description: string,
    priority: TaskPriority,
    subtasks: Array<{ title: string; completed: boolean }>,
    leadId?: string,
    startAt?: string,
    dueAt?: string,
    colorLabel?: string,
    categories?: string[],
    attachments?: TaskAttachmentV2[],
  ): Promise<Task | null> => {
    try {
      const normalizedCategories = sanitizeCategories(categories) ?? [];
      const payload: CreateTaskV2Payload = {
        title,
        ...(description && { description }),
        isUrgent: priority === TaskPriority.URGENT_IMPORTANT || priority === TaskPriority.URGENT_NOT_IMPORTANT,
        isImportant: priority === TaskPriority.URGENT_IMPORTANT || priority === TaskPriority.NOT_URGENT_IMPORTANT,
        taskCategory: 'work',
        ...categoryFields(normalizedCategories),
        ...(startAt && { startAt }),
        ...(dueAt && { dueAt }),
        colorHex: colorLabel && HEX_COLOR.test(colorLabel) ? colorLabel : null,
        subtasks: subtasks.map((s, index) => ({ id: `sub-${Date.now()}-${index}`, title: s.title, done: s.completed })),
        ...(attachments && attachments.length > 0 && { attachments }),
        ...(userId && { assignedPositionId: userId }),
        ...(leadId && { leadId }),
      };
      const created = mapTaskV2ToCrmTask(await tasksApiV2.create(payload, newIdempotencyKey()));
      taskSync.addTask(created);
      void loadTasks();
      return created;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      alert(`Ошибка: ${err.response?.data?.message || err.message || 'Не удалось создать задачу'}`);
      return null;
    }
  }, [userId, taskSync, loadTasks]);

  const handleCreateTask = useCallback(async (customTaskForm?: TaskFormState) => {
    const formData = customTaskForm || taskForm;
    if (!formData) return;

    const title = (formData.title || '').trim();
    if (!title) {
      alert('Название задачи обязательно для заполнения');
      return;
    }
    if (!formData.startDate) {
      alert('Срок начала обязателен для заполнения');
      return;
    }

    const getPriority = (): TaskPriority => {
      if (formData.urgency === 'urgent' && formData.importance === 'important') return TaskPriority.URGENT_IMPORTANT;
      if (formData.urgency === 'notUrgent' && formData.importance === 'important') return TaskPriority.NOT_URGENT_IMPORTANT;
      if (formData.urgency === 'urgent' && formData.importance === 'notImportant') return TaskPriority.URGENT_NOT_IMPORTANT;
      return TaskPriority.NOT_URGENT_NOT_IMPORTANT;
    };

    try {
      setIsUploadingFiles(true);

      let startDateObj: Date | undefined;
      let endDateObj: Date | undefined;

      if (formData.startDate) {
        const dateOnly = formData.startDate.includes('T') ? formData.startDate.split('T')[0] : formData.startDate;
        const timeStr = formData.startTime || '00:00';
        const [hours, minutes] = timeStr.split(':').map(Number);
        const [year, month, day] = dateOnly.split('-').map(Number);
        startDateObj = new Date(year, month - 1, day, hours, minutes, 0);
        if (isNaN(startDateObj.getTime())) {
          alert('Неверная дата или время начала');
          setIsUploadingFiles(false);
          return;
        }
      }

      if (formData.endDate) {
        const dateOnly = formData.endDate.includes('T') ? formData.endDate.split('T')[0] : formData.endDate;
        const timeStr = formData.endTime || '00:00';
        const [hours, minutes] = timeStr.split(':').map(Number);
        const [year, month, day] = dateOnly.split('-').map(Number);
        endDateObj = new Date(year, month - 1, day, hours, minutes, 0);
        if (isNaN(endDateObj.getTime())) {
          alert('Неверная дата или время окончания');
          setIsUploadingFiles(false);
          return;
        }
        if (startDateObj && endDateObj && startDateObj > endDateObj) {
          alert('Дата начала не может быть позже даты окончания. Пожалуйста, исправьте даты.');
          setIsUploadingFiles(false);
          return;
        }
        if (startDateObj && endDateObj && startDateObj.getTime() === endDateObj.getTime()) {
          endDateObj = new Date(startDateObj.getTime() + 60 * 60 * 1000);
        }
      }

      let finalCategories: string[] | undefined;
      if (formData.taskType === 'standard' || !formData.taskType) {
        if (formData.taskCategory) {
          finalCategories = [formData.taskCategory === 'work' ? 'Рабочие задачи' : 'Личные задачи'];
        }
      } else {
        finalCategories = formData.categories?.length ? formData.categories : undefined;
      }

      const leadIdToUse = formData.leadId && typeof formData.leadId === 'string' && formData.leadId.trim()
        ? formData.leadId.trim()
        : undefined;

      // Файлы загружаются в хранилище платформы до создания задачи — сервер
      // принимает только ссылки на уже загруженные файлы (assetId).
      const attachments: TaskAttachmentV2[] = [];
      for (const file of selectedTaskFiles) {
        try {
          const { assetId } = await mediaApiV2.uploadFile(file, 'task_attachment');
          attachments.push({ assetId, fileName: file.name });
        } catch {
          alert(`Не удалось загрузить файл «${file.name}». Задача не создана.`);
          return;
        }
      }

      const newTask = await createBackendTask(
        title,
        formData.description,
        getPriority(),
        formData.subtasks,
        leadIdToUse,
        startDateObj?.toISOString(),
        endDateObj?.toISOString(),
        formData.colorTag !== 'none' ? formData.colorTag : undefined,
        finalCategories ?? formData.categories,
        attachments,
      );

      if (newTask) {
        if (noteIdToDelete) {
          try {
            await notesService.deleteNote(noteIdToDelete);
            setNoteIdToDelete(null);
          } catch {
            // ignore
          }
        }
        try {
          localStorage.removeItem('taskDraft');
          localStorage.removeItem('callTaskDraft');
          localStorage.removeItem('meetingTaskDraft');
          await Promise.all([
            clearFilesFromIndexedDB('taskDraft').catch(() => {}),
            clearFilesFromIndexedDB('callTaskDraft').catch(() => {}),
            clearFilesFromIndexedDB('meetingTaskDraft').catch(() => {}),
          ]);
        } catch {
          // ignore
        }

        setTimeout(() => {
          setTaskForm(prev => ({
            ...prev,
            title: '',
            description: '',
            subtasks: [],
            phoneSearch: prev.clientName || '',
            startDate: '',
            endDate: '',
            startTime: '09:00',
            endTime: '19:00',
            urgency: 'urgent',
            importance: 'important',
            colorTag: 'none',
            categories: [],
            category: 'Личные дела',
            taskCategory: 'work',
          }));
          setShowDescriptionField(false);
          setSelectedTaskFiles([]);
          onTaskCreatedRef?.current?.();
        }, 0);
      } else {
        alert('Не удалось создать задачу. Проверьте данные и попробуйте снова.');
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      alert(`Ошибка: ${err.response?.data?.message || err.message || 'Не удалось создать задачу'}`);
    } finally {
      setIsUploadingFiles(false);
    }
  }, [taskForm, selectedTaskFiles, createBackendTask, noteIdToDelete, onTaskCreatedRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) setIsClientDropdownOpen(false);
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) setIsCategoryDropdownOpen(false);
      if (startDateRef.current && !startDateRef.current.contains(event.target as Node)) setIsStartDateExpanded(false);
      if (startTimeRef.current && !startTimeRef.current.contains(event.target as Node)) setIsStartTimeExpanded(false);
      if (endDateRef.current && !endDateRef.current.contains(event.target as Node)) setIsEndDateExpanded(false);
      if (endTimeRef.current && !endTimeRef.current.contains(event.target as Node)) setIsEndTimeExpanded(false);
      if (phoneSearchRef.current && !phoneSearchRef.current.contains(event.target as Node)) setIsPhoneSearchOpen(false);
    };
    if (isClientDropdownOpen || isCategoryDropdownOpen || isStartDateExpanded || isStartTimeExpanded || isEndDateExpanded || isEndTimeExpanded || isPhoneSearchOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isClientDropdownOpen, isCategoryDropdownOpen, isStartDateExpanded, isStartTimeExpanded, isEndDateExpanded, isEndTimeExpanded, isPhoneSearchOpen]);

  const resetTaskForm = useCallback(() => {
    setTaskForm(createInitialTaskFormState());
    setShowDescriptionField(false);
    setSelectedTaskFiles([]);
    setIsSubtaskInputVisible(false);
    setNewSubtaskTitle('');
    setIsStartDateExpanded(false);
    setIsStartTimeExpanded(false);
    setIsEndDateExpanded(false);
    setIsEndTimeExpanded(false);
  }, []);

  const handleTaskFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    const filesArray = Array.from(files);
    const totalFiles = selectedTaskFiles.length + filesArray.length;
    if (totalFiles > 10) {
      alert(`Можно загрузить максимум 10 файлов. У вас уже выбрано ${selectedTaskFiles.length} файлов, можно добавить еще ${10 - selectedTaskFiles.length}`);
      if (event.target) event.target.value = '';
      return;
    }
    setSelectedTaskFiles(prev => [...prev, ...filesArray]);
    if (event.target) event.target.value = '';
  }, [selectedTaskFiles.length]);

  const handleRemoveTaskFile = useCallback((index: number) => {
    setSelectedTaskFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddSubtask = useCallback((title: string) => {
    setTaskForm(prev => ({ ...prev, subtasks: [...prev.subtasks, { title, completed: false }] }));
  }, []);

  const handleToggleSubtask = useCallback((index: number) => {
    setTaskForm(prev => ({
      ...prev,
      subtasks: prev.subtasks.map((subtask, i) =>
        i === index ? { ...subtask, completed: !subtask.completed } : subtask,
      ),
    }));
  }, []);

  const handleRemoveSubtask = useCallback((index: number) => {
    setTaskForm(prev => ({ ...prev, subtasks: prev.subtasks.filter((_, i) => i !== index) }));
  }, []);

  const handleStartEditSubtask = useCallback((index: number) => {
    setEditingSubtaskIndex(index);
    setEditingSubtaskTitle(taskForm.subtasks[index].title);
  }, [taskForm.subtasks]);

  const handleStartAddSubtask = useCallback(() => {
    setEditingSubtaskIndex('new');
    setEditingSubtaskTitle('');
  }, []);

  const handleSaveEditSubtask = useCallback((index: number | 'new') => {
    if (editingSubtaskTitle.trim()) {
      if (index === 'new') {
        setTaskForm(prev => ({
          ...prev,
          subtasks: [...(prev.subtasks || []), { title: editingSubtaskTitle.trim(), completed: false }],
        }));
      } else {
        setTaskForm(prev => ({
          ...prev,
          subtasks: prev.subtasks.map((subtask, i) =>
            i === index ? { ...subtask, title: editingSubtaskTitle.trim() } : subtask,
          ),
        }));
      }
    }
    setEditingSubtaskIndex(null);
    setEditingSubtaskTitle('');
  }, [editingSubtaskTitle]);

  const handleCancelEditSubtask = useCallback(() => {
    setEditingSubtaskIndex(null);
    setEditingSubtaskTitle('');
  }, []);

  const handleTaskDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, id: string) => {
    if (e.dataTransfer) {
      try {
        e.dataTransfer.setData('application/x-task-id', id);
        e.dataTransfer.setData('text/plain', '');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.dropEffect = 'move';
      } catch {
        // no-op
      }
    }
    isDragOperation.current = true;
    isDragging.current = true;
  }, []);

  const handleTaskDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>, targetCategory: ModalTaskCategory) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer
      ? e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain')
      : '';
    if (!id) {
      isDragOperation.current = false;
      isDragging.current = false;
      return;
    }
    isDragOperation.current = false;
    isDragging.current = false;

    const task = backendTasks.find(t => t._id === id);
    if (task) {
      const targetCategoryData = MODAL_TASK_CATEGORIES.find(c => c.key === targetCategory);
      const categoryLabel = targetCategoryData?.label;
      const categoryLabelString = targetCategory === 'work' ? 'Рабочие задачи' : 'Личные задачи';
      const categoriesPayload = (() => {
        const base = Array.isArray(task.categories) ? task.categories : [];
        const withoutOld = base.filter((c: string) => c !== 'Рабочие задачи' && c !== 'Личные задачи');
        if (categoryLabelString) return [...withoutOld, categoryLabelString];
        return withoutOld;
      })();
      const normalizedCategories = sanitizeCategories(categoriesPayload);

      if (categoryLabel) {
        recentlyChangedCategoriesRef.current.set(id, Date.now());
        setTaskCategoryById(prev => ({ ...prev, [id]: targetCategory }));
        taskSync.updateTask(id, { categories: normalizedCategories } as Partial<Task>, ['categories']);
        const response = await crmTaskService.updateTask(id, { categories: normalizedCategories });
        if (response.success && response.data) {
          taskSync.updateTaskAfterSync(id, response.data);
        } else {
          await loadTasks();
        }
      }
    } else {
      setTaskCategoryById(prev => ({ ...prev, [id]: targetCategory }));
    }
  }, [backendTasks, taskSync, loadTasks]);

  const handleTaskDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    isDragOperation.current = false;
    isDragging.current = false;
  }, []);

  const allowDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    touchStartElement.current = target;
    const draggableElement = target.closest('[draggable="true"]');
    if (draggableElement) {
      isDragging.current = true;
      isDragOperation.current = true;
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    const scrollableContainer = target.closest('.overflow-x-auto, .overflow-y-auto');
    if (scrollableContainer) {
      const container = scrollableContainer as HTMLElement;
      const hasVerticalScroll = container.scrollHeight > container.clientHeight;
      const isAtTopEdge = container.scrollTop <= 1;
      const isAtBottomEdge = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      if (hasVerticalScroll && !isAtTopEdge && !isAtBottomEdge) {
        isDragging.current = false;
        isDragOperation.current = false;
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }
    }
    isDragging.current = false;
    isDragOperation.current = false;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (isDragOperation.current) {
      isDragging.current = false;
      isDragOperation.current = false;
      touchStartX.current = null;
      touchStartY.current = null;
      touchStartElement.current = null;
      return;
    }
    if (isDragging.current) {
      isDragging.current = false;
      touchStartX.current = null;
      touchStartY.current = null;
      touchStartElement.current = null;
      return;
    }
    if (touchStartX.current === null || touchStartY.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX.current;
    const diffY = touchEndY - touchStartY.current;
    const minSwipeDistance = 50;
    if (Math.abs(diffY) > Math.abs(diffX) && diffY > minSwipeDistance) {
      let canClose = true;
      if (touchStartElement.current && modalContainerRef.current) {
        let currentElement: HTMLElement | null = touchStartElement.current;
        while (currentElement && currentElement !== modalContainerRef.current) {
          const style = window.getComputedStyle(currentElement);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll';
          if (isScrollable) {
            const hasVerticalScroll = currentElement.scrollHeight > currentElement.clientHeight;
            const isAtTopEdge = currentElement.scrollTop <= 1;
            if (hasVerticalScroll && !isAtTopEdge) {
              canClose = false;
              break;
            }
          }
          currentElement = currentElement.parentElement;
        }
        if (canClose && modalContainerRef.current) {
          const mc = modalContainerRef.current;
          if (mc.scrollHeight > mc.clientHeight && mc.scrollTop > 1) canClose = false;
        }
      }
      if (canClose) {
        onRequestCloseModalRef?.current?.();
      }
      touchStartX.current = null;
      touchStartY.current = null;
      touchStartElement.current = null;
      return;
    }
    touchStartX.current = null;
    touchStartY.current = null;
    touchStartElement.current = null;
  }, [onRequestCloseModalRef]);

  return {
    taskForm,
    setTaskForm,
    showDescriptionField,
    setShowDescriptionField,
    selectedTaskFiles,
    setSelectedTaskFiles,
    isUploadingFiles,
    taskFileInputRef,
    isSubtaskInputVisible,
    setIsSubtaskInputVisible,
    newSubtaskTitle,
    setNewSubtaskTitle,
    isStartDateExpanded,
    setIsStartDateExpanded,
    isStartTimeExpanded,
    setIsStartTimeExpanded,
    isEndDateExpanded,
    setIsEndDateExpanded,
    isEndTimeExpanded,
    setIsEndTimeExpanded,
    startDateRef,
    startTimeRef,
    endDateRef,
    endTimeRef,
    isClientDropdownOpen,
    setIsClientDropdownOpen,
    clientDropdownRef,
    isCategoryDropdownOpen,
    setIsCategoryDropdownOpen,
    categoryDropdownRef,
    isPhoneSearchOpen,
    setIsPhoneSearchOpen,
    phoneSearchRef,
    colorPalette,
    setColorPalette,
    isColorModalOpen,
    setIsColorModalOpen,
    isColorPaletteModalOpen,
    setIsColorPaletteModalOpen,
    newColorHex,
    setNewColorHex,
    carouselSlide,
    setCarouselSlide,
    isDraftLoaded,
    setIsDraftLoaded,
    noteIdToDelete,
    setNoteIdToDelete,
    taskCategoryFilter,
    setTaskCategoryFilter,
    taskCategoryById,
    setTaskCategoryById,
    modalTaskChecked,
    setModalTaskChecked,
    draggedOverQuadrant,
    setDraggedOverQuadrant,
    modalContainerRef,
    touchStartX,
    touchStartY,
    isDragging,
    isDragOperation,
    touchStartElement,
    recentlyChangedCategoriesRef,
    modalTaskCategories: MODAL_TASK_CATEGORIES,
    modalTasksCategoriesByIndex: MODAL_TASKS_CATEGORIES_BY_INDEX,
    mapBackendTaskToCategory,
    transformTaskToModalData,
    modalTasksData,
    filteredModalTasksData,
    createBackendTask,
    handleCreateTask,
    resetTaskForm,
    formatFileSize,
    handleTaskFileSelect,
    handleRemoveTaskFile,
    handleAddSubtask,
    handleToggleSubtask,
    handleRemoveSubtask,
    editingSubtaskIndex,
    setEditingSubtaskIndex,
    editingSubtaskTitle,
    setEditingSubtaskTitle,
    handleStartEditSubtask,
    handleStartAddSubtask,
    handleSaveEditSubtask,
    handleCancelEditSubtask,
    handleTouchStart,
    handleTouchEnd,
    handleTaskDragStart,
    handleTaskDrop,
    handleTaskDragEnd,
    allowDrop,
  };
}

export type UseCrmTaskFormReturn = ReturnType<typeof useCrmTaskForm>;
