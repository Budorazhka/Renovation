import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  DevSelectionDocument,
  DevSelectionItem,
  DevSelectionReaction,
  DevSelectionStatus,
  DevSelectionTargetType,
} from '../schemas/dev-selection.schema';

/** Один лот подборки, независимо от того, юнит это или объявление вторички (N-27). */
export interface DevSelectionItemRef {
  targetType: DevSelectionTargetType;
  id: Types.ObjectId;
}

/** Ключ дедупликации: та же сущность может встретиться только раз, но unitId и listingId из разных коллекций между собой никогда не путаются. */
function itemKey(targetType: DevSelectionTargetType, id: Types.ObjectId): string {
  return `${targetType}:${id.toString()}`;
}

function toDevSelectionItem(ref: DevSelectionItemRef): DevSelectionItem {
  return ref.targetType === 'unit' ? { targetType: 'unit', unitId: ref.id } : { targetType: 'listing', listingId: ref.id };
}

export interface CreateDevSelectionParams {
  organizationId: Types.ObjectId;
  createdByPositionId: Types.ObjectId;
  publicToken: string;
  title: string;
  leadId?: Types.ObjectId;
  clientName?: string;
  clientPhone?: string;
  agentNote?: string;
  items: DevSelectionItemRef[];
  customization?: Record<string, unknown>;
}

export interface UpdateDevSelectionPatch {
  title?: string;
  leadId?: Types.ObjectId;
  clientName?: string;
  clientPhone?: string;
  agentNote?: string;
  customization?: Record<string, unknown>;
}

export interface ListDevSelectionsFilter {
  status?: DevSelectionStatus;
  /** undefined — organization-wide (owner/director/rop/developer); задан — own-scope (manager). */
  createdByPositionId?: Types.ObjectId;
}

/**
 * Единственная точка доступа к коллекции dev_selections (ADR-002).
 */
@Injectable()
export class DevSelectionRepository {
  constructor(
    @InjectModel(DevSelectionDocument.name)
    private readonly model: Model<DevSelectionDocument>,
  ) {}

  async create(params: CreateDevSelectionParams, session?: ClientSession): Promise<DevSelectionDocument> {
    const [doc] = await this.model.create(
      [
        {
          organizationId: params.organizationId,
          createdByPositionId: params.createdByPositionId,
          publicToken: params.publicToken,
          title: params.title,
          leadId: params.leadId,
          clientName: params.clientName,
          clientPhone: params.clientPhone,
          agentNote: params.agentNote,
          status: 'draft',
          items: params.items.map(toDevSelectionItem),
          customization: params.customization,
          viewCount: 0,
          version: 0,
        },
      ],
      { session },
    );
    return doc!;
  }

  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<DevSelectionDocument | null> {
    return this.model.findOne({ _id: id, organizationId }).exec();
  }

  async findByPublicToken(publicToken: string): Promise<DevSelectionDocument | null> {
    return this.model.findOne({ publicToken }).exec();
  }

  async listForOrganization(
    organizationId: Types.ObjectId,
    filter: ListDevSelectionsFilter = {},
  ): Promise<DevSelectionDocument[]> {
    const query: Record<string, unknown> = { organizationId };
    if (filter.status) query.status = filter.status;
    if (filter.createdByPositionId) query.createdByPositionId = filter.createdByPositionId;
    return this.model.find(query).sort({ createdAt: -1 }).exec();
  }

  /**
   * Optimistic concurrency check (version === expectedVersion). Возвращает
   * обновлённый документ либо null при конфликте/отсутствии.
   */
  async updateWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    patch: UpdateDevSelectionPatch,
    session?: ClientSession,
  ): Promise<DevSelectionDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        { $set: patch, $inc: { version: 1 } },
        { new: true, session },
      )
      .exec();
  }

  async setStatusWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    status: DevSelectionStatus,
    session?: ClientSession,
  ): Promise<DevSelectionDocument | null> {
    const set: Record<string, unknown> = { status };
    if (status === 'sent') set.sentAt = new Date();
    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        { $set: set, $inc: { version: 1 } },
        { new: true, session },
      )
      .exec();
  }

  async deleteWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const res = await this.model
      .deleteOne({ _id: id, organizationId, version: expectedVersion }, { session })
      .exec();
    return (res.deletedCount ?? 0) > 0;
  }

  /** Добавляет только те лоты, которых ещё нет в items (дедупликация — тот же принцип, что useDevSelectionsStore.addUnits). */
  async addItemsWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    refs: DevSelectionItemRef[],
    session?: ClientSession,
  ): Promise<DevSelectionDocument | null> {
    const existing = await this.model.findOne({ _id: id, organizationId }).session(session ?? null).exec();
    if (!existing) return null;

    const existingKeys = new Set(
      existing.items.map((item) => itemKey(item.targetType, (item.unitId ?? item.listingId)!)),
    );
    const newItems: DevSelectionItem[] = refs
      .filter((ref) => !existingKeys.has(itemKey(ref.targetType, ref.id)))
      .map(toDevSelectionItem);

    if (newItems.length === 0) {
      // Ничего нового добавлять не нужно — не тратим version на no-op.
      return existing.version === expectedVersion ? existing : null;
    }

    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        { $push: { items: { $each: newItems } }, $inc: { version: 1 } },
        { new: true, session },
      )
      .exec();
  }

  /**
   * itemId — id либо юнита, либо объявления (N-27): у каждого элемента
   * items заполнено ровно одно из unitId/listingId (targetType решает,
   * какое), поэтому `$or` по обоим полям бьёт ровно в тот один элемент,
   * которому этот id принадлежит — коллизии между коллекциями исключены
   * структурой документа, не удачей ObjectId.
   */
  async removeItemWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    itemId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DevSelectionDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        { $pull: { items: { $or: [{ unitId: itemId }, { listingId: itemId }] } }, $inc: { version: 1 } },
        { new: true, session },
      )
      .exec();
  }

  async updateItemWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    itemId: Types.ObjectId,
    patch: { agentNote?: string; reaction?: DevSelectionReaction | null },
    session?: ClientSession,
  ): Promise<DevSelectionDocument | null> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, unknown> = {};
    if (patch.agentNote !== undefined) set['items.$[elem].agentNote'] = patch.agentNote;
    if (patch.reaction !== undefined) {
      if (patch.reaction === null) unset['items.$[elem].reaction'] = '';
      else set['items.$[elem].reaction'] = patch.reaction;
    }

    const update: Record<string, unknown> = { $inc: { version: 1 } };
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;

    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion, $or: [{ 'items.unitId': itemId }, { 'items.listingId': itemId }] },
        update,
        { new: true, session, arrayFilters: [{ $or: [{ 'elem.unitId': itemId }, { 'elem.listingId': itemId }] }] },
      )
      .exec();
  }

  /**
   * Публичная сторона: атомарный инкремент viewCount + lastOpenedAt +
   * условный переход status sent->viewed (единственный публичный
   * side-effect, реплицирует useDevSelectionsStore.markViewed). Пайплайн-
   * форма update (массив стадий) нужна именно для conditional $set по
   * текущему значению status в одной атомарной операции, без гонки
   * "прочитать-затем-записать".
   */
  async markViewedByPublicToken(publicToken: string): Promise<DevSelectionDocument | null> {
    return this.model
      .findOneAndUpdate(
        { publicToken, status: { $ne: 'archived' } },
        [
          {
            $set: {
              viewCount: { $add: ['$viewCount', 1] },
              lastOpenedAt: '$$NOW',
              status: { $cond: [{ $eq: ['$status', 'sent'] }, 'viewed', '$status'] },
            },
          },
        ],
        { new: true },
      )
      .exec();
  }
}
