import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BuyerRequestResponseDocument } from '../schemas/buyer-request-response.schema';

@Injectable()
export class BuyerRequestResponseRepository {
  constructor(@InjectModel(BuyerRequestResponseDocument.name) private readonly model: Model<BuyerRequestResponseDocument>) {}

  /**
   * Atomic upsert by {buyerRequestId, organizationId} — revising a message
   * (double submit, editing the pitch) updates the same record instead of
   * racing a check-then-insert against the unique index below.
   */
  async upsert(params: {
    buyerRequestId: Types.ObjectId;
    organizationId: Types.ObjectId;
    respondedByPositionId: Types.ObjectId;
    message: string;
  }): Promise<BuyerRequestResponseDocument> {
    return this.model
      .findOneAndUpdate(
        { buyerRequestId: params.buyerRequestId, organizationId: params.organizationId },
        { $set: { respondedByPositionId: params.respondedByPositionId, message: params.message } },
        { new: true, upsert: true },
      )
      .exec();
  }

  async listForOrganization(
    organizationId: Types.ObjectId,
    params: { cursor?: Types.ObjectId; limit: number },
  ): Promise<BuyerRequestResponseDocument[]> {
    const filter: Record<string, unknown> = { organizationId };
    if (params.cursor) filter._id = { $lt: params.cursor };
    return this.model.find(filter).sort({ _id: -1 }).limit(params.limit).exec();
  }
}
