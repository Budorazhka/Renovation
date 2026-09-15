import { libraryApiV2, type LibraryFolderV2, type LibraryItemV2 } from '@/services/libraryApiV2';
import { leadsApiV2 } from '@/services/leadsApiV2';
import { mediaApiV2 } from '@/services/mediaApiV2';
import { mapProductTypeCrmToV2 } from '@/lib/lead-v2-legacy-adapter';
import { openSignedFile } from '@/lib/open-signed-file';
import type { ApiResponse, LeadFile, LibraryFolder, ProductType } from './api';

/**
 * Библиотека материалов платформы в легаси-форме классической CRM (методы и
 * ответы {success, data} как у старого apiService) — для LibrarySelectorBlock
 * и вкладки файлов LeadStageChecklist.
 *
 * «Общая библиотека» — общие материалы организации (раньше «системные файлы
 * BAZA»), «Личная» — личная библиотека сотрудника с папками.
 */

/** Материал в легаси-форме: `_id` — id материала, `filename` — assetId файла. */
export type LibraryFile = LeadFile & { _id: string };

// Имя и assetId материала по его id: прикрепление к лиду принимает id, а
// серверу нужны assetId и имя файла. Кэш наполняется каждым списком.
const itemsById = new Map<string, LibraryItemV2>();

function failure<T>(error: unknown): ApiResponse<T> {
  const err = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
  return {
    success: false,
    message: err.response?.data?.error?.message || err.response?.data?.message || err.message || 'Ошибка запроса',
  };
}

function toLibraryFile(item: LibraryItemV2): LibraryFile {
  itemsById.set(item.id, item);
  return {
    _id: item.id,
    filename: item.assetId,
    originalName: item.fileName,
    mimeType: item.mimeType,
    size: item.sizeBytes,
    url: '',
    folderId: item.folderId,
  };
}

function toLegacyFolder(folder: LibraryFolderV2): LibraryFolder {
  return {
    _id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdBy: { _id: '', name: '', email: '' },
    createdAt: folder.createdAt,
    updatedAt: folder.createdAt,
  };
}

async function attachToLead(leadId: string, fileIds: string[]) {
  let attachedCount = 0;
  for (const id of fileIds) {
    const item = itemsById.get(id);
    if (!item) throw new Error('Материал не найден — обновите список библиотеки');
    await leadsApiV2.attachFile(leadId, item.assetId, item.fileName);
    attachedCount += 1;
  }
  return attachedCount;
}

export const libraryCrmService = {
  async getBaseFiles(
    productType?: ProductType,
  ): Promise<ApiResponse<{ files: LibraryFile[]; count: number; canUpload: boolean }>> {
    try {
      const list = await libraryApiV2.listOrganization(productType ? mapProductTypeCrmToV2(productType) : undefined);
      const files = list.items.map(toLibraryFile);
      return { success: true, data: { files, count: files.length, canUpload: list.canUpload } };
    } catch (error) {
      return failure(error);
    }
  },

  /** Общие материалы продукта; сервер пустит только роль с правом на общие материалы. */
  async uploadBaseFiles(files: File[], productType: ProductType): Promise<ApiResponse<{ uploadedCount: number }>> {
    try {
      for (const file of files) {
        const { assetId } = await mediaApiV2.uploadFile(file, 'library_file');
        await libraryApiV2.createItem({
          scope: 'organization',
          assetId,
          fileName: file.name,
          productType: mapProductTypeCrmToV2(productType),
        });
      }
      return { success: true, data: { uploadedCount: files.length } };
    } catch (error) {
      return failure(error);
    }
  },

  async attachBaseFilesToLead(leadId: string, fileIds: string[]): Promise<ApiResponse<{ attachedCount: number }>> {
    try {
      return { success: true, data: { attachedCount: await attachToLead(leadId, fileIds) } };
    } catch (error) {
      return failure(error);
    }
  },

  /** productType у личной библиотеки не используется — она не делится по продуктам. */
  async getRealtorLibraryFiles(
    folderId?: string | null,
    includeFolders?: boolean,
  ): Promise<ApiResponse<{ files: LibraryFile[]; folders?: LibraryFolder[]; count: number; foldersCount?: number }>> {
    try {
      const [list, folders] = await Promise.all([
        libraryApiV2.listPersonal(folderId),
        includeFolders ? libraryApiV2.listFolders(folderId) : Promise.resolve([] as LibraryFolderV2[]),
      ]);
      const files = list.items.map(toLibraryFile);
      return {
        success: true,
        data: {
          files,
          folders: includeFolders ? folders.map(toLegacyFolder) : undefined,
          count: files.length,
          foldersCount: includeFolders ? folders.length : undefined,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },

  async uploadLibraryFiles(files: File[], folderId?: string | null): Promise<ApiResponse<{ uploadedCount: number }>> {
    try {
      for (const file of files) {
        const { assetId } = await mediaApiV2.uploadFile(file, 'library_file');
        await libraryApiV2.createItem({
          scope: 'personal',
          assetId,
          fileName: file.name,
          ...(folderId ? { folderId } : {}),
        });
      }
      return { success: true, data: { uploadedCount: files.length } };
    } catch (error) {
      return failure(error);
    }
  },

  async attachLibraryFilesToLead(leadId: string, fileIds: string[]): Promise<ApiResponse<{ attachedCount: number }>> {
    try {
      return { success: true, data: { attachedCount: await attachToLead(leadId, fileIds) } };
    } catch (error) {
      return failure(error);
    }
  },

  /** Удаляет материал из библиотеки (и общий, и личный); у лидов, к которым он прикреплён, файл остаётся. */
  async deleteLibraryFile(fileId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      await libraryApiV2.deleteItem(fileId);
      itemsById.delete(fileId);
      return { success: true, data: { deleted: true } };
    } catch (error) {
      return failure(error);
    }
  },

  async createLibraryFolder(name: string, parentFolderId?: string | null): Promise<ApiResponse<{ folder: LibraryFolder }>> {
    try {
      const folder = await libraryApiV2.createFolder(name, parentFolderId);
      return { success: true, data: { folder: toLegacyFolder(folder) } };
    } catch (error) {
      return failure(error);
    }
  },

  /** Сервер удаляет только пустую папку (409 LIBRARY_FOLDER_NOT_EMPTY) — принудительного удаления с содержимым нет. */
  async deleteLibraryFolder(folderId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      await libraryApiV2.deleteFolder(folderId);
      return { success: true, data: { deleted: true } };
    } catch (error) {
      return failure(error);
    }
  },

  openLibraryFile(file: LibraryFile): Promise<void> {
    return openSignedFile(() => libraryApiV2.getDownloadUrl(file._id));
  },
};
