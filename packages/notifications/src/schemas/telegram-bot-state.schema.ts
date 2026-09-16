import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Позиция чтения getUpdates бота уведомлений: следующий offset. Хранится в
 * базе, а не в памяти worker'а — после перезапуска бот не перечитывает уже
 * обработанные /start (Telegram держит неподтверждённые апдейты 24 часа).
 */
@Schema({ collection: 'telegram_bot_states', timestamps: { createdAt: false, updatedAt: 'updatedAt' } })
export class TelegramBotStateDocument extends Document {
  declare _id: Types.ObjectId;

  /** Ключ бота, например 'notify'. */
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true, default: 0 })
  offset!: number;

  declare updatedAt: Date;
}

export const TelegramBotStateSchema = SchemaFactory.createForClass(TelegramBotStateDocument);
