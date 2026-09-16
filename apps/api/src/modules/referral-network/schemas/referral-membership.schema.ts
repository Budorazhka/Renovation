import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * `active` — участник в команде, по его сделкам пишутся начисления;
 * `on_review` — связь поставлена под вопрос (участник перешёл в агентство
 * другой компании), начисления не пишутся, пока BAZA не решит;
 * `ended` — членство закрыто. Закрытое не перезаписывается: история смены
 * куратора — это закрытые записи, а не правка одной.
 */
export type ReferralMembershipStatus = 'active' | 'on_review' | 'ended';

export type ReferralJoinedVia = 'invite_link' | 'admin';

export type ReferralEndReason = 'left' | 'transferred' | 'removed' | 'curator_retired' | 'became_curator';

@Schema({ collection: 'referral_memberships', timestamps: true })
export class ReferralMembershipDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  memberIdentityId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  curatorIdentityId!: Types.ObjectId;

  @Prop({ required: true, enum: ['active', 'on_review', 'ended'], default: 'active' })
  status!: ReferralMembershipStatus;

  @Prop({ required: true })
  joinedAt!: Date;

  @Prop({ required: true, enum: ['invite_link', 'admin'] })
  joinedVia!: ReferralJoinedVia;

  /** Кто добавил вручную; у вступившего по ссылке не задан. */
  @Prop({ required: false, type: Types.ObjectId })
  addedByAdminId?: Types.ObjectId;

  @Prop({ required: false })
  endedAt?: Date;

  @Prop({ required: false, enum: ['left', 'transferred', 'removed', 'curator_retired', 'became_curator'] })
  endReason?: ReferralEndReason;

  @Prop({ required: false, type: Types.ObjectId })
  endedByAdminId?: Types.ObjectId;

  /** Причина, записанная администратором при ручной правке связи. */
  @Prop({ required: false, maxlength: 1000 })
  note?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ReferralMembershipSchema = SchemaFactory.createForClass(ReferralMembershipDocument);

/** Человек состоит не больше чем в одной команде: одна незакрытая запись. */
ReferralMembershipSchema.index(
  { memberIdentityId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['active', 'on_review'] } },
    name: 'one_open_membership_per_member',
  },
);

/** Команда куратора: открытые записи по куратору. */
ReferralMembershipSchema.index({ curatorIdentityId: 1, status: 1 });
