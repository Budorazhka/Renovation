import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  MarketplaceSelectionDocument,
  type MarketplaceSelectionItemType,
} from '../schemas/marketplace-selection.schema';

/** Единственная точка доступа к коллекции marketplace_selections (ADR-002). */
@Injectable()
export class MarketplaceSelectionRepository {
  constructor(
    @InjectModel(MarketplaceSelectionDocument.name) private readonly model: Model<MarketplaceSelectionDocument>,
  ) {}

  async listForIdentity(identityId: Types.ObjectId): Promise<MarketplaceSelectionDocument[]> {
    return this.model.find({ identityId }).sort({ createdAt: -1 }).exec();
  }

  async findByIdForIdentity(id: Types.ObjectId, identityId: Types.ObjectId): Promise<MarketplaceSelectionDocument | null> {
    return this.model.findOne({ _id: id, identityId }).exec();
  }

  async create(
    identityId: Types.ObjectId,
    title: string,
    publicToken: string,
    session: ClientSession,
  ): Promise<MarketplaceSelectionDocument> {
    const [created] = await this.model.create([{ identityId, title, publicToken, items: [] }], { session });
    return created!;
  }

  async rename(id: Types.ObjectId, identityId: Types.ObjectId, title: string): Promise<MarketplaceSelectionDocument | null> {
    return this.model.findOneAndUpdate({ _id: id, identityId }, { $set: { title } }, { new: true }).exec();
  }

  async remove(id: Types.ObjectId, identityId: Types.ObjectId): Promise<boolean> {
    const { deletedCount } = await this.model.deleteOne({ _id: id, identityId }).exec();
    return (deletedCount ?? 0) > 0;
  }

  /**
   * Добавление идемпотентно, тот же принцип, что FavoriteRepository.add:
   * фильтр «элемента с этим (targetType, slug) в подборке ещё нет»
   * атомарно исключает дубль при гонке двух одновременных добавлений.
   * `null` от findOneAndUpdate означает либо «подборка не найдена/чужая»,
   * либо «элемент уже там» — оба случая вызывающий код (сервис) различает
   * последующим findByIdForIdentity, а не второй похожей записью здесь.
   */
  async addItem(
    id: Types.ObjectId,
    identityId: Types.ObjectId,
    targetType: MarketplaceSelectionItemType,
    slug: string,
  ): Promise<MarketplaceSelectionDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, identityId, items: { $not: { $elemMatch: { targetType, slug } } } },
        { $push: { items: { targetType, slug, addedAt: new Date() } } },
        { new: true },
      )
      .exec();
  }

  /** Удаление тоже идемпотентно: снятие уже снятого — не ошибка, а тот же итог. */
  async removeItem(
    id: Types.ObjectId,
    identityId: Types.ObjectId,
    targetType: MarketplaceSelectionItemType,
    slug: string,
  ): Promise<MarketplaceSelectionDocument | null> {
    return this.model
      .findOneAndUpdate({ _id: id, identityId }, { $pull: { items: { targetType, slug } } }, { new: true })
      .exec();
  }

  /**
   * ПУБЛИЧНЫЙ путь — единственный ключ доступа это сам publicToken, без
   * identityId (тот же принцип, что DevSelectionRepository
   * .markViewedByPublicToken): владелец делится ссылкой с кем угодно.
   */
  async findByPublicToken(publicToken: string): Promise<MarketplaceSelectionDocument | null> {
    return this.model.findOne({ publicToken }).exec();
  }
}
