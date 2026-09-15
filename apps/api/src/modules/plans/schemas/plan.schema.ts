import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Месячный план сотрудника (позиции) — блок прогресса рабочего стола, «Мой
 * отчёт», окно «Поставить планы». Раньше жил в памяти браузера на
 * вымышленных сотрудниках. Ставит руководитель (owner/director/rop/
 * developer — любой позиции организации) или сам сотрудник себе.
 * Одна запись на позицию и месяц.
 */
@Schema({ collection: 'plans', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })
export class PlanDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  positionId!: Types.ObjectId;

  /** Месяц плана, `YYYY-MM`. */
  @Prop({ required: true })
  period!: string;

  /** Выручка — комиссия по выигранным сделкам, в минимальных единицах валюты. */
  @Prop({ required: true, default: 0, min: 0 })
  revenueTargetMinorUnits!: number;

  @Prop({ required: true, default: 'USD' })
  currency!: string;

  @Prop({ required: true, default: 0, min: 0 })
  leadsTarget!: number;

  @Prop({ required: true, default: 0, min: 0 })
  dealsTarget!: number;

  @Prop({ required: true, default: 0, min: 0 })
  callsTarget!: number;

  @Prop({ required: true, default: 0, min: 0 })
  meetingsTarget!: number;

  @Prop({ required: true, default: 0, min: 0 })
  showingsTarget!: number;

  /** Кто поставил план последним: руководитель или сам сотрудник. */
  @Prop({ required: true, type: Types.ObjectId })
  setByPositionId!: Types.ObjectId;

  /** conventions.md разд.5 optimistic concurrency. */
  @Prop({ required: true, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const PlanSchema = SchemaFactory.createForClass(PlanDocument);

PlanSchema.index({ organizationId: 1, positionId: 1, period: 1 }, { unique: true });
PlanSchema.index({ organizationId: 1, period: 1 });
