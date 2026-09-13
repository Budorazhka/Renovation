import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RealtorReviewStatus = 'pending' | 'approved' | 'rejected';

@Schema({ collection: 'realtor_reviews', timestamps: true })
export class RealtorReviewDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true }) realtorPositionId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) reviewerIdentityId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) completedDealId!: Types.ObjectId;
  @Prop({ required: true, min: 1, max: 5 }) rating!: number;
  @Prop({ required: true, maxlength: 4000 }) text!: string;
  @Prop({ required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' }) status!: RealtorReviewStatus;
  @Prop({ type: Types.ObjectId, required: false }) moderatedByAdminId?: Types.ObjectId;
  @Prop({ required: false, maxlength: 1000 }) moderationReason?: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const RealtorReviewSchema = SchemaFactory.createForClass(RealtorReviewDocument);
RealtorReviewSchema.index({ realtorPositionId: 1, status: 1, createdAt: -1 });
RealtorReviewSchema.index({ reviewerIdentityId: 1, completedDealId: 1, realtorPositionId: 1 }, { unique: true });
