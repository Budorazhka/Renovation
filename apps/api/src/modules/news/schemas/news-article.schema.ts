import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Лента новостей ERP (блок «Новости» инфо-центра рабочего стола и страница
 * «Новости»). Раньше — вшитые примеры и localStorage автора: новость видел
 * только тот, кто её написал.
 *
 *  - `platform` — новость платформы BAZA, публикует администратор в админке;
 *    видят все сотрудники всех организаций. organizationId не задан.
 *  - `organization` — новость компании, публикует руководитель в настройках
 *    ERP; видят только сотрудники этой организации.
 */
export type NewsSource = 'platform' | 'organization';

export const NEWS_SOURCES: readonly NewsSource[] = ['platform', 'organization'] as const;

export type NewsCategory = 'company' | 'market' | 'developer' | 'regulation';

export const NEWS_CATEGORIES: readonly NewsCategory[] = ['company', 'market', 'developer', 'regulation'] as const;

@Schema({ collection: 'news_articles', timestamps: { createdAt: 'publishedAt', updatedAt: false } })
export class NewsArticleDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, enum: NEWS_SOURCES })
  source!: NewsSource;

  /** Организация новости компании; у новости платформы не задан. */
  @Prop({ type: Types.ObjectId, required: false })
  organizationId?: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ required: true, maxlength: 10_000 })
  body!: string;

  @Prop({ required: true, enum: NEWS_CATEGORIES })
  category!: NewsCategory;

  @Prop({ required: true, default: false })
  pinned!: boolean;

  @Prop({ required: false, maxlength: 2000 })
  linkUrl?: string;

  @Prop({ required: false, trim: true, maxlength: 80 })
  linkLabel?: string;

  /** Картинка к новости — MediaAsset (purpose news_image, публичный бакет) того же владельца, что и новость. */
  @Prop({ type: Types.ObjectId, required: false })
  imageAssetId?: Types.ObjectId;

  /** CAS правки: PUT обязан прислать версию, которую видел редактор. */
  @Prop({ required: true, default: 0 })
  version!: number;

  /** Когда новость правили в последний раз; у нетронутой не задано. */
  @Prop({ required: false })
  editedAt?: Date;

  /** Подпись автора на момент публикации: имя сотрудника у новости компании; у новости платформы не задана. */
  @Prop({ required: false, trim: true, maxlength: 200 })
  authorName?: string;

  /** Кто опубликовал: позиция (новость компании) или аккаунт администратора (новость платформы). */
  @Prop({ type: Types.ObjectId, required: false })
  createdByPositionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  createdByAdminId?: Types.ObjectId;

  declare publishedAt: Date;
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticleDocument);

NewsArticleSchema.index({ source: 1, _id: -1 });
NewsArticleSchema.index({ organizationId: 1, _id: -1 });
