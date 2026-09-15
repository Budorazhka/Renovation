import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { LibraryItemDocument, type LibraryProductType, type LibraryScope } from '../schemas/library-item.schema';

export interface CreateLibraryItemParams {
  organizationId: Types.ObjectId;
  scope: LibraryScope;
  ownerPositionId?: Types.ObjectId;
  productType?: LibraryProductType;
  folderId?: Types.ObjectId;
  assetId: Types.ObjectId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdByPositionId: Types.ObjectId;
}

/** Именованные типы результатов — инлайн-`{...}` в Promise<{...}> ломает разбор сигнатуры в tenant-scope.test.ts (см. NoteRepository). */
export interface LibraryItemDeleteResult {
  deletedCount: number;
}

/**
 * Материалы библиотеки. Каждый запрос фильтруется по organizationId прямо в
 * теле метода (tenant-scope.test.ts); личные материалы — ещё и по
 * ownerPositionId, общие — по scope 'organization'.
 */
@Injectable()
export class LibraryItemRepository {
  constructor(@InjectModel(LibraryItemDocument.name) private readonly model: Model<LibraryItemDocument>) {}

  async create(params: CreateLibraryItemParams, session?: ClientSession): Promise<LibraryItemDocument> {
    const docData: Record<string, unknown> = {
      organizationId: params.organizationId,
      scope: params.scope,
      assetId: params.assetId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      createdByPositionId: params.createdByPositionId,
    };
    if (params.ownerPositionId !== undefined) docData.ownerPositionId = params.ownerPositionId;
    if (params.productType !== undefined) docData.productType = params.productType;
    if (params.folderId !== undefined) docData.folderId = params.folderId;

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  async findByIdForOrganization(id: Types.ObjectId, organizationId: Types.ObjectId): Promise<LibraryItemDocument | null> {
    return this.model.findOne({ _id: id, organizationId }).exec();
  }

  /** Общие материалы организации; с productType — материалы этого продукта плюс материалы без продукта (для всех). */
  async listOrganization(
    organizationId: Types.ObjectId,
    productType: LibraryProductType | undefined,
    limit: number,
  ): Promise<LibraryItemDocument[]> {
    const filter: FilterQuery<LibraryItemDocument> = { organizationId, scope: 'organization' };
    if (productType) {
      filter.productType = { $in: [productType, null] };
    }
    return this.model.find(filter).sort({ _id: -1 }).limit(limit).exec();
  }

  /** Личные материалы в папке; folderId null — корень (null совпадает и с отсутствующим полем). */
  async listPersonal(
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
    folderId: Types.ObjectId | null,
    limit: number,
  ): Promise<LibraryItemDocument[]> {
    return this.model
      .find({ organizationId, scope: 'personal', ownerPositionId, folderId })
      .sort({ _id: -1 })
      .limit(limit)
      .exec();
  }

  async countInFolder(
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
    folderId: Types.ObjectId,
  ): Promise<number> {
    return this.model.countDocuments({ organizationId, scope: 'personal', ownerPositionId, folderId }).exec();
  }

  async deleteForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LibraryItemDeleteResult> {
    const result = await this.model.deleteOne({ _id: id, organizationId }, { session }).exec();
    return { deletedCount: result.deletedCount ?? 0 };
  }
}
