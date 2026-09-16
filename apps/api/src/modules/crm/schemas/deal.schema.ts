import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';
import { DEAL_STAGES } from '../deal-stage';

export type DealStage =
  | 'showing'
  | 'deposit'
  | 'deal'
  | 'golden'
  | 'check_in'
  | 'referral'
  | 'closed_lost';

export interface DealParticipant {
  role: string;
  contactId: Types.ObjectId;
}

const DealParticipantSchema = new MongooseSchema(
  {
    role: { type: String, required: true, maxlength: 50 },
    contactId: { type: MongooseSchema.Types.ObjectId, required: true },
  },
  { _id: false },
);

export interface DealChecklistItem {
  id: string;
  label: string;
  done: boolean;
  completedAt?: Date;
  completedByPositionId?: Types.ObjectId;
}

const DealChecklistItemSchema = new MongooseSchema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 500 },
    done: { type: Boolean, required: true, default: false },
    completedAt: { type: Date, required: false },
    completedByPositionId: { type: MongooseSchema.Types.ObjectId, required: false },
  },
  { _id: false },
);

const MoneyAmountSchemaDefinition = {
  amountMinorUnits: { type: Number, required: true },
  currency: { type: String, enum: ['USD', 'GEL', 'RUB'], required: true },
};

/**
 * DEAL-001: Tenant-scoped Deal core schema.
 */
@Schema({ collection: 'deals', timestamps: true })
export class DealDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  leadId?: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  contactId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  ownerPositionId!: Types.ObjectId;

  @Prop({ required: true, type: String, maxlength: 255 })
  title!: string;

  @Prop({ type: String, required: false, maxlength: 2000 })
  description?: string;

  @Prop({
    required: true,
    type: String,
    enum: DEAL_STAGES,
    default: 'showing',
  })
  stage!: DealStage;

  @Prop({ type: MoneyAmountSchemaDefinition, required: false })
  expectedCommission?: MoneyAmount;

  @Prop({
    type: String,
    enum: ['primary', 'secondary', 'rental', 'assignment'],
    default: 'secondary',
  })
  dealType?: 'primary' | 'secondary' | 'rental' | 'assignment';

  @Prop({ type: Types.ObjectId, required: false })
  unitId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  developmentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  installmentPlanId?: Types.ObjectId;

  @Prop({ type: MoneyAmountSchemaDefinition, required: false })
  downPayment?: MoneyAmount;

  /**
   * Фактическая комиссия, которая пришла BAZA по сделке. Отмечает менеджер
   * BAZA в админке (решение владельца 16.09.2026); ожидаемая комиссия выше —
   * это план, а не деньги. По первичке от этой суммы считается начисление
   * куратору агента.
   */
  @Prop({ type: MoneyAmountSchemaDefinition, required: false })
  commissionReceived?: MoneyAmount;

  @Prop({ type: Date, required: false })
  commissionReceivedAt?: Date;

  @Prop({ type: Types.ObjectId, required: false })
  commissionReceivedByAdminId?: Types.ObjectId;

  @Prop({ type: [DealParticipantSchema], default: [] })
  participants!: DealParticipant[];

  @Prop({ type: [DealChecklistItemSchema], default: [] })
  checklistItems!: DealChecklistItem[];

  @Prop({ required: true, type: Number, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const DealSchema = SchemaFactory.createForClass(DealDocument);

DealSchema.index({ organizationId: 1, _id: -1 });
DealSchema.index({ organizationId: 1, ownerPositionId: 1, _id: -1 });
DealSchema.index({ organizationId: 1, stage: 1, _id: -1 });
DealSchema.index({ organizationId: 1, contactId: 1, _id: -1 });
DealSchema.index({ organizationId: 1, leadId: 1, _id: -1 });

/** Раздел «Комиссии» в админке: сделки первички по всем организациям, ждут ли денег. */
DealSchema.index({ dealType: 1, commissionReceivedAt: 1, _id: -1 });
