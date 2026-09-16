import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ReferralCuratorDocument } from '../schemas/referral-curator.schema';

/** Кураторы реферальной сети. Не tenant-репозиторий: сеть принадлежит платформе (tenant-scope.test.ts). */
@Injectable()
export class ReferralCuratorRepository {
  constructor(
    @InjectModel(ReferralCuratorDocument.name)
    private readonly model: Model<ReferralCuratorDocument>,
  ) {}

  async create(
    params: { identityId: Types.ObjectId; inviteCode: string; appointedByAdminId: Types.ObjectId; appointReason?: string },
    session: ClientSession,
  ): Promise<ReferralCuratorDocument> {
    const [created] = await this.model.create(
      [
        {
          identityId: params.identityId,
          inviteCode: params.inviteCode,
          status: 'active',
          appointedAt: new Date(),
          appointedByAdminId: params.appointedByAdminId,
          ...(params.appointReason ? { appointReason: params.appointReason } : {}),
        },
      ],
      { session },
    );
    return created!;
  }

  async findActiveByIdentity(identityId: Types.ObjectId, session?: ClientSession): Promise<ReferralCuratorDocument | null> {
    return this.model.findOne({ identityId, status: 'active' }, null, { session }).exec();
  }

  async findActiveByInviteCode(inviteCode: string): Promise<ReferralCuratorDocument | null> {
    return this.model.findOne({ inviteCode, status: 'active' }).exec();
  }

  async inviteCodeExists(inviteCode: string): Promise<boolean> {
    return (await this.model.exists({ inviteCode })) !== null;
  }

  async listActive(): Promise<ReferralCuratorDocument[]> {
    return this.model.find({ status: 'active' }).sort({ appointedAt: 1 }).exec();
  }

  async listActiveByIdentities(identityIds: Types.ObjectId[]): Promise<ReferralCuratorDocument[]> {
    if (identityIds.length === 0) return [];
    return this.model.find({ identityId: { $in: identityIds }, status: 'active' }).exec();
  }

  /** null — куратор уже снят или не существует. */
  async retire(
    identityId: Types.ObjectId,
    params: { retiredByAdminId: Types.ObjectId; retireReason: string },
    session: ClientSession,
  ): Promise<ReferralCuratorDocument | null> {
    return this.model
      .findOneAndUpdate(
        { identityId, status: 'active' },
        {
          $set: {
            status: 'retired',
            retiredAt: new Date(),
            retiredByAdminId: params.retiredByAdminId,
            retireReason: params.retireReason,
          },
        },
        { new: true, session },
      )
      .exec();
  }
}
