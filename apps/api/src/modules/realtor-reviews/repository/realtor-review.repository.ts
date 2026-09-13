import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RealtorReviewDocument, type RealtorReviewStatus } from '../schemas/realtor-review.schema';

interface CreateRealtorReviewData {
  reviewerIdentityId: Types.ObjectId;
  realtorPositionId: Types.ObjectId;
  completedDealId: Types.ObjectId;
  rating: number;
  text: string;
  status: RealtorReviewStatus;
}

@Injectable()
export class RealtorReviewRepository {
  constructor(@InjectModel(RealtorReviewDocument.name) private readonly model: Model<RealtorReviewDocument>) {}
  async create(data: CreateRealtorReviewData): Promise<RealtorReviewDocument> {
    const [doc] = await this.model.create([data]); return doc!;
  }
  async listApproved(positionId: Types.ObjectId, limit: number): Promise<RealtorReviewDocument[]> {
    return this.model.find({ realtorPositionId: positionId, status: 'approved' as RealtorReviewStatus }).sort({ createdAt: -1 }).limit(limit).exec();
  }
  async findDuplicate(reviewerIdentityId: Types.ObjectId, completedDealId: Types.ObjectId, realtorPositionId: Types.ObjectId) {
    return this.model.findOne({ reviewerIdentityId, completedDealId, realtorPositionId }).exec();
  }
}
