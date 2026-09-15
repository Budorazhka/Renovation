import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { MediaService } from '../media/media.service';
import { LibraryItemRepository } from './repository/library-item.repository';
import { LibraryFolderRepository } from './repository/library-folder.repository';
import type { LibraryItemDocument, LibraryProductType, LibraryScope } from './schemas/library-item.schema';
import type { LibraryFolderDocument } from './schemas/library-folder.schema';

/** Потолок одной выдачи: библиотека — десятки файлов, не тысячи; постраничность не нужна, как и в легаси. */
export const LIBRARY_LIST_LIMIT = 500;

export interface LibraryItemView {
  id: string;
  scope: LibraryScope;
  productType: LibraryProductType | null;
  folderId: string | null;
  assetId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdByPositionId: string;
  createdAt: string;
}

export interface LibraryFolderView {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export function toLibraryItemReadModel(item: LibraryItemDocument): LibraryItemView {
  return {
    id: item._id.toString(),
    scope: item.scope,
    productType: item.productType ?? null,
    folderId: item.folderId ? item.folderId.toString() : null,
    assetId: item.assetId.toString(),
    fileName: item.fileName,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    createdByPositionId: item.createdByPositionId.toString(),
    createdAt: item.createdAt ? item.createdAt.toISOString() : new Date().toISOString(),
  };
}

export function toLibraryFolderReadModel(folder: LibraryFolderDocument): LibraryFolderView {
  return {
    id: folder._id.toString(),
    name: folder.name,
    parentId: folder.parentId ? folder.parentId.toString() : null,
    createdAt: folder.createdAt ? folder.createdAt.toISOString() : new Date().toISOString(),
  };
}

/**
 * Библиотека материалов CRM (см. LibraryItemDocument). Отдельный модуль от
 * `crm` (ADR-001): прикрепление материала к лиду идёт через уже
 * существующий POST /leads/:leadId/files с assetId материала, отдельной
 * операции «attach-library» у сервера нет.
 *
 * `canManageOrganization` вычисляет контроллер по scope грантов
 * library_item.create/delete (organization/global — может менять общие
 * материалы; own — только свою личную библиотеку).
 *
 * Аудит не пишется: тот же прецедент, что личные заметки — материалы не
 * влияют на отчётность и доступы других пользователей.
 */
@Injectable()
export class LibraryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly items: LibraryItemRepository,
    private readonly folders: LibraryFolderRepository,
    private readonly mediaService: MediaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  private async requireOwnFolder(
    folderId: Types.ObjectId,
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
  ): Promise<LibraryFolderDocument> {
    const folder = await this.folders.findByIdForOwner(folderId, organizationId, ownerPositionId);
    if (!folder) {
      throw new NotFoundException('Library folder not found');
    }
    return folder;
  }

  /** Материал, который вызывающий вправе видеть: общий — любой сотрудник с library_item.read, личный — только владелец. Чужой личный — 404 (non-disclosure). */
  private async requireVisibleItem(
    itemId: Types.ObjectId,
    organizationId: Types.ObjectId,
    callerPositionId: Types.ObjectId,
  ): Promise<LibraryItemDocument> {
    const item = await this.items.findByIdForOrganization(itemId, organizationId);
    if (!item || (item.scope === 'personal' && !item.ownerPositionId?.equals(callerPositionId))) {
      throw new NotFoundException('Library item not found');
    }
    return item;
  }

  async listItems(params: {
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    scope: LibraryScope;
    productType?: LibraryProductType;
    folderId?: Types.ObjectId;
    canManageOrganization: boolean;
  }): Promise<{ items: LibraryItemView[]; canUpload: boolean }> {
    if (params.scope === 'organization') {
      if (params.folderId) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Organization materials have no folders');
      }
      const rows = await this.items.listOrganization(params.organizationId, params.productType, LIBRARY_LIST_LIMIT);
      return { items: rows.map(toLibraryItemReadModel), canUpload: params.canManageOrganization };
    }

    if (params.productType) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Personal materials are not split by product');
    }
    if (params.folderId) {
      await this.requireOwnFolder(params.folderId, params.organizationId, params.callerPositionId);
    }
    const rows = await this.items.listPersonal(
      params.organizationId,
      params.callerPositionId,
      params.folderId ?? null,
      LIBRARY_LIST_LIMIT,
    );
    return { items: rows.map(toLibraryItemReadModel), canUpload: true };
  }

  async createItem(params: {
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    scope: LibraryScope;
    assetId: Types.ObjectId;
    fileName: string;
    productType?: LibraryProductType;
    folderId?: Types.ObjectId;
    canManageOrganization: boolean;
    idempotencyKey: string;
    idempotencyRequestBody: Record<string, unknown>;
  }): Promise<LibraryItemView> {
    if (params.scope === 'organization') {
      if (!params.canManageOrganization) {
        throw new ForbiddenException('Caller cannot add organization materials');
      }
      if (params.folderId) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Organization materials have no folders');
      }
    } else {
      if (params.productType) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Personal materials are not split by product');
      }
      if (params.folderId) {
        await this.requireOwnFolder(params.folderId, params.organizationId, params.callerPositionId);
      }
    }

    const asset = (
      await this.mediaService.getAssetsForOwnerScope([params.assetId], {
        type: 'organization',
        organizationId: params.organizationId,
      })
    ).get(params.assetId.toString());
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    if (asset.status !== 'verified') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Media asset is not verified yet');
    }

    return runInTransaction(this.connection, async (session) => {
      const item = await this.items.create(
        {
          organizationId: params.organizationId,
          scope: params.scope,
          ownerPositionId: params.scope === 'personal' ? params.callerPositionId : undefined,
          productType: params.productType,
          folderId: params.folderId,
          assetId: params.assetId,
          fileName: params.fileName,
          mimeType: asset.verifiedMimeType ?? asset.declaredMimeType,
          sizeBytes: asset.sizeBytes,
          createdByPositionId: params.callerPositionId,
        },
        session,
      );
      const readModel = toLibraryItemReadModel(item);

      await this.idempotencyService.record(
        {
          identityId: params.actorIdentityId,
          operation: 'createLibraryItem',
          key: params.idempotencyKey,
          requestBody: params.idempotencyRequestBody,
          responseStatus: 201,
          responseBody: readModel as unknown as Record<string, unknown>,
        },
        session,
      );
      return readModel;
    });
  }

  /** Удаляет запись библиотеки; MediaAsset остаётся — файл мог быть прикреплён к лиду. */
  async deleteItem(params: {
    itemId: Types.ObjectId;
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    canManageOrganization: boolean;
  }): Promise<void> {
    const item = await this.requireVisibleItem(params.itemId, params.organizationId, params.callerPositionId);
    if (item.scope === 'organization' && !params.canManageOrganization) {
      throw new ForbiddenException('Caller cannot delete organization materials');
    }
    const { deletedCount } = await this.items.deleteForOrganization(params.itemId, params.organizationId);
    if (deletedCount === 0) {
      throw new NotFoundException('Library item not found');
    }
  }

  async getItemDownloadUrl(params: {
    itemId: Types.ObjectId;
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
  }): Promise<{ url: string; fileName: string }> {
    const item = await this.requireVisibleItem(params.itemId, params.organizationId, params.callerPositionId);
    const download = await this.mediaService.createDownloadUrlForOwnerScope(
      item.assetId,
      { type: 'organization', organizationId: params.organizationId },
      item.fileName,
    );
    if (!download) {
      throw new NotFoundException('Library item not found');
    }
    return { url: download.url, fileName: item.fileName };
  }

  async listFolders(params: {
    organizationId: Types.ObjectId;
    ownerPositionId: Types.ObjectId;
    parentId?: Types.ObjectId;
  }): Promise<{ folders: LibraryFolderView[] }> {
    if (params.parentId) {
      await this.requireOwnFolder(params.parentId, params.organizationId, params.ownerPositionId);
    }
    const rows = await this.folders.listForOwner(params.organizationId, params.ownerPositionId, params.parentId ?? null);
    return { folders: rows.map(toLibraryFolderReadModel) };
  }

  async createFolder(params: {
    organizationId: Types.ObjectId;
    ownerPositionId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    name: string;
    parentId?: Types.ObjectId;
    idempotencyKey: string;
    idempotencyRequestBody: Record<string, unknown>;
  }): Promise<LibraryFolderView> {
    if (params.parentId) {
      await this.requireOwnFolder(params.parentId, params.organizationId, params.ownerPositionId);
    }

    return runInTransaction(this.connection, async (session) => {
      const folder = await this.folders.create(
        {
          organizationId: params.organizationId,
          ownerPositionId: params.ownerPositionId,
          name: params.name,
          parentId: params.parentId,
        },
        session,
      );
      const readModel = toLibraryFolderReadModel(folder);

      await this.idempotencyService.record(
        {
          identityId: params.actorIdentityId,
          operation: 'createLibraryFolder',
          key: params.idempotencyKey,
          requestBody: params.idempotencyRequestBody,
          responseStatus: 201,
          responseBody: readModel as unknown as Record<string, unknown>,
        },
        session,
      );
      return readModel;
    });
  }

  /** Удаляет только пустую папку — как легаси без force: содержимое сначала удаляется явно, 409 LIBRARY_FOLDER_NOT_EMPTY. */
  async deleteFolder(params: {
    folderId: Types.ObjectId;
    organizationId: Types.ObjectId;
    ownerPositionId: Types.ObjectId;
  }): Promise<void> {
    await this.requireOwnFolder(params.folderId, params.organizationId, params.ownerPositionId);
    const [itemCount, childCount] = await Promise.all([
      this.items.countInFolder(params.organizationId, params.ownerPositionId, params.folderId),
      this.folders.countChildren(params.organizationId, params.ownerPositionId, params.folderId),
    ]);
    if (itemCount > 0 || childCount > 0) {
      throw new AppException(ErrorCode.LIBRARY_FOLDER_NOT_EMPTY, 'Library folder is not empty', {
        items: itemCount,
        folders: childCount,
      });
    }
    const { deletedCount } = await this.folders.deleteForOwner(
      params.folderId,
      params.organizationId,
      params.ownerPositionId,
    );
    if (deletedCount === 0) {
      throw new NotFoundException('Library folder not found');
    }
  }
}
