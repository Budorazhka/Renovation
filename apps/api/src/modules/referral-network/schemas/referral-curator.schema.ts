import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralCuratorStatus = 'active' | 'retired';

/**
 * Куратор реферальной сети BAZA. Привязан к человеку (Identity), а не к
 * должности: из агентства можно уйти, а команда и история начислений
 * остаются за человеком (решение владельца 16.09.2026).
 *
 * Куратором назначает BAZA — это и есть проверка «проверенный BAZA»: без
 * решения администратора запись не появляется. Снятый куратор не удаляется,
 * а получает `retired`: на него ссылаются прошлые начисления.
 */
@Schema({ collection: 'referral_curators', timestamps: true })
export class ReferralCuratorDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  identityId!: Types.ObjectId;

  /** Код ссылки-приглашения. Уникален среди всех кураторов, в том числе снятых: старые ссылки не должны вести к новому человеку. */
  @Prop({ required: true, unique: true })
  inviteCode!: string;

  @Prop({ required: true, enum: ['active', 'retired'], default: 'active' })
  status!: ReferralCuratorStatus;

  @Prop({ required: true })
  appointedAt!: Date;

  @Prop({ required: true, type: Types.ObjectId })
  appointedByAdminId!: Types.ObjectId;

  @Prop({ required: false, maxlength: 1000 })
  appointReason?: string;

  @Prop({ required: false })
  retiredAt?: Date;

  @Prop({ required: false, type: Types.ObjectId })
  retiredByAdminId?: Types.ObjectId;

  @Prop({ required: false, maxlength: 1000 })
  retireReason?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ReferralCuratorSchema = SchemaFactory.createForClass(ReferralCuratorDocument);

/** Один действующий куратор на человека; снятых может быть сколько угодно в истории. */
ReferralCuratorSchema.index(
  { identityId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_curator_per_identity' },
);
