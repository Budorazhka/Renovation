import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { LibraryFolderDocument } from '../schemas/library-folder.schema';

export interface CreateLibraryFolderParams {
  organizationId: Types.ObjectId;
  ownerPositionId: Types.ObjectId;
  name: string;
  parentId?: Types.ObjectId;
}

export interface LibraryFolderDeleteResult {
  deletedCount: number;
}

/** Папки личной библиотеки. Каждый запрос фильтруется по {organizationId, ownerPositionId} (tenant-scope.test.ts). */
@Injectable()
export class LibraryFolderRepository {
  constructor(@InjectModel(LibraryFolderDocument.name) private readonly model: Model<LibraryFolderDocument>) {}

  async create(params: CreateLibraryFolderParams, session?: ClientSession): Promise<LibraryFolderDocument> {
    const docData: Record<string, unknown> = {
      organizationId: params.organizationId,
      ownerPositionId: params.ownerPositionId,
      name: params.name,
    };
    if (params.parentId !== undefined) docData.parentId = params.parentId;

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  async findByIdForOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
  ): Promise<LibraryFolderDocument | null> {
    return this.model.findOne({ _id: id, organizationId, ownerPositionId }).exec();
  }

  /** Папки на одном уровне; parentId null — корень (null совпадает и с отсутствующим полем). */
  async listForOwner(
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
    parentId: Types.ObjectId | null,
  ): Promise<LibraryFolderDocument[]> {
    return this.model.find({ organizationId, ownerPositionId, parentId }).sort({ name: 1 }).exec();
  }

  async countChildren(
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
    parentId: Types.ObjectId,
  ): Promise<number> {
    return this.model.countDocuments({ organizationId, ownerPositionId, parentId }).exec();
  }

  async deleteForOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LibraryFolderDeleteResult> {
    const result = await this.model.deleteOne({ _id: id, organizationId, ownerPositionId }, { session }).exec();
    return { deletedCount: result.deletedCount ?? 0 };
  }
}
