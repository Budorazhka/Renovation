import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ListingRepository, PropertyAssetRepository } from '@baza/property-assets';
import { SelectionsService, toPublicDevSelection } from './selections.service';
import type { DevSelectionRepository } from './repository/dev-selection.repository';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import type { DevelopmentsService } from '../developments/developments.service';
import type { CrmService } from '../crm/crm.service';
import type { DevSelectionDocument } from './schemas/dev-selection.schema';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeService(overrides: {
  repository?: Partial<DevSelectionRepository>;
  idempotencyService?: Partial<IdempotencyService>;
  developmentsService?: Partial<DevelopmentsService>;
  crmService?: Partial<CrmService>;
  listingRepository?: Partial<ListingRepository>;
  propertyAssetRepository?: Partial<PropertyAssetRepository>;
} = {}) {
  return new SelectionsService(
    makeMockConnection() as never,
    (overrides.repository ?? {}) as DevSelectionRepository,
    (overrides.idempotencyService ??
      { record: jest.fn().mockResolvedValue(undefined), checkReplay: jest.fn().mockResolvedValue(null) }) as IdempotencyService,
    (overrides.developmentsService ?? { getUnitForOrganization: jest.fn().mockResolvedValue({}) }) as DevelopmentsService,
    (overrides.crmService ?? { getLeadForOrganization: jest.fn().mockResolvedValue({}) }) as CrmService,
    (overrides.listingRepository ?? { findByIdForOrganization: jest.fn().mockResolvedValue({}) }) as ListingRepository,
    (overrides.propertyAssetRepository ?? { findByIdForOrganization: jest.fn().mockResolvedValue({}) }) as PropertyAssetRepository,
  );
}

function idem(operation = 'test') {
  return { identityId: new Types.ObjectId(), operation, key: new Types.ObjectId().toString(), requestBody: { probe: 1 } };
}

function makeDoc(overrides: Partial<DevSelectionDocument> = {}): DevSelectionDocument {
  return {
    _id: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    createdByPositionId: new Types.ObjectId(),
    publicToken: 'x'.repeat(64),
    title: 'Подборка',
    status: 'sent',
    items: [{ targetType: 'unit', unitId: new Types.ObjectId(), agentNote: 'note', reaction: 'liked', viewedAt: new Date() }],
    viewCount: 3,
    version: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    toObject: function () { return { ...this }; },
    ...overrides,
  } as unknown as DevSelectionDocument;
}

describe('SelectionsService', () => {
  describe('createSelection', () => {
    it('проверяет существование каждого unitId перед созданием (cross-module через DevelopmentsService)', async () => {
      const organizationId = new Types.ObjectId();
      const unitIds = [new Types.ObjectId(), new Types.ObjectId()];
      const getUnitSpy = jest.fn().mockResolvedValue({});
      const createSpy = jest.fn().mockResolvedValue(makeDoc());

      const service = makeService({
        developmentsService: { getUnitForOrganization: getUnitSpy },
        repository: { create: createSpy },
      });

      await service.createSelection({
        organizationId,
        createdByPositionId: new Types.ObjectId(),
        title: 'Для клиента',
        unitIds,
        listingIds: [],
        idempotency: idem('createSelection'),
      });

      expect(getUnitSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          title: 'Для клиента',
          items: unitIds.map((id) => ({ targetType: 'unit', id })),
        }),
        expect.anything(),
      );
    });

    it('отклоняет создание, если один из юнитов не существует/чужой', async () => {
      const service = makeService({
        developmentsService: { getUnitForOrganization: jest.fn().mockRejectedValue(new NotFoundException('Unit not found')) },
      });

      await expect(
        service.createSelection({
          organizationId: new Types.ObjectId(),
          createdByPositionId: new Types.ObjectId(),
          title: 'Попытка',
          unitIds: [new Types.ObjectId()],
          listingIds: [],
          idempotency: idem(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('проверяет leadId, если передан', async () => {
      const getLeadSpy = jest.fn().mockResolvedValue({});
      const service = makeService({
        crmService: { getLeadForOrganization: getLeadSpy },
        repository: { create: jest.fn().mockResolvedValue(makeDoc()) },
      });

      const leadId = new Types.ObjectId();
      await service.createSelection({
        organizationId: new Types.ObjectId(),
        createdByPositionId: new Types.ObjectId(),
        title: 'Для клиента',
        unitIds: [new Types.ObjectId()],
        listingIds: [],
        leadId,
        idempotency: idem(),
      });

      expect(getLeadSpy).toHaveBeenCalledWith(leadId, expect.any(Types.ObjectId));
    });
  });

  describe('getSelection — tenant/own-scope isolation', () => {
    it('бросает NotFoundException, если подборка не найдена', async () => {
      const service = makeService({ repository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) } });

      await expect(service.getSelection(new Types.ObjectId(), new Types.ObjectId())).rejects.toThrow(NotFoundException);
    });

    it('own-scope: бросает NotFoundException (не 403), если createdByPositionId не совпадает', async () => {
      const foreignPositionId = new Types.ObjectId();
      const doc = makeDoc({ createdByPositionId: foreignPositionId });
      const service = makeService({ repository: { findByIdForOrganization: jest.fn().mockResolvedValue(doc) } });

      await expect(
        service.getSelection(doc._id, doc.organizationId, new Types.ObjectId()),
      ).rejects.toThrow(NotFoundException);
    });

    it('own-scope: возвращает подборку, если createdByPositionId совпадает', async () => {
      const positionId = new Types.ObjectId();
      const doc = makeDoc({ createdByPositionId: positionId });
      const service = makeService({ repository: { findByIdForOrganization: jest.fn().mockResolvedValue(doc) } });

      const result = await service.getSelection(doc._id, doc.organizationId, positionId);
      expect(result).toBe(doc);
    });
  });

  describe('updateSelection — optimistic concurrency', () => {
    it('бросает ConflictException при несовпадении expectedVersion', async () => {
      const doc = makeDoc();
      const service = makeService({
        repository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(doc),
          updateWithVersionCheck: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(
        service.updateSelection({
          id: doc._id,
          organizationId: doc.organizationId,
          expectedVersion: 5,
          patch: { title: 'x' },
          idempotency: idem(),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteSelection', () => {
    it('бросает ConflictException, если deleteWithVersionCheck вернул false', async () => {
      const doc = makeDoc();
      const service = makeService({
        repository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(doc),
          deleteWithVersionCheck: jest.fn().mockResolvedValue(false),
        },
      });

      await expect(
        service.deleteSelection({ id: doc._id, organizationId: doc.organizationId, expectedVersion: 0, idempotency: idem() }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toPublicDevSelection — публичная проекция', () => {
    it('НЕ содержит organizationId/createdByPositionId/leadId/publicToken/version', () => {
      const doc = makeDoc({ leadId: new Types.ObjectId() } as Partial<DevSelectionDocument>);

      const projection = toPublicDevSelection(doc);

      expect(projection).not.toHaveProperty('organizationId');
      expect(projection).not.toHaveProperty('createdByPositionId');
      expect(projection).not.toHaveProperty('leadId');
      expect(projection).not.toHaveProperty('publicToken');
      expect(projection).not.toHaveProperty('version');
    });

    it('включает whitelist-поля, необходимые ClientSelectionPage', () => {
      const doc = makeDoc();

      const projection = toPublicDevSelection(doc);

      expect(projection).toMatchObject({
        title: doc.title,
        status: doc.status,
        viewCount: doc.viewCount,
      });
      expect(projection.items).toHaveLength(1);
      expect(projection.items[0]).toMatchObject({
        unitId: doc.items[0]!.unitId!.toString(),
        agentNote: doc.items[0]!.agentNote,
        reaction: doc.items[0]!.reaction,
      });
    });
  });

  describe('getPublicSelectionAndMarkViewed', () => {
    it('бросает NotFoundException для неизвестного токена', async () => {
      const service = makeService({ repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(null) } });

      await expect(service.getPublicSelectionAndMarkViewed('unknown-token')).rejects.toThrow(NotFoundException);
    });

    it('возвращает публичную проекцию для валидного токена', async () => {
      const doc = makeDoc();
      const service = makeService({ repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(doc) } });

      const result = await service.getPublicSelectionAndMarkViewed(doc.publicToken);

      expect(result.title).toBe(doc.title);
      expect(result).not.toHaveProperty('organizationId');
    });

    it('подставляет данные объектов: без них клиенту нечего смотреть', async () => {
      const doc = makeDoc();
      const unitId = doc.items[0]!.unitId!;
      const service = makeService({
        repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(doc) },
        developmentsService: {
          getUnitForOrganization: jest.fn().mockResolvedValue({
            number: '42',
            kind: 'apartment',
            rooms: 2,
            area: 65,
            price: { amountMinorUnits: 8_500_000, currency: 'USD' },
            status: 'available',
            // Внутренние поля: в публичный ответ попадать не должны.
            organizationId: new Types.ObjectId(),
            buildingId: new Types.ObjectId(),
          }),
        },
      });

      const result = await service.getPublicSelectionAndMarkViewed(doc.publicToken);
      const item = result.items.find((entry) => entry.unitId === unitId.toString());

      expect(item?.unit).toEqual({
        number: '42',
        kind: 'apartment',
        rooms: 2,
        area: 65,
        price: { amountMinorUnits: 8_500_000, currency: 'USD' },
        status: 'available',
      });
      expect(item?.unit).not.toHaveProperty('organizationId');
      expect(item?.unit).not.toHaveProperty('buildingId');
    });

    it('пропавший объект не роняет всю подборку', async () => {
      const doc = makeDoc();
      const service = makeService({
        repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(doc) },
        developmentsService: {
          getUnitForOrganization: jest.fn().mockRejectedValue(new NotFoundException('Unit not found')),
        },
      });

      const result = await service.getPublicSelectionAndMarkViewed(doc.publicToken);

      // Подборка показывается, объект просто без данных: ронять страницу
      // клиента из-за одной удалённой квартиры — худший вариант.
      expect(result.title).toBe(doc.title);
      expect(result.items[0]!.unit).toBeUndefined();
    });

    it('объекты резолвятся организацией подборки, а не контекстом запроса', async () => {
      const doc = makeDoc();
      const getUnitForOrganization = jest.fn().mockResolvedValue({ number: '1', kind: 'apartment', area: 30, status: 'available' });
      const service = makeService({
        repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(doc) },
        developmentsService: { getUnitForOrganization },
      });

      await service.getPublicSelectionAndMarkViewed(doc.publicToken);

      const [, organizationId] = getUnitForOrganization.mock.calls[0];
      expect(organizationId).toEqual(doc.organizationId);
    });
  });

  describe('N-27: листинги вторички наравне с юнитами', () => {
    it('createSelection проверяет существование каждого listingId (cross-module через ListingRepository)', async () => {
      const organizationId = new Types.ObjectId();
      const listingIds = [new Types.ObjectId(), new Types.ObjectId()];
      const findListingSpy = jest.fn().mockResolvedValue({ _id: listingIds[0] });
      const createSpy = jest.fn().mockResolvedValue(makeDoc());

      const service = makeService({
        listingRepository: { findByIdForOrganization: findListingSpy },
        repository: { create: createSpy },
      });

      await service.createSelection({
        organizationId,
        createdByPositionId: new Types.ObjectId(),
        title: 'Вторичка для клиента',
        unitIds: [],
        listingIds,
        idempotency: idem('createSelection'),
      });

      expect(findListingSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            { targetType: 'listing', id: listingIds[0] },
            { targetType: 'listing', id: listingIds[1] },
          ],
        }),
        expect.anything(),
      );
    });

    it('отклоняет создание, если объявление не существует/чужое', async () => {
      const service = makeService({
        listingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.createSelection({
          organizationId: new Types.ObjectId(),
          createdByPositionId: new Types.ObjectId(),
          title: 'Попытка',
          unitIds: [],
          listingIds: [new Types.ObjectId()],
          idempotency: idem(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('ни unitIds, ни listingIds — VALIDATION_FAILED, подборка не создаётся', async () => {
      const createSpy = jest.fn();
      const service = makeService({ repository: { create: createSpy } });

      await expect(
        service.createSelection({
          organizationId: new Types.ObjectId(),
          createdByPositionId: new Types.ObjectId(),
          title: 'Пустая',
          unitIds: [],
          listingIds: [],
          idempotency: idem(),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('removeItem/updateItem передают itemId дальше в репозиторий без изменений', async () => {
      const doc = makeDoc();
      const itemId = new Types.ObjectId();
      const removeSpy = jest.fn().mockResolvedValue(makeDoc());
      const updateSpy = jest.fn().mockResolvedValue(makeDoc());
      const service = makeService({
        repository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(doc),
          removeItemWithVersionCheck: removeSpy,
          updateItemWithVersionCheck: updateSpy,
        },
      });

      await service.removeItem({ id: doc._id, organizationId: doc.organizationId, expectedVersion: 0, itemId, idempotency: idem() });
      expect(removeSpy).toHaveBeenCalledWith(doc._id, doc.organizationId, 0, itemId, expect.anything());

      await service.updateItem({
        id: doc._id,
        organizationId: doc.organizationId,
        expectedVersion: 0,
        itemId,
        patch: { agentNote: 'заметка' },
        idempotency: idem(),
      });
      expect(updateSpy).toHaveBeenCalledWith(doc._id, doc.organizationId, 0, itemId, { agentNote: 'заметка' }, expect.anything());
    });

    it('публичная проекция денормализует объявление вторички так же честно, как юнит: пропавшее — без данных, не падение', async () => {
      const listingId = new Types.ObjectId();
      const doc = makeDoc({
        items: [{ targetType: 'listing', listingId, agentNote: undefined, reaction: undefined, viewedAt: undefined }],
      } as Partial<DevSelectionDocument>);

      const withListing = makeService({
        repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(doc) },
        listingRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({
            propertyAssetId: new Types.ObjectId(),
            dealType: 'sale',
            price: { amountMinorUnits: 12_000_000, currency: 'USD' },
            status: 'active',
          }),
        },
        propertyAssetRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({
            propertyType: 'apartment',
            location: { city: 'Батуми', address: 'ул. Руставели, 7' },
            characteristics: { area: 65, rooms: 2, floor: 7 },
          }),
        },
      });
      const result = await withListing.getPublicSelectionAndMarkViewed(doc.publicToken);
      expect(result.items[0]).toMatchObject({
        targetType: 'listing',
        listingId: listingId.toString(),
        listing: {
          propertyType: 'apartment',
          city: 'Батуми',
          address: 'ул. Руставели, 7',
          area: 65,
          rooms: 2,
          floor: 7,
          dealType: 'sale',
          price: { amountMinorUnits: 12_000_000, currency: 'USD' },
          status: 'active',
        },
      });

      const withoutListing = makeService({
        repository: { markViewedByPublicToken: jest.fn().mockResolvedValue(doc) },
        listingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });
      const resultMissing = await withoutListing.getPublicSelectionAndMarkViewed(doc.publicToken);
      expect(resultMissing.items[0]!.listing).toBeUndefined();
      expect(resultMissing.title).toBe(doc.title);
    });
  });
});
