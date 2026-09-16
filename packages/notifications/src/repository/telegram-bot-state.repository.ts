import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TelegramBotStateDocument } from '../schemas/telegram-bot-state.schema';

/** Offset getUpdates бота уведомлений между перезапусками worker'а. */
@Injectable()
export class TelegramBotStateRepository {
  constructor(
    @InjectModel(TelegramBotStateDocument.name)
    private readonly model: Model<TelegramBotStateDocument>,
  ) {}

  async getOffset(key: string): Promise<number> {
    const state = await this.model.findOne({ key }).exec();
    return state?.offset ?? 0;
  }

  async saveOffset(key: string, offset: number): Promise<void> {
    await this.model.updateOne({ key }, { $set: { offset } }, { upsert: true }).exec();
  }
}
