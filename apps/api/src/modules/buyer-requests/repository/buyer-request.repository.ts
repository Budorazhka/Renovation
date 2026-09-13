import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BuyerRequestDocument, type BuyerRequestDealType, type BuyerRequestStatus } from '../schemas/buyer-request.schema';

interface CreateBuyerRequestData {
  authorIdentityId: Types.ObjectId;
  dealType: BuyerRequestDealType;
  city: string;
  propertyKind: string;
  title: string;
  comment: string;
  phone: string;
  budgetAmount: number;
  budgetCurrency: string;
  budgetPerMonth: boolean;
  status: BuyerRequestStatus;
}

@Injectable()
export class BuyerRequestRepository {
  constructor(@InjectModel(BuyerRequestDocument.name) private readonly model: Model<BuyerRequestDocument>) {}

  async create(data: CreateBuyerRequestData, session?: ClientSession): Promise<BuyerRequestDocument> {
    const [doc] = await this.model.create([data], { session });
    return doc!;
  }

  async listPublic(params: {
    cursor?: Types.ObjectId;
    limit: number;
    dealType?: BuyerRequestDealType;
    city?: string;
    propertyKind?: string;
  }): Promise<BuyerRequestDocument[]> {
    const filter: Record<string, unknown> = { status: 'published' as BuyerRequestStatus };
    if (params.cursor) filter._id = { $lt: params.cursor };
    if (params.dealType) filter.dealType = params.dealType;
    if (params.city) filter.city = params.city;
    if (params.propertyKind) filter.propertyKind = params.propertyKind;
    // Cursor and ordering use the same immutable key. ObjectId creation time
    // gives the board newest-first ordering without the skip/duplicate risk of
    // filtering only by `_id` while sorting by a different field.
    return this.model.find(filter).sort({ _id: -1 }).limit(params.limit).exec();
  }

  /** Own requests across all statuses — the only way a buyer can find the id of a request to close after leaving the create-response page. */
  async listForAuthor(authorIdentityId: Types.ObjectId): Promise<BuyerRequestDocument[]> {
    return this.model.find({ authorIdentityId }).sort({ createdAt: -1 }).limit(100).exec();
  }

  /** N-13: plain lookup for the ERP respond-flow, which needs to check status regardless of who authored the request — the board is public, not tenant-scoped, so no org filter applies here. */
  async findById(id: Types.ObjectId): Promise<BuyerRequestDocument | null> {
    return this.model.findById(id).exec();
  }

  async findByIdForAuthor(id: Types.ObjectId, authorIdentityId: Types.ObjectId): Promise<BuyerRequestDocument | null> {
    return this.model.findOne({ _id: id, authorIdentityId }).exec();
  }

  async close(id: Types.ObjectId, authorIdentityId: Types.ObjectId): Promise<BuyerRequestDocument | null> {
    return this.model.findOneAndUpdate(
      { _id: id, authorIdentityId, status: 'published' },
      { $set: { status: 'closed' } },
      { new: true },
    ).exec();
  }
}
