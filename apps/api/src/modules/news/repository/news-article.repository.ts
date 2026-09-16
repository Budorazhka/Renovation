import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { NewsArticleDocument, type NewsCategory, type NewsSource } from '../schemas/news-article.schema';

/** Редактируемое содержимое новости; отсутствующее необязательное поле при правке удаляется. */
export interface NewsArticleContent {
  title: string;
  body: string;
  category: NewsCategory;
  pinned: boolean;
  linkUrl?: string;
  linkLabel?: string;
  imageAssetId?: Types.ObjectId;
}

export interface CreateNewsArticleParams extends NewsArticleContent {
  source: NewsSource;
  organizationId?: Types.ObjectId;
  authorName?: string;
  createdByPositionId?: Types.ObjectId;
  createdByAdminId?: Types.ObjectId;
}

/** Именованный тип результата — инлайн-`{...}` в Promise<{...}> ломает разбор сигнатуры в tenant-scope.test.ts. */
export interface NewsArticleDeleteResult {
  deletedCount: number;
}

const OPTIONAL_CONTENT_FIELDS = ['linkUrl', 'linkLabel', 'imageAssetId'] as const;

/**
 * Условие CAS по версии. Новость, созданная до появления поля `version`,
 * хранится без него, а читается как версия 0 — для 0 подходит и
 * отсутствующее поле (null в фильтре совпадает с отсутствием).
 */
function versionMatch(expectedVersion: number) {
  return expectedVersion === 0 ? { $in: [0, null] } : expectedVersion;
}

/** $set для заданных полей и $unset для снятых необязательных — правка заменяет содержимое целиком. */
function contentUpdate(content: NewsArticleContent) {
  const $set: Record<string, unknown> = {
    title: content.title,
    body: content.body,
    category: content.category,
    pinned: content.pinned,
    editedAt: new Date(),
  };
  const $unset: Record<string, ''> = {};
  for (const field of OPTIONAL_CONTENT_FIELDS) {
    if (content[field] !== undefined) $set[field] = content[field];
    else $unset[field] = '';
  }
  return { $set, $unset, $inc: { version: 1 } };
}

/**
 * Новости ERP. Лента сотрудника — новости платформы плюс новости СВОЕЙ
 * организации (organizationId в фильтре, tenant-scope.test.ts); новости
 * платформы администратор читает, правит и удаляет без организации — они ничьи.
 */
@Injectable()
export class NewsArticleRepository {
  constructor(@InjectModel(NewsArticleDocument.name) private readonly model: Model<NewsArticleDocument>) {}

  async create(params: CreateNewsArticleParams, session?: ClientSession): Promise<NewsArticleDocument> {
    const docData: Record<string, unknown> = {
      source: params.source,
      title: params.title,
      body: params.body,
      category: params.category,
      pinned: params.pinned,
      version: 0,
    };
    const optional = [
      'organizationId',
      'linkUrl',
      'linkLabel',
      'imageAssetId',
      'authorName',
      'createdByPositionId',
      'createdByAdminId',
    ] as const;
    for (const field of optional) {
      if (params[field] !== undefined) docData[field] = params[field];
    }

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  /** Лента сотрудника: новости платформы и новости своей организации, новые первыми. */
  async listFeed(organizationId: Types.ObjectId, limit: number): Promise<NewsArticleDocument[]> {
    return this.model
      .find({ $or: [{ source: 'platform' }, { source: 'organization', organizationId }] })
      .sort({ _id: -1 })
      .limit(limit)
      .exec();
  }

  async findForOrganization(id: Types.ObjectId, organizationId: Types.ObjectId): Promise<NewsArticleDocument | null> {
    return this.model.findOne({ _id: id, source: 'organization', organizationId }).exec();
  }

  /** CAS-правка новости компании; null — новость не найдена или версия устарела. */
  async updateForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    content: NewsArticleContent,
    session?: ClientSession,
  ): Promise<NewsArticleDocument | null> {
    return this.model
      .findOneAndUpdate({ _id: id, source: 'organization', organizationId, version: versionMatch(expectedVersion) }, contentUpdate(content), {
        new: true,
        session,
      })
      .exec();
  }

  async deleteForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<NewsArticleDeleteResult> {
    const result = await this.model.deleteOne({ _id: id, source: 'organization', organizationId }, { session }).exec();
    return { deletedCount: result.deletedCount ?? 0 };
  }

  async listPlatform(limit: number): Promise<NewsArticleDocument[]> {
    return this.model.find({ source: 'platform' }).sort({ _id: -1 }).limit(limit).exec();
  }

  async findPlatform(id: Types.ObjectId): Promise<NewsArticleDocument | null> {
    return this.model.findOne({ _id: id, source: 'platform' }).exec();
  }

  /** CAS-правка новости платформы; null — новость не найдена или версия устарела. */
  async updatePlatform(
    id: Types.ObjectId,
    expectedVersion: number,
    content: NewsArticleContent,
    session?: ClientSession,
  ): Promise<NewsArticleDocument | null> {
    const filter = { _id: id, source: 'platform', version: versionMatch(expectedVersion) };
    return this.model.findOneAndUpdate(filter, contentUpdate(content), { new: true, session }).exec();
  }

  async deletePlatform(id: Types.ObjectId, session?: ClientSession): Promise<NewsArticleDeleteResult> {
    const result = await this.model.deleteOne({ _id: id, source: 'platform' }, { session }).exec();
    return { deletedCount: result.deletedCount ?? 0 };
  }
}
