import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ReferralRequestDocument,
  type ReferralRequestStatus,
  type ReferralRequestType,
} from '../schemas/referral-request.schema';

/** Заявки на решение BAZA. Не tenant-репозиторий: заявитель — человек (tenant-scope.test.ts). */
@Injectable()
export class ReferralRequestRepository {
  constructor(
    @InjectModel(ReferralRequestDocument.name)
    private readonly model: Model<ReferralRequestDocument>,
  ) {}

  async create(
    params: {
      type: ReferralRequestType;
      applicantIdentityId: Types.ObjectId;
      targetCuratorIdentityId?: Types.ObjectId;
      reason: string;
    },
    session?: ClientSession,
  ): Promise<ReferralRequestDocument> {
    const [created] = await this.model.create(
      [
        {
          type: params.type,
          applicantIdentityId: params.applicantIdentityId,
          reason: params.reason,
          status: 'pending',
          ...(params.targetCuratorIdentityId ? { targetCuratorIdentityId: params.targetCuratorIdentityId } : {}),
        },
      ],
      { session },
    );
    return created!;
  }

  async findPendingByApplicant(applicantIdentityId: Types.ObjectId, type: ReferralRequestType): Promise<ReferralRequestDocument | null> {
    return this.model.findOne({ applicantIdentityId, type, status: 'pending' }).exec();
  }

  async listByApplicant(applicantIdentityId: Types.ObjectId): Promise<ReferralRequestDocument[]> {
    return this.model.find({ applicantIdentityId }).sort({ createdAt: -1 }).limit(20).exec();
  }

  async list(status: ReferralRequestStatus | undefined, limit: number): Promise<ReferralRequestDocument[]> {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    return this.model.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  }

  async findById(id: Types.ObjectId): Promise<ReferralRequestDocument | null> {
    return this.model.findById(id).exec();
  }

  /** Решить заявку. null — она уже решена кем-то другим. */
  async decide(
    id: Types.ObjectId,
    params: { status: 'approved' | 'rejected'; decidedByAdminId: Types.ObjectId; decisionComment?: string },
    session: ClientSession,
  ): Promise<ReferralRequestDocument | null> {
    const $set: Record<string, unknown> = {
      status: params.status,
      decidedAt: new Date(),
      decidedByAdminId: params.decidedByAdminId,
    };
    if (params.decisionComment) $set.decisionComment = params.decisionComment;
    return this.model.findOneAndUpdate({ _id: id, status: 'pending' }, { $set }, { new: true, session }).exec();
  }
}
