import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Настройки уведомлений человека (identity), не позиции: Telegram и почта
 * принадлежат человеку и не меняются при переходе между организациями.
 * Документа может не быть — тогда действуют умолчания (всё включено,
 * Telegram не привязан).
 *
 * Почта берётся из логина identity, если это адрес: отдельного адреса для
 * уведомлений нет, чтобы нельзя было подписать на рассылку чужой ящик.
 */
@Schema({ collection: 'notification_settings', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })
export class NotificationSettingsDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, unique: true })
  identityId!: Types.ObjectId;

  /** Присылать новости на почту (если логин — адрес почты). */
  @Prop({ required: true, default: true })
  newsEmail!: boolean;

  /** Присылать новости в Telegram (если Telegram привязан). */
  @Prop({ required: true, default: true })
  newsTelegram!: boolean;

  /** Чат с ботом уведомлений BAZA — появляется после /start по ссылке из ERP. */
  @Prop({ required: false })
  telegramChatId?: string;

  @Prop({ required: false })
  telegramUsername?: string;

  @Prop({ required: false })
  telegramLinkedAt?: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const NotificationSettingsSchema = SchemaFactory.createForClass(NotificationSettingsDocument);

NotificationSettingsSchema.index({ telegramChatId: 1 }, { sparse: true });
