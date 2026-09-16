import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationKind = 'news';
export type NotificationChannel = 'email' | 'telegram';
export type NotificationDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['news'] as const;
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['email', 'telegram'] as const;
export const NOTIFICATION_DELIVERY_STATUSES: readonly NotificationDeliveryStatus[] = [
  'pending',
  'sent',
  'failed',
  'skipped',
] as const;

/**
 * Одна доставка одного уведомления одному человеку по одному каналу.
 * API создаёт записи `pending` в той же транзакции, что и новость, worker
 * отправляет и переводит в sent/failed/skipped. Уникальный индекс
 * (kind, refId, channel, identityId) — идемпотентность: повтор outbox-события
 * не отправит письмо второй раз, а повторная постановка не создаст дубль.
 *
 * Адрес (почта или chat id) и текст фиксируются при постановке: письмо
 * уходит с тем содержимым, которое было на момент публикации.
 */
@Schema({ collection: 'notification_deliveries', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class NotificationDeliveryDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, enum: NOTIFICATION_KINDS })
  kind!: NotificationKind;

  /** Что доставляем: для kind 'news' — id новости. */
  @Prop({ required: true, type: Types.ObjectId })
  refId!: Types.ObjectId;

  @Prop({ required: true, enum: NOTIFICATION_CHANNELS })
  channel!: NotificationChannel;

  @Prop({ required: true, type: Types.ObjectId })
  identityId!: Types.ObjectId;

  /** Адрес почты или Telegram chat id. */
  @Prop({ required: true })
  address!: string;

  @Prop({ required: true })
  subject!: string;

  @Prop({ required: true })
  text!: string;

  @Prop({ required: true, enum: NOTIFICATION_DELIVERY_STATUSES, default: 'pending' })
  status!: NotificationDeliveryStatus;

  @Prop({ required: false })
  lastError?: string;

  @Prop({ required: false })
  sentAt?: Date;

  declare createdAt: Date;
}

export const NotificationDeliverySchema = SchemaFactory.createForClass(NotificationDeliveryDocument);

NotificationDeliverySchema.index({ kind: 1, refId: 1, channel: 1, identityId: 1 }, { unique: true });
NotificationDeliverySchema.index({ refId: 1, status: 1 });
