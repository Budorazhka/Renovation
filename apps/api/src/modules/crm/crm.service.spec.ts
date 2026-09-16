import { MediaService } from '../media/media.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CrmService, toTaskReadModel } from './crm.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { MarketplacePublicationRepository } from '@baza/publication';
import type { DevelopmentRepository } from '@baza/development';
import type { ListingRepository, PropertyAssetRepository } from '@baza/property-assets';
import type { ContactRepository } from './repository/contact.repository';
import type { ContactSegment } from './schemas/contact.schema';
import type { LeadRepository } from './repository/lead.repository';
import type { LeadEventRepository } from './repository/lead-event.repository';
import type { AuditService } from '../audit/audit.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { PublicRevealIdempotencyService } from '../../shared/idempotency/public-reveal-idempotency.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';

import type { TaskRepository } from './repository/task.repository';
import type { DealRepository } from './repository/deal.repository';
import type { DealEventRepository } from './repository/deal-event.repository';
import type { OutboxService } from '../outbox/outbox.service';
import type { CalendarEventRepository } from './repository/calendar-event.repository';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

function createTestCrmService(overrides: {
  connection?: unknown;
  publicationRepository?: unknown;
  developmentRepository?: unknown;
  listingRepository?: unknown;
  propertyAssetRepository?: unknown;
  contactRepository?: unknown;
  leadRepository?: unknown;
  leadEventRepository?: unknown;
  auditService?: unknown;
  organizationsService?: unknown;
  publicRevealIdempotencyService?: unknown;
  idempotencyService?: unknown;
  taskRepository?: unknown;
  dealRepository?: unknown;
  dealEventRepository?: unknown;
  outboxService?: unknown;
  mediaService?: unknown;
  calendarEventRepository?: unknown;
} = {}) {
  return new CrmService(
    (overrides.connection ?? makeMockConnection()) as never,
    (overrides.publicationRepository ?? {}) as unknown as MarketplacePublicationRepository,
    (overrides.developmentRepository ?? {}) as unknown as DevelopmentRepository,
    (overrides.listingRepository ?? {}) as unknown as ListingRepository,
    (overrides.propertyAssetRepository ?? {}) as unknown as PropertyAssetRepository,
    (overrides.contactRepository ?? {}) as unknown as ContactRepository,
    (overrides.leadRepository ?? {}) as unknown as LeadRepository,
    (overrides.leadEventRepository ?? {}) as unknown as LeadEventRepository,
    (overrides.auditService ?? {}) as unknown as AuditService,
    (overrides.organizationsService ?? {
      findAssignablePosition: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), status: 'vacant' }),
    }) as unknown as OrganizationsService,
    (overrides.publicRevealIdempotencyService ?? {
      checkReplay: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    }) as unknown as PublicRevealIdempotencyService,
    (overrides.idempotencyService ?? {
      checkReplay: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    }) as unknown as IdempotencyService,
    (overrides.taskRepository ?? {
      distinctLeadIdsWithOpenTask: jest.fn().mockResolvedValue([]),
      countOpenForLead: jest.fn().mockResolvedValue(0),
    }) as unknown as TaskRepository,
    (overrides.dealRepository ?? {}) as unknown as DealRepository,
    (overrides.dealEventRepository ?? {}) as unknown as DealEventRepository,
    (overrides.outboxService ?? { publish: jest.fn().mockResolvedValue(undefined) }) as unknown as OutboxService,
    (overrides.mediaService ?? {
      getAssetsForOwnerScope: jest.fn().mockResolvedValue(new Map()),
    }) as unknown as MediaService,
    (overrides.calendarEventRepository ?? {}) as unknown as CalendarEventRepository,
  );
}

function makeDevelopment(overrides: Partial<{ organizationId: Types.ObjectId }> = {}) {
  return {
    _id: new Types.ObjectId(),
    organizationId: overrides.organizationId ?? new Types.ObjectId(),
    contact: { phone: '+79991234567', whatsapp: '+79991234567', telegram: undefined },
  };
}

function makePublication(overrides: Partial<{ sourceType: string; sourceId: Types.ObjectId; slug: string }> = {}) {
  return {
    _id: new Types.ObjectId(),
    sourceType: overrides.sourceType ?? 'development',
    sourceId: overrides.sourceId ?? new Types.ObjectId(),
    slug: overrides.slug ?? 'test-slug',
  };
}

function makeListing(overrides: Partial<{ propertyAssetId: Types.ObjectId; publisherScope: { type: string; organizationId: Types.ObjectId } }> = {}) {
  return {
    _id: new Types.ObjectId(),
    propertyAssetId: overrides.propertyAssetId ?? new Types.ObjectId(),
    publisherScope: overrides.publisherScope ?? { type: 'organization', organizationId: new Types.ObjectId() },
    status: 'active',
  };
}

function makePropertyAsset(overrides: Partial<{ publisherScope: { type: string; organizationId?: Types.ObjectId }; representativePhone: string }> = {}) {
  return {
    _id: new Types.ObjectId(),
    publisherScope: overrides.publisherScope ?? { type: 'organization', organizationId: new Types.ObjectId() },
    representativePhone: overrides.representativePhone ?? '+995555000111',
  };
}

describe('CrmService.revealContact', () => {
  it('создаёт Contact+Lead+LeadEvent+audit транзакционно и возвращает контактные каналы Development', async () => {
    const organizationId = new Types.ObjectId();
    const development = makeDevelopment({ organizationId });
    const publication = makePublication({ sourceId: development._id });
    const contactId = new Types.ObjectId();
    const leadId = new Types.ObjectId();

    const findBySlugSpy = jest.fn().mockResolvedValue(publication);
    const findByIdSpy = jest.fn().mockResolvedValue(development);
    const findByPhoneSpy = jest.fn().mockResolvedValue(null);
    const createContactSpy = jest.fn().mockResolvedValue({ _id: contactId });
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: leadId });
    const appendEventSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      publicationRepository: { findBySlug: findBySlugSpy },
      developmentRepository: { findById: findByIdSpy },
      contactRepository: { findByPhone: findByPhoneSpy, create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: appendEventSpy },
      auditService: { append: auditAppendSpy },
    });

    const result = await service.revealContact({
      slug: 'zhk-solnechnyy',
      requesterName: 'Иван',
      requesterPhone: '+79997654321',
      correlationId: 'test-correlation-id',
    });

    expect(createContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, phone: '+79997654321', name: 'Иван', roles: ['buyer'] }),
      expect.anything(),
    );
    expect(createLeadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        contactId,
        productType: 'sales',
        stage: 'new',
        source: expect.objectContaining({ route: '/developments/zhk-solnechnyy', publicationId: publication._id }),
      }),
      expect.anything(),
    );
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId, organizationId, stage: 'new', changedBy: { type: 'system' } }),
      expect.anything(),
    );
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'system' },
        action: 'lead.create_from_reveal',
        resource: 'lead',
        resourceId: leadId,
      }),
      expect.anything(),
    );
    expect(result).toEqual({ phone: '+79991234567', whatsapp: '+79991234567', telegram: undefined, leadId });
  });

  it('переиспользует существующий Contact по tenant-local phone dedupe, но создаёт новый Lead', async () => {
    const organizationId = new Types.ObjectId();
    const development = makeDevelopment({ organizationId });
    const publication = makePublication({ sourceId: development._id });
    const existingContact = { _id: new Types.ObjectId() };

    const findByPhoneSpy = jest.fn().mockResolvedValue(existingContact);
    const createContactSpy = jest.fn();
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      developmentRepository: { findById: jest.fn().mockResolvedValue(development) },
      contactRepository: { findByPhone: findByPhoneSpy, create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    await service.revealContact({
      slug: 'zhk-solnechnyy',
      requesterPhone: '+79997654321',
      correlationId: 'test-correlation-id',
    });

    expect(createContactSpy).not.toHaveBeenCalled();
    expect(createLeadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: existingContact._id }),
      expect.anything(),
    );
  });

  it('«Показать телефон» без формы: отдаёт номер застройщика, лид и контакт не создаёт, просмотр пишет в журнал', async () => {
    const development = makeDevelopment();
    const publication = makePublication({ sourceId: development._id });
    const createContactSpy = jest.fn();
    const createLeadSpy = jest.fn();
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      developmentRepository: { findById: jest.fn().mockResolvedValue(development) },
      contactRepository: { findByPhone: jest.fn(), create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn() },
      auditService: { append: auditAppendSpy },
    });

    const result = await service.revealContact({ slug: 'zhk-solnechnyy', correlationId: 'test-correlation-id' });

    expect(result.phone).toBe(development.contact.phone);
    expect(result.leadId).toBeUndefined();
    expect(createContactSpy).not.toHaveBeenCalled();
    expect(createLeadSpy).not.toHaveBeenCalled();
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publication.contact_view', resource: 'publication', resourceId: publication._id }),
    );
  });

  it('бросает NotFoundException, если publication не найдена по slug', async () => {
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.revealContact({
        slug: 'unknown-slug',
        requesterPhone: '+79997654321',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException, если publication.sourceType не development', async () => {
    const publication = makePublication({ sourceType: 'unit' });
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
    });

    await expect(
      service.revealContact({
        slug: 'zhk-solnechnyy',
        requesterPhone: '+79997654321',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException, если publication опубликована, но Development недоступен (рассинхронизация)', async () => {
    const publication = makePublication();
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      developmentRepository: { findById: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.revealContact({
        slug: 'zhk-solnechnyy',
        requesterPhone: '+79997654321',
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CrmService.revealListingContact — Idempotency-Key (опциональный гостевой механизм)', () => {
  function seedPublishedListingMocks() {
    const organizationId = new Types.ObjectId();
    const propertyAsset = makePropertyAsset({
      publisherScope: { type: 'organization', organizationId },
      representativePhone: '+995555123456',
    });
    const listing = makeListing({ propertyAssetId: propertyAsset._id });
    const publication = makePublication({ sourceType: 'listing', sourceId: listing._id, slug: 'batumi-flat-85k' });
    return { organizationId, propertyAsset, listing, publication };
  }

  it('без заголовка Idempotency-Key — полностью обратно совместимо: не вызывает checkReplay/record', async () => {
    const { propertyAsset, listing, publication } = seedPublishedListingMocks();
    const checkReplaySpy = jest.fn();
    const recordSpy = jest.fn();
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      contactRepository: { findByPhone: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
      publicRevealIdempotencyService: { checkReplay: checkReplaySpy, record: recordSpy },
    });

    await service.revealListingContact({
      slug: 'batumi-flat-85k',
      requesterPhone: '+995599887766',
      correlationId: 'test-correlation',
    });

    expect(checkReplaySpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(createLeadSpy).toHaveBeenCalledTimes(1);
  });

  it('с заголовком, найдена совпадающая запись — возвращает сохранённый ответ, НЕ создаёт новый Lead/audit', async () => {
    const { propertyAsset, listing, publication } = seedPublishedListingMocks();
    const storedLeadId = new Types.ObjectId();
    const checkReplaySpy = jest.fn().mockResolvedValue({
      responseStatus: 200,
      responseBody: { phone: '+995555123456', leadId: storedLeadId.toString() },
    });
    const createLeadSpy = jest.fn();
    const auditAppendSpy = jest.fn();

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      leadRepository: { create: createLeadSpy },
      auditService: { append: auditAppendSpy },
      publicRevealIdempotencyService: { checkReplay: checkReplaySpy, record: jest.fn() },
    });

    const result = await service.revealListingContact({
      slug: 'batumi-flat-85k',
      requesterPhone: '+995599887766',
      correlationId: 'test-correlation',
      idempotencyKey: 'client-key-1',
    });

    expect(result).toEqual({ phone: '+995555123456', whatsapp: undefined, telegram: undefined, leadId: storedLeadId });
    expect(createLeadSpy).not.toHaveBeenCalled();
    expect(auditAppendSpy).not.toHaveBeenCalled();
  });

  it('с заголовком, записи нет — создаёт Lead, записывает idempotency-запись ВНУТРИ транзакции', async () => {
    const { propertyAsset, listing, publication } = seedPublishedListingMocks();
    const leadId = new Types.ObjectId();
    const checkReplaySpy = jest.fn().mockResolvedValue(null);
    const recordSpy = jest.fn().mockResolvedValue(undefined);
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: leadId });

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      contactRepository: { findByPhone: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
      publicRevealIdempotencyService: { checkReplay: checkReplaySpy, record: recordSpy },
    });

    const result = await service.revealListingContact({
      slug: 'batumi-flat-85k',
      requesterPhone: '+995599887766',
      correlationId: 'test-correlation',
      idempotencyKey: 'client-key-2',
    });

    expect(result.leadId).toEqual(leadId);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationSlug: 'batumi-flat-85k',
        idempotencyKey: 'client-key-2',
        responseStatus: 200,
        responseBody: expect.objectContaining({ phone: '+995555123456', leadId: leadId.toString() }),
        leadId,
      }),
      expect.anything(),
    );
  });

  it('гонка: duplicate key при record() — повторный checkReplay находит запись победителя, возвращает её как replay', async () => {
    const { propertyAsset, listing, publication } = seedPublishedListingMocks();
    const winnerLeadId = new Types.ObjectId();
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const checkReplaySpy = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        responseStatus: 200,
        responseBody: { phone: '+995555123456', leadId: winnerLeadId.toString() },
      });
    const recordSpy = jest.fn().mockRejectedValue(duplicateKeyError);
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      contactRepository: { findByPhone: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
      publicRevealIdempotencyService: { checkReplay: checkReplaySpy, record: recordSpy },
    });

    const result = await service.revealListingContact({
      slug: 'batumi-flat-85k',
      requesterPhone: '+995599887766',
      correlationId: 'test-correlation',
      idempotencyKey: 'race-key',
    });

    expect(result.leadId).toEqual(winnerLeadId);
    expect(checkReplaySpy).toHaveBeenCalledTimes(2);
  });

  it('другой requestHash под тем же ключом — пробрасывает IDEMPOTENCY_KEY_CONFLICT (409), не создаёт Lead', async () => {
    const { propertyAsset, listing, publication } = seedPublishedListingMocks();
    const conflictError = new AppException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT, 'conflict');
    const checkReplaySpy = jest.fn().mockRejectedValue(conflictError);
    const createLeadSpy = jest.fn();

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      leadRepository: { create: createLeadSpy },
      publicRevealIdempotencyService: { checkReplay: checkReplaySpy, record: jest.fn() },
    });

    await expect(
      service.revealListingContact({
        slug: 'batumi-flat-85k',
        requesterPhone: '+995599887766',
        correlationId: 'test-correlation',
        idempotencyKey: 'conflict-key',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT });

    expect(createLeadSpy).not.toHaveBeenCalled();
  });
});

describe('CrmService.revealListingContact (LEAD-001 / Secondary & Rent)', () => {
  it('создаёт Contact+Lead+LeadEvent+audit для опубликованного листинга и возвращает representativePhone', async () => {
    const organizationId = new Types.ObjectId();
    const propertyAsset = makePropertyAsset({
      publisherScope: { type: 'organization', organizationId },
      representativePhone: '+995555123456',
    });
    const listing = makeListing({ propertyAssetId: propertyAsset._id });
    const publication = makePublication({ sourceType: 'listing', sourceId: listing._id, slug: 'batumi-flat-85k' });
    const contactId = new Types.ObjectId();
    const leadId = new Types.ObjectId();

    const findBySlugSpy = jest.fn().mockResolvedValue(publication);
    const findListingByIdSpy = jest.fn().mockResolvedValue(listing);
    const findAssetByIdSpy = jest.fn().mockResolvedValue(propertyAsset);
    const findByPhoneSpy = jest.fn().mockResolvedValue(null);
    const createContactSpy = jest.fn().mockResolvedValue({ _id: contactId });
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: leadId });
    const appendEventSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      publicationRepository: { findBySlug: findBySlugSpy },
      listingRepository: { findById: findListingByIdSpy },
      propertyAssetRepository: { findById: findAssetByIdSpy },
      contactRepository: { findByPhone: findByPhoneSpy, create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: appendEventSpy },
      auditService: { append: auditAppendSpy },
    });

    const result = await service.revealListingContact({
      slug: 'batumi-flat-85k',
      requesterName: 'Анна',
      requesterPhone: '+995599887766',
      utm: { source: 'google', campaign: 'summer' },
      referrer: 'https://google.com',
      correlationId: 'test-correlation-listing',
    });

    expect(findBySlugSpy).toHaveBeenCalledWith('batumi-flat-85k');
    expect(findListingByIdSpy).toHaveBeenCalledWith(listing._id);
    expect(findAssetByIdSpy).toHaveBeenCalledWith(propertyAsset._id);

    expect(createContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, phone: '+995599887766', name: 'Анна', roles: ['buyer'] }),
      expect.anything(),
    );
    expect(createLeadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        contactId,
        source: expect.objectContaining({
          route: '/listings/batumi-flat-85k',
          publicationId: publication._id,
          utm: { source: 'google', campaign: 'summer' },
          referrer: 'https://google.com',
        }),
      }),
      expect.anything(),
    );
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId, organizationId, stage: 'new', changedBy: { type: 'system' } }),
      expect.anything(),
    );
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'system' },
        action: 'lead.create_from_reveal',
        resource: 'lead',
        resourceId: leadId,
      }),
      expect.anything(),
    );
    expect(result).toEqual({ phone: '+995555123456', leadId });
    // Proves that no internal fields (organizationId, publisherScope, etc.) are leaked
    expect((result as Record<string, unknown>).organizationId).toBeUndefined();
    expect((result as Record<string, unknown>).publisherScope).toBeUndefined();
  });

  it('переиспользует существующий Contact внутри организации при повторном обращении, но создаёт новый Lead', async () => {
    const organizationId = new Types.ObjectId();
    const propertyAsset = makePropertyAsset({
      publisherScope: { type: 'organization', organizationId },
      representativePhone: '+995555123456',
    });
    const listing = makeListing({ propertyAssetId: propertyAsset._id });
    const publication = makePublication({ sourceType: 'listing', sourceId: listing._id, slug: 'batumi-flat-85k' });
    const existingContact = { _id: new Types.ObjectId(), organizationId, phone: '+995599887766' };

    const findByPhoneSpy = jest.fn().mockResolvedValue(existingContact);
    const createContactSpy = jest.fn();
    const createLeadSpy = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      contactRepository: { findByPhone: findByPhoneSpy, create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    await service.revealListingContact({
      slug: 'batumi-flat-85k',
      requesterPhone: '+995599887766',
      correlationId: 'test-correlation-listing',
    });

    expect(createContactSpy).not.toHaveBeenCalled();
    expect(createLeadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: existingContact._id, organizationId }),
      expect.anything(),
    );
  });

  it('«Показать телефон» без формы: отдаёт номер менеджера объекта, лид не создаёт', async () => {
    const propertyAsset = makePropertyAsset();
    const listing = makeListing({ propertyAssetId: propertyAsset._id });
    const publication = makePublication({ sourceType: 'listing', sourceId: listing._id });
    const createLeadSpy = jest.fn();

    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
      leadRepository: { create: createLeadSpy },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    const result = await service.revealListingContact({ slug: 'batumi-flat-85k', correlationId: 'test-correlation' });

    expect(result).toEqual({ phone: propertyAsset.representativePhone });
    expect(createLeadSpy).not.toHaveBeenCalled();
  });

  it('бросает NotFoundException, если slug не найден', async () => {
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.revealListingContact({ slug: 'non-existent', requesterPhone: '+995555123456', correlationId: 'test' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException, если publication.sourceType === development (не listing)', async () => {
    const publication = makePublication({ sourceType: 'development' });
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
    });

    await expect(
      service.revealListingContact({ slug: 'zhk-solnechnyy', requesterPhone: '+995555123456', correlationId: 'test' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException, если canonical Listing не найден (рассинхронизация)', async () => {
    const publication = makePublication({ sourceType: 'listing' });
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.revealListingContact({ slug: 'batumi-flat-85k', requesterPhone: '+995555123456', correlationId: 'test' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException, если canonical PropertyAsset не найден (рассинхронизация)', async () => {
    const listing = makeListing();
    const publication = makePublication({ sourceType: 'listing', sourceId: listing._id });
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.revealListingContact({ slug: 'batumi-flat-85k', requesterPhone: '+995555123456', correlationId: 'test' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException, если publisherScope PropertyAsset не organization', async () => {
    const propertyAsset = makePropertyAsset({ publisherScope: { type: 'marketplace_account' } });
    const listing = makeListing({ propertyAssetId: propertyAsset._id });
    const publication = makePublication({ sourceType: 'listing', sourceId: listing._id });
    const service = createTestCrmService({
      publicationRepository: { findBySlug: jest.fn().mockResolvedValue(publication) },
      listingRepository: { findById: jest.fn().mockResolvedValue(listing) },
      propertyAssetRepository: { findById: jest.fn().mockResolvedValue(propertyAsset) },
    });

    await expect(
      service.revealListingContact({ slug: 'batumi-flat-85k', requesterPhone: '+995555123456', correlationId: 'test' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

function makeLead(
  overrides: Partial<{
    organizationId: Types.ObjectId;
    stage: string;
    ownerPositionId: Types.ObjectId;
    version: number;
    productType: 'sales' | 'network' | 'owner' | 'agent';
  }> = {},
) {
  return {
    _id: new Types.ObjectId(),
    organizationId: overrides.organizationId ?? new Types.ObjectId(),
    contactId: new Types.ObjectId(),
    ownerPositionId: overrides.ownerPositionId,
    productType: overrides.productType,
    stage: overrides.stage ?? 'new',
    version: overrides.version ?? 0,
    source: { route: '/developments/x' },
  };
}

describe('CrmService.assignLead', () => {
  it('назначает owner, пишет LeadEvent с ТЕКУЩИМ stage (не меняет его) и audit', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeLead({ organizationId, stage: 'qualified' });
    const assigneePositionId = new Types.ObjectId();
    const actorPositionId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();
    const assignOwnerSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const appendEventSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue(lead),
        assignOwner: assignOwnerSpy,
      },
      leadEventRepository: { append: appendEventSpy },
      auditService: { append: auditAppendSpy },
    });

    const result = await service.assignLead({
      leadId: lead._id,
      assigneePositionId,
      actorPositionId,
      actorIdentityId,
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
    });

    expect(assignOwnerSpy).toHaveBeenCalledWith(lead._id, organizationId, assigneePositionId, expect.anything());
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: lead._id, stage: 'qualified', changedBy: { type: 'position', positionId: actorPositionId } }),
      expect.anything(),
    );
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'identity', id: actorIdentityId },
        action: 'lead.assign',
        after: { ownerPositionId: assigneePositionId.toString() },
      }),
      expect.anything(),
    );
    expect(result.ownerPositionId).toBe(assigneePositionId.toString());
    expect(result.stage).toBe('qualified');
  });

  it('бросает NotFoundException для чужой организации, не вызывает assignOwner', async () => {
    const assignOwnerSpy = jest.fn();
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null), assignOwner: assignOwnerSpy },
    });

    await expect(
      service.assignLead({
        leadId: new Types.ObjectId(),
        assigneePositionId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(assignOwnerSpy).not.toHaveBeenCalled();
  });

  it('D-05B: бросает NotFoundException, если findAssignablePosition отклоняет позицию (чужая организация/не существует), не вызывает assignOwner', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeLead({ organizationId });
    const assignOwnerSpy = jest.fn();
    const findAssignablePositionSpy = jest.fn().mockRejectedValue(new NotFoundException('Position not found'));

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), assignOwner: assignOwnerSpy },
      organizationsService: { findAssignablePosition: findAssignablePositionSpy },
    });

    const assigneePositionId = new Types.ObjectId();
    await expect(
      service.assignLead({
        leadId: lead._id,
        assigneePositionId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findAssignablePositionSpy).toHaveBeenCalledWith(assigneePositionId, organizationId, expect.anything());
    expect(assignOwnerSpy).not.toHaveBeenCalled();
  });

  it('D-05B: бросает ConflictException, если Position closed, не вызывает assignOwner', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeLead({ organizationId });
    const assignOwnerSpy = jest.fn();

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), assignOwner: assignOwnerSpy },
      organizationsService: {
        findAssignablePosition: jest.fn().mockRejectedValue(new ConflictException('Position is closed and cannot be assigned')),
      },
    });

    await expect(
      service.assignLead({
        leadId: lead._id,
        assigneePositionId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(assignOwnerSpy).not.toHaveBeenCalled();
  });
});

describe('CrmService.unassignLead', () => {
  it('снимает owner, пишет LeadEvent с ТЕКУЩИМ stage (не меняет его) и audit', async () => {
    const organizationId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const lead = makeLead({ organizationId, stage: 'qualified', ownerPositionId });
    const actorPositionId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();
    const unassignOwnerSpy = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const appendEventSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue(lead),
        unassignOwner: unassignOwnerSpy,
      },
      leadEventRepository: { append: appendEventSpy },
      auditService: { append: auditAppendSpy },
    });

    const result = await service.unassignLead({
      leadId: lead._id,
      actorPositionId,
      actorIdentityId,
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
    });

    expect(unassignOwnerSpy).toHaveBeenCalledWith(lead._id, organizationId, expect.anything());
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: lead._id, stage: 'qualified', changedBy: { type: 'position', positionId: actorPositionId } }),
      expect.anything(),
    );
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'identity', id: actorIdentityId },
        action: 'lead.unassign',
        before: { ownerPositionId: ownerPositionId.toString() },
        after: { ownerPositionId: null },
      }),
      expect.anything(),
    );
    expect(result.ownerPositionId).toBeNull();
    expect(result.stage).toBe('qualified');
  });

  it('бросает NotFoundException для чужой организации, не вызывает unassignOwner', async () => {
    const unassignOwnerSpy = jest.fn();
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null), unassignOwner: unassignOwnerSpy },
    });

    await expect(
      service.unassignLead({
        leadId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(unassignOwnerSpy).not.toHaveBeenCalled();
  });

  it('matchedCount:1, modifiedCount:0 (лид уже был без owner) — идемпотентный успех, не NotFoundException', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeLead({ organizationId });
    const unassignOwnerSpy = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), unassignOwner: unassignOwnerSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    const result = await service.unassignLead({
      leadId: lead._id,
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
    });

    expect(result.ownerPositionId).toBeNull();
  });

  it('matchedCount:0 (лид реально исчез между read и write) — бросает NotFoundException', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeLead({ organizationId });
    const unassignOwnerSpy = jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), unassignOwner: unassignOwnerSpy },
    });

    await expect(
      service.unassignLead({
        leadId: lead._id,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CrmService.createLead', () => {
  function makeContact(overrides: Partial<{ _id: Types.ObjectId; name: string; phone: string }> = {}) {
    return {
      _id: overrides._id ?? new Types.ObjectId(),
      name: overrides.name ?? 'Иван Иванов',
      phone: overrides.phone ?? '+995500000001',
    };
  }

  it('с contactId: использует существующий контакт, НЕ вызывает resolveContact/create нового контакта', async () => {
    const organizationId = new Types.ObjectId();
    const contact = makeContact();
    const findContactSpy = jest.fn().mockResolvedValue(contact);
    const createContactSpy = jest.fn();
    const leadId = new Types.ObjectId();
    const createLeadSpy = jest.fn().mockResolvedValue({
      _id: leadId,
      organizationId,
      contactId: contact._id,
      ownerPositionId: undefined,
      stage: 'new',
      version: 0,
      source: { route: 'manual' },
      createdAt: new Date('2026-08-31T10:00:00.000Z'),
    });
    const appendEventSpy = jest.fn().mockResolvedValue(undefined);
    const auditSpy = jest.fn().mockResolvedValue(undefined);
    const actorPositionId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();

    const service = createTestCrmService({
      contactRepository: { findByIdForOrganization: findContactSpy, create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: appendEventSpy },
      auditService: { append: auditSpy },
    });

    const result = await service.createLead({
      organizationId,
      contactId: contact._id,
      actorPositionId,
      actorIdentityId,
      correlationId: 'test-correlation-id',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
    });

    expect(findContactSpy).toHaveBeenCalledWith(contact._id, organizationId);
    expect(createContactSpy).not.toHaveBeenCalled();
    expect(createLeadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, contactId: contact._id, source: { route: 'manual' } }),
      expect.anything(),
    );
    // Не auto-assign на actor'а — ownerPositionId остаётся unassigned (owner decision).
    expect(result.ownerPositionId).toBeNull();
    expect(result.stage).toBe('new');
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId,
        stage: 'new',
        changedBy: { type: 'position', positionId: actorPositionId },
      }),
      expect.anything(),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'identity', id: actorIdentityId },
        action: 'lead.create',
        resourceId: leadId,
        after: { contactId: contact._id.toString(), source: 'manual' },
      }),
      expect.anything(),
    );
  });

  it('с contactId чужой организации — NotFoundException, не создаёт лид', async () => {
    const createLeadSpy = jest.fn();
    const service = createTestCrmService({
      contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      leadRepository: { create: createLeadSpy },
    });

    await expect(
      service.createLead({
        organizationId: new Types.ObjectId(),
        contactId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(createLeadSpy).not.toHaveBeenCalled();
  });

  it('с requesterPhone (без contactId): находит существующий контакт по телефону в организации, не создаёт новый', async () => {
    const organizationId = new Types.ObjectId();
    const contact = makeContact({ phone: '+995500000002' });
    const findByPhoneSpy = jest.fn().mockResolvedValue(contact);
    const createContactSpy = jest.fn();
    const createLeadSpy = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      organizationId,
      contactId: contact._id,
      stage: 'new',
      version: 0,
      source: { route: 'manual' },
      createdAt: new Date(),
    });

    const service = createTestCrmService({
      contactRepository: { findByPhone: findByPhoneSpy, create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    await service.createLead({
      organizationId,
      requesterName: 'Пётр Петров',
      requesterPhone: '+995500000002',
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
    });

    expect(findByPhoneSpy).toHaveBeenCalledWith(organizationId, '+995500000002');
    expect(createContactSpy).not.toHaveBeenCalled();
  });

  it('с requesterPhone, для которого контакта ещё нет: создаёт новый Contact в этой организации', async () => {
    const organizationId = new Types.ObjectId();
    const newContact = { _id: new Types.ObjectId(), name: 'Новый Клиент', phone: '+995500000003' };
    const createContactSpy = jest.fn().mockResolvedValue(newContact);
    const createLeadSpy = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      organizationId,
      contactId: newContact._id,
      stage: 'new',
      version: 0,
      source: { route: 'manual' },
      createdAt: new Date(),
    });

    const service = createTestCrmService({
      contactRepository: { findByPhone: jest.fn().mockResolvedValue(null), create: createContactSpy },
      leadRepository: { create: createLeadSpy },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    await service.createLead({
      organizationId,
      requesterName: 'Новый Клиент',
      requesterPhone: '+995500000003',
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
    });

    expect(createContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, name: 'Новый Клиент', phone: '+995500000003', roles: ['buyer'] }),
      expect.anything(),
    );
  });

  it('ни contactId, ни requesterPhone — VALIDATION_FAILED, не создаёт лид', async () => {
    const createLeadSpy = jest.fn();
    const service = createTestCrmService({ leadRepository: { create: createLeadSpy } });

    await expect(
      service.createLead({
        organizationId: new Types.ObjectId(),
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(createLeadSpy).not.toHaveBeenCalled();
  });

  describe('продуктовые воронки лида (03.09.2026, owner decision)', () => {
    it('с productType — создаёт лид сразу в первой стадии колонки in_progress этого продукта, не в generic new и не в rejection', async () => {
      const organizationId = new Types.ObjectId();
      const contact = makeContact();
      const createLeadSpy = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        organizationId,
        contactId: contact._id,
        productType: 'network',
        stage: 'network_new_lead',
        version: 0,
        source: { route: 'manual' },
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
      });
      const appendEventSpy = jest.fn().mockResolvedValue(undefined);

      const service = createTestCrmService({
        contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(contact) },
        leadRepository: { create: createLeadSpy },
        leadEventRepository: { append: appendEventSpy },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
      });

      const result = await service.createLead({
        organizationId,
        contactId: contact._id,
        productType: 'network',
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: { probe: 1 },
      });

      expect(createLeadSpy).toHaveBeenCalledWith(
        expect.objectContaining({ productType: 'network', stage: 'network_new_lead' }),
        expect.anything(),
      );
      expect(appendEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'network_new_lead' }),
        expect.anything(),
      );
      expect(result.productType).toBe('network');
      expect(result.stage).toBe('network_new_lead');
    });

    it('без productType — поведение как раньше: stage:new, productType:null', async () => {
      const organizationId = new Types.ObjectId();
      const contact = makeContact();
      const createLeadSpy = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        organizationId,
        contactId: contact._id,
        stage: 'new',
        version: 0,
        source: { route: 'manual' },
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
      });

      const service = createTestCrmService({
        contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(contact) },
        leadRepository: { create: createLeadSpy },
        leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
      });

      const result = await service.createLead({
        organizationId,
        contactId: contact._id,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: { probe: 1 },
      });

      expect(createLeadSpy).toHaveBeenCalledWith(
        expect.objectContaining({ productType: undefined, stage: 'new' }),
        expect.anything(),
      );
      expect(result.productType).toBeNull();
      expect(result.stage).toBe('new');
    });
  });
});

describe('CrmService.changeLeadStage', () => {
  it('меняет stage, пишет LeadEvent с НОВЫМ stage и audit before/after', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeLead({ organizationId, stage: 'contacted' });
    const actorPositionId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();
    const changeStageSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const appendEventSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue(lead),
        changeStageWithVersionCheck: changeStageSpy,
      },
      leadEventRepository: { append: appendEventSpy },
      auditService: { append: auditAppendSpy },
    });

    const result = await service.changeLeadStage({
      leadId: lead._id,
      newStage: 'qualified',
      expectedVersion: lead.version,
      actorPositionId,
      actorIdentityId,
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: {},
    });

    expect(changeStageSpy).toHaveBeenCalledWith(lead._id, organizationId, lead.version, 'qualified', ['contacted'], expect.anything());
    expect(appendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'qualified', changedBy: { type: 'position', positionId: actorPositionId } }),
      expect.anything(),
    );
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.change_stage', before: { stage: 'contacted' }, after: { stage: 'qualified' } }),
      expect.anything(),
    );
    expect(result.stage).toBe('qualified');
  });

  it('бросает NotFoundException для несуществующего лида', async () => {
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.changeLeadStage({
        leadId: new Types.ObjectId(),
        newStage: 'lost',
        expectedVersion: 0,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: {},
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  function makeChangeStageService(lead: ReturnType<typeof makeLead>, changeStageSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 })) {
    return createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue(lead),
        changeStageWithVersionCheck: changeStageSpy,
      },
      leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });
  }

  describe('D-05B: transition-матрица', () => {
    it.each([
      ['new', 'contacted'],
      ['new', 'lost'],
      ['contacted', 'qualified'],
      ['contacted', 'lost'],
      ['qualified', 'converted'],
      ['qualified', 'lost'],
      ['lost', 'new'],
    ] as const)('разрешает переход %s → %s', async (from, to) => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: from });
      const service = makeChangeStageService(lead);

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: to,
          expectedVersion: lead.version,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['converted', 'contacted'],
      ['converted', 'new'],
      ['new', 'qualified'],
      ['new', 'converted'],
      ['contacted', 'converted'],
      ['lost', 'qualified'],
      ['lost', 'contacted'],
      ['lost', 'converted'],
    ] as const)('запрещает переход %s → %s', async (from, to) => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: from });
      const changeStageSpy = jest.fn();
      const service = makeChangeStageService(lead, changeStageSpy);

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: to,
          expectedVersion: lead.version,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(changeStageSpy).not.toHaveBeenCalled();
    });
  });

  describe('optimistic concurrency (27.08.2026) — modifiedCount:0 disambiguation', () => {
    it('устаревшая version отклоняется как ConflictException до проверки перехода по старому snapshot', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: 'lost', version: 1 });
      const changeStageSpy = jest.fn();
      const service = makeChangeStageService(lead, changeStageSpy);

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(changeStageSpy).not.toHaveBeenCalled();
    });

    it('version устарела (current.version !== expectedVersion) — ConflictException 409, даже если newStage недостижим из НОВОГО current.stage', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: 'new', version: 0 });
      const currentAfterRace = { ...lead, stage: 'converted', version: 1 };
      const service = createTestCrmService({
        leadRepository: {
          findByIdForOrganization: jest
            .fn()
            .mockResolvedValueOnce(lead)
            .mockResolvedValueOnce(currentAfterRace),
          changeStageWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
        leadEventRepository: { append: jest.fn() },
        auditService: { append: jest.fn() },
      });

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: 'lost',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('version совпадает с current, но атомарный write всё равно вернул modifiedCount:0 (защитная ветка) — VALIDATION_FAILED, не ConflictException', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: 'new', version: 0 });
      const service = createTestCrmService({
        leadRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(lead),
          changeStageWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
        leadEventRepository: { append: jest.fn() },
        auditService: { append: jest.fn() },
      });

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('лид исчез между атомарным write и re-fetch (крайне редкая гонка с параллельным удалением) — NotFoundException', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: 'new', version: 0 });
      const service = createTestCrmService({
        leadRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValueOnce(lead).mockResolvedValueOnce(null),
          changeStageWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
        leadEventRepository: { append: jest.fn() },
        auditService: { append: jest.fn() },
      });

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('D-05B: own-scope сужение (manager меняет только свой лид)', () => {
    it('requiredOwnerPositionId передаётся в findByIdForOrganization — manager видит только свой лид', async () => {
      const organizationId = new Types.ObjectId();
      const managerPositionId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: 'new', ownerPositionId: managerPositionId });
      const findByIdForOrganizationSpy = jest.fn().mockResolvedValue(lead);
      const service = createTestCrmService({
        leadRepository: {
          findByIdForOrganization: findByIdForOrganizationSpy,
          changeStageWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        },
        leadEventRepository: { append: jest.fn().mockResolvedValue(undefined) },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
      });

      await service.changeLeadStage({
        leadId: lead._id,
        newStage: 'contacted',
        expectedVersion: lead.version,
        actorPositionId: managerPositionId,
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        requiredOwnerPositionId: managerPositionId,
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: {},
      });

      expect(findByIdForOrganizationSpy).toHaveBeenCalledWith(lead._id, organizationId, managerPositionId);
    });

    it('чужой лид (requiredOwnerPositionId задан, но repository не находит по этому фильтру) → NotFoundException', async () => {
      const organizationId = new Types.ObjectId();
      const managerPositionId = new Types.ObjectId();
      const service = createTestCrmService({
        leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.changeLeadStage({
          leadId: new Types.ObjectId(),
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: managerPositionId,
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          requiredOwnerPositionId: managerPositionId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('продуктовые воронки лида (03.09.2026, owner decision)', () => {
    it('лид с productType:network — переход в network-стадию проходит, без матрицы порядка переходов', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, productType: 'network', stage: 'network_new_lead' });
      const changeStageSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const service = makeChangeStageService(lead, changeStageSpy);

      const result = await service.changeLeadStage({
        leadId: lead._id,
        newStage: 'network_work_started',
        expectedVersion: lead.version,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: {},
      });

      expect(result.stage).toBe('network_work_started');
      expect(changeStageSpy).toHaveBeenCalledWith(
        lead._id,
        organizationId,
        lead.version,
        'network_work_started',
        ['network_new_lead'],
        expect.anything(),
      );
    });

    it('лид с productType:network — переход в sales-стадию отклоняется VALIDATION_FAILED', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, productType: 'network', stage: 'network_new_lead' });
      const changeStageSpy = jest.fn();
      const service = makeChangeStageService(lead, changeStageSpy);

      await expect(
        service.changeLeadStage({
          leadId: lead._id,
          newStage: 'contacted',
          expectedVersion: lead.version,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'test-correlation-id',
          idempotencyKey: 'test-key',
          idempotencyRequestBody: {},
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(changeStageSpy).not.toHaveBeenCalled();
    });

    it('лид БЕЗ productType — переход в generic-стадию продолжает работать как раньше (не задет продуктовой веткой)', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, stage: 'new' });
      const changeStageSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const service = makeChangeStageService(lead, changeStageSpy);

      const result = await service.changeLeadStage({
        leadId: lead._id,
        newStage: 'contacted',
        expectedVersion: lead.version,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: {},
      });

      expect(result.stage).toBe('contacted');
    });

    it('лид с productType:sales — переход в sales-стадию любого порядка (без матрицы) проходит', async () => {
      const organizationId = new Types.ObjectId();
      const lead = makeLead({ organizationId, productType: 'sales', stage: 'defective' });
      const changeStageSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const service = makeChangeStageService(lead, changeStageSpy);

      // 'golden' обычная бизнес-цепочка достигает лишь после десятка шагов —
      // здесь напрямую из 'defective' (rejection), подтверждая, что для
      // продуктовых лидов порядок переходов НЕ ограничен (out of scope).
      const result = await service.changeLeadStage({
        leadId: lead._id,
        newStage: 'golden',
        expectedVersion: lead.version,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
        idempotencyKey: 'test-key',
        idempotencyRequestBody: {},
      });

      expect(result.stage).toBe('golden');
    });
  });
});

function makeFullLead(
  overrides: Partial<{
    organizationId: Types.ObjectId;
    contactId: Types.ObjectId;
    stage: string;
    productType: 'sales' | 'network' | 'owner' | 'agent';
    version: number;
    checklist: Record<string, boolean>;
    stageNotes: Record<string, { text: string; updatedAt: Date }>;
  }> = {},
) {
  return {
    _id: new Types.ObjectId(),
    organizationId: overrides.organizationId ?? new Types.ObjectId(),
    contactId: overrides.contactId ?? new Types.ObjectId(),
    ownerPositionId: undefined,
    productType: overrides.productType,
    stage: overrides.stage ?? 'new',
    version: overrides.version ?? 0,
    source: { route: 'manual' },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    checklist: overrides.checklist,
    stageNotes: overrides.stageNotes,
  };
}

describe('CrmService.updateLead — name/phone/email/productType (phase 4)', () => {
  it('name/phone/email заданы, у лида уже есть контакт — обновляет Contact, а не Lead', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, contactId });
    const contact = { _id: contactId, name: 'Старое имя', phone: '+995500000001', email: 'old@example.test' };
    const findByIdForOrganization = jest.fn().mockResolvedValue(lead);
    const findByIdForOrganizationContact = jest.fn().mockResolvedValue(contact);
    const findByPhone = jest.fn().mockResolvedValue(null);
    const updateContactFields = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization },
      contactRepository: {
        findByIdForOrganization: findByIdForOrganizationContact,
        findByPhone,
        updateFields: updateContactFields,
      },
      auditService: { append: auditAppend },
    });

    const result = await service.updateLead({
      leadId: lead._id,
      organizationId,
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
      name: 'Новое Имя',
      phone: '+995500000002',
      email: 'new@example.test',
    });

    expect(updateContactFields).toHaveBeenCalledWith(
      contactId,
      organizationId,
      { name: 'Новое Имя', phone: '+995500000002', email: 'new@example.test' },
      expect.anything(),
    );
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.update',
        before: expect.objectContaining({ name: 'Старое имя', phone: '+995500000001', email: 'old@example.test' }),
        after: expect.objectContaining({ name: 'Новое Имя', phone: '+995500000002', email: 'new@example.test' }),
      }),
      expect.anything(),
    );
    expect(result.id).toBe(lead._id.toString());
  });

  it('новый phone уже занят ДРУГИМ контактом организации — 409 CONTACT_PHONE_TAKEN, Contact не меняется', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const otherContactId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, contactId });
    const contact = { _id: contactId, name: 'Иван', phone: '+995500000001', email: undefined };
    const takenByOther = { _id: otherContactId, name: 'Другой', phone: '+995500000009' };
    const updateContactFields = jest.fn();

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
      contactRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue(contact),
        findByPhone: jest.fn().mockResolvedValue(takenByOther),
        updateFields: updateContactFields,
      },
    });

    await expect(
      service.updateLead({
        leadId: lead._id,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
        phone: '+995500000009',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONTACT_PHONE_TAKEN });
    expect(updateContactFields).not.toHaveBeenCalled();
  });

  it('новый phone принадлежит ТОМУ ЖЕ контакту (не менялся) — не 409, апдейт проходит', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, contactId });
    const contact = { _id: contactId, name: 'Иван', phone: '+995500000001', email: undefined };
    const updateContactFields = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
      contactRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue(contact),
        findByPhone: jest.fn().mockResolvedValue(contact),
        updateFields: updateContactFields,
      },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    await service.updateLead({
      leadId: lead._id,
      organizationId,
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
      phone: '+995500000001',
    });

    expect(updateContactFields).toHaveBeenCalled();
  });

  it('name — пустая после trim строка отклоняется как VALIDATION_FAILED, Contact не трогается', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId });
    const updateContactFields = jest.fn();

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
      contactRepository: { updateFields: updateContactFields },
    });

    await expect(
      service.updateLead({
        leadId: lead._id,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
        name: '   ',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(updateContactFields).not.toHaveBeenCalled();
  });

  it('productType меняется — сбрасывает stage на "Новый лид" нового продукта, пишет LeadEvent', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, stage: 'new', productType: undefined });
    const updatedLead = makeFullLead({
      organizationId,
      contactId: lead.contactId,
      stage: 'network_new_lead',
      productType: 'network',
    });
    updatedLead._id = lead._id;
    const updateFieldsWithProductReset = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const appendEvent = jest.fn().mockResolvedValue(undefined);
    const actorPositionId = new Types.ObjectId();

    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValueOnce(lead).mockResolvedValueOnce(updatedLead),
        updateFieldsWithProductReset,
      },
      contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      leadEventRepository: { append: appendEvent },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    const result = await service.updateLead({
      leadId: lead._id,
      organizationId,
      actorPositionId,
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
      productType: 'network',
    });

    expect(updateFieldsWithProductReset).toHaveBeenCalledWith(
      lead._id,
      organizationId,
      {},
      { productType: 'network', stage: 'network_new_lead' },
      expect.anything(),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'network_new_lead', changedBy: { type: 'position', positionId: actorPositionId } }),
      expect.anything(),
    );
    expect(result.stage).toBe('network_new_lead');
    expect(result.productType).toBe('network');
  });

  it('productType совпадает с текущим — no-op, stage не трогается, updateFieldsWithProductReset не вызывается', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, stage: 'network_new_lead', productType: 'network' });
    const updateFieldsWithProductReset = jest.fn();
    const appendEvent = jest.fn();

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), updateFieldsWithProductReset },
      contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      leadEventRepository: { append: appendEvent },
    });

    const result = await service.updateLead({
      leadId: lead._id,
      organizationId,
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
      productType: 'network',
    });

    expect(updateFieldsWithProductReset).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(result.stage).toBe('network_new_lead');
  });
});

describe('CrmService — lead checklist / stage notes (phase 3.1)', () => {
  it('getLeadChecklist — разбирает checklist/stageNotes лида в items/stageNotes', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({
      organizationId,
      checklist: { 'new:0': true, 'new:1': false, 'contacted:0': true },
      stageNotes: { new: { text: 'Перезвонить', updatedAt: new Date('2026-09-01T10:00:00.000Z') } },
    });

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
    });

    const result = await service.getLeadChecklist({ leadId: lead._id, organizationId });

    expect(result.items).toEqual([
      { stage: 'contacted', index: 0, checked: true },
      { stage: 'new', index: 0, checked: true },
      { stage: 'new', index: 1, checked: false },
    ]);
    expect(result.stageNotes).toEqual([{ stage: 'new', text: 'Перезвонить', updatedAt: '2026-09-01T10:00:00.000Z' }]);
  });

  it('getLeadChecklist — лид без checklist/stageNotes — пустые массивы', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId });

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
    });

    const result = await service.getLeadChecklist({ leadId: lead._id, organizationId });

    expect(result).toEqual({ items: [], stageNotes: [] });
  });

  it('getLeadChecklist — чужая организация — NotFoundException', async () => {
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.getLeadChecklist({ leadId: new Types.ObjectId(), organizationId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateLeadChecklist — собирает dot-path ключи (stage:index) и передаёт в repository.updateChecklist', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, checklist: { 'new:0': true } });
    const updatedLead = makeFullLead({ organizationId, checklist: { 'new:0': true, 'new:1': true, 'contacted:2': false } });
    const updateChecklist = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const findByIdForOrganization = jest.fn().mockResolvedValueOnce(lead).mockResolvedValueOnce(updatedLead);
    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization, updateChecklist },
      auditService: { append: auditAppend },
    });

    const result = await service.updateLeadChecklist({
      leadId: lead._id,
      organizationId,
      changes: [
        { stage: 'new', index: 1, checked: true },
        { stage: 'contacted', index: 2, checked: false },
      ],
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(updateChecklist).toHaveBeenCalledWith(
      lead._id,
      organizationId,
      [
        { key: 'new:1', checked: true },
        { key: 'contacted:2', checked: false },
      ],
      expect.anything(),
    );
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.checklist_update' }), expect.anything());
    expect(result.items).toEqual(
      expect.arrayContaining([
        { stage: 'new', index: 0, checked: true },
        { stage: 'new', index: 1, checked: true },
        { stage: 'contacted', index: 2, checked: false },
      ]),
    );
  });

  it('setLeadStageNote — непустой text — сохраняет заметку', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId });
    const setStageNote = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), setStageNote },
      auditService: { append: auditAppend },
    });

    const result = await service.setLeadStageNote({
      leadId: lead._id,
      organizationId,
      stage: 'new',
      text: '  Перезвонить завтра  ',
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(setStageNote).toHaveBeenCalledWith(
      lead._id,
      organizationId,
      'new',
      { text: 'Перезвонить завтра', updatedAt: expect.any(Date) },
      expect.anything(),
    );
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.stage_note_set' }), expect.anything());
    expect(result).toMatchObject({ stage: 'new', text: 'Перезвонить завтра' });
  });

  it('setLeadStageNote — пустой text — удаляет заметку (note:null, $unset)', async () => {
    const organizationId = new Types.ObjectId();
    const lead = makeFullLead({ organizationId, stageNotes: { new: { text: 'старая', updatedAt: new Date() } } });
    const setStageNote = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead), setStageNote },
      auditService: { append: auditAppend },
    });

    const result = await service.setLeadStageNote({
      leadId: lead._id,
      organizationId,
      stage: 'new',
      text: '',
      actorPositionId: new Types.ObjectId(),
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'test-correlation-id',
    });

    expect(setStageNote).toHaveBeenCalledWith(lead._id, organizationId, 'new', null, expect.anything());
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.stage_note_delete' }), expect.anything());
    expect(result.text).toBe('');
  });
});

describe('CrmService — read leads', () => {
  it('возвращает tenant-scoped лиды с контактами и передаёт owner/stage фильтры в repository', async () => {
    const organizationId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const listForOrganization = jest.fn().mockResolvedValue([
      {
        _id: leadId,
        organizationId,
        contactId,
        ownerPositionId,
        stage: 'new',
        source: { route: '/developments/test' },
        createdAt: new Date('2026-08-26T10:00:00Z'),
      },
    ]);
    const findByIdsForOrganization = jest.fn().mockResolvedValue([
      { _id: contactId, name: 'Иван', phone: '+995555000000', email: 'ivan@example.test' },
    ]);

    const service = createTestCrmService({
      contactRepository: { findByIdsForOrganization },
      leadRepository: { listForOrganization },
    });

    const readService = service as unknown as {
      listLeads(params: {
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
        stage?: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
        cursor?: Types.ObjectId;
        limit: number;
      }): Promise<unknown>;
    };

    await expect(
      readService.listLeads({ organizationId, ownerPositionId, stage: 'new', limit: 20 }),
    ).resolves.toEqual({
      items: [
        {
          id: leadId.toString(),
          organizationId: organizationId.toString(),
          ownerPositionId: ownerPositionId.toString(),
          productType: null,
          stage: 'new',
          version: 0,
          source: { route: '/developments/test' },
          createdAt: '2026-08-26T10:00:00.000Z',
          stalled: false,
          contact: { id: contactId.toString(), name: 'Иван', phone: '+995555000000', email: 'ivan@example.test' },
          hasOpenNextAction: false,
          city: null,
          notes: null,
          tags: [],
          dealValue: null,
          budgetValue: null,
          budgetCurrency: null,
          expectedCloseDate: null,
          rejectionReason: null,
          rejectionComment: null,
          telegram: null,
          country: null,
          realtorStage: null,
          curatorStage: null,
          whatsapp: null,
          lastContactAt: null,
        },
      ],
      nextCursor: null,
    });

    expect(listForOrganization).toHaveBeenCalledWith(organizationId, {
      ownerPositionId,
      stage: 'new',
      stalled: undefined,
      cursor: undefined,
      // limit+1: repository запрашивается на одну запись больше params.limit
      // для однозначного hasMore/nextCursor без отдельного count().
      limit: 21,
    });
    expect(findByIdsForOrganization).toHaveBeenCalledWith(organizationId, [contactId]);
  });

  it('limit+1: repository возвращает limit+1 строк → nextCursor указывает на последнюю ВОЗВРАЩЁННУЮ (не лишнюю) запись', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const leadIds = [new Types.ObjectId(), new Types.ObjectId()];
    const rows = leadIds.map((id, index) => ({
      _id: id,
      organizationId,
      contactId,
      ownerPositionId: undefined,
      stage: 'new' as const,
      source: { route: '/developments/test' },
      createdAt: new Date(`2026-08-2${6 - index}T10:00:00Z`),
    }));
    const listForOrganization = jest.fn().mockResolvedValue(rows);
    const findByIdsForOrganization = jest.fn().mockResolvedValue([{ _id: contactId, name: 'Иван', phone: '+995555000000' }]);

    const service = createTestCrmService({
      contactRepository: { findByIdsForOrganization },
      leadRepository: { listForOrganization },
    });

    const readService = service as unknown as {
      listLeads(params: { organizationId: Types.ObjectId; limit: number }): Promise<{ items: unknown[]; nextCursor: string | null }>;
    };

    const result = await readService.listLeads({ organizationId, limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe(leadIds[0]!.toString());
  });

  it('cursor из controller пробрасывается repository как есть', async () => {
    const organizationId = new Types.ObjectId();
    const cursor = new Types.ObjectId();
    const listForOrganization = jest.fn().mockResolvedValue([]);
    const service = createTestCrmService({
      contactRepository: { findByIdsForOrganization: jest.fn().mockResolvedValue([]) },
      leadRepository: { listForOrganization },
    });

    const readService = service as unknown as {
      listLeads(params: { organizationId: Types.ObjectId; cursor?: Types.ObjectId; limit: number }): Promise<unknown>;
    };

    await readService.listLeads({ organizationId, cursor, limit: 20 });

    expect(listForOrganization).toHaveBeenCalledWith(organizationId, {
      ownerPositionId: undefined,
      stage: undefined,
      stalled: undefined,
      cursor,
      limit: 21,
    });
  });

  it('возвращает отдельный лид с контактом', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const lead = {
      _id: leadId,
      organizationId,
      contactId,
      ownerPositionId: null,
      stage: 'new',
      source: { route: '/developments/test' },
      createdAt: new Date('2026-08-26T10:00:00Z'),
    };
    const contact = { _id: contactId, name: 'Иван', phone: '+995555000000', email: 'ivan@example.test' };

    const service = createTestCrmService({
      contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(contact) },
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
      taskRepository: { countOpenForLead: jest.fn().mockResolvedValue(1) },
    });

    const readService = service as unknown as {
      getLead(params: {
        leadId: Types.ObjectId;
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
      }): Promise<unknown>;
    };

    await expect(readService.getLead({ leadId, organizationId })).resolves.toEqual({
      id: leadId.toString(),
      organizationId: organizationId.toString(),
      ownerPositionId: null,
      productType: null,
      stage: 'new',
      version: 0,
      source: { route: '/developments/test' },
      createdAt: '2026-08-26T10:00:00.000Z',
      stalled: false,
      contact: { id: contactId.toString(), name: 'Иван', phone: '+995555000000', email: 'ivan@example.test' },
      hasOpenNextAction: true,
      city: null,
      notes: null,
      tags: [],
      dealValue: null,
      budgetValue: null,
      budgetCurrency: null,
      expectedCloseDate: null,
      rejectionReason: null,
      rejectionComment: null,
      telegram: null,
      country: null,
      realtorStage: null,
      curatorStage: null,
      whatsapp: null,
      lastContactAt: null,
    });
  });

  it('бросает NotFoundException при чтении несуществующего лида', async () => {
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
    });

    const readService = service as unknown as {
      getLead(params: {
        leadId: Types.ObjectId;
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
      }): Promise<unknown>;
    };

    await expect(
      readService.getLead({ leadId: new Types.ObjectId(), organizationId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CrmService.listLeadFiles/attachLeadFile/detachLeadFile (phase 3)', () => {
  it('listLeadFiles: лид без attachedAssetIds — [], MediaService не вызывается', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const getAssetsForOwnerScope = jest.fn();
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({
          _id: leadId,
          organizationId,
          attachedAssetIds: [],
        }),
      },
      mediaService: { getAssetsForOwnerScope },
    });

    const result = await service.listLeadFiles({ leadId, organizationId });

    expect(result).toEqual([]);
    expect(getAssetsForOwnerScope).not.toHaveBeenCalled();
  });

  it('listLeadFiles: резолвит assetId → fileName/url/mimeType, сохраняет порядок attachedAssetIds', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assetId1 = new Types.ObjectId();
    const assetId2 = new Types.ObjectId();
    const createdAt = new Date('2026-09-01T10:00:00Z');
    const assetsMap = new Map([
      [
        assetId1.toString(),
        {
          status: 'verified' as const,
          variants: [{ type: 'card', assetPath: 'x/card/1.webp', exifStripped: true as const }],
          bucket: 'public' as const,
          declaredMimeType: 'image/jpeg',
          verifiedMimeType: 'image/jpeg',
          sizeBytes: 1024,
          createdAt,
          originalPath: `${assetId1.toString()}/original.jpg`,
        },
      ],
      [
        assetId2.toString(),
        {
          status: 'pending' as const,
          variants: [],
          bucket: 'public' as const,
          declaredMimeType: 'application/pdf',
          sizeBytes: 2048,
          createdAt,
          originalPath: `${assetId2.toString()}/original.pdf`,
        },
      ],
    ]);
    const getAssetsForOwnerScope = jest.fn().mockResolvedValue(assetsMap);
    const getVariantUrl = jest.fn().mockReturnValue('https://cdn.example.com/x/card/1.webp');
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({
          _id: leadId,
          organizationId,
          attachedAssetIds: [assetId1, assetId2],
        }),
      },
      mediaService: { getAssetsForOwnerScope, getVariantUrl },
    });

    const result = await service.listLeadFiles({ leadId, organizationId });

    expect(result).toEqual([
      {
        assetId: assetId1.toString(),
        fileName: 'original.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        url: 'https://cdn.example.com/x/card/1.webp',
        createdAt: createdAt.toISOString(),
      },
      {
        assetId: assetId2.toString(),
        fileName: 'original.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        url: null,
        createdAt: createdAt.toISOString(),
      },
    ]);
  });

  function pdfAsset(assetId: Types.ObjectId) {
    return new Map([
      [
        assetId.toString(),
        {
          status: 'verified' as const,
          variants: [],
          bucket: 'private' as const,
          declaredMimeType: 'application/pdf',
          verifiedMimeType: 'application/pdf',
          sizeBytes: 2048,
          createdAt: new Date('2026-09-15T10:00:00Z'),
          originalPath: `${assetId.toString()}/original.pdf`,
        },
      ],
    ]);
  }

  it('listLeadFiles: сохранённое имя файла важнее имени из storage key', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({
          _id: leadId,
          organizationId,
          attachedAssetIds: [assetId],
          attachedFileNames: { [assetId.toString()]: 'Презентация ЖК.pdf' },
        }),
      },
      mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(pdfAsset(assetId)) },
    });

    const [file] = await service.listLeadFiles({ leadId, organizationId });

    expect(file!.fileName).toBe('Презентация ЖК.pdf');
  });

  it('attachLeadFile: имя файла уходит в репозиторий вместе с assetId', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const addAttachedAsset = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: leadId, organizationId, attachedAssetIds: [] }),
        addAttachedAsset,
      },
      mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(pdfAsset(assetId)) },
      auditService: { append: jest.fn().mockResolvedValue(undefined) },
    });

    await service.attachLeadFile({
      leadId,
      organizationId,
      assetId,
      fileName: 'Регламент.pdf',
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'c',
    });

    expect(addAttachedAsset).toHaveBeenCalledWith(leadId, organizationId, assetId, expect.anything(), 'Регламент.pdf');
  });

  it('getLeadFileDownloadUrl: подписанная ссылка на прикреплённый файл, чужой assetId — 404', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const createDownloadUrlForOwnerScope = jest.fn().mockResolvedValue({ url: 'https://signed' });
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({
          _id: leadId,
          organizationId,
          attachedAssetIds: [assetId],
          attachedFileNames: { [assetId.toString()]: 'КП.pdf' },
        }),
      },
      mediaService: {
        getAssetsForOwnerScope: jest.fn().mockResolvedValue(pdfAsset(assetId)),
        createDownloadUrlForOwnerScope,
      },
    });

    await expect(service.getLeadFileDownloadUrl({ leadId, organizationId, assetId })).resolves.toEqual({
      url: 'https://signed',
      fileName: 'КП.pdf',
    });
    expect(createDownloadUrlForOwnerScope).toHaveBeenCalledWith(assetId, { type: 'organization', organizationId }, 'КП.pdf');

    await expect(
      service.getLeadFileDownloadUrl({ leadId, organizationId, assetId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listLeadFiles: чужая организация — NotFoundException', async () => {
    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.listLeadFiles({ leadId: new Types.ObjectId(), organizationId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attachLeadFile: asset не verified — VALIDATION_FAILED, не пишет в лид', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const addAttachedAsset = jest.fn();
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: leadId, organizationId, attachedAssetIds: [] }),
        addAttachedAsset,
      },
      mediaService: {
        getAssetsForOwnerScope: jest.fn().mockResolvedValue(
          new Map([[assetId.toString(), { status: 'pending', variants: [], declaredMimeType: 'image/jpeg', sizeBytes: 10, createdAt: new Date(), originalPath: 'x' }]]),
        ),
      },
    });

    await expect(
      service.attachLeadFile({
        leadId,
        organizationId,
        assetId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(addAttachedAsset).not.toHaveBeenCalled();
  });

  it('attachLeadFile: asset не найден в этой организации — NotFoundException', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const service = createTestCrmService({
      leadRepository: {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: leadId, organizationId, attachedAssetIds: [] }),
      },
      mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(new Map()) },
    });

    await expect(
      service.attachLeadFile({
        leadId,
        organizationId,
        assetId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CrmService.listLeadEvents', () => {
  function makeReadEventsService(overrides: {
    leadRepository?: unknown;
    leadEventRepository?: unknown;
  }) {
    const service = createTestCrmService(overrides);
    return service as unknown as {
      listLeadEvents(params: {
        leadId: Types.ObjectId;
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
        cursor?: Types.ObjectId;
        limit: number;
      }): Promise<{ items: unknown[]; nextCursor: string | null }>;
    };
  }

  it('проверяет tenant/owner scope ДО чтения lead_events (findByIdForOrganization вызывается первым)', async () => {
    const organizationId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const lead = { _id: leadId, organizationId };
    const findByIdForOrganization = jest.fn().mockResolvedValue(lead);
    const listForLead = jest.fn().mockResolvedValue([]);

    const service = makeReadEventsService({
      leadRepository: { findByIdForOrganization },
      leadEventRepository: { listForLead },
    });

    await service.listLeadEvents({ leadId, organizationId, limit: 20 });

    expect(findByIdForOrganization).toHaveBeenCalledWith(leadId, organizationId, undefined);
    expect(listForLead).toHaveBeenCalledWith(leadId, organizationId, { cursor: undefined, limit: 21 });
  });

  it('чужой (другая организация) лид → NotFoundException, lead_events НЕ читается', async () => {
    const listForLead = jest.fn();
    const service = makeReadEventsService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      leadEventRepository: { listForLead },
    });

    await expect(
      service.listLeadEvents({ leadId: new Types.ObjectId(), organizationId: new Types.ObjectId(), limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(listForLead).not.toHaveBeenCalled();
  });

  it('несуществующий leadId даёт ТОТ ЖЕ NotFoundException, что чужой лид (non-disclosure)', async () => {
    const service = makeReadEventsService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      leadEventRepository: { listForLead: jest.fn() },
    });

    await expect(
      service.listLeadEvents({ leadId: new Types.ObjectId(), organizationId: new Types.ObjectId(), limit: 20 }),
    ).rejects.toThrow('Lead not found');
  });

  it('own-scope: чужой (не свой) лид даёт NotFoundException — findByIdForOrganization применяет ownerPositionId', async () => {
    const ownerPositionId = new Types.ObjectId();
    const findByIdForOrganization = jest.fn().mockResolvedValue(null);
    const service = makeReadEventsService({
      leadRepository: { findByIdForOrganization },
      leadEventRepository: { listForLead: jest.fn() },
    });

    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    await expect(
      service.listLeadEvents({ leadId, organizationId, ownerPositionId, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findByIdForOrganization).toHaveBeenCalledWith(leadId, organizationId, ownerPositionId);
  });

  it('пустая история — items:[], nextCursor:null, не ошибка', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const service = makeReadEventsService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: leadId, organizationId }) },
      leadEventRepository: { listForLead: jest.fn().mockResolvedValue([]) },
    });

    await expect(service.listLeadEvents({ leadId, organizationId, limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('маппит LeadEventDocument в CrmLeadEventReadModel и вычисляет nextCursor по limit+1 паттерну', async () => {
    const leadId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const eventIds = [new Types.ObjectId(), new Types.ObjectId()];
    const rows = [
      {
        _id: eventIds[0],
        leadId,
        stage: 'contacted' as const,
        changedBy: { type: 'position' as const, positionId },
        changedAt: new Date('2026-08-27T09:00:00Z'),
      },
      {
        _id: eventIds[1],
        leadId,
        stage: 'new' as const,
        changedBy: { type: 'system' as const },
        changedAt: new Date('2026-08-26T09:00:00Z'),
      },
    ];
    const service = makeReadEventsService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: leadId, organizationId }) },
      leadEventRepository: { listForLead: jest.fn().mockResolvedValue(rows) },
    });

    const result = await service.listLeadEvents({ leadId, organizationId, limit: 1 });

    expect(result.items).toEqual([
      {
        id: eventIds[0]!.toString(),
        leadId: leadId.toString(),
        stage: 'contacted',
        changedBy: { type: 'position', positionId: positionId.toString() },
        changedAt: '2026-08-27T09:00:00.000Z',
        comment: null,
      },
    ]);
    expect(result.nextCursor).toBe(eventIds[0]!.toString());
  });
});

/** Дефолт для DealRepository/LeadRepository stage-методов N-20 — пустая организация, ни одной сделки/лида. */
function emptyStagesRepo() {
  return {
    listContactStagesForOrganization: jest.fn().mockResolvedValue([]),
    listStagesForContact: jest.fn().mockResolvedValue([]),
  };
}

describe('CrmService.listContacts', () => {
  function makeReadContactsService(overrides: {
    leadRepository?: unknown;
    contactRepository?: unknown;
    dealRepository?: unknown;
  }) {
    const service = createTestCrmService({
      dealRepository: overrides.dealRepository ?? emptyStagesRepo(),
      leadRepository: { ...emptyStagesRepo(), ...(overrides.leadRepository as object) },
      contactRepository: overrides.contactRepository,
    });
    return service as unknown as {
      listContacts(params: {
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
        q?: string;
        segment?: ContactSegment;
        cursor?: Types.ObjectId;
        limit: number;
      }): Promise<{ items: unknown[]; nextCursor: string | null }>;
    };
  }

  it('organization-scope: не резолвит contactIds, listForOrganization вызывается без contactIds', async () => {
    const organizationId = new Types.ObjectId();
    const distinctContactIdsForOwner = jest.fn();
    const listForOrganization = jest.fn().mockResolvedValue([]);
    const service = makeReadContactsService({
      leadRepository: { distinctContactIdsForOwner },
      contactRepository: { listForOrganization },
    });

    await service.listContacts({ organizationId, limit: 20 });

    expect(distinctContactIdsForOwner).not.toHaveBeenCalled();
    expect(listForOrganization).toHaveBeenCalledWith(organizationId, {
      contactIds: undefined,
      q: undefined,
      cursor: undefined,
      limit: 21,
    });
  });

  it('own-scope: резолвит contactIds через LeadRepository ДО чтения contacts, передаёт множество в фильтр', async () => {
    const organizationId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const contactIds = [new Types.ObjectId(), new Types.ObjectId()];
    const distinctContactIdsForOwner = jest.fn().mockResolvedValue(contactIds);
    const listForOrganization = jest.fn().mockResolvedValue([]);
    const service = makeReadContactsService({
      leadRepository: { distinctContactIdsForOwner },
      contactRepository: { listForOrganization },
    });

    await service.listContacts({ organizationId, ownerPositionId, limit: 20 });

    expect(distinctContactIdsForOwner).toHaveBeenCalledWith(organizationId, ownerPositionId);
    expect(listForOrganization).toHaveBeenCalledWith(organizationId, {
      contactIds,
      q: undefined,
      cursor: undefined,
      limit: 21,
    });
  });

  it('q передаётся как экранированный regex, метасимволы не интерпретируются', async () => {
    const organizationId = new Types.ObjectId();
    const listForOrganization = jest.fn().mockResolvedValue([]);
    const service = makeReadContactsService({
      contactRepository: { listForOrganization },
    });

    await service.listContacts({ organizationId, q: 'a.b+c', limit: 20 });

    const callArgs = listForOrganization.mock.calls[0]![1] as { q: RegExp };
    expect(callArgs.q).toBeInstanceOf(RegExp);
    expect(callArgs.q.source).toBe('a\\.b\\+c');
    expect(callArgs.q.flags).toBe('i');
  });

  it('limit+1: nextCursor указывает на последнюю ВОЗВРАЩЁННУЮ запись, лишняя отбрасывается', async () => {
    const organizationId = new Types.ObjectId();
    const contactIds = [new Types.ObjectId(), new Types.ObjectId()];
    const rows = contactIds.map((id) => ({
      _id: id,
      organizationId,
      name: 'Иван',
      phone: '+79990000000',
      createdAt: new Date('2026-08-30T10:00:00Z'),
    }));
    const service = makeReadContactsService({
      contactRepository: { listForOrganization: jest.fn().mockResolvedValue(rows) },
    });

    const result = await service.listContacts({ organizationId, limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe(contactIds[0]!.toString());
  });

  it('маппит ContactDocument в CrmContactReadModel — email:null и сегмент "active", если у контакта нет ни сделки, ни лида', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const service = makeReadContactsService({
      contactRepository: {
        listForOrganization: jest.fn().mockResolvedValue([
          {
            _id: contactId,
            organizationId,
            name: 'Иван',
            phone: '+79990000000',
            createdAt: new Date('2026-08-30T10:00:00Z'),
          },
        ]),
      },
    });

    const result = await service.listContacts({ organizationId, limit: 20 });

    expect(result.items).toEqual([
      {
        id: contactId.toString(),
        organizationId: organizationId.toString(),
        name: 'Иван',
        phone: '+79990000000',
        email: null,
        roles: [],
        dealsCount: 0,
        segment: 'active',
        createdAt: '2026-08-30T10:00:00.000Z',
      },
    ]);
  });

  it('roles контакта пробрасываются как есть', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const service = makeReadContactsService({
      contactRepository: {
        listForOrganization: jest.fn().mockResolvedValue([
          {
            _id: contactId,
            organizationId,
            name: 'Иван',
            phone: '+79990000000',
            roles: ['buyer', 'investor'],
            createdAt: new Date('2026-08-30T10:00:00Z'),
          },
        ]),
      },
    });

    const result = await service.listContacts({ organizationId, limit: 20 });

    expect((result.items[0] as { roles: string[] }).roles).toEqual(['buyer', 'investor']);
  });

  it('сегмент "golden": сделка контакта в стадии golden — dealsCount считает все его сделки', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const service = makeReadContactsService({
      dealRepository: {
        listContactStagesForOrganization: jest.fn().mockResolvedValue([
          { contactId, stage: 'showing' },
          { contactId, stage: 'golden' },
        ]),
        listStagesForContact: jest.fn(),
      },
      contactRepository: {
        listForOrganization: jest.fn().mockResolvedValue([
          { _id: contactId, organizationId, name: 'Иван', phone: '+79990000000', createdAt: new Date() },
        ]),
      },
    });

    const result = await service.listContacts({ organizationId, limit: 20 });

    expect(result.items[0]).toMatchObject({ segment: 'golden', dealsCount: 2 });
  });

  it('сегмент "archived": сделка сорвалась, открытых лидов нет', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const service = makeReadContactsService({
      dealRepository: {
        listContactStagesForOrganization: jest.fn().mockResolvedValue([{ contactId, stage: 'closed_lost' }]),
        listStagesForContact: jest.fn(),
      },
      contactRepository: {
        listForOrganization: jest.fn().mockResolvedValue([
          { _id: contactId, organizationId, name: 'Иван', phone: '+79990000000', createdAt: new Date() },
        ]),
      },
    });

    const result = await service.listContacts({ organizationId, limit: 20 });

    expect(result.items[0]).toMatchObject({ segment: 'archived', dealsCount: 1 });
  });

  it('фильтр по вкладке segment: сужает contactIds ДО чтения страницы, own-scope пересекается с сегментом', async () => {
    const organizationId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const goldenContact = new Types.ObjectId();
    const activeContact = new Types.ObjectId();
    const listForOrganization = jest.fn().mockResolvedValue([]);
    const service = makeReadContactsService({
      leadRepository: { distinctContactIdsForOwner: jest.fn().mockResolvedValue([goldenContact, activeContact]) },
      dealRepository: {
        listContactStagesForOrganization: jest.fn().mockResolvedValue([
          { contactId: goldenContact, stage: 'golden' },
          { contactId: activeContact, stage: 'showing' },
        ]),
        listStagesForContact: jest.fn(),
      },
      contactRepository: { listForOrganization },
    });

    await service.listContacts({ organizationId, ownerPositionId, segment: 'golden', limit: 20 });

    expect(listForOrganization).toHaveBeenCalledWith(organizationId, {
      contactIds: [goldenContact],
      q: undefined,
      cursor: undefined,
      limit: 21,
    });
  });

  it('фильтр по вкладке "active" без own-scope: подтягивает все id организации (listAllIds), включая контакты без единой сделки/лида', async () => {
    const organizationId = new Types.ObjectId();
    const freshContact = new Types.ObjectId();
    const goldenContact = new Types.ObjectId();
    const listAllIds = jest.fn().mockResolvedValue([freshContact, goldenContact]);
    const listForOrganization = jest.fn().mockResolvedValue([]);
    const service = makeReadContactsService({
      dealRepository: {
        listContactStagesForOrganization: jest.fn().mockResolvedValue([{ contactId: goldenContact, stage: 'golden' }]),
        listStagesForContact: jest.fn(),
      },
      contactRepository: { listForOrganization, listAllIds },
    });

    await service.listContacts({ organizationId, segment: 'active', limit: 20 });

    expect(listAllIds).toHaveBeenCalledWith(organizationId);
    expect(listForOrganization).toHaveBeenCalledWith(organizationId, {
      contactIds: [freshContact],
      q: undefined,
      cursor: undefined,
      limit: 21,
    });
  });
});

describe('CrmService.getContact', () => {
  function makeReadContactService(overrides: {
    leadRepository?: unknown;
    contactRepository?: unknown;
    dealRepository?: unknown;
  }) {
    const service = createTestCrmService({
      dealRepository: overrides.dealRepository ?? emptyStagesRepo(),
      leadRepository: { ...emptyStagesRepo(), ...(overrides.leadRepository as object) },
      contactRepository: overrides.contactRepository,
    });
    return service as unknown as {
      getContact(params: {
        contactId: Types.ObjectId;
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
      }): Promise<unknown>;
    };
  }

  it('organization-scope: не резолвит contactIds, читает напрямую по organizationId', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const distinctContactIdsForOwner = jest.fn();
    const findByIdForOrganizationScoped = jest.fn().mockResolvedValue({
      _id: contactId,
      organizationId,
      name: 'Иван',
      phone: '+79990000000',
      createdAt: new Date('2026-08-30T10:00:00Z'),
    });
    const service = makeReadContactService({
      leadRepository: { distinctContactIdsForOwner },
      contactRepository: { findByIdForOrganizationScoped },
    });

    await service.getContact({ contactId, organizationId });

    expect(distinctContactIdsForOwner).not.toHaveBeenCalled();
    expect(findByIdForOrganizationScoped).toHaveBeenCalledWith(contactId, organizationId, undefined);
  });

  it('own-scope: резолвит contactIds ДО чтения, передаёт в findByIdForOrganizationScoped', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const contactIds = [contactId];
    const distinctContactIdsForOwner = jest.fn().mockResolvedValue(contactIds);
    const findByIdForOrganizationScoped = jest.fn().mockResolvedValue({
      _id: contactId,
      organizationId,
      name: 'Иван',
      phone: '+79990000000',
      createdAt: new Date('2026-08-30T10:00:00Z'),
    });
    const service = makeReadContactService({
      leadRepository: { distinctContactIdsForOwner },
      contactRepository: { findByIdForOrganizationScoped },
    });

    await service.getContact({ contactId, organizationId, ownerPositionId });

    expect(distinctContactIdsForOwner).toHaveBeenCalledWith(organizationId, ownerPositionId);
    expect(findByIdForOrganizationScoped).toHaveBeenCalledWith(contactId, organizationId, contactIds);
  });

  it('чужой (другая организация) контакт — NotFoundException', async () => {
    const service = makeReadContactService({
      contactRepository: { findByIdForOrganizationScoped: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.getContact({ contactId: new Types.ObjectId(), organizationId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('несуществующий contactId даёт ТОТ ЖЕ NotFoundException, что чужой (non-disclosure)', async () => {
    const service = makeReadContactService({
      contactRepository: { findByIdForOrganizationScoped: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.getContact({ contactId: new Types.ObjectId(), organizationId: new Types.ObjectId() }),
    ).rejects.toThrow('Contact not found');
  });

  it('own-scope: контакт вне множества "своих" — NotFoundException (репозиторий возвращает null)', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const service = makeReadContactService({
      leadRepository: { distinctContactIdsForOwner: jest.fn().mockResolvedValue([new Types.ObjectId()]) },
      contactRepository: { findByIdForOrganizationScoped: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.getContact({ contactId, organizationId, ownerPositionId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('сегмент и dealsCount считаются по стадиям сделок/лидов ИМЕННО этого контакта', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const service = makeReadContactService({
      dealRepository: {
        listContactStagesForOrganization: jest.fn(),
        listStagesForContact: jest.fn().mockResolvedValue(['showing', 'deposit']),
      },
      contactRepository: {
        findByIdForOrganizationScoped: jest.fn().mockResolvedValue({
          _id: contactId,
          organizationId,
          name: 'Иван',
          phone: '+79990000000',
          createdAt: new Date('2026-08-30T10:00:00Z'),
        }),
      },
    });

    const result = await service.getContact({ contactId, organizationId });

    expect(result).toMatchObject({ segment: 'active', dealsCount: 2 });
  });
});

describe('CrmService.createContact', () => {
  function makeCreateContactService(overrides: { contactRepository?: unknown; auditService?: unknown; idempotencyService?: unknown }) {
    const service = createTestCrmService(overrides);
    return service as unknown as {
      createContact(params: {
        organizationId: Types.ObjectId;
        name: string;
        phone: string;
        email?: string;
        roles?: string[];
        actorIdentityId: Types.ObjectId;
        correlationId: string;
        idempotencyKey: string;
        idempotencyRequestBody: Record<string, unknown>;
      }): Promise<unknown>;
    };
  }

  it('телефон занят другим контактом организации — CONTACT_PHONE_TAKEN, контакт не создаётся', async () => {
    const organizationId = new Types.ObjectId();
    const create = jest.fn();
    const service = makeCreateContactService({
      contactRepository: {
        findByPhone: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
        create,
      },
    });

    await expect(
      service.createContact({
        organizationId,
        name: 'Иван',
        phone: '+79990000000',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'corr-1',
        idempotencyKey: 'key-1',
        idempotencyRequestBody: {},
      }),
    ).rejects.toMatchObject({ code: 'CONTACT_PHONE_TAKEN' });
    expect(create).not.toHaveBeenCalled();
  });

  it('свободный телефон — создаёт контакт, пишет аудит и запись идемпотентности в той же транзакции', async () => {
    const organizationId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();
    const createdId = new Types.ObjectId();
    const auditAppend = jest.fn();
    const idempotencyRecord = jest.fn();
    const create = jest.fn().mockResolvedValue({
      _id: createdId,
      organizationId,
      name: 'Иван',
      phone: '+79990000000',
      roles: ['buyer'],
      createdAt: new Date('2026-08-30T10:00:00Z'),
    });
    const service = makeCreateContactService({
      contactRepository: { findByPhone: jest.fn().mockResolvedValue(null), create },
      auditService: { append: auditAppend },
      idempotencyService: { checkReplay: jest.fn(), record: idempotencyRecord },
    });

    const result = await service.createContact({
      organizationId,
      name: 'Иван',
      phone: '+79990000000',
      roles: ['buyer'],
      actorIdentityId,
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      idempotencyRequestBody: { name: 'Иван' },
    });

    expect(create).toHaveBeenCalledWith(
      { organizationId, name: 'Иван', phone: '+79990000000', email: undefined, roles: ['buyer'] },
      expect.anything(),
    );
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contact.create', resource: 'contact', resourceId: createdId }),
      expect.anything(),
    );
    expect(idempotencyRecord).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'createContact', key: 'key-1', responseStatus: 201 }),
      expect.anything(),
    );
    expect(result).toMatchObject({ id: createdId.toString(), segment: 'active', dealsCount: 0 });
  });
});

describe('CrmService.updateContact', () => {
  function makeUpdateContactService(overrides: {
    contactRepository?: unknown;
    leadRepository?: unknown;
    dealRepository?: unknown;
    auditService?: unknown;
  }) {
    const service = createTestCrmService({
      dealRepository: overrides.dealRepository ?? emptyStagesRepo(),
      leadRepository: { ...emptyStagesRepo(), ...(overrides.leadRepository as object) },
      contactRepository: overrides.contactRepository,
      auditService: overrides.auditService ?? { append: jest.fn() },
    });
    return service as unknown as {
      updateContact(params: {
        contactId: Types.ObjectId;
        organizationId: Types.ObjectId;
        ownerPositionId?: Types.ObjectId;
        name?: string;
        phone?: string;
        email?: string | null;
        roles?: string[];
        actorIdentityId: Types.ObjectId;
        correlationId: string;
      }): Promise<unknown>;
    };
  }

  it('чужой/не найденный контакт — NotFoundException, репозиторий не пишет', async () => {
    const updateFields = jest.fn();
    const service = makeUpdateContactService({
      contactRepository: { findByIdForOrganizationScoped: jest.fn().mockResolvedValue(null), updateFields },
    });

    await expect(
      service.updateContact({
        contactId: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        name: 'Новое имя',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'corr-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateFields).not.toHaveBeenCalled();
  });

  it('новый телефон занят ДРУГИМ контактом — CONTACT_PHONE_TAKEN', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const otherContactId = new Types.ObjectId();
    const updateFields = jest.fn();
    const service = makeUpdateContactService({
      contactRepository: {
        findByIdForOrganizationScoped: jest.fn().mockResolvedValue({
          _id: contactId,
          organizationId,
          name: 'Иван',
          phone: '+79990000000',
          createdAt: new Date(),
        }),
        findByPhone: jest.fn().mockResolvedValue({ _id: otherContactId }),
        updateFields,
      },
    });

    await expect(
      service.updateContact({
        contactId,
        organizationId,
        phone: '+79991110000',
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: 'CONTACT_PHONE_TAKEN' });
    expect(updateFields).not.toHaveBeenCalled();
  });

  it('телефон меняется на СВОЙ ЖЕ (тот, что уже есть у контакта) — не конфликт', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const contact = { _id: contactId, organizationId, name: 'Иван', phone: '+79990000000', createdAt: new Date() };
    const updateFields = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const findByPhone = jest.fn();
    const service = makeUpdateContactService({
      contactRepository: {
        findByIdForOrganizationScoped: jest.fn().mockResolvedValue(contact),
        findByPhone,
        updateFields,
        findByIdForOrganization: jest.fn().mockResolvedValue(contact),
      },
    });

    await service.updateContact({
      contactId,
      organizationId,
      phone: '+79990000000',
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'corr-1',
    });

    expect(findByPhone).not.toHaveBeenCalled();
    expect(updateFields).toHaveBeenCalled();
  });

  it('roles меняются отдельным вызовом updateRoles', async () => {
    const contactId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const contact = { _id: contactId, organizationId, name: 'Иван', phone: '+79990000000', createdAt: new Date() };
    const updateRoles = jest.fn().mockResolvedValue(undefined);
    const service = makeUpdateContactService({
      contactRepository: {
        findByIdForOrganizationScoped: jest.fn().mockResolvedValue(contact),
        updateFields: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        updateRoles,
        findByIdForOrganization: jest.fn().mockResolvedValue({ ...contact, roles: ['investor'] }),
      },
    });

    const result = await service.updateContact({
      contactId,
      organizationId,
      roles: ['investor'],
      actorIdentityId: new Types.ObjectId(),
      correlationId: 'corr-1',
    });

    expect(updateRoles).toHaveBeenCalledWith(contactId, organizationId, ['investor'], expect.anything());
    expect(result).toMatchObject({ roles: ['investor'] });
  });
});

describe('CrmService — getLeadTimeline & getContactTimeline', () => {
  it('getLeadTimeline: агрегирует lead_events, tasks и audit_events в хронологическом порядке', async () => {
    const organizationId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const taskId = new Types.ObjectId();
    const positionId = new Types.ObjectId();

    const lead = {
      _id: leadId,
      organizationId,
      stage: 'contacted',
      createdAt: new Date('2026-08-01T10:00:00Z'),
    };

    const leadEvents = [
      {
        _id: new Types.ObjectId(),
        leadId,
        stage: 'contacted',
        changedBy: { type: 'position', positionId },
        changedAt: new Date('2026-08-02T12:00:00Z'),
      },
    ];

    const tasks = [
      {
        _id: taskId,
        organizationId,
        title: 'Перезвонить клиенту',
        status: 'completed',
        assignedPositionId: positionId,
        completedByPositionId: positionId,
        createdAt: new Date('2026-08-03T10:00:00Z'),
        completedAt: new Date('2026-08-04T15:00:00Z'),
      },
    ];

    const auditEvents = [
      {
        _id: new Types.ObjectId(),
        action: 'lead.assign',
        actor: { type: 'position', id: positionId },
        createdAt: new Date('2026-08-02T11:00:00Z'),
        resourceId: leadId,
        after: { ownerPositionId: positionId.toString() },
      },
    ];

    const service = createTestCrmService({
      leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(lead) },
      leadEventRepository: { listForLead: jest.fn().mockResolvedValue(leadEvents) },
      taskRepository: { listForLead: jest.fn().mockResolvedValue(tasks) },
      auditService: { findByResources: jest.fn().mockResolvedValue(auditEvents) },
    });

    const readService = service as unknown as {
      getLeadTimeline(params: {
        leadId: Types.ObjectId;
        organizationId: Types.ObjectId;
        limit: number;
      }): Promise<{ items: Array<{ id: string; type: string; happenedAt: string }>; nextCursor: string | null }>;
    };

    const result = await readService.getLeadTimeline({ leadId, organizationId, limit: 10 });

    expect(result.items).toHaveLength(4);
    // Newest first:
    expect(result.items[0]!.type).toBe('task_completed');
    expect(result.items[1]!.type).toBe('task_created');
    expect(result.items[2]!.type).toBe('lead_stage_changed');
    expect(result.items[3]!.type).toBe('lead_assigned');
  });

  it('getContactTimeline: own-scope non-disclosure: 404 если нет лидов у менеджера', async () => {
    const organizationId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();

    const service = createTestCrmService({
      contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: contactId, organizationId }) },
      leadRepository: { findLeadIdsForContact: jest.fn().mockResolvedValue([]) },
    });

    const readService = service as unknown as {
      getContactTimeline(params: {
        contactId: Types.ObjectId;
        organizationId: Types.ObjectId;
        ownerPositionId: Types.ObjectId;
        limit: number;
      }): Promise<unknown>;
    };

    await expect(
      readService.getContactTimeline({ contactId, organizationId, ownerPositionId, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('Deal Core (DEAL-001)', () => {
    it('createDeal: rejects a non-assignable owner position before writing', async () => {
      const organizationId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const findAssignablePosition = jest.fn().mockRejectedValue(new NotFoundException('Position not found'));
      const dealRepository = { create: jest.fn() };
      const service = createTestCrmService({
        organizationsService: { findAssignablePosition },
        contactRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue({ _id: contactId, name: 'Alice', phone: '+995555111222' }),
        },
        dealRepository,
      });

      await expect(
        service.createDeal({
          organizationId,
          contactId,
          ownerPositionId,
          title: 'Deal with validated owner',
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'corr-owner-validation',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(findAssignablePosition).toHaveBeenCalledWith(ownerPositionId, organizationId, expect.anything());
      expect(dealRepository.create).not.toHaveBeenCalled();
    });

    it('updateDealChecklist: rejects a stale expectedVersion before it can overwrite the checklist', async () => {
      const organizationId = new Types.ObjectId();
      const dealId = new Types.ObjectId();
      const dealRepository = {
        findByIdForOrganization: jest.fn().mockResolvedValue({
          _id: dealId,
          organizationId,
          contactId: new Types.ObjectId(),
          ownerPositionId: new Types.ObjectId(),
          stage: 'showing',
          title: 'Concurrent checklist',
          version: 1,
          participants: [],
          checklistItems: [],
        }),
        updateChecklist: jest.fn(),
      };
      const service = createTestCrmService({ dealRepository });

      await expect(
        service.updateDealChecklist({
          dealId,
          organizationId,
          items: [{ label: 'Cannot clobber a newer checklist', done: true }],
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'corr-stale-checklist',
        }),
      ).rejects.toThrow(ConflictException);

      expect(dealRepository.updateChecklist).not.toHaveBeenCalled();
    });

    it('createDeal: throws NotFoundException when primary contact does not exist in organization', async () => {
      const organizationId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const service = createTestCrmService({
        contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.createDeal({
          organizationId,
          contactId,
          ownerPositionId: new Types.ObjectId(),
          title: 'Deal 1',
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'corr-1',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('createDeal: creates deal, appends deal event, records audit', async () => {
      const organizationId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();
      const dealId = new Types.ObjectId();

      const createdDeal = {
        _id: dealId,
        organizationId,
        contactId,
        ownerPositionId,
        title: 'Penthouse sale',
        stage: 'showing',
        version: 0,
        participants: [],
        checklistItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dealRepo = {
        create: jest.fn().mockResolvedValue(createdDeal),
      };
      const dealEventRepo = {
        append: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      };
      const auditService = {
        append: jest.fn().mockResolvedValue(undefined),
      };
      const contactRepo = {
        findByIdForOrganization: jest.fn().mockResolvedValue({
          _id: contactId,
          name: 'Alice',
          phone: '+995555111222',
        }),
        findByIdsForOrganization: jest.fn().mockResolvedValue([]),
      };

      const service = createTestCrmService({
        dealRepository: dealRepo,
        dealEventRepository: dealEventRepo,
        auditService,
        contactRepository: contactRepo,
      });

      const res = await service.createDeal({
        organizationId,
        contactId,
        ownerPositionId,
        title: 'Penthouse sale',
        actorPositionId,
        actorIdentityId,
        correlationId: 'corr-create-deal',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
      });

      expect(res.id).toBe(dealId.toString());
      expect(res.title).toBe('Penthouse sale');
      expect(res.stage).toBe('showing');
      expect(dealRepo.create).toHaveBeenCalled();
      expect(dealEventRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({ dealId, stage: 'showing' }),
        expect.anything(),
      );
      expect(auditService.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deal.create', resourceId: dealId }),
        expect.anything(),
      );
    });

    it('changeDealStage: throws AppException on invalid transition (showing -> referral)', async () => {
      const organizationId = new Types.ObjectId();
      const dealId = new Types.ObjectId();
      const deal = {
        _id: dealId,
        organizationId,
        stage: 'showing',
        version: 0,
      };

      const service = createTestCrmService({
        dealRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(deal),
        },
      });

      await expect(
        service.changeDealStage({
          dealId,
          organizationId,
          newStage: 'referral',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'corr-stage',
        }),
      ).rejects.toThrow(AppException);
    });

    it('changeDealStage: throws ConflictException when expectedVersion mismatches', async () => {
      const organizationId = new Types.ObjectId();
      const dealId = new Types.ObjectId();
      const deal = {
        _id: dealId,
        organizationId,
        stage: 'showing',
        version: 2,
      };

      const service = createTestCrmService({
        dealRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(deal),
        },
      });

      await expect(
        service.changeDealStage({
          dealId,
          organizationId,
          newStage: 'deposit',
          expectedVersion: 1, // Expected 1, actual 2
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'corr-stage',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('changeDealStage: executes valid transition (showing -> deposit) and records audit', async () => {
      const organizationId = new Types.ObjectId();
      const dealId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const dealBefore = {
        _id: dealId,
        organizationId,
        contactId,
        ownerPositionId,
        title: 'Deal 1',
        stage: 'showing',
        version: 0,
        participants: [],
        checklistItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dealAfter = {
        ...dealBefore,
        stage: 'deposit',
        version: 1,
      };

      const dealRepo = {
        findByIdForOrganization: jest.fn()
          .mockResolvedValueOnce(dealBefore)
          .mockResolvedValueOnce(dealAfter),
        changeStageWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      const dealEventRepo = {
        append: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      };
      const auditService = {
        append: jest.fn().mockResolvedValue(undefined),
      };
      const contactRepo = {
        findByIdsForOrganization: jest.fn().mockResolvedValue([{ _id: contactId, name: 'Bob', phone: '+995555123456' }]),
      };

      const service = createTestCrmService({
        dealRepository: dealRepo,
        dealEventRepository: dealEventRepo,
        auditService,
        contactRepository: contactRepo,
      });

      const res = await service.changeDealStage({
        dealId,
        organizationId,
        newStage: 'deposit',
        expectedVersion: 0,
        reason: 'Deposit payment received',
        actorPositionId,
        actorIdentityId,
        correlationId: 'corr-stage-valid',
      });

      expect(res.stage).toBe('deposit');
      expect(res.version).toBe(1);
      expect(dealEventRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({ dealId, stage: 'deposit', fromStage: 'showing', reason: 'Deposit payment received' }),
        expect.anything(),
      );
      expect(auditService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'deal.change_stage',
          before: { stage: 'showing', version: 0 },
          after: { stage: 'deposit', version: 1, reason: 'Deposit payment received' },
        }),
        expect.anything(),
      );
    });
  });
});

describe('CRM-004: Task outbox events', () => {
  function makeTaskDoc(overrides: Partial<{
    _id: Types.ObjectId;
    organizationId: Types.ObjectId;
    title: string;
    status: 'open' | 'completed' | 'cancelled';
    assignedPositionId: Types.ObjectId;
    leadId: Types.ObjectId;
    contactId: Types.ObjectId;
    completedAt: Date;
    completedByPositionId: Types.ObjectId;
    version: number;
  }> = {}) {
    return {
      _id: overrides._id ?? new Types.ObjectId(),
      organizationId: overrides.organizationId ?? new Types.ObjectId(),
      title: overrides.title ?? 'Задача',
      status: overrides.status ?? 'open',
      assignedPositionId: overrides.assignedPositionId,
      leadId: overrides.leadId,
      contactId: overrides.contactId,
      completedAt: overrides.completedAt,
      completedByPositionId: overrides.completedByPositionId,
      version: overrides.version ?? 0,
      createdAt: new Date('2026-08-30T10:00:00Z'),
      updatedAt: new Date('2026-08-30T10:00:00Z'),
    };
  }

  describe('createTask', () => {
    function makeCreateTaskService(overrides: {
      leadRepository?: unknown;
      contactRepository?: unknown;
      taskRepository?: unknown;
      organizationsService?: unknown;
      auditService?: unknown;
      outboxService?: unknown;
    }) {
      return createTestCrmService(overrides) as unknown as {
        createTask(params: {
          organizationId: Types.ObjectId;
          actorPositionId: Types.ObjectId;
          actorIdentityId: Types.ObjectId;
          requiredScopePositionId?: Types.ObjectId;
          title: string;
          description?: string;
          dueAt?: Date;
          assignedPositionId?: Types.ObjectId;
          leadId?: Types.ObjectId;
          contactId?: Types.ObjectId;
          correlationId: string;
          idempotencyKey: string;
          idempotencyRequestBody: Record<string, unknown>;
          idempotencyOperation: string;
        }): Promise<unknown>;
      };
    }

    it('публикует TaskCreated внутри транзакции с минимальным payload', async () => {
      const organizationId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const assignedPositionId = new Types.ObjectId();
      const actorPositionId = new Types.ObjectId();
      const task = makeTaskDoc({ organizationId, leadId, contactId, assignedPositionId });
      const publish = jest.fn().mockResolvedValue(undefined);

      const service = makeCreateTaskService({
        leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: leadId, contactId }) },
        contactRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: contactId }) },
        taskRepository: { create: jest.fn().mockResolvedValue(task) },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
        outboxService: { publish },
      });

      await service.createTask({
        organizationId,
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        title: 'Позвонить',
        assignedPositionId,
        leadId,
        contactId,
        correlationId: 'corr-1',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
      idempotencyOperation: 'createTask',
      });

      expect(publish).toHaveBeenCalledTimes(1);
      const [publishedEvent, session] = publish.mock.calls[0]!;
      expect(publishedEvent).toEqual({
        eventType: 'TaskCreated',
        aggregateType: 'task',
        aggregateId: task._id,
        payload: {
          taskId: task._id.toString(),
          organizationId: organizationId.toString(),
          leadId: leadId.toString(),
          contactId: contactId.toString(),
          assignedPositionId: assignedPositionId.toString(),
          actorPositionId: actorPositionId.toString(),
          occurredAt: expect.any(String),
          correlationId: 'corr-1',
        },
      });
      // Payload не содержит title/description/телефон/сырой документ.
      expect(publishedEvent.payload).not.toHaveProperty('title');
      expect(publishedEvent.payload).not.toHaveProperty('description');
      expect(publishedEvent.payload).not.toHaveProperty('phone');
      expect(session).toBeDefined();
    });

    it('несуществующий leadId — NotFoundException, TaskCreated НЕ публикуется', async () => {
      const publish = jest.fn();
      const service = makeCreateTaskService({
        leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
        taskRepository: { create: jest.fn() },
        outboxService: { publish },
      });

      await expect(
        service.createTask({
          organizationId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          title: 'x',
          leadId: new Types.ObjectId(),
          correlationId: 'corr-1',
      idempotencyKey: 'test-key',
      idempotencyRequestBody: { probe: 1 },
      idempotencyOperation: 'createTask',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('updateTask', () => {
    function makeUpdateTaskService(overrides: {
      leadRepository?: unknown;
      taskRepository?: unknown;
      auditService?: unknown;
      mediaService?: unknown;
    }) {
      return createTestCrmService(overrides) as unknown as {
        updateTask(params: {
          taskId: Types.ObjectId;
          organizationId: Types.ObjectId;
          actorPositionId: Types.ObjectId;
          actorIdentityId: Types.ObjectId;
          requiredScopePositionId?: Types.ObjectId;
          expectedVersion: number;
          title?: string;
          description?: string | null;
          dueAt?: Date | null;
          startAt?: Date | null;
          status?: 'open' | 'in_progress' | 'cancelled';
          isUrgent?: boolean;
          isImportant?: boolean;
          taskCategory?: 'work' | 'personal';
          taskType?: 'standard' | 'call' | 'meeting';
          colorHex?: string | null;
          leadId?: Types.ObjectId | null;
          attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
          correlationId: string;
        }): Promise<unknown>;
      };
    }

    it('смена лида ставит contactId задачи в contactId лида', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const newLeadId = new Types.ObjectId();
      const leadContactId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, version: 0 });
      const updatedTask = makeTaskDoc({ _id: taskId, organizationId, leadId: newLeadId, contactId: leadContactId, version: 1 });
      const updateTaskSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });

      const service = makeUpdateTaskService({
        leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: newLeadId, contactId: leadContactId }) },
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValueOnce(existingTask).mockResolvedValueOnce(updatedTask),
          updateTask: updateTaskSpy,
        },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
      });

      const result = (await service.updateTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        leadId: newLeadId,
        correlationId: 'corr-upd-1',
      })) as { leadId: string | null; contactId: string | null };

      expect(updateTaskSpy).toHaveBeenCalledWith(
        taskId,
        organizationId,
        0,
        expect.objectContaining({ leadId: newLeadId, contactId: leadContactId }),
        expect.anything(),
      );
      expect(result.leadId).toBe(newLeadId.toString());
      expect(result.contactId).toBe(leadContactId.toString());
    });

    it('отвязка лида (leadId:null) снимает и leadId, и contactId', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const oldLeadId = new Types.ObjectId();
      const oldContactId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, leadId: oldLeadId, contactId: oldContactId, version: 0 });
      const updatedTask = makeTaskDoc({ _id: taskId, organizationId, version: 1 });
      const updateTaskSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });

      const service = makeUpdateTaskService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValueOnce(existingTask).mockResolvedValueOnce(updatedTask),
          updateTask: updateTaskSpy,
        },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
      });

      const result = (await service.updateTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        leadId: null,
        correlationId: 'corr-upd-2',
      })) as { leadId: string | null; contactId: string | null; entityType: string };

      expect(updateTaskSpy).toHaveBeenCalledWith(
        taskId,
        organizationId,
        0,
        expect.objectContaining({ leadId: null, contactId: null }),
        expect.anything(),
      );
      expect(result.leadId).toBeNull();
      expect(result.contactId).toBeNull();
      expect(result.entityType).toBe('none');
    });

    it('чужой/несуществующий лид — NotFoundException, updateTask репозитория не вызывается', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, version: 0 });
      const updateTaskSpy = jest.fn();

      const service = makeUpdateTaskService({
        leadRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(existingTask),
          updateTask: updateTaskSpy,
        },
      });

      await expect(
        service.updateTask({
          taskId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedVersion: 0,
          leadId: new Types.ObjectId(),
          correlationId: 'corr-upd-3',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updateTaskSpy).not.toHaveBeenCalled();
    });

    it('вложение не найдено в организации — NotFoundException', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, version: 0 });
      const updateTaskSpy = jest.fn();

      const service = makeUpdateTaskService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(existingTask),
          updateTask: updateTaskSpy,
        },
        mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(new Map()) },
      });

      await expect(
        service.updateTask({
          taskId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedVersion: 0,
          attachments: [{ assetId: new Types.ObjectId(), fileName: 'x.pdf' }],
          correlationId: 'corr-upd-4',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updateTaskSpy).not.toHaveBeenCalled();
    });

    it('вложение ещё не verified — VALIDATION_FAILED', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const assetId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, version: 0 });
      const updateTaskSpy = jest.fn();

      const service = makeUpdateTaskService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(existingTask),
          updateTask: updateTaskSpy,
        },
        mediaService: {
          getAssetsForOwnerScope: jest.fn().mockResolvedValue(
            new Map([[assetId.toString(), { status: 'pending' }]]),
          ),
        },
      });

      await expect(
        service.updateTask({
          taskId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedVersion: 0,
          attachments: [{ assetId, fileName: 'x.pdf' }],
          correlationId: 'corr-upd-5',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(updateTaskSpy).not.toHaveBeenCalled();
    });

    it('устаревший expectedVersion — ConflictException (409)', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, version: 3 });

      const service = makeUpdateTaskService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(existingTask),
          updateTask: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
      });

      await expect(
        service.updateTask({
          taskId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedVersion: 1,
          title: 'Новое название',
          correlationId: 'corr-upd-6',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('isUrgent/isImportant/taskCategory/taskType передаются в репозиторий и попадают в audit before/after', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, version: 0 });
      const updatedTask = {
        ...makeTaskDoc({ _id: taskId, organizationId, version: 1 }),
        isUrgent: true,
        isImportant: false,
        taskCategory: 'personal',
        taskType: 'call',
      };
      const updateTaskSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const auditAppend = jest.fn().mockResolvedValue(undefined);

      const service = makeUpdateTaskService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValueOnce(existingTask).mockResolvedValueOnce(updatedTask),
          updateTask: updateTaskSpy,
        },
        auditService: { append: auditAppend },
      });

      await service.updateTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        isUrgent: true,
        isImportant: false,
        taskCategory: 'personal',
        taskType: 'call',
        correlationId: 'corr-upd-7',
      });

      expect(updateTaskSpy).toHaveBeenCalledWith(
        taskId,
        organizationId,
        0,
        expect.objectContaining({
          isUrgent: true,
          isImportant: false,
          taskCategory: 'personal',
          taskType: 'call',
        }),
        expect.anything(),
      );
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'task.update',
          after: expect.objectContaining({ isUrgent: true, isImportant: false, taskCategory: 'personal', taskType: 'call' }),
        }),
        expect.anything(),
      );
    });
  });

  describe('completeTask', () => {
    function makeCompleteService(overrides: { taskRepository?: unknown; auditService?: unknown; outboxService?: unknown }) {
      return createTestCrmService(overrides) as unknown as {
        completeTask(params: {
          taskId: Types.ObjectId;
          organizationId: Types.ObjectId;
          actorPositionId: Types.ObjectId;
          actorIdentityId: Types.ObjectId;
          requiredScopePositionId?: Types.ObjectId;
          expectedVersion: number;
          correlationId: string;
        }): Promise<unknown>;
      };
    }

    it('первый успешный open→completed — публикует TaskCompleted с версионированным deduplicationKey', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const actorPositionId = new Types.ObjectId();
      const openTask = makeTaskDoc({ _id: taskId, organizationId, leadId, status: 'open', version: 0 });
      const completedTask = makeTaskDoc({
        _id: taskId,
        organizationId,
        leadId,
        status: 'completed',
        version: 1,
        completedAt: new Date('2026-08-30T12:00:00Z'),
        completedByPositionId: actorPositionId,
      });
      const publish = jest.fn().mockResolvedValue(undefined);

      const service = makeCompleteService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValueOnce(openTask).mockResolvedValueOnce(completedTask),
          completeTask: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
        outboxService: { publish },
      });

      await service.completeTask({
        taskId,
        organizationId,
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        correlationId: 'corr-2',
      });

      expect(publish).toHaveBeenCalledTimes(1);
      const [publishedEvent] = publish.mock.calls[0]!;
      expect(publishedEvent.eventType).toBe('TaskCompleted');
      expect(publishedEvent.deduplicationKey).toBe(`task:${taskId.toString()}:TaskCompleted:v1`);
      expect(publishedEvent.payload.taskId).toBe(taskId.toString());
      expect(publishedEvent.payload.leadId).toBe(leadId.toString());
    });

    it('уже completed (идемпотентный повтор) — TaskCompleted НЕ публикуется повторно', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const publish = jest.fn();
      const completeTaskSpy = jest.fn();
      const service = makeCompleteService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(
            makeTaskDoc({ _id: taskId, organizationId, status: 'completed', version: 7 }),
          ),
          completeTask: completeTaskSpy,
        },
        outboxService: { publish },
      });

      await service.completeTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        correlationId: 'corr-3',
      });

      expect(completeTaskSpy).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('modifiedCount:0 (устаревший expectedVersion, 409) — TaskCompleted НЕ публикуется', async () => {
      const publish = jest.fn();
      const service = makeCompleteService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(makeTaskDoc({ status: 'open', version: 2 })),
          completeTask: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
        outboxService: { publish },
      });

      await expect(
        service.completeTask({
          taskId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedVersion: 1,
          correlationId: 'corr-4',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(publish).not.toHaveBeenCalled();
    });

    it('чужая (own-scope не совпадает) задача — NotFoundException, TaskCompleted НЕ публикуется', async () => {
      const publish = jest.fn();
      const service = makeCompleteService({
        taskRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
        outboxService: { publish },
      });

      await expect(
        service.completeTask({
          taskId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          requiredScopePositionId: new Types.ObjectId(),
          expectedVersion: 0,
          correlationId: 'corr-5',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('reassignTask', () => {
    function makeReassignService(overrides: {
      taskRepository?: unknown;
      organizationsService?: unknown;
      auditService?: unknown;
      outboxService?: unknown;
    }) {
      return createTestCrmService(overrides) as unknown as {
        reassignTask(params: {
          taskId: Types.ObjectId;
          organizationId: Types.ObjectId;
          actorPositionId: Types.ObjectId;
          actorIdentityId: Types.ObjectId;
          requiredScopePositionId?: Types.ObjectId;
          expectedVersion: number;
          assignedPositionId: Types.ObjectId | null;
          correlationId: string;
        }): Promise<unknown>;
      };
    }

    it('фактическая смена assignedPositionId — публикует TaskReassigned с previous/new', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const oldAssignee = new Types.ObjectId();
      const newAssignee = new Types.ObjectId();
      const existingTask = makeTaskDoc({ _id: taskId, organizationId, assignedPositionId: oldAssignee, version: 0 });
      const updatedTask = makeTaskDoc({ _id: taskId, organizationId, assignedPositionId: newAssignee, version: 1 });
      const publish = jest.fn().mockResolvedValue(undefined);

      const service = makeReassignService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValueOnce(existingTask).mockResolvedValueOnce(updatedTask),
          reassignTask: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        },
        organizationsService: { findAssignablePosition: jest.fn().mockResolvedValue({ _id: newAssignee, status: 'vacant' }) },
        auditService: { append: jest.fn().mockResolvedValue(undefined) },
        outboxService: { publish },
      });

      await service.reassignTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        assignedPositionId: newAssignee,
        correlationId: 'corr-6',
      });

      expect(publish).toHaveBeenCalledTimes(1);
      const [publishedEvent] = publish.mock.calls[0]!;
      expect(publishedEvent.eventType).toBe('TaskReassigned');
      expect(publishedEvent.deduplicationKey).toBe(`task:${taskId.toString()}:TaskReassigned:v1`);
      expect(publishedEvent.payload.previousAssignedPositionId).toBe(oldAssignee.toString());
      expect(publishedEvent.payload.newAssignedPositionId).toBe(newAssignee.toString());
    });

    it('reassign на ТО ЖЕ значение — no-op: repository.reassignTask НЕ вызывается, TaskReassigned НЕ публикуется', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const samePositionId = new Types.ObjectId();
      const reassignTaskSpy = jest.fn();
      const publish = jest.fn();

      const service = makeReassignService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(
            makeTaskDoc({ _id: taskId, organizationId, assignedPositionId: samePositionId, version: 3 }),
          ),
          reassignTask: reassignTaskSpy,
        },
        outboxService: { publish },
      });

      await service.reassignTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 3,
        assignedPositionId: samePositionId,
        correlationId: 'corr-7',
      });

      expect(reassignTaskSpy).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('reassign null→null (оба unassigned) — тоже no-op', async () => {
      const taskId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const reassignTaskSpy = jest.fn();
      const publish = jest.fn();

      const service = makeReassignService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(
            makeTaskDoc({ _id: taskId, organizationId, version: 0 }),
          ),
          reassignTask: reassignTaskSpy,
        },
        outboxService: { publish },
      });

      await service.reassignTask({
        taskId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedVersion: 0,
        assignedPositionId: null,
        correlationId: 'corr-8',
      });

      expect(reassignTaskSpy).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('modifiedCount:0 (устаревший expectedVersion, 409) — TaskReassigned НЕ публикуется', async () => {
      const publish = jest.fn();
      const service = makeReassignService({
        taskRepository: {
          findByIdForOrganization: jest.fn().mockResolvedValue(makeTaskDoc({ version: 3 })),
          reassignTask: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
        organizationsService: { findAssignablePosition: jest.fn().mockResolvedValue({}) },
        outboxService: { publish },
      });

      await expect(
        service.reassignTask({
          taskId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedVersion: 1,
          assignedPositionId: new Types.ObjectId(),
          correlationId: 'corr-9',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(publish).not.toHaveBeenCalled();
    });

    it('чужая (own-scope не совпадает) задача — NotFoundException, TaskReassigned НЕ публикуется', async () => {
      const publish = jest.fn();
      const service = makeReassignService({
        taskRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
        outboxService: { publish },
      });

      await expect(
        service.reassignTask({
          taskId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          requiredScopePositionId: new Types.ObjectId(),
          expectedVersion: 0,
          assignedPositionId: new Types.ObjectId(),
          correlationId: 'corr-10',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(publish).not.toHaveBeenCalled();
    });
  });
});

describe('CrmService.getLeadFunnelReport', () => {
  it('без productType — не передаёт stages в репозиторий (агрегируются все продукты вперемешку)', async () => {
    const aggregateStageFunnel = jest.fn().mockResolvedValue([]);
    const service = createTestCrmService({ leadEventRepository: { aggregateStageFunnel } });
    const organizationId = new Types.ObjectId();

    await service.getLeadFunnelReport({ organizationId });

    expect(aggregateStageFunnel).toHaveBeenCalledWith(organizationId, {
      stages: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('с productType — сужает stages через stageIdsForProduct(productType)', async () => {
    const aggregateStageFunnel = jest.fn().mockResolvedValue([]);
    const service = createTestCrmService({ leadEventRepository: { aggregateStageFunnel } });
    const organizationId = new Types.ObjectId();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');

    await service.getLeadFunnelReport({ organizationId, productType: 'network', from, to });

    const call = aggregateStageFunnel.mock.calls[0]!;
    expect(call[0]).toBe(organizationId);
    expect(call[1].from).toBe(from);
    expect(call[1].to).toBe(to);
    expect(call[1].stages).toEqual(expect.arrayContaining(['network_new_lead', 'network_work_started']));
    expect(call[1].stages).not.toContain('new');
  });

  it('прокидывает результат репозитория как {stages: [{stage, leadCount}]}', async () => {
    const aggregateStageFunnel = jest
      .fn()
      .mockResolvedValue([{ stage: 'new', leadCount: 3 }, { stage: 'contacted', leadCount: 1 }]);
    const service = createTestCrmService({ leadEventRepository: { aggregateStageFunnel } });

    const result = await service.getLeadFunnelReport({ organizationId: new Types.ObjectId() });

    expect(result).toEqual({
      stages: [
        { stage: 'new', leadCount: 3 },
        { stage: 'contacted', leadCount: 1 },
      ],
    });
  });
});

describe('CrmService.getPositionsReport', () => {
  it('лид и сделка одной и той же позиции схлопываются в одну строку отчёта', async () => {
    const positionId = new Types.ObjectId();
    const aggregateLeadsByOwnerPosition = jest
      .fn()
      .mockResolvedValue([{ ownerPositionId: positionId, stage: 'new', count: 2 }]);
    const aggregateDealsByOwnerPosition = jest.fn().mockResolvedValue([
      { ownerPositionId: positionId, stage: 'showing', currency: 'USD', count: 1, commissionAmountMinorUnits: 50000 },
    ]);
    const service = createTestCrmService({
      leadRepository: { aggregateByOwnerPosition: aggregateLeadsByOwnerPosition },
      dealRepository: { aggregateByOwnerPosition: aggregateDealsByOwnerPosition },
    });

    const result = await service.getPositionsReport({ organizationId: new Types.ObjectId() });

    expect(result.positions).toEqual([
      {
        positionId: positionId.toString(),
        leadsTotal: 2,
        leadsByStage: { new: 2 },
        dealsTotal: 1,
        dealsByStage: { showing: 1 },
        dealsCommission: [{ currency: 'USD', amountMinorUnits: 50000 }],
      },
    ]);
  });

  it('лид без ownerPositionId группируется отдельной строкой positionId:null', async () => {
    const aggregateLeadsByOwnerPosition = jest.fn().mockResolvedValue([{ ownerPositionId: null, stage: 'new', count: 5 }]);
    const service = createTestCrmService({
      leadRepository: { aggregateByOwnerPosition: aggregateLeadsByOwnerPosition },
      dealRepository: { aggregateByOwnerPosition: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getPositionsReport({ organizationId: new Types.ObjectId() });

    expect(result.positions).toEqual([
      { positionId: null, leadsTotal: 5, leadsByStage: { new: 5 }, dealsTotal: 0, dealsByStage: {}, dealsCommission: [] },
    ]);
  });

  it('сделки без expectedCommission (currency:null) не попадают в dealsCommission', async () => {
    const positionId = new Types.ObjectId();
    const aggregateDealsByOwnerPosition = jest
      .fn()
      .mockResolvedValue([{ ownerPositionId: positionId, stage: 'showing', currency: null, count: 3, commissionAmountMinorUnits: 0 }]);
    const service = createTestCrmService({
      leadRepository: { aggregateByOwnerPosition: jest.fn().mockResolvedValue([]) },
      dealRepository: { aggregateByOwnerPosition: aggregateDealsByOwnerPosition },
    });

    const result = await service.getPositionsReport({ organizationId: new Types.ObjectId() });

    expect(result.positions[0]!.dealsCommission).toEqual([]);
    expect(result.positions[0]!.dealsByStage).toEqual({ showing: 3 });
  });

  it('несколько сделок одной валюты на одну позицию суммируются в одну запись dealsCommission', async () => {
    const positionId = new Types.ObjectId();
    const aggregateDealsByOwnerPosition = jest.fn().mockResolvedValue([
      { ownerPositionId: positionId, stage: 'showing', currency: 'USD', count: 1, commissionAmountMinorUnits: 10000 },
      { ownerPositionId: positionId, stage: 'deal', currency: 'USD', count: 1, commissionAmountMinorUnits: 20000 },
    ]);
    const service = createTestCrmService({
      leadRepository: { aggregateByOwnerPosition: jest.fn().mockResolvedValue([]) },
      dealRepository: { aggregateByOwnerPosition: aggregateDealsByOwnerPosition },
    });

    const result = await service.getPositionsReport({ organizationId: new Types.ObjectId() });

    expect(result.positions[0]!.dealsCommission).toEqual([{ currency: 'USD', amountMinorUnits: 30000 }]);
    expect(result.positions[0]!.dealsTotal).toBe(2);
  });

  it('пустой период без данных — возвращает пустой массив positions', async () => {
    const service = createTestCrmService({
      leadRepository: { aggregateByOwnerPosition: jest.fn().mockResolvedValue([]) },
      dealRepository: { aggregateByOwnerPosition: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getPositionsReport({ organizationId: new Types.ObjectId() });

    expect(result.positions).toEqual([]);
  });
});

describe('CrmService.getTeamPerformanceReport', () => {
  it('агрегирует лиды, сделки, задачи и временные ряды в сводный отчёт и позиции', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();

    const aggregateLeadsByOwnerPosition = jest.fn().mockResolvedValue([
      { ownerPositionId: positionId, stage: 'new', count: 5 },
      { ownerPositionId: positionId, stage: 'converted', count: 2 },
      { ownerPositionId: positionId, stage: 'lost', count: 1 },
    ]);
    const aggregateDealsByOwnerPosition = jest.fn().mockResolvedValue([
      { ownerPositionId: positionId, stage: 'deal', currency: 'USD', count: 2, commissionAmountMinorUnits: 40000 },
      { ownerPositionId: positionId, stage: 'closed_lost', currency: 'USD', count: 1, commissionAmountMinorUnits: 0 },
    ]);
    const aggregateByAssignedPosition = jest.fn().mockResolvedValue([
      {
        assignedPositionId: positionId,
        status: 'completed',
        count: 8,
        completedOnTimeCount: 7,
        overdueCount: 1,
      },
      {
        assignedPositionId: positionId,
        status: 'open',
        count: 2,
        completedOnTimeCount: 0,
        overdueCount: 1,
      },
    ]);
    const leadTimeseries = jest.fn().mockResolvedValue([{ date: '2026-09-01', count: 3 }]);
    const dealTimeseries = jest.fn().mockResolvedValue([{ date: '2026-09-01', count: 1 }]);
    const taskTimeseries = jest.fn().mockResolvedValue([{ date: '2026-09-01', count: 4 }]);

    const service = createTestCrmService({
      leadRepository: {
        aggregateByOwnerPosition: aggregateLeadsByOwnerPosition,
        aggregateTimeseries: leadTimeseries,
      },
      dealRepository: {
        aggregateByOwnerPosition: aggregateDealsByOwnerPosition,
        aggregateTimeseries: dealTimeseries,
      },
      taskRepository: {
        aggregateByAssignedPosition,
        aggregateTimeseries: taskTimeseries,
      },
    });

    const result = await service.getTeamPerformanceReport({ organizationId });

    expect(result.summary.leadsTotal).toBe(8);
    expect(result.summary.leadsConverted).toBe(2);
    expect(result.summary.conversionRatePercent).toBe(25);
    expect(result.summary.dealsTotal).toBe(3);
    expect(result.summary.dealsWon).toBe(2);
    expect(result.summary.dealsCommission).toEqual([{ currency: 'USD', amountMinorUnits: 40000 }]);
    expect(result.summary.tasksTotal).toBe(10);
    expect(result.summary.tasksCompleted).toBe(8);
    expect(result.summary.slaPercent).toBe(87.5);

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]!.positionId).toBe(positionId.toString());
    expect(result.positions[0]!.leadsAdded).toBe(8);
    expect(result.positions[0]!.leadsConverted).toBe(2);
    expect(result.positions[0]!.leadsLost).toBe(1);
    expect(result.positions[0]!.leadsInWork).toBe(5);
    expect(result.positions[0]!.conversionRatePercent).toBe(25);
    expect(result.positions[0]!.dealsTotal).toBe(3);
    expect(result.positions[0]!.dealsWon).toBe(2);
    expect(result.positions[0]!.slaPercent).toBe(87.5);

    expect(result.timeseries).toEqual([
      { date: '2026-09-01', leads: 3, deals: 1, completedTasks: 4 },
    ]);
  });

  it('стадии продуктовых воронок: стадия успеха и дальше — конверсия, «Отказ» — потеря', async () => {
    const positionId = new Types.ObjectId();
    const service = createTestCrmService({
      leadRepository: {
        aggregateByOwnerPosition: jest.fn().mockResolvedValue([
          { ownerPositionId: positionId, stage: 'kp_sent', count: 4 },
          { ownerPositionId: positionId, stage: 'golden', count: 2 },
          { ownerPositionId: positionId, stage: 'refused', count: 1 },
          { ownerPositionId: positionId, stage: 'network_no_call_1', count: 1 },
          { ownerPositionId: positionId, stage: 'network_work_started', count: 2 },
          { ownerPositionId: positionId, stage: 'owner_agreed', count: 1 },
          { ownerPositionId: positionId, stage: 'owner_get_referral', count: 1 },
        ]),
        aggregateTimeseries: jest.fn().mockResolvedValue([]),
      },
      dealRepository: {
        aggregateByOwnerPosition: jest.fn().mockResolvedValue([]),
        aggregateTimeseries: jest.fn().mockResolvedValue([]),
      },
      taskRepository: {
        aggregateByAssignedPosition: jest.fn().mockResolvedValue([]),
        aggregateTimeseries: jest.fn().mockResolvedValue([]),
      },
    });

    const result = await service.getTeamPerformanceReport({ organizationId: new Types.ObjectId() });

    // golden 2 + network_work_started 2 + owner_get_referral 1 (после «Объект выставлен на продажу»)
    expect(result.positions[0]!.leadsAdded).toBe(12);
    expect(result.positions[0]!.leadsConverted).toBe(5);
    expect(result.positions[0]!.leadsLost).toBe(2);
    expect(result.positions[0]!.leadsInWork).toBe(5);
    expect(result.summary.conversionRatePercent).toBeCloseTo(41.7, 1);
  });

  // ИСПРАВЛЕНО 11.09.2026 (task-model-audit-followup.md, седьмое наблюдение
  // аудита): объединённый календарь — тот же источник задач, что GET /tasks
  // (TaskRepository.listForOrganization), поэтому тот же риск отдать личные
  // задачи чужого исполнителя org-wide гранту. callerPositionId обязан дойти
  // до репозитория, не потеряться по пути.
  describe('getUnifiedCalendar', () => {
    it('передаёт callerPositionId в TaskRepository.listForOrganization (видимость personal-задач)', async () => {
      const organizationId = new Types.ObjectId();
      const callerPositionId = new Types.ObjectId();
      const startDate = new Date('2026-09-01T00:00:00Z');
      const endDate = new Date('2026-09-30T00:00:00Z');
      const listForOrganization = jest.fn().mockResolvedValue([]);
      const listForRange = jest.fn().mockResolvedValue([]);

      const service = createTestCrmService({
        taskRepository: { listForOrganization },
        calendarEventRepository: { listForRange },
      });

      await service.getUnifiedCalendar({ organizationId, startDate, endDate, callerPositionId });

      expect(listForOrganization).toHaveBeenCalledWith(
        organizationId,
        expect.objectContaining({ callerPositionId }),
      );
    });
  });
});

describe('toTaskReadModel', () => {
  it("taskType отсутствует в документе (легаси до 14.09.2026) — читается как 'standard'", () => {
    const task = {
      _id: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      title: 'Задача',
      status: 'open',
      version: 0,
      createdAt: new Date('2026-08-30T10:00:00Z'),
      updatedAt: new Date('2026-08-30T10:00:00Z'),
      attachments: [],
      subtasks: [],
    } as unknown as Parameters<typeof toTaskReadModel>[0];

    const readModel = toTaskReadModel(task);

    expect(readModel.taskType).toBe('standard');
  });

  it("taskType присутствует в документе — читается как есть", () => {
    const task = {
      _id: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      title: 'Позвонить клиенту',
      status: 'open',
      taskType: 'call',
      version: 0,
      createdAt: new Date('2026-08-30T10:00:00Z'),
      updatedAt: new Date('2026-08-30T10:00:00Z'),
      attachments: [],
      subtasks: [],
    } as unknown as Parameters<typeof toTaskReadModel>[0];

    const readModel = toTaskReadModel(task);

    expect(readModel.taskType).toBe('call');
  });
});
