import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessengerPlatform = 'telegram' | 'whatsapp';
export type MessengerAccountType = 'bot' | 'user';
export type MessengerAuthStatus = 'pending' | 'authenticated' | 'disconnected';

export const MESSENGER_PLATFORMS: readonly MessengerPlatform[] = ['telegram', 'whatsapp'] as const;
export const MESSENGER_ACCOUNT_TYPES: readonly MessengerAccountType[] = ['bot', 'user'] as const;
export const MESSENGER_AUTH_STATUSES: readonly MessengerAuthStatus[] = ['pending', 'authenticated', 'disconnected'] as const;

/**
 * Server-side storage for external messaging accounts (Telegram bot, WhatsApp).
 * Tokens and credentials are kept strictly on the backend (never leaked to browser).
 *
 * N-12 (roadmap-2026-09.md): живёт в `@baza/messenger` (не в `apps/api`),
 * тот же принцип, что `@baza/media-storage` (докстринг MediaStorageService)
 * — и API-процесс (подключение бота, отправка), и worker-процесс (реальная
 * отправка через Telegram Bot API после ответа провайдера) обращаются к
 * ОДНОЙ и той же коллекции `messenger_accounts`, а worker структурно не
 * может импортировать `apps/api/src/modules/messenger/*` (отдельный
 * деплой, свой package.json, нет edge зависимости).
 */
@Schema({ collection: 'messenger_accounts', timestamps: true })
export class MessengerAccountDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  assignedPositionId?: Types.ObjectId;

  @Prop({ required: true, type: String, enum: MESSENGER_PLATFORMS })
  platform!: MessengerPlatform;

  @Prop({ required: true, type: String, enum: MESSENGER_ACCOUNT_TYPES, default: 'bot' })
  accountType!: MessengerAccountType;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  /**
   * Secret token for Telegram Bot API or session identifier.
   * Never returned in public read models.
   *
   * `select: false` — тот же принцип, что `Identity.passwordHash`/
   * `legacyPasswordHash`. Вызывающий код (getMe-верификация при подключении,
   * worker-хендлер реальной отправки) запрашивает поле явно через
   * `.select('+botToken')`.
   */
  @Prop({ required: false, trim: true, select: false })
  botToken?: string;

  /**
   * N-12: секрет вебхука Telegram (`secret_token` в `setWebhook`), которым
   * подписан заголовок `X-Telegram-Bot-Api-Secret-Token` в каждом входящем
   * апдейте — единственная проверка подлинности вебхука (сам путь публичный,
   * без TenantGuard/PermissionGuard, см. TelegramWebhookController). 256 бит
   * энтропии, `select: false` по тому же принципу, что `botToken` выше:
   * читается явно только контроллером вебхука.
   */
  @Prop({ required: false, trim: true, select: false })
  webhookSecret?: string;

  @Prop({ required: false, trim: true })
  telegramBotUsername?: string;

  @Prop({ required: false, trim: true })
  phoneNumber?: string;

  @Prop({ required: true, type: String, enum: MESSENGER_AUTH_STATUSES, default: 'pending' })
  authStatus!: MessengerAuthStatus;

  @Prop({ required: true, default: true })
  isActive!: boolean;

  @Prop({ required: false, type: Date })
  lastSyncAt?: Date;
}

export const MessengerAccountSchema = SchemaFactory.createForClass(MessengerAccountDocument);

MessengerAccountSchema.index({ organizationId: 1, platform: 1 });
MessengerAccountSchema.index({ organizationId: 1, isActive: 1 });
