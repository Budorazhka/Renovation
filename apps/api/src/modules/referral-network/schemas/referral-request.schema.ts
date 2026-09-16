import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Заявки, которые BAZA решает в индивидуальном порядке (решение владельца
 * 16.09.2026): стать куратором, уйти из команды, сменить куратора. До
 * решения ничего не меняется — заявка лишь просьба.
 */
export type ReferralRequestType = 'become_curator' | 'leave_team' | 'change_curator';

export type ReferralRequestStatus = 'pending' | 'approved' | 'rejected';

@Schema({ collection: 'referral_requests', timestamps: true })
export class ReferralRequestDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, enum: ['become_curator', 'leave_team', 'change_curator'] })
  type!: ReferralRequestType;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  applicantIdentityId!: Types.ObjectId;

  /** Куратор, к которому просится участник; только у `change_curator`. */
  @Prop({ required: false, type: Types.ObjectId })
  targetCuratorIdentityId?: Types.ObjectId;

  @Prop({ required: true, maxlength: 1000 })
  reason!: string;

  @Prop({ required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status!: ReferralRequestStatus;

  @Prop({ required: false })
  decidedAt?: Date;

  @Prop({ required: false, type: Types.ObjectId })
  decidedByAdminId?: Types.ObjectId;

  @Prop({ required: false, maxlength: 1000 })
  decisionComment?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ReferralRequestSchema = SchemaFactory.createForClass(ReferralRequestDocument);

/** Очередь BAZA: свежие нерешённые сверху. */
ReferralRequestSchema.index({ status: 1, createdAt: -1 });

/** Одна нерешённая заявка каждого типа от человека: повторная кнопка не плодит очередь. */
ReferralRequestSchema.index(
  { applicantIdentityId: 1, type: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_request_per_type' },
);
