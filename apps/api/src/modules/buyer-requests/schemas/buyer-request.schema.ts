import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BuyerRequestDealType = 'buy' | 'rent';
export type BuyerRequestStatus = 'published' | 'closed' | 'moderated';

@Schema({ collection: 'buyer_requests', timestamps: true })
export class BuyerRequestDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorIdentityId!: Types.ObjectId;

  @Prop({ required: true, enum: ['buy', 'rent'] })
  dealType!: BuyerRequestDealType;

  @Prop({ required: true, maxlength: 40 })
  city!: string;

  @Prop({ required: true, maxlength: 40 })
  propertyKind!: string;

  @Prop({ required: true, maxlength: 255 })
  title!: string;

  @Prop({ required: true, maxlength: 4000 })
  comment!: string;

  @Prop({ required: true, min: 0 })
  budgetAmount!: number;

  @Prop({ required: true, enum: ['USD', 'GEL', 'RUB'] })
  budgetCurrency!: string;

  @Prop({ required: true, default: false })
  budgetPerMonth!: boolean;

  @Prop({ required: true, enum: ['published', 'closed', 'moderated'], default: 'published' })
  status!: BuyerRequestStatus;

  @Prop({ type: Types.ObjectId, required: false })
  moderatedByAdminId?: Types.ObjectId;

  @Prop({ required: false, maxlength: 1000 })
  moderationReason?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const BuyerRequestSchema = SchemaFactory.createForClass(BuyerRequestDocument);
// Matches the actual board query/sort exactly (BuyerRequestRepository.listPublic:
// filter by status, sort by _id desc) — a status+createdAt+_id index cannot serve
// a status+_id sort without an extra in-memory sort step.
BuyerRequestSchema.index({ status: 1, _id: -1 });
BuyerRequestSchema.index({ authorIdentityId: 1, createdAt: -1 });
