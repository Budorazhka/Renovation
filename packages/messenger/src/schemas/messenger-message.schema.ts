import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type MessageAuthor = 'client' | 'agent';
export type MessageType = 'text' | 'photo' | 'video' | 'document' | 'audio';
/**
 * `queued` — сообщение принято платформой, но в канал ещё не отправлено.
 * `sent` — воркер (`MessengerMessageSentHandler`, N-12) получил
 * подтверждение от Telegram Bot API (`message_id` в ответе), `externalMessageId`
 * заполнен. `failed` — постоянная ошибка провайдера (бот заблокирован,
 * chat_id не существует, WhatsApp пока не поддержан вообще) — не будет
 * дозакрыта повтором, честный терминальный статус вместо вечного `queued`.
 * `delivered`/`read` — подтверждение доставки/прочтения от клиента (пока
 * ставится эвристически: любое входящее сообщение клиента переводит
 * предыдущие исходящие; настоящих delivery receipt от Telegram Bot API нет).
 */
export type MessageStatus = 'queued' | 'sent' | 'failed' | 'delivered' | 'read';

export const MESSAGE_AUTHORS: readonly MessageAuthor[] = ['client', 'agent'] as const;
export const MESSAGE_TYPES: readonly MessageType[] = ['text', 'photo', 'video', 'document', 'audio'] as const;
export const MESSAGE_STATUSES: readonly MessageStatus[] = ['queued', 'sent', 'failed', 'delivered', 'read'] as const;

export interface MessageMedia {
  assetId?: Types.ObjectId;
  url?: string;
  mimeType?: string;
  fileName?: string;
}

const MessageMediaSchema = new MongooseSchema(
  {
    assetId: { type: MongooseSchema.Types.ObjectId, required: false },
    url: { type: String, required: false },
    mimeType: { type: String, required: false },
    fileName: { type: String, required: false },
  },
  { _id: false },
);

/**
 * Historical message log inside a MessengerDialog.
 * Retains full message lifecycle, author attribution, and attachments.
 */
@Schema({ collection: 'messenger_messages', timestamps: true })
export class MessengerMessageDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  dialogId!: Types.ObjectId;

  @Prop({ required: false, trim: true })
  externalMessageId?: string;

  @Prop({ required: true, type: String, enum: MESSAGE_AUTHORS })
  author!: MessageAuthor;

  @Prop({ type: Types.ObjectId, required: false })
  senderPositionId?: Types.ObjectId;

  @Prop({ required: true, type: String })
  text!: string;

  @Prop({ required: true, type: String, enum: MESSAGE_TYPES, default: 'text' })
  messageType!: MessageType;

  @Prop({ required: true, type: String, enum: MESSAGE_STATUSES, default: 'queued' })
  status!: MessageStatus;

  /** Время приёма сообщения платформой; имя поля — из контракта, не факт отправки. */
  @Prop({ required: true, type: Date, default: () => new Date() })
  sentAt!: Date;

  @Prop({ type: MessageMediaSchema, required: false })
  media?: MessageMedia;
}

export const MessengerMessageSchema = SchemaFactory.createForClass(MessengerMessageDocument);

MessengerMessageSchema.index({ organizationId: 1, dialogId: 1, sentAt: -1 });
MessengerMessageSchema.index({ organizationId: 1, dialogId: 1, status: 1 });
