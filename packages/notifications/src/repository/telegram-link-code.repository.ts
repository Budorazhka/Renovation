import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TelegramLinkCodeDocument } from '../schemas/telegram-link-code.schema';

/** Одноразовые коды привязки Telegram (хеши). Поиск — по самому коду, он и есть предъявляемый секрет. */
@Injectable()
export class TelegramLinkCodeRepository {
  constructor(
    @InjectModel(TelegramLinkCodeDocument.name)
    private readonly model: Model<TelegramLinkCodeDocument>,
  ) {}

  /** Новый код отменяет прежние коды этого человека: рабочей остаётся только последняя ссылка. */
  async replaceForIdentity(identityId: Types.ObjectId, codeHash: string, expiresAt: Date): Promise<void> {
    await this.model.deleteMany({ identityId }).exec();
    await this.model.create({ identityId, codeHash, expiresAt });
  }

  /** Забирает действующий код ровно один раз; просроченный или уже использованный — null. */
  async consume(codeHash: string, now: Date): Promise<TelegramLinkCodeDocument | null> {
    return this.model.findOneAndDelete({ codeHash, expiresAt: { $gt: now } }).exec();
  }
}
