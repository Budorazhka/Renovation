import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CommissionRuleDocument } from '../schemas/commission-rule.schema';

export interface CreateCommissionRuleParams {
  organizationId: Types.ObjectId;
  developmentId: Types.ObjectId;
  partnerType: string;
  commissionPercent: number;
}

export interface UpdateCommissionRulePatch {
  partnerType?: string;
  commissionPercent?: number;
}

/**
 * Единственная точка доступа к коллекции commission_rules.
 */
@Injectable()
export class CommissionRuleRepository {
  constructor(
    @InjectModel(CommissionRuleDocument.name)
    private readonly model: Model<CommissionRuleDocument>,
  ) {}

  async create(params: CreateCommissionRuleParams, session?: ClientSession): Promise<CommissionRuleDocument> {
    const [doc] = await this.model.create(
      [
        {
          ...params,
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
  ): Promise<CommissionRuleDocument | null> {
    return this.model.findOne({ _id: id, organizationId }).exec();
  }

  async listForDevelopment(
    developmentId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<CommissionRuleDocument[]> {
    return this.model.find({ developmentId, organizationId }).sort({ createdAt: 1 }).exec();
  }

  /**
   * Optimistic concurrency check (version === expectedVersion).
   * Increments version on success. Returns updated document, or null if conflict/not found.
   */
  async updateWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    patch: UpdateCommissionRulePatch,
    session?: ClientSession,
  ): Promise<CommissionRuleDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        { $set: patch, $inc: { version: 1 } },
        { new: true, session },
      )
      .exec();
  }

  /**
   * Optimistic concurrency check on deletion.
   */
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
}
