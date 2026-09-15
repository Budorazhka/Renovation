import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LibraryService, LIBRARY_LIST_LIMIT } from './library.service';
import type { LibraryItemRepository } from './repository/library-item.repository';
import type { LibraryFolderRepository } from './repository/library-folder.repository';
import type { MediaService } from '../media/media.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import type { LibraryItemDocument } from './schemas/library-item.schema';
import type { LibraryFolderDocument } from './schemas/library-folder.schema';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeService(overrides: {
  items?: Partial<LibraryItemRepository>;
  folders?: Partial<LibraryFolderRepository>;
  mediaService?: Partial<MediaService>;
  idempotencyService?: Partial<IdempotencyService>;
} = {}) {
  return new LibraryService(
    makeMockConnection() as never,
    (overrides.items ?? {}) as LibraryItemRepository,
    (overrides.folders ?? {}) as LibraryFolderRepository,
    (overrides.mediaService ?? {}) as MediaService,
    (overrides.idempotencyService ?? { record: jest.fn().mockResolvedValue(undefined) }) as IdempotencyService,
  );
}

function makeItem(overrides: Partial<LibraryItemDocument> = {}): LibraryItemDocument {
  return {
    _id: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    scope: 'organization',
    assetId: new Types.ObjectId(),
    fileName: 'Презентация.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    createdByPositionId: new Types.ObjectId(),
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    ...overrides,
  } as unknown as LibraryItemDocument;
}

function verifiedAsset(assetId: Types.ObjectId) {
  return new Map([
    [
      assetId.toString(),
      { status: 'verified', declaredMimeType: 'application/pdf', verifiedMimeType: 'application/pdf', sizeBytes: 2048 },
    ],
  ]);
}

const organizationId = new Types.ObjectId();
const callerPositionId = new Types.ObjectId();

describe('LibraryService', () => {
  describe('listItems', () => {
    it('общие материалы: фильтр по продукту, canUpload из права вызывающего', async () => {
      const listOrganization = jest.fn().mockResolvedValue([makeItem({ productType: 'sales' })]);
      const service = makeService({ items: { listOrganization } });

      const result = await service.listItems({
        organizationId,
        callerPositionId,
        scope: 'organization',
        productType: 'sales',
        canManageOrganization: false,
      });

      expect(listOrganization).toHaveBeenCalledWith(organizationId, 'sales', LIBRARY_LIST_LIMIT);
      expect(result.canUpload).toBe(false);
      expect(result.items[0]).toEqual(expect.objectContaining({ scope: 'organization', productType: 'sales', folderId: null }));
    });

    it('у общих материалов папок нет — folderId отклоняется, а не игнорируется', async () => {
      const service = makeService();
      await expect(
        service.listItems({
          organizationId,
          callerPositionId,
          scope: 'organization',
          folderId: new Types.ObjectId(),
          canManageOrganization: true,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('личные материалы: только вызывающего, в корне — folderId null; загружать может всегда', async () => {
      const listPersonal = jest.fn().mockResolvedValue([]);
      const service = makeService({ items: { listPersonal } });

      const result = await service.listItems({
        organizationId,
        callerPositionId,
        scope: 'personal',
        canManageOrganization: false,
      });

      expect(listPersonal).toHaveBeenCalledWith(organizationId, callerPositionId, null, LIBRARY_LIST_LIMIT);
      expect(result.canUpload).toBe(true);
    });

    it('чужая папка — 404 до выборки файлов', async () => {
      const listPersonal = jest.fn();
      const service = makeService({
        items: { listPersonal },
        folders: { findByIdForOwner: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.listItems({
          organizationId,
          callerPositionId,
          scope: 'personal',
          folderId: new Types.ObjectId(),
          canManageOrganization: false,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(listPersonal).not.toHaveBeenCalled();
    });

    it('личные материалы по продуктам не делятся — productType отклоняется', async () => {
      const service = makeService();
      await expect(
        service.listItems({ organizationId, callerPositionId, scope: 'personal', productType: 'owner', canManageOrganization: true }),
      ).rejects.toBeInstanceOf(AppException);
    });
  });

  describe('createItem', () => {
    const base = {
      organizationId,
      callerPositionId,
      actorIdentityId: new Types.ObjectId(),
      fileName: 'Регламент.pdf',
      idempotencyKey: 'key-1',
      idempotencyRequestBody: {},
    };

    it('общий материал без scope organization — 403, файл не проверяется', async () => {
      const getAssetsForOwnerScope = jest.fn();
      const service = makeService({ mediaService: { getAssetsForOwnerScope } });

      await expect(
        service.createItem({ ...base, scope: 'organization', assetId: new Types.ObjectId(), canManageOrganization: false }),
      ).rejects.toThrow(ForbiddenException);
      expect(getAssetsForOwnerScope).not.toHaveBeenCalled();
    });

    it('не подтверждённый файл — VALIDATION_FAILED', async () => {
      const assetId = new Types.ObjectId();
      const service = makeService({
        mediaService: {
          getAssetsForOwnerScope: jest
            .fn()
            .mockResolvedValue(new Map([[assetId.toString(), { status: 'pending', declaredMimeType: 'application/pdf', sizeBytes: 1 }]])),
        },
      });

      await expect(
        service.createItem({ ...base, scope: 'personal', assetId, canManageOrganization: false }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('личный материал: владелец — вызывающий, MIME и размер из проверенного файла, ответ записан в idempotency', async () => {
      const assetId = new Types.ObjectId();
      const folderId = new Types.ObjectId();
      const create = jest.fn().mockImplementation(async (params: Record<string, unknown>) => makeItem(params as never));
      const record = jest.fn().mockResolvedValue(undefined);
      const service = makeService({
        items: { create },
        folders: { findByIdForOwner: jest.fn().mockResolvedValue({ _id: folderId }) },
        mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(verifiedAsset(assetId)) },
        idempotencyService: { record },
      });

      const view = await service.createItem({ ...base, scope: 'personal', assetId, folderId, canManageOrganization: false });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'personal',
          ownerPositionId: callerPositionId,
          folderId,
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          createdByPositionId: callerPositionId,
        }),
        expect.anything(),
      );
      expect(view).toEqual(expect.objectContaining({ scope: 'personal', folderId: folderId.toString(), fileName: 'Регламент.pdf' }));
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'createLibraryItem', key: 'key-1', responseStatus: 201 }),
        expect.anything(),
      );
    });

    it('общий материал не получает владельца', async () => {
      const assetId = new Types.ObjectId();
      const create = jest.fn().mockImplementation(async (params: Record<string, unknown>) => makeItem(params as never));
      const service = makeService({
        items: { create },
        mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(verifiedAsset(assetId)) },
      });

      await service.createItem({ ...base, scope: 'organization', productType: 'network', assetId, canManageOrganization: true });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'organization', ownerPositionId: undefined, productType: 'network' }),
        expect.anything(),
      );
    });
  });

  describe('deleteItem / getItemDownloadUrl', () => {
    it('чужой личный материал — 404 (non-disclosure), удаления нет', async () => {
      const deleteForOrganization = jest.fn();
      const service = makeService({
        items: {
          findByIdForOrganization: jest.fn().mockResolvedValue(makeItem({ scope: 'personal', ownerPositionId: new Types.ObjectId() })),
          deleteForOrganization,
        },
      });

      await expect(
        service.deleteItem({ itemId: new Types.ObjectId(), organizationId, callerPositionId, canManageOrganization: true }),
      ).rejects.toThrow(NotFoundException);
      expect(deleteForOrganization).not.toHaveBeenCalled();
    });

    it('общий материал без scope organization — 403', async () => {
      const service = makeService({
        items: { findByIdForOrganization: jest.fn().mockResolvedValue(makeItem({ scope: 'organization' })) },
      });

      await expect(
        service.deleteItem({ itemId: new Types.ObjectId(), organizationId, callerPositionId, canManageOrganization: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('свой личный материал удаляется', async () => {
      const itemId = new Types.ObjectId();
      const deleteForOrganization = jest.fn().mockResolvedValue({ deletedCount: 1 });
      const service = makeService({
        items: {
          findByIdForOrganization: jest.fn().mockResolvedValue(makeItem({ scope: 'personal', ownerPositionId: callerPositionId })),
          deleteForOrganization,
        },
      });

      await service.deleteItem({ itemId, organizationId, callerPositionId, canManageOrganization: false });
      expect(deleteForOrganization).toHaveBeenCalledWith(itemId, organizationId);
    });

    it('скачивание общего материала — подписанная ссылка и имя материала', async () => {
      const item = makeItem({ scope: 'organization' });
      const createDownloadUrlForOwnerScope = jest.fn().mockResolvedValue({ url: 'https://signed' });
      const service = makeService({
        items: { findByIdForOrganization: jest.fn().mockResolvedValue(item) },
        mediaService: { createDownloadUrlForOwnerScope },
      });

      const result = await service.getItemDownloadUrl({ itemId: item._id, organizationId, callerPositionId });

      expect(result).toEqual({ url: 'https://signed', fileName: 'Презентация.pdf' });
      expect(createDownloadUrlForOwnerScope).toHaveBeenCalledWith(item.assetId, { type: 'organization', organizationId }, 'Презентация.pdf');
    });
  });

  describe('folders', () => {
    it('непустая папка не удаляется — LIBRARY_FOLDER_NOT_EMPTY с числом файлов и подпапок', async () => {
      const deleteForOwner = jest.fn();
      const service = makeService({
        items: { countInFolder: jest.fn().mockResolvedValue(2) },
        folders: {
          findByIdForOwner: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() } as LibraryFolderDocument),
          countChildren: jest.fn().mockResolvedValue(1),
          deleteForOwner,
        },
      });

      await expect(
        service.deleteFolder({ folderId: new Types.ObjectId(), organizationId, ownerPositionId: callerPositionId }),
      ).rejects.toMatchObject({ code: ErrorCode.LIBRARY_FOLDER_NOT_EMPTY, details: { items: 2, folders: 1 } });
      expect(deleteForOwner).not.toHaveBeenCalled();
    });

    it('пустая папка удаляется', async () => {
      const folderId = new Types.ObjectId();
      const deleteForOwner = jest.fn().mockResolvedValue({ deletedCount: 1 });
      const service = makeService({
        items: { countInFolder: jest.fn().mockResolvedValue(0) },
        folders: {
          findByIdForOwner: jest.fn().mockResolvedValue({ _id: folderId } as LibraryFolderDocument),
          countChildren: jest.fn().mockResolvedValue(0),
          deleteForOwner,
        },
      });

      await service.deleteFolder({ folderId, organizationId, ownerPositionId: callerPositionId });
      expect(deleteForOwner).toHaveBeenCalledWith(folderId, organizationId, callerPositionId);
    });

    it('подпапка в чужой папке — 404, папка не создаётся', async () => {
      const create = jest.fn();
      const service = makeService({ folders: { findByIdForOwner: jest.fn().mockResolvedValue(null), create } });

      await expect(
        service.createFolder({
          organizationId,
          ownerPositionId: callerPositionId,
          actorIdentityId: new Types.ObjectId(),
          name: 'Договоры',
          parentId: new Types.ObjectId(),
          idempotencyKey: 'k',
          idempotencyRequestBody: {},
        }),
      ).rejects.toThrow(NotFoundException);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
