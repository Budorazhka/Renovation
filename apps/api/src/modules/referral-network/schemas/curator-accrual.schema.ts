import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';

/**
 * `accrued` — BAZA должна куратору; `paid` — выплачено; `reversed` —
 * начисление отменено, потому что отметку о деньгах сняли. Отменённое не
 * удаляется: история денег не переписывается.
 */
export type CuratorAccrualStatus = 'accrued' | 'paid' | 'reversed';

const MoneyAmountDefinition = {
  amountMinorUnits: { type: Number, required: true },
  currency: { type: String, enum: ['USD', 'GEL', 'RUB'], required: true },
};

/**
 * Начисление куратору: 7% от фактической комиссии агента из его команды по
 * сделке первички (решение владельца 16.09.2026). Пишется в той же
 * транзакции, что и отметка менеджера BAZA «Комиссия получена».
 *
 * Куратор и агент — снимок на момент поступления денег: если агента потом
 * переведут к другому куратору, это начисление не переедет. Процент тоже
 * снимок — старые начисления не зависят от будущей смены правила.
 */
@Schema({ collection: 'curator_accruals', timestamps: true })
export class CuratorAccrualDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  curatorIdentityId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  memberIdentityId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  dealId!: Types.ObjectId;

  /** Организация сделки — для раздела агентства в ERP; сама сделка куратору не показывается. */
  @Prop({ required: true, type: Types.ObjectId, index: true })
  dealOrganizationId!: Types.ObjectId;

  @Prop({ type: MoneyAmountDefinition, required: true })
  commission!: MoneyAmount;

  @Prop({ required: true })
  ratePercent!: number;

  @Prop({ type: MoneyAmountDefinition, required: true })
  amount!: MoneyAmount;

  @Prop({ required: true, enum: ['accrued', 'paid', 'reversed'], default: 'accrued' })
  status!: CuratorAccrualStatus;

  @Prop({ required: true })
  accruedAt!: Date;

  @Prop({ required: false })
  paidAt?: Date;

  @Prop({ required: false, type: Types.ObjectId })
  paidByAdminId?: Types.ObjectId;

  @Prop({ required: false })
  reversedAt?: Date;

  @Prop({ required: false, type: Types.ObjectId })
  reversedByAdminId?: Types.ObjectId;

  @Prop({ required: false, maxlength: 1000 })
  reverseReason?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const CuratorAccrualSchema = SchemaFactory.createForClass(CuratorAccrualDocument);

/** Одно действующее начисление на сделку: повторная отметка не начисляет дважды. */
CuratorAccrualSchema.index(
  { dealId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['accrued', 'paid'] } }, name: 'one_live_accrual_per_deal' },
);

CuratorAccrualSchema.index({ curatorIdentityId: 1, status: 1, accruedAt: -1 });
