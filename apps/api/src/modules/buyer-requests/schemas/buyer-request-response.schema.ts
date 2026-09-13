import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * N-13: отклик организации на публичный запрос покупателя
 * (BuyerRequestDocument). Один отклик на пару {buyerRequestId,
 * organizationId} — уникальный индекс ниже — не журнал переговоров, а
 * текущее состояние "чем эта организация предлагает помочь"; повторная
 * отправка формы обновляет текст, не создаёт второй отклик (upsert в
 * BuyerRequestResponseRepository.upsert). Множество организаций могут
 * откликнуться на один и тот же запрос независимо друг от друга — тот же
 * принцип, что CommunityReplyDocument у биржи MLS: плоский many-to-one без
 * эксклюзивного захвата запроса одной организацией.
 *
 * Видимость отклика автору запроса (покупателю) сознательно не входит в
 * этот backend-инкремент — см. docs/operations/buyer-requests-and-reviews.md.
 */
@Schema({ collection: 'buyer_request_responses', timestamps: true })
export class BuyerRequestResponseDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  buyerRequestId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  respondedByPositionId!: Types.ObjectId;

  @Prop({ required: true, maxlength: 2000 })
  message!: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const BuyerRequestResponseSchema = SchemaFactory.createForClass(BuyerRequestResponseDocument);
BuyerRequestResponseSchema.index({ buyerRequestId: 1, organizationId: 1 }, { unique: true });
BuyerRequestResponseSchema.index({ organizationId: 1, updatedAt: -1 });
