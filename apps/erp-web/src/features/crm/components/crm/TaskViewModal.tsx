import React, { useRef, useEffect, useState, memo } from 'react';
import { useI18n } from '@/i18n';
// import { useSearchParams } from 'react-router-dom';
import { TaskStatus, TaskPriority, type Task, type TaskFile, type Subtask, type Lead, type UpdateTaskDto } from '../../services/api';
import { crmTaskService } from '../../services/crmTasksV2';
import { useDisableScroll } from '../../hooks/useDisableScroll';
import Calendar from './Calendar';
import { ColorModal } from './modals/ColorModal';
import { ColorPaletteModal } from './modals/ColorPaletteModal';
import Tooltip from '../common/Tooltip';
import { TimePickerDropdown } from './common/TimePickerDropdown';
import { formatLocalDateTime, parseDateFromAPI } from '../../utils/dateUtils';
import { 
  FileText, 
  Image as ImageIcon, 
  File, 
  Music, 
  Video, 
  Archive, 
  FileSpreadsheet
} from 'lucide-react';

interface TaskViewModalProps {
  task?: Task;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTaskStatus?: (taskId: string, status: TaskStatus) => Promise<void>;
  onTaskUpdate?: (updatedTask: Task) => void;
  onTaskRestored?: (restoredTask: Task) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateTaskEndDate?: (taskId: string, endDate: string | undefined) => Promise<void>;
  colorPalette?: string[];
  setColorPalette?: (palette: string[] | ((prev: string[]) => string[])) => void;
  isColorModalOpen?: boolean;
  setIsColorModalOpen?: (open: boolean) => void;
  isColorPaletteModalOpen?: boolean;
  setIsColorPaletteModalOpen?: (open: boolean) => void;
  newColorHex?: string;
  setNewColorHex?: (hex: string) => void;
}

const TaskViewModalComponent: React.FC<TaskViewModalProps> = ({
  task,
  isOpen,
  onClose,
  onUpdateTaskStatus,
  onTaskUpdate,
  onTaskRestored: _onTaskRestored,
  onDeleteTask,
  onUpdateTaskEndDate,
  colorPalette: externalColorPalette,
  setColorPalette: externalSetColorPalette,
  isColorModalOpen: externalIsColorModalOpen,
  setIsColorModalOpen: externalSetIsColorModalOpen,
  isColorPaletteModalOpen: externalIsColorPaletteModalOpen,
  setIsColorPaletteModalOpen: externalSetIsColorPaletteModalOpen,
  newColorHex: externalNewColorHex,
  setNewColorHex: externalSetNewColorHex,
}) => {
  const { t } = useI18n();
  // const [searchParams, setSearchParams] = useSearchParams();
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartElement = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [editingSubtaskIndex, setEditingSubtaskIndex] = useState<number | 'new' | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [originalDescription, setOriginalDescription] = useState<string>('');
  const [isUpdatingDescription, setIsUpdatingDescription] = useState(false);
  const [title, setTitle] = useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [originalTitle, setOriginalTitle] = useState<string>('');
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState(false);
  // Используем внешнюю палитру, если передана, иначе локальную (та же палитра что в PageCrmFullDesign)
  const excelColorPalette = [
    '#FFFFFF', '#000000', '#EEECE1', '#1F497D', '#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646',
    '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#800000', '#008000', '#008080', '#000080', '#800080',
    '#808000', '#C0C0C0', '#808080', '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC',
    '#CCCCFF', '#00CCFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99', '#3366FF', '#33CCCC',
    '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696', '#003366', '#339966', '#003300', '#333300',
    '#993300', '#333399', '#333333'
  ];
  const [localColorPalette, setLocalColorPalette] = useState<string[]>(excelColorPalette);
  const [localNewColorHex, setLocalNewColorHex] = useState('#169600');
  const [localIsColorModalOpen, setLocalIsColorModalOpen] = useState(false);
  const [localIsColorPaletteModalOpen, setLocalIsColorPaletteModalOpen] = useState(false);
  
  const colorPalette = externalColorPalette || localColorPalette;
  const setColorPalette = externalSetColorPalette || setLocalColorPalette;
  const newColorHex = externalNewColorHex !== undefined ? externalNewColorHex : localNewColorHex;
  const setNewColorHex = externalSetNewColorHex || setLocalNewColorHex;
  const isColorModalOpen = externalIsColorModalOpen !== undefined ? externalIsColorModalOpen : localIsColorModalOpen;
  const setIsColorModalOpen = externalSetIsColorModalOpen || setLocalIsColorModalOpen;
  const isColorPaletteModalOpen = externalIsColorPaletteModalOpen !== undefined ? externalIsColorPaletteModalOpen : localIsColorPaletteModalOpen;
  const setIsColorPaletteModalOpen = externalSetIsColorPaletteModalOpen || setLocalIsColorPaletteModalOpen;
  const [isDatesPickerOpen, setIsDatesPickerOpen] = useState(false);
  const [datesMenuPosition, setDatesMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const datesButtonRef = useRef<HTMLButtonElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const [isRemoveColorConfirmOpen, setIsRemoveColorConfirmOpen] = useState(false);
  const [isUrgencyPickerOpen, setIsUrgencyPickerOpen] = useState(false);
  const [isImportancePickerOpen, setIsImportancePickerOpen] = useState(false);
  const [isEndDatePickerOpen, setIsEndDatePickerOpen] = useState(false);
  const [isEndDateCalendarOpen, setIsEndDateCalendarOpen] = useState(false);
  const [isCategoryPickerOpen, setIsCategoryPickerOpen] = useState(false);
  const [isColorDropdownOpen, setIsColorDropdownOpen] = useState(false);
  const colorDropdownRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([]);
  const [categoriesMap, setCategoriesMap] = useState<Map<number, string>>(new Map());
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [isStartDatePickerOpen, setIsStartDatePickerOpen] = useState(false);
  const [isStartDateCalendarOpen, setIsStartDateCalendarOpen] = useState(false);
  const [endDate, setEndDate] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [isClientPickerOpen, setIsClientPickerOpen] = useState(false);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [leadsMap, setLeadsMap] = useState<Map<string, Lead>>(new Map());
  const [isUnsavedChangesModalOpen, setIsUnsavedChangesModalOpen] = useState(false);
  const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null);

  const startTimeRef = useRef<HTMLDivElement>(null);
  const startDateRef = useRef<HTMLDivElement>(null);
  const endDateRef = useRef<HTMLDivElement>(null);
  const endTimeRef = useRef<HTMLDivElement>(null);
  
  // Флаги для отслеживания активного редактирования времени
  const isEditingStartTimeRef = useRef(false);
  const isEditingEndTimeRef = useRef(false);
  const lastSavedStartDateTimeRef = useRef<string | null>(null);
  const lastSavedEndDateTimeRef = useRef<string | null>(null);

  useDisableScroll(isOpen || isDeleteConfirmModalOpen || isColorPaletteModalOpen || isColorModalOpen || isRemoveColorConfirmOpen || isUrgencyPickerOpen || isImportancePickerOpen || isStartDatePickerOpen || isEndDatePickerOpen || isCategoryPickerOpen || isClientPickerOpen || isClientModalOpen || isUnsavedChangesModalOpen || isDatesPickerOpen || isColorDropdownOpen);

  // Хелперы для категорий
  const isPersonalCat = (c: string) => c === t('taskViewModal.personalTasks');
  const isWorkCat = (c: string) => c === t('taskViewModal.workTasks');
  const isCallCat = (c: string) => c === t('taskViewModal.call');
  const isMeetingCat = (c: string) => c === t('taskViewModal.meeting');

  // Утилита: максимум две уникальные категории + исключающие пары (звонок/встреча и рабочая/личная - взаимоисключающие)
  const sanitizeCategories = (cats?: string[] | null) => {
    if (!cats || !Array.isArray(cats)) return [];
    const unique = Array.from(new Set(cats.filter(Boolean)));
    
    // Убираем взаимоисключающие: звонок/встреча и рабочая/личная
    let result: string[] = [];
    const hasCall = unique.some(isCallCat);
    const hasMeeting = unique.some(isMeetingCat);
    const hasWork = unique.some(isWorkCat);
    const hasPersonal = unique.some(isPersonalCat);

    // Если есть и звонок, и встреча - оставляем только первый найденный
    if (hasCall && hasMeeting) {
      const callIndex = unique.findIndex(isCallCat);
      const meetingIndex = unique.findIndex(isMeetingCat);
      if (callIndex < meetingIndex) {
        result = unique.filter(c => !isMeetingCat(c));
      } else {
        result = unique.filter(c => !isCallCat(c));
      }
    } else {
      result = [...unique];
    }
    
    // Если есть и рабочая, и личная - оставляем только последнюю выбранную
    if (hasWork && hasPersonal) {
      const workIndex = result.findIndex(isWorkCat);
      const personalIndex = result.findIndex(isPersonalCat);
      if (workIndex < personalIndex) {
        result = result.filter(c => !isWorkCat(c));
      } else {
        result = result.filter(c => !isPersonalCat(c));
      }
      }

    // Ограничиваем максимум 2 категории (API ограничение)
    if (result.length > 2) {
      result = result.slice(0, 2);
    }

    return result;
  };

  useEffect(() => {
    if (isOpen && task?._id) {
      // Сбрасываем флаги редактирования при открытии модалки или изменении задачи
      isEditingStartTimeRef.current = false;
      isEditingEndTimeRef.current = false;
      lastSavedStartDateTimeRef.current = null;
      lastSavedEndDateTimeRef.current = null;
      
      loadTaskFiles();
      setSubtasks(task.subtasks || []);
      const taskDescription = task.description || '';
      setDescription(taskDescription);
      setOriginalDescription(taskDescription);
      const taskTitle = task.title || '';
      setTitle(taskTitle);
      setOriginalTitle(taskTitle);
      
      
      
      // Инициализация даты и времени начала
      // Не перезаписываем, если пользователь активно редактирует время
      if (task.startDate && !isEditingStartTimeRef.current) {
        const taskStartDateStr = task.startDate;
        // Проверяем, изменилась ли дата/время на сервере
        if (lastSavedStartDateTimeRef.current !== taskStartDateStr) {
          // ПРАВИЛЬНО: Парсим дату из API (обрабатывает как с timezone, так и без)
          const localDate = parseDateFromAPI(task.startDate);
          if (!localDate) {
            console.error('Failed to parse startDate:', task.startDate);
            return;
          }
          
          // Извлекаем дату из локального времени
          const year = localDate.getFullYear();
          const month = String(localDate.getMonth() + 1).padStart(2, '0');
          const day = String(localDate.getDate()).padStart(2, '0');
          const newStartDate = `${year}-${month}-${day}`;
          setStartDate(newStartDate);
          
          // Извлекаем время из локального Date объекта (правильно конвертированного из UTC)
          const hours = String(localDate.getHours()).padStart(2, '0');
          const minutes = String(localDate.getMinutes()).padStart(2, '0');
          
          const newStartTime = `${hours}:${minutes}`;
          setStartTime(newStartTime);
          lastSavedStartDateTimeRef.current = taskStartDateStr;
        }
      } else if (!task.startDate && !isEditingStartTimeRef.current) {
        setStartDate('');
        setStartTime('');
        lastSavedStartDateTimeRef.current = null;
      }

      // Инициализация даты и времени окончания
      // Не перезаписываем, если пользователь активно редактирует время
      if (task.endDate && !isEditingEndTimeRef.current) {
        const taskEndDateStr = task.endDate;
        // Проверяем, изменилась ли дата/время на сервере
        if (lastSavedEndDateTimeRef.current !== taskEndDateStr) {
          // ПРАВИЛЬНО: Парсим дату из API (обрабатывает как с timezone, так и без)
          const localDate = parseDateFromAPI(task.endDate);
          if (!localDate) {
            console.error('Failed to parse endDate:', task.endDate);
            return;
          }
          
          // Извлекаем дату из локального времени
          const year = localDate.getFullYear();
          const month = String(localDate.getMonth() + 1).padStart(2, '0');
          const day = String(localDate.getDate()).padStart(2, '0');
          const newEndDate = `${year}-${month}-${day}`;
          setEndDate(newEndDate);
          
          // Извлекаем время из локального Date объекта (правильно конвертированного из UTC)
          const hours = String(localDate.getHours()).padStart(2, '0');
          const minutes = String(localDate.getMinutes()).padStart(2, '0');
          
          const newEndTime = `${hours}:${minutes}`;
          setEndTime(newEndTime);
          lastSavedEndDateTimeRef.current = taskEndDateStr;
        }
      } else if (!task.endDate && !isEditingEndTimeRef.current) {
        setEndDate('');
        setEndTime('');
        lastSavedEndDateTimeRef.current = null;
      }
    }
    // Добавляем task?.startDate и task?.endDate в зависимости, чтобы состояние обновлялось при изменении дат с сервера
  }, [isOpen, task?._id, task?.subtasks, task?.description, task?.title, task?.startDate, task?.endDate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (startDateRef.current && !startDateRef.current.contains(event.target as Node)) {
        setIsStartDatePickerOpen(false);
      }
      if (endDateRef.current && !endDateRef.current.contains(event.target as Node)) {
        setIsEndDatePickerOpen(false);
      }
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(event.target as Node)) {
        setIsColorDropdownOpen(false);
      }
    };

    if (isStartDatePickerOpen || isEndDatePickerOpen || isColorDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isStartDatePickerOpen, isEndDatePickerOpen, isColorDropdownOpen]);

  // Загрузка лидов при открытии модального окна и при обновлении задачи
  useEffect(() => {
    const loadLeads = async () => {
      try {
        const response = await crmTaskService.getLeads();
        if (response.success && response.data) {
          const leadsMap = new Map<string, Lead>();
          response.data.items.forEach((lead: Lead) => {
            leadsMap.set(lead._id, lead);
          });
          setLeadsMap(leadsMap);
        }
      } catch (error) {
        console.error(t('taskViewModal.errorLoadingLeads'), error);
      }
    };

    if (isOpen) {
      loadLeads();
    }
  }, [isOpen, task?.leadId]); // Перезагружаем лиды при изменении leadId задачи

  // Загрузка категорий при открытии модального окна
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await crmTaskService.getTaskCategories();
        if (response.success && response.data) {
          // Фиксированные категории задач
          const fixedCategories = [t('taskViewModal.call'), t('taskViewModal.meeting'), t('taskViewModal.personalTasks'), t('taskViewModal.workTasks')];
          
          // Создаем массив категорий с их ID из БД
          const categoriesList: { key: string; label: string }[] = [];
          
          response.data.forEach(cat => {
            // Проверяем, является ли категория одной из фиксированных
            const isFixedCategory = fixedCategories.some(fixedCat => 
              cat.name.toLowerCase().includes(fixedCat.toLowerCase()) || 
              fixedCat.toLowerCase().includes(cat.name.toLowerCase())
            );
            
            if (isFixedCategory) {
              categoriesList.push({
                key: cat.id.toString(),
                label: cat.name
              });
            }
          });
          
          // Сортируем категории в нужном порядке
          const sortedCategories = fixedCategories.map(fixedCat => {
            const found = categoriesList.find(cat => 
              cat.label.toLowerCase().includes(fixedCat.toLowerCase()) || 
              fixedCat.toLowerCase().includes(cat.label.toLowerCase())
            );
            return found || null;
          }).filter(Boolean) as { key: string; label: string }[];
          
          // Если фиксированной категории нет в БД, создаем её
          for (const fixedCat of fixedCategories) {
            const exists = sortedCategories.find(cat => 
              cat.label.toLowerCase().includes(fixedCat.toLowerCase()) || 
              fixedCat.toLowerCase().includes(cat.label.toLowerCase())
            );
            if (!exists) {
              try {
                const createResponse = await crmTaskService.getOrCreateTaskCategory(fixedCat);
                if (createResponse.success && createResponse.data) {
                  sortedCategories.push({
                    key: createResponse.data.id.toString(),
                    label: createResponse.data.name
                  });
                }
              } catch (error) {
                console.error(t('taskViewModal.errorCreatingCategoryFixedcat'), error);
              }
            }
          }
          
          // Используем только фиксированные категории
          setCategories(sortedCategories);
          
          // Заполняем Map для быстрого поиска названия по ID
          const map = new Map<number, string>();
          response.data.forEach(cat => {
            map.set(cat.id, cat.name);
          });
          setCategoriesMap(map);
        }
      } catch (error) {
        console.error(t('taskViewModal.errorLoadingCategories'), error);
      }
    };

    if (isOpen) {
      loadCategories();
    }
  }, [isOpen]);

  // Синхронизируем выбранные категории при загрузке задачи или справочника
  useEffect(() => {
    const normalized = sanitizeCategories(task?.categories as string[] | undefined);
    if (normalized.length > 0) {
      setSelectedCategories(normalized);
      return;
    }

    if (task?.category && categoriesMap.size > 0) {
      const name = categoriesMap.get(task.category);
      setSelectedCategories(sanitizeCategories(name ? [name] : []));
    } else {
      setSelectedCategories([]);
    }
  }, [task?._id, task?.categories, task?.category, categoriesMap]);

  const loadTaskFiles = async () => {
    if (!task?._id) return;
    
    try {
      const response = await crmTaskService.getTaskFiles(task._id);
      if (response.success && response.data) {
        setFiles(response.data.files);
      }
    } catch (error) {
      // Ошибка загрузки файлов
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !task?._id) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const filesArray = Array.from(selectedFiles);
      

      if (filesArray.length > 10) {
        setUploadError(t('taskViewModal.canUploadAMaximumOf10FilesAtAT'));
        setIsUploading(false);
        return;
      }

      const response = await crmTaskService.uploadTaskFiles(task._id, filesArray);
      
      if (response.success) {
        await loadTaskFiles();
        // Обновляем задачу, если есть callback
        if (onTaskUpdate) {
          const taskResponse = await crmTaskService.getTask(task._id);
          if (taskResponse.success && taskResponse.data) {
            onTaskUpdate(taskResponse.data);
          }
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch (error: any) {
      setUploadError(error.response?.data?.message || t('taskViewModal.errorWhileDownloadingFiles'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteFile = async (filename: string) => {
    if (!task?._id) return;
    
    try {
      const response = await crmTaskService.deleteTaskFileByName(task._id, filename);
      if (response.success) {
        await loadTaskFiles();
        if (onTaskUpdate && response.data?.task) onTaskUpdate(response.data.task);
      }
    } catch (error) {
      // Ошибка удаления файла
    }
  };

  // Файл открывается по временной ссылке хранилища; filename у файла задачи — это assetId.
  const handleDownloadFile = async (file: TaskFile) => {
    if (!task?._id) return;
    try {
      const { url } = await crmTaskService.getAttachmentUrl(task._id, file.filename);
      window.open(url, '_blank', 'noopener');
    } catch {
      alert(t('taskViewModal.errorWhileDownloadingFiles'));
    }
  };

  const getFileIcon = (mimeType: string, size: number = 20) => {
    const iconProps = { size, className: 'flex-shrink-0' };
    
    if (mimeType.includes('pdf')) {
      return <FileText {...iconProps} className="text-red-600" />;
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('xls') || mimeType.includes('xlsx')) {
      return <FileSpreadsheet {...iconProps} className="text-green-600" />;
    } else if (mimeType.includes('word') || mimeType.includes('document') || mimeType.includes('doc') || mimeType.includes('docx')) {
      return <FileText {...iconProps} className="text-[#b4ccc3]" />;
    } else if (mimeType.includes('image')) {
      return <ImageIcon {...iconProps} className="text-yellow-500" />;
    } else if (mimeType.includes('audio') || mimeType.includes('mp3') || mimeType.includes('wav') || mimeType.includes('ogg')) {
      return <Music {...iconProps} className="text-purple-600" />;
    } else if (mimeType.includes('video') || mimeType.includes('mp4') || mimeType.includes('avi') || mimeType.includes('mov')) {
      return <Video {...iconProps} className="text-pink-600" />;
    } else if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive') || mimeType.includes('7z')) {
      return <Archive {...iconProps} className="text-orange-600" />;
    }
    return <File {...iconProps} className="text-gray-600" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Декодирование имени файла
  const decodeFileName = (filename: string): string => {
    try {
      // Пытаемся декодировать как URI компонент
      const decoded = decodeURIComponent(filename);
      return decoded;
    } catch (e) {
      // Если не получилось, пробуем другой метод
      try {
        // Пытаемся декодировать байты UTF-8
        return decodeURIComponent(escape(filename));
      } catch (e2) {
        // Если ничего не помогло, возвращаем оригинал
        return filename;
      }
    }
  };

  // Subtask handlers
  const handleToggleSubtask = async (index: number) => {
    if (!task?._id) return;

    try {
      const currentSubtask = subtasks[index];
      const newCompleted = !currentSubtask.completed;
      
      const previousSubtasks = [...subtasks];
      
      const optimisticSubtasks = subtasks.map((st, i) => 
        i === index ? { ...st, completed: newCompleted } : st
      );
      setSubtasks(optimisticSubtasks);
      
      const response = await crmTaskService.updateSubtaskStatus(task._id, index, newCompleted);
      
      if (response.success && response.data) {
        setSubtasks(response.data.subtasks || []);
        if (onTaskUpdate) onTaskUpdate(response.data);
      } else {
        setSubtasks(previousSubtasks);
      }
    } catch (error: any) {
      const previousSubtasks = subtasks.map((st, i) => 
        i === index ? { ...st, completed: !st.completed } : st
      );
      setSubtasks(previousSubtasks);
      
      // @ts-ignore
      const errorMessage = error.response?.data?.message || t('taskViewModal.failedToChangeSubtaskStatus');
      alert(t('taskViewModal.errorErrormessage'));
    }
  };

  const handleDeleteSubtask = async (index: number) => {
    if (!task?._id) return;

    try {
      const previousSubtasks = [...subtasks];

      const optimisticSubtasks = subtasks.filter((_, i) => i !== index);
      setSubtasks(optimisticSubtasks);
      
      const response = await crmTaskService.deleteSubtask(task._id, index);
      
      if (response.success && response.data) {
        setSubtasks(response.data.subtasks || []);
        if (onTaskUpdate) onTaskUpdate(response.data);
      } else {
        setSubtasks(previousSubtasks);
      }
    } catch (error: any) {
      const restoredSubtasks = [...subtasks];
      setSubtasks(restoredSubtasks);
    }
  };

  const handleStartEditSubtask = (index: number) => {
    setEditingSubtaskIndex(index);
    setEditingSubtaskTitle(subtasks[index].title);
  };

  const handleStartAddSubtask = () => {
    setEditingSubtaskIndex('new');
    setEditingSubtaskTitle('');
  };

  const handleSaveEditSubtask = async (index: number | 'new') => {
    if (!task?._id || !editingSubtaskTitle.trim()) {
      setEditingSubtaskIndex(null);
      setEditingSubtaskTitle('');
      return;
    }

    try {
      if (index === 'new') {
        // Добавление новой подзадачи
        const newSubtask: Subtask = {
          title: editingSubtaskTitle.trim(),
          completed: false,
        };

        const previousSubtasks = [...subtasks];
        const optimisticSubtasks = [...subtasks, newSubtask];
        setSubtasks(optimisticSubtasks);
        setEditingSubtaskIndex(null);
        setEditingSubtaskTitle('');

        const response = await crmTaskService.addSubtask(task._id, newSubtask);
        
        if (response.success && response.data) {
          setSubtasks(response.data.subtasks || []);
          if (onTaskUpdate) onTaskUpdate(response.data);
        } else {
          setSubtasks(previousSubtasks);
        }
      } else {
        // Редактирование существующей подзадачи
        const previousSubtasks = [...subtasks];
        const updatedSubtasks = subtasks.map((st, i) => 
          i === index ? { ...st, title: editingSubtaskTitle.trim() } : st
        );
        setSubtasks(updatedSubtasks);
        setEditingSubtaskIndex(null);
        setEditingSubtaskTitle('');

        const response = await crmTaskService.updateTask(task._id, {
          subtasks: updatedSubtasks.map(st => ({ title: st.title, completed: st.completed ?? false }))
        });
        
        if (response.success && response.data) {
          setSubtasks(response.data.subtasks || updatedSubtasks);
          if (onTaskUpdate) onTaskUpdate(response.data);
        } else {
          setSubtasks(previousSubtasks);
        }
      }
    } catch (error: any) {
      const restoredSubtasks = [...subtasks];
      setSubtasks(restoredSubtasks);
      setEditingSubtaskIndex(index);
      setEditingSubtaskTitle(editingSubtaskTitle);
    }
  };

  const handleCancelEditSubtask = () => {
    setEditingSubtaskIndex(null);
    setEditingSubtaskTitle('');
  };

  const handleUpdateDescription = async (newDescription: string) => {
    if (!task?._id) return;

    try {
      setIsUpdatingDescription(true);
      const response = await crmTaskService.updateTask(task._id, { description: newDescription });
      
      if (response.success && response.data) {
        setDescription(newDescription);
        setOriginalDescription(newDescription);
        setIsEditingDescription(false);
        if (onTaskUpdate) onTaskUpdate(response.data);
      } else {
        setDescription(originalDescription);
      }
    } catch (error: any) {
      setDescription(originalDescription);
    } finally {
      setIsUpdatingDescription(false);
    }
  };

  const handleUpdateTitle = async (newTitle: string) => {
    if (!task?._id) return;

    try {
      setIsUpdatingTitle(true);
      const response = await crmTaskService.updateTask(task._id, { title: newTitle });
      
      if (response.success && response.data) {
        setTitle(newTitle);
        setOriginalTitle(newTitle);
        setIsEditingTitle(false);
        if (onTaskUpdate) onTaskUpdate(response.data);
      } else {
        setTitle(originalTitle);
      }
    } catch (error: any) {
      setTitle(originalTitle);
    } finally {
      setIsUpdatingTitle(false);
    }
  };

  const handleStartEditTitle = () => {
    setOriginalTitle(title);
    setIsEditingTitle(true);
  };

  const handleCancelEditTitle = () => {
    setTitle(originalTitle);
    setIsEditingTitle(false);
  };

  const handleSaveTitle = () => {
    if (title !== originalTitle && title.trim()) {
      handleUpdateTitle(title.trim());
    } else {
      setIsEditingTitle(false);
    }
  };

  const handleStartEditDescription = () => {
    setOriginalDescription(description);
    setIsEditingDescription(true);
  };

  const handleCancelEditDescription = () => {
    setDescription(originalDescription);
    setIsEditingDescription(false);
  };

  const handleSaveDescription = () => {
    if (description !== originalDescription) {
      handleUpdateDescription(description);
    } else {
      setIsEditingDescription(false);
    }
  };

  // Сохранение состояния редактирования в URL
  

  const handleDeleteTask = () => {
    if (!task?._id || !onDeleteTask) {
      return;
    }

    // Закрываем модалки сразу - задача исчезнет сразу (оптимистичное обновление)
    setIsDeleteConfirmModalOpen(false);
    onClose();
    
    // Вызываем onDeleteTask без await - удаление произойдет в фоне
    onDeleteTask(task._id).catch(() => {
      // Ошибка удаления задачи
    });
  };

  // Принудительное закрытие без проверки несохраненных изменений
  const handleForceClose = () => {
    // Отменяем все несохраненные изменения
    if (isEditingTitle) {
      setTitle(originalTitle);
      setIsEditingTitle(false);
    }
    if (isEditingDescription) {
      setDescription(originalDescription);
      setIsEditingDescription(false);
    }
    setIsUnsavedChangesModalOpen(false);
    setPendingCloseAction(null);
    // Важно: вызываем onClose в конце, чтобы закрыть основную модалку
    onClose();
  };

  // Сохранить изменения и закрыть
  const handleSaveAndClose = async () => {
    const closeAction = pendingCloseAction;
    setIsUnsavedChangesModalOpen(false);
    
    try {
      // Сохраняем название, если есть изменения
      if (isEditingTitle && title.trim() !== originalTitle && title.trim()) {
        await handleUpdateTitle(title.trim());
      }
      
      // Сохраняем описание, если есть изменения
      if (isEditingDescription && description !== originalDescription) {
        await handleUpdateDescription(description);
      }
      
      if (closeAction) {
        closeAction();
        setPendingCloseAction(null);
      }
    } catch (error) {
      // Если произошла ошибка, показываем модалку снова
      setIsUnsavedChangesModalOpen(true);
      setPendingCloseAction(() => closeAction || null);
    }
  };

  // Отменить изменения и закрыть
  const handleDiscardChanges = () => {
    setIsUnsavedChangesModalOpen(false);
    
    // Отменяем все несохраненные изменения
    if (isEditingTitle) {
      setTitle(originalTitle);
      setIsEditingTitle(false);
    }
    if (isEditingDescription) {
      setDescription(originalDescription);
      setIsEditingDescription(false);
    }
    
    // Всегда вызываем onClose, даже если pendingCloseAction не установлен
    if (pendingCloseAction) {
      pendingCloseAction();
      setPendingCloseAction(null);
    } else {
      onClose();
    }
  };

  const handleUpdateColorLabel = async (colorLabel: string | undefined) => {
    if (!task?._id) return;

    try {
      // Если colorLabel undefined, передаем null явно через any для удаления
      // Бэкенд должен обработать null как удаление поля
      const updateData: any = colorLabel === undefined 
        ? { colorLabel: null } 
        : { colorLabel };
      const response = await crmTaskService.updateTask(task._id, updateData);
      if (response.success && response.data) {
        if (onTaskUpdate) onTaskUpdate(response.data);
      } else {
        alert(t('taskViewModal.failedToUpdateColorLabelTryAga'));
      }
    } catch (error: any) {
      alert(t('taskViewModal.errorUpdatingColorLabelTryAgai'));
    }
  };

  const handleUpdateUrgency = async (isUrgent: boolean) => {
    if (!task?._id) return;

    try {
      // Определяем текущий importance из priority
      const isImportant = task.priority === TaskPriority.URGENT_IMPORTANT || 
                         task.priority === TaskPriority.NOT_URGENT_IMPORTANT;
      
      // Формируем новый priority на основе нового urgency и текущего importance
      let newPriority: TaskPriority;
      if (isUrgent && isImportant) {
        newPriority = TaskPriority.URGENT_IMPORTANT;
      } else if (!isUrgent && isImportant) {
        newPriority = TaskPriority.NOT_URGENT_IMPORTANT;
      } else if (isUrgent && !isImportant) {
        newPriority = TaskPriority.URGENT_NOT_IMPORTANT;
      } else {
        newPriority = TaskPriority.NOT_URGENT_NOT_IMPORTANT;
      }

      const response = await crmTaskService.updateTask(task._id, { priority: newPriority });
      
      if (response.success && response.data) {
        if (onTaskUpdate) onTaskUpdate(response.data);
        setIsUrgencyPickerOpen(false);
      } else {
        alert(t('taskViewModal.failedToUpdatePriorityTryAgain'));
      }
    } catch (error: any) {
      alert(t('taskViewModal.errorUpdatingPriorityTryAgain'));
    }
  };

  const handleUpdateImportance = async (isImportant: boolean) => {
    if (!task?._id) return;

    try {
      // Определяем текущий urgency из priority
      const isUrgent = task.priority === TaskPriority.URGENT_IMPORTANT || 
                      task.priority === TaskPriority.URGENT_NOT_IMPORTANT;
      
      // Формируем новый priority на основе текущего urgency и нового importance
      let newPriority: TaskPriority;
      if (isUrgent && isImportant) {
        newPriority = TaskPriority.URGENT_IMPORTANT;
      } else if (!isUrgent && isImportant) {
        newPriority = TaskPriority.NOT_URGENT_IMPORTANT;
      } else if (isUrgent && !isImportant) {
        newPriority = TaskPriority.URGENT_NOT_IMPORTANT;
      } else {
        newPriority = TaskPriority.NOT_URGENT_NOT_IMPORTANT;
      }

      const response = await crmTaskService.updateTask(task._id, { priority: newPriority });
      
      if (response.success && response.data) {
        if (onTaskUpdate) onTaskUpdate(response.data);
        setIsImportancePickerOpen(false);
      } else {
        alert(t('taskViewModal.failedToUpdatePriorityTryAgain'));
      }
    } catch (error: any) {
      alert(t('taskViewModal.errorUpdatingPriorityTryAgain'));
    }
  };

  const handleUpdateCategories = async (nextCategories: string[]) => {
    if (!task?._id) return;
    const normalized = sanitizeCategories(nextCategories);

    try {
      // Выбираем categoryId (старая система) — берем первую из фиксированных work/personal при наличии
      let categoryId: number | undefined = undefined;
      const preferred = normalized.find((c) => c === t('taskViewModal.workTasks') || c === t('taskViewModal.personalTasks'));
      if (preferred) {
        const matched = categories.find((cat) => cat.label === preferred);
        if (matched) {
          const parsedId = parseInt(matched.key);
          categoryId = isNaN(parsedId) ? undefined : parsedId;
        }
      }

      const response = await crmTaskService.updateTask(task._id, { category: categoryId, categories: normalized });
      
      if (response.success && response.data) {
        setSelectedCategories(normalized);
        if (onTaskUpdate) onTaskUpdate(response.data);
        // Не закрываем список при обновлении - закрывается только при клике вне списка
      } else {
        alert(t('taskViewModal.failedToUpdateCategoriesTryAga'));
      }
    } catch (error: any) {
      alert(t('taskViewModal.errorUpdatingCategoriesTryAgai'));
    }
  };


  const handleUpdateClient = async (leadId: string) => {
    if (!task?._id) return;

    try {
      // Если leadId пустой, отправляем null для отвязки лида
      const updateData: UpdateTaskDto = leadId.trim() === '' 
        ? { leadId: null } 
        : { leadId: leadId.trim() };
      
      const response = await crmTaskService.updateTask(task._id, updateData);
      
      if (response.success && response.data) {
        // Перезагружаем лиды, чтобы обновить отображение
        try {
          const leadsResponse = await crmTaskService.getLeads();
          if (leadsResponse.success && leadsResponse.data) {
            const newLeadsMap = new Map<string, Lead>();
            leadsResponse.data.items.forEach((lead: Lead) => {
              newLeadsMap.set(lead._id, lead);
            });
            setLeadsMap(newLeadsMap);
          }
        } catch (error) {
          console.error(t('taskViewModal.errorReloadingLeads'), error);
        }
        
        if (onTaskUpdate) onTaskUpdate(response.data);
        setIsClientPickerOpen(false);
        // Закрываем модалку после успешного обновления лида
        onClose();
      } else {
        alert(t('taskViewModal.clientUpdateFailedTryAgain'));
      }
    } catch (error: any) {
      console.error('Error updating task leadId:', error);
      alert(t('taskViewModal.errorUpdatingClientTryAgain'));
    }
  };

  const handleAddClient = () => {
    // Удалено: теперь используем лиды из бэкенда
    // Новые лиды создаются через модуль лидов
    alert(t('taskViewModal.toAddANewLeadUseTheLeadsModule'));
    setNewClientName('');
    setIsClientModalOpen(false);
    setIsClientPickerOpen(false);
  };

  const handleUpdateStartDate = async () => {
    if (!task?._id) {
      console.error('handleUpdateStartDate: task._id отсутствует!');
      return;
    }

    // Нельзя сохранить время без даты
    if (!startDate) {
      console.error('handleUpdateStartDate: нельзя сохранить время без даты!');
      alert(t('taskViewModal.firstSelectYourStartDate'));
      return;
    }
    
    // Устанавливаем флаг редактирования
    isEditingStartTimeRef.current = true;

      // Валидация: если даты совпадают, время начала не может быть больше времени окончания
      if (task?.endDate) {
        // Извлекаем дату окончания из строки
        let endDateStr: string;
        if (task.endDate.includes('T')) {
          endDateStr = task.endDate.split('T')[0];
        } else {
          const endDateObj = parseDateFromAPI(task.endDate);
          if (!endDateObj) {
            console.error('Failed to parse endDate for validation:', task.endDate);
            return;
          }
          endDateStr = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;
        }
      
      // Проверяем, совпадают ли даты
      if (startDate === endDateStr) {
        // Извлекаем время окончания из строки
        let endTimeStr: string = '00:00';
        if (task.endDate.includes('T')) {
          const timePart = task.endDate.split('T')[1];
          const timeOnly = timePart.replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '').split('.')[0];
          const timeParts = timeOnly.split(':');
          const h = timeParts[0] ? Number(timeParts[0]) : 0;
          const m = timeParts[1] ? Number(timeParts[1]) : 0;
          endTimeStr = `${String(isNaN(h) ? 0 : h).padStart(2, '0')}:${String(isNaN(m) ? 0 : m).padStart(2, '0')}`;
        }
        
        // Получаем время начала
        const startTimeStr = startTime || '00:00';
        
        // Сравниваем время в минутах
        const [startHours, startMinutes] = startTimeStr.split(':').map(Number);
        const [endHours, endMinutes] = endTimeStr.split(':').map(Number);
        const startTimeMinutes = startHours * 60 + startMinutes;
        const endTimeMinutes = endHours * 60 + endMinutes;
        
        // Если время начала больше времени окончания - ошибка
        if (startTimeMinutes > endTimeMinutes) {
          alert(t('taskViewModal.startTimeStarttimestrCannotBeL'));
          return;
        }
      }
      
      // Проверяем, что дата начала не позже даты окончания
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDateStr);
      startDateObj.setHours(0, 0, 0, 0);
      endDateObj.setHours(0, 0, 0, 0);
      if (startDateObj > endDateObj) {
        alert(t('taskViewModal.theStartDateCannotBeLaterThanT'));
        return;
      }
    }

    try {
      // СОЗДАЕМ Date ОБЪЕКТ И ФОРМАТИРУЕМ ДЛЯ ОТПРАВКИ
      let startDateTime: string | undefined;
      if (startDate) {
        // Извлекаем дату (если это ISO строка, берем только дату)
        const dateOnly = startDate.includes('T') ? startDate.split('T')[0] : startDate;
        const timeStr = startTime || '00:00';
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        // Создаем Date объект из локального времени
        const dateObj = new Date(`${dateOnly}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
        
        if (isNaN(dateObj.getTime())) {
          alert(t('taskViewModal.invalidDateOrTime'));
          return;
        }
        
        // Форматируем БЕЗ timezone для отправки на бэкенд
        startDateTime = formatLocalDateTime(dateObj);
      }

      const response = await crmTaskService.updateTask(task._id, { startDate: startDateTime });
      
      if (response.success && response.data) {
        // Обновляем сохраненное значение
        if (response.data.startDate) {
          lastSavedStartDateTimeRef.current = response.data.startDate;
        }
        
        // Обновляем задачу через onTaskUpdate
        if (onTaskUpdate) {
          onTaskUpdate(response.data);
        }
        
        // Сбрасываем флаг редактирования после небольшой задержки
        setTimeout(() => {
          isEditingStartTimeRef.current = false;
        }, 500);
        
        // Закрываем объединенную модалку сроков
        setIsDatesPickerOpen(false);
        setDatesMenuPosition(null);
        setIsStartDateCalendarOpen(false);
      } else {
        isEditingStartTimeRef.current = false;
        alert(t('taskViewModal.failedToUpdateStartDateTryAgai'));
      }
    } catch (error: any) {
      isEditingStartTimeRef.current = false;
      console.error('Error updating start date:', error);
      alert(t('taskViewModal.errorUpdatingStartDateTryAgain'));
    }
  };

  const handleUpdateEndDate = async () => {
    if (!task?._id) {
      console.error('handleUpdateEndDate: task._id отсутствует!');
      return;
    }

    // Нельзя сохранить время без даты
    if (!endDate) {
      console.error('handleUpdateEndDate: нельзя сохранить время без даты!');
      alert(t('taskViewModal.firstSelectTheEndDate'));
      return;
    }
    
    // Устанавливаем флаг редактирования
    isEditingEndTimeRef.current = true;

    // Валидация: если даты совпадают, время окончания не может быть меньше времени начала
    const currentStartDate = startDate || (task?.startDate ? (() => {
      if (task.startDate.includes('T')) {
        return task.startDate.split('T')[0];
      } else {
        const startDateObj = parseDateFromAPI(task.startDate);
        if (!startDateObj) {
          console.error('Failed to parse startDate for validation:', task.startDate);
          return '';
        }
        return `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;
      }
    })() : '');
    
    if (currentStartDate && endDate === currentStartDate) {
      // Извлекаем время начала
      const currentStartTime = startTime || (task?.startDate ? (() => {
        if (task.startDate.includes('T')) {
          const timePart = task.startDate.split('T')[1];
          const timeOnly = timePart.replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '').split('.')[0];
          const timeParts = timeOnly.split(':');
          const h = timeParts[0] ? Number(timeParts[0]) : 0;
          const m = timeParts[1] ? Number(timeParts[1]) : 0;
          return `${String(isNaN(h) ? 0 : h).padStart(2, '0')}:${String(isNaN(m) ? 0 : m).padStart(2, '0')}`;
        }
        return '00:00';
      })() : '00:00');
      
      // Получаем время окончания
      const endTimeStr = endTime || '00:00';
      
      // Сравниваем время в минутах
      const [startHours, startMinutes] = currentStartTime.split(':').map(Number);
      const [endHours, endMinutes] = endTimeStr.split(':').map(Number);
      const startTimeMinutes = startHours * 60 + startMinutes;
      const endTimeMinutes = endHours * 60 + endMinutes;
      
      // Если время окончания меньше времени начала - ошибка
      if (endTimeMinutes < startTimeMinutes) {
        alert(t('taskViewModal.endTimeEndtimestrCannotBeEarli'));
        return;
      }
    }
    
    // Проверяем, что дата окончания не раньше даты начала
    if (currentStartDate) {
      const startDateObj = new Date(currentStartDate);
      const endDateObj = new Date(endDate);
      startDateObj.setHours(0, 0, 0, 0);
      endDateObj.setHours(0, 0, 0, 0);
      if (endDateObj < startDateObj) {
        alert(t('taskViewModal.theEndDateCannotBeEarlierThanT'));
        return;
      }
    }

    try {
      // СОЗДАЕМ Date ОБЪЕКТ И ФОРМАТИРУЕМ ДЛЯ ОТПРАВКИ
      let endDateTime: string | undefined;
      if (endDate) {
        // Извлекаем дату (если это ISO строка, берем только дату)
        const dateOnly = endDate.includes('T') ? endDate.split('T')[0] : endDate;
        const timeStr = endTime || '00:00';
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        // Создаем Date объект из локального времени
        const dateObj = new Date(`${dateOnly}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
        
        if (isNaN(dateObj.getTime())) {
          alert(t('taskViewModal.invalidDateOrTime'));
          return;
        }
        
        // Форматируем БЕЗ timezone для отправки на бэкенд
        endDateTime = formatLocalDateTime(dateObj);
      }
      
      // Используем onUpdateTaskEndDate если он передан (как в PageCrmFullDesign.tsx)
      if (onUpdateTaskEndDate) {
        try {
          await onUpdateTaskEndDate(task._id, endDateTime);
          
          // Обновляем задачу через onTaskUpdate, чтобы модалка обновилась
          // Получаем обновленную задачу с сервера после небольшой задержки
          // чтобы дать время серверу обработать запрос
          if (onTaskUpdate) {
            try {
              // Небольшая задержка, чтобы сервер успел обработать запрос
              await new Promise(resolve => setTimeout(resolve, 100));
              const response = await crmTaskService.getTask(task._id);
              if (response.success && response.data) {
                onTaskUpdate(response.data);
                // Обновляем сохраненное значение из ответа сервера
                if (response.data.endDate) {
                  lastSavedEndDateTimeRef.current = response.data.endDate;
                }
              } else {
                console.error('Failed to get updated task - response:', response);
              }
            } catch (error) {
              console.error('Failed to get updated task:', error);
              // Продолжаем выполнение, даже если не удалось получить задачу
            }
          }
          
          // Обновляем сохраненное значение
          lastSavedEndDateTimeRef.current = endDateTime || null;
          
          // Сбрасываем флаг редактирования после небольшой задержки
          setTimeout(() => {
            isEditingEndTimeRef.current = false;
          }, 500);
          
          // Локальное состояние уже обновлено выше (setEndDate, setEndTime)
          // Не нужно обновлять его снова, чтобы избежать лишних перерендеров
          
          setIsEndDatePickerOpen(false);
        } catch (error) {
          isEditingEndTimeRef.current = false;
          console.error('Error in onUpdateTaskEndDate:', error);
          throw error;
        }
      } else {
        // Fallback: используем старый способ через onTaskUpdate
        const response = await crmTaskService.updateTask(task._id, { endDate: endDateTime });
        
        if (response.success && response.data) {
          // Обновляем сохраненное значение
          if (response.data.endDate) {
            lastSavedEndDateTimeRef.current = response.data.endDate;
          }
          
          // Обновляем локальное состояние на основе ответа сервера
          if (response.data.endDate) {
            const date = new Date(response.data.endDate);
            const isUTC = response.data.endDate.includes('Z') || response.data.endDate.includes('+00:00') || response.data.endDate.endsWith('+00:00');
            
            const year = isUTC ? date.getUTCFullYear() : date.getFullYear();
            const month = String((isUTC ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, '0');
            const day = String(isUTC ? date.getUTCDate() : date.getDate()).padStart(2, '0');
            const newEndDate = `${year}-${month}-${day}`;
            setEndDate(newEndDate);
            
            const hours = String(isUTC ? date.getUTCHours() : date.getHours()).padStart(2, '0');
            const minutes = String(isUTC ? date.getUTCMinutes() : date.getMinutes()).padStart(2, '0');
            const newEndTime = `${hours}:${minutes}`;
            setEndTime(newEndTime);
          } else {
            setEndDate('');
            setEndTime('');
            lastSavedEndDateTimeRef.current = null;
          }
          
          // Сбрасываем флаг редактирования после небольшой задержки
          setTimeout(() => {
            isEditingEndTimeRef.current = false;
          }, 500);
          
          setIsEndDatePickerOpen(false);
          
          if (onTaskUpdate) {
            onTaskUpdate(response.data);
          }
        } else {
          isEditingEndTimeRef.current = false;
          console.error('Failed to update end date - server response:', response);
          alert(t('taskViewModal.failedToUpdateEndDateTryAgain'));
        }
      }
    } catch (error: any) {
      isEditingEndTimeRef.current = false;
      console.error('Failed to update end date:', error);
      console.error('Error details:', error.response?.data);
      alert(t('taskViewModal.errorUpdatingEndDateTryAgain'));
    }
  };


  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    touchStartElement.current = target;

    const scrollableContainer = target.closest('.overflow-x-auto, .overflow-y-auto');
    if (scrollableContainer) {
      const container = scrollableContainer as HTMLElement;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const hasVerticalScroll = scrollHeight > clientHeight;
      const isAtTopEdge = scrollTop <= 1;

      if (hasVerticalScroll && !isAtTopEdge) {
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }
    }

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;

    if (touchStartElement.current) {
      const scrollableContainer = touchStartElement.current.closest('.overflow-x-auto, .overflow-y-auto');
      if (scrollableContainer) {
        const container = scrollableContainer as HTMLElement;
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const hasVerticalScroll = scrollHeight > clientHeight;
        const isAtTopEdge = scrollTop <= 1;

        if (hasVerticalScroll && !isAtTopEdge) {
          touchStartX.current = null;
          touchStartY.current = null;
          touchStartElement.current = null;
          return;
        }
      }
    }

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
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                              style.overflow === 'auto' || style.overflow === 'scroll' ||
                              currentElement.classList.contains('overflow-y-auto') ||
                              currentElement.classList.contains('overflow-x-auto');

          if (isScrollable) {
            const scrollTop = currentElement.scrollTop;
            const scrollHeight = currentElement.scrollHeight;
            const clientHeight = currentElement.clientHeight;
            const hasVerticalScroll = scrollHeight > clientHeight;
            const isAtTopEdge = scrollTop <= 1;

            if (hasVerticalScroll && !isAtTopEdge) {
              canClose = false;
              break;
            }
          }

          currentElement = currentElement.parentElement;
        }

        if (canClose && modalContainerRef.current) {
          const modalContent = modalContainerRef.current;
          const scrollTop = modalContent.scrollTop;
          const scrollHeight = modalContent.scrollHeight;
          const clientHeight = modalContent.clientHeight;
          const hasVerticalScroll = scrollHeight > clientHeight;
          const isAtTopEdge = scrollTop <= 1;

          if (hasVerticalScroll && !isAtTopEdge) {
            canClose = false;
          }
        }
      } else if (modalContainerRef.current) {
        const modalContent = modalContainerRef.current;
        const scrollTop = modalContent.scrollTop;
        const scrollHeight = modalContent.scrollHeight;
        const clientHeight = modalContent.clientHeight;
        const hasVerticalScroll = scrollHeight > clientHeight;
        const isAtTopEdge = scrollTop <= 1;

        if (hasVerticalScroll && !isAtTopEdge) {
          canClose = false;
        }
      }

      if (canClose) {
        handleForceClose();
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchStartElement.current = null;
  };

  // Обработчик Escape для закрытия модалки
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleForceClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleForceClose]);

  useEffect(() => {
    if (!isOpen) return;

    const container = modalContainerRef.current;
    if (!container) return;

    const handleTouchMoveNative = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) {
        return;
      }

      const touchCurrentX = e.touches[0].clientX;
      const touchCurrentY = e.touches[0].clientY;
      const diffX = touchCurrentX - touchStartX.current;
      const diffY = touchCurrentY - touchStartY.current;

      if (Math.abs(diffX) < 5 && Math.abs(diffY) < 5) {
        return;
      }

      if (touchStartElement.current) {
        const scrollableContainer = touchStartElement.current.closest('.overflow-x-auto, .overflow-y-auto');
        if (scrollableContainer) {
          const container = scrollableContainer as HTMLElement;
          const scrollTop = container.scrollTop;
          const scrollHeight = container.scrollHeight;
          const clientHeight = container.clientHeight;
          const hasVerticalScroll = scrollHeight > clientHeight;
          const isAtTopEdge = scrollTop <= 1;

          if (hasVerticalScroll) {
            if (Math.abs(diffY) > Math.abs(diffX)) {
              return;
            }

            if (!isAtTopEdge) {
              return;
            }
          }
        }
      }

      if (Math.abs(diffY) > Math.abs(diffX)) {
        return;
      }

      if (Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY) && e.cancelable) {
        e.preventDefault();
      }
    };

    container.addEventListener('touchmove', handleTouchMoveNative, { passive: false });

    return () => {
      container.removeEventListener('touchmove', handleTouchMoveNative);
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-[100] pt-[15px] md:pt-4 pb-0 md:pb-4 px-0 md:px-4 transition-all duration-300 ease-out animate-in fade-in" onClick={handleForceClose}>
      <div 
        ref={modalContainerRef}
        className="relative flex flex-col bg-white md:pb-0 rounded-t-[25px] md:rounded-[25px] shadow-2xl w-full md:w-[50%] h-[80vh] md:max-h-[80vh] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300" 
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="relative flex justify-between items-center px-6 py-5 border-b border-gray-200 rounded-t-[25px]" style={{ background: '#112d1c' }}>
          <div className="flex items-center gap-3 flex-1">
            <label className="relative flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={task?.status === TaskStatus.COMPLETED || false}
                onChange={(e) => {
                  if (onUpdateTaskStatus && task?._id) {
                    onUpdateTaskStatus(
                      task._id,
                      e.target.checked ? TaskStatus.COMPLETED : TaskStatus.IN_PROGRESS
                    );
                  }
                }}
                className="sr-only"
              />
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
                task?.status === TaskStatus.COMPLETED
                  ? 'bg-dream-primary border-dream-primary'
                  : 'border-dream-primary'
              }`}>
                {task?.status === TaskStatus.COMPLETED && (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </label>
            {!isEditingTitle ? (
              <h2 
                onClick={handleStartEditTitle}
                className="flex-1 text-dream-primary cursor-pointer hover:opacity-80 transition-opacity break-words"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontStyle: 'normal',
                  fontSize: '20px',
                  lineHeight: 'normal',
                  letterSpacing: '0px',
                  leadingTrim: 'none',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word'
                } as React.CSSProperties & { leadingTrim?: string }}
              >
                {title || t('taskViewModal.taskName')}
              </h2>
            ) : (
              <div className="relative flex-1 flex flex-col gap-2">
                <input
                  type="text"
                  placeholder={t('taskViewModal.heading')}
                  maxLength={48}
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 48))}
                  disabled={isUpdatingTitle}
                  autoFocus
                  className="w-full flex-1 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 pr-14 py-2 focus:outline-none disabled:opacity-50"
                />
                <span className="absolute right-4 top-2/8 -translate-y-1/2 text-xs text-gray-500">{title.length}/48</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    disabled={isUpdatingTitle || !title.trim()}
                    className="flex-1 bg-dream-primary text-white py-2 px-4 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUpdatingTitle ? [t('taskViewModal.saving')]: t('taskViewModal.save')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEditTitle}
                    disabled={isUpdatingTitle}
                    className="flex-1 border-2 border-dream-primary/50 text-dream-primary py-2 px-4 bg-white cursor-pointer rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >{t('taskViewModal.cancel1')}</button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleForceClose}
            aria-label={t('taskViewModal.close')} 
            className='absolute -right-6 -top-6 cursor-pointer z-[120] pointer-events-auto bg-black/20 rounded-full p-1 hover:bg-black/40 transition-colors'
            type="button"
            style={{ pointerEvents: 'auto', zIndex: 120 }}
          >
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.5 7.5L7.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              <path d="M7.5 7.5L22.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col p-5 gap-5 overflow-y-auto pb-20 md:pb-5 overflow-y-auto">

          <div className="relative w-full">
            <span 
              className="text-black"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontStyle: 'normal',
                fontSize: '18px',
                lineHeight: '150%',
                letterSpacing: '-0.01em',
                leadingTrim: 'none'
              } as React.CSSProperties & { leadingTrim?: string }}
            >
              {t('taskViewModal.descriptionLabel')}
            </span>
            
            {!isEditingDescription && !description && (
              <button
                type="button"
                onClick={handleStartEditDescription}
                className="w-full text-left text-dream-primary cursor-pointer mb-4 hover:opacity-80 transition-opacity"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontStyle: 'normal',
                  fontSize: '16px',
                  lineHeight: '100%',
                  letterSpacing: '0px',
                  leadingTrim: 'none'
                } as React.CSSProperties & { leadingTrim?: string }}
              >
                {t('taskViewModal.addDescriptionOptional')}
              </button>
            )}
            
            {!isEditingDescription && description && (
              <div 
                onClick={handleStartEditDescription}
                className="w-full text-left cursor-pointer pt-2.5 cursor-pointer rounded-lg transition-colors"
              >
                
                <span className="text-black whitespace-pre-wrap break-words">{description}</span>
              </div>
            )}

            {isEditingDescription && (
              <div className="relative w-full flex flex-col">
                <textarea
                  placeholder={t('taskViewModal.descriptionOfTheTask')}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                  disabled={isUpdatingDescription}
                  autoFocus
                  className="w-full h-45 border-2 mt-2 border-dream-primary/50 bg-dream-secondary rounded-lg pl-5 pr-16 py-2 focus:outline-none resize-none break-words overflow-y-auto disabled:opacity-50"
                />
                <span className="absolute right-4 top-1/3 -translate-y-1/2 text-xs text-gray-500">{description.length}/1000</span>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleSaveDescription}
                    disabled={isUpdatingDescription}
                    className="flex-1 bg-dream-primary text-white py-2 px-4 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUpdatingDescription ? [t('taskViewModal.saving')]: t('taskViewModal.save')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEditDescription}
                    disabled={isUpdatingDescription}
                    className="flex-1 border-2 border-dream-primary/50 text-dream-primary py-2 px-4 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >{t('taskViewModal.cancel1')}</button>
                </div>
              </div>
            )}
          </div>

          {subtasks.length > 0 && (
            <>
              <div className="flex flex-col gap-4 mt-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-normal text-[18px] leading-[150%] tracking-[-0.01em] text-black">
                    {t('taskViewModal.subtasks')}
                  </span>
                  <div className="flex items-center gap-2">
                    {subtasks.length > 0 && subtasks.every(s => s.completed) ? (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 1.875C8.39303 1.875 6.82214 2.35152 5.486 3.24431C4.14985 4.1371 3.10844 5.40605 2.49348 6.8907C1.87852 8.37535 1.71762 10.009 2.03112 11.5851C2.34463 13.1612 3.11846 14.6089 4.25476 15.7452C5.39106 16.8815 6.8388 17.6554 8.41489 17.9689C9.99099 18.2824 11.6247 18.1215 13.1093 17.5065C14.594 16.8916 15.8629 15.8502 16.7557 14.514C17.6485 13.1779 18.125 11.607 18.125 10C18.1227 7.84581 17.266 5.78051 15.7427 4.25727C14.2195 2.73403 12.1542 1.87727 10 1.875ZM13.5672 8.56719L9.19219 12.9422C9.13414 13.0003 9.06521 13.0464 8.98934 13.0778C8.91347 13.1093 8.83214 13.1255 8.75 13.1255C8.66787 13.1255 8.58654 13.1093 8.51067 13.0778C8.43479 13.0464 8.36586 13.0003 8.30782 12.9422L6.43282 11.0672C6.31554 10.9499 6.24966 10.7909 6.24966 10.625C6.24966 10.4591 6.31554 10.3001 6.43282 10.1828C6.55009 10.0655 6.70915 9.99965 6.875 9.99965C7.04086 9.99965 7.19992 10.0655 7.31719 10.1828L8.75 11.6164L12.6828 7.68281C12.7409 7.62474 12.8098 7.57868 12.8857 7.54725C12.9616 7.51583 13.0429 7.49965 13.125 7.49965C13.2071 7.49965 13.2884 7.51583 13.3643 7.54725C13.4402 7.57868 13.5091 7.62474 13.5672 7.68281C13.6253 7.74088 13.6713 7.80982 13.7027 7.88569C13.7342 7.96156 13.7504 8.04288 13.7504 8.125C13.7504 8.20712 13.7342 8.28844 13.7027 8.36431C13.6713 8.44018 13.6253 8.50912 13.5672 8.56719Z" fill="#169600"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 1.875C8.39303 1.875 6.82214 2.35152 5.486 3.24431C4.14985 4.1371 3.10844 5.40605 2.49348 6.8907C1.87852 8.37535 1.71762 10.009 2.03112 11.5851C2.34463 13.1612 3.11846 14.6089 4.25476 15.7452C5.39106 16.8815 6.8388 17.6554 8.41489 17.9689C9.99099 18.2824 11.6247 18.1215 13.1093 17.5065C14.594 16.8916 15.8629 15.8502 16.7557 14.514C17.6485 13.1779 18.125 11.607 18.125 10C18.1227 7.84581 17.266 5.78051 15.7427 4.25727C14.2195 2.73403 12.1542 1.87727 10 1.875ZM13.5672 8.56719L9.19219 12.9422C9.13414 13.0003 9.06521 13.0464 8.98934 13.0778C8.91347 13.1093 8.83214 13.1255 8.75 13.1255C8.66787 13.1255 8.58654 13.1093 8.51067 13.0778C8.43479 13.0464 8.36586 13.0003 8.30782 12.9422L6.43282 11.0672C6.31554 10.9499 6.24966 10.7909 6.24966 10.625C6.24966 10.4591 6.31554 10.3001 6.43282 10.1828C6.55009 10.0655 6.70915 9.99965 6.875 9.99965C7.04086 9.99965 7.19992 10.0655 7.31719 10.1828L8.75 11.6164L12.6828 7.68281C12.7409 7.62474 12.8098 7.57868 12.8857 7.54725C12.9616 7.51583 13.0429 7.49965 13.125 7.49965C13.2071 7.49965 13.2884 7.51583 13.3643 7.54725C13.4402 7.57868 13.5091 7.62474 13.5672 7.68281C13.6253 7.74088 13.6713 7.80982 13.7027 7.88569C13.7342 7.96156 13.7504 8.04288 13.7504 8.125C13.7504 8.20712 13.7342 8.28844 13.7027 8.36431C13.6713 8.44018 13.6253 8.50912 13.5672 8.56719Z" fill="#B4BBC0"/>
                      </svg>
                    )}
                    <span>{subtasks.filter(s => s.completed).length}/{subtasks.length}</span>
                  </div>
                </div>
                {subtasks.map((subtask, index) => (
                  <div 
                    key={index} 
                    className={`flex items-center gap-2 px-5 py-3 rounded-lg ${
                      subtask.completed 
                        ? 'bg-gray-100 border border-gray-300' 
                        : 'bg-dream-secondary'
                    }`}
                  >
                    <button 
                      type="button"
                      className={`cursor-pointer flex items-center justify-center rounded-sm size-6 ${
                        subtask.completed 
                          ? 'bg-dream-primary' 
                          : 'border-2 border-dream-primary'
                      }`} 
                      onClick={() => handleToggleSubtask(index)}
                    >
                      {subtask.completed && (
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    {editingSubtaskIndex === index ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={editingSubtaskTitle}
                          onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveEditSubtask(index);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelEditSubtask();
                            }
                          }}
                          placeholder={t('taskViewModal.enterTheNameOfTheSubtask')}
                          className="flex-1 font-normal text-[16px] leading-[24px] tracking-[0px] border-2 border-dream-primary rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-dream-primary"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEditSubtask(index)}
                          className="p-1.5 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors flex-shrink-0"
                          title={t('taskViewModal.save')}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelEditSubtask()}
                          className="p-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex-shrink-0"
                          title={t('taskViewModal.cancel')}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <span className={`flex-1 ${subtask.completed ? 'text-gray-500' : 'text-black'}`}>
                        {subtask.completed ? <s>{subtask.title}</s> : subtask.title}
                      </span>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      {editingSubtaskIndex !== index && (
                        <>
                          <div className="relative group">
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditSubtask(index);
                              }} 
                              className="cursor-pointer p-2 hover:bg-dream-primary/10 rounded-lg transition-all duration-200 flex-shrink-0 group-hover:scale-110"
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:scale-110 transition-transform duration-200">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#169600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-[#0d7a00] transition-colors duration-200"/>
                                <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#169600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-[#0d7a00] transition-colors duration-200"/>
                              </svg>
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap shadow-lg z-50">
                              {t('taskViewModal.editSubtask')}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
                                <div className="border-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </div>
                          </div>
                          <div className="relative group">
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSubtask(index);
                              }} 
                              className="cursor-pointer p-2 hover:bg-red-50 rounded-lg transition-all duration-200 flex-shrink-0 group-hover:scale-110"
                            >
                              <svg width="20" height="20" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:scale-110 transition-transform duration-200">
                                <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="#ffb4ab" className="group-hover:fill-[#2a6fa5] transition-colors duration-200"/>
                                <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="#ffb4ab" className="group-hover:fill-[#2a6fa5] transition-colors duration-200"/>
                                <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="#ffb4ab" className="group-hover:fill-[#2a6fa5] transition-colors duration-200"/>
                                <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="#ffb4ab" className="group-hover:fill-[#2a6fa5] transition-colors duration-200"/>
                              </svg>
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap shadow-lg z-50">
                              {t('taskViewModal.deleteSubtask')}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
                                <div className="border-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Новая подзадача в режиме редактирования */}
              {editingSubtaskIndex === 'new' && (
                <div className="flex items-center gap-2 px-5 py-3 rounded-lg bg-dream-secondary">
                  <button 
                    type="button"
                    className="cursor-pointer flex items-center justify-center rounded-sm size-6 border-2 border-dream-primary"
                    disabled
                  />
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={editingSubtaskTitle}
                      onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveEditSubtask('new');
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCancelEditSubtask();
                        }
                      }}
                      placeholder={t('taskViewModal.enterTheNameOfTheSubtask')}
                      className="flex-1 font-normal text-[16px] leading-[24px] tracking-[0px] border-2 border-dream-primary rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-dream-primary"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveEditSubtask('new')}
                      className="p-1.5 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors flex-shrink-0"
                      title={t('taskViewModal.save')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelEditSubtask()}
                      className="p-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex-shrink-0"
                      title={t('taskViewModal.cancel')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              {/* Кнопка добавления новой подзадачи */}
              {editingSubtaskIndex !== 'new' && (
                <button type="button" className="flex cursor-pointer" onClick={handleStartAddSubtask}>
                  <span className="font-normal text-[16px] leading-[100%] tracking-[0px] text-dream-primary">
                    {t('taskViewModal.newSubtask')}
                  </span>
                </button>
              )}
              
            </>
          )}
          {subtasks.length === 0 && (
            <div className="flex flex-col gap-4 mt-2.5">
              <span 
                className="text-black"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontStyle: 'normal',
                  fontSize: '18px',
                  lineHeight: '150%',
                  letterSpacing: '-0.01em',
                  leadingTrim: 'none'
                } as React.CSSProperties & { leadingTrim?: string }}
              >
                {t('crm.crm.taskViewModal.подзадачи')}</span>
              {/* Новая подзадача в режиме редактирования когда нет подзадач */}
              {editingSubtaskIndex === 'new' ? (
                <div className="flex items-center gap-2 px-5 py-3 rounded-lg bg-dream-secondary">
                  <button 
                    type="button"
                    className="cursor-pointer flex items-center justify-center rounded-sm size-6 border-2 border-dream-primary"
                    disabled
                  />
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={editingSubtaskTitle}
                      onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveEditSubtask('new');
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCancelEditSubtask();
                        }
                      }}
                      placeholder={t('taskViewModal.enterTheNameOfTheSubtask')}
                      className="flex-1 font-normal text-[16px] leading-[24px] tracking-[0px] border-2 border-dream-primary rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-dream-primary"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveEditSubtask('new')}
                      className="p-1.5 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors flex-shrink-0"
                      title={t('taskViewModal.save')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelEditSubtask()}
                      className="p-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex-shrink-0"
                      title={t('taskViewModal.cancel')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="flex cursor-pointer" onClick={handleStartAddSubtask}>
                  <span 
                    className="text-dream-primary"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '100%',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                  } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('taskViewModal.addSubtask')}
                  </span>
                </button>
              )}
            </div>
          )}
          <div className="flex flex-col items-start gap-2.5">
            <span 
              className="text-black mt-2.5"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontStyle: 'normal',
                fontSize: '18px',
                lineHeight: '150%',
                letterSpacing: '-0.01em',
                leadingTrim: 'none'
              } as React.CSSProperties & { leadingTrim?: string }}
            >
              {t('taskViewModal.attachments')}
            </span>
            
            {uploadError && (
              <div className="w-full p-3 bg-red-100 text-red-600 rounded-lg text-sm">
                {uploadError}
              </div>
            )}
            
            {files.length > 0 ? (
              <div className="w-full flex flex-col gap-2">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 p-3 pr-5 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {file.mimeType?.includes('image') && file.url ? (
                        <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                          <img 
                            src={file.url} 
                            alt={decodeFileName(file.originalName)}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ) : (
                        getFileIcon(file.mimeType)
                      )}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-medium truncate">{decodeFileName(file.originalName)}</span>
                        <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadFile(file)}
                        className="cursor-pointer"
                        title={t('taskViewModal.download')}
                      >
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M9 12L5 8h3V3h2v5h3l-4 4z" fill="#169600"/>
                          <path d="M15 13v2H3v-2H1v2c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-2h-2z" fill="#169600"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteFile(file.filename)}
                        className="cursor-pointer"
                        title={t('taskViewModal.delete')}
                      >
                        <svg width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="#ffb4ab"/>
                          <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="#ffb4ab"/>
                          <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="#ffb4ab"/>
                          <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="#ffb4ab"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">{t('taskViewModal.noAttachments')}</div>
            )}
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept="*/*"
            />
            
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !task?._id}
              className="flex items-center py-2 px-3 rounded-full border border-dashed border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-5 w-5 mr-2 text-dream-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>{t('taskViewModal.loading')}</span>
                </>
              ) : (
                <>
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="#555454"/>
                  </svg>
                  <span>{t('taskViewModal.attachFilesMax10Files')}</span>
                </>
              )}
            </button>
          </div>

          
          <div className="flex items-center gap-4 flex-wrap mt-5">
            {/* Срочно/Не срочно */}
            <div className="relative">
              {(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.URGENT_NOT_IMPORTANT) ? (
                <button
                  type="button"
                  onClick={() => setIsUrgencyPickerOpen(!isUrgencyPickerOpen)}
                  className="flex items-center gap-1 rounded-lg bg-red-100 text-red-500 h-9 px-2 cursor-pointer"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14.0704 6.1734C14.0212 6.06779 13.9153 6.00001 13.7986 6.00001H10.2436L13.7521 0.460512C13.8106 0.368121 13.8141 0.251121 13.7614 0.155426C13.7086 0.0594141 13.6077 0 13.4985 0H8.69856C8.58486 0 8.48105 0.0641953 8.43007 0.165902L3.93007 9.1659C3.88356 9.25861 3.88866 9.369 3.94325 9.45749C3.99817 9.54598 4.09446 9.59998 4.19856 9.59998H7.28345L3.92195 17.5836C3.86465 17.7201 3.91566 17.8785 4.04194 17.9559C4.09052 17.9856 4.14452 18 4.19824 18C4.28434 18 4.36924 17.9631 4.42806 17.8935L14.0281 6.49346C14.1033 6.4041 14.1195 6.27929 14.0704 6.1734Z" fill="#FF070B"/>
                  </svg>
                  <span>{t('taskViewModal.urgently')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsUrgencyPickerOpen(!isUrgencyPickerOpen)}
                  className="flex items-center gap-1 rounded-lg bg-gray-100 text-gray-600 h-9 px-2 cursor-pointer"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g clipPath="url(#clip0_urgency_not_urgent_btn)">
                      <path d="M14.0168 6.52885C13.9411 6.47204 13.8489 6.44135 13.7542 6.44135H10.4023L13.7192 0.656385C13.8401 0.44708 13.7684 0.17948 13.5591 0.0586234C13.4933 0.0206761 13.4188 0.000451265 13.3429 0H8.68694C8.51763 0.00127175 8.3642 0.10014 8.29311 0.253816L3.84721 9.57448C3.74571 9.79379 3.84122 10.0539 4.06053 10.1554C4.11715 10.1816 4.17868 10.1954 4.24104 10.1958H7.58421L5.17745 17.4598C5.13536 17.6627 5.24133 17.8672 5.43127 17.95C5.62035 18.0491 5.85333 17.9973 5.98263 17.8274L14.1043 7.14147C14.2493 6.94812 14.2101 6.67383 14.0168 6.52885ZM6.87532 15.2369L8.64317 9.86325C8.7205 9.63429 8.59759 9.38597 8.36863 9.30864C8.32453 9.29375 8.27838 9.286 8.23182 9.28563H4.96741L8.95823 0.831393H12.599L9.2733 6.66009C9.15244 6.8694 9.22415 7.137 9.43345 7.25785C9.49922 7.2958 9.57372 7.31602 9.64961 7.31648H12.879L6.87532 15.2369Z" fill="#2E2E2E"/>
                    </g>
                    <defs>
                      <clipPath id="clip0_urgency_not_urgent_btn">
                        <rect width="18" height="18" fill="white"/>
                      </clipPath>
                    </defs>
                  </svg>
                  <span>{t('taskViewModal.notUrgent')}</span>
                </button>
              )}
              
              {isUrgencyPickerOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-[100]" 
                    onClick={() => setIsUrgencyPickerOpen(false)}
                  />
                  <div className="absolute bottom-full left-0 mb-2 bg-white rounded-2xl shadow-2xl p-4 z-[110] border border-gray-200">
                    <div className="flex flex-col items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateUrgency(true);
                        }}
                        className={`flex items-center h-8.5 p-1 rounded-lg w-full ${(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.URGENT_NOT_IMPORTANT) ? 'bg-red-100 ring-2 ring-red-300' : 'bg-gray-100'} cursor-pointer`}
                      >
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19.0723 11.1734C19.0231 11.0678 18.9172 11 18.8005 11H15.2455L18.754 5.46051C18.8125 5.36812 18.8161 5.25112 18.7633 5.15543C18.7105 5.05941 18.6097 5 18.5005 5H13.7005C13.5868 5 13.483 5.0642 13.432 5.1659L8.93202 14.1659C8.88551 14.2586 8.89061 14.369 8.94521 14.4575C9.00012 14.546 9.09642 14.6 9.20051 14.6H12.2854L8.9239 22.5836C8.8666 22.7201 8.91761 22.8785 9.04389 22.9559C9.09248 22.9856 9.14648 23 9.2002 23C9.28629 23 9.3712 22.9631 9.43001 22.8935L19.03 11.4935C19.1053 11.4041 19.1215 11.2793 19.0723 11.1734Z" fill={(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.URGENT_NOT_IMPORTANT) ? '#FF070B' : '#9CA3AF'}/>
                        </svg>
                        <span className={(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.URGENT_NOT_IMPORTANT) ? 'text-red-600' : 'text-gray-600'}>{t('taskViewModal.urgently')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateUrgency(false);
                        }}
                        className={`flex items-center h-8.5 p-1 rounded-lg ${(task?.priority === TaskPriority.NOT_URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_NOT_IMPORTANT) ? 'bg-red-50 ring-2 ring-red-200' : 'bg-gray-100'} cursor-pointer`}
                      >
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <g clipPath="url(#clip0_urgency_not_urgent)">
                            <path d="M14.0168 6.52885C13.9411 6.47204 13.8489 6.44135 13.7542 6.44135H10.4023L13.7192 0.656385C13.8401 0.44708 13.7684 0.17948 13.5591 0.0586234C13.4933 0.0206761 13.4188 0.000451265 13.3429 0H8.68694C8.51763 0.00127175 8.3642 0.10014 8.29311 0.253816L3.84721 9.57448C3.74571 9.79379 3.84122 10.0539 4.06053 10.1554C4.11715 10.1816 4.17868 10.1954 4.24104 10.1958H7.58421L5.17745 17.4598C5.13536 17.6627 5.24133 17.8672 5.43127 17.95C5.62035 18.0491 5.85333 17.9973 5.98263 17.8274L14.1043 7.14147C14.2493 6.94812 14.2101 6.67383 14.0168 6.52885ZM6.87532 15.2369L8.64317 9.86325C8.7205 9.63429 8.59759 9.38597 8.36863 9.30864C8.32453 9.29375 8.27838 9.286 8.23182 9.28563H4.96741L8.95823 0.831393H12.599L9.2733 6.66009C9.15244 6.8694 9.22415 7.137 9.43345 7.25785C9.49922 7.2958 9.57372 7.31602 9.64961 7.31648H12.879L6.87532 15.2369Z" fill={(task?.priority === TaskPriority.NOT_URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_NOT_IMPORTANT) ? '#FCA5A5' : '#9CA3AF'}/>
                          </g>
                          <defs>
                            <clipPath id="clip0_urgency_not_urgent">
                              <rect width="18" height="18" fill="white"/>
                            </clipPath>
                          </defs>
                        </svg>
                        <span className={`text-nowrap ${(task?.priority === TaskPriority.NOT_URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_NOT_IMPORTANT) ? 'text-red-400' : 'text-gray-600'}`}>{t('taskViewModal.notUrgent')}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Важно/Не важно */}
            <div className="relative">
              {(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_IMPORTANT) ? (
                <button
                  type="button"
                  onClick={() => setIsImportancePickerOpen(!isImportancePickerOpen)}
                  className="flex items-center gap-1 rounded-lg bg-yellow-100 text-yellow-500 h-9 px-2 cursor-pointer"
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g clipPath="url(#clip0_3857_57606)">
                    <path d="M13.4582 0H3.59461C2.79129 0 2.08594 0.660855 2.08594 1.44309V16.0343C2.08594 16.2962 2.15881 16.5144 2.27627 16.683C2.41673 16.8846 2.64289 17.0001 2.88541 17C3.1147 17 3.35882 16.8979 3.58427 16.7054L7.99723 12.9585C8.13353 12.8421 8.32931 12.7754 8.53286 12.7754C8.73634 12.7754 8.93172 12.8421 9.06841 12.9589L13.4666 16.7048C13.6929 16.8979 13.9202 17.0001 14.149 17.0001C14.5361 17.0001 14.9134 16.7015 14.9134 16.0344V1.44309C14.9134 0.660855 14.2615 0 13.4582 0Z" fill="#F6B000"/>
                    </g>
                    <defs>
                    <clipPath id="clip0_3857_57606">
                    <rect width="17" height="17" fill="white"/>
                    </clipPath>
                    </defs>
                  </svg>
                  <span>{t('taskViewModal.important')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsImportancePickerOpen(!isImportancePickerOpen)}
                  className="flex items-center gap-1 rounded-lg bg-yellow-50 text-yellow-400 h-9 px-2 cursor-pointer"
                >
                  <svg width="17" height="17" viewBox="0 0 13 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11.1682 0H1.56509C0.718774 0 0 0.682579 0 1.56509V15.7649C0.00249044 16.885 1.37064 17.4106 2.14845 16.6243L5.8089 12.9649C6.10224 12.6589 6.63107 12.6589 6.92442 12.9649L10.5849 16.6243C11.363 17.4109 12.731 16.8845 12.7333 15.7649V1.56509C12.7333 0.682579 12.0145 0 11.1682 0ZM11.7371 15.7649C11.7359 16.0021 11.4411 16.0804 11.2886 15.9193C10.5568 15.1864 8.47001 13.1002 7.62948 12.2612C6.96825 11.5697 5.76606 11.5695 5.10513 12.2599C4.5245 12.8394 3.38793 13.9757 2.49197 14.8714L1.44963 15.9132C1.29944 16.0726 1.00096 16.0194 0.996142 15.774V1.56509C0.996142 1.24691 1.25405 0.996176 1.56509 0.996176H11.1682C11.4788 0.996176 11.7371 1.24651 11.7371 1.56509V15.7649Z" fill="#FCD34D"/>
                  </svg>
                  <span>{t('taskViewModal.doesntMatter')}</span>
                </button>
              )}
              
              {isImportancePickerOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-[100]" 
                    onClick={() => setIsImportancePickerOpen(false)}
                  />
                  <div className="absolute bottom-full left-0 mb-2 bg-white rounded-2xl shadow-2xl p-4 z-[110] border border-gray-200">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateImportance(true);
                        }}
                        className={`flex items-center h-8.5 p-1 rounded-lg ${(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_IMPORTANT) ? 'bg-yellow-100 ring-2 ring-yellow-300' : 'bg-gray-100'} cursor-pointer`}
                      >
                        <svg width="27" height="27" viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <g clipPath="url(#clip0_importance_important)">
                          <path d="M18.4582 5H8.59461C7.79129 5 7.08594 5.66085 7.08594 6.44309V21.0343C7.08594 21.2962 7.15881 21.5144 7.27627 21.683C7.41673 21.8846 7.64289 22.0001 7.88541 22C8.1147 22 8.35882 21.8979 8.58427 21.7054L12.9972 17.9585C13.1335 17.8421 13.3293 17.7754 13.5329 17.7754C13.7363 17.7754 13.9317 17.8421 14.0684 17.9589L18.4666 21.7048C18.6929 21.8979 18.9202 22.0001 19.149 22.0001C19.5361 22.0001 19.9134 21.7015 19.9134 21.0344V6.44309C19.9134 5.66085 19.2615 5 18.4582 5Z" fill={(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_IMPORTANT) ? '#F6B000' : '#9CA3AF'}/>
                          </g>
                          <defs>
                          <clipPath id="clip0_importance_important">
                          <rect width="27" height="27" fill="white"/>
                          </clipPath>
                          </defs>
                        </svg>
                        <span className={(task?.priority === TaskPriority.URGENT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_IMPORTANT) ? 'text-yellow-600' : 'text-gray-600'}>{t('taskViewModal.important')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateImportance(false);
                        }}
                        className={`flex items-center h-8.5 gap-1 p-1 rounded-lg ${(task?.priority === TaskPriority.URGENT_NOT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_NOT_IMPORTANT) ? 'bg-yellow-50 ring-2 ring-yellow-200' : 'bg-gray-100'} cursor-pointer`}
                      >
                        <svg width="17" height="17" viewBox="0 0 13 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M11.1682 0H1.56509C0.718774 0 0 0.682579 0 1.56509V15.7649C0.00249044 16.885 1.37064 17.4106 2.14845 16.6243L5.8089 12.9649C6.10224 12.6589 6.63107 12.6589 6.92442 12.9649L10.5849 16.6243C11.363 17.4109 12.731 16.8845 12.7333 15.7649V1.56509C12.7333 0.682579 12.0145 0 11.1682 0ZM11.7371 15.7649C11.7359 16.0021 11.4411 16.0804 11.2886 15.9193C10.5568 15.1864 8.47001 13.1002 7.62948 12.2612C6.96825 11.5697 5.76606 11.5695 5.10513 12.2599C4.5245 12.8394 3.38793 13.9757 2.49197 14.8714L1.44963 15.9132C1.29944 16.0726 1.00096 16.0194 0.996142 15.774V1.56509C0.996142 1.24691 1.25405 0.996176 1.56509 0.996176H11.1682C11.4788 0.996176 11.7371 1.24651 11.7371 1.56509V15.7649Z" fill={(task?.priority === TaskPriority.URGENT_NOT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_NOT_IMPORTANT) ? '#FCD34D' : '#9CA3AF'}/>
                        </svg>
                        <span className={`text-nowrap ${(task?.priority === TaskPriority.URGENT_NOT_IMPORTANT || task?.priority === TaskPriority.NOT_URGENT_NOT_IMPORTANT) ? 'text-yellow-400' : 'text-gray-600'}`}>{t('taskViewModal.doesntMatter')}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Цветовой индикатор */}
            <div className="relative flex items-center gap-2" ref={colorDropdownRef}>
              <Tooltip text={t('taskViewModal.changingTheColorLabel')} position="bottom">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsColorDropdownOpen(!isColorDropdownOpen);
                  }}
                  className="cursor-pointer"
                >
                  {task?.colorLabel ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="8" cy="8" r="8" fill={task.colorLabel}/>
                    </svg>
                  ) : (
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="0.5" y="0.5" width="27" height="27" rx="2.5" stroke="#A5E1A5"/>
                      <path d="M14 5.5625C12.3312 5.5625 10.6999 6.05735 9.31238 6.98448C7.92484 7.9116 6.84338 9.22936 6.20477 10.7711C5.56616 12.3129 5.39907 14.0094 5.72463 15.6461C6.05019 17.2828 6.85378 18.7862 8.03379 19.9662C9.2138 21.1462 10.7172 21.9498 12.3539 22.2754C13.9906 22.6009 15.6871 22.4338 17.2289 21.7952C18.7706 21.1566 20.0884 20.0752 21.0155 18.6876C21.9427 17.3001 22.4375 15.6688 22.4375 14C22.4375 11.7622 21.5486 9.61612 19.9662 8.03379C18.3839 6.45145 16.2378 5.5625 14 5.5625ZM14 6.6875C15.7505 6.68642 17.4424 7.31765 18.7644 8.465L8.42563 18.7194C7.52653 17.6552 6.95011 16.3564 6.76422 14.9757C6.57833 13.5951 6.7907 12.19 7.37633 10.926C7.96197 9.66195 8.8965 8.59149 10.0699 7.8406C11.2434 7.08972 12.6069 6.68966 14 6.6875ZM14 21.3125C12.2418 21.312 10.5432 20.6745 9.21875 19.5181L19.5575 9.25813C20.4626 10.3207 21.0448 11.6201 21.2351 13.0029C21.4254 14.3857 21.216 15.794 20.6316 17.0616C20.0472 18.3292 19.1122 19.4031 17.9371 20.1563C16.762 20.9096 15.3958 21.3108 14 21.3125Z" fill="#8C8C8C"/>
                    </svg>
                  )}
                </button>
              </Tooltip>
              
              {/* Выпадающий список с цветами */}
              {isColorDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-[150] flex gap-2">
                  {['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'].map((color) => (
                    <Tooltip key={color} text={color} position="top">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateColorLabel(color);
                          setIsColorDropdownOpen(false);
                        }}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 hover:border-dream-primary hover:scale-110 transition-all cursor-pointer"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
            
            {/* Выбрать категорию */}
            <div className="relative">
              {(() => {
                const callCategory = categories.find(c => isCallCat(c.label));
                const meetingCategory = categories.find(c => isMeetingCat(c.label));
                const workCategory = categories.find(c => isWorkCat(c.label));
                const personalCategory = categories.find(c => isPersonalCat(c.label));
                const hasCall = selectedCategories.some(isCallCat);
                const hasMeeting = selectedCategories.some(isMeetingCat);
                const hasWork = selectedCategories.some(isWorkCat);
                const hasPersonal = selectedCategories.some(isPersonalCat);
                
                // Формируем текст кнопки на основе выбранных категорий
                const getButtonText = () => {
                  const selected: string[] = [];
                  if (hasWork) selected.push(t('taskViewModal.working'));
                  if (hasPersonal) selected.push(t('taskViewModal.personal'));
                  if (hasCall) selected.push(t('taskViewModal.call'));
                  if (hasMeeting) selected.push(t('taskViewModal.meeting'));
                  return selected.length > 0 ? selected.join(', ') : t('taskViewModal.selectCategory');
                };
                
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsCategoryPickerOpen(!isCategoryPickerOpen)}
                      className="flex items-center gap-1 rounded-lg bg-gray-100 text-gray-600 h-9 px-2 cursor-pointer"
                    >
                      <span>{getButtonText()}</span>
                    </button>
                    
                    {isCategoryPickerOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-[100]" 
                          onClick={() => setIsCategoryPickerOpen(false)}
                        />
                        <div 
                          className="absolute bottom-full left-0 mb-2 bg-white rounded-2xl shadow-2xl p-4 z-[110] border border-gray-200 min-w-[200px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-col gap-3">
                            <div className="text-sm font-normal text-gray-700 mb-1">{t('taskViewModal.taskType')}</div>
                            
                            {/* Звонок */}
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hasCall}
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  let categoryLabel = callCategory?.label;
                                if (!categoryLabel) {
                                  try {
                                      const response = await crmTaskService.getOrCreateTaskCategory(t('taskViewModal.call'));
                                    if (response.success && response.data) {
                                      categoryLabel = response.data.name;
                                      const categoryId = response.data.id?.toString() || '';
                                      const categoryName = response.data.name;
                                      setCategories(prev => [...prev, { key: categoryId, label: categoryName }]);
                                    }
                                  } catch (error) {
                                      console.error(t('taskViewModal.errorCreatingTheCallCategory'), error);
                                      categoryLabel = t('taskViewModal.call');
                                  }
                                }
                                
                                if (categoryLabel) {
                                    // Убираем Встреча (взаимоисключающие), добавляем/убираем Звонок
                                    const newCategories = selectedCategories.filter(c => !isMeetingCat(c));
                                    if (e.target.checked && !hasCall) {
                                    handleUpdateCategories([...newCategories, categoryLabel]);
                                    } else if (!e.target.checked && hasCall) {
                                    handleUpdateCategories(newCategories);
                                  }
                                }
                              }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 rounded"
                              />
                              <span className="text-gray-700">{t('taskViewModal.call')}</span>
                            </label>
                            
                            {/* Встреча */}
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hasMeeting}
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  let categoryLabel = meetingCategory?.label;
                                if (!categoryLabel) {
                                  try {
                                      const response = await crmTaskService.getOrCreateTaskCategory(t('taskViewModal.meeting'));
                                    if (response.success && response.data) {
                                      categoryLabel = response.data.name;
                                      const categoryId = response.data.id?.toString() || '';
                                      const categoryName = response.data.name;
                                      setCategories(prev => [...prev, { key: categoryId, label: categoryName }]);
                                    }
                                  } catch (error) {
                                      console.error(t('taskViewModal.errorCreatingMeetingCategory'), error);
                                      categoryLabel = t('taskViewModal.meeting');
                                  }
                                }
                                
                                if (categoryLabel) {
                                    // Убираем Звонок (взаимоисключающие), добавляем/убираем Встреча
                                    const newCategories = selectedCategories.filter(c => !isCallCat(c));
                                    if (e.target.checked && !hasMeeting) {
                                    handleUpdateCategories([...newCategories, categoryLabel]);
                                    } else if (!e.target.checked && hasMeeting) {
                                    handleUpdateCategories(newCategories);
                                  }
                                }
                              }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                              />
                              <span className="text-gray-700">{t('taskViewModal.meeting')}</span>
                            </label>
                            
                            <div className="border-t border-gray-200 my-1"></div>
                            
                            <div className="text-sm font-normal text-gray-700 mb-1">{t('taskViewModal.category')}</div>
                            
                            {/* Рабочая */}
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hasWork}
                                onChange={async (e) => {
                                  let categoryLabel = workCategory?.label;
                                if (!categoryLabel) {
                                  try {
                                      const response = await crmTaskService.getOrCreateTaskCategory(t('taskViewModal.workTasks'));
                                    if (response.success && response.data) {
                                      categoryLabel = response.data.name;
                                      const categoryId = response.data.id?.toString() || '';
                                      const categoryName = response.data.name;
                                      setCategories(prev => [...prev, { key: categoryId, label: categoryName }]);
                                    }
                                  } catch (error) {
                                      console.error(t('taskViewModal.errorCreatingCategoryWorkTasks'), error);
                                      categoryLabel = t('taskViewModal.workTasks');
                                  }
                                }
                                
                                if (categoryLabel) {
                                    // Убираем Личная, добавляем/убираем Рабочая (взаимоисключающие)
                                    const newCategories = selectedCategories.filter(c => !isPersonalCat(c));
                                    if (e.target.checked && !hasWork) {
                                    handleUpdateCategories([...newCategories, categoryLabel]);
                                    } else if (!e.target.checked && hasWork) {
                                    handleUpdateCategories(newCategories);
                                  }
                                }
                              }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                              />
                              <span className="text-gray-700">{t('taskViewModal.working')}</span>
                            </label>
                            
                            {/* Личная */}
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hasPersonal}
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  let categoryLabel = personalCategory?.label;
                                if (!categoryLabel) {
                                  try {
                                      const response = await crmTaskService.getOrCreateTaskCategory(t('taskViewModal.personalTasks'));
                                    if (response.success && response.data) {
                                      categoryLabel = response.data.name;
                                      const categoryId = response.data.id?.toString() || '';
                                      const categoryName = response.data.name;
                                      setCategories(prev => [...prev, { key: categoryId, label: categoryName }]);
                                    }
                                  } catch (error) {
                                      console.error(t('taskViewModal.errorCreatingCategoryPersonalT'), error);
                                      categoryLabel = t('taskViewModal.personalTasks');
                                  }
                                }
                                
                                if (categoryLabel) {
                                    // Убираем Рабочая, добавляем/убираем Личная (взаимоисключающие)
                                    const newCategories = selectedCategories.filter(c => !isWorkCat(c));
                                    if (e.target.checked && !hasPersonal) {
                                    handleUpdateCategories([...newCategories, categoryLabel]);
                                    } else if (!e.target.checked && hasPersonal) {
                                    handleUpdateCategories(newCategories);
                                  }
                                }
                              }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                              />
                              <span className="text-gray-700">{t('taskViewModal.personal')}</span>
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            
            {/* Сроки (объединенная кнопка для даты начала и окончания) */}
            <div className="relative">
              {(() => {
                // Используем локальное состояние startDate и startTime для отображения, если они есть
                // Иначе используем task.startDate
                const displayStartDate = (startDate && startTime) 
                  ? `${startDate}T${startTime}:00`
                  : (startDate ? `${startDate}T00:00:00` : (task?.startDate || ''));
                
                // Используем локальное состояние endDate и endTime для отображения, если они есть
                // Иначе используем task.endDate
                const displayEndDate = (endDate && endTime) 
                  ? `${endDate}T${endTime}:00`
                  : (endDate ? `${endDate}T00:00:00` : (task?.endDate || ''));
                
                // @ts-ignore
                const formatDate = (dateStr: string) => {
                  try {
                    if (!dateStr) return '';
                    
                    // Используем parseDateFromAPI для правильной обработки дат
                    const date = parseDateFromAPI(dateStr);
                    if (!date || isNaN(date.getTime())) {
                      console.error('Failed to parse date in formatDate:', dateStr);
                      return '';
                    }
                    
                    // Проверяем, совпадают ли дата и время создания с датой и временем редактирования
                    // Если совпадают (задача только что создана и не редактировалась), добавляем +1 день
                    const shouldAddDay = (() => {
                      if (!task?.createdAt || !task?.updatedAt) return false;
                      
                      // Нормализуем даты для сравнения - сравниваем только дату без времени
                      try {
                        const createdDate = parseDateFromAPI(task.createdAt);
                        const updatedDate = parseDateFromAPI(task.updatedAt);
                        
                        if (!createdDate || !updatedDate) return false;
                        
                        // Сравниваем дату без времени
                        const createdDateOnly = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
                        const updatedDateOnly = new Date(updatedDate.getFullYear(), updatedDate.getMonth(), updatedDate.getDate());
                        
                        // Также сравниваем время с точностью до секунды (на случай если задача создана и сразу обновлена)
                        const timeDiff = Math.abs(updatedDate.getTime() - createdDate.getTime());
                        const isSameDate = createdDateOnly.getTime() === updatedDateOnly.getTime();
                        const isSameTime = timeDiff < 2000; // Разница менее 2 секунд
                        
                        return isSameDate && isSameTime;
                      } catch (error) {
                        // Fallback на простое сравнение строк
                        return task.createdAt === task.updatedAt;
                      }
                    })();
                    
                    let displayDate = date;
                    if (shouldAddDay) {
                      // Добавляем +1 день для корректного отображения (компенсация проблемы с часовыми поясами)
                      displayDate = new Date(date);
                      displayDate.setDate(displayDate.getDate() + 1);
                    }
                    
                    // Всегда используем локальные методы для отображения
                    const day = String(displayDate.getDate()).padStart(2, '0');
                    const month = String(displayDate.getMonth() + 1).padStart(2, '0');
                    const year = displayDate.getFullYear();
                    const hours = String(displayDate.getHours()).padStart(2, '0');
                    const minutes = String(displayDate.getMinutes()).padStart(2, '0');
                    return `${day}.${month}.${year} ${hours}:${minutes}`;
                  } catch (error) {
                    console.error(t('taskViewModal.dateFormattingError'), error, dateStr);
                    return '';
                  }
                };
                
                // Проверяем срочность даты окончания для SVG
                const isEndDateUrgent = displayEndDate ? (() => {
                  const endDateObj = parseDateFromAPI(displayEndDate);
                  if (!endDateObj || isNaN(endDateObj.getTime())) return false;
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const tomorrow = new Date(today);
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  endDateObj.setHours(0, 0, 0, 0);
                  return endDateObj <= tomorrow;
                })() : false;
                
                const showUrgentIcon = isEndDateUrgent;
                
                // Формируем текст для кнопки
                let buttonText = t('taskViewModal.setDeadlines');
                if (displayStartDate && displayEndDate) {
                  buttonText = t('taskViewModal.fromFormatdatedisplaystartdate');
                } else if (displayStartDate) {
                  buttonText = t('taskViewModal.withFormatdatedisplaystartdate');
                } else if (displayEndDate) {
                  buttonText = t('taskViewModal.toFormatdatedisplayenddate');
                }
                
                return (
                  <div className="flex items-center gap-2">
                    <button
                      ref={datesButtonRef}
                      type="button"
                      onClick={() => {
                        if (datesButtonRef.current) {
                          const rect = datesButtonRef.current.getBoundingClientRect();
                          setDatesMenuPosition({
                            top: rect.top - 10,
                            left: rect.left
                          });
                        }
                        const newState = !isDatesPickerOpen;
                        setIsDatesPickerOpen(newState);
                        setIsStartDateCalendarOpen(false);
                        setIsEndDatePickerOpen(false);
                        setIsEndDateCalendarOpen(false);
                      }}
                      className={`flex items-center gap-1 h-9 cursor-pointer ${isEndDateUrgent ? 'text-red-500' : 'text-gray-500'}`}
                    >
                      {showUrgentIcon && (
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M11 9.10938C8.51211 9.10938 6.48828 11.1332 6.48828 13.6211C6.48828 16.109 8.51211 18.1328 11 18.1328C13.4879 18.1328 15.5117 16.109 15.5117 13.6211C15.5117 11.1332 13.4879 9.10938 11 9.10938ZM13.5781 14.2656H11C10.6442 14.2656 10.3555 13.9769 10.3555 13.6211V11.043C10.3555 10.6872 10.6442 10.3984 11 10.3984C11.3558 10.3984 11.6445 10.6872 11.6445 11.043V12.9766H13.5781C13.9339 12.9766 14.2227 13.2653 14.2227 13.6211C14.2227 13.9769 13.9339 14.2656 13.5781 14.2656Z" fill="#F56161"/>
                          <path d="M12.9336 0.644531C12.9336 0.28875 12.6448 0 12.2891 0C10.7963 0 10.2107 1.96281 9.74316 3.3868C9.41617 4.38238 8.92203 5.88672 8.42188 5.88672C8.03172 5.88672 7.77949 4.74117 7.77734 3.95312C7.77734 3.36102 7.04258 3.08301 6.65027 3.52602C4.61227 5.82828 2.62109 9.85316 2.62109 13.6211C2.62109 18.2037 6.34691 22 11 22C15.62 22 19.3789 18.2411 19.3789 13.6211C19.3789 8.23195 12.9336 4.16152 12.9336 0.644531ZM11 19.4219C7.80141 19.4219 5.19922 16.8197 5.19922 13.6211C5.19922 10.4225 7.80141 7.82031 11 7.82031C14.1986 7.82031 16.8008 10.4225 16.8008 13.6211C16.8008 16.8197 14.1986 19.4219 11 19.4219Z" fill="#F56161"/>
                        </svg>
                      )}
                      <span>{buttonText}</span>
                    </button>
                  </div>
                );
              })()}
              
              
              {isDatesPickerOpen && datesMenuPosition && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => {
                      setIsDatesPickerOpen(false);
                      setDatesMenuPosition(null);
                    }}
                  />
                  <div 
                    ref={datesRef} 
                    className="fixed bg-white rounded-2xl shadow-2xl p-4 z-[100] border border-gray-200 min-w-[300px]"
                    style={{
                      top: `${datesMenuPosition.top}px`,
                      left: `${datesMenuPosition.left}px`,
                      transform: 'translateY(-100%)',
                      marginTop: '-8px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-col gap-4">
                      {/* Дата начала */}
                      <div className="flex flex-col gap-2">
                        <span className="text-sm text-gray-600 font-medium">{t('taskViewModal.startDate')}</span>
                        <div className="flex items-start gap-2 w-full">
                          <div className={`relative transition-all duration-300 flex-1`}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newState = !isStartDateCalendarOpen;
                                setIsStartDateCalendarOpen(newState);
                                setIsEndDatePickerOpen(false);
                                setIsEndDateCalendarOpen(false);
                              }}
                              className="w-full flex items-center justify-start px-5 py-2 rounded-full border border-dream-primary text-dream-primary cursor-pointer hover:bg-dream-secondary transition-colors"
                            >
                              <span className="text-nowrap">{startDate ? (() => {
                                const [year, month, day] = startDate.split('-');
                                return `${day}.${month}.${year}`;
                              })() : t('taskViewModal.selectDate')}</span>
                            </button>
                            {isStartDateCalendarOpen && (
                              <div 
                                className="absolute bottom-full -left-4 mb-4 bg-white rounded-2xl border border-gray-200 p-4 w-75 z-[100]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Calendar
                                  initialDate={startDate ? new Date(startDate) : new Date()}
                                  onDayClick={async (day, date) => {
                                    const year = date.getFullYear();
                                    const month = String(date.getMonth() + 1).padStart(2, '0');
                                    const dayStr = String(day).padStart(2, '0');
                                    const newStartDate = `${year}-${month}-${dayStr}`;
                                    
                                    // Проверяем, что дата начала не позже даты окончания
                                    if (endDate) {
                                      const startDateObj = new Date(newStartDate);
                                      const endDateObj = new Date(endDate);
                                      startDateObj.setHours(0, 0, 0, 0);
                                      endDateObj.setHours(0, 0, 0, 0);
                                      if (startDateObj > endDateObj) {
                                        alert(t('taskViewModal.theStartDateCannotBeLaterThanT'));
                                        return;
                                      }
                                    }
                                    
                                    setStartDate(newStartDate);
                                    setIsStartDateCalendarOpen(false);
                                    
                                    // Автоматически сохраняем дату (с временем, если оно установлено, или с 00:00:00)
                                    const timeStr = startTime || '00:00';
                                    const [hours, minutes] = timeStr.split(':').map(Number);
                                    const dateObj = new Date(`${newStartDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
                                    const startDateTime = formatLocalDateTime(dateObj);
                                    try {
                                      const response = await crmTaskService.updateTask(task!._id, { startDate: startDateTime });
                                      if (response.success && response.data) {
                                        if (onTaskUpdate) onTaskUpdate(response.data);
                                      }
                                    } catch (error) {
                                      console.error(t('taskViewModal.errorAutosavingStartDate'), error);
                                    }
                                  }}
                                  showHeader={true}
                                />
                              </div>
                            )}
                          </div>
                          <div ref={startTimeRef} className={`relative transition-all duration-300 w-2/5`}>
                            <TimePickerDropdown
                              value={startTime || ''}
                              onChange={(val) => {
                                setStartTime(val);
                                setIsStartDateCalendarOpen(false);
                                setIsEndDatePickerOpen(false);
                                setIsEndDateCalendarOpen(false);
                                // Автоматически сохраняем при выборе времени
                                if (startDate) {
                                  setTimeout(() => {
                                    handleUpdateStartDate();
                                  }, 100);
                                }
                              }}
                              placeholder={t('taskViewModal.time')}
                              ariaLabel={t('taskViewModal.startTime')}
                              disabled={!startDate}
                              scrollToValue={startTime || undefined}
                            />
                          </div>
                        </div>
                      </div>
                      
                      {/* Дата окончания */}
                      <div className="flex flex-col gap-2">
                        <span className="text-sm text-gray-600 font-medium">{t('taskViewModal.endDate')}</span>
                        <div className="flex items-start gap-2 w-full">
                          <div className={`relative transition-all duration-300 flex-1`}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newState = !isEndDateCalendarOpen;
                                setIsEndDateCalendarOpen(newState);
                                setIsStartDateCalendarOpen(false);
                              }}
                              className="w-full flex items-center justify-start px-5 py-2 rounded-full border border-dream-primary text-dream-primary cursor-pointer hover:bg-dream-secondary transition-colors"
                            >
                              <span className="text-nowrap">{endDate ? (() => {
                                const [year, month, day] = endDate.split('-');
                                return `${day}.${month}.${year}`;
                              })() : t('taskViewModal.selectDate')}</span>
                            </button>
                            {isEndDateCalendarOpen && (
                              <div 
                                className="absolute bottom-full -left-4 mb-4 bg-white rounded-2xl border border-gray-200 p-4 w-75 z-[100]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Calendar
                                  initialDate={endDate ? new Date(endDate) : new Date()}
                                  onDayClick={async (day, date) => {
                                    const year = date.getFullYear();
                                    const month = String(date.getMonth() + 1).padStart(2, '0');
                                    const dayStr = String(day).padStart(2, '0');
                                    const newEndDate = `${year}-${month}-${dayStr}`;
                                    
                                    // Проверяем, что дата окончания не раньше даты начала
                                    const currentStartDateForCheck = startDate || (task?.startDate ? (() => {
                                      if (task.startDate.includes('T')) {
                                        return task.startDate.split('T')[0];
                                      } else {
                                        const startDateObj = parseDateFromAPI(task.startDate);
                                        if (!startDateObj) {
                                          console.error('Failed to parse startDate for validation:', task.startDate);
                                          return '';
                                        }
                                        return `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;
                                      }
                                    })() : '');
                                    if (currentStartDateForCheck) {
                                      const startDateObj = new Date(currentStartDateForCheck);
                                      const endDateObj = new Date(newEndDate);
                                      startDateObj.setHours(0, 0, 0, 0);
                                      endDateObj.setHours(0, 0, 0, 0);
                                      if (endDateObj < startDateObj) {
                                        alert(t('taskViewModal.theEndDateCannotBeEarlierThanT'));
                                        return;
                                      }
                                    }
                                    
                                    setEndDate(newEndDate);
                                    setIsEndDateCalendarOpen(false);
                                    
                                    // Если время уже установлено, автоматически сохраняем
                                    if (endTime) {
                                      if (task?._id && onUpdateTaskEndDate) {
                                        // Создаем Date объект и форматируем
                                        const dateOnly = newEndDate.includes('T') ? newEndDate.split('T')[0] : newEndDate;
                                        const [hours, minutes] = endTime.split(':').map(Number);
                                        const dateObj = new Date(`${dateOnly}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
                                        const endDateTime = formatLocalDateTime(dateObj);
                                        try {
                                          await onUpdateTaskEndDate(task._id, endDateTime);
                                          if (onTaskUpdate) {
                                            try {
                                              await new Promise(resolve => setTimeout(resolve, 200));
                                              const response = await crmTaskService.getTask(task._id);
                                              if (response.success && response.data) {
                                                onTaskUpdate(response.data);
                                              }
                                            } catch (error) {
                                              console.error('Failed to get updated task after date/time save:', error);
                                            }
                                          }
                                        } catch (error) {
                                          console.error(t('taskViewModal.autosaveError'), error);
                                        }
                                      }
                                    } else {
                                      if (task?._id && onUpdateTaskEndDate) {
                                        // Создаем Date объект и форматируем
                                        const dateOnly = newEndDate.includes('T') ? newEndDate.split('T')[0] : newEndDate;
                                        const dateObj = new Date(`${dateOnly}T00:00:00`);
                                        const endDateTime = formatLocalDateTime(dateObj);
                                        try {
                                          await onUpdateTaskEndDate(task._id, endDateTime);
                                          if (onTaskUpdate) {
                                            try {
                                              await new Promise(resolve => setTimeout(resolve, 200));
                                              const response = await crmTaskService.getTask(task._id);
                                              if (response.success && response.data) {
                                                onTaskUpdate(response.data);
                                              }
                                            } catch (error) {
                                              console.error('Failed to get updated task after date save:', error);
                                            }
                                          }
                                        } catch (error) {
                                          console.error(t('taskViewModal.errorAutosaveDate'), error);
                                        }
                                      }
                                    }
                                  }}
                                  showHeader={true}
                                />
                              </div>
                            )}
                          </div>
                          <div ref={endTimeRef} className={`relative transition-all duration-300 w-2/5`}>
                            <TimePickerDropdown
                              value={endTime || ''}
                              onChange={(val) => {
                                setEndTime(val);
                                setIsEndDateCalendarOpen(false);
                                setIsStartDateCalendarOpen(false);
                                // Автоматически сохраняем при выборе времени
                                if (endDate) {
                                  setTimeout(() => {
                                    handleUpdateEndDate();
                                  }, 100);
                                }
                              }}
                              placeholder={t('taskViewModal.time')}
                              ariaLabel={t('taskViewModal.endTime')}
                              disabled={!endDate}
                              disableBefore={startTime || undefined}
                              scrollToValue={endTime || undefined}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Имя клиента */}
            <div className="relative">
              {(() => {
                const leadId = task?.leadId;
                const lead = leadId && typeof leadId === 'object' 
                  ? leadId 
                  : (leadId && typeof leadId === 'string' ? leadsMap.get(leadId) : null);
                return lead?.name ? true : false;
              })() ? (
                <button
                  type="button"
                  onClick={() => setIsClientPickerOpen(!isClientPickerOpen)}
                  className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  {(() => {
                    const leadId = task?.leadId;
                    const lead = leadId && typeof leadId === 'object' 
                      ? leadId 
                      : (leadId && typeof leadId === 'string' ? leadsMap.get(leadId) : null);
                    const leadName = lead?.name || '';
                    return leadName ? (
                      <>
                        <div className="size-9 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                          <span className="text-sm font-normal text-gray-600">{leadName.charAt(0).toUpperCase()}</span>
                        </div>
                        <span>{leadName}</span>
                        <div></div>
                        <div></div>
                      </>
                    ) : (
                      <>
                        <div className="size-9 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                        </div>
                        <span></span>
                        <div></div>
                        <div></div>
                      </>
                    );
                  })()}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsClientPickerOpen(!isClientPickerOpen)}
                  className="flex items-center gap-2 text-gray-600 cursor-pointer hover:text-gray-800 transition-colors"
                >
                  <div className="size-9 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                    <span className="text-sm font-normal text-gray-600">+</span>
                  </div>
                  <span>{t('taskViewModal.addAClient')}</span>
                </button>
              )}
              
              {isClientPickerOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-[100]" 
                    onClick={() => setIsClientPickerOpen(false)}
                  />
                  <div className="absolute bottom-full -left-5 mb-2 bg-white rounded-2xl shadow-2xl p-4 z-[110] border border-gray-200 min-w-[200px]">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (task?._id) {
                            handleUpdateClient('');
                          }
                        }}
                        className={`flex items-center h-10 px-3 rounded-lg ${
                          !task?.clientName 
                            ? 'bg-dream-secondary text-dream-primary ring-2 ring-dream-primary' 
                            : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                        } cursor-pointer transition-colors`}
                      >
                        <span>{t('taskViewModal.withoutClient')}</span>
                      </button>
                      {Array.from(leadsMap.values()).map((lead) => {
                        const isSelected = task?.leadId && (
                          typeof task.leadId === 'string' 
                            ? task.leadId === lead._id
                            : task.leadId._id === lead._id
                        );
                        return (
                          <button
                            key={lead._id}
                            type="button"
                            onClick={() => {
                              handleUpdateClient(lead._id);
                            }}
                            className={`flex items-center h-10 px-3 rounded-lg ${
                              isSelected
                                ? 'bg-dream-secondary text-dream-primary ring-2 ring-dream-primary' 
                                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                            } cursor-pointer transition-colors`}
                          >
                            <span>{lead.name}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setIsClientPickerOpen(false);
                          setIsClientModalOpen(true);
                        }}
                        className="flex items-center h-10 px-3 rounded-lg bg-gray-50 text-dream-primary hover:bg-gray-100 cursor-pointer transition-colors border border-dream-primary border-dashed"
                      >
                        <span className='text-nowrap'>+ {t('taskViewModal.addClient')}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Параметры для звонка и встречи */}
          {(() => {
            const categoryName = task?.category ? categoriesMap.get(task.category) : '';
            const isCall = categoryName?.toLowerCase().includes(t('taskViewModal.call1'));
            const isMeeting = categoryName?.toLowerCase().includes(t('taskViewModal.meeting1'));
            
            if (!isCall && !isMeeting) return null;
            
            const leadId = task?.leadId;
            const lead: Lead | null = leadId && typeof leadId === 'object' 
              ? leadId as Lead
              : (leadId && typeof leadId === 'string' ? leadsMap.get(leadId) || null : null);
            
            const phone = lead?.phone || (typeof leadId === 'object' && 'phone' in leadId ? leadId.phone : '');
            const email = lead?.email || (typeof leadId === 'object' && 'email' in leadId ? (leadId as any).email : '');
            const leadName = lead?.name || (typeof leadId === 'object' && 'name' in leadId ? leadId.name : '');
            
            return (
              <div className="flex flex-col gap-0.5 mt-1.5 p-1.5 bg-dream-secondary/50 rounded-md border border-dream-primary/10 w-1/2">
                <div className="text-base font-normal text-gray-600">
                  {isCall ? [t('taskViewModal.call')]: t('taskViewModal.meeting')}
                </div>
                {isMeeting && leadName && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400 min-w-[50px]">{t('taskViewModal.fullName')}</span>
                    <span className="text-sm font-medium text-gray-700 truncate">{leadName}</span>
                  </div>
                )}
                {phone && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400 min-w-[50px]">{t('taskViewModal.tel')}</span>
                    <a 
                      href={`tel:${phone}`}
                      className="text-sm font-medium text-dream-primary hover:underline"
                    >
                      {phone}
                    </a>
                  </div>
                )}
                {email && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400 min-w-[50px]">Email:</span>
                    <a 
                      href={`mailto:${email}`}
                      className="text-sm font-medium text-dream-primary hover:underline truncate max-w-[200px]"
                    >
                      {email}
                    </a>
                  </div>
                )}
                {!phone && !email && (
                  <div className="text-sm text-gray-400 italic">{t('taskViewModal.noContacts')}</div>
                )}
              </div>
            );
          })()}

          <div className='flex items-center justify-end'>
            <Tooltip text={t('taskViewModal.deleteTask')} position="left">
              <button 
                type="button"
                onClick={() => setIsDeleteConfirmModalOpen(true)}
                className='flex items-center justify-center p-1.75 rounded-lg bg-[rgb(244,249,253)] cursor-pointer'
              >
                <svg width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="#ffb4ab"/>
                  <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="#ffb4ab"/>
                  <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="#ffb4ab"/>
                  <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="#ffb4ab"/>
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      
      {isRemoveColorConfirmOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsRemoveColorConfirmOpen(false)}>
          <div 
            className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-dream-primary text-lg font-normal">{t('taskViewModal.removingAColorMark')}</span>
              <button onClick={() => setIsRemoveColorConfirmOpen(false)} aria-label={t('taskViewModal.close')}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full">
                <p className="text-gray-800 text-lg mb-6 text-center">
                  {t('taskViewModal.removeColorConfirm').replace('{value}', task?.title ?? '')}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setIsRemoveColorConfirmOpen(false)}
                    className="flex-1 bg-white border-2 border-dream-primary rounded-full py-3 px-5 cursor-pointer"
                  >
                    <span className='text-dream-primary'>{t('taskViewModal.cancel1')}</span>
                  </button>
                  <button
                    onClick={() => {
                      handleUpdateColorLabel(undefined);
                      setIsRemoveColorConfirmOpen(false);
                    }}
                    className="flex-1 bg-dream-primary text-white rounded-full py-3 px-5 cursor-pointer"
                  >{t('taskViewModal.delete')}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isColorPaletteModalOpen && (
        <ColorPaletteModal
          isOpen={isColorPaletteModalOpen}
          onClose={() => setIsColorPaletteModalOpen(false)}
          colorPalette={colorPalette}
          selectedColor={task?.colorLabel || ''}
          onSelectColor={(color) => {
            handleUpdateColorLabel(color);
            setIsColorPaletteModalOpen(false);
          }}
          onOpenColorModal={() => {
            setIsColorPaletteModalOpen(false);
            setIsColorModalOpen(true);
          }}
        />
      )}

      {isColorModalOpen && (
        <ColorModal
          isOpen={isColorModalOpen}
          onClose={() => setIsColorModalOpen(false)}
          newColorHex={newColorHex}
          setNewColorHex={setNewColorHex}
          onAddColor={(hex) => {
            if (!hex) return;
            setColorPalette((prev) => prev.includes(hex) ? prev : [...prev, hex]);
            handleUpdateColorLabel(hex);
            setIsColorModalOpen(false);
          }}
        />
      )}

      {isDeleteConfirmModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsDeleteConfirmModalOpen(false)}>
          <div 
            className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-dream-primary text-lg font-normal">{t('taskViewModal.deletionConfirmation')}</span>
              <button onClick={() => setIsDeleteConfirmModalOpen(false)} aria-label={t('taskViewModal.close')}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full">
                <p className="text-gray-800 text-lg mb-6 text-center">
                  {t('taskViewModal.deleteTaskConfirm').replace('{value}', task?.title ?? '')}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setIsDeleteConfirmModalOpen(false)}
                    className="flex-1 bg-white border-2 border-dream-primary rounded-full py-3 px-5 cursor-pointer"
                  >
                    <span className='text-dream-primary'>{t('taskViewModal.cancel1')}</span>
                  </button>
                  <button
                    onClick={handleDeleteTask}
                    className="flex-1 bg-dream-primary text-white rounded-full py-3 px-5 cursor-pointer"
                  >{t('taskViewModal.delete')}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {isClientModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsClientModalOpen(false)}>
          <div 
            className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-dream-primary text-lg font-normal">{t('taskViewModal.newClient')}</span>
              <button onClick={() => setIsClientModalOpen(false)} aria-label={t('taskViewModal.close')}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full max-w-md">
                <div className="relative w-full mb-6">
                  <input
                    type="text"
                    placeholder={t('taskViewModal.fullName1')}
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddClient();
                      }
                    }}
                    className="w-full border-2 border-dream-primary bg-dream-secondary rounded-full pl-5 pr-5 py-3 focus:outline-none text-lg"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleAddClient}
                  className="w-full bg-dream-primary text-white rounded-full py-3 px-5 hover:bg-green-700 transition-colors text-lg font-normal"
                >
                  {t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isUnsavedChangesModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[110] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={handleDiscardChanges}>
          <div 
            className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-dream-primary text-lg font-normal">{t('taskViewModal.unsavedChanges')}</span>
              <button
                onClick={handleDiscardChanges}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={t('taskViewModal.close')}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full">
                <p className="text-gray-800 text-lg mb-6 text-center">
                  {t('taskViewModal.saveChangesTitle')}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={handleDiscardChanges}
                    className="flex-1 bg-gray-200 text-gray-800 rounded-full py-3 px-5 hover:bg-gray-300 transition-colors text-lg font-normal"
                  >
                    {t('common.no')}
                  </button>
                  <button
                    onClick={handleSaveAndClose}
                    className="flex-1 bg-dream-primary text-white rounded-full py-3 px-5 hover:bg-green-700 transition-colors text-lg font-normal"
                  >
                    {t('common.yes')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(TaskViewModalComponent, (prevProps, nextProps) => {
  if (!nextProps.isOpen && !prevProps.isOpen) return true;
  if (nextProps.isOpen !== prevProps.isOpen) return false;
  if (!prevProps.isOpen && nextProps.isOpen) return false;

  if (nextProps.isOpen && prevProps.isOpen) {
    const prevTask = prevProps.task;
    const nextTask = nextProps.task;
    if (!prevTask && !nextTask) return true;
    if (!prevTask || !nextTask) return false;
    if (prevTask._id !== nextTask._id) return false;

    const fieldsToCompare: (keyof typeof prevTask)[] = [
      '_id', 'title', 'description', 'status', 'priority', 'colorLabel',
      'subtasks', 'clientName', 'category', 'categories', 'startDate'
    ];

    for (const field of fieldsToCompare) {
      if (JSON.stringify(prevTask[field]) !== JSON.stringify(nextTask[field])) {
        return false;
      }
    }
    return true;
  }

  return false;
});
