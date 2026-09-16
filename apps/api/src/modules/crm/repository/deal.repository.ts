import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';
import type { DealType } from '../deal-type';
import { DealChecklistItem, DealDocument, DealParticipant, type DealStage } from '../schemas/deal.schema';

export interface ListDealsFilter {
  ownerPositionId?: Types.ObjectId;
  stage?: DealStage;
  leadId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  cursor?: Types.ObjectId;
  limit: number;
}

export interface CreateDealParams {
  organizationId: Types.ObjectId;
  contactId: Types.ObjectId;
  ownerPositionId: Types.ObjectId;
  leadId?: Types.ObjectId;
  title: string;
  description?: string;
  stage?: DealStage;
  expectedCommission?: MoneyAmount;
  dealType?: DealType;
  unitId?: Types.ObjectId;
  developmentId?: Types.ObjectId;
  installmentPlanId?: Types.ObjectId;
  downPayment?: MoneyAmount;
  participants?: DealParticipant[];
  checklistItems?: DealChecklistItem[];
}

export interface UpdateDealParams {
  title?: string;
  description?: string | null;
  expectedCommission?: MoneyAmount | null;
  /** Тип меняется только пока комиссия не отмечена полученной — условие в самом фильтре. */
  dealType?: DealType;
}

/**
 * Repository layer for CRM deals (DEAL-001).
 * Strictly enforces tenant isolation (organizationId) on all queries and mutations.
 */
@Injectable()
export class DealRepository {
  constructor(@InjectModel(DealDocument.name) private readonly model: Model<DealDocument>) {}

  async create(params: CreateDealParams, session?: ClientSession): Promise<DealDocument> {
    const docData: Record<string, unknown> = {
      organizationId: params.organizationId,
      contactId: params.contactId,
      ownerPositionId: params.ownerPositionId,
      title: params.title,
      stage: params.stage ?? 'showing',
      dealType: params.dealType ?? 'secondary',
      participants: params.participants ?? [],
      checklistItems: params.checklistItems ?? [],
      version: 0,
    };

    if (params.leadId !== undefined) docData.leadId = params.leadId;
    if (params.description !== undefined) docData.description = params.description;
    if (params.expectedCommission !== undefined) docData.expectedCommission = params.expectedCommission;
    if (params.unitId !== undefined) docData.unitId = params.unitId;
    if (params.developmentId !== undefined) docData.developmentId = params.developmentId;
    if (params.installmentPlanId !== undefined) docData.installmentPlanId = params.installmentPlanId;
    if (params.downPayment !== undefined) docData.downPayment = params.downPayment;

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    ownerPositionId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealDocument | null> {
    const filter: FilterQuery<DealDocument> = { _id: id, organizationId };
    if (ownerPositionId) {
      filter.ownerPositionId = ownerPositionId;
    }
    const query = this.model.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.exec();
  }

  async listForOrganization(
    organizationId: Types.ObjectId,
    filter: ListDealsFilter,
  ): Promise<DealDocument[]> {
    const queryFilter: FilterQuery<DealDocument> = { organizationId };

    if (filter.cursor) {
      queryFilter._id = { $lt: filter.cursor };
    }

    if (filter.stage) {
      queryFilter.stage = filter.stage;
    }

    if (filter.ownerPositionId) {
      queryFilter.ownerPositionId = filter.ownerPositionId;
    }

    if (filter.leadId) {
      queryFilter.leadId = filter.leadId;
    }

    if (filter.contactId) {
      queryFilter.contactId = filter.contactId;
    }

    return this.model
      .find(queryFilter)
      .sort({ _id: -1 })
      .limit(filter.limit)
      .exec();
  }

  async updateDeal(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    params: UpdateDealParams,
    session?: ClientSession,
  ): Promise<DealDocument | null> {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, number> = {};

    if (params.title !== undefined) $set.title = params.title;

    if (params.description === null) {
      $unset.description = 1;
    } else if (params.description !== undefined) {
      $set.description = params.description;
    }

    if (params.expectedCommission === null) {
      $unset.expectedCommission = 1;
    } else if (params.expectedCommission !== undefined) {
      $set.expectedCommission = params.expectedCommission;
    }

    const filter: Record<string, unknown> = { _id: id, organizationId, version: expectedVersion };
    if (params.dealType !== undefined) {
      $set.dealType = params.dealType;
      filter.commissionReceivedAt = { $exists: false };
    }

    const updateDoc: Record<string, unknown> = {
      $inc: { version: 1 },
    };
    if (Object.keys($set).length > 0) updateDoc.$set = $set;
    if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;

    return this.model.findOneAndUpdate(filter, updateDoc, { new: true, session }).exec();
  }

  /**
   * Сделка по id без организации — только для админского контура BAZA:
   * менеджер BAZA отмечает пришедшую комиссию по сделкам всех организаций
   * (решение владельца 16.09.2026).
   */
  async findByIdForPlatform(id: Types.ObjectId, session?: ClientSession): Promise<DealDocument | null> {
    const query = this.model.findOne({ _id: id });
    if (session) query.session(session);
    return query.exec();
  }

  /** Сделки первички всех организаций: ждут денег или деньги уже пришли. */
  async listPrimaryForPlatform(params: { received: boolean; limit: number }): Promise<DealDocument[]> {
    const filter: FilterQuery<DealDocument> = {
      dealType: 'primary',
      commissionReceivedAt: { $exists: params.received },
    };
    if (!params.received) filter.stage = { $ne: 'closed_lost' };
    return this.model.find(filter).sort(params.received ? { commissionReceivedAt: -1 } : { _id: 1 }).limit(params.limit).exec();
  }

  /** CAS-отметка «Комиссия получена». null — версия устарела или отметка уже стоит. */
  async setCommissionReceivedForPlatform(
    id: Types.ObjectId,
    params: { expectedVersion: number; amount: MoneyAmount; receivedAt: Date; adminAccountId: Types.ObjectId },
    session: ClientSession,
  ): Promise<DealDocument | null> {
    const receivedFilter = { _id: id, version: params.expectedVersion, commissionReceivedAt: { $exists: false } };
    const receivedUpdate = {
      $set: {
        commissionReceived: params.amount,
        commissionReceivedAt: params.receivedAt,
        commissionReceivedByAdminId: params.adminAccountId,
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    };
    return this.model.findOneAndUpdate(receivedFilter, receivedUpdate, { new: true, session }).exec();
  }

  /** CAS-снятие отметки. null — версия устарела или отметки нет. */
  async clearCommissionReceivedForPlatform(
    id: Types.ObjectId,
    expectedVersion: number,
    session: ClientSession,
  ): Promise<DealDocument | null> {
    const clearFilter = { _id: id, version: expectedVersion, commissionReceivedAt: { $exists: true } };
    const clearUpdate = {
      $unset: { commissionReceived: '', commissionReceivedAt: '', commissionReceivedByAdminId: '' },
      $set: { updatedAt: new Date() },
      $inc: { version: 1 },
    };
    return this.model.findOneAndUpdate(clearFilter, clearUpdate, { new: true, session }).exec();
  }

  async changeStageWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    newStage: DealStage,
    allowedFromStages: DealStage[],
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        {
          _id: id,
          organizationId,
          version: expectedVersion,
          stage: { $in: allowedFromStages },
        },
        {
          $set: { stage: newStage, updatedAt: new Date() },
          $inc: { version: 1 },
        },
        { session },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async reassignOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    ownerPositionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, version: expectedVersion },
        {
          $set: { ownerPositionId, updatedAt: new Date() },
          $inc: { version: 1 },
        },
        { session },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async addParticipant(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    participant: DealParticipant,
    session?: ClientSession,
  ): Promise<DealDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          organizationId,
          version: expectedVersion,
          'participants.contactId': { $ne: participant.contactId },
        },
        {
          $push: { participants: participant },
          $inc: { version: 1 },
          $set: { updatedAt: new Date() },
        },
        { new: true, session },
      )
      .exec();
  }

  async removeParticipant(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    contactId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          organizationId,
          version: expectedVersion,
          'participants.contactId': contactId,
        },
        {
          $pull: { participants: { contactId } },
          $inc: { version: 1 },
          $set: { updatedAt: new Date() },
        },
        { new: true, session },
      )
      .exec();
  }

  async updateChecklist(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    checklistItems: DealChecklistItem[],
    session?: ClientSession,
  ): Promise<DealDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        {
          $set: { checklistItems, updatedAt: new Date() },
          $inc: { version: 1 },
        },
        { new: true, session },
      )
      .exec();
  }

  /**
   * GET /crm/reports/positions — количество сделок на позицию за период
   * (`createdAt`), с разбивкой по текущей стадии и суммой ожидаемой
   * комиссии (`expectedCommission`), сгруппированной по валюте (сделки без
   * `expectedCommission` попадают в группу `currency: null`, CrmService
   * отбрасывает её при построении суммы). `ownerPositionId` у Deal
   * обязателен (см. DealDocument.ownerPositionId) — в отличие от
   * LeadRepository.aggregateByOwnerPosition, здесь нет null-группы.
   */
  async aggregateByOwnerPosition(
    organizationId: Types.ObjectId,
    params: { from?: Date; to?: Date },
  ): Promise<
    Array<{
      ownerPositionId: Types.ObjectId;
      stage: DealStage;
      currency: string | null;
      count: number;
      commissionAmountMinorUnits: number;
    }>
  > {
    const match: Record<string, unknown> = { organizationId };
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) createdAt.$gte = params.from;
      if (params.to) createdAt.$lte = params.to;
      match.createdAt = createdAt;
    }

    return this.model
      .aggregate<{
        ownerPositionId: Types.ObjectId;
        stage: DealStage;
        currency: string | null;
        count: number;
        commissionAmountMinorUnits: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: {
              ownerPositionId: '$ownerPositionId',
              stage: '$stage',
              currency: { $ifNull: ['$expectedCommission.currency', null] },
            },
            count: { $sum: 1 },
            commissionAmountMinorUnits: { $sum: { $ifNull: ['$expectedCommission.amountMinorUnits', 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            ownerPositionId: '$_id.ownerPositionId',
            stage: '$_id.stage',
            currency: '$_id.currency',
            count: 1,
            commissionAmountMinorUnits: 1,
          },
        },
      ])
      .exec();
  }

  async aggregateTimeseries(
    organizationId: Types.ObjectId,
    params: { from?: Date; to?: Date; ownerPositionId?: Types.ObjectId },
  ): Promise<Array<{ date: string; count: number }>> {
    const match: Record<string, unknown> = { organizationId, status: { $ne: 'deleted' } };
    if (params.ownerPositionId) {
      match.ownerPositionId = params.ownerPositionId;
    }
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) createdAt.$gte = params.from;
      if (params.to) createdAt.$lte = params.to;
      match.createdAt = createdAt;
    }

    return this.model
      .aggregate<{ date: string; count: number }>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            count: 1,
          },
        },
        { $sort: { date: 1 } },
      ])
      .exec();
  }
}
