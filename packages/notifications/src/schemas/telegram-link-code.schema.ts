import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Одноразовый код привязки Telegram: ERP выдаёт ссылку
 * `t.me/<бот>?start=<код>`, бот уведомлений получает `/start <код>` и
 * связывает чат с identity. Хранится только хеш кода — утечка коллекции не
 * даёт привязать чужой аккаунт. Живёт 15 минут (TTL-индекс по expiresAt).
 */
@Schema({ collection: 'telegram_link_codes', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class TelegramLinkCodeDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, unique: true })
  codeHash!: string;

  @Prop({ required: true, type: Types.ObjectId })
  identityId!: Types.ObjectId;

  @Prop({ required: true })
  expiresAt!: Date;

  declare createdAt: Date;
}

export const TelegramLinkCodeSchema = SchemaFactory.createForClass(TelegramLinkCodeDocument);

TelegramLinkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
TelegramLinkCodeSchema.index({ identityId: 1 });
