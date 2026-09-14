import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n';
import { useDisableScroll } from '../../hooks/useDisableScroll';
import { type CreateNoteDto, type UpdateNoteDto, type Note, type NoteFile, type Lead } from '../../services/api';
import { notesService } from '../../services/notesV2';
import { leadsApiV2 } from '@/services/leadsApiV2';
import { mapLeadV2ToCrmLead } from '@/lib/lead-v2-legacy-adapter';
import Tooltip from '../common/Tooltip';
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

interface NotesBlockProps {
  onCloseChecklist?: () => void;
  onOpenNewTaskModalFromNote?: (noteData: { title: string; description: string; leadId?: string; taskType?: 'standard' | 'call' | 'meeting'; noteId?: string; files?: NoteFile[] }) => void;
}

const NotesBlock: React.FC<NotesBlockProps> = ({ onCloseChecklist, onOpenNewTaskModalFromNote }) => {
  const { t } = useI18n();
  const [isNotesBlockCollapsed, setIsNotesBlockCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewNoteModalOpen, setIsNewNoteModalOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [originalTitle, setOriginalTitle] = useState<string>('');
  const [originalDescription, setOriginalDescription] = useState<string>('');
  const [selectedNoteFiles, setSelectedNoteFiles] = useState<File[]>([]);
  const [existingNoteFiles, setExistingNoteFiles] = useState<NoteFile[]>([]);
  const [deletedFileIndexes, setDeletedFileIndexes] = useState<number[]>([]);
  const noteFileInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNoteCategory, setSelectedNoteCategory] = useState<string>('');
  const [selectedNoteLeadId, setSelectedNoteLeadId] = useState<string>('');
  const [isNoteCategoryDropdownOpen, setIsNoteCategoryDropdownOpen] = useState(false);
  const [isNoteClientDropdownOpen, setIsNoteClientDropdownOpen] = useState(false);
  const [noteClientSearch, setNoteClientSearch] = useState<string>('');
  const [isNoteClientSearchOpen, setIsNoteClientSearchOpen] = useState(false);
  const noteCategoryDropdownRef = useRef<HTMLDivElement>(null);
  const noteClientDropdownRef = useRef<HTMLDivElement>(null);
  const [isNewNoteClientModalOpen, setIsNewNoteClientModalOpen] = useState(false);
  const [newNoteClientName, setNewNoteClientName] = useState('');
  const [isDeleteNoteConfirmModalOpen, setIsDeleteNoteConfirmModalOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [isViewNoteModalOpen, setIsViewNoteModalOpen] = useState(false);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [viewNoteTitle, setViewNoteTitle] = useState<string>('');
  const [viewNoteDescription, setViewNoteDescription] = useState<string>('');
  const [isEditingViewTitle, setIsEditingViewTitle] = useState(false);
  const [isEditingViewDescription, setIsEditingViewDescription] = useState(false);
  const [originalViewTitle, setOriginalViewTitle] = useState('');
  const [originalViewDescription, setOriginalViewDescription] = useState('');
  const [isUpdatingViewTitle, setIsUpdatingViewTitle] = useState(false);
  const [isUpdatingViewDescription, setIsUpdatingViewDescription] = useState(false);
  const [viewNoteFiles, setViewNoteFiles] = useState<NoteFile[]>([]);
  const [isUploadingViewFiles, setIsUploadingViewFiles] = useState(false);
  const viewNoteFileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isViewCategoryPickerOpen, setIsViewCategoryPickerOpen] = useState(false);
  const [isViewClientPickerOpen, setIsViewClientPickerOpen] = useState(false);
  const [isViewCategoryModalOpen, setIsViewCategoryModalOpen] = useState(false);
  const [isViewClientModalOpen, setIsViewClientModalOpen] = useState(false);
  const [newViewCategoryName, setNewViewCategoryName] = useState('');
  const [newViewClientName, setNewViewClientName] = useState('');
  const [isDeleteViewFileConfirmModalOpen, setIsDeleteViewFileConfirmModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<{ file: NoteFile; index: number } | null>(null);
  const [isConvertToTaskModalOpen, setIsConvertToTaskModalOpen] = useState(false);
  
  const [noteCategoriesList, setNoteCategoriesList] = useState<{ key: string; label: string }[]>([]);
  const [categoriesMap, setCategoriesMap] = useState<Map<number, string>>(new Map());
  const [leadsMap, setLeadsMap] = useState<Map<string, Lead>>(new Map());
  
  useDisableScroll(isModalOpen || isNewNoteModalOpen || isViewNoteModalOpen || isNewNoteClientModalOpen || isDeleteNoteConfirmModalOpen || isViewCategoryPickerOpen || isViewClientPickerOpen || isViewCategoryModalOpen || isViewClientModalOpen || isDeleteViewFileConfirmModalOpen);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (noteCategoryDropdownRef.current && !noteCategoryDropdownRef.current.contains(event.target as Node)) {
        setIsNoteCategoryDropdownOpen(false);
      }
      if (noteClientDropdownRef.current && !noteClientDropdownRef.current.contains(event.target as Node)) {
        setIsNoteClientDropdownOpen(false);
        setIsNoteClientSearchOpen(false);
      }
    };

    if (isNoteCategoryDropdownOpen || isNoteClientDropdownOpen || isNoteClientSearchOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNoteCategoryDropdownOpen, isNoteClientDropdownOpen, isNoteClientSearchOpen]);

  // Инициализация фиксированных категорий заметок
  useEffect(() => {
    const fixedCategories = [
      { key: '1', label: t('notesBlock.personalNote') },
      { key: '2', label: t('notesBlock.workNote') }
    ];
    setNoteCategoriesList(fixedCategories);
    
    // Создаем Map для быстрого поиска категорий по ID
    const map = new Map<number, string>();
    map.set(1, t('notesBlock.personalNote'));
    map.set(2, t('notesBlock.workNote'));
    setCategoriesMap(map);
  }, []);

  // Загрузка всех лидов для выбора при создании/редактировании заметок
  useEffect(() => {
    const loadAllLeads = async () => {
      try {
        const { items } = await leadsApiV2.listAll();
        const map = new Map<string, Lead>();
        items.map(mapLeadV2ToCrmLead).forEach((lead: Lead) => {
          map.set(lead._id, lead);
        });
        setLeadsMap(map);
      } catch (error) {
        console.error(t('notesBlock.errorLoadingLeads'), error);
      }
    };

    loadAllLeads();
  }, []);

  // Функция для загрузки заметок
  const fetchNotes = useCallback(async (): Promise<Note[]> => {
    try {
      const response = await notesService.getNotes();
      if (response.success && response.data) {
        return response.data.items;
      }
      return [];
    } catch (error) {
      console.error(t('notesBlock.errorLoadingNotes'), error);
      return [];
    }
  }, []);

  // Функция для обновления заметок с сортировкой
  const updateNotes = useCallback((notesData: Note[]) => {
    // Сортируем: сначала закрепленные, потом по дате создания (новые сверху)
    const sortedNotes = [...notesData].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    setNotes(sortedNotes);
  }, []);

  // Автообновление заметок в реальном времени
  useAutoRefresh({
    fetchData: fetchNotes,
    onDataUpdate: updateNotes,
    interval: 30000,
    enabled: true,
    keyField: '_id',
    compareFields: ['title', 'content', 'isPinned', 'category', 'leadId', 'createdAt', 'updatedAt', 'files'],
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const months = [t('notesBlock.jan'), t('notesBlock.feb'), t('notesBlock.mar'), t('notesBlock.apr'), t('notesBlock.may'), t('notesBlock.jun'), t('notesBlock.jul'), t('notesBlock.aug'), t('notesBlock.sep'), t('notesBlock.oct'), t('notesBlock.nov'), t('notesBlock.dec')];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes} | ${day} ${month}`;
  };

  // Получение названия категории по ID
  const getCategoryName = (categoryId?: number): string => {
    if (!categoryId) return '';
    return categoriesMap.get(categoryId) || '';
  };

  // Получение ФИО лида по ID (может быть строкой или объектом)
  const getLeadName = (leadId?: string | { _id?: string } | any): string => {
    if (!leadId) return '';
    
    // Если leadId - объект, извлекаем _id
    let id: string = '';
    if (typeof leadId === 'string') {
      id = leadId;
    } else if (typeof leadId === 'object' && leadId !== null) {
      id = leadId._id || leadId.id || '';
    } else {
      return '';
    }
    
    if (!id) return '';
    const lead = leadsMap.get(id);
    return lead?.name || '';
  };
  
  // Получение ID лида (может быть строкой или объектом)
  const getLeadId = (leadId?: string | { _id?: string } | any): string => {
    if (!leadId) return '';
    
    if (typeof leadId === 'string') {
      return leadId;
    } else if (typeof leadId === 'object' && leadId !== null) {
      return leadId._id || leadId.id || '';
    }
    
    return '';
  };

  const getFileIcon = (mimeType: string, size: number = 22) => {
    const iconProps = { size, className: 'flex-shrink-0 text-[var(--accent)]' };

    if (mimeType.includes('pdf')) {
      return <FileText {...iconProps} className="flex-shrink-0 text-[color-mix(in_srgb,var(--destructive)_88%,transparent)]" />;
    }
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('xls') || mimeType.includes('xlsx')) {
      return <FileSpreadsheet {...iconProps} className="flex-shrink-0 text-[#b4ccc3]" />;
    }
    if (mimeType.includes('word') || mimeType.includes('document') || mimeType.includes('doc') || mimeType.includes('docx')) {
      return <FileText {...iconProps} className="flex-shrink-0 text-[var(--primary)]" />;
    }
    if (mimeType.includes('image')) {
      return <ImageIcon {...iconProps} />;
    }
    if (mimeType.includes('audio') || mimeType.includes('mp3') || mimeType.includes('wav') || mimeType.includes('ogg')) {
      return <Music {...iconProps} />;
    }
    if (mimeType.includes('video') || mimeType.includes('mp4') || mimeType.includes('avi') || mimeType.includes('mov')) {
      return <Video {...iconProps} />;
    }
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive') || mimeType.includes('7z')) {
      return <Archive {...iconProps} className="flex-shrink-0 text-[color-mix(in_srgb,var(--primary)_90%,transparent)]" />;
    }
    return <File {...iconProps} className="flex-shrink-0 text-[rgba(255,255,255,0.72)]" />;
  };

  const handleNoteFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const filesArray = Array.from(files);
    
    if (filesArray.length > 10) {
      alert(t('notesBlock.maxFilesError'));
      return;
    }

    setSelectedNoteFiles(filesArray);
  };

  const handleRemoveNoteFile = (index: number) => {
    setSelectedNoteFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveExistingFile = (fileIndex: number) => {
    // Помечаем файл для удаления (удаление произойдет при сохранении)
    setDeletedFileIndexes(prev => [...prev, fileIndex]);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const decodeFilename = (name?: string): string => {
    if (!name) return '';
    try {
      return decodeURIComponent(escape(name)) || name;
    } catch {
      return name;
    }
  };

  // Файл открывается по временной ссылке хранилища, которую выдаёт сервер.
  const handleDownloadNoteFile = async (noteId: string, fileIndex: number, filename: string) => {
    try {
      const { url } = await notesService.getNoteFileUrl(noteId, fileIndex);
      const a = document.createElement('a');
      a.href = url;
      a.download = decodeFilename(filename);
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error(t('notesBlock.errorDownloadingFile'), error);
      alert(t('notesBlock.downloadFailedTryAgain'));
    }
  };

  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);

  const handlePinNote = async (noteId: string, currentPinnedStatus: boolean) => {
    try {
      // Оптимистичное обновление UI
      setNotes(prev => {
        const updated = prev.map(note => 
          note._id === noteId ? { ...note, isPinned: !currentPinnedStatus } : note
        );
        // Сортируем: сначала закрепленные, потом по дате создания (новые сверху)
        return updated.sort((a, b) => {
          if (a.isPinned !== b.isPinned) {
            return a.isPinned ? -1 : 1;
          }
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      });
      
      const response = await notesService.pinNote(noteId, !currentPinnedStatus);
      if (response.success && response.data) {
        // Автообновление через useAutoRefresh обновит список полностью через несколько секунд
      } else {
        // Откатываем изменения при ошибке
        setNotes(prev => {
          const updated = prev.map(note => 
            note._id === noteId ? { ...note, isPinned: currentPinnedStatus } : note
          );
          return updated.sort((a, b) => {
            if (a.isPinned !== b.isPinned) {
              return a.isPinned ? -1 : 1;
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
        });
      }
    } catch (error) {
      console.error(t('notesBlock.errorPinningNote'), error);
      // Откатываем изменения при ошибке
      setNotes(prev => {
        const updated = prev.map(note => 
          note._id === noteId ? { ...note, isPinned: currentPinnedStatus } : note
        );
        return updated.sort((a, b) => {
          if (a.isPinned !== b.isPinned) {
            return a.isPinned ? -1 : 1;
          }
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      });
    }
  };

  const [originalNoteCategory, setOriginalNoteCategory] = useState<string>('');
  const [originalNoteLeadId, setOriginalNoteLeadId] = useState<string>('');

  const handleOpenEditNote = (note: Note) => {
    setEditingNoteId(note._id);
    setTitle(note.title || '');
    setDescription(note.content || '');
    setOriginalTitle(note.title || '');
    setOriginalDescription(note.content || '');
    setSelectedNoteFiles([]);
    setExistingNoteFiles(note.files || []);
    setDeletedFileIndexes([]);
    
    // Устанавливаем категорию по ID
    let categoryName = '';
    if (note.category) {
      categoryName = getCategoryName(note.category) || '';
      setSelectedNoteCategory(categoryName);
    } else {
      setSelectedNoteCategory('');
    }
    setOriginalNoteCategory(categoryName);
    
    // Устанавливаем лид по ID (может быть строкой или объектом)
    const leadId = getLeadId(note.leadId);
    setSelectedNoteLeadId(leadId);
    setOriginalNoteLeadId(leadId);
    
    // Устанавливаем текст поиска в имя клиента, если клиент выбран
    if (leadId) {
      const selectedLead = leadsMap.get(leadId);
      setNoteClientSearch(selectedLead?.name || '');
    } else {
      setNoteClientSearch('');
    }
    setIsNoteClientSearchOpen(false);
    
    setIsNewNoteModalOpen(true);
  };

  const handleOpenNewNote = () => {
    setEditingNoteId(null);
    setTitle('');
    setDescription('');
    setOriginalTitle('');
    setOriginalDescription('');
    setSelectedNoteCategory('');
    setSelectedNoteLeadId('');
    setOriginalNoteCategory('');
    setOriginalNoteLeadId('');
    setSelectedNoteFiles([]);
    setExistingNoteFiles([]);
    setDeletedFileIndexes([]);
    setNoteClientSearch('');
    setIsNoteClientSearchOpen(false);
    setIsNewNoteModalOpen(true);
  };

  const hasChanges = () => {
    const textChanged = title.trim() !== originalTitle.trim() || description.trim() !== originalDescription.trim();
    const filesChanged = deletedFileIndexes.length > 0 || selectedNoteFiles.length > 0;
    const categoryChanged = selectedNoteCategory !== originalNoteCategory;
    const leadChanged = selectedNoteLeadId !== originalNoteLeadId;
    return textChanged || filesChanged || categoryChanged || leadChanged;
  };

  const handleCloseNoteModal = () => {
    if (editingNoteId && hasChanges()) {
      if (window.confirm(t('notesBlock.saveChangesTitle'))) {
        handleUpdateNote();
      } else {
        // Отменяем изменения - восстанавливаем исходные значения
        const currentNote = notes.find(n => n._id === editingNoteId);
        if (currentNote) {
          setTitle(currentNote.title || '');
          setDescription(currentNote.content || '');
          setExistingNoteFiles(currentNote.files || []);
        } else {
          setTitle(originalTitle);
          setDescription(originalDescription);
        }
        setSelectedNoteFiles([]);
        setDeletedFileIndexes([]);
        setIsNewNoteModalOpen(false);
        setEditingNoteId(null);
        setTitle('');
        setDescription('');
        setOriginalTitle('');
        setOriginalDescription('');
        setExistingNoteFiles([]);
        setDeletedFileIndexes([]);
        setNoteClientSearch('');
        setIsNoteClientSearchOpen(false);
      }
    } else {
      setIsNewNoteModalOpen(false);
      setEditingNoteId(null);
      setTitle('');
      setDescription('');
      setOriginalTitle('');
      setOriginalDescription('');
      setExistingNoteFiles([]);
      setDeletedFileIndexes([]);
      setSelectedNoteFiles([]);
      setNoteClientSearch('');
      setIsNoteClientSearchOpen(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!noteToDelete?._id) return;

    try {
      const response = await notesService.deleteNote(noteToDelete._id);
      if (response.success) {
        // Удаляем заметку из локального состояния для мгновенного обновления UI
        // Автообновление через useAutoRefresh обновит список полностью через несколько секунд
        setNotes(prev => prev.filter(note => note._id !== noteToDelete._id));
        setIsDeleteNoteConfirmModalOpen(false);
        setNoteToDelete(null);
        // Если удаляемая заметка открыта в модалке просмотра, закрываем её
        if (viewingNote?._id === noteToDelete._id) {
          setIsViewNoteModalOpen(false);
          setViewingNote(null);
        }
      } else {
        alert(response.message || t('notesBlock.failedToDeleteNote'));
      }
    } catch (error: any) {
      console.error(t('notesBlock.errorDeletingNoteLog'), error);
      alert(error.response?.data?.message || t('notesBlock.failedToDeleteNote'));
    }
  };

  const handleCloseViewModal = () => {
    setIsViewNoteModalOpen(false);
    setViewingNote(null);
    setIsEditingViewTitle(false);
    setIsEditingViewDescription(false);
    setViewNoteTitle('');
    setViewNoteDescription('');
    setOriginalViewTitle('');
    setOriginalViewDescription('');
    setViewNoteFiles([]);
    setIsViewCategoryPickerOpen(false);
    setIsViewClientPickerOpen(false);
  };

  const handleUpdateViewTitle = async (newTitle: string) => {
    if (!viewingNote?._id) return;

    try {
      setIsUpdatingViewTitle(true);
      const response = await notesService.updateNote(viewingNote._id, { title: newTitle });

      if (response.success && response.data) {
        setViewNoteTitle(newTitle);
        setOriginalViewTitle(newTitle);
        setIsEditingViewTitle(false);
        setViewingNote(response.data);
        setNotes((prev) =>
          prev.map((note) => (note._id === viewingNote._id ? response.data! : note)),
        );
      } else {
        setViewNoteTitle(originalViewTitle);
      }
    } catch (error: unknown) {
      console.error(t('notesBlock.errorUpdatingNoteTitle'), error);
      setViewNoteTitle(originalViewTitle);
    } finally {
      setIsUpdatingViewTitle(false);
    }
  };

  const handleUpdateViewDescription = async (newDescription: string) => {
    if (!viewingNote?._id) return;

    try {
      setIsUpdatingViewDescription(true);
      const response = await notesService.updateNote(viewingNote._id, { content: newDescription });

      if (response.success && response.data) {
        setViewNoteDescription(newDescription);
        setOriginalViewDescription(newDescription);
        setIsEditingViewDescription(false);
        setViewingNote(response.data);
        setNotes((prev) =>
          prev.map((note) => (note._id === viewingNote._id ? response.data! : note)),
        );
      } else {
        setViewNoteDescription(originalViewDescription);
      }
    } catch (error: unknown) {
      console.error(t('notesBlock.errorUpdatingNoteDescription'), error);
      setViewNoteDescription(originalViewDescription);
    } finally {
      setIsUpdatingViewDescription(false);
    }
  };

  const handleStartEditViewTitle = () => {
    setOriginalViewTitle(viewNoteTitle);
    setIsEditingViewTitle(true);
  };

  const handleCancelEditViewTitle = () => {
    setViewNoteTitle(originalViewTitle);
    setIsEditingViewTitle(false);
  };

  const handleSaveViewTitle = () => {
    const trimmed = viewNoteTitle.trim();
    if (trimmed !== originalViewTitle.trim()) {
      void handleUpdateViewTitle(trimmed);
    } else {
      setIsEditingViewTitle(false);
    }
  };

  const handleStartEditViewDescription = () => {
    setOriginalViewDescription(viewNoteDescription);
    setIsEditingViewDescription(true);
  };

  const handleCancelEditViewDescription = () => {
    setViewNoteDescription(originalViewDescription);
    setIsEditingViewDescription(false);
  };

  const handleSaveViewDescription = () => {
    if (viewNoteDescription !== originalViewDescription) {
      void handleUpdateViewDescription(viewNoteDescription);
    } else {
      setIsEditingViewDescription(false);
    }
  };

  const handleUpdateViewCategory = async (categoryLabel: string) => {
    if (!viewingNote?._id) return;

    try {
      // Находим категорию в списке по названию и получаем её ID
      const category = noteCategoriesList.find(cat => cat.label === categoryLabel);
      let categoryId: number | undefined = undefined;
      if (category) {
        const parsedId = parseInt(category.key);
        categoryId = isNaN(parsedId) ? undefined : parsedId;
      }

      const response = await notesService.updateNote(viewingNote._id, { category: categoryId });
      
      if (response.success && response.data) {
        setViewingNote(response.data);
        setIsViewCategoryPickerOpen(false);
        // Обновляем заметку в локальном состоянии для мгновенного обновления UI
        setNotes(prev => prev.map(note => 
          note._id === viewingNote._id ? response.data! : note
        ));
      } else {
        alert(t('notesBlock.failedToUpdateCategory'));
      }
    } catch (error: any) {
      alert(t('notesBlock.errorUpdatingCategoryTryAgain'));
    }
  };

  // Своих категорий у заметок платформы нет — только «Личная» и «Рабочая».
  const handleAddViewCategory = async () => {
    setNewViewCategoryName('');
    setIsViewCategoryModalOpen(false);
  };

  const handleUpdateViewClient = async (leadId: string) => {
    if (!viewingNote?._id) return;

    try {
      // Если leadId пустой, отправляем null для отвязки лида
      const updateData: { leadId?: string | null } = leadId.trim() === '' 
        ? { leadId: null } 
        : { leadId: leadId.trim() };
      
      const response = await notesService.updateNote(viewingNote._id, updateData);
      
      if (response.success && response.data) {
        setViewingNote(response.data);
        setIsViewClientPickerOpen(false);
        // Обновляем заметку в локальном состоянии для мгновенного обновления UI
        setNotes(prev => prev.map(note => 
          note._id === viewingNote._id ? response.data! : note
        ));
      } else {
        alert(t('notesBlock.failedToUpdateClient'));
      }
    } catch (error: any) {
      alert(t('notesBlock.errorUpdatingClientTryAgain'));
    }
  };

  const handleAddViewClient = () => {
    if (newViewClientName.trim()) {
      const newClientNameTrimmed = newViewClientName.trim();
      // TODO: Реализовать добавление нового клиента через API
      setNewViewClientName('');
      setIsViewClientModalOpen(false);
      setIsViewClientPickerOpen(false);
      // Автоматически устанавливаем нового клиента для заметки
      if (viewingNote?._id) {
        handleUpdateViewClient(newClientNameTrimmed);
      }
    }
  };

  const handleDeleteViewFile = async () => {
    if (!viewingNote?._id || !fileToDelete) return;

    try {
      // Убеждаемся, что заметка имеет content перед удалением файла
      // Если content отсутствует, используем title или пустую строку
      const currentContent = viewingNote.content || viewingNote.title || '';
      
      // Если заметка не имеет content, обновляем её перед удалением файла
      if (!viewingNote.content) {
        try {
          await notesService.updateNote(viewingNote._id, {
            content: currentContent,
            title: viewingNote.title
          });
        } catch (updateError) {
          console.error(t('notesBlock.errorUpdatingNoteBeforeFileDeletion'), updateError);
        }
      }

      const response = await notesService.deleteNoteFileByIndex(viewingNote._id, fileToDelete.index);
      
      if (response.success && response.data) {
        // Обновляем заметку в модалке
        setViewingNote(response.data);
        setViewNoteFiles(response.data.files || []);
        setIsDeleteViewFileConfirmModalOpen(false);
        setFileToDelete(null);
        
        // Обновляем заметку в локальном состоянии для мгновенного обновления UI
        setNotes(prev => prev.map(note => 
          note._id === viewingNote._id ? response.data! : note
        ));
      } else {
        alert(t('notesBlock.failedToDeleteFile'));
      }
    } catch (error: any) {
      console.error(t('notesBlock.errorDeletingFileLog'), error);
      const errorMessage = error.response?.data?.message || t('notesBlock.errorDeletingFile');
      
      // Если ошибка связана с отсутствием content, пытаемся исправить
      if (errorMessage.includes('content') && errorMessage.includes('required')) {
        try {
          // Обновляем заметку с content перед повторной попыткой удаления
          const currentContent = viewingNote.content || viewingNote.title || '';
          await notesService.updateNote(viewingNote._id, {
            content: currentContent,
            title: viewingNote.title
          });
          
          // Повторяем попытку удаления файла
          const retryResponse = await notesService.deleteNoteFileByIndex(viewingNote._id, fileToDelete.index);
          
          if (retryResponse.success && retryResponse.data) {
            setViewingNote(retryResponse.data);
            setViewNoteFiles(retryResponse.data.files || []);
            setIsDeleteViewFileConfirmModalOpen(false);
            setFileToDelete(null);
            
            // Обновляем заметку в локальном состоянии для мгновенного обновления UI
            setNotes(prev => prev.map(note => 
              note._id === viewingNote._id ? retryResponse.data! : note
            ));
            return;
          }
        } catch (retryError) {
          console.error(t('notesBlock.errorRetryingFileDeletion'), retryError);
        }
      }
      
      alert(errorMessage);
    }
  };

  const handleViewNoteFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !viewingNote?._id) return;

    setIsUploadingViewFiles(true);

    try {
      const filesArray = Array.from(selectedFiles);
      

      if (filesArray.length > 10) {
        alert(t('notesBlock.maxFilesError'));
        setIsUploadingViewFiles(false);
        return;
      }

      // Загружаем файлы через бэкенд
      const uploadResponse = await notesService.uploadNoteFiles(viewingNote._id, filesArray);

      if (uploadResponse.success && uploadResponse.data) {
        const updatedNote = uploadResponse.data;
        setViewingNote(updatedNote);
        setViewNoteFiles(updatedNote.files || []);
        setNotes(prev => prev.map(note =>
          note._id === viewingNote._id ? updatedNote : note
        ));
      } else {
        alert(uploadResponse.message || t('notesBlock.errorUploadingFiles'));
      }

      if (viewNoteFileInputRef.current) {
        viewNoteFileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error(t('notesBlock.errorUploadingFilesLog'), error);
      alert(error.response?.data?.message || t('notesBlock.errorUploadingFiles'));
    } finally {
      setIsUploadingViewFiles(false);
    }
  };

  const handleUpdateNote = async () => {
    if (!title.trim() || !editingNoteId) {
      if (!title.trim()) {
        alert(t('notesBlock.pleaseEnterNoteTitle'));
      }
      return;
    }
    
    if (!selectedNoteCategory.trim()) {
      alert(t('notesBlock.pleaseSelectCategory'));
      return;
    }

    try {
      setIsSaving(true);

      // Удаляем помеченные файлы перед обновлением заметки
      if (deletedFileIndexes.length > 0) {
        try {
          // Сортируем индексы по убыванию, чтобы удалять с конца (чтобы индексы не сдвигались)
          const sortedIndexes = [...deletedFileIndexes].sort((a, b) => b - a);
          for (const fileIndex of sortedIndexes) {
            await notesService.deleteNoteFileByIndex(editingNoteId, fileIndex);
          }
        } catch (error) {
          console.error(t('notesBlock.errorDeletingFilesLog'), error);
        }
      }

      // Находим категорию в списке по названию и получаем её ID
      const category = selectedNoteCategory 
        ? noteCategoriesList.find(cat => cat.label === selectedNoteCategory)
        : null;
      let categoryId: number | undefined = undefined;
      if (category) {
        const parsedId = parseInt(category.key);
        categoryId = isNaN(parsedId) ? undefined : parsedId;
      }

      const updateData: UpdateNoteDto = {
        title: title.trim().substring(0, 255),
        content: description.trim() || title.trim(),
        ...(categoryId !== undefined && { category: categoryId }),
      };
      
      // Всегда передаем leadId: либо строку, либо null для отвязки
      if (selectedNoteLeadId && selectedNoteLeadId.trim()) {
        updateData.leadId = selectedNoteLeadId.trim();
      } else {
        updateData.leadId = null;
      }

      const response = await notesService.updateNote(editingNoteId, updateData);

      if (response.success && response.data) {
        // Загружаем новые файлы, если они есть (через новую систему)
        if (selectedNoteFiles.length > 0) {
          try {
            const uploadResult = await notesService.uploadNoteFiles(editingNoteId, selectedNoteFiles);
            if (!uploadResult.success) alert(uploadResult.message || t('notesBlock.errorUploadingFiles'));
          } catch (error) {
            console.error(t('notesBlock.errorUploadingFilesLog'), error);
          }
        }

        // Очищаем форму и закрываем модалку
        setTitle('');
        setDescription('');
        setOriginalTitle('');
        setOriginalDescription('');
        setSelectedNoteCategory('');
        setSelectedNoteLeadId('');
        setOriginalNoteCategory('');
        setOriginalNoteLeadId('');
        setSelectedNoteFiles([]);
        setExistingNoteFiles([]);
        setDeletedFileIndexes([]);
        setNoteClientSearch('');
        setIsNoteClientSearchOpen(false);
        setIsNewNoteModalOpen(false);
        setEditingNoteId(null);
        
        // Обновляем локальное состояние заметки для мгновенного обновления UI
        // Автообновление через useAutoRefresh обновит список полностью через несколько секунд
        if (response.data) {
          const updatedNote = response.data;
          setNotes(prev => {
            const updated = prev.map(note => 
              note._id === editingNoteId ? updatedNote : note
            );
            // Сортируем: сначала закрепленные, потом по дате создания (новые сверху)
            return updated.sort((a, b) => {
              if (a.isPinned !== b.isPinned) {
                return a.isPinned ? -1 : 1;
              }
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
          });
          
          // Обновляем viewingNote, если модалка просмотра открыта для этой заметки
          if (viewingNote && viewingNote._id === editingNoteId) {
            setViewingNote(updatedNote);
          }
        }
      } else {
        alert(response.message || t('notesBlock.failedToUpdateNote'));
      }
    } catch (error: any) {
      console.error(t('notesBlock.errorUpdatingNoteLog'), error);
      alert(error.response?.data?.message || t('notesBlock.failedToUpdateNote'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNote = async () => {
    if (!title.trim()) {
      alert(t('notesBlock.pleaseEnterNoteTitle'));
      return;
    }
    
    if (!selectedNoteCategory.trim()) {
      alert(t('notesBlock.pleaseSelectCategory'));
      return;
    }

    try {
      setIsSaving(true);

      // Находим категорию в списке по названию и получаем её ID
      const category = selectedNoteCategory 
        ? noteCategoriesList.find(cat => cat.label === selectedNoteCategory)
        : null;
      let categoryId: number | undefined = undefined;
      if (category) {
        const parsedId = parseInt(category.key);
        categoryId = isNaN(parsedId) ? undefined : parsedId;
      }

      const noteData: CreateNoteDto = {
        title: title.trim().substring(0, 255), // Ограничиваем title до 255 символов
        content: description.trim() || title.trim(), // content обязателен, используем description или title
        ...(categoryId !== undefined && { category: categoryId }),
      };
      
      // Передаем leadId только если он выбран (явно не передаем, если не выбран)
      if (selectedNoteLeadId && selectedNoteLeadId.trim()) {
        noteData.leadId = selectedNoteLeadId.trim();
      }

      const response = await notesService.createNote(noteData);

      if (response.success && response.data) {
        // Загружаем файлы, если они есть (через новую систему)
        if (selectedNoteFiles.length > 0) {
          try {
            const uploadResult = await notesService.uploadNoteFiles(response.data._id, selectedNoteFiles);
            if (!uploadResult.success) alert(uploadResult.message || t('notesBlock.errorUploadingFiles'));
          } catch (error) {
            console.error(t('notesBlock.errorUploadingFilesLog'), error);
          }
        }

        // Очищаем форму и закрываем модалку
        setTitle('');
        setDescription('');
        setSelectedNoteCategory('');
        setSelectedNoteLeadId('');
        setOriginalNoteCategory('');
        setOriginalNoteLeadId('');
        setSelectedNoteFiles([]);
        setExistingNoteFiles([]);
        setDeletedFileIndexes([]);
        setIsNewNoteModalOpen(false);
        setEditingNoteId(null);
        
        // Добавляем новую заметку в локальное состояние для мгновенного обновления UI
        // Автообновление через useAutoRefresh обновит список полностью через несколько секунд
        if (response.data) {
          setNotes(prev => {
            const updated = [response.data!, ...prev];
            // Сортируем: сначала закрепленные, потом по дате создания (новые сверху)
            return updated.sort((a, b) => {
              if (a.isPinned !== b.isPinned) {
                return a.isPinned ? -1 : 1;
              }
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
          });
        }
      } else {
        alert(response.message || t('notesBlock.failedToCreateNote'));
      }
    } catch (error: any) {
      console.error(t('notesBlock.errorCreatingNoteLog'), error);
      alert(error.response?.data?.message || t('notesBlock.failedToCreateNote'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col rounded-lg px-4 py-5 md:p-4 md:pb-2 gap-4 bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)]">
      <button
        type="button"
        onClick={() => setIsNotesBlockCollapsed(!isNotesBlockCollapsed)}
        className="w-full md:hidden flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-x-1">
          <div className="size-6">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.7686 1.539H13.8673V0.78125C13.8673 0.349731 13.5176 0 13.0861 0H6.94C6.50848 0 6.15875 0.349731 6.15875 0.78125V1.539H4.25781C3.18085 1.539 2.30469 2.41516 2.30469 3.49213V18.0469C2.30469 19.1238 3.18085 20 4.25781 20H15.7686C16.8456 20 17.7217 19.1238 17.7217 18.0469V3.49213C17.7217 2.41516 16.8454 1.539 15.7686 1.539ZM12.3048 1.5625V3.07816H7.7211C7.7211 2.5589 7.7211 2.12997 7.7211 1.5625H12.3048ZM16.1592 18.0469C16.1592 18.2623 15.9839 18.4375 15.7686 18.4375H4.25781C4.04236 18.4375 3.86719 18.2623 3.86719 18.0469V3.49213C3.86719 3.27682 4.04236 3.1015 4.25781 3.1015H6.1586V3.85941C6.1586 4.29092 6.50848 4.64066 6.93985 4.64066H13.0861C13.5175 4.64066 13.8673 4.29092 13.8673 3.85941V3.1015H15.7686C15.9839 3.1015 16.1592 3.27682 16.1592 3.49213V18.0469ZM13.6383 9.12186C13.9435 9.42703 13.9435 9.92172 13.6383 10.2267L9.53278 14.3323C9.22775 14.6375 8.73306 14.6375 8.42789 14.3323L6.38763 12.292C6.08261 11.987 6.08261 11.4923 6.38763 11.1871C6.69281 10.8821 7.18735 10.8821 7.49252 11.1871L8.98041 12.675L12.5334 9.12201C12.8386 8.81683 13.3331 8.81683 13.6383 9.12186Z" fill="var(--accent)"/>
            </svg>
          </div>
          <span className="text-base text-[rgba(255,255,255,0.92)]">{t('notesBlock.notesTitle')}</span>
          <Tooltip text={t('notesBlock.createNoteButton')} position="top">
            <span
              className="cursor-pointer ml-2 text-[var(--accent)] text-3xl font-normal"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenNewNote();
              }}
            >
              +
            </span>
          </Tooltip>
        </div>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`transition-transform duration-200 ${isNotesBlockCollapsed ? 'rotate-180' : ''}`}
        >
          <path d="M12.0007 10.8273L7.05072 15.7773L5.63672 14.3633L12.0007 7.99935L18.3647 14.3633L16.9507 15.7773L12.0007 10.8273Z" fill="var(--accent)"/>
        </svg>
      </button>
      <div className="hidden md:flex items-center justify-between">
        <div 
          className="flex items-center gap-x-1 cursor-pointer text-[rgba(255,255,255,0.92)] hover:text-[var(--accent)]"
          onClick={() => setIsModalOpen(true)}
        >
          <div className="size-6">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.7686 1.539H13.8673V0.78125C13.8673 0.349731 13.5176 0 13.0861 0H6.94C6.50848 0 6.15875 0.349731 6.15875 0.78125V1.539H4.25781C3.18085 1.539 2.30469 2.41516 2.30469 3.49213V18.0469C2.30469 19.1238 3.18085 20 4.25781 20H15.7686C16.8456 20 17.7217 19.1238 17.7217 18.0469V3.49213C17.7217 2.41516 16.8454 1.539 15.7686 1.539ZM12.3048 1.5625V3.07816H7.7211C7.7211 2.5589 7.7211 2.12997 7.7211 1.5625H12.3048ZM16.1592 18.0469C16.1592 18.2623 15.9839 18.4375 15.7686 18.4375H4.25781C4.04236 18.4375 3.86719 18.2623 3.86719 18.0469V3.49213C3.86719 3.27682 4.04236 3.1015 4.25781 3.1015H6.1586V3.85941C6.1586 4.29092 6.50848 4.64066 6.93985 4.64066H13.0861C13.5175 4.64066 13.8673 4.29092 13.8673 3.85941V3.1015H15.7686C15.9839 3.1015 16.1592 3.27682 16.1592 3.49213V18.0469ZM13.6383 9.12186C13.9435 9.42703 13.9435 9.92172 13.6383 10.2267L9.53278 14.3323C9.22775 14.6375 8.73306 14.6375 8.42789 14.3323L6.38763 12.292C6.08261 11.987 6.08261 11.4923 6.38763 11.1871C6.69281 10.8821 7.18735 10.8821 7.49252 11.1871L8.98041 12.675L12.5334 9.12201C12.8386 8.81683 13.3331 8.81683 13.6383 9.12186Z" fill="var(--accent)"/>
            </svg>
          </div>
          <span className="text-base">{t('notesBlock.notesTitle')}</span>
        </div>
        <Tooltip text={t('notesBlock.createNoteButton')} position="top">
          <button
            type="button"
            className="cursor-pointer"
            onClick={handleOpenNewNote}
          >
            <span className="text-[var(--accent)] text-3xl font-normal">+</span>
          </button>
        </Tooltip>
      </div>
      <div className={`${isNotesBlockCollapsed ? 'hidden md:block' : 'block'}`}>
        {notes.length === 0 ? (
          <div className="flex items-center justify-center rounded-md bg-[var(--secondary)] p-4 text-base text-[rgba(255,255,255,0.72)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]">
            <span>{t('notesBlock.noNotesYet')}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {notes.slice(0, 5).map((note) => {
              const isHovered = hoveredNoteId === note._id || hoveredPinId === note._id;
              
              return (
                <div 
                  key={note._id}
                  className="flex items-start justify-between rounded-md bg-[var(--secondary)] p-2 text-base cursor-pointer text-[rgba(255,255,255,0.92)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--secondary))]"
                  onMouseEnter={() => setHoveredNoteId(note._id)}
                  onMouseLeave={() => {
                    setHoveredNoteId(null);
                    setHoveredPinId(null);
                  }}
                  onClick={() => {
                    setViewingNote(note);
                    setViewNoteTitle(note.title || '');
                    setViewNoteDescription(note.content || '');
                    setOriginalViewTitle(note.title || '');
                    setOriginalViewDescription(note.content || '');
                    setViewNoteFiles(note.files || []);
                    setIsEditingViewTitle(false);
                    setIsEditingViewDescription(false);
                    setIsViewCategoryPickerOpen(false);
                    setIsViewClientPickerOpen(false);
                    if (onCloseChecklist) {
                      onCloseChecklist();
                    }
                    setIsViewNoteModalOpen(true);
                  }}
                >
              <div className="flex items-center gap-2">
                    {note.title && <span className="truncate">{note.title.length > 30 ? `${note.title.substring(0, 30)}...` : note.title}</span>}
                    {note.files && note.files.length > 0 && (
                      <Tooltip text={t('notesBlock.hasFiles')}>
                        <div className="flex items-center justify-center flex-shrink-0">
                          <svg width="10" height="18" viewBox="0 0 14 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent)]">
                            <path d="M9 0H5C3.6744 0.00156145 2.40353 0.528847 1.46619 1.46619C0.528847 2.40353 0.00156145 3.6744 0 5V25C0 25.2652 0.105357 25.5196 0.292893 25.7071C0.48043 25.8946 0.734784 26 1 26C1.26522 26 1.51957 25.8946 1.70711 25.7071C1.89464 25.5196 2 25.2652 2 25V5C2.00087 4.20462 2.31722 3.44206 2.87964 2.87964C3.44206 2.31722 4.20462 2.00087 5 2H9C9.79538 2.00087 10.5579 2.31722 11.1204 2.87964C11.6828 3.44206 11.9991 4.20462 12 5V21C12 21.7956 11.6839 22.5587 11.1213 23.1213C10.5587 23.6839 9.79565 24 9 24C8.20435 24 7.44129 23.6839 6.87868 23.1213C6.31607 22.5587 6 21.7956 6 21V8C6 7.73478 6.10536 7.48043 6.29289 7.29289C6.48043 7.10536 6.73478 7 7 7C7.26522 7 7.51957 7.10536 7.70711 7.29289C7.89464 7.48043 8 7.73478 8 8V20C8 20.2652 8.10536 20.5196 8.29289 20.7071C8.48043 20.8946 8.73478 21 9 21C9.26522 21 9.51957 20.8946 9.70711 20.7071C9.89464 20.5196 10 20.2652 10 20V8C10 7.20435 9.68393 6.44129 9.12132 5.87868C8.55871 5.31607 7.79565 5 7 5C6.20435 5 5.44129 5.31607 4.87868 5.87868C4.31607 6.44129 4 7.20435 4 8V21C4 22.3261 4.52678 23.5979 5.46447 24.5355C6.40215 25.4732 7.67392 26 9 26C10.3261 26 11.5979 25.4732 12.5355 24.5355C13.4732 23.5979 14 22.3261 14 21V5C13.9984 3.6744 13.4712 2.40353 12.5338 1.46619C11.5965 0.528847 10.3256 0.00156145 9 0Z" fill="currentColor"/>
                          </svg>
                        </div>
                      </Tooltip>
                    )}
              </div>
                  <div 
                    className="size-[18px] cursor-pointer transition-opacity"
                    style={{
                      opacity: note.isPinned 
                        ? 1 
                        : hoveredPinId === note._id 
                          ? 1 
                          : isHovered 
                            ? 0.5 
                            : 0
                    }}
                    onMouseEnter={() => setHoveredPinId(note._id)}
                    onMouseLeave={() => setHoveredPinId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePinNote(note._id, note.isPinned);
                    }}
                  >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.15508 0.137253L0.136026 5.20158C-0.0453426 5.38439 -0.0453426 5.68125 0.136026 5.86407L0.157292 5.88552C0.464959 6.19606 0.874221 6.36716 1.30939 6.36716C1.58976 6.36716 1.85879 6.29529 2.09736 6.16176L6.60445 11.4607C6.24524 11.8663 6.04865 12.3839 6.04865 12.9322C6.04865 13.523 6.27663 14.0783 6.69063 14.496L6.72211 14.5277C6.90339 14.7107 7.1974 14.7107 7.37868 14.5277L10.3855 11.4938L13.3139 14.4487C13.3741 14.5078 14.8025 15.9064 15.9392 16.8259C17.0214 17.7016 17.2196 17.8748 17.2299 17.8838C17.4134 18.0463 17.6901 18.0373 17.8634 17.8633C17.9541 17.7722 18 17.6519 18 17.5313C18 17.4214 17.9619 17.3112 17.8851 17.2226C17.8784 17.2148 17.7101 17.0193 16.8368 15.9203C15.9255 14.7735 14.5392 13.3323 14.476 13.2668L11.5523 10.3167L14.3981 7.44522C14.4888 7.35377 14.5341 7.23383 14.5341 7.11398C14.5341 6.99413 14.4888 6.8741 14.3981 6.78274L14.3666 6.75097C13.9527 6.33324 13.4022 6.1032 12.8168 6.1032C12.2734 6.1032 11.7604 6.30166 11.3585 6.66401L6.10687 2.11628C6.23921 1.87555 6.31044 1.6041 6.31044 1.3212C6.31044 0.882011 6.14095 0.469152 5.8331 0.15871L5.81184 0.137253C5.63038 -0.0457518 5.33636 -0.0457518 5.15508 0.137253Z" fill="var(--accent)"/>
                </svg>
              </div>
            </div>
              );
            })}
          </div>
        )}
      </div>
      
      {typeof document !== 'undefined' && createPortal(
        <>
      {isModalOpen && (
        <div 
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" 
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="relative w-full md:w-[80%] md:max-w-[1000px] h-[80vh] pt-7.5 px-12.5 pb-5 md:h-[85vh] flex flex-col bg-white rounded-lg shadow-2xl" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex justify-between items-center pl-2.5 py-2.5">
              <div className='flex items-center gap-2.5'>
                <svg className="text-[var(--accent)]" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <g clipPath="url(#clip0_4687_64471)">
                  <path d="M19.7107 1.92375H17.3342V0.976562C17.3342 0.437164 16.897 0 16.3576 0H8.675C8.1356 0 7.69844 0.437164 7.69844 0.976562V1.92375H5.32227C3.97606 1.92375 2.88086 3.01895 2.88086 4.36516V22.5586C2.88086 23.9048 3.97606 25 5.32227 25H19.7107C21.0569 25 22.1521 23.9048 22.1521 22.5586V4.36516C22.1521 3.01895 21.0567 1.92375 19.7107 1.92375ZM15.3811 1.95312V3.84769H9.65137C9.65137 3.19862 9.65137 2.66247 9.65137 1.95312H15.3811ZM20.199 22.5586C20.199 22.8279 19.9799 23.0469 19.7107 23.0469H5.32227C5.05295 23.0469 4.83398 22.8279 4.83398 22.5586V4.36516C4.83398 4.09603 5.05295 3.87688 5.32227 3.87688H7.69825V4.82426C7.69825 5.36366 8.1356 5.80082 8.67481 5.80082H16.3576C16.8968 5.80082 17.3342 5.36366 17.3342 4.82426V3.87688H19.7107C19.9799 3.87688 20.199 4.09603 20.199 4.36516V22.5586ZM17.0479 11.4023C17.4294 11.7838 17.4294 12.4022 17.0479 12.7834L11.916 17.9153C11.5347 18.2968 10.9163 18.2968 10.5349 17.9153L7.98454 15.365C7.60326 14.9837 7.60326 14.3654 7.98454 13.9839C8.36601 13.6026 8.98418 13.6026 9.36565 13.9839L11.2255 15.8438L15.6668 11.4025C16.0482 11.021 16.6664 11.021 17.0479 11.4023Z" fill="currentColor"/>
                  </g>
                  <defs>
                  <clipPath id="clip0_4687_64471">
                  <rect width="25" height="25" fill="transparent"/>
                  </clipPath>
                  </defs>
                </svg>
                <span className="font-normal text-[24px] leading-[150%] tracking-[-0.01em]">
                  {t('notesBlock.allNotes')}
                </span>
              </div>
              <button 
                onClick={handleOpenNewNote}
                className='flex items-center gap-2 px-5 h-9.5 rounded bg-[var(--primary)] cursor-pointer text-[var(--primary-foreground)]'
              >
                <svg width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 24.0623C11.3527 24.0623 10.8281 23.4503 10.8281 22.6951V5.30664C10.8281 4.55141 11.3527 3.93945 12 3.93945C12.6473 3.93945 13.1719 4.55141 13.1719 5.30664V22.6951C13.1719 23.4503 12.6473 24.0623 12 24.0623Z" fill="white"/>
                  <path d="M19.4513 15.3672H4.54688C3.89953 15.3672 3.375 14.7552 3.375 14C3.375 13.2448 3.89953 12.6328 4.54688 12.6328H19.4513C20.0986 12.6328 20.6231 13.2448 20.6231 14C20.6231 14.7552 20.0986 15.3672 19.4513 15.3672Z" fill="white"/>
                </svg>
                <span className='text-white font-normal text-[16px] leading-[150%] tracking-[-0.01em]'>
                  {t('notesBlock.newNoteTitle')}
                </span>
              </button>
              <button
                onClick={() => setIsModalOpen(false)}
                className="absolute -right-24 -top-10 cursor-pointer"
              >
                <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M33.75 11.25L11.25 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M11.25 11.25L33.75 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className='flex flex-col gap-2.5 overflow-y-auto mt-5'>
              {notes.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-base text-[rgba(255,255,255,0.72)]">{t('notesBlock.noNotes')}</span>
                </div>
              ) : (
                notes.map((note) => (
                  <div 
                    key={note._id} 
                    className='flex flex-col px-5 py-1 rounded-md bg-[var(--secondary)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)] gap-1 relative cursor-pointer'
                    onMouseEnter={() => setHoveredNoteId(note._id)}
                    onMouseLeave={() => {
                      setHoveredNoteId(null);
                      setHoveredPinId(null);
                    }}
                    onClick={() => {
                      setViewingNote(note);
                      setViewNoteTitle(note.title || '');
                      setViewNoteDescription(note.content || '');
                      setOriginalViewTitle(note.title || '');
                      setOriginalViewDescription(note.content || '');
                      setViewNoteFiles(note.files || []);
                      setIsEditingViewTitle(false);
                      setIsEditingViewDescription(false);
                      if (onCloseChecklist) {
                        onCloseChecklist();
                      }
                      setIsViewNoteModalOpen(true);
                    }}
                  >
                    <div className='flex items-start justify-between'>
                      <div className='flex flex-col items-start flex-1'>
                        {note.title && (
                          <span 
                            className="font-normal break-words overflow-wrap-anywhere block"
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 400,
                              fontStyle: 'normal',
                              fontSize: '18px',
                              lineHeight: '24px',
                              letterSpacing: '0px',
                              leadingTrim: 'cap-height',
                              wordBreak: 'break-word',
                              overflowWrap: 'break-word',
                              maxWidth: '100%',
                              color: 'rgba(255,255,255,0.92)'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          >
                            {note.title.length > 25 ? `${note.title.substring(0, 25)}...` : note.title}
                          </span>
                        )}
                        {note.content && (
                          <>
                            <span className={`font-normal text-base leading-snug tracking-[0px] text-[rgba(255,255,255,0.72)] ${note.title ? 'mt-1' : ''}`}>
                              {note.content.length > 50 ? `${note.content.substring(0, 50)}...` : note.content}
                            </span>
                            <Tooltip text={t('notesBlock.createdAt')}>
                              <div className='mt-0.5'>
                                <span className="font-normal text-base leading-[100%] tracking-[0px] text-[rgba(255,255,255,0.72)]">
                                  {formatDate(note.createdAt)}
                                </span>
                              </div>
                            </Tooltip>
                          </>
                        )}
                        {!note.content && (
                          <Tooltip text={t('notesBlock.createdAt')}>
                            <div className='mt-0.5'>
                              <span className="font-normal text-base leading-[100%] tracking-[0px] text-[rgba(255,255,255,0.72)]">
                                {formatDate(note.createdAt)}
                              </span>
                            </div>
                          </Tooltip>
                        )}
                      </div>
                      <div className='flex items-center gap-2'>
                        {note.files && note.files.length > 0 && (
                          <Tooltip text={t('notesBlock.hasFiles')}>
                            <div className="flex items-center justify-center flex-shrink-0">
                              <svg className="text-[rgba(255,255,255,0.72)]" width="12" height="22" viewBox="0 0 14 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 0H5C3.6744 0.00156145 2.40353 0.528847 1.46619 1.46619C0.528847 2.40353 0.00156145 3.6744 0 5V25C0 25.2652 0.105357 25.5196 0.292893 25.7071C0.48043 25.8946 0.734784 26 1 26C1.26522 26 1.51957 25.8946 1.70711 25.7071C1.89464 25.5196 2 25.2652 2 25V5C2.00087 4.20462 2.31722 3.44206 2.87964 2.87964C3.44206 2.31722 4.20462 2.00087 5 2H9C9.79538 2.00087 10.5579 2.31722 11.1204 2.87964C11.6828 3.44206 11.9991 4.20462 12 5V21C12 21.7956 11.6839 22.5587 11.1213 23.1213C10.5587 23.6839 9.79565 24 9 24C8.20435 24 7.44129 23.6839 6.87868 23.1213C6.31607 22.5587 6 21.7956 6 21V8C6 7.73478 6.10536 7.48043 6.29289 7.29289C6.48043 7.10536 6.73478 7 7 7C7.26522 7 7.51957 7.10536 7.70711 7.29289C7.89464 7.48043 8 7.73478 8 8V20C8 20.2652 8.10536 20.5196 8.29289 20.7071C8.48043 20.8946 8.73478 21 9 21C9.26522 21 9.51957 20.8946 9.70711 20.7071C9.89464 20.5196 10 20.2652 10 20V8C10 7.20435 9.68393 6.44129 9.12132 5.87868C8.55871 5.31607 7.79565 5 7 5C6.20435 5 5.44129 5.31607 4.87868 5.87868C4.31607 6.44129 4 7.20435 4 8V21C4 22.3261 4.52678 23.5979 5.46447 24.5355C6.40215 25.4732 7.67392 26 9 26C10.3261 26 11.5979 25.4732 12.5355 24.5355C13.4732 23.5979 14 22.3261 14 21V5C13.9984 3.6744 13.4712 2.40353 12.5338 1.46619C11.5965 0.528847 10.3256 0.00156145 9 0Z" fill="currentColor"/>
                              </svg>
                            </div>
                          </Tooltip>
                        )}
                        <Tooltip text={note.isPinned ? t('notesBlock.unpin') : t('notesBlock.pin')}>
                          <div
                            className="cursor-pointer transition-opacity"
                            style={{
                              opacity: note.isPinned 
                                ? 1 // Если закреплена, всегда полностью четкая
                                : hoveredPinId === note._id 
                                  ? 0.7 // Если не закреплена и наведена мышка на SVG - 70%
                                  : hoveredNoteId === note._id 
                                    ? 0.5 // Если не закреплена и наведена мышка на карточку - 50%
                                    : 0.3 // Если не закреплена и не наведена - 30% (чуть видимая)
                            }}
                            onMouseEnter={() => setHoveredPinId(note._id)}
                            onMouseLeave={() => setHoveredPinId(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePinNote(note._id, note.isPinned);
                            }}
                          >
                            <svg className="text-[var(--accent)]" width="22" height="21" viewBox="0 0 23 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M6.35748 0.167757L0.167753 6.35748C-0.0559185 6.58093 -0.0559185 6.94375 0.167753 7.16719L0.19398 7.19342C0.573408 7.57296 1.07813 7.78209 1.6148 7.78209C1.96056 7.78209 2.29234 7.69424 2.58656 7.53104L8.14491 14.0075C7.70192 14.5032 7.45946 15.1359 7.45946 15.806C7.45946 16.5281 7.74063 17.2069 8.25119 17.7173L8.29001 17.7561C8.51357 17.9798 8.87616 17.9798 9.09972 17.7561L12.8079 14.048L16.4193 17.6595C16.4936 17.7317 18.2551 19.4412 19.6569 20.565C20.9915 21.6353 21.236 21.8469 21.2486 21.8579C21.4749 22.0566 21.8162 22.0456 22.0299 21.833C22.1418 21.7215 22.1984 21.5746 22.1984 21.4272C22.1984 21.2928 22.1515 21.1582 22.0567 21.0498C22.0485 21.0403 21.8409 20.8014 20.7638 19.4581C19.64 18.0565 17.9304 16.295 17.8525 16.2149L14.2468 12.6093L17.7564 9.09972C17.8683 8.98794 17.9241 8.84135 17.9241 8.69487C17.9241 8.54839 17.8683 8.40168 17.7564 8.29001L17.7175 8.25119C17.2071 7.74063 16.5282 7.45946 15.8062 7.45946C15.1361 7.45946 14.5034 7.70203 14.0078 8.14491L7.53127 2.58657C7.69447 2.29235 7.78231 1.96056 7.78231 1.6148C7.78231 1.07802 7.5733 0.57341 7.19364 0.193981L7.16742 0.167757C6.94363 -0.0559161 6.58104 -0.0559161 6.35748 0.167757Z" fill="currentColor"/>
                            </svg>
                          </div>
                        </Tooltip>
                        <Tooltip text={t('notesBlock.edit')}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditNote(note);
                            }}
                            className='flex items-center gap-1 cursor-pointer'
                          >
                            <svg className="text-[var(--accent)]" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </Tooltip>
                        <Tooltip text={t('notesBlock.delete')}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNoteToDelete(note);
                              setIsDeleteNoteConfirmModalOpen(true);
                            }}
                            className="cursor-pointer"
                            type="button"
                          >
                          <svg className="text-[var(--accent)]" width="22" height="22" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="currentColor"/>
                            <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="currentColor"/>
                            <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="currentColor"/>
                            <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="currentColor"/>
                          </svg>
                        </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      
      {isNewNoteModalOpen && (
        <div 
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-[70] pt-[15px] md:pt-4 pb-0 md:pb-4 px-0 md:px-4" 
          onClick={handleCloseNoteModal}
        >
          <div
            className="relative w-full md:w-[70.89%] max-h-[95vh] md:max-h-[90vh] px-5 py-2.5 flex flex-col bg-white rounded-t-lg md:rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCloseNoteModal}
              className="hidden md:block absolute -right-10 -top-2.5 cursor-pointer"
            >
              <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M33.75 11.25L11.25 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                <path d="M11.25 11.25L33.75 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </button>
            {/* Мобильная версия кнопки закрытия */}
            <button
              onClick={handleCloseNoteModal}
              className="md:hidden absolute right-4 top-4 cursor-pointer z-10"
            >
              <svg width="30" height="30" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M33.75 11.25L11.25 33.75" stroke="#666666" strokeWidth="3" strokeLinecap="round"/>
                <path d="M11.25 11.25L33.75 33.75" stroke="#666666" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="flex items-center justify-center gap-2.5 pt-2.5 pb-5">
              <svg className="text-[var(--accent)]" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19.7107 1.92375H17.3342V0.976562C17.3342 0.437164 16.897 0 16.3576 0H8.675C8.1356 0 7.69844 0.437164 7.69844 0.976562V1.92375H5.32227C3.97606 1.92375 2.88086 3.01895 2.88086 4.36516V22.5586C2.88086 23.9048 3.97606 25 5.32227 25H19.7107C21.0569 25 22.1521 23.9048 22.1521 22.5586V4.36516C22.1521 3.01895 21.0567 1.92375 19.7107 1.92375ZM15.3811 1.95312V3.84769H9.65137C9.65137 3.19862 9.65137 2.66247 9.65137 1.95312H15.3811ZM20.199 22.5586C20.199 22.8279 19.9799 23.0469 19.7107 23.0469H5.32227C5.05295 23.0469 4.83398 22.8279 4.83398 22.5586V4.36516C4.83398 4.09603 5.05295 3.87688 5.32227 3.87688H7.69825V4.82426C7.69825 5.36366 8.1356 5.80082 8.67481 5.80082H16.3576C16.8968 5.80082 17.3342 5.36366 17.3342 4.82426V3.87688H19.7107C19.9799 3.87688 20.199 4.09603 20.199 4.36516V22.5586ZM17.0479 11.4023C17.4294 11.7838 17.4294 12.4022 17.0479 12.7834L11.916 17.9153C11.5347 18.2968 10.9163 18.2968 10.5349 17.9153L7.98454 15.365C7.60326 14.9837 7.60326 14.3654 7.98454 13.9839C8.36601 13.6026 8.98418 13.6026 9.36565 13.9839L11.2255 15.8438L15.6668 11.4025C16.0482 11.021 16.6664 11.021 17.0479 11.4023Z" fill="currentColor"/>
              </svg>
              <span 
                className="text-[var(--accent)]"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontStyle: 'normal',
                  fontSize: '24px',
                  lineHeight: '150%',
                  letterSpacing: '-0.01em',
                  leadingTrim: 'cap-height'
                } as React.CSSProperties & { leadingTrim?: string }}
              >
                {editingNoteId ? t('notesBlock.editNoteTitle') : t('notesBlock.newNoteTitle')}
              </span>
            </div>
            <div>
              <div className="w-full flex flex-col gap-5 mt-5">
                <div className="relative w-full flex flex-col">
                  <input
                    type="text"
                    maxLength={255}
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 255))}
                    placeholder={t('notesBlock.noteTitlePlaceholder')}
                    autoFocus
                    className="w-full border-2 border-[color-mix(in_srgb,var(--ring)_48%,var(--border))] bg-[var(--secondary)] rounded-lg pl-5 pr-16 py-2 focus:outline-none"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '28px',
                      letterSpacing: '0px',
                      leadingTrim: 'cap-height'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  />
                  <span className="absolute bottom-2 right-4 text-base text-[rgba(255,255,255,0.72)]">{title.length}/255</span>
                </div>
                <div className="relative w-full flex flex-col">
                  <textarea
                    maxLength={1000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                    placeholder={t('notesBlock.noteContentPlaceholder')}
                    className="w-full h-32 border-2 border-[color-mix(in_srgb,var(--ring)_48%,var(--border))] bg-[var(--secondary)] rounded-lg pl-5 pr-16 py-2 focus:outline-none resize-none break-words overflow-y-auto"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '16px',
                      lineHeight: '28px',
                      letterSpacing: '0px',
                      leadingTrim: 'cap-height'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  />
                  <span className="absolute bottom-2 right-4 -translate-y-1/2 text-base text-[rgba(255,255,255,0.72)]">{description.length}/1000</span>
                </div>
                <span
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
                  {t('notesBlock.attachments')}
                </span>
              </div>
              <div className="flex flex-col items-start gap-4 mt-5">
                <input
                  ref={noteFileInputRef}
                  type="file"
                  multiple
                  onChange={handleNoteFileSelect}
                  className="hidden"
                  accept="*/*"
                />
                
                {existingNoteFiles.length > 0 && (
                  <div className="w-full flex flex-col gap-2">
                    <p className="text-base text-[rgba(255,255,255,0.72)]">{t('notesBlock.existingFiles')}</p>
                    {existingNoteFiles.map((file, index) => {
                      const isDeleted = deletedFileIndexes.includes(index);
                      return (
                        <div 
                          key={index} 
                          className={`flex items-center justify-between rounded-[6px] p-3 border ${
                            isDeleted
                              ? 'bg-[var(--muted)] border-[var(--border)] opacity-50'
                              : 'bg-[var(--secondary)] border-[var(--border)]'
                          }`}
                        >
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
                              getFileIcon(file.mimeType)
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-base font-medium truncate ${isDeleted ? 'line-through text-[rgba(255,255,255,0.45)]' : 'text-[rgba(255,255,255,0.92)]'}`}>
                                {decodeFilename(file.originalName)}
                              </p>
                              <p className="text-base text-[rgba(255,255,255,0.72)]">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (editingNoteId) {
                                  handleDownloadNoteFile(editingNoteId, index, file.originalName);
                                }
                              }}
                              className="cursor-pointer"
                              title={t('notesBlock.download')}
                            >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 12L5 8h3V3h2v5h3l-4 4z" fill="currentColor"/>
                                <path d="M15 13v2H3v-2H1v2c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-2h-2z" fill="currentColor"/>
                </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (isDeleted) {
                                  // Восстанавливаем файл
                                  setDeletedFileIndexes(prev => prev.filter(i => i !== index));
                                } else {
                                  // Помечаем для удаления
                                  handleRemoveExistingFile(index);
                                }
                              }}
                              className="cursor-pointer"
                              title={isDeleted ? t('notesBlock.restore') : t('notesBlock.delete')}
                            >
                              <svg className="text-[var(--accent)]" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="currentColor"/>
                                <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="currentColor"/>
                                <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="currentColor"/>
                                <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="currentColor"/>
                              </svg>
                            </button>
              </div>
            </div>
                      );
                    })}
                  </div>
                )}
                
                <button 
                  type="button"
                  onClick={() => noteFileInputRef.current?.click()}
                  className="flex items-center py-2 px-3 rounded border border-dashed border-gray-300 cursor-pointer hover:border-[var(--ring)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--secondary))] transition-colors"
                >
                  <svg className="text-[rgba(255,255,255,0.72)] shrink-0" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="currentColor"/>
                  </svg>
                  <span
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
                    {t('notesBlock.attachFilesShort')}
                  </span>
                </button>
                
                {selectedNoteFiles.length > 0 && (
                  <div className="w-full flex flex-col gap-2">
                    <p className="text-base text-[rgba(255,255,255,0.72)]">{t('notesBlock.selectedFilesCount', { count: selectedNoteFiles.length })}</p>
                    {selectedNoteFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11 1H4a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V6l-6-5z" fill="#4B5563"/>
                            <path d="M11 1v5h5" fill="#9CA3AF"/>
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-medium text-[rgba(255,255,255,0.92)] truncate">{file.name}</p>
                            <p className="text-base text-[rgba(255,255,255,0.72)]">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveNoteFile(index)}
                          className="ml-2 p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title={t('notesBlock.delete')}
                        >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
                        </button>
            </div>
                    ))}
          </div>
                )}
              </div>
              <div className="flex justify-between gap-4 flex-wrap mt-5">
                <div className="flex flex-col items-start flex-1 gap-3">
                  <span 
                    className="text-[rgba(255,255,255,0.92)]"
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
                    {t('notesBlock.selectCategory')}
                  </span>
                  <div className="flex items-center gap-2 w-full relative">
                    <div 
                      ref={noteCategoryDropdownRef}
                      className="w-full relative"
                    >
                      <button
                        type="button"
                        onClick={() => setIsNoteCategoryDropdownOpen(!isNoteCategoryDropdownOpen)}
                        className="w-full rounded border-2 border-[var(--ring)] px-5 h-13 focus:outline-none text-[var(--accent)] flex items-center gap-3 justify-between"
                      >
                        <span 
                          className="truncate"
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
                          {selectedNoteCategory || t('notesBlock.selectCategory')}
                        </span>
                        <svg 
                          className={`w-5 h-5 transition-transform ${isNoteCategoryDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isNoteCategoryDropdownOpen && (
                        <div className="absolute bottom-14 z-50 w-full bg-white border-2 border-[var(--ring)] rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {noteCategoriesList.map((category) => (
                            <button
                              key={category.key}
                              type="button"
                              onClick={() => {
                                setSelectedNoteCategory(category.label);
                                setIsNoteCategoryDropdownOpen(false);
                              }}
                              className={`w-full px-5 py-3 text-left hover:bg-[var(--secondary)] transition-colors ${
                                selectedNoteCategory === category.label ? 'bg-[var(--secondary)]' : ''
                              }`}
                            >
                              <span>{category.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-start flex-1 gap-3">
                  <span 
                    className="text-[rgba(255,255,255,0.92)]"
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
                    {t('notesBlock.searchLeadLabel')}
                  </span>
                  <div className="flex items-center gap-2 w-full relative">
                    <div 
                      ref={noteClientDropdownRef}
                      className="w-full relative"
                    >
                      <input
                        placeholder={selectedNoteLeadId ? '' : t('notesBlock.searchLeadPlaceholder')}
                        className="w-full rounded border-2 border-[var(--ring)] px-5 pr-12 h-13 focus:outline-none text-[var(--accent)] placeholder:text-[rgba(255,255,255,0.55)]"
                        type="text"
                        value={selectedNoteLeadId && leadsMap.get(selectedNoteLeadId) ? leadsMap.get(selectedNoteLeadId)?.name || '' : noteClientSearch}
                        onChange={(e) => {
                          const value = e.target.value;
                          setNoteClientSearch(value);
                          setSelectedNoteLeadId('');
                          setIsNoteClientSearchOpen(value.length > 0);
                        }}
                        onFocus={(e) => {
                          // Если клиент уже выбран, очищаем поле для нового поиска
                          if (selectedNoteLeadId) {
                            setSelectedNoteLeadId('');
                            setNoteClientSearch('');
                            setIsNoteClientSearchOpen(false);
                            // Убираем выделение текста для удобства ввода
                            setTimeout(() => {
                              e.target.setSelectionRange(e.target.value.length, e.target.value.length);
                            }, 0);
                          } else if (noteClientSearch.length > 0) {
                            setIsNoteClientSearchOpen(true);
                          }
                        }}
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '18px',
                          lineHeight: '100%',
                          letterSpacing: '0px',
                          leadingTrim: 'cap-height'
                        } as React.CSSProperties & { leadingTrim?: string }}
                      />
                      {selectedNoteLeadId && (
                        <svg 
                          className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 cursor-pointer"
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNoteLeadId('');
                            setNoteClientSearch('');
                          }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      
                      {/* Выпадающий список результатов поиска */}
                      {isNoteClientSearchOpen && !selectedNoteLeadId && noteClientSearch && (() => {
                        const filteredLeads = Array.from(leadsMap.values()).filter(lead => 
                          lead.name?.toLowerCase().includes(noteClientSearch.toLowerCase()) ||
                          lead.phone?.includes(noteClientSearch)
                        );
                        return filteredLeads.length > 0 && (
                          <div className="absolute bottom-full mb-2 w-full bg-white border-2 border-[var(--ring)] rounded-lg shadow-lg max-h-60 overflow-y-auto z-50">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNoteLeadId('');
                                setNoteClientSearch('');
                                setIsNoteClientSearchOpen(false);
                              }}
                              className="w-full px-5 py-3 text-left hover:bg-[var(--secondary)] transition-colors"
                            >
                              <span>{t('notesBlock.withoutClient')}</span>
                            </button>
                            {filteredLeads.slice(0, 10).map((lead) => (
                              <button
                                key={lead._id}
                                type="button"
                                onClick={() => {
                                  setSelectedNoteLeadId(lead._id);
                                  setNoteClientSearch(lead.name);
                                  setIsNoteClientSearchOpen(false);
                                }}
                                className="w-full px-5 py-3 text-left hover:bg-[var(--secondary)] transition-colors border-b border-gray-100 last:border-b-0"
                              >
                                <div className="font-normal text-[var(--accent)]">{lead.name}</div>
                                {lead.phone && <div className="text-base text-[rgba(255,255,255,0.72)]">{lead.phone}</div>}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-center pt-4 pb-2 mt-4">
                <button
                  onClick={editingNoteId ? handleUpdateNote : handleSaveNote}
                  disabled={!title.trim() || !selectedNoteCategory.trim() || (editingNoteId && !hasChanges()) || isSaving}
                  className="bg-[var(--primary)] text-[var(--primary-foreground)] rounded py-3 px-25 cursor-pointer text-lg font-normal disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  title={!selectedNoteCategory.trim() ? t('notesBlock.pleaseSelectNoteCategory') : ''}
                >
                  {isSaving ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>{t('notesBlock.saving')}</span>
                    </>
                  ) : (
                    <span>{editingNoteId ? t('notesBlock.saveNote') : t('notesBlock.addNote')}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isNewNoteClientModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsNewNoteClientModalOpen(false)}>
          <div className="relative flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-[var(--accent)] text-lg font-normal">{t('notesBlock.newClient')}</span>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full max-w-md">
                <div className="relative w-full mb-6">
                  <input
                    type="text"
                    placeholder={t('notesBlock.fullName')}
                    value={newNoteClientName}
                    onChange={(e) => setNewNoteClientName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const name = newNoteClientName.trim();
                        if (!name) return;
                        // TODO: Реализовать добавление нового клиента через API
                        setNewNoteClientName('');
                        setIsNewNoteClientModalOpen(false);
                      }
                    }}
                    className="w-full border-2 border-[var(--ring)] bg-[var(--secondary)] rounded pl-5 pr-5 py-3 focus:outline-none text-lg"
                  />
                </div>
                <button
                  onClick={() => {
                    const name = newNoteClientName.trim();
                    if (!name) return;
                    // Удалено: теперь используем лиды из бэкенда
                    setNewNoteClientName('');
                    setIsNewNoteClientModalOpen(false);
                  }}
                  className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] rounded py-3 px-5 hover:opacity-90 transition-colors text-lg font-normal"
                >
                  {t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isViewNoteModalOpen && viewingNote && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-[70] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={handleCloseViewModal}>
          <div 
            className="relative flex flex-col bg-white md:pb-0 rounded-t-lg md:rounded-lg shadow-2xl w-full md:w-[85%] md:max-w-[1200px] h-[85vh] md:h-[90.89vh] max-h-[85vh] md:max-h-[90.89vh]" 
            onClick={(e) => e.stopPropagation()}
          >

            <div className="flex-1 flex flex-col p-5 gap-5 overflow-y-auto pb-20 md:pb-5 min-h-0">
              <div className="flex items-center gap-2 justify-center pt-2.5 pb-5">
                <svg className="text-[var(--accent)]" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.7107 1.92375H17.3342V0.976562C17.3342 0.437164 16.897 0 16.3576 0H8.675C8.1356 0 7.69844 0.437164 7.69844 0.976562V1.92375H5.32227C3.97606 1.92375 2.88086 3.01895 2.88086 4.36516V22.5586C2.88086 23.9048 3.97606 25 5.32227 25H19.7107C21.0569 25 22.1521 23.9048 22.1521 22.5586V4.36516C22.1521 3.01895 21.0567 1.92375 19.7107 1.92375ZM15.3811 1.95312V3.84769H9.65137C9.65137 3.19862 9.65137 2.66247 9.65137 1.95312H15.3811ZM20.199 22.5586C20.199 22.8279 19.9799 23.0469 19.7107 23.0469H5.32227C5.05295 23.0469 4.83398 22.8279 4.83398 22.5586V4.36516C4.83398 4.09603 5.05295 3.87688 5.32227 3.87688H7.69825V4.82426C7.69825 5.36366 8.1356 5.80082 8.67481 5.80082H16.3576C16.8968 5.80082 17.3342 5.36366 17.3342 4.82426V3.87688H19.7107C19.9799 3.87688 20.199 4.09603 20.199 4.36516V22.5586ZM17.0479 11.4023C17.4294 11.7838 17.4294 12.4022 17.0479 12.7834L11.916 17.9153C11.5347 18.2968 10.9163 18.2968 10.5349 17.9153L7.98454 15.365C7.60326 14.9837 7.60326 14.3654 7.98454 13.9839C8.36601 13.6026 8.98418 13.6026 9.36565 13.9839L11.2255 15.8438L15.6668 11.4025C16.0482 11.021 16.6664 11.021 17.0479 11.4023Z" fill="currentColor"/>
                </svg>

                <span 
                  className='text-[var(--accent)]'
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 400,
                    fontStyle: 'normal',
                    fontSize: '24px',
                    lineHeight: '150%',
                    letterSpacing: '-0.01em',
                    leadingTrim: 'cap-height'
                  } as React.CSSProperties & { leadingTrim?: string }}
                >
                  {t('notesBlock.viewNote')}
                </span>
              </div>
              <button onClick={handleCloseViewModal} aria-label={t('notesBlock.close')} className='absolute -right-6 -top-6 cursor-pointer'>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
              <div className="relative w-full p-3.5 bg-[var(--secondary)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.1)] rounded-lg flex flex-col text-[rgba(255,255,255,0.92)] gap-3 max-w-full">
                <div className="flex flex-col gap-2 min-w-0 flex-shrink-0">
                  <div className="flex items-center justify-between gap-2 min-h-7">
                    <span
                      className="text-[rgba(255,255,255,0.92)] font-normal flex-shrink-0"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontSize: '18px',
                        lineHeight: '24px',
                        color: 'rgba(255,255,255,0.92)',
                      }}
                    >
                      {t('notesBlock.titleLabel')}
                    </span>
                    {!isEditingViewTitle && (
                      <button
                        type="button"
                        onClick={handleStartEditViewTitle}
                        className="shrink-0 text-base font-medium text-[var(--accent)] hover:underline"
                      >
                        {t('common.edit')}
                      </button>
                    )}
                  </div>
                  {isEditingViewTitle ? (
                    <div className="flex flex-col gap-2 min-w-0">
                      <input
                        type="text"
                        value={viewNoteTitle}
                        onChange={(e) => setViewNoteTitle(e.target.value)}
                        disabled={isUpdatingViewTitle}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-medium text-[rgba(255,255,255,0.92)] focus:border-[var(--ring)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] disabled:opacity-60"
                        style={{ fontFamily: 'var(--font-sans)' }}
                        placeholder={t('notesBlock.noteName')}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveViewTitle}
                          disabled={isUpdatingViewTitle}
                          className="rounded bg-[var(--primary)] px-4 py-1.5 text-base font-normal text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                        >
                          {isUpdatingViewTitle ? t('notesBlock.saving') : t('notesBlock.save')}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditViewTitle}
                          disabled={isUpdatingViewTitle}
                          className="rounded border border-[var(--border)] px-4 py-1.5 text-base font-medium text-[rgba(255,255,255,0.92)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] disabled:opacity-50"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-0">
                      <span
                        className="text-[rgba(255,255,255,0.92)] font-normal break-words overflow-wrap-anywhere block"
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '20px',
                          letterSpacing: '0px',
                          leadingTrim: 'cap-height',
                          wordBreak: 'break-word',
                          overflowWrap: 'break-word',
                          maxWidth: '100%',
                          color: 'rgba(255,255,255,0.92)',
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {viewNoteTitle.trim() ? viewNoteTitle : <span className="text-[rgba(255,255,255,0.72)] font-normal">{t('notesBlock.untitled')}</span>}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 min-w-0 flex-shrink-0">
                  <div className="flex items-center justify-between gap-2 min-h-7">
                    <span
                      className="text-[rgba(255,255,255,0.92)] font-normal flex-shrink-0"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontSize: '18px',
                        lineHeight: '24px',
                        color: 'rgba(255,255,255,0.92)',
                      }}
                    >
                      {t('notesBlock.descriptionLabel')}
                    </span>
                    {!isEditingViewDescription && (
                      <button
                        type="button"
                        onClick={handleStartEditViewDescription}
                        className="shrink-0 text-base font-medium text-[var(--accent)] hover:underline"
                      >
                        {t('common.edit')}
                      </button>
                    )}
                  </div>
                  {isEditingViewDescription ? (
                    <div className="flex flex-col gap-2 min-w-0">
                      <textarea
                        value={viewNoteDescription}
                        onChange={(e) => setViewNoteDescription(e.target.value)}
                        disabled={isUpdatingViewDescription}
                        rows={6}
                        className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-base font-medium text-[rgba(255,255,255,0.92)] focus:border-[var(--ring)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] disabled:opacity-60"
                        style={{ fontFamily: 'var(--font-sans)' }}
                        placeholder={t('notesBlock.noteText')}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveViewDescription}
                          disabled={isUpdatingViewDescription}
                          className="rounded bg-[var(--primary)] px-4 py-1.5 text-base font-normal text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                        >
                          {isUpdatingViewDescription ? t('notesBlock.saving') : t('notesBlock.save')}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditViewDescription}
                          disabled={isUpdatingViewDescription}
                          className="rounded border border-[var(--border)] px-4 py-1.5 text-base font-medium text-[rgba(255,255,255,0.92)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] disabled:opacity-50"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-0">
                      <span
                        className="text-[rgba(255,255,255,0.92)] font-normal break-words overflow-wrap-anywhere whitespace-pre-wrap block"
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '20px',
                          letterSpacing: '0px',
                          leadingTrim: 'cap-height',
                          wordBreak: 'break-word',
                          overflowWrap: 'break-word',
                          maxWidth: '100%',
                          color: 'rgba(255,255,255,0.92)',
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {viewNoteDescription.trim() ? (
                          viewNoteDescription
                        ) : (
                          <span className="text-[rgba(255,255,255,0.72)] font-normal">{t('notesBlock.noText')}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-start gap-3.5">
                <span 
                  className="text-[rgba(255,255,255,0.92)] mt-2.5"
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
                  {t('notesBlock.attachments')}
                </span>
                
                {viewNoteFiles.length > 0 ? (
                  <div className="w-full flex flex-col gap-2">
                    {viewNoteFiles.map((file, index) => (
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
                            getFileIcon(file.mimeType)
                          )}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-base font-medium truncate text-[rgba(255,255,255,0.92)]">{decodeFilename(file.originalName)}</span>
                            <span className="text-base text-[rgba(255,255,255,0.72)]">{formatFileSize(file.size)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (viewingNote?._id) {
                                handleDownloadNoteFile(viewingNote._id, index, file.originalName);
                              }
                            }}
                            className="cursor-pointer"
                            title={t('notesBlock.download')}
                          >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M9 12L5 8h3V3h2v5h3l-4 4z" fill="currentColor"/>
                              <path d="M15 13v2H3v-2H1v2c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-2h-2z" fill="currentColor"/>
                </svg>
                          </button>
              </div>
            </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-base text-[rgba(255,255,255,0.72)]">{t('notesBlock.noAttachedFiles')}</div>
                )}
                
                <input
                  ref={viewNoteFileInputRef}
                  type="file"
                  multiple
                  onChange={handleViewNoteFileSelect}
                  className="hidden"
                  accept="*/*"
                />
                
                <button 
                  onClick={() => viewNoteFileInputRef.current?.click()}
                  disabled={isUploadingViewFiles || !viewingNote?._id}
                  className="flex items-center py-2 px-3 rounded-[4px] border border-dashed border-[var(--border)] cursor-pointer hover:bg-[var(--secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploadingViewFiles ? (
                    <>
                      <svg className="animate-spin h-5 w-5 mr-2 text-[var(--accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
                      <span>{t('notesBlock.loading')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="text-[rgba(255,255,255,0.72)] shrink-0" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="currentColor"/>
                      </svg>
                      <span>{t('notesBlock.attachFilesLabel')}</span>
                    </>
                  )}
                </button>
            </div>

              <div className='flex items-center justify-between py-3'>
                
                  {(() => {
                    const currentCategoryId = viewingNote.category;
                    const categoryName = getCategoryName(currentCategoryId);
                    
                    return categoryName ? (
                    <button
                      onClick={() => setIsViewCategoryPickerOpen(!isViewCategoryPickerOpen)}
                      className="relative flex items-center rounded bg-[var(--secondary)] text-[var(--accent)] h-9 px-3 hover:bg-[var(--secondary)]/80 transition-colors cursor-pointer"
                    >
                      <span 
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 500,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '24px',
                          letterSpacing: '0px',
                          leadingTrim: 'none'
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {categoryName}
                      </span>
                      <svg 
                        className={`w-4 h-4 ml-2 transition-transform ${isViewCategoryPickerOpen ? 'rotate-180' : ''}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {isViewCategoryPickerOpen && (
                        <div className="absolute bottom-12 z-50 left-0 bg-white border-2 border-[var(--ring)] rounded-md shadow-lg min-w-max">
                          {noteCategoriesList.map((category) => (
                            <button
                              key={category.key}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateViewCategory(category.label);
                              }}
                              className={`w-full px-5 py-3 text-left hover:bg-[var(--secondary)] transition-colors whitespace-nowrap ${
                                categoryName === category.label ? 'bg-[var(--secondary)]' : ''
                              }`}
                            >
                              <span
                                style={{
                                  fontFamily: 'var(--font-sans)',
                                  fontWeight: 500,
                                  fontStyle: 'normal',
                                  fontSize: '16px',
                                  lineHeight: '24px',
                                  color: categoryName === category.label ? 'var(--accent)' : 'rgba(255,255,255,0.72)'
                                } as React.CSSProperties}
                              >
                                {category.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </button>
                  ) : null;
                  })()}
                  
                {(() => {
                  const leadId = viewingNote?.leadId;
                  const leadName = getLeadName(leadId);
                  return leadName ? (
                    <div className="flex items-center gap-2">
                      <div className="size-9 rounded overflow-hidden bg-gray-200 flex items-center justify-center">
                        <span className="text-base font-normal text-[rgba(255,255,255,0.92)]">{leadName.charAt(0).toUpperCase()}</span>
                      </div>
                      <span
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 500,
                          fontStyle: 'normal',
                          fontSize: '16px',
                          lineHeight: '24px',
                          letterSpacing: '0px',
                          leadingTrim: 'none'
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {leadName}
                      </span>
                    </div>
                  ) : null;
                })()}
               
                
                <div className='flex items-center gap-2.5'>
                <Tooltip text={t('notesBlock.convertToTaskAction')}>
                  <button 
                    type="button"
                    onClick={() => {
                      setIsConvertToTaskModalOpen(true);
                    }}
                    className='flex items-center gap-2.5 p-1.75 rounded-lg bg-[var(--primary)] cursor-pointer'
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="white"/>
                    </svg>
                    <span 
                      className='text-white'
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
                      {t('notesBlock.turnInto')}
                    </span>
                  </button>
                </Tooltip>
                <Tooltip text={t('notesBlock.edit')}>
                  <button 
                    type="button"
                    onClick={() => {
                        if (viewingNote) {
                          handleCloseViewModal();
                          handleOpenEditNote(viewingNote);
                        }
                    }}
                    className='flex items-center justify-center p-2 rounded-lg bg-[var(--secondary)] cursor-pointer'
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g clipPath="url(#clip0_4711_65294)">
                        <path d="M18.9999 12.0469C18.447 12.0469 18 12.495 18 13.0469V21.0469C18 21.5979 17.5519 22.0469 17.0001 22.0469H3C2.44794 22.0469 2.00006 21.5979 2.00006 21.0469V7.04688C2.00006 6.49591 2.44794 6.04694 3 6.04694H11.0001C11.553 6.04694 12 5.59888 12 5.047C12 4.49493 11.553 4.04688 11.0001 4.04688H3C1.34601 4.04688 0 5.39288 0 7.04688V21.0469C0 22.7009 1.34601 24.0469 3 24.0469H17.0001C18.6541 24.0469 20.0001 22.7009 20.0001 21.0469V13.0469C20.0001 12.4939 19.5529 12.0469 18.9999 12.0469Z" fill="currentColor"/>
                        <path d="M9.37515 11.1346C9.3052 11.2046 9.25815 11.2936 9.23819 11.3895L8.53122 14.9257C8.49826 15.0895 8.55026 15.2585 8.66818 15.3776C8.76321 15.4726 8.8912 15.5235 9.02231 15.5235C9.05417 15.5235 9.08731 15.5206 9.12027 15.5136L12.6553 14.8066C12.7533 14.7865 12.8423 14.7396 12.9113 14.6695L20.8233 6.75751L17.2882 3.22266L9.37515 11.1346Z" fill="currentColor"/>
                        <path d="M23.2686 0.778152C22.2937 -0.196884 20.7076 -0.196884 19.7335 0.778152L18.3496 2.16206L21.8846 5.6971L23.2686 4.313C23.7406 3.84206 24.0006 3.214 24.0006 2.54604C24.0006 1.87807 23.7406 1.25002 23.2686 0.778152Z" fill="currentColor"/>
                      </g>
                      <defs>
                        <clipPath id="clip0_4711_65294">
                          <rect width="24" height="24" fill="white"/>
                        </clipPath>
                      </defs>
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip text={t('notesBlock.delete')}>
                  <button 
                    type="button"
                    onClick={() => {
                      setNoteToDelete(viewingNote);
                      setIsDeleteNoteConfirmModalOpen(true);
                    }}
                    className='flex items-center justify-center p-2 rounded-lg bg-[var(--secondary)] cursor-pointer'
                  >
                    <svg className="text-[var(--accent)]" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="currentColor"/>
                      <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="currentColor"/>
                      <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="currentColor"/>
                      <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="currentColor"/>
                    </svg>
                  </button>
                </Tooltip>
                </div>    
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isConvertToTaskModalOpen && viewingNote && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[80] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsConvertToTaskModalOpen(false)}>
          <div 
            className="bg-white rounded-lg p-6 md:p-8 shadow-2xl w-full md:w-auto max-w-xl mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <h2 
              className="text-center mb-6"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: '22px',
                lineHeight: '100%',
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              {t('notesBlock.convertTitle')}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Стандартная задача */}
              <button
                type="button"
                onClick={() => {
                  if (onOpenNewTaskModalFromNote && viewingNote) {
                    const leadId = getLeadId(viewingNote.leadId);
                    onOpenNewTaskModalFromNote({
                      title: viewingNote.title || '',
                      description: viewingNote.content || '',
                      leadId: leadId && leadId.trim() ? leadId : undefined,
                      taskType: 'standard',
                      noteId: viewingNote._id,
                      files: viewingNote.files || [],
                    });
                    setIsConvertToTaskModalOpen(false);
                    setIsViewNoteModalOpen(false);
                  } else {
                    console.warn('[NotesBlock] onOpenNewTaskModalFromNote не передана или viewingNote отсутствует');
                  }
                }}
                className="flex flex-col items-center gap-2 p-5 rounded-[6px] bg-[var(--secondary)] border border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] transition-all cursor-pointer"
              >
                <div className="w-12 h-12 flex items-center justify-center bg-[var(--muted)] rounded-[4px]">
                  <svg width="24" height="24" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19.7107 1.92375H17.3342V0.976562C17.3342 0.437164 16.897 0 16.3576 0H8.675C8.1356 0 7.69844 0.437164 7.69844 0.976562V1.92375H5.32227C3.97606 1.92375 2.88086 3.01895 2.88086 4.36516V22.5586C2.88086 23.9048 3.97606 25 5.32227 25H19.7107C21.0569 25 22.1521 23.9048 22.1521 22.5586V4.36516C22.1521 3.01895 21.0567 1.92375 19.7107 1.92375ZM15.3811 1.95312V3.84769H9.65137C9.65137 3.19862 9.65137 2.66247 9.65137 1.95312H15.3811ZM20.199 22.5586C20.199 22.8279 19.9799 23.0469 19.7107 23.0469H5.32227C5.05295 23.0469 4.83398 22.8279 4.83398 22.5586V4.36516C4.83398 4.09603 5.05295 3.87688 5.32227 3.87688H7.69825V4.82426C7.69825 5.36366 8.1356 5.80082 8.67481 5.80082H16.3576C16.8968 5.80082 17.3342 5.36366 17.3342 4.82426V3.87688H19.7107C19.9799 3.87688 20.199 4.09603 20.199 4.36516V22.5586ZM17.0479 11.4023C17.4294 11.7838 17.4294 12.4022 17.0479 12.7834L11.916 17.9153C11.5347 18.2968 10.9163 18.2968 10.5349 17.9153L7.98454 15.365C7.60326 14.9837 7.60326 14.3654 7.98454 13.9839C8.36601 13.6026 8.98418 13.6026 9.36565 13.9839L11.2255 15.8438L15.6668 11.4025C16.0482 11.021 16.6664 11.021 17.0479 11.4023Z" fill="var(--accent)"/>
                  </svg>
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 400,
                    fontSize: '15px',
                    lineHeight: '100%',
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  {t('notesBlock.standardTask')}
                </span>
              </button>

              {/* Звонок */}
              <button
                type="button"
                onClick={() => {
                  if (onOpenNewTaskModalFromNote && viewingNote) {
                    const leadId = getLeadId(viewingNote.leadId);
                    onOpenNewTaskModalFromNote({
                      title: viewingNote.title || '',
                      description: viewingNote.content || '',
                      leadId: leadId && leadId.trim() ? leadId : undefined,
                      taskType: 'call',
                      noteId: viewingNote._id,
                      files: viewingNote.files || [],
                    });
                    setIsConvertToTaskModalOpen(false);
                    setIsViewNoteModalOpen(false);
                  }
                }}
                className="flex flex-col items-center gap-2 p-5 rounded-[6px] bg-[var(--secondary)] border border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] transition-all cursor-pointer"
              >
                <div className="w-12 h-12 flex items-center justify-center bg-[var(--muted)] rounded-[4px]">
                  <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M28.4 22.8L23.2 20.4C22.8 20.2 22.4 20.4 22 20.6L19.2 22.8C18.8 23 18.2 22.8 17.8 22.6C15.4 21.4 13.2 19.2 12 16.8C11.8 16.4 11.6 15.8 11.8 15.4L14 12.6C14.2 12.2 14.4 11.8 14.2 11.4L11.8 6.2C11.6 5.6 11 5.4 10.4 5.6L5.6 7.2C5 7.4 4.6 8 4.6 8.6C4.6 18.2 12.4 26 22 26C22.6 26 23.2 25.6 23.4 25L25 20.2C25.2 19.6 25 19 24.4 18.8L28.4 22.8Z" fill="var(--accent)"/>
                  </svg>
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 400,
                    fontSize: '15px',
                    lineHeight: '100%',
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  {t('notesBlock.callTask')}
                </span>
              </button>

              {/* Встреча */}
              <button
                type="button"
                onClick={() => {
                  if (onOpenNewTaskModalFromNote && viewingNote) {
                    const leadId = getLeadId(viewingNote.leadId);
                    onOpenNewTaskModalFromNote({
                      title: viewingNote.title || '',
                      description: viewingNote.content || '',
                      leadId: leadId && leadId.trim() ? leadId : undefined,
                      taskType: 'meeting',
                      noteId: viewingNote._id,
                      files: viewingNote.files || [],
                    });
                    setIsConvertToTaskModalOpen(false);
                    setIsViewNoteModalOpen(false);
                  }
                }}
                className="flex flex-col items-center gap-2 p-5 rounded-[6px] bg-[var(--secondary)] border border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] transition-all cursor-pointer"
              >
                <div className="w-12 h-12 flex items-center justify-center bg-[var(--muted)] rounded-[4px]">
                  <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M26 6H24V4C24 3.4 23.6 3 23 3C22.4 3 22 3.4 22 4V6H10V4C10 3.4 9.6 3 9 3C8.4 3 8 3.4 8 4V6H6C4.9 6 4 6.9 4 8V26C4 27.1 4.9 28 6 28H26C27.1 28 28 27.1 28 26V8C28 6.9 27.1 6 26 6ZM26 26H6V12H26V26Z" fill="var(--accent)"/>
                  </svg>
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 400,
                    fontSize: '15px',
                    lineHeight: '100%',
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  {t('notesBlock.meetingTask')}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      
      {isDeleteNoteConfirmModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[80] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsDeleteNoteConfirmModalOpen(false)}>
          
          <div 
            className="relative flex flex-col bg-white rounded-lg shadow-2xl max-w-xl w-full" 
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setIsDeleteNoteConfirmModalOpen(false)} aria-label={t('notesBlock.close')} className='cursor-pointer 
              absolute -top-5 -right-6' >
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              
              <div className="w-full flex flex-col gap-5">
                <span className='text-[var(--accent)] text-nowrap font-normal text-[20px] leading-[100%] tracking-[0px]'>
                  {t('notesBlock.deleteNoteTitle')}
                </span>
                <p className="text-[rgba(255,255,255,0.72)] font-normal text-base leading-[20px] tracking-[0px] text-center mb-6">
                  {t('notesBlock.deleteNoteMessage')}
                </p>
                <div className="flex gap-4 justify-center">
                  <button
                      onClick={handleDeleteNote}
                      className="bg-[var(--primary)] text-[var(--primary-foreground)] rounded py-3 px-7.5 cursor-pointer"
                    >
                      <span className='text-white font-normal text-[16px] leading-[100%] tracking-[0px] text-center'>
                        {t('notesBlock.deleteYes')}
                      </span>
                  </button>
                  <button
                    onClick={() => {
                      setIsDeleteNoteConfirmModalOpen(false);
                      setNoteToDelete(null);
                    }}
                    className="bg-white border-2 border-[var(--ring)] rounded py-3 px-10.5 cursor-pointer"
                  >
                    <span className='text-[var(--accent)] font-normal text-[16px] leading-[100%] tracking-[0px] text-center'>
                      {t('common.cancel')}
                    </span>
                  </button>
            </div>
          </div>
        </div>
      </div>
        </div>
      )}

      {isViewCategoryModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsViewCategoryModalOpen(false)}>
          <div 
            className="relative flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-[var(--accent)] text-lg font-normal">{t('notesBlock.addCategory')}</span>
              <button onClick={() => setIsViewCategoryModalOpen(false)} aria-label={t('notesBlock.close')}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full max-w-md">
                <div className="relative w-full mb-6">
                  <input
                    type="text"
                    placeholder={t('notesBlock.categoryName')}
                    value={newViewCategoryName}
                    onChange={(e) => setNewViewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddViewCategory();
                      }
                    }}
                    className="w-full border-2 border-[var(--ring)] bg-[var(--secondary)] rounded pl-5 pr-5 py-3 focus:outline-none text-lg"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleAddViewCategory}
                  className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] rounded py-3 px-5 hover:opacity-90 transition-colors text-lg font-normal"
                >
                  {t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isViewClientModalOpen && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsViewClientModalOpen(false)}>
          <div 
            className="relative flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
              <span className="text-[var(--accent)] text-lg font-normal">{t('notesBlock.newClient')}</span>
              <button onClick={() => setIsViewClientModalOpen(false)} aria-label={t('notesBlock.close')}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.5 7.5L7.5 22.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M7.5 7.5L22.5 22.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full max-w-md">
                <div className="relative w-full mb-6">
                  <input
                    type="text"
                    placeholder={t('notesBlock.fullName')}
                    value={newViewClientName}
                    onChange={(e) => setNewViewClientName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddViewClient();
                      }
                    }}
                    className="w-full border-2 border-[var(--ring)] bg-[var(--secondary)] rounded pl-5 pr-5 py-3 focus:outline-none text-lg"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleAddViewClient}
                  className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] rounded py-3 px-5 hover:opacity-90 transition-colors text-lg font-normal"
                >
                  {t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isDeleteViewFileConfirmModalOpen && fileToDelete && (
        <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={() => setIsDeleteViewFileConfirmModalOpen(false)}>
          <div 
            className="relative flex flex-col bg-white rounded-lg shadow-2xl max-w-xl w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setIsDeleteViewFileConfirmModalOpen(false)} aria-label={t('notesBlock.close')} className='cursor-pointer absolute -top-5 -right-6'>
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.5 7.5L7.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                <path d="M7.5 7.5L22.5 22.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
              <div className="w-full flex flex-col gap-5">
                <span className='text-[var(--accent)] text-nowrap font-normal text-[20px] leading-[100%] tracking-[0px]'>
                  {t('notesBlock.deleteFileTitle')}
                </span>
                <p className="text-[rgba(255,255,255,0.72)] font-normal text-base leading-[20px] tracking-[0px] text-center mb-6">
                  {t('notesBlock.deleteFileMessage').replace('{value}', decodeFilename(fileToDelete.file.originalName))}
                </p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={handleDeleteViewFile}
                    className="bg-[var(--primary)] text-[var(--primary-foreground)] rounded py-3 px-7.5 cursor-pointer"
                  >
                    <span className='text-white font-normal text-[16px] leading-[100%] tracking-[0px] text-center'>
                      {t('crm.crm.notesBlock.да_удалить')}</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsDeleteViewFileConfirmModalOpen(false);
                      setFileToDelete(null);
                    }}
                    className="bg-white border-2 border-[var(--ring)] rounded py-3 px-10.5 cursor-pointer"
                  >
                    <span className='text-[var(--accent)] font-normal text-[16px] leading-[100%] tracking-[0px] text-center'>
                      {t('common.cancel')}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
        </>,
        document.body
      )}
    </div>
  );
};

export default NotesBlock;
