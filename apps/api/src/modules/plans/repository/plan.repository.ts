import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PlanDocument } from '../schemas/plan.schema';

export interface PlanTargets {
  revenueTargetMinorUnits: number;
  currency: string;
  leadsTarget: number;
  dealsTarget: number;
  callsTarget: number;
  meetingsTarget: number;
  showingsTarget: number;
}

/** Именованный тип результата — инлайн-`{...}` в Promise<{...}> ломает разбор сигнатуры в tenant-scope.test.ts. */
export interface PlanMutationResult {
  modifiedCount: number;
}

/** Планы сотрудников. Каждый запрос фильтруется по organizationId прямо в теле метода (tenant-scope.test.ts). */
@Injectable()
export class PlanRepository {
  constructor(@InjectModel(PlanDocument.name) private readonly model: Model<PlanDocument>) {}

  async listForPeriod(organizationId: Types.ObjectId, period: string): Promise<PlanDocument[]> {
    return this.model.find({ organizationId, period }).exec();
  }

  async findForPosition(
    organizationId: Types.ObjectId,
    positionId: Types.ObjectId,
    period: string,
    session?: ClientSession,
  ): Promise<PlanDocument | null> {
    return this.model.findOne({ organizationId, positionId, period }, null, { session }).exec();
  }

  async create(
    params: { organizationId: Types.ObjectId; positionId: Types.ObjectId; period: string; setByPositionId: Types.ObjectId } & PlanTargets,
    session?: ClientSession,
  ): Promise<PlanDocument> {
    const [created] = await this.model.create([{ ...params, version: 0 }], { session });
    return created!;
  }

  /** CAS по version (conventions.md разд.5): modifiedCount 0 — план изменили параллельно. */
  async updateWithVersionCheck(
    organizationId: Types.ObjectId,
    positionId: Types.ObjectId,
    period: string,
    expectedVersion: number,
    patch: PlanTargets & { setByPositionId: Types.ObjectId },
    session?: ClientSession,
  ): Promise<PlanMutationResult> {
    const result = await this.model
      .updateOne(
        { organizationId, positionId, period, version: expectedVersion },
        { $set: patch, $inc: { version: 1 } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }
}
