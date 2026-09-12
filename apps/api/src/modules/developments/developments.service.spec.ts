import { NotFoundException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DevelopmentsService } from './developments.service';
import type { DevelopmentRepository } from '@baza/development';
import type { BuildingRepository } from './repository/building.repository';
import type { SectionRepository } from './repository/section.repository';
import type { FloorRepository } from './repository/floor.repository';
import type { FloorPlanRepository } from './repository/floor-plan.repository';
import type { UnitRepository } from './repository/unit.repository';
import type { AuditService } from '../audit/audit.service';
import type { OutboxService } from '../outbox/outbox.service';
import type { PublicationService } from '../publication/publication.service';
import type { MarketplacePublicationRepository } from '@baza/publication';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { InstallmentPlanRepository } from './repository/installment-plan.repository';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeService(overrides: {
  developmentRepository?: Partial<DevelopmentRepository>;
  buildingRepository?: Partial<BuildingRepository>;
  sectionRepository?: Partial<SectionRepository>;
  floorRepository?: Partial<FloorRepository>;
  floorPlanRepository?: Partial<FloorPlanRepository>;
  unitRepository?: Partial<UnitRepository>;
  auditService?: Partial<AuditService>;
  outboxService?: Partial<OutboxService>;
  publicationService?: Partial<PublicationService>;
  publicationRepository?: Partial<MarketplacePublicationRepository>;
  idempotencyService?: Partial<IdempotencyService>;
  organizationsService?: Partial<OrganizationsService>;
  installmentPlanRepository?: Partial<InstallmentPlanRepository>;
} = {}) {
  return new DevelopmentsService(
    makeMockConnection() as never,
    // lockCurrency — то же самое: дефолт «первый лок всегда успешен»,
    // чтобы тесты не про валюту не знали про CAS-механизм (13.09.2026).
    {
      lockCurrency: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides.developmentRepository,
    } as unknown as DevelopmentRepository,
    // Дефолты для проверки «одна валюта на ЖК» (12.09.2026): она ищет
    // корпус, его ЖК и валюты уже заведённых юнитов. Тестам не про валюту
    // незачем это описывать, поэтому по умолчанию ЖК пустой, и любая
    // валюта проходит; сама проверка покрыта интеграционным тестом
    // development-single-currency. Явные переопределения теста побеждают.
    {
      findByIdForOrganization: jest.fn().mockResolvedValue({ developmentId: new Types.ObjectId() }),
      listByDevelopmentId: jest.fn().mockResolvedValue([]),
      ...overrides.buildingRepository,
    } as unknown as BuildingRepository,
    (overrides.sectionRepository ?? {}) as SectionRepository,
    (overrides.floorRepository ?? {}) as FloorRepository,
    (overrides.floorPlanRepository ?? {}) as FloorPlanRepository,
    {
      findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId: new Types.ObjectId() }),
      listDistinctCurrenciesForBuildings: jest.fn().mockResolvedValue([]),
      ...overrides.unitRepository,
    } as unknown as UnitRepository,
    (overrides.auditService ?? { append: jest.fn().mockResolvedValue(undefined) }) as AuditService,
    (overrides.outboxService ?? { publish: jest.fn().mockResolvedValue(undefined) }) as OutboxService,
    (overrides.publicationService ?? {}) as PublicationService,
    (overrides.publicationRepository ?? {}) as MarketplacePublicationRepository,
    (overrides.idempotencyService ??
      { record: jest.fn().mockResolvedValue(undefined), checkReplay: jest.fn().mockResolvedValue(null) }) as IdempotencyService,
    // Дефолт — organization.type:'developer', чтобы существующие тесты
    // createDevelopment/publishDevelopment (не про эту проверку) не ломались
    // новым гейтом; тесты именно на organization.type переопределяют явно.
    (overrides.organizationsService ??
      { getOrganizationById: jest.fn().mockResolvedValue({ type: 'developer' }) }) as OrganizationsService,
    (overrides.installmentPlanRepository ?? {}) as InstallmentPlanRepository,
  );
}

/** Идемпотентность в этих тестах не проверяется — важен сам вызов репозитория. */
function idem(operation = 'test') {
  return { identityId: new Types.ObjectId(), operation, key: new Types.ObjectId().toString(), requestBody: { probe: 1 } };
}

describe('DevelopmentsService — только organization.type:developer создаёт/публикует ЖК', () => {
  /**
   * permission-matrix.md: default grants дают development.edit owner/
   * director НЕЗАВИСИМО от organization.type — PolicyEvaluatorService не
   * знает о domain-атрибутах ресурса (её собственный docstring делегирует
   * это вызывающему command handler'у). Без явной server-side проверки
   * agency (или independent_realtor) с обычной owner/director-ролью могла
   * бы через API создавать и публиковать ЖК наравне с застройщиком.
   */
  it('createDevelopment отклоняет organization.type:agency', async () => {
    const organizationId = new Types.ObjectId();
    const createSpy = jest.fn();

    const service = makeService({
      organizationsService: { getOrganizationById: jest.fn().mockResolvedValue({ type: 'agency' }) },
      developmentRepository: { create: createSpy },
    });

    await expect(
      service.createDevelopment({
        organizationId,
        name: 'ЖК Нелегальный',
        location: { country: 'Georgia', city: 'Batumi', geo: { type: 'Point', coordinates: [41.6, 41.6] } },
        contact: { phone: '+995500000000' },
        idempotency: idem(),
      }),
    ).rejects.toMatchObject({ code: 'DEVELOPMENT_REQUIRES_DEVELOPER_ORGANIZATION' });

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('createDevelopment отклоняет organization.type:independent_realtor', async () => {
    const service = makeService({
      organizationsService: { getOrganizationById: jest.fn().mockResolvedValue({ type: 'independent_realtor' }) },
    });

    await expect(
      service.createDevelopment({
        organizationId: new Types.ObjectId(),
        name: 'ЖК Нелегальный',
        location: { country: 'Georgia', city: 'Batumi', geo: { type: 'Point', coordinates: [41.6, 41.6] } },
        contact: { phone: '+995500000000' },
        idempotency: idem(),
      }),
    ).rejects.toMatchObject({ code: 'DEVELOPMENT_REQUIRES_DEVELOPER_ORGANIZATION' });
  });

  it('createDevelopment разрешает organization.type:developer', async () => {
    const createSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
    const service = makeService({
      organizationsService: { getOrganizationById: jest.fn().mockResolvedValue({ type: 'developer' }) },
      developmentRepository: { create: createSpy },
    });

    await service.createDevelopment({
      organizationId: new Types.ObjectId(),
      name: 'ЖК Легальный',
      location: { country: 'Georgia', city: 'Batumi', geo: { type: 'Point', coordinates: [41.6, 41.6] } },
      contact: { phone: '+995500000000' },
        idempotency: idem(),
      });

    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('publishDevelopment отклоняет organization.type:agency ДО начала транзакции/idempotency-проверки', async () => {
    const findByIdForOrganizationSpy = jest.fn();
    const checkReplaySpy = jest.fn();

    const service = makeService({
      organizationsService: { getOrganizationById: jest.fn().mockResolvedValue({ type: 'agency' }) },
      developmentRepository: { findByIdForOrganization: findByIdForOrganizationSpy },
      idempotencyService: { checkReplay: checkReplaySpy, record: jest.fn() },
    });

    await expect(
      service.publishDevelopment({
        id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        idempotencyKey: 'agency-publish-key',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toMatchObject({ code: 'DEVELOPMENT_REQUIRES_DEVELOPER_ORGANIZATION' });

    // Не должно быть попытки прочитать/записать Development или idempotency —
    // отказ происходит ДО транзакции, не тратит её впустую.
    expect(findByIdForOrganizationSpy).not.toHaveBeenCalled();
    expect(checkReplaySpy).not.toHaveBeenCalled();
  });

  it('publishDevelopment разрешает organization.type:developer (существующее поведение не сломано)', async () => {
    const service = makeService({
      organizationsService: { getOrganizationById: jest.fn().mockResolvedValue({ type: 'developer' }) },
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'draft' }),
        updateStatus: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      publicationService: {
        requestPublication: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), status: 'publication_pending' }),
      },
    });

    const result = await service.publishDevelopment({
      id: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      idempotencyKey: 'developer-publish-key',
      correlationId: 'test-correlation-id',
    });

    expect(result.status).toBe('publication_pending');
  });
});

describe('DevelopmentsService — tenant isolation on child entity creation', () => {
  it('createBuilding отклоняет, если development не найден в организации', async () => {
    const findByIdForOrganization = jest.fn().mockResolvedValue(null);
    const createBuildingSpy = jest.fn();

    const service = makeService({
      developmentRepository: { findByIdForOrganization },
      buildingRepository: { create: createBuildingSpy },
    });

    await expect(
      service.createBuilding({
        developmentId: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        name: 'Building A',
        floorsCount: 10,
      idempotency: idem(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createBuildingSpy).not.toHaveBeenCalled();
  });

  it('createFloor отклоняет, если building не найден в организации', async () => {
    const findBuildingByIdForOrganization = jest.fn().mockResolvedValue(null);
    const createFloorSpy = jest.fn();

    const service = makeService({
      buildingRepository: { findByIdForOrganization: findBuildingByIdForOrganization },
      floorRepository: { create: createFloorSpy },
    });

    await expect(
      service.createFloor({
        buildingId: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        floorNumber: 5,
      idempotency: idem(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createFloorSpy).not.toHaveBeenCalled();
  });

  /**
   * Section существует в организации, но принадлежит ДРУГОМУ building —
   * не должна позволить прикрепить floor к чужому building через
   * подставную section. Прямая tenant/hierarchy-escape проверка.
   */
  it('createFloor отклоняет, если sectionId принадлежит ДРУГОМУ building той же организации', async () => {
    const buildingId = new Types.ObjectId();
    const otherBuildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();

    const service = makeService({
      buildingRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId, organizationId }),
      },
      sectionRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId: otherBuildingId }),
      },
    });

    await expect(
      service.createFloor({
        buildingId,
        sectionId: new Types.ObjectId(),
        organizationId,
        floorNumber: 3,
      idempotency: idem(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * Прямая проверка находки из паттерна assignOccupant/confirmUpload:
   * floorId существует в организации, но принадлежит ДРУГОМУ building,
   * чем переданный явно buildingId — createUnit не должен позволить
   * создать unit, "приписав" его к чужому building через floorId.
   */
  it('createUnit отклоняет, если floorId принадлежит ДРУГОМУ building, чем указанный buildingId', async () => {
    const buildingId = new Types.ObjectId();
    const otherBuildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const createUnitSpy = jest.fn();

    const service = makeService({
      floorRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId: otherBuildingId }),
      },
      unitRepository: { create: createUnitSpy },
    });

    await expect(
      service.createUnit({
        buildingId,
        floorId: new Types.ObjectId(),
        organizationId,
        number: '101',
        kind: 'apartment',
        area: 45,
        price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idem(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createUnitSpy).not.toHaveBeenCalled();
  });

  it('createUnit отклоняет, если floorPlanId принадлежит ДРУГОМУ building', async () => {
    const buildingId = new Types.ObjectId();
    const otherBuildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const floorId = new Types.ObjectId();

    const service = makeService({
      floorRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId }),
      },
      floorPlanRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId: otherBuildingId }),
      },
    });

    await expect(
      service.createUnit({
        buildingId,
        floorId,
        organizationId,
        number: '101',
        kind: 'apartment',
        area: 45,
        price: { amountMinorUnits: 10_000_000, currency: 'USD' },
        floorPlanId: new Types.ObjectId(),
      idempotency: idem(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createUnit создаёт unit, если floor/floorPlan реально принадлежат указанному building', async () => {
    const buildingId = new Types.ObjectId();
    const floorId = new Types.ObjectId();
    const floorPlanId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const createUnitSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = makeService({
      floorRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId }) },
      floorPlanRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId }) },
      unitRepository: { create: createUnitSpy },
    });

    await service.createUnit({
      buildingId,
      floorId,
      organizationId,
      number: '101',
      kind: 'apartment',
      area: 45,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      floorPlanId,
      idempotency: idem(),
    });

    expect(createUnitSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * Раньше controller не передавал sectionId вообще (CreateUnitDto его не
   * содержал), сервис создавал Unit без sectionId, даже если Floor реально
   * принадлежит секции — ломает фильтрацию по секции в шахматке/остатках.
   * sectionId теперь серверный: берётся из уже проверенного floor.sectionId,
   * клиент его не передаёт и не может подделать.
   */
  it('createUnit проставляет sectionId из floor.sectionId, если этаж принадлежит секции', async () => {
    const buildingId = new Types.ObjectId();
    const floorId = new Types.ObjectId();
    const sectionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const createUnitSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = makeService({
      floorRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId, sectionId }) },
      unitRepository: { create: createUnitSpy },
    });

    await service.createUnit({
      buildingId,
      floorId,
      organizationId,
      number: '101',
      kind: 'apartment',
      area: 45,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idem(),
    });

    expect(createUnitSpy).toHaveBeenCalledWith(expect.objectContaining({ sectionId }), expect.anything());
  });

  it('createUnit оставляет sectionId undefined, если этаж не принадлежит секции', async () => {
    const buildingId = new Types.ObjectId();
    const floorId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const createUnitSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = makeService({
      floorRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ buildingId, sectionId: undefined }) },
      unitRepository: { create: createUnitSpy },
    });

    await service.createUnit({
      buildingId,
      floorId,
      organizationId,
      number: '101',
      kind: 'apartment',
      area: 45,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      idempotency: idem(),
    });

    expect(createUnitSpy).toHaveBeenCalledWith(expect.objectContaining({ sectionId: undefined }), expect.anything());
  });
});

describe('DevelopmentsService.createSection', () => {
  it('создаёт section, если building найден в организации', async () => {
    const buildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const createSectionSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId }) },
      sectionRepository: { create: createSectionSpy },
    });

    await service.createSection({ buildingId, organizationId, name: 'Секция А', idempotency: idem() });

    expect(createSectionSpy).toHaveBeenCalledWith({ buildingId, organizationId, name: 'Секция А' }, expect.anything());
  });

  it('отклоняет, если building не найден в организации', async () => {
    const createSectionSpy = jest.fn();
    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      sectionRepository: { create: createSectionSpy },
    });

    await expect(
      service.createSection({ buildingId: new Types.ObjectId(), organizationId: new Types.ObjectId(), name: 'Секция А', idempotency: idem() }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createSectionSpy).not.toHaveBeenCalled();
  });
});

describe('DevelopmentsService.createFloorPlan', () => {
  it('создаёт floor plan, если building найден в организации', async () => {
    const buildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const createFloorPlanSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId }) },
      floorPlanRepository: { create: createFloorPlanSpy },
    });

    await service.createFloorPlan({ buildingId, organizationId, name: 'Планировка 1', rooms: 2, area: 55, idempotency: idem() });

    expect(createFloorPlanSpy).toHaveBeenCalledWith(
      expect.objectContaining({ buildingId, organizationId, name: 'Планировка 1', rooms: 2, area: 55 }),
      expect.anything(),
    );
  });

  it('отклоняет, если building не найден в организации', async () => {
    const createFloorPlanSpy = jest.fn();
    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      floorPlanRepository: { create: createFloorPlanSpy },
    });

    await expect(
      service.createFloorPlan({ buildingId: new Types.ObjectId(), organizationId: new Types.ObjectId(), name: 'X', rooms: 1, area: 30, idempotency: idem() }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createFloorPlanSpy).not.toHaveBeenCalled();
  });
});

describe('DevelopmentsService — optimistic concurrency', () => {
  it('updateDevelopment бросает ConflictException при VERSION_CONFLICT (запись существует, версия устарела)', async () => {
    const developmentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();

    const service = makeService({
      developmentRepository: {
        updateWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }),
      },
    });

    await expect(
      service.updateDevelopment({
        id: developmentId,
        organizationId,
        expectedVersion: 1,
        correlationId: 'corr-1',
        changes: { name: 'New name' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateDevelopment бросает NotFoundException, если запись реально не существует (не version conflict)', async () => {
    const service = makeService({
      developmentRepository: {
        updateWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.updateDevelopment({
        id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        expectedVersion: 1,
        correlationId: 'corr-1',
        changes: { name: 'New name' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateDevelopment перевыпускает PublicationRequested, если публикация сейчас published (D-03 rebuild)', async () => {
    const developmentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const rebuildIfCurrentlyPublished = jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId(), status: 'publication_pending' });

    const service = makeService({
      developmentRepository: {
        updateWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      publicationService: { rebuildIfCurrentlyPublished },
    });

    await service.updateDevelopment({
      id: developmentId,
      organizationId,
      expectedVersion: 1,
      correlationId: 'corr-1',
      changes: { name: 'New name' },
    });

    expect(rebuildIfCurrentlyPublished).toHaveBeenCalledTimes(1);
    expect(rebuildIfCurrentlyPublished).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'development', sourceId: developmentId, correlationId: 'corr-1' }),
      expect.anything(),
    );
  });

  it('updateDevelopment вызывает rebuildIfCurrentlyPublished безусловно, но НЕ переиздаёт событие, если публикация не published (атомарный condition-update внутри, возвращает null)', async () => {
    const rebuildIfCurrentlyPublished = jest.fn().mockResolvedValue(null);

    const service = makeService({
      developmentRepository: {
        updateWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      publicationService: { rebuildIfCurrentlyPublished },
    });

    await service.updateDevelopment({
      id: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      expectedVersion: 1,
      correlationId: 'corr-1',
      changes: { name: 'New name' },
    });

    expect(rebuildIfCurrentlyPublished).toHaveBeenCalledTimes(1);
  });

  it('updateUnitPrice публикует audit+outbox только при успешном version-check', async () => {
    const unitId = new Types.ObjectId();
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);
    const outboxPublishSpy = jest.fn().mockResolvedValue(undefined);

    const service = makeService({
      unitRepository: {
        updatePriceWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      auditService: { append: auditAppendSpy },
      outboxService: { publish: outboxPublishSpy },
    });

    await service.updateUnitPrice({
      unitId,
      organizationId: new Types.ObjectId(),
      expectedVersion: 0,
      price: { amountMinorUnits: 10_000_000, currency: 'USD' },
      actorIdentityId: new Types.ObjectId(),
      actorPositionId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(auditAppendSpy).toHaveBeenCalledTimes(1);
    expect(outboxPublishSpy).toHaveBeenCalledTimes(1);
    expect(outboxPublishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'UnitPriceChanged' }),
      expect.anything(),
    );
  });

  it('updateUnitPrice НЕ публикует audit+outbox при version conflict', async () => {
    const auditAppendSpy = jest.fn();
    const outboxPublishSpy = jest.fn();

    const service = makeService({
      unitRepository: {
        updatePriceWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      },
      auditService: { append: auditAppendSpy },
      outboxService: { publish: outboxPublishSpy },
    });

    await expect(
      service.updateUnitPrice({
        unitId: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        expectedVersion: 0,
        price: { amountMinorUnits: 10_000_000, currency: 'USD' },
        actorIdentityId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(auditAppendSpy).not.toHaveBeenCalled();
    expect(outboxPublishSpy).not.toHaveBeenCalled();
  });

  it('reserveUnit вызывает updateUnitStatus со status:reserved', async () => {
    const updateStatusSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const service = makeService({
      unitRepository: { updateStatusWithVersionCheck: updateStatusSpy },
    });

    await service.reserveUnit({
      unitId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      expectedVersion: 0,
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(updateStatusSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      0,
      'reserved',
      expect.anything(),
      expect.anything(),
    );
  });

  it('releaseUnit вызывает updateUnitStatus со status:available', async () => {
    const updateStatusSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const service = makeService({
      unitRepository: { updateStatusWithVersionCheck: updateStatusSpy },
    });

    await service.releaseUnit({
      unitId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      expectedVersion: 2,
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(updateStatusSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      2,
      'available',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('DevelopmentsService.updateUnitStatus — матрица допустимых переходов', () => {
  /**
   * Раньше PATCH /units/:id/status позволял поставить ЛЮБОЙ статус при
   * подходящей version (напр. sold→available вручную) — портит остатки и
   * шахматку. fromStatuses теперь встроен прямо в атомарный Mongo-фильтр
   * (unit.repository.ts), так что updateStatusWithVersionCheck возвращает
   * modifiedCount:0 и для version conflict, и для запрещённого перехода —
   * сервис различает эти два случая явным чтением текущего статуса.
   */
  it('sold→available отклоняется как запрещённый переход (не version conflict)', async () => {
    const unitId = new Types.ObjectId();
    const auditAppendSpy = jest.fn();
    const outboxPublishSpy = jest.fn();

    const service = makeService({
      unitRepository: {
        updateStatusWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: unitId, status: 'sold', version: 3 }),
      },
      auditService: { append: auditAppendSpy },
      outboxService: { publish: outboxPublishSpy },
    });

    await expect(
      service.updateUnitStatus({
        unitId,
        organizationId: new Types.ObjectId(),
        expectedVersion: 3,
        status: 'available',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toMatchObject({ code: 'UNIT_INVALID_STATUS_TRANSITION' });

    expect(auditAppendSpy).not.toHaveBeenCalled();
    expect(outboxPublishSpy).not.toHaveBeenCalled();
  });

  it('sold — терминальный статус: sold→hidden отклоняется как запрещённый переход', async () => {
    const unitId = new Types.ObjectId();
    const auditAppendSpy = jest.fn();
    const outboxPublishSpy = jest.fn();

    const service = makeService({
      unitRepository: {
        updateStatusWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: unitId, status: 'sold', version: 3 }),
      },
      auditService: { append: auditAppendSpy },
      outboxService: { publish: outboxPublishSpy },
    });

    await expect(
      service.updateUnitStatus({
        unitId,
        organizationId: new Types.ObjectId(),
        expectedVersion: 3,
        status: 'hidden',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toMatchObject({ code: 'UNIT_INVALID_STATUS_TRANSITION' });

    expect(auditAppendSpy).not.toHaveBeenCalled();
    expect(outboxPublishSpy).not.toHaveBeenCalled();
  });

  /**
   * Точный обход, найденный ревью: sold→hidden запрещён напрямую, но если
   * hidden→available остаётся разрешён, тот же результат (проданный лот
   * снова available) достижим за ДВА обычных PATCH-запроса. Раньше
   * sold→hidden был явно в матрице ("модерационный статус, переход не
   * ограничивается") — теперь sold полностью терминален (allowedTargets:
   * []), первый шаг цепочки отклоняется, обход невозможен.
   */
  it('обход через цепочку sold→hidden→available невозможен: первый шаг уже отклонён', async () => {
    const unitId = new Types.ObjectId();

    const service = makeService({
      unitRepository: {
        updateStatusWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: unitId, status: 'sold', version: 5 }),
      },
    });

    // Шаг 1: sold→hidden — должен быть отклонён (это и есть защита от обхода).
    await expect(
      service.updateUnitStatus({
        unitId,
        organizationId: new Types.ObjectId(),
        expectedVersion: 5,
        status: 'hidden',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toMatchObject({ code: 'UNIT_INVALID_STATUS_TRANSITION' });

    // hidden→available сам по себе намеренно остаётся разрешён (hidden —
    // модерационный статус, не часть sale-цикла) — защита от обхода целиком
    // держится на том, что шаг 1 (sold→hidden) не проходит, а не на запрете
    // шага 2.
  });

  it('устаревшая version на легальном переходе даёт ConflictException, а не invalid-transition', async () => {
    const unitId = new Types.ObjectId();

    const service = makeService({
      unitRepository: {
        updateStatusWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: unitId, status: 'available', version: 5 }),
      },
    });

    await expect(
      service.updateUnitStatus({
        unitId,
        organizationId: new Types.ObjectId(),
        expectedVersion: 3,
        status: 'reserved',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reserve/release (available⇄reserved) остаются разрешены', async () => {
    const updateStatusSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const service = makeService({
      unitRepository: { updateStatusWithVersionCheck: updateStatusSpy },
    });

    await service.updateUnitStatus({
      unitId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      expectedVersion: 0,
      status: 'reserved',
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });
    await service.updateUnitStatus({
      unitId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      expectedVersion: 1,
      status: 'available',
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(updateStatusSpy).toHaveBeenCalledTimes(2);
  });
});

describe('DevelopmentsService.publishDevelopment', () => {
  it('бросает NotFoundException, если development не найден в организации', async () => {
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.publishDevelopment({
        id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        idempotencyKey: 'test-idempotency-key',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает ConflictException, если development уже не в статусе draft', async () => {
    const service = makeService({
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'active' }),
      },
    });

    await expect(
      service.publishDevelopment({
        id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        idempotencyKey: 'test-idempotency-key',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('переводит status draft→active И вызывает PublicationService.requestPublication И записывает idempotency-record', async () => {
    const developmentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();
    const updateStatusSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const requestPublicationSpy = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      status: 'publication_pending',
    });
    const recordSpy = jest.fn().mockResolvedValue(undefined);

    const service = makeService({
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'draft' }),
        updateStatus: updateStatusSpy,
      },
      publicationService: { requestPublication: requestPublicationSpy },
      idempotencyService: { record: recordSpy },
    });

    const result = await service.publishDevelopment({
      id: developmentId,
      organizationId,
      actorIdentityId,
      idempotencyKey: 'test-idempotency-key',
      correlationId: 'test-correlation-id',
    });

    expect(updateStatusSpy).toHaveBeenCalledWith(developmentId, organizationId, 'draft', 'active', expect.anything());
    expect(requestPublicationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'development',
        sourceId: developmentId,
        publisherScope: { type: 'organization', organizationId },
      }),
      expect.anything(),
    );
    expect(result).toEqual({ publicationId: expect.any(Types.ObjectId), status: 'publication_pending' });

    // ADR-006: запись idempotency-record ВНУТРИ той же транзакции, что
    // сама бизнес-операция — этот тест проверяет, что она реально
    // вызвана с правильными identity/operation/key, не только что метод
    // в принципе существует.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const [recordParams] = recordSpy.mock.calls[0] as [
      { identityId: typeof actorIdentityId; operation: string; key: string; responseStatus: number },
    ];
    expect(recordParams.identityId).toBe(actorIdentityId);
    expect(recordParams.operation).toBe('publishDevelopment');
    expect(recordParams.key).toBe('test-idempotency-key');
    expect(recordParams.responseStatus).toBe(202);
  });

  it('бросает ConflictException при конкурентном изменении статуса БЕЗ существующего idempotency record (реальный конфликт, не гонка ретрая)', async () => {
    const service = makeService({
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'draft' }),
        updateStatus: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      },
      idempotencyService: {
        checkReplay: jest.fn().mockResolvedValue(null),
        record: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      service.publishDevelopment({
        id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        idempotencyKey: 'test-idempotency-key',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /**
   * Точный баг-репорт: два параллельных publish с ТЕМ ЖЕ Idempotency-Key.
   * checkReplay ДО транзакции (в контроллере) не ловит гонку — оба запроса
   * проходят его одновременно, пока record ещё не написан. Один выигрывает
   * updateStatus и коммитит + пишет record; второй теряет атомарный
   * updateStatus (modifiedCount:0) — раньше это безусловно превращалось в
   * ConflictException, ломая смысл идемпотентности при двойном клике/ретрае.
   * Теперь сервис сам делает checkReplay на этой ветке: если конкурент уже
   * закоммитил ровно ЭТУ попытку (record с тем же key существует), второй
   * запрос должен получить тот же сохранённый результат, а не ошибку.
   */
  it('гонка двух параллельных publish с одним Idempotency-Key: проигравший updateStatus возвращает replay, а не Conflict', async () => {
    const developmentId = new Types.ObjectId();
    const savedReplay = {
      responseStatus: 202,
      responseBody: { id: 'pub-1', sourceType: 'development', sourceId: developmentId.toString(), status: 'publication_pending' },
    };
    const checkReplaySpy = jest.fn().mockResolvedValue(savedReplay);
    const recordSpy = jest.fn();

    const service = makeService({
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'draft' }),
        updateStatus: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      },
      idempotencyService: { checkReplay: checkReplaySpy, record: recordSpy },
    });

    const result = await service.publishDevelopment({
      id: developmentId,
      organizationId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      idempotencyKey: 'race-key',
      correlationId: 'test-correlation-id',
    });

    expect(result.replay).toEqual(savedReplay);
    expect(checkReplaySpy).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'publishDevelopment', key: 'race-key' }),
    );
    // Проигравший НЕ должен пытаться записать ещё один record — единственная
    // запись уже сделана победителем гонки (иначе duplicate key error).
    expect(recordSpy).not.toHaveBeenCalled();
  });

  /**
   * Второй, отдельный путь к той же гонке: withTransaction ретраит ВЕСЬ
   * callback при WriteConflict (не только модифицирует modifiedCount) — на
   * ретрае findByIdForOrganization уже видит status:'active' конкурента,
   * выполнение никогда не доходит до updateStatus, попадает в "status !==
   * draft" ветку В НАЧАЛЕ метода. Без checkOwnReplay() и в этой ветке тоже
   * — интеграционный HTTP-тест (два app.inject() параллельно) поймал именно
   * это: unit-тест на modifiedCount:0 в одиночку не гарантировал закрытие
   * гонки, реальный ретрай MongoDB транзакции идёт другим путём.
   */
  it('гонка: ретрай транзакции видит уже-active статус (не modifiedCount:0) — тоже возвращает replay, а не Conflict', async () => {
    const developmentId = new Types.ObjectId();
    const savedReplay = {
      responseStatus: 202,
      responseBody: { id: 'pub-1', sourceType: 'development', sourceId: developmentId.toString(), status: 'publication_pending' },
    };
    const checkReplaySpy = jest.fn().mockResolvedValue(savedReplay);
    const updateStatusSpy = jest.fn();

    const service = makeService({
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'active' }),
        updateStatus: updateStatusSpy,
      },
      idempotencyService: { checkReplay: checkReplaySpy, record: jest.fn() },
    });

    const result = await service.publishDevelopment({
      id: developmentId,
      organizationId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      idempotencyKey: 'race-key-retry',
      correlationId: 'test-correlation-id',
    });

    expect(result.replay).toEqual(savedReplay);
    // updateStatus не должен вызываться вообще — статус уже не draft,
    // ветка на верхней проверке возвращает replay раньше.
    expect(updateStatusSpy).not.toHaveBeenCalled();
  });

  it('status !== draft БЕЗ существующего idempotency record — обычный ConflictException (реально другая публикация/админ)', async () => {
    const service = makeService({
      developmentRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ status: 'archived' }),
      },
      idempotencyService: { checkReplay: jest.fn().mockResolvedValue(null), record: jest.fn() },
    });

    await expect(
      service.publishDevelopment({
        id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        idempotencyKey: 'unrelated-key',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DevelopmentsService — read hierarchy tenant isolation', () => {
  it('listBuildingsForDevelopment отклоняет, если development не найден в организации', async () => {
    const listForDevelopmentSpy = jest.fn();
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      buildingRepository: { listForDevelopment: listForDevelopmentSpy },
    });

    await expect(
      service.listBuildingsForDevelopment(new Types.ObjectId(), new Types.ObjectId()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(listForDevelopmentSpy).not.toHaveBeenCalled();
  });

  it('listBuildingsForDevelopment делегирует в buildingRepository.listForDevelopment с organizationId', async () => {
    const developmentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const buildings = [{ _id: new Types.ObjectId() }];
    const listForDevelopmentSpy = jest.fn().mockResolvedValue(buildings);

    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
      buildingRepository: { listForDevelopment: listForDevelopmentSpy },
    });

    const result = await service.listBuildingsForDevelopment(developmentId, organizationId);

    expect(listForDevelopmentSpy).toHaveBeenCalledWith(developmentId, organizationId);
    expect(result).toBe(buildings);
  });

  it('listSectionsForBuilding отклоняет, если building не найден в организации', async () => {
    const listForBuildingSpy = jest.fn();
    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      sectionRepository: { listForBuilding: listForBuildingSpy },
    });

    await expect(
      service.listSectionsForBuilding(new Types.ObjectId(), new Types.ObjectId()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(listForBuildingSpy).not.toHaveBeenCalled();
  });

  it('listSectionsForBuilding делегирует в sectionRepository.listForBuilding с organizationId', async () => {
    const buildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const sections = [{ _id: new Types.ObjectId() }];
    const listForBuildingSpy = jest.fn().mockResolvedValue(sections);

    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId }) },
      sectionRepository: { listForBuilding: listForBuildingSpy },
    });

    const result = await service.listSectionsForBuilding(buildingId, organizationId);

    expect(listForBuildingSpy).toHaveBeenCalledWith(buildingId, organizationId);
    expect(result).toBe(sections);
  });

  it('listFloorsForBuilding отклоняет, если building не найден в организации', async () => {
    const listForBuildingSpy = jest.fn();
    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      floorRepository: { listForBuilding: listForBuildingSpy },
    });

    await expect(
      service.listFloorsForBuilding(new Types.ObjectId(), new Types.ObjectId()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(listForBuildingSpy).not.toHaveBeenCalled();
  });

  it('listFloorsForBuilding делегирует в floorRepository.listForBuilding с organizationId', async () => {
    const buildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const floors = [{ _id: new Types.ObjectId() }];
    const listForBuildingSpy = jest.fn().mockResolvedValue(floors);

    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId }) },
      floorRepository: { listForBuilding: listForBuildingSpy },
    });

    const result = await service.listFloorsForBuilding(buildingId, organizationId);

    expect(listForBuildingSpy).toHaveBeenCalledWith(buildingId, organizationId);
    expect(result).toBe(floors);
  });

  it('listFloorPlansForBuilding отклоняет, если building не найден в организации', async () => {
    const listForBuildingSpy = jest.fn();
    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      floorPlanRepository: { listForBuilding: listForBuildingSpy },
    });

    await expect(
      service.listFloorPlansForBuilding(new Types.ObjectId(), new Types.ObjectId()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(listForBuildingSpy).not.toHaveBeenCalled();
  });

  it('listFloorPlansForBuilding делегирует в floorPlanRepository.listForBuilding с organizationId', async () => {
    const buildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const floorPlans = [{ _id: new Types.ObjectId() }];
    const listForBuildingSpy = jest.fn().mockResolvedValue(floorPlans);

    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId }) },
      floorPlanRepository: { listForBuilding: listForBuildingSpy },
    });

    const result = await service.listFloorPlansForBuilding(buildingId, organizationId);

    expect(listForBuildingSpy).toHaveBeenCalledWith(buildingId, organizationId);
    expect(result).toBe(floorPlans);
  });

  it('listUnitsForBuilding отклоняет, если building не найден в организации', async () => {
    const listForBuildingSpy = jest.fn();
    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      unitRepository: { listForBuilding: listForBuildingSpy },
    });

    await expect(
      service.listUnitsForBuilding(new Types.ObjectId(), new Types.ObjectId(), { limit: 100 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(listForBuildingSpy).not.toHaveBeenCalled();
  });

  it('listUnitsForBuilding делегирует в unitRepository.listForBuilding с organizationId и фильтром', async () => {
    const buildingId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const units = [{ _id: new Types.ObjectId() }];
    const listForBuildingSpy = jest.fn().mockResolvedValue(units);

    const service = makeService({
      buildingRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: buildingId }) },
      unitRepository: { listForBuilding: listForBuildingSpy },
    });

    const filter = { kind: 'apartment' as const, status: 'available' as const, limit: 50 };
    const result = await service.listUnitsForBuilding(buildingId, organizationId, filter);

    expect(listForBuildingSpy).toHaveBeenCalledWith(buildingId, organizationId, filter);
    expect(result).toBe(units);
  });
});

describe('DevelopmentsService.getPublicationStatus', () => {
  it('отклоняет, если development не найден в организации (единый 404, не раскрывает существование чужого)', async () => {
    const findBySourceSpy = jest.fn();
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      publicationRepository: { findBySource: findBySourceSpy },
    });

    await expect(
      service.getPublicationStatus(new Types.ObjectId(), new Types.ObjectId()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findBySourceSpy).not.toHaveBeenCalled();
  });

  it('отклоняет с PUBLICATION_NOT_FOUND, если Development существует, но публикация никогда не запускалась (всё ещё draft)', async () => {
    const developmentId = new Types.ObjectId();
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
      publicationRepository: { findBySource: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.getPublicationStatus(developmentId, new Types.ObjectId()),
    ).rejects.toMatchObject({ code: 'PUBLICATION_NOT_FOUND' });
  });

  it('делегирует в publicationRepository.findBySource с sourceType:development и developmentId', async () => {
    const developmentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const findBySourceSpy = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      status: 'publication_pending',
      version: 1,
    });

    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
      publicationRepository: { findBySource: findBySourceSpy },
    });

    await service.getPublicationStatus(developmentId, organizationId);

    expect(findBySourceSpy).toHaveBeenCalledWith('development', developmentId);
  });

  it('возвращает узкий whitelist-объект без внутренних полей публикации (не весь документ)', async () => {
    const publicationId = new Types.ObjectId();
    const publishedAt = new Date('2026-08-27T00:00:00.000Z');
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) },
      publicationRepository: {
        findBySource: jest.fn().mockResolvedValue({
          _id: publicationId,
          status: 'published',
          slug: 'malibu-residence-batumi',
          version: 2,
          publishedAt,
          // Внутренние поля реального документа — НЕ должны попасть в ответ.
          organizationId: new Types.ObjectId(),
          publisherScope: { type: 'organization', organizationId: new Types.ObjectId() },
          sourceId: new Types.ObjectId(),
          searchProjection: { city: 'Batumi' },
          denormalizedFields: { name: 'Malibu Residence' },
        }),
      },
    });

    const result = await service.getPublicationStatus(new Types.ObjectId(), new Types.ObjectId());

    expect(result).toEqual({
      publicationId: publicationId.toString(),
      status: 'published',
      slug: 'malibu-residence-batumi',
      version: 2,
      publishedAt: publishedAt.toISOString(),
      unpublishedAt: undefined,
      buildError: undefined,
    });
  });

  it('status:build_failed возвращает константный безопасный buildError текст (не реальную причину сборки)', async () => {
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) },
      publicationRepository: {
        findBySource: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          status: 'build_failed',
          version: 1,
        }),
      },
    });

    const result = await service.getPublicationStatus(new Types.ObjectId(), new Types.ObjectId());

    expect(result.buildError).toBe('Не удалось опубликовать. Обратитесь в поддержку.');
  });

  it('status !== build_failed НЕ включает buildError', async () => {
    const service = makeService({
      developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) },
      publicationRepository: {
        findBySource: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          status: 'publication_pending',
          version: 0,
        }),
      },
    });

    const result = await service.getPublicationStatus(new Types.ObjectId(), new Types.ObjectId());

    expect(result.buildError).toBeUndefined();
  });
});

describe('DevelopmentsService.buildChessboardExport', () => {
  const organizationId = new Types.ObjectId();
  const developmentId = new Types.ObjectId();
  const buildingId = new Types.ObjectId();
  const floorId = new Types.ObjectId();

  function makeExportService(overrides: {
    development?: unknown;
    buildings?: unknown[];
    floors?: unknown[];
    units?: unknown[];
    unitCount?: number;
  } = {}) {
    const units = overrides.units ?? [];
    return makeService({
      developmentRepository: {
        findByIdForOrganization: jest
          .fn()
          .mockResolvedValue(overrides.development === undefined ? { _id: developmentId, name: 'Sea Towers' } : overrides.development),
      },
      buildingRepository: {
        listForDevelopment: jest
          .fn()
          .mockResolvedValue(overrides.buildings ?? [{ _id: buildingId, name: 'Корпус 1' }]),
      },
      floorRepository: {
        listForBuildings: jest
          .fn()
          .mockResolvedValue(overrides.floors ?? [{ _id: floorId, floorNumber: 3 }]),
      },
      unitRepository: {
        countForBuildings: jest.fn().mockResolvedValue(overrides.unitCount ?? units.length),
        listForBuildings: jest.fn().mockResolvedValue(units),
      },
    });
  }

  function makeUnitDoc(overrides: Record<string, unknown> = {}) {
    return {
      buildingId,
      floorId,
      number: 'A-0301',
      rooms: 2,
      area: 58,
      price: { amountMinorUnits: 12_180_000, currency: 'USD' },
      status: 'available',
      ...overrides,
    };
  }

  it('резолвит имя корпуса и номер этажа по id и отдаёт имя ЖК с валютой', async () => {
    const service = makeExportService({ units: [makeUnitDoc()] });

    const result = await service.buildChessboardExport(developmentId, organizationId);

    expect(result.developmentName).toBe('Sea Towers');
    expect(result.currency).toBe('USD');
    expect(result.units).toEqual([
      {
        buildingName: 'Корпус 1',
        floorNumber: 3,
        number: 'A-0301',
        rooms: 2,
        area: 58,
        priceMinorUnits: 12_180_000,
        status: 'available',
        promotion: undefined,
      },
    ]);
  });

  it('читает только квартиры — паркинги и кладовки в шахматочную выгрузку не идут', async () => {
    const service = makeExportService({ units: [makeUnitDoc()] });

    await service.buildChessboardExport(developmentId, organizationId);

    const unitRepository = (service as unknown as { unitRepository: { listForBuildings: jest.Mock; countForBuildings: jest.Mock } })
      .unitRepository;
    expect(unitRepository.listForBuildings).toHaveBeenCalledWith([buildingId], organizationId, { kind: 'apartment' });
    expect(unitRepository.countForBuildings).toHaveBeenCalledWith([buildingId], organizationId, { kind: 'apartment' });
  });

  it('чужой или несуществующий ЖК — 404, до любого чтения юнитов', async () => {
    const service = makeExportService({ development: null });

    await expect(service.buildChessboardExport(developmentId, organizationId)).rejects.toThrow(NotFoundException);
    const unitRepository = (service as unknown as { unitRepository: { listForBuildings: jest.Mock } }).unitRepository;
    expect(unitRepository.listForBuildings).not.toHaveBeenCalled();
  });

  it('смешанные валюты в одном ЖК — явная ошибка, а не файл с неверной подписью колонок', async () => {
    const service = makeExportService({
      units: [
        makeUnitDoc({ price: { amountMinorUnits: 100, currency: 'USD' } }),
        makeUnitDoc({ number: 'A-0302', price: { amountMinorUnits: 100, currency: 'GEL' } }),
      ],
    });

    await expect(service.buildChessboardExport(developmentId, organizationId)).rejects.toThrow(
      'Chessboard export requires a single currency across the development',
    );
  });

  it('превышение потолка выгрузки отклоняется ДО чтения юнитов в память', async () => {
    const service = makeExportService({ unitCount: 20_001 });

    await expect(service.buildChessboardExport(developmentId, organizationId)).rejects.toThrow(
      'Chessboard export is limited to 20000 units',
    );
    const unitRepository = (service as unknown as { unitRepository: { listForBuildings: jest.Mock } }).unitRepository;
    expect(unitRepository.listForBuildings).not.toHaveBeenCalled();
  });

  it('ЖК без корпусов отдаёт пустую выгрузку, а не падает', async () => {
    const service = makeExportService({ buildings: [], floors: [], units: [] });

    const result = await service.buildChessboardExport(developmentId, organizationId);

    expect(result.units).toEqual([]);
    expect(result.currency).toBe('USD');
  });

  it('строки отсортированы корпус → этаж → номер', async () => {
    const otherBuildingId = new Types.ObjectId();
    const otherFloorId = new Types.ObjectId();
    const service = makeExportService({
      buildings: [
        { _id: buildingId, name: 'Корпус 2' },
        { _id: otherBuildingId, name: 'Корпус 1' },
      ],
      floors: [
        { _id: floorId, floorNumber: 2 },
        { _id: otherFloorId, floorNumber: 10 },
      ],
      units: [
        makeUnitDoc({ number: 'B-0201' }),
        makeUnitDoc({ buildingId: otherBuildingId, floorId: otherFloorId, number: 'A-1001' }),
      ],
    });

    const result = await service.buildChessboardExport(developmentId, organizationId);

    expect(result.units.map((u) => u.number)).toEqual(['A-1001', 'B-0201']);
  });
});

describe('DevelopmentsService — Installment Plans', () => {
  const developmentId = new Types.ObjectId();
  const organizationId = new Types.ObjectId();

  describe('createInstallmentPlan', () => {
    it('отклоняет, если ЖК не найден в организации', async () => {
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.createInstallmentPlan({
          developmentId,
          organizationId,
          title: 'Тест',
          downPaymentType: 'percent',
          downPaymentValue: 30,
          termType: 'months_from_current_date',
          paymentFrequency: 'monthly',
          idempotency: idem(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('отклоняет, если unitId указан, но не найден в организации', async () => {
      const unitId = new Types.ObjectId();
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
        unitRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.createInstallmentPlan({
          developmentId,
          organizationId,
          unitId,
          title: 'Тест',
          downPaymentType: 'percent',
          downPaymentValue: 30,
          termType: 'months_from_current_date',
          paymentFrequency: 'monthly',
          idempotency: idem(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('создаёт план через репозиторий при валидных параметрах', async () => {
      const mockCreated = { _id: new Types.ObjectId(), title: 'Тест' };
      const createSpy = jest.fn().mockResolvedValue(mockCreated);
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
        installmentPlanRepository: { create: createSpy },
      });

      const result = await service.createInstallmentPlan({
        developmentId,
        organizationId,
        title: 'Тест',
        downPaymentType: 'percent',
        downPaymentValue: 30,
        termType: 'months_from_current_date',
        paymentFrequency: 'monthly',
        idempotency: idem(),
      });

      expect(result).toBe(mockCreated);
      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe('listInstallmentPlans', () => {
    it('отклоняет, если ЖК не найден в организации', async () => {
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.listInstallmentPlans(developmentId, organizationId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('делегирует в installmentPlanRepository.listForDevelopment', async () => {
      const mockList = [{ id: '1' }];
      const listSpy = jest.fn().mockResolvedValue(mockList);
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
        installmentPlanRepository: { listForDevelopment: listSpy },
      });

      const result = await service.listInstallmentPlans(developmentId, organizationId);
      expect(result).toBe(mockList);
      expect(listSpy).toHaveBeenCalledWith(developmentId, organizationId, {});
    });
  });

  describe('updateInstallmentPlan', () => {
    it('бросает ConflictException при расхождении версий', async () => {
      const planId = new Types.ObjectId();
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
        installmentPlanRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({ _id: planId, developmentId }),
          updateWithVersionCheck: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(
        service.updateInstallmentPlan({
          id: planId,
          developmentId,
          organizationId,
          expectedVersion: 1,
          patch: { title: 'New' },
          idempotency: idem(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deleteInstallmentPlan', () => {
    it('бросает ConflictException при расхождении версий', async () => {
      const planId = new Types.ObjectId();
      const service = makeService({
        developmentRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }) },
        installmentPlanRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({ _id: planId, developmentId }),
          deleteWithVersionCheck: jest.fn().mockResolvedValue(false),
        },
      });

      await expect(
        service.deleteInstallmentPlan({
          id: planId,
          developmentId,
          organizationId,
          expectedVersion: 1,
          idempotency: idem(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('batchUpdatePrices', () => {
    it('обновляет цены юнитов и публикует UnitPriceChanged в outbox', async () => {
      const u1Id = new Types.ObjectId();
      const floorId = new Types.ObjectId();

      const units = [
        {
          _id: u1Id,
          number: '101',
          floorId,
          area: 50,
          price: { amountMinorUnits: 5000000, currency: 'USD' },
          version: 0,
        },
      ];

      const outboxPublished: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
      const service = makeService({
        developmentRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }),
        },
        buildingRepository: {
          listForDevelopment: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
        },
        floorRepository: {
          listForBuildings: jest.fn().mockResolvedValue([{ _id: floorId, floorNumber: 1 }]),
        },
        unitRepository: {
          listForBuildings: jest.fn().mockResolvedValue(units),
          updatePriceWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        },
        outboxService: {
          publish: jest.fn().mockImplementation((event) => {
            outboxPublished.push(event);
            return Promise.resolve();
          }),
        },
      });

      const result = await service.batchUpdatePrices({
        developmentId,
        organizationId,
        operationType: 'percentage',
        value: 10,
        actorIdentityId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        correlationId: 'test-cid',
        idempotency: idem(),
      });

      expect(result.updatedCount).toBe(1);
      expect(outboxPublished.length).toBe(1);
      expect(outboxPublished[0]?.eventType).toBe('UnitPriceChanged');
      expect(outboxPublished[0]?.payload.amountMinorUnits).toBe(5500000);
    });

    it('выбрасывает ConflictException если updatePriceWithVersionCheck возвращает modifiedCount: 0', async () => {
      const u1Id = new Types.ObjectId();
      const floorId = new Types.ObjectId();

      const units = [
        {
          _id: u1Id,
          number: '101',
          floorId,
          area: 50,
          price: { amountMinorUnits: 5000000, currency: 'USD' },
          version: 0,
        },
      ];

      const service = makeService({
        developmentRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({ _id: developmentId }),
        },
        buildingRepository: {
          listForDevelopment: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
        },
        floorRepository: {
          listForBuildings: jest.fn().mockResolvedValue([{ _id: floorId, floorNumber: 1 }]),
        },
        unitRepository: {
          listForBuildings: jest.fn().mockResolvedValue(units),
          updatePriceWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
        outboxService: { publish: jest.fn() },
      });

      await expect(
        service.batchUpdatePrices({
          developmentId,
          organizationId,
          operationType: 'percentage',
          value: 10,
          actorIdentityId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          correlationId: 'test-cid',
          idempotency: idem(),
        }),
      ).rejects.toThrow('Unit 101 was modified by another request — refresh and retry');
    });
  });
});

