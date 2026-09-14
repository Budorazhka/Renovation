import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { useDisableScroll } from '../../hooks/useDisableScroll';
import type { FavoriteObject, Lead, Task, LeadHistory } from '../../services/api';
import { LeadStage, ProductType, TaskPriority, TaskStatus, LEAD_ROLE_LABEL } from '../../services/api';
import { apiService } from '../../services/api';
import TaskCard, { type ModalTaskData } from './TaskCard';
import CreateClientModal from './CreateClientModal';
import TaskViewModal from './TaskViewModal';
import LeadStageChecklist, { getChecklistTotal } from './LeadStageChecklist';
import Tooltip from '../common/Tooltip';
import { DataSyncManager } from '../../utils/dataSync';
import { flushLeadHistory } from '../../utils/leadHistoryDebounce';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { 
  FileText, 
  Image as ImageIcon, 
  File, 
  Music, 
  Video, 
  Archive, 
  FileSpreadsheet
} from 'lucide-react';
import { NotesEditor } from './NotesEditor';
import { parseDateFromAPI } from '../../utils/dateUtils';
import { useI18n } from '@/i18n';
import { leadsApiV2 } from '@/services/leadsApiV2';
import type { LeadEventV2 } from '@/types/leadsV2';
import { tasksApiV2 } from '@/services/tasksApiV2';
import { mediaApiV2 } from '@/services/mediaApiV2';
import { mapLeadV2ToCrmLead, mapLeadEventsV2ToLegacyHistory, buildStageCommentsMap, stageCrmToV2 } from '@/lib/lead-v2-legacy-adapter';
import { mapTaskV2ToCrmTask } from '@/lib/task-v2-legacy-adapter';
import { isDisplayableTaskV2 } from '@/lib/map-task-v2';

const normalizeFavoriteLabel = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value
    .split(/[\s-_]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(' ');
};

const FAVORITE_PLACEHOLDER_IMAGE =
  'https://batumicenter.com/wp-content/uploads/2018/10/batumivilla2.jpg';

interface LeadViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onOpenNewTaskModal?: (leadId: string) => void;
  onOpenTaskManagementModal?: () => void;
  initialTab?: 'tasks' | 'objects' | 'info' | 'history';
  onLeadDeleted?: (leadId: string) => void;
  onUpdateLeadAfterSync?: (leadId: string, syncedLead: Lead) => void;
}

const LeadViewModal: React.FC<LeadViewModalProps> = ({ isOpen, onClose, lead, onOpenNewTaskModal, onOpenTaskManagementModal, initialTab = 'history', onLeadDeleted, onUpdateLeadAfterSync }) => {
  useDisableScroll(isOpen);
  const { t } = useI18n();
  const formatMessage = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, String(value)), template);

  // DataSyncManager для отслеживания изменений и блокировки обновлений после ручного изменения
  const syncManagerRef = useRef(new DataSyncManager<Lead>());
  const isInitializedRef = useRef(false);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousLeadIdRef = useRef<string | undefined>(lead?._id);
  /**
   * `[phase 3]` version лида на новом backend (apps/api) — обязателен как
   * expectedVersion в PATCH .../stage (CAS, см. leadsApiV2.changeStage
   * докстринг). Тот же паттерн кэширования, что LeadsContext.leadVersions:
   * читается при каждом getById и после каждого успешного changeStage.
   */
  const leadVersionRef = useRef<number | undefined>(undefined);
  /** `[phase 3]` Последний прочитанный список событий (переходов стадии) — источник и для leadHistory, и для stageCommentsMap, без двойного запроса. */
  const leadEventsRef = useRef<LeadEventV2[]>([]);
  /** `[phase 3]` version задач лида на новом backend — expectedVersion для complete/setStatus/setDueAt (CAS). */
  const taskVersionsRef = useRef<Map<string, number>>(new Map());

  // Локальное состояние для lead, чтобы обновлять его после изменений
  const [localLead, setLocalLead] = useState<Lead | null>(lead);

  // Константы для ползунка (не зависят от lead)



  // Используем localLead вместо lead для отображения, чтобы видеть обновления сразу
  const displayLead = localLead || lead;
  const callButtonRef = useRef<HTMLButtonElement | null>(null);
  const callIconRef = useRef<HTMLButtonElement | null>(null);
  const callMenuRef = useRef<HTMLDivElement | null>(null);
  const [showCallMenu, setShowCallMenu] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const writeButtonRef = useRef<HTMLButtonElement | null>(null);
  const writeMenuRef = useRef<HTMLDivElement | null>(null);
  const [showWriteMenu, setShowWriteMenu] = useState(false);
  const [writeMenuAnchorRect, setWriteMenuAnchorRect] = useState<DOMRect | null>(null);

  const handleCopyNumber = async () => {
    if (!displayLead?.phone) return;
    try {
      await navigator.clipboard?.writeText(displayLead.phone);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = displayLead.phone;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } finally {
      setShowCallMenu(false);
    }
  };

  const handleOpenWhatsApp = () => {
    if (!displayLead?.phone) return;
    // Очищаем номер от всех символов кроме цифр
    const cleanPhone = displayLead.phone.replace(/\D/g, '');
    // Если номер начинается с 8, заменяем на 7 (российский формат)
    const formattedPhone = cleanPhone.startsWith('8') ? '7' + cleanPhone.slice(1) : cleanPhone;
    // Открываем WhatsApp
    window.open(`https://wa.me/${formattedPhone}`, '_blank');
    setShowCallMenu(false);
  };

  const toggleCallMenu = (triggerRef: HTMLButtonElement | null) => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const prevRect = anchorRect;
    setAnchorRect(rect);
    setShowCallMenu((prev) =>
      prev && prevRect && prevRect.left === rect.left && prevRect.top === rect.top ? false : true
    );
  };

  const toggleWriteMenu = (triggerRef: HTMLButtonElement | null) => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const prevRect = writeMenuAnchorRect;
    setWriteMenuAnchorRect(rect);
    setShowWriteMenu((prev) =>
      prev && prevRect && prevRect.left === rect.left && prevRect.top === rect.top ? false : true
    );
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showCallMenu) return;
      if (
        callButtonRef.current?.contains(event.target as Node) ||
        callIconRef.current?.contains(event.target as Node) ||
        callMenuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setShowCallMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCallMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showWriteMenu) return;
      if (
        writeButtonRef.current?.contains(event.target as Node) ||
        writeMenuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setShowWriteMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showWriteMenu]);

  const formatPrice = useCallback((value?: number | string): string | null => {
    if (value === undefined || value === null) return null;
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(numericValue)) return null;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(numericValue);
  }, []);




  

  const [selectedTab, setSelectedTab] = useState<'tasks' | 'objects' | 'info' | 'history'>(initialTab);
  
  // Функция для безопасного закрытия модалки
  const handleClose = useCallback(() => {
    // Сохраняем незаписанные изменения истории перед закрытием
    if (displayLead?._id) {
      flushLeadHistory(displayLead._id).then(() => {
        onClose();
      }).catch(() => {
        onClose(); // Закрываем даже если flush не удался
      });
    } else {
      onClose();
    }
  }, [displayLead?._id, onClose]);
  const [leadTasks, setLeadTasks] = useState<Task[]>([]);
  const [taskChecked, setTaskChecked] = useState<boolean[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [selectedTaskForView, setSelectedTaskForView] = useState<string | null>(null);
  const [isTaskViewModalOpen, setIsTaskViewModalOpen] = useState(false);
  const [currentTaskForModal, setCurrentTaskForModal] = useState<Task | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ filename: string; originalName: string; mimeType: string; size: number; url: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionText, setDescriptionText] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [favoriteObjects, setFavoriteObjects] = useState<FavoriteObject[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [hasAttemptedFavorites, setHasAttemptedFavorites] = useState(false);
  const [lightboxImages,] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [leadHistory, setLeadHistory] = useState<Array<LeadHistory | {
    type: 'stage_comment';
    stage: LeadStage;
    stageName: string;
    comment: string;
    createdAt: string;
    updatedAt: string;
    createdBy: {
      _id: string;
      name: string;
      email: string;
    };
    updatedBy?: {
      _id: string;
      name: string;
      email: string;
    };
  }>>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  // Map для хранения комментариев к этапам: stage -> comment
  const [stageCommentsMap, setStageCommentsMap] = useState<Map<LeadStage, string>>(new Map());
  // Счетчики заполненных пунктов чек-листа для каждого этапа
  const [checkedItemsCounts, setCheckedItemsCounts] = useState<Record<string, number>>({});

  const decodeFilename = (name?: string): string => {
    if (!name) return '';
    try {
      return decodeURIComponent(escape(name)) || name;
    } catch {
      return name;
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

  const navigateLightbox = useCallback(
    (delta: number) => {
      if (lightboxImages.length === 0) return;
      setLightboxIndex((prev) => (prev + lightboxImages.length + delta) % lightboxImages.length);
    },
    [lightboxImages.length]
  );

  const handlePrevLightbox = () => navigateLightbox(-1);
  const handleNextLightbox = () => navigateLightbox(1);
  const closeLightbox = () => setIsLightboxOpen(false);

  // Инициализируем DataSyncManager при первом получении lead
  useEffect(() => {
    if (lead && !isInitializedRef.current) {
      syncManagerRef.current.initialize([lead]);
      isInitializedRef.current = true;
      setLocalLead(lead);
    } else if (lead) {
      // Если lead изменился, обновляем в syncManager
      const manager = syncManagerRef.current;
      if (!manager.getData().find(l => l._id === lead._id)) {
        manager.initialize([lead]);
      }
      setLocalLead(lead);
    } else {
      setLocalLead(null);
      isInitializedRef.current = false;
    }
  }, [lead?._id]);

  // Функция для загрузки данных лида из API
  const loadLeadFromAPI = useCallback(async () => {
    if (!displayLead?._id) return;

    try {
      const leadV2 = await leadsApiV2.getById(displayLead._id);
      leadVersionRef.current = leadV2.version;
      const mappedLead = mapLeadV2ToCrmLead(leadV2);
      {
        const manager = syncManagerRef.current;
        // Используем syncFromBackend для безопасного обновления (блокировка на 3 секунды после ручного изменения)
        const { data: synced, hasChanges } = manager.syncFromBackend([mappedLead], 3000, 30000);
        if (hasChanges && synced.length > 0) {
          const updatedLead = synced[0];
          // Обновляем состояние только если данные действительно изменились
          setLocalLead(prevLead => {
            if (!prevLead) return updatedLead;
            // Сравниваем критичные поля, которые влияют на отображение
            // Используем JSON.stringify для глубокого сравнения только важных полей
            const prevKey = JSON.stringify({
              _id: prevLead._id,
              stage: prevLead.stage,
              historyLength: prevLead.history?.length || 0,
              notesLength: prevLead.notes?.length || 0,
              history: prevLead.history?.slice(-3), // Последние 3 записи истории
            });
            const newKey = JSON.stringify({
              _id: updatedLead._id,
              stage: updatedLead.stage,
              historyLength: updatedLead.history?.length || 0,
              notesLength: updatedLead.notes?.length || 0,
              history: updatedLead.history?.slice(-3), // Последние 3 записи истории
            });
            if (prevKey === newKey) {
              return prevLead; // Возвращаем предыдущее состояние, чтобы избежать ре-рендера
            }
            return updatedLead;
          });
        }
      }
    } catch (error) {
      console.error('[LeadViewModal] Failed to load lead from API:', error);
    }
  }, [displayLead?._id]);

  // Периодическое обновление данных лида из API (только при активности пользователя)
  useEffect(() => {
    if (!isOpen || !displayLead?._id) {
      // Останавливаем обновление, если модалка закрыта или нет лида
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
      return;
    }

    // Загружаем данные сразу при открытии
    loadLeadFromAPI();

    // Проверяем, активна ли вкладка/окно перед запросом
    const isWindowActive = () => {
      return !document.hidden && document.hasFocus();
    };

    // Устанавливаем периодическое обновление каждые 1.5 секунды
    const interval = setInterval(() => {
      // Делаем запрос только если окно активно
      if (isWindowActive()) {
        loadLeadFromAPI();
      }
    }, 1500); // Обновление каждые 1.5 секунды

    autoRefreshIntervalRef.current = interval;

    // Также обновляем при возврате фокуса на окно
    const handleFocus = () => {
      if (isOpen && displayLead?._id) {
        loadLeadFromAPI();
      }
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
      window.removeEventListener('focus', handleFocus);
    };
  }, [isOpen, displayLead?._id, loadLeadFromAPI]);


  // Сбрасываем режим редактирования описания только при смене лида (не при обновлении данных того же лида)
  useEffect(() => {
    // Сбрасываем только если изменился ID лида (открыли другой лид), а не при обновлении данных
    if (lead && lead._id !== previousLeadIdRef.current) {
      setIsEditingDescription(false);
      setDescriptionText('');
      previousLeadIdRef.current = lead._id;
    }
  }, [lead?._id]);

  // Ref для отслеживания, была ли вкладка установлена пользователем
  const userSelectedTabRef = useRef<boolean>(false);
  
  // Обновляем вкладку при открытии модалки или изменении initialTab
  useEffect(() => {
    if (isOpen) {
      // На мобильных всегда открываем вкладку "info" (Заметки о клиенте)
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
      if (isMobile) {
        setSelectedTab('info');
        userSelectedTabRef.current = false;
      } else if (initialTab && !userSelectedTabRef.current) {
        // Устанавливаем initialTab только если пользователь еще не выбирал вкладку
        setSelectedTab(initialTab);
      }
    } else {
      // Сбрасываем флаг при закрытии модалки
      userSelectedTabRef.current = false;
    }
  }, [isOpen, initialTab]);
  

  useEffect(() => {
    if (!isOpen || selectedTab !== 'objects') return;

    const leadEmail = displayLead?.email?.trim();
    if (!leadEmail) {
      setFavoriteObjects([]);
      setFavoritesError(null);
      setIsLoadingFavorites(false);
      setHasAttemptedFavorites(true);
      return;
    }

    const fetchFavorites = async () => {
      setIsLoadingFavorites(true);
      setFavoritesError(null);
      setHasAttemptedFavorites(false);
      setFavoriteObjects([]);

      try {
        const favorites = await apiService.getUserFavorites(leadEmail);
        setFavoriteObjects(favorites);
      } catch (error) {
        console.error('[LeadViewModal] Failed to load favorite objects:', error);
        setFavoriteObjects([]);
        setFavoritesError(t('leadViewModal.favoritesCouldNotBeLoaded'));
      } finally {
        setIsLoadingFavorites(false);
        setHasAttemptedFavorites(true);
      }
    };

    fetchFavorites();
  }, [displayLead?.email, isOpen, selectedTab]);

  // Функции для работы с файлами лида
  // `filename` в этом состоянии — assetId файла на новом backend (см.
  // leadsApiV2.listFiles/CrmLeadFileReadModel докстринг: сервер не хранит
  // клиентское имя файла отдельно от assetId), не storage key, как было в
  // легаси. Используется как есть везде, где раньше был storage key
  // (скачивание/удаление по нему) — вёрстка не меняется.
  const loadLeadFiles = useCallback(async () => {
    if (!displayLead?._id) {
      setFiles([]);
      return;
    }

    try {
      const leadFiles = await leadsApiV2.listFiles(displayLead._id);
      setFiles(leadFiles.map((file) => ({
        filename: file.assetId,
        originalName: file.fileName,
        mimeType: file.mimeType ?? '',
        size: file.sizeBytes,
        url: file.url ?? '',
      })));
    } catch (error) {
      console.error('Failed to load lead files:', error);
      setFiles([]);
    }
  }, [displayLead?._id]);

  const handleDeleteFile = useCallback(async (assetId: string) => {
    if (!displayLead?._id) return;

    try {
      await leadsApiV2.removeFile(displayLead._id, assetId);
      await loadLeadFiles();
    } catch (error: any) {
      console.error('Failed to delete file:', error);
      setUploadError(error.response?.data?.message || t('leadViewModal.errorDeletingFile'));
    }
  }, [displayLead?._id, loadLeadFiles]);

  const handleDownloadFile = useCallback((file: { filename: string; originalName: string; mimeType: string; size: number; url: string }) => {
    window.open(file.url, '_blank');
  }, []);

  // Загрузка файлов при открытии модалки
  useEffect(() => {
    if (isOpen && displayLead?._id) {
      loadLeadFiles();
    } else if (!isOpen) {
      setFiles([]);
      setUploadError(null);
    }
  }, [isOpen, displayLead?._id, loadLeadFiles]);

  const dedupeHistoryItems = useCallback((
    items: Array<LeadHistory | {
      type: 'stage_comment';
      stage: LeadStage;
      stageName: string;
      comment: string;
      createdAt: string;
      updatedAt: string;
      createdBy: {
        _id: string;
        name: string;
        email: string;
      };
      updatedBy?: {
        _id: string;
        name: string;
        email: string;
      };
    }>
  ) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      let key = '';
      if ('_id' in item && item._id) {
        key = String((item as any)._id);
      } else if ('fromStage' in item && 'toStage' in item) {
        key = `${item.fromStage}-${item.toStage}-${item.changedAt}`;
      } else {
        const time = ('changedAt' in item && (item as any).changedAt) || ('createdAt' in item && (item as any).createdAt) || '';
        const message = (item as any).message || (item as any).comment || '';
        key = `${message}-${time}`;
      }
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, []);

  /**
   * `[phase 3]` Легаси getLeadHistory/getStageComments → одна загрузка
   * GET /leads/:id/events (переходы стадии, каждый уже несёт свой comment,
   * см. lead.controller.ts докстринг ChangeLeadStageDto.comment). События
   * приходят от сервера отсортированными по убыванию времени — тот же
   * порядок, что легаси-сортировка ниже. Результат кэшируется в
   * leadEventsRef, чтобы loadStageComments не делал второй запрос.
   *
   * Честный пробел: этот эндпоинт ведёт ТОЛЬКО историю переходов стадии —
   * записи о создании/завершении/удалении задач (легаси addLeadHistoryEntry
   * из handleTaskStatusChange/handleDeleteTask и колбэков TaskViewModal)
   * сервер не хранит вовсе. Не восстановлено даже локально: эти записи уже
   * были невидимы в этой вкладке ДО миграции (см. фильтр isTask ниже —
   * сообщения, начинающиеся с "Задача", исключались из leadHistory ещё в
   * легаси-версии), поэтому их отсутствие не меняет то, что видит пользователь.
   */
  const loadLeadHistoryData = useCallback(async () => {
    if (!displayLead?._id) {
      leadEventsRef.current = [];
      return [];
    }

    try {
      const response = await leadsApiV2.listEvents(displayLead._id, { limit: 100 });
      leadEventsRef.current = response.items;
      return dedupeHistoryItems(mapLeadEventsV2ToLegacyHistory(response.items));
    } catch (error) {
      console.error('Failed to load lead history:', error);
      leadEventsRef.current = [];
      return [];
    }
  }, [displayLead?._id, dedupeHistoryItems]);

  // Комментарии к этапам — построены из уже загруженных событий (см. loadLeadHistoryData), без отдельного запроса.
  const loadStageComments = useCallback(async () => {
    if (!displayLead?._id) {
      return;
    }
    setStageCommentsMap(buildStageCommentsMap(leadEventsRef.current));
  }, [displayLead?._id]);

  // Функция загрузки истории лида с комментариями
  const loadLeadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    const history = await loadLeadHistoryData();
    // Загружаем комментарии к этапам параллельно
    await loadStageComments();
    // Фильтруем записи: оставляем реальные смены этапов и записи об изменении информации
    const filteredHistory = history.filter((item) => {
      const isStageComment = 'type' in item && item.type === 'stage_comment';
      const historyMessage = (item as any).message || item.comment || '';
      const isTask = historyMessage.trim().startsWith(t('leadViewModal.task'));
      const hasStageFields = 'fromStage' in item && 'toStage' in item;
      // Оставляем реальные смены этапов (fromStage !== toStage)
      const isStageChange = hasStageFields && item.fromStage !== item.toStage;
      // Исключаем записи без смены этапа (Lead created, системные записи и т.д.)
      const isSameStageEntry = hasStageFields && item.fromStage === item.toStage;
      // Оставляем записи без полей этапов (обычные записи истории об изменении информации)
      const hasNoStageFields = !hasStageFields;
      
      return !isStageComment && !isTask && (isStageChange || hasNoStageFields) && !isSameStageEntry;
    });
    setLeadHistory(filteredHistory);
    setIsLoadingHistory(false);
  }, [loadLeadHistoryData, loadStageComments]);

  // Автообновление истории лида каждые 1.5 секунды
  useAutoRefresh({
    fetchData: async () => {
      const history = await loadLeadHistoryData();
      await loadStageComments();
      // Фильтруем записи: оставляем реальные смены этапов и записи об изменении информации
      return dedupeHistoryItems(history).filter((item) => {
        const isStageComment = 'type' in item && item.type === 'stage_comment';
        const historyMessage = (item as any).message || item.comment || '';
        const isTask = historyMessage.trim().startsWith(t('leadViewModal.task'));
        const hasStageFields = 'fromStage' in item && 'toStage' in item;
        // Оставляем реальные смены этапов (fromStage !== toStage)
        const isStageChange = hasStageFields && item.fromStage !== item.toStage;
        // Исключаем записи без смены этапа (Lead created, системные записи и т.д.)
        const isSameStageEntry = hasStageFields && item.fromStage === item.toStage;
        // Оставляем записи без полей этапов (обычные записи истории об изменении информации)
        const hasNoStageFields = !hasStageFields;
        
        return !isStageComment && !isTask && (isStageChange || hasNoStageFields) && !isSameStageEntry;
      });
    },
    onDataUpdate: (newHistory) => {
      setLeadHistory(newHistory);
    },
    compareFn: (oldHistory, newHistory) => {
      if (oldHistory.length !== newHistory.length) return false;
      return oldHistory.every((old, index) => {
        const newItem = newHistory[index];
        const oldId = '_id' in old ? old._id : 'changedAt' in old ? `history_${old.changedAt}` : '';
        const newId = '_id' in newItem ? newItem._id : 'changedAt' in newItem ? `history_${newItem.changedAt}` : '';
        return oldId === newId;
      });
    },
    interval: 1500,
    enabled: selectedTab === 'info' && !!displayLead?._id && isOpen,
  });

  // Загрузка истории при открытии вкладки history
  useEffect(() => {
    if (selectedTab === 'history' && displayLead?._id && isOpen) {
      loadLeadHistory();
    } else if (selectedTab !== 'history') {
      setLeadHistory([]);
    }
  }, [selectedTab, displayLead?._id, isOpen, loadLeadHistory]);

  // Функция подсчета заполненных пунктов чек-листа для этапа
  const getCheckedItemsCount = useCallback((stage: LeadStage, leadId: string): number => {
    let count = 0;
    // Используем localStorage для подсчета отмеченных пунктов
    for (let i = 0; i < 50; i++) { // Максимальное количество пунктов в чек-листе
      const key = `checklist_${leadId}_${stage}_${i}`;
      if (localStorage.getItem(key) === 'true') {
        count++;
      }
    }
    return count;
  }, []);

  // Обновление счетчиков при изменении чек-листа
  useEffect(() => {
    if (!displayLead?._id || selectedTab !== 'history') return;
    
    const updateCounts = () => {
      const newCounts: Record<string, number> = {};
      leadHistory.forEach((historyItem, idx) => {
        if ('fromStage' in historyItem && 'toStage' in historyItem) {
          const isLeadCreated = historyItem.fromStage === historyItem.toStage && 
            (historyItem.toStage === LeadStage.NEEDS_ANALYSIS || 
             historyItem.toStage === LeadStage.NETWORK_NEW_LEAD);
          if (!isLeadCreated) {
            const key = `${historyItem.toStage}_${idx}`;
            newCounts[key] = getCheckedItemsCount(historyItem.toStage, displayLead._id);
          }
        }
      });
      setCheckedItemsCounts(newCounts);
    };
    
    updateCounts();
    window.addEventListener('checklistUpdated', updateCounts);
    return () => {
      window.removeEventListener('checklistUpdated', updateCounts);
    };
  }, [leadHistory, displayLead?._id, getCheckedItemsCount, selectedTab]);

  /**
   * `[phase 3]` GET /tasks?leadId=... уже фильтрует на сервере — легаси
   * client-side разбор трёх форм `task.leadId` (строка/объект/id) больше не
   * нужен. Отменённые задачи (см. handleDeleteTask/onDeleteTask ниже —
   * "удаление" задачи теперь = отмена, DELETE /tasks/:id не существует)
   * исключаются тем же принципом, что `isDisplayableTaskV2` на экране
   * /dashboard/tasks: для этого экрана отменённая задача обязана выглядеть
   * как удалённая, а не воскресать при следующем автообновлении.
   */
  const loadTasksData = useCallback(async (): Promise<Task[]> => {
    if (!displayLead?._id) {
      taskVersionsRef.current = new Map();
      return [];
    }

    try {
      const { items, complete } = await tasksApiV2.listAll({ leadId: displayLead._id });
      if (!complete) {
        console.warn('[LeadViewModal] Показаны не все задачи лида — упёрлись в предел страниц (tasksApiV2.listAll)');
      }
      const visible = items.filter(isDisplayableTaskV2);
      taskVersionsRef.current = new Map(visible.map((task) => [task.id, task.version]));
      return visible.map(mapTaskV2ToCrmTask);
    } catch (error) {
      console.error('[LeadViewModal] Failed to load tasks:', error);
      return [];
    }
  }, [displayLead?._id]);

  // Функция загрузки задач
  const loadTasks = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoadingTasks(true);
    }
    
    const tasks = await loadTasksData();
    setLeadTasks(tasks);
    setTaskChecked(tasks.map(task => task.status === TaskStatus.COMPLETED));
    
    if (showLoading) {
      setIsLoadingTasks(false);
    }
  }, [loadTasksData]);

  // Автообновление задач каждые 1.5 секунды
  useAutoRefresh({
    fetchData: loadTasksData,
    onDataUpdate: (newTasks) => {
      setLeadTasks(newTasks);
      setTaskChecked(newTasks.map(task => task.status === TaskStatus.COMPLETED));
    },
    compareFn: (oldTasks, newTasks) => {
      if (oldTasks.length !== newTasks.length) return false;
      return oldTasks.every((old, index) => {
        const newTask = newTasks[index];
        return old._id === newTask._id && 
               old.status === newTask.status &&
               old.title === newTask.title &&
               JSON.stringify(old.subtasks) === JSON.stringify(newTask.subtasks);
      });
    },
    interval: 1500,
    enabled: (selectedTab === 'tasks' || selectedTab === 'history') && !!displayLead?._id && isOpen,
  });

  // Загрузка задач при открытии вкладки или изменении лида
  useEffect(() => {
    if ((selectedTab === 'tasks' || selectedTab === 'history') && displayLead?._id) {
      loadTasks(selectedTab === 'tasks');
    } else {
      setLeadTasks([]);
      setTaskChecked([]);
    }
  }, [selectedTab, displayLead?._id, loadTasks]);

  // Автообновление задач обрабатывается через useAutoRefresh выше

  // Преобразование задач в формат ModalTaskData
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
          return { urgency: 'notUrgent' as const, importance: 'notImportant' as const };
        default:
          return { urgency: 'notUrgent' as const, importance: 'notImportant' as const };
      }
    };

    const { urgency, importance } = priorityToUrgencyImportance(task.priority);
    const icons: Array<'redLightning' | 'yellowBookmark'> = [];
    if (urgency === 'urgent') icons.push('redLightning');
    if (importance === 'important') icons.push('yellowBookmark');

    // Используем актуальное имя лида вместо старого task.clientName
    // Проверяем displayLead, затем task.leadId.name, затем task.clientName
    let clientName: string | undefined = displayLead?.name;
    let phone: string | undefined = (displayLead as any)?.phone;
    if (!clientName && task.leadId && typeof task.leadId === 'object' && (task.leadId as any).name) {
      clientName = (task.leadId as any).name;
      phone = (task.leadId as any).phone || phone;
    }
    if (!clientName) {
      clientName = task.clientName;
    }
    if (!phone && task.leadId && typeof task.leadId === 'object') {
      phone = (task.leadId as any).phone;
    }

    // Получаем назначенных пользователей
    let assignedUsers: Array<{ name: string; image?: string }> | undefined = undefined;
    if (task.assignedTo && typeof task.assignedTo === 'object') {
      const assignedToObj = task.assignedTo as any;
      assignedUsers = [{
        name: assignedToObj.name || '',
        image: assignedToObj.image || assignedToObj.avatar || undefined,
      }];
    }

    // Определяем тип задачи по категории (если доступно)
    let taskType: 'standard' | 'call' | 'meeting' = 'standard';
    let workType: 'work' | 'personal' | undefined = undefined;
    if (task.categories && Array.isArray(task.categories)) {
      const hasCall = task.categories.some(cat => 
        cat.toLowerCase().includes(t('leadViewModal.call')) || cat.toLowerCase().includes('call')
      );
      const hasMeeting = task.categories.some(cat => 
        cat.toLowerCase().includes(t('leadViewModal.meeting')) || cat.toLowerCase().includes('meeting')
      );
      const hasWork = task.categories.some(cat => cat.includes(t('leadViewModal.workTasks')));
      const hasPersonal = task.categories.some(cat => cat.includes(t('leadViewModal.personalTasks')));
      
      if (hasCall) {
        taskType = 'call';
      } else if (hasMeeting) {
        taskType = 'meeting';
      }
      
      if (hasWork) {
        workType = 'work';
      } else if (hasPersonal) {
        workType = 'personal';
      }
    }

    return {
      id: task._id,
      title: task.title,
      dateTime: task.endDate ? (() => {
        const parsed = parseDateFromAPI(task.endDate);
        return parsed ? parsed.toLocaleDateString('ru-RU') : t('leadCard.noDeadline');
      })() : t('leadCard.noDeadline'),
      dateTimeColor: 'gray',
      startDate: task.startDate,
      endDate: task.endDate,
      progress: {
        current: task.subtasks?.filter(s => s.completed).length || 0,
        total: task.subtasks?.length || 0,
        completed: task.status === TaskStatus.COMPLETED
      },
      icons,
      colorLabel: task.colorLabel,
      user: clientName ? { name: clientName, image: '' } : undefined,
      phone,
      assignedUsers,
      urgency,
      importance,
      taskType,
      workType,
      files: task.files?.map(file => ({
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url
      })),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }, [displayLead]);

  const modalTasksData = useMemo(() => {
    return leadTasks.map(transformTaskToModalData);
  }, [leadTasks, transformTaskToModalData]);

  // Эффект для установки текущей задачи для модалки (как в TasksGridModal)
  useEffect(() => {
    if (!selectedTaskForView || !isTaskViewModalOpen) {
      setCurrentTaskForModal(undefined);
      return;
    }
    const task = leadTasks.find(t => t._id === selectedTaskForView);
    setCurrentTaskForModal(task);
  }, [selectedTaskForView, isTaskViewModalOpen, leadTasks]);

  // Обработчик открытия модалки просмотра задачи (как в TasksGridModal)
  const handleOpenTaskView = useCallback((taskId: string) => {
    setSelectedTaskForView(taskId);
    setIsTaskViewModalOpen(true);
  }, []);

  // Обработчик закрытия модалки просмотра задачи
  const handleCloseTaskView = useCallback(() => {
    setIsTaskViewModalOpen(false);
    setSelectedTaskForView(null);
  }, []);

  // Обработчик изменения статуса задачи
  const handleTaskStatusChange = useCallback(async (taskId: string, checked: boolean) => {
    const newChecked = [...taskChecked];
    const taskIndex = leadTasks.findIndex(t => t._id === taskId);
    if (taskIndex !== -1) {
      newChecked[taskIndex] = checked;
      setTaskChecked(newChecked);

      try {
        // `[phase 3]` Завершение задачи — отдельная команда complete (не
        // просто смена статуса, см. tasksApiV2.complete докстринг), обратный
        // переход — setStatus('in_progress'). Запись в историю лида про это
        // действие больше не пишется: GET /leads/:id/events её не хранит, и
        // эти сообщения ("Задача ... выполнена/переведена в работу") уже были
        // невидимы в этой вкладке до миграции (см. loadLeadHistoryData
        // докстринг) — честный, не влияющий на UI пробел.
        const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
        const updated = checked
          ? await tasksApiV2.complete(taskId, expectedVersion)
          : await tasksApiV2.setStatus(taskId, expectedVersion, 'in_progress');
        taskVersionsRef.current.set(taskId, updated.version);

        // Обновляем локальное состояние задачи
        setLeadTasks(prev => prev.map(task =>
          task._id === taskId ? mapTaskV2ToCrmTask(updated) : task
        ));
      } catch (error) {
        console.error('Failed to update task status:', error);
        // Откатываем изменение при ошибке
        setTaskChecked(taskChecked);
      }
    }
  }, [leadTasks, taskChecked, displayLead]);

  // Обработчик удаления задачи
  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      // `[phase 3]` DELETE /tasks/:id не существует на новом backend —
      // ближайший эквивалент, отмена (status:'cancelled'); loadTasksData уже
      // отфильтровывает отменённые задачи (isDisplayableTaskV2), поэтому для
      // этого экрана выглядит как настоящее удаление.
      const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
      await tasksApiV2.setStatus(taskId, expectedVersion, 'cancelled');
      taskVersionsRef.current.delete(taskId);
      setLeadTasks(prev => prev.filter(task => task._id !== taskId));
      setTaskChecked(prev => {
        const newChecked = [...prev];
        const taskIndex = leadTasks.findIndex(t => t._id === taskId);
        if (taskIndex !== -1) {
          newChecked.splice(taskIndex, 1);
        }
        return newChecked;
      });
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  }, [leadTasks, displayLead]);

  // Refs для дебаунсинга изменений этапов (должны быть до раннего возврата)
  const realtorStageChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curatorStageChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRealtorStageRef = useRef<LeadStage | undefined>(undefined);
  const lastCuratorStageRef = useRef<LeadStage | undefined>(undefined);

  // Обновляем refs при изменении displayLead
  useEffect(() => {
    if (displayLead) {
      lastRealtorStageRef.current = displayLead.realtorStage;
      lastCuratorStageRef.current = displayLead.curatorStage;
    }
  }, [displayLead?.realtorStage, displayLead?.curatorStage]);

  // Очистка таймеров при размонтировании
  useEffect(() => {
    return () => {
      if (realtorStageChangeTimeoutRef.current) {
        clearTimeout(realtorStageChangeTimeoutRef.current);
      }
      if (curatorStageChangeTimeoutRef.current) {
        clearTimeout(curatorStageChangeTimeoutRef.current);
      }
    };
  }, []);

  if (!isOpen || !displayLead) return null;

  const getStageLabel = (stage: LeadStage, productType: ProductType): string => {
    const productTypeMap: Record<ProductType, 'RP' | 'Net' | 'Owner' | 'Agent'> = {
      [ProductType.SALES]: 'RP',
      [ProductType.NETWORK]: 'Net',
      [ProductType.OWNER]: 'Owner',
      [ProductType.AGENT]: 'Agent',
    };

    const product = productTypeMap[productType] || 'RP';

    const stageToKeyMap: Partial<Record<LeadStage, string>> = {
      [LeadStage.REJECTED]: 'defective',
      [LeadStage.FIRST_CONTACT]: 'refused',
      [LeadStage.QUALIFICATION]: 'no_answer_3',
      [LeadStage.REJECTED1]: 'no_answer_2',
      [LeadStage.FIRST_CONTACT1]: 'no_answer_1',
      [LeadStage.NEEDS_ANALYSIS]: 'new',
      [LeadStage.PRESENTATION]: 'callback',
      [LeadStage.PROPOSAL]: 'presented',
      [LeadStage.NEGOTIATION]: 'country_discussed',
      [LeadStage.DECISION_MAKING]: 'need_identified',
      [LeadStage.CONTRACT_SIGNING]: 'need_adjusted',
      [LeadStage.ONBOARDING]: 'kp_sent',
      [LeadStage.NEEDS_ANALYSIS1]: 'objections',
      [LeadStage.PRESENTATION1]: 'deferred',
      [LeadStage.PROPOSAL1]: 'warmup',
      [LeadStage.NEGOTIATION1]: 'showing',
      [LeadStage.DECISION_MAKING1]: 'deposit',
      [LeadStage.CONTRACT_SIGNING1]: 'deal',
      [LeadStage.DEAL_CLOSED]: 'golden',
      [LeadStage.POST_PURCHASE_FOLLOWUP]: 'check_in',
      [LeadStage.SATISFACTION_CHECK]: 'referral',
      [LeadStage.UPSELL_OPPORTUNITY]: 'new_deals',
      [LeadStage.REGISTERED]: 'registered',
      [LeadStage.ADAPTED]: 'adapted',

      // Net specific
      [LeadStage.NETWORK_REJECTED_DEFECTIVE]: 'defective',
      [LeadStage.NETWORK_REJECTED]: 'refused',
      [LeadStage.NETWORK_NO_CALL_3]: 'no_answer_3',
      [LeadStage.NETWORK_NO_CALL_2]: 'no_answer_2',
      [LeadStage.NETWORK_NO_CALL_1]: 'no_answer_1',
      [LeadStage.NETWORK_NEW_LEAD]: 'new',
      [LeadStage.NETWORK_CALL_LATER]: 'callback',
      [LeadStage.NETWORK_COMPANY_PRESENTED]: 'presented',
      [LeadStage.NETWORK_PLATFORM_PRESENTED]: 'country_discussed',
      [LeadStage.NETWORK_OFFER_GIVEN]: 'need_identified',
      [LeadStage.NETWORK_OBJECTIONS]: 'need_adjusted',
      [LeadStage.NETWORK_DEFERRED_DEMAND]: 'kp_sent',
      [LeadStage.NETWORK_AGREEMENT]: 'objections',
      [LeadStage.NETWORK_FORM_FILLED]: 'deferred',
      [LeadStage.NETWORK_ACCOUNT_REGISTERED]: 'warmup',
      [LeadStage.NETWORK_OFFER_SIGNED]: 'showing',
      [LeadStage.NETWORK_WORK_STARTED]: 'deposit',

      // Owner specific
      [LeadStage.OWNER_REJECTED_DEFECTIVE]: 'defective',
      [LeadStage.OWNER_REJECTED_OWNER]: 'refused',
      [LeadStage.OWNER_NO_CALL_3]: 'no_answer_3',
      [LeadStage.OWNER_NO_CALL_2]: 'no_answer_2',
      [LeadStage.OWNER_NO_CALL_1]: 'no_answer_1',
      [LeadStage.OWNER_NEW_OWNER]: 'new',
      [LeadStage.OWNER_CALL_LATER]: 'callback',
      [LeadStage.OWNER_COMPANY_PRESENTED]: 'presented',
      [LeadStage.OWNER_OBJECT_DISCUSSED]: 'country_discussed',
      [LeadStage.OWNER_PHOTO_PROPOSED]: 'need_identified',
      [LeadStage.OWNER_EXCLUSIVE_PROPOSED]: 'need_adjusted',
      [LeadStage.OWNER_OBJECTIONS]: 'kp_sent',
      [LeadStage.OWNER_AGREED]: 'objections',
      [LeadStage.OWNER_ACTIVE_FOR_SALE]: 'deferred',
      [LeadStage.OWNER_GET_REFERRAL]: 'warmup',
      [LeadStage.OWNER_NEW_OBJECT_INQUIRY]: 'showing',

      // Agent specific
      [LeadStage.AGENT_REJECTED_DEFECTIVE]: 'defective',
      [LeadStage.AGENT_REJECTED]: 'refused',
      [LeadStage.AGENT_NO_CALL_3]: 'no_answer_3',
      [LeadStage.AGENT_NO_CALL_2]: 'no_answer_2',
      [LeadStage.AGENT_NO_CALL_1]: 'no_answer_1',
      [LeadStage.AGENT_NEW_AGENT]: 'new',
      [LeadStage.AGENT_CALL_LATER]: 'callback',
      [LeadStage.AGENT_COMPANY_PRESENTED]: 'presented',
      [LeadStage.AGENT_FORMAT]: 'country_discussed',
      [LeadStage.AGENT_OBJECTIONS]: 'need_identified',
      [LeadStage.AGENT_AGREED]: 'need_adjusted',
      [LeadStage.AGENT_ACTIVE]: 'kp_sent',
    };

    const translationKey = stageToKeyMap[stage];
    if (translationKey) {
      return t(`crmPoker.stages.${product}.${translationKey}` as any);
    }

    const statusToLeadStageMap: Record<'RP' | 'Net' | 'Owner' | 'Agent', Record<string, LeadStage>> = {
      RP: {
        [t('leadViewModal.defectiveLead')]: LeadStage.REJECTED,
        [t('leadViewModal.denial')]: LeadStage.FIRST_CONTACT,
        [t('leadViewModal.didntGetThrough3')]: LeadStage.QUALIFICATION,
        [t('leadViewModal.didntGetThrough2')]: LeadStage.REJECTED1,
        [t('leadViewModal.didntGetThrough1')]: LeadStage.FIRST_CONTACT1,
        [t('leadViewModal.newLead')]: LeadStage.NEEDS_ANALYSIS,
        [t('leadViewModal.askedToContactYouLater')]: LeadStage.PRESENTATION,
        [t('leadViewModal.presentedTheCompany')]: LeadStage.PROPOSAL,
        [t('leadViewModal.discussedTheSituationInTheCoun')]: LeadStage.NEGOTIATION,
        [t('leadViewModal.needIdentified')]: LeadStage.DECISION_MAKING,
        [t('leadViewModal.needAdjusted')]: LeadStage.CONTRACT_SIGNING,
        [t('leadViewModal.sentByKp')]: LeadStage.ONBOARDING,
        [t('leadViewModal.handlingObjections')]: LeadStage.NEEDS_ANALYSIS1,
        [t('leadViewModal.deferredDemand')]: LeadStage.PRESENTATION1,
        [t('leadViewModal.warmingUp')]: LeadStage.PROPOSAL1,
        [t('leadViewModal.show')]: LeadStage.NEGOTIATION1,
        [t('leadViewModal.depositReceived')]: LeadStage.DECISION_MAKING1,
        [t('leadViewModal.anAgreementHasBeenConcluded')]: LeadStage.CONTRACT_SIGNING1,
        [t('leadViewModal.goldFund')]: LeadStage.DEAL_CLOSED,
        ' Узнал как дела': LeadStage.POST_PURCHASE_FOLLOWUP,
        [t('leadViewModal.takeARecommendation')]: LeadStage.SATISFACTION_CHECK,
        [t('leadViewModal.identifyingTheNeedForNewDeals')]: LeadStage.UPSELL_OPPORTUNITY,
      },
      Net: {
        [t('leadViewModal.defectiveLead')]: LeadStage.NETWORK_REJECTED_DEFECTIVE,
        [t('leadViewModal.denial')]: LeadStage.NETWORK_REJECTED,
        [t('leadViewModal.didntGetThrough3')]: LeadStage.NETWORK_NO_CALL_3,
        [t('leadViewModal.didntGetThrough2')]: LeadStage.NETWORK_NO_CALL_2,
        [t('leadViewModal.didntGetThrough1')]: LeadStage.NETWORK_NO_CALL_1,
        
        [t('leadViewModal.newLead')]: LeadStage.NETWORK_NEW_LEAD,
        [t('leadViewModal.askedToContactYouLater')]: LeadStage.NETWORK_CALL_LATER,
        [t('leadViewModal.presentedTheCompanyAndStrategy')]: LeadStage.NETWORK_COMPANY_PRESENTED,
        [t('leadViewModal.presentedThePlatform')]: LeadStage.NETWORK_PLATFORM_PRESENTED,
        [t('leadViewModal.presentedWithAnOffer')]: LeadStage.NETWORK_OFFER_GIVEN,
        [t('leadViewModal.dealingWithObjections')]: LeadStage.NETWORK_OBJECTIONS,
        [t('leadViewModal.deferredDemand')]: LeadStage.NETWORK_DEFERRED_DEMAND,
        [t('leadViewModal.consent')]: LeadStage.NETWORK_AGREEMENT,
        [t('leadViewModal.completedForm')]: LeadStage.NETWORK_FORM_FILLED,
        [t('leadViewModal.registrationInYourPersonalAcco')]: LeadStage.NETWORK_ACCOUNT_REGISTERED,
        [t('leadViewModal.signingTheOffer')]: LeadStage.NETWORK_OFFER_SIGNED,
        [t('leadViewModal.gettingStarted')]: LeadStage.NETWORK_WORK_STARTED,
      },
      Owner: {
        [t('leadViewModal.defectiveContact')]: LeadStage.OWNER_REJECTED_DEFECTIVE,
        [t('leadViewModal.ownersRefusal')]: LeadStage.OWNER_REJECTED_OWNER,
        [t('leadViewModal.missedCall3')]: LeadStage.OWNER_NO_CALL_3,
        [t('leadViewModal.missedACall2')]: LeadStage.OWNER_NO_CALL_2,
        [t('leadViewModal.missedCall1')]: LeadStage.OWNER_NO_CALL_1,
        [t('leadViewModal.newOwner')]: LeadStage.OWNER_NEW_OWNER,
        [t('leadViewModal.askedToContactYouLater')]: LeadStage.OWNER_CALL_LATER,
        [t('leadViewModal.presentedTheCompany')]: LeadStage.OWNER_COMPANY_PRESENTED,
        [t('leadViewModal.discussedTheObjectAndCondition')]: LeadStage.OWNER_OBJECT_DISCUSSED,
        [t('leadViewModal.offeredAPhotoShoot')]: LeadStage.OWNER_PHOTO_PROPOSED,
        [t('leadViewModal.exclusiveOffered')]: LeadStage.OWNER_EXCLUSIVE_PROPOSED,
        [t('leadViewModal.objectionsWorkedOut')]: LeadStage.OWNER_OBJECTIONS,
        [t('leadViewModal.agreedOnCooperation')]: LeadStage.OWNER_AGREED,
        [t('leadViewModal.theObjectIsActiveForSale')]: LeadStage.OWNER_ACTIVE_FOR_SALE,
        [t('leadViewModal.takeARecommendation')]: LeadStage.OWNER_GET_REFERRAL,
        [t('leadViewModal.findOutAboutANewObject')]: LeadStage.OWNER_NEW_OBJECT_INQUIRY,
      },
      Agent: {
        [t('leadViewModal.defectiveContact')]: LeadStage.AGENT_REJECTED_DEFECTIVE,
        [t('leadViewModal.denial')]: LeadStage.AGENT_REJECTED,
        [t('leadViewModal.missedCall3')]: LeadStage.AGENT_NO_CALL_3,
        [t('leadViewModal.missedACall2')]: LeadStage.AGENT_NO_CALL_2,
        [t('leadViewModal.missedCall1')]: LeadStage.AGENT_NO_CALL_1,
        [t('leadViewModal.newIntermediary')]: LeadStage.AGENT_NEW_AGENT,
        [t('leadViewModal.askedToContactYouLater')]: LeadStage.AGENT_CALL_LATER,
        [t('leadViewModal.presentedTheCompany')]: LeadStage.AGENT_COMPANY_PRESENTED,
        [t('leadViewModal.cooperationFormat')]: LeadStage.AGENT_FORMAT,
        [t('leadViewModal.dealingWithObjections')]: LeadStage.AGENT_OBJECTIONS,
        [t('leadViewModal.agreementToCooperate')]: LeadStage.AGENT_AGREED,
        [t('leadViewModal.activeMediator')]: LeadStage.AGENT_ACTIVE,
      },
    };

    const allStageLabels: Record<LeadStage, string> = {
      [LeadStage.REJECTED]: t('leadViewModal.defectiveLead'),
      [LeadStage.FIRST_CONTACT]: t('leadViewModal.denial'),
      [LeadStage.QUALIFICATION]: t('leadViewModal.didntGetThrough3'),
      [LeadStage.REJECTED1]: t('leadViewModal.didntGetThrough2'),
      [LeadStage.FIRST_CONTACT1]: t('leadViewModal.didntGetThrough1'),
      [LeadStage.NEEDS_ANALYSIS]: t('leadViewModal.newLead'),
      [LeadStage.PRESENTATION]: t('leadViewModal.askedToContactYouLater'),
      [LeadStage.PROPOSAL]: t('leadViewModal.presentedTheCompany'),
      [LeadStage.NEGOTIATION]: t('leadViewModal.discussedTheSituationInTheCoun'),
      [LeadStage.DECISION_MAKING]: t('leadViewModal.needIdentified'),
      [LeadStage.CONTRACT_SIGNING]: t('leadViewModal.needAdjusted'),
      [LeadStage.ONBOARDING]: t('leadViewModal.sentByKp'),
      [LeadStage.NEEDS_ANALYSIS1]: t('leadViewModal.handlingObjections'),
      [LeadStage.PRESENTATION1]: t('leadViewModal.deferredDemand'),
      [LeadStage.PROPOSAL1]: t('leadViewModal.warmingUp'),
      [LeadStage.NEGOTIATION1]: t('leadViewModal.show'),
      [LeadStage.DECISION_MAKING1]: t('leadViewModal.depositReceived'),
      [LeadStage.CONTRACT_SIGNING1]: t('leadViewModal.anAgreementHasBeenConcluded'),
      [LeadStage.DEAL_CLOSED]: t('leadViewModal.goldFund'),
      [LeadStage.POST_PURCHASE_FOLLOWUP]: t('leadViewModal.findOutHowYouAreDoing'),
      [LeadStage.SATISFACTION_CHECK]: t('leadViewModal.takeARecommendation'),
      [LeadStage.UPSELL_OPPORTUNITY]: t('leadViewModal.identifyingTheNeedForNewDeals'),
      [LeadStage.REGISTERED]: t('leadViewModal.registered'),
      [LeadStage.ADAPTED]: t('leadViewModal.adapted'),
      [LeadStage.NETWORK_REJECTED_DEFECTIVE]: t('leadViewModal.defectiveLead'),
      [LeadStage.NETWORK_REJECTED]: t('leadViewModal.denial'),
      [LeadStage.NETWORK_NO_CALL_3]: t('leadViewModal.didntGetThrough3'),
      [LeadStage.NETWORK_NO_CALL_2]: t('leadViewModal.didntGetThrough2'),
      [LeadStage.NETWORK_NO_CALL_1]: t('leadViewModal.didntGetThrough1'),
      [LeadStage.NETWORK_NEW_LEAD]: t('leadViewModal.newLead'),
      [LeadStage.NETWORK_CALL_LATER]: t('leadViewModal.askedToContactYouLater'),
      [LeadStage.NETWORK_COMPANY_PRESENTED]: t('leadViewModal.presentedTheCompanyAndStrategy'),
      [LeadStage.NETWORK_PLATFORM_PRESENTED]: t('leadViewModal.presentedThePlatform'),
      [LeadStage.NETWORK_OFFER_GIVEN]: t('leadViewModal.presentedWithAnOffer'),
      [LeadStage.NETWORK_OBJECTIONS]: t('leadViewModal.dealingWithObjections'),
      [LeadStage.NETWORK_DEFERRED_DEMAND]: t('leadViewModal.deferredDemand'),
      [LeadStage.NETWORK_AGREEMENT]: t('leadViewModal.consent'),
      [LeadStage.NETWORK_FORM_FILLED]: t('leadViewModal.completedForm'),
      [LeadStage.NETWORK_ACCOUNT_REGISTERED]: t('leadViewModal.registrationInYourPersonalAcco'),
      [LeadStage.NETWORK_OFFER_SIGNED]: t('leadViewModal.signingTheOffer'),
      [LeadStage.NETWORK_WORK_STARTED]: t('leadViewModal.gettingStarted'),
      [LeadStage.REALTOR_1]: t('leadViewModal.realtor'),
      [LeadStage.REALTOR_2]: t('leadViewModal.realtor1'),
      [LeadStage.REALTOR_3]: t('leadViewModal.realtor2'),
      [LeadStage.REALTOR_4]: t('leadViewModal.realtor3'),
      [LeadStage.REALTOR_5]: t('leadViewModal.realtor4'),
      [LeadStage.REALTOR_6]: t('leadViewModal.realtor5'),
      [LeadStage.CURATOR_1]: t('leadViewModal.curator'),
      [LeadStage.CURATOR_2]: t('leadViewModal.curator1'),
      [LeadStage.CURATOR_3]: t('leadViewModal.curator2'),
      [LeadStage.CURATOR_4]: t('leadViewModal.curator3'),
      [LeadStage.CURATOR_5]: t('leadViewModal.curator4'),
      [LeadStage.CURATOR_6]: t('leadViewModal.curator5'),
      [LeadStage.OWNER_REJECTED_DEFECTIVE]: t('leadViewModal.defectiveContact'),
      [LeadStage.OWNER_REJECTED_OWNER]: t('leadViewModal.ownersRefusal'),
      [LeadStage.OWNER_NO_CALL_3]: t('leadViewModal.missedCall3'),
      [LeadStage.OWNER_NO_CALL_2]: t('leadViewModal.missedACall2'),
      [LeadStage.OWNER_NO_CALL_1]: t('leadViewModal.missedCall1'),
      [LeadStage.OWNER_NEW_OWNER]: t('leadViewModal.newOwner'),
      [LeadStage.OWNER_CALL_LATER]: t('leadViewModal.askedToContactYouLater'),
      [LeadStage.OWNER_COMPANY_PRESENTED]: t('leadViewModal.presentedTheCompany'),
      [LeadStage.OWNER_OBJECT_DISCUSSED]: t('leadViewModal.discussedTheObjectAndCondition'),
      [LeadStage.OWNER_PHOTO_PROPOSED]: t('leadViewModal.offeredAPhotoShoot'),
      [LeadStage.OWNER_EXCLUSIVE_PROPOSED]: t('leadViewModal.exclusiveOffered'),
      [LeadStage.OWNER_OBJECTIONS]: t('leadViewModal.objectionsWorkedOut'),
      [LeadStage.OWNER_AGREED]: t('leadViewModal.agreedOnCooperation'),
      [LeadStage.OWNER_ACTIVE_FOR_SALE]: t('leadViewModal.theObjectIsActiveForSale'),
      [LeadStage.OWNER_GET_REFERRAL]: t('leadViewModal.takeARecommendation'),
      [LeadStage.OWNER_NEW_OBJECT_INQUIRY]: t('leadViewModal.findOutAboutANewObject'),
      [LeadStage.AGENT_REJECTED_DEFECTIVE]: t('leadViewModal.defectiveContact'),
      [LeadStage.AGENT_REJECTED]: t('leadViewModal.denial'),
      [LeadStage.AGENT_NO_CALL_3]: t('leadViewModal.missedCall3'),
      [LeadStage.AGENT_NO_CALL_2]: t('leadViewModal.missedACall2'),
      [LeadStage.AGENT_NO_CALL_1]: t('leadViewModal.missedCall1'),
      [LeadStage.AGENT_NEW_AGENT]: t('leadViewModal.newIntermediary'),
      [LeadStage.AGENT_CALL_LATER]: t('leadViewModal.askedToContactYouLater'),
      [LeadStage.AGENT_COMPANY_PRESENTED]: t('leadViewModal.presentedTheCompany'),
      [LeadStage.AGENT_FORMAT]: t('leadViewModal.cooperationFormat'),
      [LeadStage.AGENT_OBJECTIONS]: t('leadViewModal.dealingWithObjections'),
      [LeadStage.AGENT_AGREED]: t('leadViewModal.agreementToCooperate'),
      [LeadStage.AGENT_ACTIVE]: t('leadViewModal.activeMediator'),
    };

    const stageMap = statusToLeadStageMap[product];
    
    for (const [label, stageValue] of Object.entries(stageMap)) {
      if (stageValue === stage) {
        return label;
      }
    }
    
    // Если не найдено в маппинге продукта, используем полный маппинг
    return allStageLabels[stage] || stage;
  };

  const extractCity = (): string => {
    if (!displayLead) return t('leadCard.notSpecified');
    if ('city' in displayLead && (displayLead as any).city) {
      return (displayLead as any).city;
    }
    if (displayLead.notes) {
      const cityMatch = displayLead.notes.match(/Город:\s*(.+)/);
      if (cityMatch) {
        return cityMatch[1].trim();
      }
    }
    return t('leadCard.notSpecified');
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return t('leadCard.noDate');
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };

  const formatDateTime = (dateString: string): string => {
    if (!dateString) return t('leadCard.noDate');
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} | ${hours}:${minutes}`;
  };

  const getProductTypeDisplayLabel = (productType: ProductType): string => {
    const productKey: Record<ProductType, 'RP' | 'Net' | 'Owner' | 'Agent'> = {
      [ProductType.SALES]: 'RP',
      [ProductType.NETWORK]: 'Net',
      [ProductType.OWNER]: 'Owner',
      [ProductType.AGENT]: 'Agent',
    };
    return t(`crmPoker.product.${productKey[productType]}`, productType);
  };

  // Функция для получения метки состояния риэлтора
  const getRealtorStageLabel = (stage?: LeadStage): string | null => {
    if (!stage) return null;
    const positionMap: Partial<Record<LeadStage, number>> = {
      [LeadStage.REALTOR_1]: 0,
      [LeadStage.REALTOR_2]: 1,
      [LeadStage.REALTOR_3]: 2,
      [LeadStage.REALTOR_4]: 3,
      [LeadStage.REALTOR_5]: 4,
      [LeadStage.REALTOR_6]: 5,
    };
    const stars = positionMap[stage];
    if (stars === undefined) return null;
    return `${t('leadCard.realtor')}${stars > 0 ? ' ' + '⭐'.repeat(stars) : ''}`;
  };

  // Функция для получения метки состояния куратора
  const getCuratorStageLabel = (stage?: LeadStage): string | null => {
    if (!stage) return null;
    const positionMap: Partial<Record<LeadStage, number>> = {
      [LeadStage.CURATOR_1]: 0,
      [LeadStage.CURATOR_2]: 1,
      [LeadStage.CURATOR_3]: 2,
      [LeadStage.CURATOR_4]: 3,
      [LeadStage.CURATOR_5]: 4,
      [LeadStage.CURATOR_6]: 5,
    };
    const stars = positionMap[stage];
    if (stars === undefined) return null;
    return `${t('leadCard.curator')}${stars > 0 ? ' ' + '⭐'.repeat(stars) : ''}`;
  };

  // Получить позицию этапа риэлтора (1-6)
  const getRealtorPosition = (stage?: LeadStage): number => {
    if (!stage) return 1;
    const positionMap: Partial<Record<LeadStage, number>> = {
      [LeadStage.REALTOR_1]: 1,
      [LeadStage.REALTOR_2]: 2,
      [LeadStage.REALTOR_3]: 3,
      [LeadStage.REALTOR_4]: 4,
      [LeadStage.REALTOR_5]: 5,
      [LeadStage.REALTOR_6]: 6,
    };
    return positionMap[stage] || 1;
  };

  // Получить позицию этапа куратора (1-6)
  const getCuratorPosition = (stage?: LeadStage): number => {
    if (!stage) return 1;
    const positionMap: Partial<Record<LeadStage, number>> = {
      [LeadStage.CURATOR_1]: 1,
      [LeadStage.CURATOR_2]: 2,
      [LeadStage.CURATOR_3]: 3,
      [LeadStage.CURATOR_4]: 4,
      [LeadStage.CURATOR_5]: 5,
      [LeadStage.CURATOR_6]: 6,
    };
    return positionMap[stage] || 1;
  };

  // Получить этап риэлтора по позиции
  const getRealtorStageByPosition = (position: number): LeadStage => {
    return realtorStages[position - 1] || LeadStage.REALTOR_1;
  };

  // Получить этап куратора по позиции
  const getCuratorStageByPosition = (position: number): LeadStage => {
    return curatorStages[position - 1] || LeadStage.CURATOR_1;
  };

  // Получить позицию этапа сети (1-17)
  const getNetworkPosition = (stage?: LeadStage): number => {
    if (!stage) return 1;
    const index = networkStages.indexOf(stage);
    return index >= 0 ? index + 1 : 1;
  };

  // Получить этап сети по позиции
  const getNetworkStageByPosition = (position: number): LeadStage => {
    return networkStages[position - 1] || LeadStage.NETWORK_NEW_LEAD;
  };

  // Обработчик удаления лида
  const handleDeleteLead = async () => {
    if (!displayLead?._id || isDeleting) return;

    setIsDeleting(true);
    try {
      // Сохраняем незаписанные изменения истории перед удалением
      await flushLeadHistory(displayLead._id);
      
      const leadId = displayLead._id;
      const result = await leadsApiV2.remove(leadId);
      if (result.deleted) {
        // Закрываем модалку и вызываем колбэк с ID удаленного лида
        onClose();
        if (onLeadDeleted) {
          onLeadDeleted(leadId);
        }
      } else {
        alert(displayLead?.productType === ProductType.NETWORK ? [t('leadCard.failedDeleteReferral')]: t('leadCard.failedDeleteLead'));
      }
    } catch (error: any) {
      console.error('Failed to delete lead:', error);
      const errorMessage = error?.response?.data?.message || error?.message || (displayLead?.productType === ProductType.NETWORK ? [t('leadCard.failedDeleteReferral')]: t('leadCard.failedDeleteLead'));
      alert(errorMessage);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Доступные этапы для риэлтора
  const realtorStages: LeadStage[] = [
    LeadStage.REALTOR_1,
    LeadStage.REALTOR_2,
    LeadStage.REALTOR_3,
    LeadStage.REALTOR_4,
    LeadStage.REALTOR_5,
    LeadStage.REALTOR_6,
  ];

  // Доступные этапы для куратора
  const curatorStages: LeadStage[] = [
    LeadStage.CURATOR_1,
    LeadStage.CURATOR_2,
    LeadStage.CURATOR_3,
    LeadStage.CURATOR_4,
    LeadStage.CURATOR_5,
    LeadStage.CURATOR_6,
  ];

  // Доступные этапы для сети
  const networkStages: LeadStage[] = [
    LeadStage.NETWORK_REJECTED_DEFECTIVE,
    LeadStage.NETWORK_REJECTED,
    LeadStage.NETWORK_NO_CALL_3,
    LeadStage.NETWORK_NO_CALL_2,
    LeadStage.NETWORK_NO_CALL_1,
    LeadStage.NETWORK_NEW_LEAD,
    LeadStage.NETWORK_CALL_LATER,
    LeadStage.NETWORK_COMPANY_PRESENTED,
    LeadStage.NETWORK_PLATFORM_PRESENTED,
    LeadStage.NETWORK_OFFER_GIVEN,
    LeadStage.NETWORK_OBJECTIONS,
    LeadStage.NETWORK_DEFERRED_DEMAND,
    LeadStage.NETWORK_AGREEMENT,
    LeadStage.NETWORK_FORM_FILLED,
    LeadStage.NETWORK_ACCOUNT_REGISTERED,
    LeadStage.NETWORK_OFFER_SIGNED,
    LeadStage.NETWORK_WORK_STARTED,
  ];

  // Обработчик изменения этапа риэлтора через слайдер
  const handleRealtorStageChange = async (position: number) => {
    if (!displayLead?._id) return;
    
    const newStage = getRealtorStageByPosition(position);
    const currentStage = displayLead.realtorStage;
    
    // Проверяем, действительно ли этап изменился
    // Если currentStage undefined, то это первое установление stage для лида сети
    if (currentStage && (newStage === currentStage || newStage === lastRealtorStageRef.current)) {
      return;
    }

    // Очищаем предыдущий таймер
    if (realtorStageChangeTimeoutRef.current) {
      clearTimeout(realtorStageChangeTimeoutRef.current);
    }

    // Оптимистично обновляем локальное состояние
    setLocalLead(prev => prev ? { ...prev, realtorStage: newStage } : prev);
    lastRealtorStageRef.current = newStage;

    // Дебаунсинг: сохраняем через 500ms после последнего изменения
    realtorStageChangeTimeoutRef.current = setTimeout(async () => {
      try {
        // `[phase 3]` realtorStage — сопутствующее поле (PATCH /leads/:id),
        // не смена `stage` — CAS/changeStage её не касается (см.
        // lead.controller.ts докстринг UpdateLeadDto).
        const updated = await leadsApiV2.update(displayLead._id, { realtorStage: newStage });
        const mapped = mapLeadV2ToCrmLead(updated);
        leadVersionRef.current = updated.version;
        setLocalLead(mapped);
        lastRealtorStageRef.current = mapped.realtorStage;
      } catch (error) {
        console.error('Failed to update realtor stage:', error);
        alert(t('leadCard.failedUpdateRealtor'));
        // Откатываем изменение при ошибке
        setLocalLead(prev => prev ? { ...prev, realtorStage: lastRealtorStageRef.current } : prev);
      }
    }, 500);
  };

  // Обработчик изменения этапа куратора через слайдер
  const handleCuratorStageChange = async (position: number) => {
    if (!displayLead?._id) return;
    
    const newStage = getCuratorStageByPosition(position);
    const currentStage = displayLead.curatorStage;
    
    // Проверяем, действительно ли этап изменился
    // Если currentStage undefined, то это первое установление stage для лида сети
    if (currentStage && (newStage === currentStage || newStage === lastCuratorStageRef.current)) {
      return;
    }

    // Очищаем предыдущий таймер
    if (curatorStageChangeTimeoutRef.current) {
      clearTimeout(curatorStageChangeTimeoutRef.current);
    }

    // Оптимистично обновляем локальное состояние
    setLocalLead(prev => prev ? { ...prev, curatorStage: newStage } : prev);
    lastCuratorStageRef.current = newStage;

    // Дебаунсинг: сохраняем через 500ms после последнего изменения
    curatorStageChangeTimeoutRef.current = setTimeout(async () => {
      try {
        // `[phase 3]` curatorStage — то же сопутствующее поле, что realtorStage выше.
        const updated = await leadsApiV2.update(displayLead._id, { curatorStage: newStage });
        const mapped = mapLeadV2ToCrmLead(updated);
        leadVersionRef.current = updated.version;
        setLocalLead(mapped);
        lastCuratorStageRef.current = mapped.curatorStage;
      } catch (error) {
        console.error('Failed to update curator stage:', error);
        alert(t('leadCard.failedUpdateCurator'));
        // Откатываем изменение при ошибке
        setLocalLead(prev => prev ? { ...prev, curatorStage: lastCuratorStageRef.current } : prev);
      }
    }, 500);
  };

  // Обработчик изменения этапа сети через слайдер
  const handleNetworkStageChange = async (position: number) => {
    if (!displayLead?._id) return;
    
    const newStage = getNetworkStageByPosition(position);
    const currentStage = displayLead.stage;
    
    // Проверяем, действительно ли этап изменился
    if (newStage === currentStage) {
      return;
    }

    try {
      // `[phase 3]` Это реальная смена `stage` (не сопутствующее поле) —
      // CAS через expectedVersion (см. leadsApiV2.changeStage докстринг).
      const expectedVersion = leadVersionRef.current ?? 0;
      const result = await leadsApiV2.changeStage(displayLead._id, stageCrmToV2(newStage), expectedVersion);
      if (typeof result.version === 'number') {
        leadVersionRef.current = result.version;
      }
      // changeStage не отдаёт полную read-модель (см. LeadStageChangeResult
      // докстринг) — перечитываем лид, чтобы localLead отражал актуальные
      // version/stage/сопутствующие поля, тот же принцип, что LeadsContext.
      await loadLeadFromAPI();
    } catch (error: any) {
      console.error('Failed to update network stage:', error);
      if (error?.response?.status === 409) {
        alert(t('leadCard.failedUpdateStage'));
        await loadLeadFromAPI();
      } else {
        alert(t('leadCard.failedUpdateStage'));
      }
    }
  };

  const formatBudget = (value?: number, currency?: string): string => {
    if (!value) return t('leadCard.notSpecified');
    if (!currency) return `${value.toLocaleString('ru-RU')}`;

    const currencySymbols: Record<string, string> = {
      'USD': '$',
      'EUR': '€',
      'RUB': '₽',
      'KZT': '₸',
    };

    const symbol = currencySymbols[currency] || currency;
    return `${symbol} ${value.toLocaleString('ru-RU')}`;
  };

  const extractPropertyType = (): string => {
    if (!displayLead) return t('leadCard.notSpecified');

    // Сначала проверяем поле source (формат: "Тип сделки - Тип объекта")
    if (displayLead.source) {
      const parts = displayLead.source.split(' - ');
      if (parts.length === 2) {
        // Второй элемент - это тип объекта
        return parts[1].trim() || t('leadCard.notSpecified');
      }
      // Если формат не соответствует, пытаемся найти в notes
    }

    // Если source не подходит, проверяем notes
    if (displayLead.notes) {
      const match = displayLead.notes.match(/Тип объекта:\s*(.+)/i);
      if (match) {
        return match[1].trim();
      }
    }

    return t('leadCard.notSpecified');
  };

  const extractDealType = (): string => {
    if (!displayLead) return t('leadCard.notSpecified');

    // Сначала проверяем поле source (формат: "Тип сделки - Тип объекта")
    if (displayLead.source) {
      const parts = displayLead.source.split(' - ');
      if (parts.length === 2) {
        // Первый элемент - это тип сделки
        return parts[0].trim() || t('leadCard.notSpecified');
      }
      // Если формат не соответствует, пытаемся найти в notes
    }

    // Если source не подходит, проверяем notes
    if (displayLead.notes) {
      const match = displayLead.notes.match(/Тип сделки:\s*(.+)/i);
      if (match) {
        return match[1].trim();
      }
    }

    return t('leadCard.notSpecified');
  };
  
  const shouldShowObjectsLoading = !hasAttemptedFavorites || isLoadingFavorites;
  const hasNoFavorites = hasAttemptedFavorites && favoriteObjects.length === 0 && !favoritesError;

  return (
    <>
      {isOpen ? createPortal(
        <div 
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-50 pt-[15px] md:pt-4 pb-0 md:pb-4 px-0 md:px-4 transition-all duration-300 ease-out animate-in fade-in" 
          onClick={(e) => {
        // Закрываем только если клик был именно по backdrop (не по дочерним элементам)
        // Проверяем, что клик был по элементу с классом modal-fade-in (сам backdrop)
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
        >
          <div 
            className="relative flex flex-col bg-white rounded-t-[25px] md:rounded-[25px] shadow-2xl w-full md:w-[90.75%] h-[85vh] md:h-[90.89vh] overflow-hidden max-w-full animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
            style={{ boxSizing: 'border-box' }}
          >
            <div className="w-full h-full p-4 md:p-10 min-w-0 max-w-full box-border flex flex-col gap-6"
            >
              {/* Кнопка закрытия (крестик) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose();
                }}
                aria-label={t('common.close')}
                className='cursor-pointer absolute top-3 right-3 md:top-5 md:right-5 flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-all duration-200 ease-in-out active:scale-95 z-50'
              >
                <svg width="22" height="22" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M33.75 11.25L11.25 33.75" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M11.25 11.25L33.75 33.75" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
              
              {/* Навигация */}
              <div className='flex flex-row gap-2 flex-shrink-0 border-b border-gray-200 pb-4 w-full overflow-x-auto pr-12 md:pr-14'>
                {/* На мобильных показываем только вкладку "Заметки о клиенте" */}
                {typeof window !== 'undefined' && window.innerWidth < 768 ? (
                  <button
                    onClick={() => {
                      userSelectedTabRef.current = true;
                      setSelectedTab('info');
                    }}
                    className="flex items-center justify-center px-4 py-3 rounded-lg bg-dream-primary text-white w-full"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '18px',
                      lineHeight: '100%',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {displayLead?.productType === ProductType.NETWORK ? [t('leadCard.notesReferral')]: t('leadCard.notesClient')}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        userSelectedTabRef.current = true;
                        setSelectedTab('history');
                      }}
                      className={`flex items-center justify-center px-4 py-3 rounded-lg transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                        selectedTab === 'history' 
                          ? 'bg-dream-primary text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: selectedTab === 'history' ? '18px' : '16px',
                        lineHeight: '100%',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {t('leadCard.historyTab')}
                    </button>
                    <button
                      onClick={() => {
                        userSelectedTabRef.current = true;
                        setSelectedTab('info');
                      }}
                      className={`flex items-center justify-center px-4 py-3 rounded-lg transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                        selectedTab === 'info' 
                          ? 'bg-dream-primary text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: selectedTab === 'info' ? '18px' : '16px',
                        lineHeight: '100%',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {displayLead?.productType === ProductType.NETWORK ? (t('leadCard.notesReferral') as string): (t('leadCard.notesClient') as string)}
                    </button>
                    <button
                      onClick={() => {
                        userSelectedTabRef.current = true;
                        setSelectedTab('tasks');
                      }}
                      className={`flex items-center justify-center px-4 py-3 rounded-lg transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                        selectedTab === 'tasks' 
                          ? 'bg-dream-primary text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: selectedTab === 'tasks' ? '18px' : '16px',
                        lineHeight: '100%',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {t('leadCard.tasksTab')}
                    </button>
                    <button
                      onClick={() => {
                        userSelectedTabRef.current = true;
                        setSelectedTab('objects');
                      }}
                      className={`flex items-center justify-center px-4 py-3 rounded-lg transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                        selectedTab === 'objects' 
                          ? 'bg-dream-primary text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: selectedTab === 'objects' ? '18px' : '16px',
                        lineHeight: '100%',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {t('leadCard.objectsTab')}
                    </button>
                  </>
                )}
              </div>
              <div className='w-full flex flex-col md:flex-row gap-4 md:gap-6 min-w-0 max-w-full box-border flex-1 min-h-0'>
                  {/* Левая панель - скрываем на мобильных */}
                  <div className='hidden md:flex md:w-[20%] flex-col gap-4 min-w-0 pr-1 border-r border-gray-200 flex-shrink-0 min-h-0'>
                    <div className='flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto'>
                      {/* Имя и кнопка редактирования */}
                <div className='flex items-center gap-3'>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '24px',
                      lineHeight: '28px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {displayLead.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <Tooltip text={displayLead?.productType === ProductType.NETWORK ? (t('leadCard.editReferral') as string): (t('leadCard.editInfo') as string)} position="top">
                      <button
                        onClick={() => setIsEditModalOpen(true)}
                        className="p-1.5 rounded-md hover:bg-gray-100 transition-colors flex-shrink-0 flex items-center justify-center"
                        aria-label={t('common.edit')}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#169600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#169600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </Tooltip>
                    <Tooltip text={displayLead?.productType === ProductType.NETWORK ? (t('leadCard.deleteReferral') as string): (t('leadCard.deleteLead') as string)} position="top">
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="p-1.5 rounded-md hover:bg-gray-100 transition-colors flex-shrink-0 flex items-center justify-center"
                        aria-label={t('common.delete')}
                      >
                        <svg width="24" height="24" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="#ffb4ab"/>
                          <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="#ffb4ab"/>
                          <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="#ffb4ab"/>
                          <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="#ffb4ab"/>
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {/* Роли клиента — DEMO_FALLBACK: пока бэкенд не отдаёт roles, показываем пример для наглядности */}
                {(((displayLead as any).roles?.length > 0 ? (displayLead as any).roles : ['buyer', 'referral_partner']) as string[]).length > 0 && (
                  <div className='flex items-center gap-1.5 flex-wrap'>
                    {(((displayLead as any).roles?.length > 0 ? (displayLead as any).roles : ['buyer', 'referral_partner']) as string[]).map((role) => (
                      <span
                        key={role}
                        className='px-2.5 py-1 rounded-md bg-dream-primary/10 text-dream-primary'
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '20px',
                          letterSpacing: '0px',
                        }}
                      >
                        {LEAD_ROLE_LABEL[role as keyof typeof LEAD_ROLE_LABEL] ?? role}
                      </span>
                    ))}
                  </div>
                )}

                {/* Кнопки позвонить/написать */}
                <div className='flex items-center gap-3 flex-wrap'>
                <div className='relative'>
                  <button
                    ref={callButtonRef}
                    className='px-5 py-2 rounded-full bg-dream-primary'
                    onClick={(e) => {
                      e.stopPropagation();
                      if (displayLead?._id) {
                        leadsApiV2.recordContactAction(displayLead._id, 'call').catch(() => {});
                      }
                      toggleCallMenu(callButtonRef.current);
                    }}
                  >
                    <span
                      className='text-white'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '100%',
                        letterSpacing: '0px',
                        textAlign: 'center',
                        leadingTrim: 'cap-height'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {t('leadCard.call')}
                    </span>
                  </button>
                  {showCallMenu && anchorRect && (
                    <div
                      ref={callMenuRef}
                      className="w-56 bg-white border border-dream-primary rounded-[16px] shadow-lg z-20 p-3 space-y-2"
                      style={{
                        position: 'fixed',
                        top: anchorRect.bottom + 8,
                        left: anchorRect.left,
                      }}
                    >
                      {displayLead.phone ? (
                        <>
                          <button
                            className="w-full text-left text-sm text-dream-primary hover:text-dream-secondary font-normal flex items-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyNumber();
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z" fill="currentColor"/>
                            </svg>
                            {t('leadCard.copyNumber')}
                          </button>
                          <button
                            className="w-full text-left text-sm text-dream-primary hover:text-dream-secondary font-normal flex items-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenWhatsApp();
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" fill="#25D366"/>
                            </svg>
                            {t('leadCard.openWhatsApp')}
                          </button>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">{t('leadCard.noNumber')}</p>
                      )}
                      <p className="text-xs text-gray-500">{t('leadCard.chooseContact')}</p>
                    </div>
                  )}
                </div>
                <div className='relative'>
                  <button
                    ref={writeButtonRef}
                    className='px-5 py-2 rounded-full border border-dream-primary'
                    onClick={(e) => {
                      e.stopPropagation();
                      if (displayLead?._id) {
                        leadsApiV2.recordContactAction(displayLead._id, 'chat').catch(() => {});
                      }
                      toggleWriteMenu(writeButtonRef.current);
                    }}
                  >
                    <span
                      className='text-dream-primary'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '100%',
                        letterSpacing: '0px',
                        textAlign: 'center',
                        leadingTrim: 'cap-height'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {t('leadCard.write')}
                    </span>
                  </button>
                  {showWriteMenu && writeMenuAnchorRect && (
                    <div
                      ref={writeMenuRef}
                      className="w-56 bg-white border border-dream-primary rounded-[16px] shadow-lg z-20 p-3 space-y-2"
                      style={{
                        position: 'fixed',
                        top: writeMenuAnchorRect.bottom + 8,
                        left: writeMenuAnchorRect.left,
                      }}
                    >
                      <div className="flex flex-col gap-2 w-full">
                        {(displayLead as any).telegram && (
                        <a
                            href={`https://t.me/${((displayLead as any).telegram as string).replace(/^@/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer w-full" style={{ background: '#112d1c', color: '#d0e8df' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowWriteMenu(false);
                          }}
                        >
                          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8.63241 13.916L8.2685 19.0346C8.78916 19.0346 9.01466 18.811 9.28508 18.5424L11.7262 16.2095L16.7843 19.9137C17.712 20.4307 18.3656 20.1585 18.6158 19.0603L21.936 3.50263L21.9369 3.50171C22.2312 2.13038 21.441 1.59413 20.5372 1.93055L1.02133 9.4023C-0.310587 9.9193 -0.29042 10.6618 0.794913 10.9982L5.78433 12.5501L17.3737 5.29838C17.9192 4.93721 18.4151 5.13705 18.0072 5.49821L8.63241 13.916Z" fill="#d0e8df"/>
                          </svg>
                          <span>Telegram</span>
                        </a>
                        )}
                        <a
                          href={`https://wa.me/${displayLead.phone?.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 bg-[#169600]/40 text-[#169600] rounded-xl cursor-pointer w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowWriteMenu(false);
                          }}
                        >
                          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <g clipPath="url(#clip0_4687_62526)">
                            <path fillRule="evenodd" clipRule="evenodd" d="M18.2954 3.67408C16.3659 1.74225 13.7997 0.677891 11.0658 0.676758C5.43249 0.676758 0.847759 5.26136 0.845493 10.8962C0.844738 12.6975 1.3153 14.4559 2.20971 16.0058L0.759766 21.3018L6.17773 19.8805C7.6706 20.6949 9.35129 21.124 11.0617 21.1245H11.066C16.6987 21.1245 21.2839 16.5395 21.2861 10.9044C21.2872 8.17346 20.2251 5.60579 18.2954 3.67408ZM11.0658 19.3985H11.0623C9.53811 19.3979 8.04322 18.9882 6.7388 18.2144L6.42875 18.0303L3.21364 18.8737L4.0718 15.739L3.86975 15.4176C3.0194 14.0651 2.57037 12.5019 2.57113 10.8969C2.57289 6.21331 6.38368 2.40289 11.0692 2.40289C13.3382 2.40365 15.4711 3.28837 17.0748 4.89403C18.6786 6.49969 19.5613 8.63395 19.5606 10.9038C19.5586 15.5877 15.748 19.3985 11.0658 19.3985ZM15.7254 13.0364C15.4701 12.9085 14.2145 12.2909 13.9803 12.2056C13.7464 12.1203 13.576 12.0779 13.4059 12.3335C13.2356 12.589 12.7463 13.1643 12.5972 13.3346C12.4482 13.5051 12.2994 13.5265 12.044 13.3986C11.7886 13.2708 10.9658 13.001 9.99028 12.131C9.2312 11.4539 8.71872 10.6176 8.56967 10.3621C8.42088 10.1063 8.56841 9.98142 8.68171 9.84093C8.95815 9.49765 9.23497 9.13774 9.32007 8.96742C9.4053 8.79697 9.36262 8.6478 9.29867 8.52002C9.23497 8.39225 8.72426 7.13529 8.51151 6.62382C8.30405 6.12607 8.0937 6.19329 7.93685 6.18549C7.78805 6.17806 7.61773 6.17655 7.44741 6.17655C7.27721 6.17655 7.00051 6.24037 6.76637 6.49617C6.53235 6.75184 5.87271 7.36956 5.87271 8.62652C5.87271 9.88348 6.78777 11.0978 6.91542 11.2682C7.04306 11.4387 8.7162 14.0181 11.2778 15.1241C11.8871 15.3874 12.3627 15.5444 12.7337 15.6621C13.3455 15.8565 13.902 15.829 14.3421 15.7633C14.8328 15.6899 15.8529 15.1455 16.0659 14.549C16.2786 13.9525 16.2786 13.4412 16.2147 13.3346C16.151 13.2281 15.9806 13.1643 15.7254 13.0364Z" fill="#169600"/>
                            </g>
                            <defs>
                            <clipPath id="clip0_4687_62526">
                            <rect width="22" height="22" fill="white"/>
                            </clipPath>
                            </defs>
                          </svg>
                          <span>WhatsApp</span>
                        </a>
                        {displayLead.email && (
                          <a
                            href={`mailto:${displayLead.email}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer w-full" style={{ background: '#112d1c', color: '#d0e8df' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowWriteMenu(false);
                            }}
                          >
                            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M19.25 3.66667H2.75C1.64543 3.66667 0.75 4.5621 0.75 5.66667V16.3333C0.75 17.4379 1.64543 18.3333 2.75 18.3333H19.25C20.3546 18.3333 21.25 17.4379 21.25 16.3333V5.66667C21.25 4.5621 20.3546 3.66667 19.25 3.66667Z" stroke="#d0e8df" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M0.75 5.66667L11 12.8333L21.25 5.66667" stroke="#d0e8df" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span>{t('common.mail')}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Информация о лиде */}
              <div className='flex flex-col gap-4'>
                {/* Дата регистрации */}
                <div className='flex flex-col gap-1.5'>
                  <span 
                    className='text-gray-500'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '14px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('leadCard.registeredDate')}
                  </span>
                  <span
                    className='text-black'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {formatDate(displayLead.createdAt)}
                  </span>
                </div>

                {/* Тип */}
                <div className='flex flex-col gap-1.5'>
                  <span 
                    className='text-gray-500'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '14px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('leadCard.type')}
                  </span>
                  <div className='flex items-center gap-1'>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g clipPath="url(#clip0_4604_64674)">
                      <path d="M0 0V1.80001H0.899985V18H7.19997V14.4H10.8V18H17.1V1.80001H18V0H0ZM5.4 12.6H3.59998V10.8H5.4V12.6ZM5.4 8.99998H3.59998V7.19997H5.4V8.99998ZM5.4 5.4H3.59998V3.59998H5.4V5.4ZM9.90001 12.6H8.09999V10.8H9.90001V12.6ZM9.90001 8.99998H8.09999V7.19997H9.90001V8.99998ZM9.90001 5.4H8.09999V3.59998H9.90001V5.4ZM14.4 12.6H12.6V10.8H14.4V12.6ZM14.4 8.99998H12.6V7.19997H14.4V8.99998ZM14.4 5.4H12.6V3.59998H14.4V5.4Z" fill="#169600"/>
                      </g>
                      <defs>
                      <clipPath id="clip0_4604_64674">
                      <rect width="18" height="18" fill="white"/>
                      </clipPath>
                      </defs>
                    </svg>
                    <span 
                      className='text-dream-primary'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {getProductTypeDisplayLabel(displayLead.productType)}
                    </span>
                  </div>
                </div>
                
                {/* Город */}
                <div className='flex flex-col gap-1.5'>
                  <span 
                    className='text-gray-500'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '14px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('leadCard.city')}
                  </span>
                  <span 
                    className='text-black'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {extractCity()}
                  </span> 
                </div>
                
                {/* Бюджет - скрываем для NETWORK */}
                {displayLead.productType !== ProductType.NETWORK && (
                  <div className='flex flex-col gap-1.5'>
                    <span 
                      className='text-gray-500'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                      {t('leadCard.budget')}
                    </span>
                    <span 
                      className='text-black'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {formatBudget(displayLead.budgetValue, displayLead.budgetCurrency)}
                    </span> 
                  </div>
                )}
                
                {/* Тип объекта - скрываем для NETWORK */}
                {displayLead.productType !== ProductType.NETWORK && (
                  <div className='flex flex-col gap-1.5'>
                    <span 
                      className='text-gray-500'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                      {t('leadCard.propertyType')}
                    </span>
                    <span 
                      className='text-black'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {extractPropertyType()}
                    </span> 
                  </div>
                )}
                
                {/* Тип сделки - скрываем для NETWORK */}
                {displayLead.productType !== ProductType.NETWORK && (
                  <div className='flex flex-col gap-1.5'>
                    <span 
                      className='text-gray-500'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                      {t('leadCard.dealType')}
                    </span>
                    <span 
                      className='text-black'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {extractDealType()}
                    </span> 
                  </div>
                )}
                
                {/* Телефон */}
                <div className='flex flex-col gap-1.5'>
                  <span 
                    className='text-gray-500'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '14px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('leadCard.phone')}
                  </span>
                  <span 
                    className='text-black'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {displayLead.phone || t('leadCard.notSpecified')}
                  </span>
                </div>
                
                {/* Email */}
                <div className='flex flex-col gap-1.5'>
                  <span 
                    className='text-gray-500'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '14px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('leadCard.email')}
                  </span>
                  <span 
                    className='text-black'
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '20px',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {displayLead.email || t('leadCard.notSpecified')}
                  </span>
                </div>
                
                {/* Telegram */}
                {(displayLead as any).telegram && (
                  <div className='flex flex-col gap-1.5'>
                    <span 
                      className='text-gray-500'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      Telegram:
                    </span>
                    <a
                      href={`https://t.me/${((displayLead as any).telegram as string).replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className='text-black hover:text-dream-primary transition-colors'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '16px',
                        lineHeight: '20px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      @{((displayLead as any).telegram as string).replace(/^@/, '')}
                    </a>
                  </div>
                )}

                {/* Резюме AI — DEMO_FALLBACK: пока бэкенд не отдаёт aiSummary, показываем пример для наглядности */}
                {(() => {
                  const aiSummaryText = (displayLead as any).aiSummary
                    || `Постоянный клиент. Интересовался объектами в категории «${getProductTypeDisplayLabel(displayLead.productType)}». Рекомендуется уточнить актуальный бюджет и сроки принятия решения.`
                  return (
                    <div
                      className='flex flex-col gap-1.5 rounded-lg px-3 py-2.5'
                      style={{ background: 'rgba(22,150,0,0.06)' }}
                    >
                      <span
                        className='text-dream-primary'
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 500,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '20px',
                          letterSpacing: '0px',
                          leadingTrim: 'none'
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {t('leadCard.aiSummary')}
                      </span>
                      <span
                        className='text-black'
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '22px',
                          letterSpacing: '0px',
                          leadingTrim: 'none'
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {aiSummaryText}
                      </span>
                    </div>
                  )
                })()}

                {/* Слайдеры для риэлтора и куратора (только для сети) или текстовое отображение (для RP) */}
                {(displayLead?.realtorStage || displayLead?.curatorStage || displayLead?.productType === ProductType.NETWORK) && (
                  <div className='flex flex-col gap-6 items-start'>
                    {/* Слайдер риэлтора (для сети) или текстовое отображение (для RP) */}
                    {(displayLead?.realtorStage || displayLead?.productType === ProductType.NETWORK) && (
                      displayLead?.productType === ProductType.NETWORK ? (
                        <div className='flex flex-col gap-2 w-[72%] max-w-[620px]' style={{ flexShrink: 0, alignSelf: 'center' }}>
                          <span 
                            className='text-gray-900'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 500,
                              fontStyle: 'normal',
                              fontSize: '14px',
                              lineHeight: '20px',
                              letterSpacing: '0px',
                              leadingTrim: 'none',
                              minHeight: '20px',
                              display: 'flex',
                              alignItems: 'center'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          >
                            {displayLead?.realtorStage && getRealtorStageLabel(displayLead.realtorStage)
                              ? getRealtorStageLabel(displayLead.realtorStage)
                              : t('leadCard.realtor')}
                          </span>
                          <div className="relative" style={{ paddingTop: '12px', paddingBottom: '12px', width: '100%' }}>
                            <div className="relative h-[6px] w-full rounded-full overflow-hidden">
                              {realtorStages.map((_, index) => {
                                if (index >= realtorStages.length - 1) return null;
                                const leftPercent = (index / (realtorStages.length - 1)) * 100;
                                const widthPercent = 100 / (realtorStages.length - 1);
                                const currentPosition = getRealtorPosition(displayLead?.realtorStage);
                                const isPartBeforeSlider = currentPosition >= index + 2;
                                const segmentColor = isPartBeforeSlider ? 'rgb(95, 190, 78)' : 'rgb(191, 229, 184)';
                                
                                return (
                                  <div
                                    key={index}
                                    className="absolute top-0 h-full border-r-3 border-white last:border-r-0"
                                    style={{
                                      left: `${leftPercent}%`,
                                      width: `${widthPercent}%`,
                                      backgroundColor: segmentColor,
                                      transition: 'background-color 0.1s ease-out'
                                    }}
                                  />
                                );
                              })}
                              
                              <input
                                type="range"
                                min="1"
                                max={realtorStages.length}
                                step="1"
                                value={getRealtorPosition(displayLead?.realtorStage)}
                                onChange={(e) => handleRealtorStageChange(Number(e.target.value))}
                                className="absolute top-0 left-0 w-full h-full opacity-0 z-30 cursor-pointer"
                                style={{
                                  WebkitAppearance: 'none',
                                  appearance: 'none',
                                  background: 'transparent'
                                }}
                              />
                            </div>
                            
                            <svg
                              width="17"
                              height="39"
                              viewBox="0 0 17 39"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="absolute pointer-events-none z-20"
                              style={{
                                left: `calc(${((getRealtorPosition(displayLead?.realtorStage) - 1) / (realtorStages.length - 1)) * 100}% - 8.5px)`,
                                top: '50%',
                                transform: 'translateY(-50%) translateZ(0)',
                                transition: 'left 0.1s ease-out',
                                willChange: 'left'
                              }}
                            >
                              <path 
                                d="M8.5 0.5C9.50751 0.5 10.5068 0.966717 11.46 1.8916C12.4155 2.81878 13.2991 4.1844 14.0518 5.91113C15.5565 9.36323 16.5 14.1673 16.5 19.5C16.5 24.8327 15.5565 29.6368 14.0518 33.0889C13.2991 34.8156 12.4155 36.1812 11.46 37.1084C10.5068 38.0333 9.50751 38.5 8.5 38.5C7.49249 38.5 6.49322 38.0333 5.54004 37.1084C4.58451 36.1812 3.70094 34.8156 2.94824 33.0889C1.44348 29.6368 0.5 24.8327 0.5 19.5C0.5 14.1673 1.44348 9.36323 2.94824 5.91113C3.70094 4.1844 4.58451 2.81878 5.54004 1.8916C6.49322 0.966717 7.49249 0.5 8.5 0.5Z" 
                                fill="#52B041" 
                                stroke="rgba(165, 225, 165, 0.6)"
                                style={{
                                  transition: 'fill 0.2s ease-out, stroke 0.2s ease-out'
                                }}
                              />
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div className='flex flex-col gap-2 w-full'>
                          <span 
                            className='text-gray-900'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 500,
                              fontStyle: 'normal',
                              fontSize: '14px',
                              lineHeight: '20px',
                              letterSpacing: '0px',
                              leadingTrim: 'none',
                              minHeight: '20px',
                              display: 'flex',
                              alignItems: 'center'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >
                          {t('leadCard.realtor')}
                        </span>
                        <span
                          className='text-gray-900 font-normal'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '16px',
                            lineHeight: '24px',
                            letterSpacing: '0px',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >
                          {getRealtorStageLabel(displayLead.realtorStage) || t('leadCard.notSpecified')}
                        </span>
                        </div>
                      )
                    )}

                    {/* Слайдер куратора (для сети) или текстовое отображение (для RP) */}
                    {(displayLead?.curatorStage || displayLead?.productType === ProductType.NETWORK) && (
                      displayLead?.productType === ProductType.NETWORK ? (
                        <div className='flex flex-col gap-2 w-[72%] max-w-[620px]' style={{ flexShrink: 0, alignSelf: 'center' }}>
                          <span 
                            className='text-gray-900'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 500,
                              fontStyle: 'normal',
                              fontSize: '14px',
                              lineHeight: '20px',
                              letterSpacing: '0px',
                              leadingTrim: 'none',
                              minHeight: '20px',
                              display: 'flex',
                              alignItems: 'center'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          >
                            {displayLead?.curatorStage && getCuratorStageLabel(displayLead.curatorStage)
                              ? getCuratorStageLabel(displayLead.curatorStage)
                              : t('leadCard.curator')}
                          </span>
                          <div className="relative" style={{ paddingTop: '12px', paddingBottom: '12px', width: '100%' }}>
                            <div className="relative h-[6px] w-full rounded-full overflow-hidden">
                              {curatorStages.map((_, index) => {
                                if (index >= curatorStages.length - 1) return null;
                                const leftPercent = (index / (curatorStages.length - 1)) * 100;
                                const widthPercent = 100 / (curatorStages.length - 1);
                                const currentPosition = getCuratorPosition(displayLead?.curatorStage);
                                const isPartBeforeSlider = currentPosition >= index + 2;
                                const segmentColor = isPartBeforeSlider ? 'rgb(95, 190, 78)' : 'rgb(191, 229, 184)';
                                
                                return (
                                  <div
                                    key={index}
                                    className="absolute top-0 h-full border-r-3 border-white last:border-r-0"
                                    style={{
                                      left: `${leftPercent}%`,
                                      width: `${widthPercent}%`,
                                      backgroundColor: segmentColor,
                                      transition: 'background-color 0.1s ease-out'
                                    }}
                                  />
                                );
                              })}
                              
                              <input
                                type="range"
                                min="1"
                                max={curatorStages.length}
                                step="1"
                                value={getCuratorPosition(displayLead?.curatorStage)}
                                onChange={(e) => handleCuratorStageChange(Number(e.target.value))}
                                className="absolute top-0 left-0 w-full h-full opacity-0 z-30 cursor-pointer"
                                style={{
                                  WebkitAppearance: 'none',
                                  appearance: 'none',
                                  background: 'transparent'
                                }}
                              />
                            </div>
                            
                            <svg
                              width="17"
                              height="39"
                              viewBox="0 0 17 39"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="absolute pointer-events-none z-20"
                              style={{
                                left: `calc(${((getCuratorPosition(displayLead?.curatorStage) - 1) / (curatorStages.length - 1)) * 100}% - 8.5px)`,
                                top: '50%',
                                transform: 'translateY(-50%) translateZ(0)',
                                transition: 'left 0.1s ease-out',
                                willChange: 'left'
                              }}
                            >
                              <path 
                                d="M8.5 0.5C9.50751 0.5 10.5068 0.966717 11.46 1.8916C12.4155 2.81878 13.2991 4.1844 14.0518 5.91113C15.5565 9.36323 16.5 14.1673 16.5 19.5C16.5 24.8327 15.5565 29.6368 14.0518 33.0889C13.2991 34.8156 12.4155 36.1812 11.46 37.1084C10.5068 38.0333 9.50751 38.5 8.5 38.5C7.49249 38.5 6.49322 38.0333 5.54004 37.1084C4.58451 36.1812 3.70094 34.8156 2.94824 33.0889C1.44348 29.6368 0.5 24.8327 0.5 19.5C0.5 14.1673 1.44348 9.36323 2.94824 5.91113C3.70094 4.1844 4.58451 2.81878 5.54004 1.8916C6.49322 0.966717 7.49249 0.5 8.5 0.5Z" 
                                fill="#52B041" 
                                stroke="rgba(165, 225, 165, 0.6)"
                                style={{
                                  transition: 'fill 0.2s ease-out, stroke 0.2s ease-out'
                                }}
                              />
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div className='flex flex-col gap-2 w-full'>
                          <span 
                            className='text-gray-900'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 500,
                              fontStyle: 'normal',
                              fontSize: '14px',
                              lineHeight: '20px',
                              letterSpacing: '0px',
                              leadingTrim: 'none',
                              minHeight: '20px',
                              display: 'flex',
                              alignItems: 'center'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >
                          {t('leadCard.curator')}
                        </span>
                        <span
                          className='text-gray-900 font-normal'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '16px',
                            lineHeight: '24px',
                            letterSpacing: '0px',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >
                          {getCuratorStageLabel(displayLead.curatorStage) || t('leadCard.notSpecified')}
                        </span>
                        </div>
                      )
                    )}

                    {/* Слайдер для сети */}
                    {displayLead?.productType === ProductType.NETWORK && displayLead?.stage && !displayLead?.realtorStage && !displayLead?.curatorStage && (
                      <div className='flex flex-col gap-2 w-[72%] max-w-[620px]' style={{ flexShrink: 0, alignSelf: 'center' }}>
                        <span 
                          className='text-gray-900'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 500,
                            fontStyle: 'normal',
                            fontSize: '14px',
                            lineHeight: '20px',
                            letterSpacing: '0px',
                            leadingTrim: 'none',
                            minHeight: '20px',
                            display: 'flex',
                            alignItems: 'center'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >
                          {getStageLabel(displayLead.stage, displayLead.productType) || t('leadCard.currentStage')}
                        </span>
                        <div className="relative" style={{ paddingTop: '12px', paddingBottom: '12px', width: '100%' }}>
                          <div className="relative h-[6px] w-full rounded-full overflow-hidden">
                            {networkStages.map((_, index) => {
                              if (index >= networkStages.length - 1) return null;
                              const leftPercent = (index / (networkStages.length - 1)) * 100;
                              const widthPercent = 100 / (networkStages.length - 1);
                              const currentPosition = getNetworkPosition(displayLead?.stage);
                              const isPartBeforeSlider = currentPosition >= index + 2;
                              const segmentColor = isPartBeforeSlider ? 'rgb(95, 190, 78)' : 'rgb(191, 229, 184)';
                              
                              return (
                                <div
                                  key={index}
                                  className="absolute top-0 h-full border-r-3 border-white last:border-r-0"
                                  style={{
                                    left: `${leftPercent}%`,
                                    width: `${widthPercent}%`,
                                    backgroundColor: segmentColor,
                                    transition: 'background-color 0.1s ease-out'
                                  }}
                                />
                              );
                            })}
                            
                            <input
                              type="range"
                              min="1"
                              max={networkStages.length}
                              step="1"
                              value={getNetworkPosition(displayLead?.stage)}
                              onChange={(e) => handleNetworkStageChange(Number(e.target.value))}
                              className="absolute top-0 left-0 w-full h-full opacity-0 z-30 cursor-pointer"
                              style={{
                                WebkitAppearance: 'none',
                                appearance: 'none',
                                background: 'transparent'
                              }}
                            />
                          </div>
                          
                          <svg
                            width="17"
                            height="39"
                            viewBox="0 0 17 39"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="absolute pointer-events-none z-20"
                            style={{
                              left: `calc(${((getNetworkPosition(displayLead?.stage) - 1) / (networkStages.length - 1)) * 100}% - 8.5px)`,
                              top: '50%',
                              transform: 'translateY(-50%) translateZ(0)',
                              transition: 'left 0.1s ease-out',
                              willChange: 'left'
                            }}
                          >
                            <path 
                              d="M8.5 0.5C9.50751 0.5 10.5068 0.966717 11.46 1.8916C12.4155 2.81878 13.2991 4.1844 14.0518 5.91113C15.5565 9.36323 16.5 14.1673 16.5 19.5C16.5 24.8327 15.5565 29.6368 14.0518 33.0889C13.2991 34.8156 12.4155 36.1812 11.46 37.1084C10.5068 38.0333 9.50751 38.5 8.5 38.5C7.49249 38.5 6.49322 38.0333 5.54004 37.1084C4.58451 36.1812 3.70094 34.8156 2.94824 33.0889C1.44348 29.6368 0.5 24.8327 0.5 19.5C0.5 14.1673 1.44348 9.36323 2.94824 5.91113C3.70094 4.1844 4.58451 2.81878 5.54004 1.8916C6.49322 0.966717 7.49249 0.5 8.5 0.5Z" 
                              fill="#52B041" 
                              stroke="rgba(165, 225, 165, 0.6)"
                              style={{
                                transition: 'fill 0.2s ease-out, stroke 0.2s ease-out'
                              }}
                            />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                      </div>
                    </div>
                </div>
                
                {/* Контент для табов */}
                <div className='flex-[1] flex flex-col gap-4 min-w-0 min-h-0 overflow-hidden '>
              {selectedTab === 'tasks' && (
                <div className="flex flex-col gap-3.5 flex-1 min-h-0 overflow-y-auto">
                   <div className='flex items-center justify-between flex-shrink-0'>
                     <span 
                       className='text-black'
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
                       {t('leadCard.tasksByClient')}
                     </span>
                     <button
                       className='flex items-center pr-5 pl-2.5 py-2 cursor-pointer'
                       onClick={() => {
                         if (onOpenTaskManagementModal) {
                           onOpenTaskManagementModal();
                         }
                       }}
                       disabled={!onOpenTaskManagementModal}
                     >
                       <span
                         className='text-dream-primary hidden md:block'
                         style={{
                           fontFamily: 'var(--font-sans)',
                           fontWeight: 400,
                           fontStyle: 'normal',
                           fontSize: '18px',
                           lineHeight: '100%',
                           letterSpacing: '0px',
                           leadingTrim: 'cap-height'
                         } as React.CSSProperties & { leadingTrim?: string }}
                       >
                         {t('leadCard.goToTasks')}
                       </span>
                       <span
                         className='text-dream-primary md:hidden'
                         style={{
                           fontFamily: 'var(--font-sans)',
                           fontWeight: 400,
                           fontStyle: 'normal',
                           fontSize: '18px',
                           lineHeight: '100%',
                           letterSpacing: '0px',
                           leadingTrim: 'cap-height'
                         } as React.CSSProperties & { leadingTrim?: string }}
                       >
                         {t('leadCard.tasksTab')}
                       </span>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <g clipPath="url(#clip0_4604_64704)">
                        <path d="M13.1727 12.0007L8.22266 7.05072L9.63666 5.63672L16.0007 12.0007L9.63666 18.3647L8.22266 16.9507L13.1727 12.0007Z" fill="#169600"/>
                        </g>
                        <defs>
                        <clipPath id="clip0_4604_64704">
                        <rect width="24" height="24" fill="white"/>
                        </clipPath>
                        </defs>
                      </svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 pr-2 flex-1 overflow-y-auto overflow-x-hidden auto-rows-min">
                    {isLoadingTasks ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dream-primary"></div>
                      </div>
                    ) : modalTasksData.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-gray-500">
                        <span>{t('leadCard.noTasksForClient')}</span>
                      </div>
                    ) : (
                      modalTasksData.map((task, index) => (
                        <div key={task.id} className="w-full">
                          <TaskCard
                            task={task}
                            index={index}
                            isChecked={!!taskChecked[index]}
                            viewMode="grid"
                            onCheckboxChange={(checked) => {
                              handleTaskStatusChange(task.id, checked);
                            }}
                            onShowInfo={() => handleOpenTaskView(task.id)}
                            onEdit={() => handleOpenTaskView(task.id)}
                            onDelete={() => handleDeleteTask(task.id)}
                          />
                        </div>
                      ))
                    )}
                  </div>
                  <div className='flex justify-start flex-shrink-0'>
                    <button 
                      className='flex items-center gap-2 h-9.5 px-5 rounded-full bg-dream-primary cursor-pointer'
                      onClick={() => {
                        if (displayLead?._id && onOpenNewTaskModal) {
                          onOpenNewTaskModal(displayLead._id);
                        }
                      }}
                      disabled={!displayLead?._id || !onOpenNewTaskModal}
                    >
                      <svg width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 24.0623C11.3527 24.0623 10.8281 23.4503 10.8281 22.6951V5.30664C10.8281 4.55141 11.3527 3.93945 12 3.93945C12.6473 3.93945 13.1719 4.55141 13.1719 5.30664V22.6951C13.1719 23.4503 12.6473 24.0623 12 24.0623Z" fill="white"/>
                        <path d="M19.4513 15.3672H4.54688C3.89953 15.3672 3.375 14.7552 3.375 14C3.375 13.2448 3.89953 12.6328 4.54688 12.6328H19.4513C20.0986 12.6328 20.6231 13.2448 20.6231 14C20.6231 14.7552 20.0986 15.3672 19.4513 15.3672Z" fill="white"/>
                      </svg>

                      <span
                      className='text-white'
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '150%',
                          letterSpacing: '-0.01em',
                          leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                        {t('leadCard.newTask')}
                      </span>
                    </button>
                  </div>
                </div>
              )}
              {selectedTab === 'objects' && (
                <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto w-full">
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-gray-400">{t('leadCard.objectsTitle')}</span>
                    <p className="text-xl font-normal text-black">{t('leadCard.favoriteObjects')}</p>
                  </div>
                  {shouldShowObjectsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dream-primary"></div>
                    </div>
                  ) : favoritesError || hasNoFavorites || !displayLead?.email ? (
                    <div className="rounded-[25px] border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
                      {t('leadCard.noFavoritesForLead')}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3 justify-start">
                      {favoriteObjects.map((favorite, index) => {
                        const priceLabel = formatPrice(favorite.price);
                        const pricePerSqmLabel = favorite.pricePerSqm ? formatPrice(favorite.pricePerSqm) : null;
                        const favoriteImageUrl = favorite.imageUrl || FAVORITE_PLACEHOLDER_IMAGE;
                        const urgentLabel =
                          favorite.dealType?.toLowerCase() === 'rent'
                            ? [t('leadCard.urgentRent')]: favorite.dealType?.toLowerCase() === 'sale'
                            ? [t('leadCard.urgentSale')]: t('leadCard.urgentOffer');

                        return (
                          <div
                            key={favorite.id ?? `favorite-${index}`}
                            className="h-auto w-105.5 rounded-[8px] flex flex-col gap-4.25"
                            style={{
                              boxShadow: '0px 4px 50px 0px rgba(22, 150, 0, 0.15)'
                            }}
                          >
                            <div className="relative w-full h-75">
                              <button className="absolute top-5 left-3.5 flex items-center gap-1 py-1.5 px-2.5 rounded-full bg-dream-primary cursor-pointer">
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M7.48556 12.718C9.30902 12.3525 11.6667 11.0408 11.6667 7.64876C11.6667 4.562 9.40723 2.50653 7.78256 1.56206C7.42205 1.35249 7 1.6281 7 2.0451V3.11172C7 3.9528 6.64637 5.48805 5.66377 6.12662C5.1621 6.45264 4.6203 5.96468 4.55933 5.3695L4.50927 4.88076C4.45107 4.31259 3.87241 3.96768 3.41831 4.31409C2.60252 4.93641 1.75 6.02617 1.75 7.64876C1.75 11.7969 4.83519 12.8339 6.37778 12.8339C6.4675 12.8339 6.56179 12.8313 6.65995 12.8256C5.89826 12.7605 4.66667 12.2879 4.66667 10.7597C4.66667 9.56427 5.53879 8.75552 6.20143 8.36241C6.37965 8.25669 6.58824 8.39397 6.58824 8.60118V8.94489C6.58824 9.20793 6.68996 9.61908 6.93212 9.90055C7.20614 10.219 7.60837 9.88541 7.6408 9.46651C7.65103 9.33435 7.78394 9.25014 7.89838 9.31702C8.27248 9.53565 8.75 10.0027 8.75 10.7597C8.75 11.9544 8.09143 12.5039 7.48556 12.718Z" fill="white"/>
                                </svg>
                                <span
                                  className="text-white"
                                  style={{
                                    fontFamily: 'var(--font-sans)',
                                    fontWeight: 400,
                                    fontStyle: 'normal',
                                    fontSize: '13px',
                                    lineHeight: '100%',
                                    letterSpacing: '0px',
                                    textAlign: 'center',
                                    leadingTrim: 'cap-height'
                                  } as React.CSSProperties & { leadingTrim?: string }}
                                >
                                  {urgentLabel}
                                </span>
                              </button>

                              <svg width="111" height="40" viewBox="0 0 111 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute bottom-0 -left-2">
                                <path d="M7.82222 40.0009L0 32H7.82222V40.0009Z" fill="#169600"/>
                                <path d="M0 8C0 3.58172 3.58172 0 8 0H102.489C106.907 0 110.489 3.58172 110.489 8V24.0035C110.489 28.4218 106.907 32.0035 102.489 32.0035H0V8Z" fill="#169600"/>
                                <path fillRule="evenodd" clipRule="evenodd" d="M19.6441 9.59961C19.8563 9.59961 20.0598 9.68389 20.2098 9.83392C20.3599 9.98395 20.4441 10.1874 20.4441 10.3996V11.1996H21.2441C21.4563 11.1996 21.6598 11.2839 21.8098 11.4339C21.9599 11.584 22.0441 11.7874 22.0441 11.9996C22.0441 12.2118 21.9599 12.4153 21.8098 12.5653C21.6598 12.7153 21.4563 12.7996 21.2441 12.7996H20.4441V13.5996C20.4441 13.8118 20.3599 14.0153 20.2098 14.1653C20.0598 14.3153 19.8563 14.3996 19.6441 14.3996C19.432 14.3996 19.2285 14.3153 19.0785 14.1653C18.9284 14.0153 18.8441 13.8118 18.8441 13.5996V12.7996H18.0441C17.832 12.7996 17.6285 12.7153 17.4785 12.5653C17.3284 12.4153 17.2441 12.2118 17.2441 11.9996C17.2441 11.7874 17.3284 11.584 17.4785 11.4339C17.6285 11.2839 17.832 11.1996 18.0441 11.1996H18.8441V10.3996C18.8441 10.1874 18.9284 9.98395 19.0785 9.83392C19.2285 9.68389 19.432 9.59961 19.6441 9.59961ZM19.6441 17.5996C19.8563 17.5996 20.0598 17.6839 20.2098 17.8339C20.3599 17.984 20.4441 18.1874 20.4441 18.3996V19.1996H21.2441C21.4563 19.1996 21.6598 19.2839 21.8098 19.4339C21.9599 19.584 22.0441 19.7874 22.0441 19.9996C22.0441 20.2118 21.9599 20.4153 21.8098 20.5653C21.6598 20.7153 21.4563 20.7996 21.2441 20.7996H20.4441V21.5996C20.4441 21.8118 20.3599 22.0153 20.2098 22.1653C20.0598 22.3153 19.8563 22.3996 19.6441 22.3996C19.432 22.3996 19.2285 22.3153 19.0785 22.1653C18.9284 22.0153 18.8441 21.8118 18.8441 21.5996V20.7996H18.0441C17.832 20.7996 17.6285 20.7153 17.4785 20.5653C17.3284 20.4153 17.2441 20.2118 17.2441 19.9996C17.2441 19.7874 17.3284 19.584 17.4785 19.4339C17.6285 19.2839 17.832 19.1996 18.0441 19.1996H18.8441V18.3996C18.8441 18.1874 18.9284 17.984 19.0785 17.8339C19.2285 17.6839 19.432 17.5996 19.6441 17.5996ZM25.2441 9.59961C25.4207 9.59955 25.5923 9.6579 25.7322 9.76556C25.8722 9.87322 25.9725 10.0241 26.0177 10.1948L26.9609 13.7596L29.6441 15.3068C29.7657 15.377 29.8667 15.478 29.9369 15.5996C30.0071 15.7212 30.0441 15.8592 30.0441 15.9996C30.0441 16.14 30.0071 16.278 29.9369 16.3996C29.8667 16.5212 29.7657 16.6222 29.6441 16.6924L26.9609 18.2404L26.0169 21.8044C25.9717 21.9749 25.8713 22.1257 25.7315 22.2332C25.5916 22.3408 25.4202 22.3991 25.2437 22.3991C25.0673 22.3991 24.8959 22.3408 24.756 22.2332C24.6162 22.1257 24.5158 21.9749 24.4705 21.8044L23.5273 18.2396L20.8441 16.6924C20.7225 16.6222 20.6216 16.5212 20.5513 16.3996C20.4811 16.278 20.4442 16.14 20.4442 15.9996C20.4442 15.8592 20.4811 15.7212 20.5513 15.5996C20.6216 15.478 20.7225 15.377 20.8441 15.3068L23.5273 13.7588L24.4713 10.1948C24.5165 10.0243 24.6168 9.87345 24.7565 9.7658C24.8963 9.65816 25.0677 9.59973 25.2441 9.59961Z" fill="white"/>
                                <path d="M36.5085 21V12.06H39.8445C40.4525 12.06 40.9885 12.172 41.4525 12.396C41.9245 12.612 42.2925 12.932 42.5565 13.356C42.8205 13.772 42.9525 14.28 42.9525 14.88C42.9525 15.472 42.8165 15.98 42.5445 16.404C42.2805 16.82 41.9165 17.14 41.4525 17.364C40.9885 17.588 40.4525 17.7 39.8445 17.7H38.1405V21H36.5085ZM38.1405 16.26H39.8685C40.1645 16.26 40.4205 16.204 40.6365 16.092C40.8525 15.972 41.0205 15.808 41.1405 15.6C41.2605 15.392 41.3205 15.152 41.3205 14.88C41.3205 14.6 41.2605 14.36 41.1405 14.16C41.0205 13.952 40.8525 13.792 40.6365 13.68C40.4205 13.56 40.1645 13.5 39.8685 13.5H38.1405V16.26ZM44.6578 21V14.472H46.1338V15.924L46.0138 15.708C46.1658 15.22 46.4018 14.88 46.7218 14.688C47.0498 14.496 47.4418 14.4 47.8978 14.4H48.2818V15.792H47.7178C47.2698 15.792 46.9098 15.932 46.6378 16.212C46.3658 16.484 46.2298 16.868 46.2298 17.364V21H44.6578ZM52.7421 21.144C52.0701 21.144 51.4821 20.992 50.9781 20.688C50.4741 20.384 50.0821 19.972 49.8021 19.452C49.5221 18.932 49.3821 18.356 49.3821 17.724C49.3821 17.068 49.5221 16.488 49.8021 15.984C50.0901 15.472 50.4781 15.068 50.9661 14.772C51.4621 14.476 52.0141 14.328 52.6221 14.328C53.1341 14.328 53.5821 14.412 53.9661 14.58C54.3581 14.748 54.6901 14.98 54.9621 15.276C55.2341 15.572 55.4421 15.912 55.5861 16.296C55.7301 16.672 55.8021 17.08 55.8021 17.52C55.8021 17.632 55.7941 17.748 55.7781 17.868C55.7701 17.988 55.7501 18.092 55.7181 18.18H50.6781V16.98H54.8301L54.0861 17.544C54.1581 17.176 54.1381 16.848 54.0261 16.56C53.9221 16.272 53.7461 16.044 53.4981 15.876C53.2581 15.708 52.9661 15.624 52.6221 15.624C52.2941 15.624 52.0021 15.708 51.7461 15.876C51.4901 16.036 51.2941 16.276 51.1581 16.596C51.0301 16.908 50.9821 17.288 51.0141 17.736C50.9821 18.136 51.0341 18.492 51.1701 18.804C51.3141 19.108 51.5221 19.344 51.7941 19.512C52.0741 19.68 52.3941 19.764 52.7541 19.764C53.1141 19.764 53.4181 19.688 53.6661 19.536C53.9221 19.384 54.1221 19.18 54.2661 18.924L55.5381 19.548C55.4101 19.86 55.2101 20.136 54.9381 20.376C54.6661 20.616 54.3421 20.804 53.9661 20.94C53.5981 21.076 53.1901 21.144 52.7421 21.144ZM57.4937 21V14.472H58.9697V15.984L58.8017 15.732C58.9217 15.26 59.1617 14.908 59.5217 14.676C59.8817 14.444 60.3057 14.328 60.7937 14.328C61.3297 14.328 61.8017 14.468 62.2097 14.748C62.6177 15.028 62.8817 15.396 63.0017 15.852L62.5577 15.888C62.7577 15.368 63.0577 14.98 63.4577 14.724C63.8577 14.46 64.3177 14.328 64.8377 14.328C65.3017 14.328 65.7137 14.432 66.0737 14.64C66.4417 14.848 66.7297 15.14 66.9377 15.516C67.1457 15.884 67.2497 16.312 67.2497 16.8V21H65.6777V17.172C65.6777 16.884 65.6257 16.636 65.5217 16.428C65.4177 16.22 65.2737 16.06 65.0897 15.948C64.9057 15.828 64.6817 15.768 64.4177 15.768C64.1697 15.768 63.9497 15.828 63.7577 15.948C63.5657 16.06 63.4177 16.22 63.3137 16.428C63.2097 16.636 63.1577 16.884 63.1577 17.172V21H61.5857V17.172C61.5857 16.884 61.5337 16.636 61.4297 16.428C61.3257 16.22 61.1777 16.06 60.9857 15.948C60.8017 15.828 60.5817 15.768 60.3257 15.768C60.0777 15.768 59.8577 15.828 59.6657 15.948C59.4737 16.06 59.3257 16.22 59.2217 16.428C59.1177 16.636 59.0657 16.884 59.0657 17.172V21H57.4937ZM69.0797 21V14.472H70.6517V21H69.0797ZM69.0797 13.74V12.06H70.6517V13.74H69.0797ZM74.9311 21.144C74.4271 21.144 73.9871 21.032 73.6111 20.808C73.2431 20.584 72.9591 20.272 72.7591 19.872C72.5671 19.472 72.4711 19.004 72.4711 18.468V14.472H74.0431V18.336C74.0431 18.608 74.0951 18.848 74.1991 19.056C74.3111 19.256 74.4671 19.416 74.6671 19.536C74.8751 19.648 75.1071 19.704 75.3631 19.704C75.6191 19.704 75.8471 19.648 76.0471 19.536C76.2471 19.416 76.4031 19.252 76.5151 19.044C76.6271 18.836 76.6831 18.588 76.6831 18.3V14.472H78.2551V21H76.7671V19.716L76.8991 19.944C76.7471 20.344 76.4951 20.644 76.1431 20.844C75.7991 21.044 75.3951 21.144 74.9311 21.144ZM80.2164 21V14.472H81.6924V15.984L81.5244 15.732C81.6444 15.26 81.8844 14.908 82.2444 14.676C82.6044 14.444 83.0284 14.328 83.5164 14.328C84.0524 14.328 84.5244 14.468 84.9324 14.748C85.3404 15.028 85.6044 15.396 85.7244 15.852L85.2804 15.888C85.4804 15.368 85.7804 14.98 86.1804 14.724C86.5804 14.46 87.0404 14.328 87.5604 14.328C88.0244 14.328 88.4364 14.432 88.7964 14.64C89.1644 14.848 89.4524 15.14 89.6604 15.516C89.8684 15.884 89.9724 16.312 89.9724 16.8V21H88.4004V17.172C88.4004 16.884 88.3484 16.636 88.2444 16.428C88.1404 16.22 87.9964 16.06 87.8124 15.948C87.6284 15.828 87.4044 15.768 87.1404 15.768C86.8924 15.768 86.6724 15.828 86.4804 15.948C86.2884 16.06 86.1404 16.22 86.0364 16.428C85.9324 16.636 85.8804 16.884 85.8804 17.172V21H84.3084V17.172C84.3084 16.884 84.2564 16.636 84.1524 16.428C84.0484 16.22 83.9004 16.06 83.7084 15.948C83.5244 15.828 83.3044 15.768 83.0484 15.768C82.8004 15.768 82.5804 15.828 82.3884 15.948C82.1964 16.06 82.0484 16.22 81.9444 16.428C81.8404 16.636 81.7884 16.884 81.7884 17.172V21H80.2164Z" fill="white"/>
                              </svg>

                              <img
                                src={favoriteImageUrl}
                                alt={favorite.title || t('leadCard.objectsTitle')}
                                className="rounded-[8px] w-full h-full object-cover"
                              />
                            </div>

                            <div className="flex flex-col w-full gap-3.5 p-2.5">
                              <div className="flex items-center justify-between px-2.5">
                                <div className="flex items-center gap-2.5">
                                  {priceLabel ? (
                                    <span
                                      className="text-dream-primary"
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '28px',
                                        lineHeight: '100%',
                                        letterSpacing: '0%',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {priceLabel}
                                    </span>
                                  ) : (
                                    <span
                                      className="text-dream-primary"
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '28px',
                                        lineHeight: '100%',
                                        letterSpacing: '0%',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {t('leadCard.priceNotSpecified')}
                                    </span>
                                  )}
                                  {pricePerSqmLabel && (
                                    <span
                                      className="text-dream-primary"
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '16px',
                                        lineHeight: '100%',
                                        letterSpacing: '0px',
                                        verticalAlign: 'middle',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string; verticalAlign?: string }}
                                    >
                                      $ {pricePerSqmLabel.replace('$', '').trim()} {t('leadCard.perM2')}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <svg width="39" height="39" viewBox="0 0 39 39" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="19.2" cy="19.2" r="18.45" fill="white" stroke="#8EDB8E" strokeWidth="1.5"/>
                                    <g clipPath="url(#clip0_4604_66505)">
                                      <path d="M22.7996 16.2672C24.0146 16.2672 24.9996 15.2822 24.9996 14.0672C24.9996 12.8522 24.0146 11.8672 22.7996 11.8672C21.5846 11.8672 20.5996 12.8522 20.5996 14.0672C20.5996 15.2822 21.5846 16.2672 22.7996 16.2672Z" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M13.9988 21.4C15.2139 21.4 16.1988 20.415 16.1988 19.2C16.1988 17.985 15.2139 17 13.9988 17C12.7838 17 11.7988 17.985 11.7988 19.2C11.7988 20.415 12.7838 21.4 13.9988 21.4Z" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M22.7996 26.5328C24.0146 26.5328 24.9996 25.5478 24.9996 24.3328C24.9996 23.1178 24.0146 22.1328 22.7996 22.1328C21.5846 22.1328 20.5996 23.1178 20.5996 24.3328C20.5996 25.5478 21.5846 26.5328 22.7996 26.5328Z" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M15.8984 20.3086L20.9071 23.2273" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M20.8998 15.1738L15.8984 18.0925" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </g>
                                    <defs>
                                      <clipPath id="clip0_4604_66505">
                                        <rect width="19.2" height="19.2" fill="white" transform="translate(9.59961 9.59961)"/>
                                      </clipPath>
                                    </defs>
                                  </svg>
                                  <svg width="39" height="39" viewBox="0 0 39 39" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="19.2" cy="19.2" r="18.45" fill="white" stroke="#8EDB8E" strokeWidth="1.5"/>
                                    <path fillRule="evenodd" clipRule="evenodd" d="M11.5822 13.1048C12.0734 12.6234 12.6614 12.2407 13.3113 11.9793C13.9611 11.7179 14.6597 11.5832 15.3654 11.5832C16.0711 11.5832 16.7696 11.7179 17.4195 11.9793C18.0693 12.2407 18.6573 12.6234 19.1485 13.1048L19.401 13.3482L19.6535 13.1036C20.1447 12.6222 20.7327 12.2395 21.3825 11.9781C22.0324 11.7167 22.7309 11.582 23.4366 11.582C24.1423 11.582 24.8409 11.7167 25.4907 11.9781C26.1406 12.2395 26.7286 12.6222 27.2197 13.1036C28.2177 14.0813 28.7758 15.3897 28.7758 16.7516C28.7758 18.1135 28.2177 19.4219 27.2197 20.3996L20.4072 27.014C19.8547 27.5483 18.9472 27.5483 18.396 27.014L11.5835 20.3996C10.5857 19.4219 10.0276 18.1136 10.0273 16.7518C10.0271 15.39 10.5848 14.0828 11.5822 13.1048Z" fill="#169600"/>
                                  </svg>
                                </div>
                              </div>
                              <div className="px-2.5 pb-9 flex items-center justify-center h-30 items-start">
                                <span
                                  className="text-black"
                                  style={{
                                    fontFamily: 'var(--font-sans)',
                                    fontWeight: 400,
                                    fontStyle: 'normal',
                                    fontSize: '24px',
                                    lineHeight: '150%',
                                    letterSpacing: '-0.01em',
                                    leadingTrim: 'none'
                                  } as React.CSSProperties & { leadingTrim?: string }}
                                >
                                  {favorite.title || t('leadCard.objectUntitled')}
                                </span>
                              </div>
                              {favorite.location && (
                                <div className="flex items-center justify-start gap-1.5">
                                  <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path fillRule="evenodd" clipRule="evenodd" d="M10.1685 0.714844C8.21577 0.717342 6.34364 1.5098 4.96254 2.91849C3.58144 4.32719 2.80405 6.23719 2.80078 8.2298C2.80078 11.1054 4.58176 13.7259 6.27939 15.6723C7.97703 17.6188 9.67467 18.9164 9.67467 18.9164C9.81625 19.0248 9.98846 19.0833 10.1654 19.0833C10.3424 19.0833 10.5146 19.0248 10.6562 18.9164C10.6562 18.9164 12.3539 17.6188 14.0515 15.6723C15.7491 13.7259 17.5301 11.1054 17.5301 8.2298C17.5285 6.23722 16.752 4.32673 15.3712 2.91777C13.9904 1.5088 12.1213 0.716512 10.1685 0.714844ZM10.1654 4.89122C11.0332 4.89122 11.8654 5.24296 12.479 5.86907C13.0925 6.49517 13.4373 7.34436 13.4373 8.2298C13.4373 9.11525 13.0925 9.96443 12.479 10.5905C11.8654 11.2166 11.0332 11.5684 10.1654 11.5684C9.2977 11.5684 8.46551 11.2166 7.85192 10.5905C7.23834 9.96443 6.89363 9.11525 6.89363 8.2298C6.89363 7.34436 7.23834 6.49517 7.85192 5.86907C8.46551 5.24296 9.2977 4.89122 10.1654 4.89122Z" fill="#169600"/>
                                  </svg>
                                  <span
                                    className="text-black"
                                    style={{
                                      fontFamily: 'var(--font-sans)',
                                      fontWeight: 400,
                                      fontStyle: 'normal',
                                      fontSize: '18px',
                                      lineHeight: '100%',
                                      letterSpacing: '0px',
                                      leadingTrim: 'cap-height'
                                    } as React.CSSProperties & { leadingTrim?: string }}
                                  >
                                    {favorite.location}
                                  </span>
                                </div>
                              )}
                              {favorite.propertyType && (
                                <div className="flex items-center justify-start gap-1.5">
                                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M20 16.666H0V3.33254H20V16.666Z" fill="white"/>
                                    <path d="M11.25 16.666H8.75V11.2494H0V8.74937H8.75V3.33273H11.25V8.74937H20V11.2494H11.25V16.666Z" fill="#D80027"/>
                                    <path d="M4.80941 14.3921V15.2617H3.93988V14.3921H3.07031V13.5226H3.93988V12.653H4.80941V13.5226H5.67898V14.3921H4.80941Z" fill="#D80027"/>
                                    <path d="M16.0594 14.3921V15.2617H15.1899V14.3921H14.3203V13.5226H15.1899V12.653H16.0594V13.5226H16.929V14.3921H16.0594Z" fill="#D80027"/>
                                    <path d="M4.80941 6.47613V7.3457H3.93988V6.47613H3.07031V5.60656H3.93988V4.73699H4.80941V5.60656H5.67898V6.47613H4.80941Z" fill="#D80027"/>
                                    <path d="M16.0594 6.47613V7.3457H15.1899V6.47613H14.3203V5.60656H15.1899V4.73699H16.0594V5.60656H16.929V6.47613H16.0594Z" fill="#D80027"/>
                                  </svg>
                                  <span
                                    className="text-black"
                                    style={{
                                      fontFamily: 'var(--font-sans)',
                                      fontWeight: 400,
                                      fontStyle: 'normal',
                                      fontSize: '18px',
                                      lineHeight: '100%',
                                      letterSpacing: '0px',
                                      leadingTrim: 'cap-height'
                                    } as React.CSSProperties & { leadingTrim?: string }}
                                  >
                                    {normalizeFavoriteLabel(favorite.propertyType)}
                                  </span>
                                </div>
                              )}
                              <div className="w-full h-[1.5px] bg-dream-secondary"></div>
                              <div className="px-2.5 flex items-center justify-between">
                                {favorite.rooms && (
                                  <div className="flex items-center gap-2">
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M17.4993 8.98268V6.66602C17.4993 5.29102 16.3743 4.16602 14.9993 4.16602H11.666C11.0243 4.16602 10.441 4.41602 9.99935 4.81602C9.55768 4.41602 8.97435 4.16602 8.33268 4.16602H4.99935C3.62435 4.16602 2.49935 5.29102 2.49935 6.66602V8.98268C1.99102 9.44102 1.66602 10.0994 1.66602 10.8327V15.8327H3.33268V14.166H16.666V15.8327H18.3327V10.8327C18.3327 10.0994 18.0077 9.44102 17.4993 8.98268ZM11.666 5.83268H14.9993C15.4577 5.83268 15.8327 6.20768 15.8327 6.66602V8.33268H10.8327V6.66602C10.8327 6.20768 11.2077 5.83268 11.666 5.83268ZM4.16602 6.66602C4.16602 6.20768 4.54102 5.83268 4.99935 5.83268H8.33268C8.79102 5.83268 9.16602 6.20768 9.16602 6.66602V8.33268H4.16602V6.66602ZM3.33268 12.4994V10.8327C3.33268 10.3744 3.70768 9.99935 4.16602 9.99935H15.8327C16.291 9.99935 16.666 10.3744 16.666 10.8327V12.4994H3.33268Z" fill="#169600"/>
                                    </svg>
                                    <span
                                      className="text-black"
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '18px',
                                        lineHeight: '100%',
                                        letterSpacing: '0px',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {favorite.rooms}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10.5 6H11.25C11.4489 6 11.6397 5.92098 11.7803 5.78033C11.921 5.63968 12 5.44891 12 5.25C12 5.05109 11.921 4.86032 11.7803 4.71967C11.6397 4.57902 11.4489 4.5 11.25 4.5H10.5C10.3011 4.5 10.1103 4.57902 9.96967 4.71967C9.82902 4.86032 9.75 5.05109 9.75 5.25C9.75 5.44891 9.82902 5.63968 9.96967 5.78033C10.1103 5.92098 10.3011 6 10.5 6ZM10.5 9H11.25C11.4489 9 11.6397 8.92098 11.7803 8.78033C11.921 8.63968 12 8.44891 12 8.25C12 8.05109 11.921 7.86032 11.7803 7.71967C11.6397 7.57902 11.4489 7.5 11.25 7.5H10.5C10.3011 7.5 10.1103 7.57902 9.96967 7.71967C9.82902 7.86032 9.75 8.05109 9.75 8.25C9.75 8.44891 9.82902 8.63968 9.96967 8.78033C10.1103 8.92098 10.3011 9 10.5 9ZM6.75 6H7.5C7.69891 6 7.88968 5.92098 8.03033 5.78033C8.17098 5.63968 8.25 5.44891 8.25 5.25C8.25 5.05109 8.17098 4.86032 8.03033 4.71967C7.88968 4.57902 7.69891 4.5 7.5 4.5H6.75C6.55109 4.5 6.36032 4.57902 6.21967 4.71967C6.07902 4.86032 6 5.05109 6 5.25C6 5.44891 6.07902 5.63968 6.21967 5.78033C6.36032 5.92098 6.55109 6 6.75 6ZM6.75 9H7.5C7.69891 9 7.88968 8.92098 8.03033 8.78033C8.17098 8.63968 8.25 8.44891 8.25 8.25C8.25 8.05109 8.17098 7.86032 8.03033 7.71967C7.88968 7.57902 7.69891 7.5 7.5 7.5H6.75C6.55109 7.5 6.36032 7.57902 6.21967 7.71967C6.07902 7.86032 6 8.05109 6 8.25C6 8.44891 6.07902 8.63968 6.21967 8.78033C6.36032 8.92098 6.55109 9 6.75 9ZM15.75 15H15V2.25C15 2.05109 14.921 1.86032 14.7803 1.71967C14.6397 1.57902 14.4489 1.5 14.25 1.5H3.75C3.55109 1.5 3.36032 1.57902 3.21967 1.71967C3.07902 1.86032 3 2.05109 3 2.25V15H2.25C2.05109 15 1.86032 15.079 1.71967 15.2197C1.57902 15.3603 1.5 15.5511 1.5 15.75C1.5 15.9489 1.57902 16.1397 1.71967 16.2803C1.86032 16.421 2.05109 16.5 2.25 16.5H15.75C15.9489 16.5 16.1397 16.421 16.2803 16.2803C16.421 16.1397 16.5 15.9489 16.5 15.75C16.5 15.5511 16.421 15.3603 16.2803 15.2197C16.1397 15.079 15.9489 15 15.75 15ZM9.75 15H8.25V12H9.75V15ZM13.5 15H11.25V11.25C11.25 11.0511 11.171 10.8603 11.0303 10.7197C10.8897 10.579 10.6989 10.5 10.5 10.5H7.5C7.30109 10.5 7.11032 10.579 6.96967 10.7197C6.82902 10.8603 6.75 11.0511 6.75 11.25V15H4.5V3H13.5V15Z" fill="#169600"/>
                                  </svg>
                                  <span
                                    className="text-black"
                                    style={{
                                      fontFamily: 'var(--font-sans)',
                                      fontWeight: 400,
                                      fontStyle: 'normal',
                                      fontSize: '18px',
                                      lineHeight: '100%',
                                      letterSpacing: '0px',
                                      leadingTrim: 'cap-height'
                                    } as React.CSSProperties & { leadingTrim?: string }}
                                  >
                                    -
                                  </span>
                                </div>
                                {favorite.area && (
                                  <div className="flex items-center gap-2">
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <g clipPath="url(#clip0_4604_66536)">
                                        <path d="M8.83148 15.5437L3.45631 10.1685C2.8479 9.56011 2.8479 8.43989 3.45631 7.83148L8.83148 2.45631C9.43989 1.8479 10.5601 1.8479 11.1685 2.45631L16.5437 7.83148C17.1521 8.43989 17.1521 9.56011 16.5437 10.1685L11.1685 15.5437C10.5601 16.1521 9.43989 16.1521 8.83148 15.5437V15.5437Z" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        <path d="M2 13.1719L6.36371 17.5356" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        <path d="M13.6367 17.5356L18.0004 13.1719" stroke="#169600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                      </g>
                                      <defs>
                                        <clipPath id="clip0_4604_66536">
                                          <rect width="20" height="20" fill="white"/>
                                        </clipPath>
                                      </defs>
                                    </svg>
                                    <span
                                      className="text-black"
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '18px',
                                        lineHeight: '100%',
                                        letterSpacing: '0px',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {favorite.area} m²
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="w-full h-[1.5px] bg-dream-secondary"></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {selectedTab === 'info' && (
                <div className="flex flex-col gap-0 flex-1 min-h-0 overflow-y-auto w-full bg-gray-50">
                  {/* Блок с описанием и файлами */}
                  <div className="mt-6 px-6 pb-6">
                    <div className="flex flex-col items-start px-5 py-2.5 gap-2.5 rounded-lg bg-white border border-gray-200">
                      <span
                        className='text-black font-normal text-lg'
                      >
                        {t('leadCard.descriptionLabel')}
                      </span>
                      {!isEditingDescription ? (
                        <>
                          <span className="crm-lead-notes text-gray-700 text-base">
                            {displayLead?.notes ? (
                              <Markdown rehypePlugins={[rehypeRaw]}>{displayLead.notes}</Markdown>
                            ) : t('leadCard.noDescription')}
                          </span>
                          <button 
                            onClick={() => {
                              setIsEditingDescription(true);
                              setDescriptionText(displayLead?.notes || '');
                            }}
                            className='cursor-pointer flex items-center gap-2.5 text-dream-primary py-2.5'
                          >
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <g clipPath="url(#clip0_4604_67653)">
                              <path d="M15.8333 10.0378C15.3725 10.0378 15 10.4112 15 10.8711V17.5378C15 17.9969 14.6266 18.3711 14.1667 18.3711H2.5C2.03995 18.3711 1.66672 17.9969 1.66672 17.5378V5.87109C1.66672 5.41196 2.03995 5.03781 2.5 5.03781H9.16672C9.62753 5.03781 10 4.66443 10 4.20453C10 3.74448 9.62753 3.37109 9.16672 3.37109H2.5C1.12167 3.37109 0 4.49277 0 5.87109V17.5378C0 18.9161 1.12167 20.0378 2.5 20.0378H14.1667C15.545 20.0378 16.6667 18.9161 16.6667 17.5378V10.8711C16.6667 10.4103 16.2941 10.0378 15.8333 10.0378Z" fill="#169600"/>
                              <path d="M7.81295 9.27887C7.75466 9.33716 7.71545 9.41132 7.69882 9.49127L7.10967 12.438C7.08221 12.5746 7.12554 12.7155 7.22381 12.8146C7.303 12.8938 7.40966 12.9362 7.51891 12.9362C7.54546 12.9362 7.57308 12.9338 7.60055 12.928L10.5464 12.3389C10.628 12.3221 10.7022 12.283 10.7597 12.2246L17.3531 5.63126L14.4072 2.68555L7.81295 9.27887Z" fill="#169600"/>
                              <path d="M19.3901 0.64846C18.5778 -0.16407 17.256 -0.16407 16.4443 0.64846L15.291 1.80172L18.2369 4.74758L19.3901 3.59417C19.7835 3.20171 20.0002 2.67834 20.0002 2.1217C20.0002 1.56506 19.7835 1.04168 19.3901 0.64846Z" fill="#169600"/>
                              </g>
                              <defs>
                              <clipPath id="clip0_4604_67653">
                              <rect width="20" height="20" fill="white"/>
                              </clipPath>
                              </defs>
                            </svg>
                            <span className="font-medium text-base">
                              {t('leadCard.editDescription')}
                            </span>
                          </button>
                        </>
                      ) : (
                        <NotesEditor
                          value={descriptionText}
                          onChange={setDescriptionText}
                          onSave={async () => {
                            if (!displayLead?._id) return;
                            setIsSavingDescription(true);
                            try {
                              const updated = await leadsApiV2.update(displayLead._id, {
                                notes: descriptionText.trim() || undefined
                              });
                              leadVersionRef.current = updated.version;
                              setLocalLead(mapLeadV2ToCrmLead(updated));
                              setIsEditingDescription(false);
                            } catch (error) {
                              console.error('Error updating description:', error);
                            } finally {
                              setIsSavingDescription(false);
                            }
                          }}
                          onCancel={() => {
                            setIsEditingDescription(false);
                            setDescriptionText('');
                          }}
                          isSaving={isSavingDescription}
                        />
                      )}
                    </div>
                    
                    <div className="flex flex-col items-start gap-2.5 mt-5">
                      <span
                        className="text-black font-normal text-lg"
                      >
                        {t('leadCard.attachments')}
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
                                    alt={decodeFilename(file.originalName)}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                </div>
                              ) : (
                                getFileIcon(file.mimeType || '', 20)
                              )}
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-sm font-medium truncate">{decodeFilename(file.originalName)}</span>
                                <span className="text-xs text-gray-500">{(() => {
                                  if (file.size === 0) return '0 Bytes';
                                  const k = 1024;
                                  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                                  const i = Math.floor(Math.log(file.size) / Math.log(k));
                                  return Math.round(file.size / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
                                })()}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadFile(file)}
                        className="cursor-pointer"
                        title={t('common.download')}
                      >
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M9 12L5 8h3V3h2v5h3l-4 4z" fill="#169600"/>
                                  <path d="M15 13v2H3v-2H1v2c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-2h-2z" fill="#169600"/>
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeleteFile(file.filename)}
                                className="cursor-pointer"
                                title={t('common.delete')}
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
                      <div className="text-gray-500 text-sm">{t('leadCard.noAttachments')}</div>
                    )}
                    
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={async (e) => {
                        const selectedFiles = e.target.files;
                        if (!selectedFiles || selectedFiles.length === 0 || !lead?._id) return;

                        setIsUploading(true);
                        setUploadError(null);

                        try {
                          const filesArray = Array.from(selectedFiles);
                          
                          // Константы валидации
                          // `[phase 3]` 20MB — реальный лимит нового backend (media.constants.ts::MAX_UPLOAD_SIZE_BYTES), не 100MB, как было в легаси.
                          const MAX_FILE_SIZE = 20 * 1024 * 1024;
                          const MAX_FILES_PER_LEAD = 10;
                          const MAX_FILES_PER_UPLOAD = 10;
                          

                          // Проверка количества файлов в запросе
                          if (filesArray.length > MAX_FILES_PER_UPLOAD) {
                            setUploadError(formatMessage(t('leadCard.maxFilesAtOnce'), { max: MAX_FILES_PER_UPLOAD }));
                            setIsUploading(false);
                            return;
                          }

                          // Проверка текущего количества файлов у лида
                          const currentFilesCount = files.length;
                          if (currentFilesCount + filesArray.length > MAX_FILES_PER_LEAD) {
                            setUploadError(formatMessage(t('leadCard.maxFilesPerLead'), { max: MAX_FILES_PER_LEAD, current: currentFilesCount, adding: filesArray.length }));
                            setIsUploading(false);
                            return;
                          }

                          const tooLarge = filesArray.find((f) => f.size > MAX_FILE_SIZE);
                          if (tooLarge) {
                            setUploadError(formatMessage(t('leadCard.fileTooLarge'), { name: tooLarge.name }));
                            setIsUploading(false);
                            return;
                          }

                          // Всегда загружаем файлы по одному, чтобы избежать ошибки 413 (Content Too Large)
                          let successCount = 0;
                          let failedFiles: string[] = [];
                          
                          for (const file of filesArray) {
                            try {
                              // `[phase 3]` Двухфазная загрузка (upload-intent → PUT в хранилище →
                              // confirm), тот же паттерн, что аватар сотрудника (teamApi.uploadAvatar)
                              // и вложения задач — переиспользован mediaApiV2.uploadFile, не продублирован.
                              const { assetId } = await mediaApiV2.uploadFile(file, 'lead_attachment');
                              await leadsApiV2.attachFile(displayLead._id, assetId);
                              successCount++;
                            } catch (fileError: any) {
                              failedFiles.push(file.name);
                              
                              // Определяем тип ошибки
                              if (fileError.response?.status === 413 || 
                                  (fileError.code === 'ERR_NETWORK' && file.size > 10 * 1024 * 1024)) {
                                // Файл слишком большой (413 или Network Error для большого файла)
                                setUploadError(formatMessage(t('leadCard.failedUploadOne'), { name: file.name }));
                              } else if (fileError.code === 'ERR_NETWORK' || fileError.message === 'Network Error') {
                                // Реальная сетевая ошибка
                                setUploadError(formatMessage(t('leadCard.networkErrorFile'), { name: file.name }));
                              } else {
                                // Другие ошибки
                                const errorMessage = fileError.response?.data?.message || fileError.message || t('leadViewModal.unknownError');
                                setUploadError(formatMessage(t('leadCard.uploadErrorFile'), { name: file.name, message: errorMessage }));
                              }
                              
                              setIsUploading(false);
                              return;
                            }
                          }
                          
                          // Обновляем список файлов после успешной загрузки
                          if (successCount > 0) {
                            await loadLeadFiles();
                            
                            if (failedFiles.length > 0) {
                              setUploadError(formatMessage(t('leadCard.uploadedPartial'), { success: successCount, total: filesArray.length, failed: failedFiles.join(', ') }));
                            }
                          } else {
                            setUploadError(t('leadCard.uploadNone'));
                          }
                          
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        } catch (error: any) {
                          console.error('Failed to upload files:', error);
                          
                          // Эта ошибка не должна возникать, так как мы обрабатываем ошибки внутри цикла
                          if (error.response?.status === 413) {
                            setUploadError(t('leadCard.uploadSeparate'));
                          } else if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
                            setUploadError(t('leadCard.networkError'));
                          } else {
                            setUploadError(error.response?.data?.message || error.message || t('leadCard.uploadGeneric'));
                          }
                        } finally {
                          setIsUploading(false);
                        }
                      }}
                      className="hidden"
                      accept="*/*"
                    />
                    
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading || !lead?._id}
                      className="flex items-center py-2 px-3 rounded-full border border-dashed border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUploading ? (
                        <>
                          <svg className="animate-spin h-5 w-5 mr-2 text-dream-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{t('common.loading')}</span>
                        </>
                      ) : (
                        <>
                          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="#555454"/>
                          </svg>
                          <span>{t('leadCard.attachFiles')}</span>
                        </>
                      )}
                    </button>
                    </div>
                  </div>
                </div>
              )}
              {selectedTab === 'history' && (
                <div className="flex flex-col gap-0 flex-1 min-h-0 overflow-y-auto w-full bg-gray-50">
                  {isLoadingHistory ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dream-primary"></div>
                    </div>
                  ) : leadHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                      <p className="text-lg">{t('leadCard.noStageHistory')}</p>
                      <p className="text-sm mt-2">{t('leadCard.noStageHistoryHint')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {leadHistory.map((historyItem, index) => {
                        const historyMessage = (historyItem as any).message || historyItem.comment || '';
                        const isTaskMessage = !('type' in historyItem) && historyMessage.trim().startsWith(t('leadViewModal.task'));
                        const hasStageFields = 'fromStage' in historyItem && 'toStage' in historyItem;
                        // Считаем сменой этапа только реальные переходы между этапами
                        const isStageChange = hasStageFields && historyItem.fromStage !== historyItem.toStage && !isTaskMessage;
                        
                        let stageLabel = '';
                        let stageDate = '';
                        let stageComment: string | undefined;
                        let stageForChecklist: LeadStage | undefined;
                        
                        // Определяем, является ли это задачей (по наличию слова "Задача" в начале текста)
                        const isTask = isTaskMessage || (!isStageChange && historyMessage.trim().startsWith(t('leadViewModal.task')));
                        const taskTitleFromHistory = !isStageChange && historyMessage
                          ? (historyMessage.match(/Задача\s+[«"]([^"»]+)[»"]/)?.[1] || historyMessage.match(/Задача\s+"([^"]+)"/)?.[1])
                          : undefined;
                        const matchedTask = taskTitleFromHistory ? leadTasks.find(t => t.title === taskTitleFromHistory) : undefined;
                        const taskAction = taskTitleFromHistory ? (() => {
                          const lower = historyMessage.toLowerCase();
                          if (lower.includes(t('leadViewModal.created'))) return 'created';
                          if (lower.includes(t('leadViewModal.deleted'))) return 'deleted';
                          if (lower.includes(t('leadViewModal.betrayal'))) return 'updated';
                          if (lower.includes(t('leadViewModal.completed1'))) return 'completed';
                          if (lower.includes(t('leadViewModal.translated')) || lower.includes(t('leadViewModal.translated1')) || lower.includes(t('leadViewModal.transferred'))) return 'status';
                          return undefined;
                        })() : undefined;
                        
                        // Обработка записи, помеченной как "Лид создан" или системная (fromStage === toStage)
                        const isSameStageEntry = hasStageFields && historyItem.fromStage === historyItem.toStage;

                        if (isStageChange) {
                          const toStageLabel = getRealtorStageLabel(historyItem.toStage) 
                            || getCuratorStageLabel(historyItem.toStage)
                            || getStageLabel(historyItem.toStage, displayLead.productType);
                          
                          stageLabel = `→ ${toStageLabel}`;
                          stageForChecklist = historyItem.toStage;
                          stageDate = formatDateTime(historyItem.changedAt);
                          // Получаем комментарий к этапу из Map (если есть)
                          const stageCommentFromMap = stageCommentsMap.get(historyItem.toStage);
                          // Используем комментарий из Map, если он есть, иначе из истории
                          stageComment = stageCommentFromMap || historyItem.comment || (historyItem as any).message;
                        } else if (isSameStageEntry) {
                          const isLeadCreated = 
                            (historyItem.toStage === LeadStage.NEEDS_ANALYSIS || historyItem.toStage === LeadStage.NETWORK_NEW_LEAD);

                          if (isLeadCreated && (!historyMessage || !historyMessage.trim())) {
                            stageLabel = t('leadCard.leadCreated');
                          } else {
                            stageLabel = historyMessage || t('leadCard.historyEntry');
                          }

                          if ('changedAt' in historyItem && typeof historyItem.changedAt === 'string') {
                            stageDate = formatDateTime(historyItem.changedAt);
                          } else if ('createdAt' in historyItem && typeof historyItem.createdAt === 'string') {
                            stageDate = formatDateTime(historyItem.createdAt);
                          } else {
                            stageDate = '';
                          }
                          stageComment = historyMessage;
                          stageForChecklist = undefined;
                        } else {
                          // Обычная запись истории
                          stageLabel = historyMessage || t('leadCard.leadInfoUpdated');
                          // Используем changedAt для LeadHistory
                          if ('changedAt' in historyItem && typeof historyItem.changedAt === 'string') {
                            stageDate = formatDateTime(historyItem.changedAt);
                          } else if ('createdAt' in historyItem && typeof historyItem.createdAt === 'string') {
                            stageDate = formatDateTime(historyItem.createdAt);
                          } else {
                            stageDate = '';
                          }
                          stageComment = historyMessage;
                        }
                        
                        const checklistKey = `${stageForChecklist || 'none'}_${index}`;
                        const isChecklistExpanded = expandedChecklists.has(checklistKey);
                        const commentKey = `comment_${index}`;
                        // Автоматически открываем комментарии при открытии чеклиста
                        const isCommentExpanded = isChecklistExpanded || expandedComments.has(commentKey);
                        const hasComment = Boolean(stageComment && stageComment.trim());
                        
                        // Получаем количество заполненных пунктов для текущего этапа
                        const checklistCountKey = stageForChecklist ? `${stageForChecklist}_${index}` : '';
                        const checkedItemsCount = checklistCountKey ? (checkedItemsCounts[checklistCountKey] || 0) : 0;
                        const totalChecklistItems = stageForChecklist && displayLead?.productType
                          ? getChecklistTotal(stageForChecklist, displayLead.productType)
                          : 0;
                        
                        return (
                          <React.Fragment key={index}>
                            <div className="flex flex-col gap-3 px-6 py-5 bg-white border-b border-gray-200">
                              {/* Заголовок этапа */}
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3">
                                    <h3 className="text-lg font-normal text-gray-900">
                                      {stageLabel}
                                    </h3>
                                    {/* Индикатор комментария */}
                                    {hasComment && (
                                      <Tooltip text={t('leadCard.hasComment')} position="top">
                                        <div className="flex items-center justify-center cursor-pointer">
                                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10 2C5.58172 2 2 5.58172 2 10C2 11.7766 2.64386 13.3918 3.69098 14.5983L2 18L5.40169 16.309C6.60818 17.3561 8.22336 18 10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2Z" fill="#169600"/>
                                            <path d="M7 8C7 7.44772 7.44772 7 8 7H12C12.5523 7 13 7.44772 13 8C13 8.55228 12.5523 9 12 9H8C7.44772 9 7 8.55228 7 8Z" fill="white"/>
                                            <path d="M7 11C7 10.4477 7.44772 10 8 10H12C12.5523 10 13 10.4477 13 11C13 11.5523 12.5523 12 12 12H8C7.44772 12 7 11.5523 7 11Z" fill="white"/>
                                          </svg>
                                        </div>
                                      </Tooltip>
                                    )}
                                    {/* Кнопка для задач */}
                                    {isTask && stageComment && (
                                      <button
                                        onClick={() => {
                                          setExpandedComments(prev => {
                                            const newSet = new Set(prev);
                                            if (isCommentExpanded) {
                                              newSet.delete(commentKey);
                                            } else {
                                              newSet.add(commentKey);
                                            }
                                            return newSet;
                                          });
                                        }}
                                        className="flex items-center gap-2 text-sm text-dream-primary hover:text-green-700 transition-colors cursor-pointer"
                                      >
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <path d="M8 12L3 7L4.4 5.6L8 9.2L11.6 5.6L13 7L8 12Z" fill="currentColor" className={`transition-transform ${isCommentExpanded ? 'rotate-180' : ''}`}/>
                                        </svg>
                                        <span className="font-medium">
                                          {t('leadCard.task')}
                                        </span>
                                      </button>
                                    )}
                                    {taskTitleFromHistory && (
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {taskAction && (
                                          <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                                            {taskAction === 'created' && t('leadCard.taskCreated')}
                                            {taskAction === 'updated' && t('leadCard.taskUpdated')}
                                            {taskAction === 'deleted' && t('leadCard.taskDeleted')}
                                            {taskAction === 'completed' && t('leadCard.taskCompleted')}
                                            {taskAction === 'status' && t('leadCard.taskStatusChanged')}
                                          </span>
                                        )}
                                        {matchedTask && (
                                          <button
                                            onClick={() => handleOpenTaskView(matchedTask._id)}
                                            className="px-3 py-1 text-xs font-normal text-white bg-dream-primary rounded-full hover:bg-green-700 transition-colors"
                                          >
                                            {t('leadCard.openTask')}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-500 mt-1">
                                    {stageDate}
                                  </p>
                                </div>
                                {/* Кнопка Чек-лист в правой части блока */}
                                {stageForChecklist && (
                                  <button
                                    onClick={() => {
                                      setExpandedChecklists(prev => {
                                        const newSet = new Set(prev);
                                        if (isChecklistExpanded) {
                                          newSet.delete(checklistKey);
                                          // Закрываем комментарии при закрытии чеклиста
                                          setExpandedComments(prev => {
                                            const newSet = new Set(prev);
                                            newSet.delete(commentKey);
                                            return newSet;
                                          });
                                        } else {
                                          newSet.add(checklistKey);
                                          // Автоматически открываем комментарии при открытии чеклиста
                                          setExpandedComments(prev => {
                                            const newSet = new Set(prev);
                                            newSet.add(commentKey);
                                            return newSet;
                                          });
                                        }
                                        return newSet;
                                      });
                                    }}
                                    className="flex items-center gap-2 text-sm text-dream-primary hover:text-green-700 transition-colors cursor-pointer"
                                  >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M8 12L3 7L4.4 5.6L8 9.2L11.6 5.6L13 7L8 12Z" fill="currentColor" className={`transition-transform ${isChecklistExpanded ? 'rotate-180' : ''}`}/>
                                    </svg>
                                    <span className="font-medium">
                                      {totalChecklistItems > 0
                                        ? `${t('leadCard.checklist')} (${formatMessage(t('leadCard.checklistFilled'), { done: checkedItemsCount, total: totalChecklistItems })})`
                                        : t('leadCard.checklist')}
                                    </span>
                                  </button>
                                )}
                              </div>
                              
                              {/* Комментарии (раскрываются автоматически при открытии чеклиста) - перемещены между названием этапа и кнопкой чек-лист */}
                              {stageComment && isCommentExpanded && (() => {
                                // Разделяем комментарий на абзацы по двойному переносу строки
                                const commentParagraphs = stageComment.split('\n\n').filter(p => p.trim());
                                return (
                                  <div
                                    className="mt-2 rounded-lg overflow-y-auto bg-green-50 border border-green-200"
                                    style={{
                                      maxHeight: '130px',
                                      padding: '8px 10px'
                                    }}
                                  >
                                    <div className="flex flex-col gap-0.5">
                                    {commentParagraphs.map((paragraph, paraIndex) => (
                                        <p
                                        key={paraIndex}
                                          className="text-base whitespace-pre-wrap text-green-900"
                                          style={{ lineHeight: '1.35' }}
                                      >
                                          {paragraph.trim()}
                                        </p>
                                    ))}
                                    </div>
                                  </div>
                                );
                              })()}
                              
                              {/* Чеклист (раскрывается по клику) */}
                              {stageForChecklist && isChecklistExpanded && displayLead?._id && (
                                <div className="ml-4 mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                  <LeadStageChecklist
                                    leadId={displayLead._id}
                                    leadName={displayLead.name}
                                    stage={stageForChecklist}
                                    productType={displayLead.productType}
                                    onCommentSaved={async () => {
                                      // Обновляем комментарии к этапам и историю
                                      await loadStageComments();
                                      await loadLeadHistory();
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      
      {isOpen && isLightboxOpen && lightboxImages.length > 0 ? createPortal(
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 px-4"
          onClick={closeLightbox}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] w-full bg-black/0 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-4 right-4 z-10 h-10 w-10 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg"
              onClick={closeLightbox}
              aria-label={t('leadCard.closeGallery')}
            >
              ✕
            </button>
            {lightboxImages.length > 1 && (
              <button
                className="absolute left-4 z-10 h-10 w-10 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevLightbox();
                }}
                aria-label={t('leadCard.prevPhoto')}
              >
                ‹
              </button>
            )}
            <img
              src={lightboxImages[lightboxIndex]}
              alt={t('leadViewModal.objectPhotoLightboxindex1')}
              className="max-h-[90vh] max-w-full rounded-[16px] object-contain"
            />
            {lightboxImages.length > 1 && (
              <button
                className="absolute right-4 z-10 h-10 w-10 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextLightbox();
                }}
                aria-label={t('leadViewModal.nextPhoto')}
              >
                ›
              </button>
            )}
          </div>
        </div>,
        document.body
      ) : null}
      <CreateClientModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          // После закрытия редактора повторно загружаем файлы, чтобы отобразить новые/удалённые
          loadLeadFiles();
        }}
        lead={displayLead || lead}
        onLeadUpdated={(updatedLead) => {
          // Отслеживаем изменение через DataSyncManager для блокировки обновлений на 3 секунды
          const manager = syncManagerRef.current;
          // Отмечаем все изменяемые поля как измененные пользователем
          const modifiedFields = ['name', 'phone', 'email', 'city', 'dealValue', 'notes', 'productType', 'source', 'stage'];
          modifiedFields.forEach(field => {
            manager.trackModification(updatedLead._id, field, updatedLead);
          });
          
          // Обновляем локальное состояние с новыми данными
          setLocalLead(updatedLead);
          
          // Обновляем список лидов в родительском компоненте для автообновления
          if (onUpdateLeadAfterSync && updatedLead._id) {
            onUpdateLeadAfterSync(updatedLead._id, updatedLead);
          }
          
          // Обновляем вложения после редактирования
          loadLeadFiles();
          setIsEditModalOpen(false);
        }}
      />
      
      {/* TaskViewModal рендерится отдельно через createPortal, как в главном меню */}
      {isTaskViewModalOpen && typeof document !== 'undefined' && createPortal(
        <TaskViewModal
          key={selectedTaskForView}
          task={currentTaskForModal}
          isOpen={isTaskViewModalOpen}
          onClose={handleCloseTaskView}
          onTaskUpdate={(updatedTask) => {
            setLeadTasks(prev => prev.map(task => 
              task._id === updatedTask._id ? updatedTask : task
            ));
            if (selectedTaskForView === updatedTask._id) {
              setCurrentTaskForModal(updatedTask);
            }
          }}
          onUpdateTaskStatus={async (taskId, status) => {
            try {
              // `[phase 3]` `status` здесь — легаси TaskStatus; COMPLETED — отдельная
              // команда complete (см. handleTaskStatusChange докстринг выше), остальные
              // значения — setStatus. Запись в историю лида не пишется (тот же честный
              // пробел, что в handleTaskStatusChange/handleDeleteTask).
              const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
              const updated = status === TaskStatus.COMPLETED
                ? await tasksApiV2.complete(taskId, expectedVersion)
                : await tasksApiV2.setStatus(
                    taskId,
                    expectedVersion,
                    status === TaskStatus.CANCELLED ? 'cancelled' : status === TaskStatus.IN_PROGRESS ? 'in_progress' : 'open',
                  );
              taskVersionsRef.current.set(taskId, updated.version);
              const mappedTask = mapTaskV2ToCrmTask(updated);
              setLeadTasks(prev => prev.map(task =>
                task._id === taskId ? mappedTask : task
              ));
              if (selectedTaskForView === taskId) {
                setCurrentTaskForModal(mappedTask);
              }
            } catch (error) {
              console.error('Failed to update task status:', error);
            }
          }}
          onDeleteTask={async (taskId) => {
            try {
              // `[phase 3]` DELETE /tasks/:id не существует — см. handleDeleteTask докстринг выше.
              const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
              await tasksApiV2.setStatus(taskId, expectedVersion, 'cancelled');
              taskVersionsRef.current.delete(taskId);
              setLeadTasks(prev => prev.filter(task => task._id !== taskId));
              handleCloseTaskView();
            } catch (error) {
              console.error('Failed to delete task:', error);
            }
          }}
          onUpdateTaskEndDate={async (taskId, endDate) => {
            try {
              if (!endDate) return;
              const expectedVersion = taskVersionsRef.current.get(taskId) ?? 0;
              const updated = await tasksApiV2.setDueAt(taskId, expectedVersion, endDate);
              taskVersionsRef.current.set(taskId, updated.version);
              const mappedTask = mapTaskV2ToCrmTask(updated);
              setLeadTasks(prev => prev.map(task =>
                task._id === taskId ? mappedTask : task
              ));
              if (selectedTaskForView === taskId) {
                setCurrentTaskForModal(mappedTask);
              }
            } catch (error) {
              console.error('Failed to update task end date:', error);
              throw error;
            }
          }}
        />,
        document.body
      )}
      
      {/* Модалка подтверждения удаления */}
      {showDeleteConfirm ? createPortal(
        <div 
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDeleteConfirm(false);
            }
          }}
        >
          <div 
            className="relative bg-white rounded-[25px] shadow-2xl p-8 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 
              className="text-xl font-normal mb-4 text-dream-primary"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: '24px',
                lineHeight: '28px',
              }}
            >
              {displayLead?.productType === ProductType.NETWORK ? [t('leadCard.deleteReferralTitle')]: t('leadCard.deleteLeadTitle')}
            </h3>
            <p 
              className="text-gray-700 mb-6"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: '16px',
                lineHeight: '20px',
              }}
            >
              {(() => {
                const message = t('leadCard.deleteLeadMessage');
                const subject = displayLead?.productType === ProductType.NETWORK 
                  ? (t('leadCard.deleteLeadSubjectReferral') as string): (t('leadCard.deleteLeadSubjectLead') as string);
                const parts = message.split('{name}');
                if (parts.length === 2) {
                  const prefix = parts[0].replace('{subject}', subject);
                  const suffix = parts[1];
                  return (
                    <>
                      {prefix}
                      <strong>{displayLead?.name}</strong>
                      {suffix}
                    </>
                  );
                }
                return formatMessage(message, { subject, name: displayLead?.name || '' });
              })()}
            </p>
            <div className="flex gap-4 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-6 py-2 border-2 border-gray-300 rounded-full text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: '16px',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteLead}
                disabled={isDeleting}
                className="px-6 py-2 bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: '16px',
                }}
              >
                {isDeleting ? [t('common.deleting')]: t('common.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
};

export default LeadViewModal;

