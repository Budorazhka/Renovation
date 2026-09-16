import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Правила комиссии партнёров (Commission Rules) по ЖК: конкретный тип
 * партнёра (свободный текст) + процент комиссии. У одного ЖК может быть
 * несколько правил (разные партнёры/проценты).
 */
@Schema({ collection: 'commission_rules', timestamps: true })
export class CommissionRuleDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  developmentId!: Types.ObjectId;

  @Prop({ required: true })
  partnerType!: string;

  @Prop({ required: true })
  commissionPercent!: number;

  /** conventions.md разд.5 — optimistic concurrency (409 VERSION_CONFLICT). */
  @Prop({ required: true, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const CommissionRuleSchema = SchemaFactory.createForClass(CommissionRuleDocument);

CommissionRuleSchema.index({ organizationId: 1, developmentId: 1 });
