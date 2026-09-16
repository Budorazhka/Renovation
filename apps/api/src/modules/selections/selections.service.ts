import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UnitDocument } from '../developments/schemas/unit.schema';
import { InjectConnection } from '@nestjs/mongoose';
import { ListingRepository, PropertyAssetRepository, type ListingDocument, type PropertyAssetDocument } from '@baza/property-assets';
import { randomBytes } from 'node:crypto';
import { ClientSession, Connection, Types } from 'mongoose';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { IdempotencyService, type IdempotentReplay } from '../../shared/idempotency/idempotency.service';
import { DevelopmentsService } from '../developments/developments.service';
import { CrmService } from '../crm/crm.service';
import { DevSelectionRepository, type DevSelectionItemRef, type UpdateDevSelectionPatch } from './repository/dev-selection.repository';
import type {
  DevSelectionDocument,
  DevSelectionItem,
  DevSelectionReaction,
  DevSelectionStatus,
} from './schemas/dev-selection.schema';

/** Объявление вторички с характеристиками объекта — для денормализации в публичном ответе, симметрично Unit выше. */
export interface SelectionListingDenorm {
  listing: ListingDocument;
  asset: PropertyAssetDocument;
}

/** Параметры идемпотентности создающей/изменяющей команды (тот же паттерн, что DevelopmentsService). */
interface IdempotencyParams {
  identityId: Types.ObjectId;
  operation: string;
  key: string;
  requestBody: Record<string, unknown>;
}

/** Публичная проекция подборки — намеренно НЕ включает organizationId/createdByPositionId/leadId/publicToken/version/clientPhone (ADR-002: клиент без аутентификации не должен видеть внутренние ID организации и приватные контактные данные). */
export interface PublicDevSelection {
  title: string;
  clientName?: string;
  agentNote?: string;
  status: DevSelectionStatus;
  items: Array<{
    targetType: 'unit' | 'listing';
    unitId?: string;
    listingId?: string;
    agentNote?: string;
    reaction?: DevSelectionReaction;
    viewedAt?: string;
    /**
     * Сам объект: номер, площадь, цена. До 04.09.2026 публичный ответ отдавал
     * только `unitId`, а публично разрешить объект по id было нечем — клиент,
     * открывший ссылку от риэлтора, физически не мог увидеть подобранные
     * квартиры. Поле необязательное: если объект удалён или переехал в другую
     * организацию, подборка показывается без него, а не падает целиком.
     */
    unit?: {
      number: string;
      kind: string;
      rooms?: number;
      area: number;
      price?: { amountMinorUnits: number; currency: string };
      status: string;
    };
    /** Объявление вторички (N-27) — тот же принцип и та же честность отказа, что `unit` выше. */
    listing?: {
      propertyType: string;
      city: string;
      address: string;
      area: number;
      rooms?: number;
      floor?: number;
      dealType: string;
      price: { amountMinorUnits: number; currency: string };
      status: string;
    };
  }>;
  createdAt: string;
  sentAt?: string;
  viewCount: number;
  customization?: Record<string, unknown>;
}

export function toPublicDevSelection(
  doc: DevSelectionDocument,
  units?: Map<string, UnitDocument>,
  listings?: Map<string, SelectionListingDenorm>,
): PublicDevSelection {
  return {
    title: doc.title,
    clientName: doc.clientName,
    agentNote: doc.agentNote,
    status: doc.status,
    items: doc.items.map((item) => {
      const unit = item.unitId ? units?.get(item.unitId.toString()) : undefined;
      const denorm = item.listingId ? listings?.get(item.listingId.toString()) : undefined;
      return {
        targetType: item.targetType,
        unitId: item.unitId?.toString(),
        listingId: item.listingId?.toString(),
        agentNote: item.agentNote,
        reaction: item.reaction,
        viewedAt: item.viewedAt?.toISOString(),
        // Явный whitelist, а не разворот документа: тот же принцип, что у
        // публичных карточек каталога. Внутренние поля объекта (organizationId,
        // buildingId, floorId) в публичный ответ попадать не должны.
        unit: unit
          ? {
              number: unit.number,
              kind: unit.kind,
              rooms: unit.rooms,
              area: unit.area,
              // Цена через опциональный доступ: подборка не должна падать
              // целиком из-за одного объекта с неполными данными — клиент
              // увидит остальные, а не пустой экран.
              price: unit.price
                ? { amountMinorUnits: unit.price.amountMinorUnits, currency: unit.price.currency }
                : undefined,
              status: unit.status,
            }
          : undefined,
        listing: denorm
          ? {
              propertyType: denorm.asset.propertyType,
              city: denorm.asset.location.city,
              address: denorm.asset.location.address,
              area: denorm.asset.characteristics.area,
              rooms: denorm.asset.characteristics.rooms,
              floor: denorm.asset.characteristics.floor,
              dealType: denorm.listing.dealType,
              price: { amountMinorUnits: denorm.listing.price.amountMinorUnits, currency: denorm.listing.price.currency },
              status: denorm.listing.status,
            }
          : undefined,
      };
    }),
    createdAt: doc.createdAt.toISOString(),
    sentAt: doc.sentAt?.toISOString(),
    viewCount: doc.viewCount,
    customization: doc.customization,
  };
}

/** Приватный (organization-scoped) ответ — явная проекция, не сырой Mongoose-документ (тот же принцип, что CrmService.toLeadReadModel/toBookingResponse): `_id`/`__v`/внутренние Mongoose-поля не должны утекать в HTTP-ответ как есть. */
export interface SelectionResponse {
  id: string;
  organizationId: string;
  createdByPositionId: string;
  publicToken: string;
  title: string;
  leadId?: string;
  clientName?: string;
  clientPhone?: string;
  agentNote?: string;
  status: DevSelectionStatus;
  items: Array<{
    targetType: 'unit' | 'listing';
    unitId?: string;
    listingId?: string;
    agentNote?: string;
    reaction?: DevSelectionReaction;
    viewedAt?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  lastOpenedAt?: string;
  viewCount: number;
  customization?: Record<string, unknown>;
  version: number;
}

export function toSelectionResponse(doc: DevSelectionDocument): SelectionResponse {
  return {
    id: doc._id.toString(),
    organizationId: doc.organizationId.toString(),
    createdByPositionId: doc.createdByPositionId.toString(),
    publicToken: doc.publicToken,
    title: doc.title,
    leadId: doc.leadId?.toString(),
    clientName: doc.clientName,
    clientPhone: doc.clientPhone,
    agentNote: doc.agentNote,
    status: doc.status,
    items: doc.items.map((item) => ({
      targetType: item.targetType,
      unitId: item.unitId?.toString(),
      listingId: item.listingId?.toString(),
      agentNote: item.agentNote,
      reaction: item.reaction,
      viewedAt: item.viewedAt?.toISOString(),
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    sentAt: doc.sentAt?.toISOString(),
    lastOpenedAt: doc.lastOpenedAt?.toISOString(),
    viewCount: doc.viewCount,
    customization: doc.customization,
    version: doc.version,
  };
}

/**
 * Command/query-слой подборок для клиента (dev selections). Отдельный модуль
 * от `developments`/`crm` (ADR-001) — ссылается на Unit/Lead через сервисы
 * этих модулей, не через их repository напрямую (module-boundaries.test.ts).
 *
 * organizationId — ТОЛЬКО из TenantContext вызывающего контроллера, никогда
 * от клиента (тот же принцип, что DevelopmentsService/BookingsService).
 */
@Injectable()
export class SelectionsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repository: DevSelectionRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly developmentsService: DevelopmentsService,
    private readonly crmService: CrmService,
    private readonly listingRepository: ListingRepository,
    private readonly propertyAssetRepository: PropertyAssetRepository,
  ) {}

  /** 256 бит энтропии — см. docstring DevSelectionDocument.publicToken про решение не хешировать. */
  private generatePublicToken(): string {
    return randomBytes(32).toString('hex');
  }

  checkCreateReplay(
    identityId: Types.ObjectId,
    operation: string,
    key: string,
    requestBody: Record<string, unknown>,
  ): Promise<IdempotentReplay | null> {
    return this.idempotencyService.checkReplay({ identityId, operation, key, requestBody });
  }

  private async requireUnitsExist(unitIds: Types.ObjectId[], organizationId: Types.ObjectId): Promise<void> {
    for (const unitId of unitIds) {
      await this.developmentsService.getUnitForOrganization(unitId, organizationId);
    }
  }

  /** Симметрично requireUnitsExist — свой листинг вторички (ADR-001: только через ListingRepository, тот же импорт, что CrmService). */
  private async requireListingsExist(listingIds: Types.ObjectId[], organizationId: Types.ObjectId): Promise<void> {
    for (const listingId of listingIds) {
      const listing = await this.listingRepository.findByIdForOrganization(listingId, organizationId);
      if (!listing) {
        throw new NotFoundException('Listing not found');
      }
    }
  }

  private toItemRefs(unitIds: Types.ObjectId[], listingIds: Types.ObjectId[]): DevSelectionItemRef[] {
    return [
      ...unitIds.map((id): DevSelectionItemRef => ({ targetType: 'unit', id })),
      ...listingIds.map((id): DevSelectionItemRef => ({ targetType: 'listing', id })),
    ];
  }

  async createSelection(params: {
    organizationId: Types.ObjectId;
    createdByPositionId: Types.ObjectId;
    title: string;
    unitIds: Types.ObjectId[];
    listingIds: Types.ObjectId[];
    leadId?: Types.ObjectId;
    clientName?: string;
    clientPhone?: string;
    agentNote?: string;
    customization?: Record<string, unknown>;
    idempotency: IdempotencyParams;
  }): Promise<DevSelectionDocument> {
    if (params.unitIds.length === 0 && params.listingIds.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'At least one of unitIds/listingIds is required');
    }
    await this.requireUnitsExist(params.unitIds, params.organizationId);
    await this.requireListingsExist(params.listingIds, params.organizationId);
    if (params.leadId) {
      await this.crmService.getLeadForOrganization(params.leadId, params.organizationId);
    }

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const created = await this.repository.create(
        {
          organizationId: params.organizationId,
          createdByPositionId: params.createdByPositionId,
          publicToken: this.generatePublicToken(),
          title: params.title,
          leadId: params.leadId,
          clientName: params.clientName,
          clientPhone: params.clientPhone,
          agentNote: params.agentNote,
          items: this.toItemRefs(params.unitIds, params.listingIds),
          customization: params.customization,
        },
        session,
      );

      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 201,
          responseBody: toSelectionResponse(created) as unknown as Record<string, unknown>,
        },
        session,
      );

      return created;
    });
  }

  async listSelections(
    organizationId: Types.ObjectId,
    filter: { status?: DevSelectionStatus; requiredPositionId?: Types.ObjectId },
  ): Promise<DevSelectionDocument[]> {
    return this.repository.listForOrganization(organizationId, {
      status: filter.status,
      createdByPositionId: filter.requiredPositionId,
    });
  }

  /**
   * requiredPositionId — own-scope сужение (manager видит только созданные
   * им подборки), undefined — organization-wide. Единый 404 для "не
   * существует"/"чужая организация"/"чужая позиция при own-scope" —
   * non-disclosure, тот же принцип, что LeadController/BookingsController.
   */
  async getSelection(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    requiredPositionId?: Types.ObjectId,
  ): Promise<DevSelectionDocument> {
    const selection = await this.repository.findByIdForOrganization(id, organizationId);
    if (!selection || (requiredPositionId && !selection.createdByPositionId.equals(requiredPositionId))) {
      throw new NotFoundException('Selection not found');
    }
    return selection;
  }

  async updateSelection(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    requiredPositionId?: Types.ObjectId;
    expectedVersion: number;
    patch: UpdateDevSelectionPatch;
    idempotency: IdempotencyParams;
  }): Promise<DevSelectionDocument> {
    await this.getSelection(params.id, params.organizationId, params.requiredPositionId);
    if (params.patch.leadId) {
      await this.crmService.getLeadForOrganization(params.patch.leadId, params.organizationId);
    }

    return runInTransaction(this.connection, async (session) => {
      const updated = await this.repository.updateWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        params.patch,
        session,
      );
      if (!updated) {
        throw new ConflictException('Selection was modified by another request (version conflict)');
      }
      await this.recordIdempotency(params.idempotency, 200, updated, session);
      return updated;
    });
  }

  async setStatus(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    requiredPositionId?: Types.ObjectId;
    expectedVersion: number;
    status: DevSelectionStatus;
    idempotency: IdempotencyParams;
  }): Promise<DevSelectionDocument> {
    await this.getSelection(params.id, params.organizationId, params.requiredPositionId);

    return runInTransaction(this.connection, async (session) => {
      const updated = await this.repository.setStatusWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        params.status,
        session,
      );
      if (!updated) {
        throw new ConflictException('Selection was modified by another request (version conflict)');
      }
      await this.recordIdempotency(params.idempotency, 200, updated, session);
      return updated;
    });
  }

  async deleteSelection(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    requiredPositionId?: Types.ObjectId;
    expectedVersion: number;
    idempotency: IdempotencyParams;
  }): Promise<void> {
    await this.getSelection(params.id, params.organizationId, params.requiredPositionId);

    await runInTransaction(this.connection, async (session) => {
      const deleted = await this.repository.deleteWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        session,
      );
      if (!deleted) {
        throw new ConflictException('Selection was modified by another request (version conflict)');
      }
      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: params.idempotency.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 204,
          responseBody: {},
        },
        session,
      );
    });
  }

  async addItems(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    requiredPositionId?: Types.ObjectId;
    expectedVersion: number;
    unitIds: Types.ObjectId[];
    listingIds: Types.ObjectId[];
    idempotency: IdempotencyParams;
  }): Promise<DevSelectionDocument> {
    if (params.unitIds.length === 0 && params.listingIds.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'At least one of unitIds/listingIds is required');
    }
    await this.getSelection(params.id, params.organizationId, params.requiredPositionId);
    await this.requireUnitsExist(params.unitIds, params.organizationId);
    await this.requireListingsExist(params.listingIds, params.organizationId);

    return runInTransaction(this.connection, async (session) => {
      const updated = await this.repository.addItemsWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        this.toItemRefs(params.unitIds, params.listingIds),
        session,
      );
      if (!updated) {
        throw new ConflictException('Selection was modified by another request (version conflict)');
      }
      await this.recordIdempotency(params.idempotency, 200, updated, session);
      return updated;
    });
  }

  async removeItem(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    requiredPositionId?: Types.ObjectId;
    expectedVersion: number;
    itemId: Types.ObjectId;
    idempotency: IdempotencyParams;
  }): Promise<DevSelectionDocument> {
    await this.getSelection(params.id, params.organizationId, params.requiredPositionId);

    return runInTransaction(this.connection, async (session) => {
      const updated = await this.repository.removeItemWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        params.itemId,
        session,
      );
      if (!updated) {
        throw new ConflictException('Selection was modified by another request (version conflict)');
      }
      await this.recordIdempotency(params.idempotency, 200, updated, session);
      return updated;
    });
  }

  async updateItem(params: {
    id: Types.ObjectId;
    organizationId: Types.ObjectId;
    requiredPositionId?: Types.ObjectId;
    expectedVersion: number;
    itemId: Types.ObjectId;
    patch: { agentNote?: string; reaction?: DevSelectionItem['reaction'] | null };
    idempotency: IdempotencyParams;
  }): Promise<DevSelectionDocument> {
    await this.getSelection(params.id, params.organizationId, params.requiredPositionId);

    return runInTransaction(this.connection, async (session) => {
      const updated = await this.repository.updateItemWithVersionCheck(
        params.id,
        params.organizationId,
        params.expectedVersion,
        params.itemId,
        params.patch,
        session,
      );
      if (!updated) {
        throw new ConflictException('Selection was modified by another request (version conflict), or item is not in this selection');
      }
      await this.recordIdempotency(params.idempotency, 200, updated, session);
      return updated;
    });
  }

  private async recordIdempotency(
    idempotency: IdempotencyParams,
    responseStatus: number,
    doc: DevSelectionDocument,
    session: ClientSession,
  ): Promise<void> {
    await this.idempotencyService.record(
      {
        identityId: idempotency.identityId,
        operation: idempotency.operation,
        key: idempotency.key,
        requestBody: idempotency.requestBody,
        responseStatus,
        responseBody: toSelectionResponse(doc) as unknown as Record<string, unknown>,
      },
      session,
    );
  }

  /**
   * ПУБЛИЧНЫЙ путь (без organizationId — единственный ключ доступа это сам
   * publicToken). markViewedByPublicToken атомарно инкрементирует viewCount/
   * lastOpenedAt/sent->viewed (реплицирует useDevSelectionsStore.markViewed),
   * этот метод — единственная точка, где GET одновременно читает и пишет:
   * сознательный выбор (см. SelectionsService docstring раздела публичного
   * контроллера) — открытие подборки клиентом И ЕСТЬ факт просмотра, отдельная
   * команда markViewed на фронте была нужна только из-за localStorage-модели,
   * не из-за разницы в бизнес-смысле.
   */
  async getPublicSelectionAndMarkViewed(publicToken: string): Promise<PublicDevSelection> {
    const updated = await this.repository.markViewedByPublicToken(publicToken);
    if (!updated) {
      throw new NotFoundException('Selection not found');
    }

    // Объекты подборки резолвятся организацией самой подборки, а не
    // tenant-контекстом запроса: у публичного клиента его нет и быть не должно.
    // Авторизует показ сам токен — 256 бит случайности, — и он открывает ровно
    // те объекты, которые агент положил в эту подборку, ничего сверх.
    const units = new Map<string, UnitDocument>();
    const listings = new Map<string, SelectionListingDenorm>();
    await Promise.all(
      updated.items.map(async (item) => {
        try {
          if (item.targetType === 'unit' && item.unitId) {
            const unit = await this.developmentsService.getUnitForOrganization(item.unitId, updated.organizationId);
            units.set(item.unitId.toString(), unit);
          } else if (item.targetType === 'listing' && item.listingId) {
            const listing = await this.listingRepository.findByIdForOrganization(item.listingId, updated.organizationId);
            if (!listing) return;
            const asset = await this.propertyAssetRepository.findByIdForOrganization(listing.propertyAssetId, updated.organizationId);
            if (!asset) return;
            listings.set(item.listingId.toString(), { listing, asset });
          }
        } catch {
          // Объект удалён или больше не принадлежит организации: подборка
          // показывается без него. Ронять всю страницу из-за одной пропавшей
          // квартиры/объявления — худший вариант для клиента, который просто
          // открыл ссылку.
        }
      }),
    );

    return toPublicDevSelection(updated, units, listings);
  }
}
