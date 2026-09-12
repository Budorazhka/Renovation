import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { OrganizationDocument, type OrganizationType } from '../schemas/organization.schema';

/**
 * Единственная точка доступа к коллекции organizations (ADR-002 требование 2).
 */
@Injectable()
export class OrganizationRepository {
  constructor(
    @InjectModel(OrganizationDocument.name) private readonly model: Model<OrganizationDocument>,
  ) {}

  async create(
    params: { type: OrganizationType; name: string },
    session?: ClientSession,
  ): Promise<OrganizationDocument> {
    const [doc] = await this.model.create([{ type: params.type, name: params.name }], { session });
    return doc!;
  }

  async findById(id: Types.ObjectId): Promise<OrganizationDocument | null> {
    return this.model.findById(id).exec();
  }

  /**
   * Пакетное чтение публичных полей: id, название, тип.
   *
   * Нужно публичному каталогу, который показывает имя застройщика или
   * агентства рядом с объектом. Отдельный метод, а не findById в цикле —
   * иначе страница из 20 карточек стоила бы 20 запросов.
   *
   * `select` не для оптимизации, а как граница: публичный контур не должен
   * получать документ организации целиком, даже если вызывающий код собирался
   * взять оттуда одно поле.
   */
  async findPublicByIds(
    ids: Types.ObjectId[],
  ): Promise<Array<{ id: Types.ObjectId; name: string; type: OrganizationType }>> {
    if (ids.length === 0) return [];
    const docs = await this.model
      .find({ _id: { $in: ids } })
      .select('_id name type')
      .exec();
    return docs.map((doc) => ({ id: doc._id, name: doc.name, type: doc.type }));
  }

  async list(params: {
    type?: OrganizationType;
    status?: string;
    search?: string;
    cursor?: Types.ObjectId;
    limit: number;
  }): Promise<OrganizationDocument[]> {
    const filter: Record<string, unknown> = {};
    if (params.cursor) {
      filter._id = { $gt: params.cursor };
    }
    if (params.type) {
      filter.type = params.type;
    }
    if (params.status) {
      filter.status = params.status;
    }
    if (params.search?.trim()) {
      filter.name = { $regex: params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    return this.model
      .find(filter)
      .sort({ _id: 1 })
      .limit(params.limit)
      .exec();
  }

  async updateStatus(
    id: Types.ObjectId,
    status: OrganizationDocument['status'],
    session?: ClientSession,
  ): Promise<OrganizationDocument | null> {
    return this.model
      .findByIdAndUpdate(id, { $set: { status } }, { new: true, session })
      .exec();
  }

  /** N-10: смена флага верификации MLS-биржи (см. докстринг поля в схеме). */
  async updateMlsVerified(
    id: Types.ObjectId,
    mlsVerified: boolean,
    session?: ClientSession,
  ): Promise<OrganizationDocument | null> {
    return this.model
      .findByIdAndUpdate(id, { $set: { mlsVerified } }, { new: true, session })
      .exec();
  }
}
