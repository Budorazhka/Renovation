import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationSettingsDocument } from '../schemas/notification-settings.schema';

export interface NotificationPreferences {
  newsEmail?: boolean;
  newsTelegram?: boolean;
}

/**
 * Настройки уведомлений по identity. Не tenant-коллекция: человек один на
 * все организации, фильтр — identityId из сессии или chat id из Telegram.
 */
@Injectable()
export class NotificationSettingsRepository {
  constructor(
    @InjectModel(NotificationSettingsDocument.name)
    private readonly model: Model<NotificationSettingsDocument>,
  ) {}

  async findByIdentity(identityId: Types.ObjectId): Promise<NotificationSettingsDocument | null> {
    return this.model.findOne({ identityId }).exec();
  }

  async findByIdentityIds(identityIds: Types.ObjectId[]): Promise<NotificationSettingsDocument[]> {
    if (identityIds.length === 0) return [];
    return this.model.find({ identityId: { $in: identityIds } }).exec();
  }

  async updatePreferences(identityId: Types.ObjectId, preferences: NotificationPreferences): Promise<NotificationSettingsDocument> {
    const $set: Record<string, boolean> = {};
    if (preferences.newsEmail !== undefined) $set.newsEmail = preferences.newsEmail;
    if (preferences.newsTelegram !== undefined) $set.newsTelegram = preferences.newsTelegram;
    const updated = await this.model
      .findOneAndUpdate({ identityId }, { $set, $setOnInsert: { identityId } }, { new: true, upsert: true, setDefaultsOnInsert: true })
      .exec();
    return updated!;
  }

  /**
   * Привязывает чат к identity. Чат принадлежит одному человеку: если этот же
   * Telegram раньше был привязан к другому аккаунту, там привязка снимается —
   * иначе новости двух людей приходили бы в один чат.
   */
  async linkTelegram(identityId: Types.ObjectId, chatId: string, username?: string): Promise<void> {
    await this.model
      .updateMany(
        { telegramChatId: chatId, identityId: { $ne: identityId } },
        { $unset: { telegramChatId: '', telegramUsername: '', telegramLinkedAt: '' } },
      )
      .exec();
    const $set: Record<string, unknown> = { telegramChatId: chatId, telegramLinkedAt: new Date() };
    const $unset: Record<string, ''> = {};
    if (username) $set.telegramUsername = username;
    else $unset.telegramUsername = '';
    await this.model
      .updateOne({ identityId }, { $set, $unset, $setOnInsert: { identityId } }, { upsert: true, setDefaultsOnInsert: true })
      .exec();
  }

  async unlinkTelegram(identityId: Types.ObjectId): Promise<void> {
    await this.model
      .updateOne({ identityId }, { $unset: { telegramChatId: '', telegramUsername: '', telegramLinkedAt: '' } })
      .exec();
  }

  /** /stop в боте или бот заблокирован: чат больше не получает уведомлений. Возвращает, была ли привязка. */
  async unlinkTelegramChat(chatId: string): Promise<boolean> {
    const result = await this.model
      .updateMany({ telegramChatId: chatId }, { $unset: { telegramChatId: '', telegramUsername: '', telegramLinkedAt: '' } })
      .exec();
    return result.modifiedCount > 0;
  }
}
