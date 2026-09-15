import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type LeadFile, type LibraryFolder, ProductType } from '../../services/api';
import { libraryCrmService } from '../../services/libraryCrmV2';
import { findRejectedUpload, UPLOAD_ACCEPT } from '@/lib/open-signed-file';
import { useToast } from '../common/Toast';
import { useI18n } from '@/i18n';
import { DeleteConfirmModal } from './modals/DeleteConfirmModal';
import { 
  FileText, 
  Image as ImageIcon, 
  File, 
  Music, 
  Video, 
  Archive, 
  FileSpreadsheet,
  Folder,
  FolderPlus,
  Download,
  Trash2,
  Upload,
} from 'lucide-react';

interface LibrarySelectorBlockProps {
  productType?: ProductType;
  onModalOpen?: () => void;
}

const LibrarySelectorBlock: React.FC<LibrarySelectorBlockProps> = ({ productType: initialProductType = ProductType.SALES, onModalOpen }) => {
  const { t } = useI18n();
  const { showToast, ToastContainer } = useToast();
  const [selectedProductType, setSelectedProductType] = useState<ProductType>(initialProductType);

  // Синхронизация с пропсом productType при его изменении
  useEffect(() => {
    setSelectedProductType(initialProductType);
  }, [initialProductType]);

  const getProductTypeLabel = (type: ProductType): string => {
    switch (type) {
      case ProductType.SALES: return 'Продажи';
      case ProductType.NETWORK: return 'Сеть';
      case ProductType.OWNER: return 'Собственник';
      case ProductType.AGENT: return 'Посредник';
      default: return 'Продажи';
    }
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'common' | 'library'>('common');

  // Состояния для общей библиотеки (базовые файлы)
  const [baseFiles, setBaseFiles] = useState<Array<LeadFile & { _id?: string }>>([]);
  const [isLoadingBaseFiles, setIsLoadingBaseFiles] = useState(false);
  // Может ли сотрудник добавлять и удалять общие материалы (решает сервер по правам).
  const [canUploadCommon, setCanUploadCommon] = useState(false);
  const commonFileInputRef = useRef<HTMLInputElement>(null);

  // Состояния для личной библиотеки (библиотека риелтора)
  const [libraryFiles, setLibraryFiles] = useState<Array<LeadFile & { _id?: string }>>([]);
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>([]);
  const [isLoadingLibraryFiles, setIsLoadingLibraryFiles] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<LibraryFolder[]>([]); // Для навигации

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingLibraryFiles, setIsUploadingLibraryFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showCreateFolderInput, setShowCreateFolderInput] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<{ isOpen: boolean; file: LeadFile & { _id?: string } | null }>({ isOpen: false, file: null });
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<{ isOpen: boolean; folder: LibraryFolder | null }>({ isOpen: false, folder: null });

  // Загрузка базовых файлов
  const loadBaseFiles = useCallback(async () => {
    setIsLoadingBaseFiles(true);
    try {
      const response = await libraryCrmService.getBaseFiles(selectedProductType);
      if (response.success && response.data) {
        setBaseFiles(response.data.files);
        setCanUploadCommon(response.data.canUpload);
      } else {
        console.error('Failed to load base files:', response.message);
        setBaseFiles([]);
        setCanUploadCommon(false);
      }
    } catch (error) {
      console.error('Failed to load base files:', error);
      setBaseFiles([]);
      setCanUploadCommon(false);
    } finally {
      setIsLoadingBaseFiles(false);
    }
  }, [selectedProductType]);

  // Загрузка файлов библиотеки риелтора
  const loadLibraryFiles = useCallback(async (folderId?: string | null) => {
    setIsLoadingLibraryFiles(true);
    try {
      const response = await libraryCrmService.getRealtorLibraryFiles(folderId || null, true);
      if (response.success && response.data) {
        const files = response.data.files || [];
        const folders = response.data.folders || [];
        setLibraryFiles(files);
        setLibraryFolders(folders);
      } else {
        console.error('Failed to load library files:', response.message);
        setLibraryFiles([]);
        setLibraryFolders([]);
      }
    } catch (error) {
      console.error('Failed to load library files:', error);
      setLibraryFiles([]);
      setLibraryFolders([]);
    } finally {
      setIsLoadingLibraryFiles(false);
    }
  }, []);

  // Загрузка файлов в библиотеку
  const handleUploadLibraryFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setIsUploadingLibraryFiles(true);
    setUploadError(null);

    try {
      const filesArray = Array.from(selectedFiles);

      const MAX_FILES_PER_UPLOAD = 10;

      // Проверка количества файлов
      if (filesArray.length > MAX_FILES_PER_UPLOAD) {
        setUploadError(`Можно загрузить максимум ${MAX_FILES_PER_UPLOAD} файлов за раз`);
        setIsUploadingLibraryFiles(false);
        return;
      }

      const rejected = findRejectedUpload(filesArray);
      if (rejected) {
        setUploadError(t('leadCard.fileTooLarge', { name: rejected.name }));
        setIsUploadingLibraryFiles(false);
        return;
      }

      const toCommon = selectedCategory === 'common';
      const response = toCommon
        ? await libraryCrmService.uploadBaseFiles(filesArray, selectedProductType)
        : await libraryCrmService.uploadLibraryFiles(filesArray, currentFolderId);

      if (response.success) {
        if (toCommon) {
          await loadBaseFiles();
        } else {
          await loadLibraryFiles(currentFolderId);
        }
      } else {
        setUploadError(response.message || 'Ошибка при загрузке файлов в библиотеку');
      }
    } catch (error: any) {
      console.error('Failed to upload library files:', error);
      setUploadError(error.response?.data?.message || 'Ошибка при загрузке файлов в библиотеку');
    } finally {
      setIsUploadingLibraryFiles(false);
      event.target.value = '';
    }
  };

  // Загрузка файлов при открытии модалки или изменении selectedProductType или папки
  useEffect(() => {
    if (isModalOpen) {
      loadBaseFiles();
      loadLibraryFiles(currentFolderId);
    } else {
      setBaseFiles([]);
      setLibraryFiles([]);
      setLibraryFolders([]);
      setUploadError(null);
      setSelectedCategory('common');
      setCurrentFolderId(null);
      setFolderPath([]);
    }
  }, [isModalOpen, selectedProductType, currentFolderId, loadBaseFiles, loadLibraryFiles]);

  const decodeFilename = (name?: string): string => {
    if (!name) return 'Без названия';
    try {
      return decodeURIComponent(escape(name)) || name;
    } catch {
      return name;
    }
  };

  const handleDownloadFile = useCallback((file: LeadFile & { _id?: string }) => {
    if (!file._id) return;
    void libraryCrmService.openLibraryFile({ ...file, _id: file._id }).catch((error: unknown) => {
      console.error('Failed to open library file:', error);
      showToast(t('crmLibrary.openFailed'), 'error');
    });
  }, [showToast, t]);

  const handleDeleteFileClick = useCallback((file: LeadFile & { _id?: string }) => {
    if (!file._id && !file.filename) return;
    setDeleteFileConfirm({ isOpen: true, file });
  }, []);

  const handleDeleteFileConfirm = useCallback(async () => {
    if (!deleteFileConfirm.file) return;

    const file = deleteFileConfirm.file;
    const fileId = file._id || file.filename;
    if (!fileId) return;

    setDeleteFileConfirm({ isOpen: false, file: null });
    setDeletingFileId(fileId);

    try {
      const response = await libraryCrmService.deleteLibraryFile(fileId);
      if (response.success) {
        if (selectedCategory === 'common') {
          await loadBaseFiles();
        } else {
          await loadLibraryFiles(currentFolderId);
        }
        showToast('Файл успешно удален', 'success');
      } else {
        showToast(response.message || 'Ошибка при удалении файла', 'error');
      }
    } catch (error: any) {
      console.error('Failed to delete file:', error);
      showToast(error.response?.data?.message || 'Ошибка при удалении файла', 'error');
    } finally {
      setDeletingFileId(null);
    }
  }, [deleteFileConfirm.file, selectedCategory, loadBaseFiles, loadLibraryFiles, currentFolderId, showToast]);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      setShowCreateFolderInput(false);
      return;
    }

    setIsCreatingFolder(true);
    try {
      const response = await libraryCrmService.createLibraryFolder(newFolderName.trim(), currentFolderId);
      if (response.success) {
        setNewFolderName('');
        setShowCreateFolderInput(false);
        await loadLibraryFiles(currentFolderId);
        showToast('Папка успешно создана', 'success');
      } else {
        showToast(response.message || 'Ошибка при создании папки', 'error');
      }
    } catch (error: any) {
      console.error('Failed to create folder:', error);
      showToast(error.response?.data?.message || 'Ошибка при создании папки', 'error');
    } finally {
      setIsCreatingFolder(false);
    }
  }, [newFolderName, currentFolderId, loadLibraryFiles, showToast]);

  const handleDeleteFolderClick = useCallback(async (folder: LibraryFolder) => {
    // Проверяем, есть ли в папке файлы или подпапки
    try {
      const checkResponse = await libraryCrmService.getRealtorLibraryFiles(folder._id, true);
      if (checkResponse.success && checkResponse.data) {
        const filesCount = checkResponse.data.files?.length || 0;
        const foldersCount = checkResponse.data.folders?.length || 0;

        if (filesCount > 0 || foldersCount > 0) {
          showToast(t('crmLibrary.folderNotEmpty', { name: folder.name, files: filesCount, folders: foldersCount }), 'warning');
          return;
        }
      }
    } catch (error) {
      console.error('Failed to check folder contents:', error);
      // Если не удалось проверить, все равно показываем предупреждение
    }

    setDeleteFolderConfirm({ isOpen: true, folder });
  }, [showToast, t]);

  const handleDeleteFolderConfirm = useCallback(async () => {
    if (!deleteFolderConfirm.folder) return;

    const folder = deleteFolderConfirm.folder;
    setDeleteFolderConfirm({ isOpen: false, folder: null });
    setDeletingFolderId(folder._id);

    try {
      const response = await libraryCrmService.deleteLibraryFolder(folder._id);
      if (response.success) {
        await loadLibraryFiles(currentFolderId);
        showToast('Папка успешно удалена', 'success');
      } else {
        showToast(response.message || 'Ошибка при удалении папки', 'error');
      }
    } catch (error: any) {
      console.error('Failed to delete folder:', error);
      showToast(error.response?.data?.message || 'Ошибка при удалении папки', 'error');
    } finally {
      setDeletingFolderId(null);
    }
  }, [deleteFolderConfirm.folder, loadLibraryFiles, currentFolderId, showToast]);

  const handleNavigateToFolder = useCallback((folder: LibraryFolder) => {
    // Если мы находимся в папке, добавляем её в путь перед переходом в подпапку
    const newPath = [...folderPath];
    if (currentFolderId) {
      const currentFolder = libraryFolders.find(f => f._id === currentFolderId);
      if (currentFolder && !newPath.find(f => f._id === currentFolder._id)) {
        newPath.push(currentFolder);
      }
    }
    // Добавляем новую папку в путь
    newPath.push(folder);
    setFolderPath(newPath);
    setCurrentFolderId(folder._id);
    // Загружаем файлы и папки из выбранной папки
    loadLibraryFiles(folder._id);
  }, [folderPath, currentFolderId, libraryFolders, loadLibraryFiles]);

  const getFileIcon = (mimeType: string, size: number = 20) => {
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

  const formatFileSize = (size: number): string => {
    if (size === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return Math.round(size / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const currentFiles = selectedCategory === 'common' ? baseFiles : libraryFiles;
  const isLoading = selectedCategory === 'common' ? isLoadingBaseFiles : isLoadingLibraryFiles;

  return (
    <>
      <div
        className="rounded-lg bg-[var(--card)] p-4 cursor-pointer shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)] transition-colors hover:bg-[var(--secondary)]"
        onClick={() => {
          setIsModalOpen(true);
          onModalOpen?.();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-[var(--accent)]">
              <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="currentColor"/>
            </svg>
            <div className="flex flex-col min-w-0">
              <span className="text-[18px] font-normal leading-none text-[rgba(255,255,255,0.92)] truncate">
                {t('crm.crm.librarySelectorBlock.библиотека')}</span>
              <span className="text-base text-[rgba(255,255,255,0.72)] truncate">{getProductTypeLabel(selectedProductType)}</span>
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-[var(--accent)]">
            <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Модалка библиотек */}
      {isModalOpen && createPortal(
        <div
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="crm-library-modal rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="crm-library-modal__header flex items-start justify-between">
              <div className="flex min-w-0 flex-col gap-4">
                <div>
                  <h2 className="crm-library-modal__title">{t('crm.crm.librarySelectorBlock.библиотека')}</h2>
                  <p className="crm-library-modal__subtitle">{t('crm.crm.librarySelectorBlock.материалы_по_выбранн')}</p>
                </div>
                <div className="crm-library-product-tabs flex items-center gap-2 flex-wrap">
                  <label className={`crm-library-product-tab ${selectedProductType === ProductType.SALES ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="library-product"
                      value="SALES"
                      checked={selectedProductType === ProductType.SALES}
                      onChange={() => setSelectedProductType(ProductType.SALES)}
                      className="sr-only"
                    />
                    <span>{t('crm.crm.librarySelectorBlock.продажи')}</span>
                  </label>
                  <label className={`crm-library-product-tab ${selectedProductType === ProductType.NETWORK ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="library-product"
                      value="NETWORK"
                      checked={selectedProductType === ProductType.NETWORK}
                      onChange={() => setSelectedProductType(ProductType.NETWORK)}
                      className="sr-only"
                    />
                    <span>{t('crm.crm.librarySelectorBlock.сеть')}</span>
                  </label>
                  <label className={`crm-library-product-tab ${selectedProductType === ProductType.OWNER ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="library-product"
                      value="OWNER"
                      checked={selectedProductType === ProductType.OWNER}
                      onChange={() => setSelectedProductType(ProductType.OWNER)}
                      className="sr-only"
                    />
                    <span>{t('crm.crm.librarySelectorBlock.собственник')}</span>
                  </label>
                  <label className={`crm-library-product-tab ${selectedProductType === ProductType.AGENT ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="library-product"
                      value="AGENT"
                      checked={selectedProductType === ProductType.AGENT}
                      onChange={() => setSelectedProductType(ProductType.AGENT)}
                      className="sr-only"
                    />
                    <span>{t('crm.crm.librarySelectorBlock.посредник')}</span>
                  </label>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="crm-library-modal__close"
                aria-label={t('crm.crm.librarySelectorBlock.закрыть')}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            {/* Табы для категорий */}
            <div className="crm-library-category-tabs flex">
              <button
                onClick={() => setSelectedCategory('common')}
                className={`crm-library-category-tab ${selectedCategory === 'common' ? 'is-active' : ''}`}
              >
                {t('crm.crm.librarySelectorBlock.общая_библиотека')}</button>
              <button
                onClick={() => setSelectedCategory('library')}
                className={`crm-library-category-tab ${selectedCategory === 'library' ? 'is-active' : ''}`}
              >
                {t('crm.crm.librarySelectorBlock.личная_библиотека')}</button>
            </div>

            <div className="crm-library-modal__body flex-1 overflow-y-auto">
              {uploadError && (
                <div className="w-full p-3 mb-4 rounded-md bg-[color-mix(in_srgb,var(--destructive)_14%,var(--card))] text-[color-mix(in_srgb,var(--destructive)_92%,transparent)] text-base border border-[color-mix(in_srgb,var(--destructive)_35%,transparent)]">
                  {uploadError}
                </div>
              )}

              {/* Категория Общая библиотека - системные файлы */}
              {selectedCategory === 'common' && (
                <div className="w-full">
                  <div className="crm-library-info">
                    <p>
                      {t(canUploadCommon ? 'crmLibrary.commonManageHint' : 'crmLibrary.commonHint', {
                        product: getProductTypeLabel(selectedProductType),
                      })}
                    </p>
                  </div>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <svg className="animate-spin h-6 w-6 text-[var(--accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="ml-2 text-base text-[rgba(255,255,255,0.72)]">{t('crm.crm.librarySelectorBlock.загрузка_системных_ф')}</span>
                    </div>
                  ) : currentFiles.length > 0 ? (
                    <div className="w-full flex flex-col gap-2">
                      {currentFiles.map((file, index) => {
                        const fileId = file._id || file.filename;
                        const isImage = file.mimeType?.includes('image');
                        return (
                          <div
                            key={fileId || index}
                            className="flex items-center gap-3 p-3 rounded-md border border-[color:var(--border)] bg-[var(--secondary)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--secondary))]"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {isImage && file.url ? (
                                <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-[var(--muted)]">
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
                                getFileIcon(file.mimeType || '', 24)
                              )}
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-base font-medium truncate text-[rgba(255,255,255,0.92)]">{decodeFilename(file.originalName)}</span>
                                <span className="text-base text-[rgba(255,255,255,0.72)]">{formatFileSize(file.size)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDownloadFile(file)}
                                className="cursor-pointer p-2 rounded-md hover:bg-[color-mix(in_srgb,var(--primary)_15%,var(--secondary))] transition-colors"
                                title={t('crm.crm.librarySelectorBlock.скачать')}
                              >
                                <Download size={18} className="text-[var(--accent)]" />
                              </button>
                              {canUploadCommon ? (
                                <button
                                  onClick={() => handleDeleteFileClick(file)}
                                  disabled={deletingFileId === fileId}
                                  className="cursor-pointer p-2 rounded-md hover:bg-[color-mix(in_srgb,var(--destructive)_16%,var(--secondary))] transition-colors disabled:opacity-50"
                                  title={t('crm.crm.librarySelectorBlock.удалить')}
                                >
                                  <Trash2 size={18} className="text-[var(--accent)]" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="crm-library-empty">{t('crmLibrary.emptyCommon')}</div>
                  )}
                  {canUploadCommon ? (
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <input
                        ref={commonFileInputRef}
                        type="file"
                        multiple
                        onChange={handleUploadLibraryFiles}
                        className="hidden"
                        accept={UPLOAD_ACCEPT}
                      />
                      <button
                        type="button"
                        onClick={() => commonFileInputRef.current?.click()}
                        disabled={isUploadingLibraryFiles}
                        className="flex items-center justify-center gap-2 py-2 px-3 rounded-md border border-dashed border-[color:var(--border)] cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] text-base text-[rgba(255,255,255,0.92)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-1/2"
                      >
                        <Upload size={20} className="shrink-0 text-[var(--accent)]" />
                        <span>{isUploadingLibraryFiles ? t('crm.crm.librarySelectorBlock.загрузка') : t('crmLibrary.uploadCommon')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Категория Личная библиотека */}
              {selectedCategory === 'library' && (
                <div className="w-full">
                  {/* Навигация по папкам и список папок */}
                  <div className="mb-4 p-3 rounded-md border border-[color:var(--border)] bg-[var(--secondary)]">
                    {/* Хлебные крошки - путь папок */}
                    <div className="mb-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          setCurrentFolderId(null);
                          setFolderPath([]);
                          loadLibraryFiles(null);
                        }}
                        className={`px-3 py-1.5 text-base rounded-md transition-colors ${
                          !currentFolderId
                            ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-medium'
                            : 'text-[rgba(255,255,255,0.72)] hover:text-[rgba(255,255,255,0.92)] hover:bg-[color-mix(in_srgb,var(--primary)_12%,var(--secondary))]'
                        }`}
                      >
                        {t('crm.crm.librarySelectorBlock.главная')}</button>
                      {/* Отображаем путь из folderPath */}
                      {folderPath.map((folder, index) => (
                        <React.Fragment key={folder._id}>
                          <span className="text-[rgba(255,255,255,0.45)]">/</span>
                          <button
                            onClick={() => {
                              const newPath = folderPath.slice(0, index + 1);
                              setFolderPath(newPath);
                              setCurrentFolderId(folder._id);
                              loadLibraryFiles(folder._id);
                            }}
                            className="px-3 py-1.5 text-base text-[rgba(255,255,255,0.72)] hover:text-[rgba(255,255,255,0.92)] hover:bg-[color-mix(in_srgb,var(--primary)_12%,var(--secondary))] rounded-md transition-colors"
                          >
                            {folder.name}
                          </button>
                        </React.Fragment>
                      ))}
                      {/* Отображаем текущую папку, если она есть и её нет в пути */}
                      {currentFolderId && !folderPath.find(f => f._id === currentFolderId) && (
                        <>
                          <span className="text-[rgba(255,255,255,0.45)]">/</span>
                          <span className="px-3 py-1.5 text-base text-[rgba(255,255,255,0.92)] font-medium">
                            {libraryFolders.find(f => f._id === currentFolderId)?.name || 'Текущая папка'}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Список папок в текущей директории и кнопка создания */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {libraryFolders.length > 0 && (
                        <>
                          <span className="text-base text-[rgba(255,255,255,0.72)] font-medium">{t('crm.crm.librarySelectorBlock.папки')}</span>
                          {libraryFolders.map((folder) => (
                            <button
                              key={folder._id}
                              onClick={() => handleNavigateToFolder(folder)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-base rounded-md border border-[color-mix(in_srgb,var(--accent)_42%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--secondary))] hover:bg-[color-mix(in_srgb,var(--accent)_14%,var(--secondary))] text-[rgba(255,255,255,0.92)] transition-colors group"
                              title={`Открыть папку "${folder.name}"`}
                            >
                              <Folder size={16} className="text-[var(--accent)]" />
                              <span>{folder.name}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteFolderClick(folder);
                                }}
                                disabled={deletingFolderId === folder._id}
                                className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                title={t('crm.crm.librarySelectorBlock.удалить_папку')}
                              >
                                {deletingFolderId === folder._id ? (
                                  <svg className="animate-spin h-3 w-3 text-[color-mix(in_srgb,var(--destructive)_88%,transparent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                ) : (
                                  <svg className="text-[var(--accent)]" width="18" height="18" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="currentColor"/>
                                    <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="currentColor"/>
                                    <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="currentColor"/>
                                    <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="currentColor"/>
                                  </svg>
                                )}
                              </button>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Кнопка создания папки */}
                      {showCreateFolderInput ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleCreateFolder();
                              } else if (e.key === 'Escape') {
                                setShowCreateFolderInput(false);
                                setNewFolderName('');
                              }
                            }}
                            placeholder={t('crm.crm.librarySelectorBlock.название_папки')}
                            className="px-3 py-1.5 text-base min-h-9 rounded-md border border-[color:var(--border)] bg-[var(--card)] text-[rgba(255,255,255,0.92)] placeholder:text-[rgba(255,255,255,0.45)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                            autoFocus
                          />
                          <button
                            onClick={handleCreateFolder}
                            disabled={isCreatingFolder || !newFolderName.trim()}
                            className="px-3 py-1.5 text-base rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {isCreatingFolder ? 'Создание...' : 'Создать'}
                          </button>
                          <button
                            onClick={() => {
                              setShowCreateFolderInput(false);
                              setNewFolderName('');
                            }}
                            className="px-3 py-1.5 text-base rounded-md bg-[var(--muted)] text-[rgba(255,255,255,0.92)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--muted))] transition-colors"
                          >
                            {t('crm.crm.librarySelectorBlock.отмена')}</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowCreateFolderInput(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-base rounded-md border border-dashed border-[color:var(--border)] bg-[var(--card)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))] text-[rgba(255,255,255,0.92)] transition-colors"
                          title={t('crm.crm.librarySelectorBlock.создать_новую_папку')}
                        >
                          <FolderPlus size={16} className="text-[var(--accent)]" />
                          <span>{t('crm.crm.librarySelectorBlock.создать_папку')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <svg className="animate-spin h-6 w-6 text-[var(--accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="ml-2 text-base text-[rgba(255,255,255,0.72)]">{t('crm.crm.librarySelectorBlock.загрузка_библиотеки')}</span>
                    </div>
                  ) : (
                    <>
                      {/* Список файлов */}
                      {currentFiles.length > 0 && (
                        <div className="w-full mb-4">
                          <h3 className="text-base font-medium text-[rgba(255,255,255,0.92)] mb-2">{t('crm.crm.librarySelectorBlock.файлы')}{currentFiles.length})</h3>
                          <div className="w-full flex flex-col gap-2">
                            {currentFiles.map((file, index) => {
                              const fileId = file._id || file.filename;
                              const isImage = file.mimeType?.includes('image');
                              return (
                                <div
                                  key={fileId || index}
                                  className="flex items-center gap-3 p-3 rounded-md border border-[color:var(--border)] bg-[var(--secondary)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--secondary))]"
                                >
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {isImage && file.url ? (
                                      <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-[var(--muted)]">
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
                                      getFileIcon(file.mimeType || '', 24)
                                    )}
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <span className="text-base font-medium truncate text-[rgba(255,255,255,0.92)]">{decodeFilename(file.originalName)}</span>
                                      <span className="text-base text-[rgba(255,255,255,0.72)]">{formatFileSize(file.size)}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleDownloadFile(file)}
                                      className="cursor-pointer p-2 rounded-md hover:bg-[color-mix(in_srgb,var(--primary)_15%,var(--secondary))] transition-colors"
                                      title={t('crm.crm.librarySelectorBlock.скачать')}
                                    >
                                      <Download size={18} className="text-[var(--accent)]" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteFileClick(file)}
                                      disabled={deletingFileId === fileId}
                                      className="cursor-pointer p-2 rounded-md hover:bg-[color-mix(in_srgb,var(--destructive)_16%,var(--secondary))] transition-colors disabled:opacity-50"
                                      title={t('crm.crm.librarySelectorBlock.удалить')}
                                    >
                                      {deletingFileId === fileId ? (
                                        <svg className="animate-spin h-4 w-4 text-[color-mix(in_srgb,var(--destructive)_88%,transparent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                      ) : (
                                        <svg className="text-[var(--accent)]" width="18" height="18" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="currentColor"/>
                                          <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="currentColor"/>
                                          <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="currentColor"/>
                                          <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="currentColor"/>
                                        </svg>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Сообщение, если нет ни папок, ни файлов */}
                      {libraryFolders.length === 0 && currentFiles.length === 0 && (
                        <div className="text-base text-[rgba(255,255,255,0.72)] text-center py-4 mb-4">{t('crm.crm.librarySelectorBlock.папка_пуста')}</div>
                      )}
                    </>
                  )}

                  {/* Кнопка загрузки файлов */}
                  <div className="flex flex-col gap-2 items-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleUploadLibraryFiles}
                      className="hidden"
                      accept={UPLOAD_ACCEPT}
                    />

                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingLibraryFiles}
                      className="flex items-center justify-center gap-2 py-2 px-3 rounded-md border border-dashed border-[color:var(--border)] cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--secondary))] text-base text-[rgba(255,255,255,0.92)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-1/2"
                    >
                      {isUploadingLibraryFiles ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-[var(--accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{t('crm.crm.librarySelectorBlock.загрузка')}</span>
                        </>
                      ) : (
                        <>
                          <svg className="text-[rgba(255,255,255,0.72)] shrink-0" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="currentColor"/>
                          </svg>
                          <span>{t('crm.crm.librarySelectorBlock.загрузить_файлы_макс')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      <DeleteConfirmModal
        isOpen={deleteFileConfirm.isOpen}
        title={t('crm.crm.librarySelectorBlock.удалить_файл')}
        message={deleteFileConfirm.file ? `Вы уверены, что хотите удалить файл "${decodeFilename(deleteFileConfirm.file.originalName)}"?` : ''}
        onCancel={() => setDeleteFileConfirm({ isOpen: false, file: null })}
        onConfirm={handleDeleteFileConfirm}
      />
      <DeleteConfirmModal
        isOpen={deleteFolderConfirm.isOpen}
        title={t('crm.crm.librarySelectorBlock.удалить_папку')}
        message={deleteFolderConfirm.folder ? `Вы уверены, что хотите удалить папку "${deleteFolderConfirm.folder.name}"?` : ''}
        onCancel={() => setDeleteFolderConfirm({ isOpen: false, folder: null })}
        onConfirm={handleDeleteFolderConfirm}
      />
      <ToastContainer />
    </>
  );
};

export default LibrarySelectorBlock;
