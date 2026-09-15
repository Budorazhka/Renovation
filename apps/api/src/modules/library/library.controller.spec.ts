import { Types } from 'mongoose';
import { LibraryController } from './library.controller';
import type { LibraryService } from './library.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { ErrorCode } from '../../shared/errors/error-codes';

const noReplay = () => ({ checkReplay: jest.fn().mockResolvedValue(null) }) as unknown as IdempotencyService;

function makeRequest(organizationId: Types.ObjectId, positionId: Types.ObjectId) {
  return {
    tenantContext: {
      organizationId: organizationId.toString(),
      positionId: positionId.toString(),
      identityId: new Types.ObjectId().toString(),
    },
  };
}

describe('LibraryController', () => {
  const organizationId = new Types.ObjectId();
  const positionId = new Types.ObjectId();

  it.each([
    [['organization'], true],
    [['global'], true],
    [['own'], false],
    [[], false],
  ])('scope гранта library_item.create %j → canManageOrganization %s', async (scopes, expected) => {
    const listItems = jest.fn().mockResolvedValue({ items: [], canUpload: expected });
    const matchingScopes = jest.fn().mockResolvedValue(scopes);
    const controller = new LibraryController(
      { listItems } as unknown as LibraryService,
      { matchingScopes } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listItems(makeRequest(organizationId, positionId) as never, { scope: 'organization', productType: 'sales' });

    expect(matchingScopes).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: positionId, resource: 'library_item', action: 'create' }),
    );
    expect(listItems).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, callerPositionId: positionId, scope: 'organization', canManageOrganization: expected }),
    );
  });

  it('удаление смотрит на scope library_item.delete, а не create', async () => {
    const deleteItem = jest.fn().mockResolvedValue(undefined);
    const matchingScopes = jest.fn().mockResolvedValue(['own']);
    const controller = new LibraryController(
      { deleteItem } as unknown as LibraryService,
      { matchingScopes } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const itemId = new Types.ObjectId();

    await controller.deleteItem(makeRequest(organizationId, positionId) as never, itemId);

    expect(matchingScopes).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete' }));
    expect(deleteItem).toHaveBeenCalledWith({ itemId, organizationId, callerPositionId: positionId, canManageOrganization: false });
  });

  it('создание без Idempotency-Key — IDEMPOTENCY_KEY_REQUIRED', async () => {
    const controller = new LibraryController({} as LibraryService, {} as PolicyEvaluatorService, noReplay());

    await expect(
      controller.createItem(
        makeRequest(organizationId, positionId) as never,
        { scope: 'personal', assetId: new Types.ObjectId().toString(), fileName: 'a.pdf' },
        undefined,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED });
  });

  it('повтор с тем же ключом отдаёт сохранённый ответ, материал второй раз не создаётся', async () => {
    const createItem = jest.fn();
    const saved = { id: 'saved' };
    const controller = new LibraryController(
      { createItem } as unknown as LibraryService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      { checkReplay: jest.fn().mockResolvedValue({ responseBody: saved }) } as unknown as IdempotencyService,
    );

    const result = await controller.createItem(
      makeRequest(organizationId, positionId) as never,
      { scope: 'personal', assetId: new Types.ObjectId().toString(), fileName: 'a.pdf' },
      'key-1',
    );

    expect(result).toBe(saved);
    expect(createItem).not.toHaveBeenCalled();
  });

  it('папки — всегда своя личная библиотека', async () => {
    const listFolders = jest.fn().mockResolvedValue({ folders: [] });
    const controller = new LibraryController(
      { listFolders } as unknown as LibraryService,
      {} as PolicyEvaluatorService,
      noReplay(),
    );
    const parentId = new Types.ObjectId();

    await controller.listFolders(makeRequest(organizationId, positionId) as never, { parentId: parentId.toString() });

    expect(listFolders).toHaveBeenCalledWith({ organizationId, ownerPositionId: positionId, parentId });
  });
});
