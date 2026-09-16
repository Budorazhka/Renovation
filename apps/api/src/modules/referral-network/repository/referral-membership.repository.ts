import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ReferralMembershipDocument,
  type ReferralEndReason,
  type ReferralJoinedVia,
} from '../schemas/referral-membership.schema';

/** Членство в командах кураторов. Не tenant-репозиторий: команда поверх компаний (tenant-scope.test.ts). */
@Injectable()
export class ReferralMembershipRepository {
  constructor(
    @InjectModel(ReferralMembershipDocument.name)
    private readonly model: Model<ReferralMembershipDocument>,
  ) {}

  async create(
    params: {
      memberIdentityId: Types.ObjectId;
      curatorIdentityId: Types.ObjectId;
      joinedVia: ReferralJoinedVia;
      addedByAdminId?: Types.ObjectId;
      note?: string;
    },
    session: ClientSession,
  ): Promise<ReferralMembershipDocument> {
    const [created] = await this.model.create(
      [
        {
          memberIdentityId: params.memberIdentityId,
          curatorIdentityId: params.curatorIdentityId,
          status: 'active',
          joinedAt: new Date(),
          joinedVia: params.joinedVia,
          ...(params.addedByAdminId ? { addedByAdminId: params.addedByAdminId } : {}),
          ...(params.note ? { note: params.note } : {}),
        },
      ],
      { session },
    );
    return created!;
  }

  /** Незакрытое членство человека: `active` или `on_review`. */
  async findOpenByMember(memberIdentityId: Types.ObjectId, session?: ClientSession): Promise<ReferralMembershipDocument | null> {
    return this.model
      .findOne({ memberIdentityId, status: { $in: ['active', 'on_review'] } }, null, { session })
      .exec();
  }

  async listOpenByCurators(curatorIdentityIds: Types.ObjectId[]): Promise<ReferralMembershipDocument[]> {
    if (curatorIdentityIds.length === 0) return [];
    return this.model
      .find({ curatorIdentityId: { $in: curatorIdentityIds }, status: { $in: ['active', 'on_review'] } })
      .sort({ joinedAt: 1 })
      .exec();
  }

  async listOpenByMembers(memberIdentityIds: Types.ObjectId[]): Promise<ReferralMembershipDocument[]> {
    if (memberIdentityIds.length === 0) return [];
    return this.model
      .find({ memberIdentityId: { $in: memberIdentityIds }, status: { $in: ['active', 'on_review'] } })
      .exec();
  }

  /** История человека: все его членства, свежие первыми. */
  async listHistoryByMember(memberIdentityId: Types.ObjectId): Promise<ReferralMembershipDocument[]> {
    return this.model.find({ memberIdentityId }).sort({ joinedAt: -1 }).exec();
  }

  /** Закрыть незакрытое членство человека. null — закрывать нечего. */
  async endOpen(
    memberIdentityId: Types.ObjectId,
    params: { endReason: ReferralEndReason; endedByAdminId?: Types.ObjectId; note?: string },
    session: ClientSession,
  ): Promise<ReferralMembershipDocument | null> {
    const $set: Record<string, unknown> = { status: 'ended', endedAt: new Date(), endReason: params.endReason };
    if (params.endedByAdminId) $set.endedByAdminId = params.endedByAdminId;
    if (params.note) $set.note = params.note;
    return this.model
      .findOneAndUpdate({ memberIdentityId, status: { $in: ['active', 'on_review'] } }, { $set }, { new: true, session })
      .exec();
  }

  /** Закрыть всю команду снятого куратора. */
  async endAllForCurator(
    curatorIdentityId: Types.ObjectId,
    params: { endedByAdminId: Types.ObjectId; note?: string },
    session: ClientSession,
  ): Promise<number> {
    const $set: Record<string, unknown> = {
      status: 'ended',
      endedAt: new Date(),
      endReason: 'curator_retired',
      endedByAdminId: params.endedByAdminId,
    };
    if (params.note) $set.note = params.note;
    const result = await this.model
      .updateMany({ curatorIdentityId, status: { $in: ['active', 'on_review'] } }, { $set }, { session })
      .exec();
    return result.modifiedCount;
  }

  /**
   * Поставить связь под вопрос: участник оказался в агентстве другой
   * компании. Снимает вопрос BAZA — переводом к другому куратору или
   * удалением из команды; сама связь из-под вопроса не возвращается.
   */
  async markOnReview(memberIdentityId: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.model
      .updateOne({ memberIdentityId, status: 'active' }, { $set: { status: 'on_review' } }, { session })
      .exec();
  }
}
