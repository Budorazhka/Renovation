import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type MarketplaceSelectionItemType = 'development' | 'listing';

export interface MarketplaceSelectionItem {
  targetType: MarketplaceSelectionItemType;
  slug: string;
  addedAt: Date;
}

const MarketplaceSelectionItemSchema = new MongooseSchema(
  {
    targetType: { type: String, required: true, enum: ['development', 'listing'] },
    slug: { type: String, required: true },
    addedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

/**
 * N-11 (roadmap-2026-09.md, решение владельца 07.09.2026): подборки
 * покупателя живут на сервере у его аккаунта, а не в localStorage —
 * открываются с любого устройства (по identityId) и по ссылке (publicToken).
 *
 * Ключ элемента — slug публикации, тот же принцип, что FavoriteDocument
 * (favorites/schemas/favorite.schema.ts): подборка не хранит копию карточки
 * и не требует доступа к приватным коллекциям каталога — витрина дочитывает
 * объекты теми же публичными эндпоинтами `GET /public/developments/:slug` /
 * `GET /public/listings/:slug`, которыми пользуется весь каталог.
 *
 * `publicToken` — не хеш, тот же принцип и то же обоснование, что
 * DevSelectionDocument.publicToken (256 бит энтропии, randomBytes(32)):
 * владелец открывает и копирует одну и ту же ссылку многократно, а
 * секретность даёт исключительно энтропия токена, не хеширование.
 *
 * Привязано к `identityId`, не к organizationId — подборка принадлежит
 * человеку (покупателю), не организации; тот же принцип, что
 * FavoriteDocument (см. её докстринг) и tenant-scope.test.ts#favorite
 * .repository.ts исключения.
 */
@Schema({ collection: 'marketplace_selections', timestamps: true })
export class MarketplaceSelectionDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  identityId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  publicToken!: string;

  @Prop({ required: true, maxlength: 200 })
  title!: string;

  @Prop({ type: [MarketplaceSelectionItemSchema], default: [] })
  items!: MarketplaceSelectionItem[];

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const MarketplaceSelectionSchema = SchemaFactory.createForClass(MarketplaceSelectionDocument);

/** Список подборок читается всегда по одному владельцу и сортируется по дате. */
MarketplaceSelectionSchema.index({ identityId: 1, createdAt: -1 });
// publicToken уже unique через @Prop({unique:true}) выше — отдельный index() не нужен.
