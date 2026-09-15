import { Types } from 'mongoose';
import { LibraryItemRepository } from './library-item.repository';
import { LibraryFolderRepository } from './library-folder.repository';

function chain(result: unknown) {
  const exec = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ limit, exec });
  return { sort, limit, exec };
}

describe('LibraryItemRepository', () => {
  const organizationId = new Types.ObjectId();
  const ownerPositionId = new Types.ObjectId();

  it('общие материалы продукта: scope organization, продукт или «для всех» (null)', async () => {
    const c = chain([]);
    const find = jest.fn().mockReturnValue({ sort: c.sort });
    const repository = new LibraryItemRepository({ find } as never);

    await repository.listOrganization(organizationId, 'owner', 500);

    expect(find).toHaveBeenCalledWith({ organizationId, scope: 'organization', productType: { $in: ['owner', null] } });
    expect(c.sort).toHaveBeenCalledWith({ _id: -1 });
    expect(c.limit).toHaveBeenCalledWith(500);
  });

  it('личные материалы фильтруются по владельцу и папке', async () => {
    const c = chain([]);
    const find = jest.fn().mockReturnValue({ sort: c.sort });
    const repository = new LibraryItemRepository({ find } as never);

    await repository.listPersonal(organizationId, ownerPositionId, null, 500);

    expect(find).toHaveBeenCalledWith({ organizationId, scope: 'personal', ownerPositionId, folderId: null });
  });

  it('создание не пишет пустые ownerPositionId/productType/folderId', async () => {
    const create = jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]);
    const repository = new LibraryItemRepository({ create } as never);
    const assetId = new Types.ObjectId();

    await repository.create({
      organizationId,
      scope: 'organization',
      assetId,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      createdByPositionId: ownerPositionId,
    });

    const doc = create.mock.calls[0][0][0];
    expect(doc).toEqual({
      organizationId,
      scope: 'organization',
      assetId,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      createdByPositionId: ownerPositionId,
    });
  });

  it('удаление фильтрует по организации', async () => {
    const exec = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const deleteOne = jest.fn().mockReturnValue({ exec });
    const repository = new LibraryItemRepository({ deleteOne } as never);
    const id = new Types.ObjectId();

    const result = await repository.deleteForOrganization(id, organizationId);

    expect(deleteOne).toHaveBeenCalledWith({ _id: id, organizationId }, { session: undefined });
    expect(result).toEqual({ deletedCount: 1 });
  });
});

describe('LibraryFolderRepository', () => {
  const organizationId = new Types.ObjectId();
  const ownerPositionId = new Types.ObjectId();

  it('папки уровня: владелец и родитель, по имени', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const repository = new LibraryFolderRepository({ find } as never);

    await repository.listForOwner(organizationId, ownerPositionId, null);

    expect(find).toHaveBeenCalledWith({ organizationId, ownerPositionId, parentId: null });
    expect(sort).toHaveBeenCalledWith({ name: 1 });
  });

  it('удаление фильтрует по организации и владельцу', async () => {
    const exec = jest.fn().mockResolvedValue({ deletedCount: 0 });
    const deleteOne = jest.fn().mockReturnValue({ exec });
    const repository = new LibraryFolderRepository({ deleteOne } as never);
    const id = new Types.ObjectId();

    const result = await repository.deleteForOwner(id, organizationId, ownerPositionId);

    expect(deleteOne).toHaveBeenCalledWith({ _id: id, organizationId, ownerPositionId }, { session: undefined });
    expect(result).toEqual({ deletedCount: 0 });
  });
});
