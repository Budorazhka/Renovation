import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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

  async findById(id: Types.ObjectId): Promise<RealtorReviewDocument | null> {
    return this.model.findById(id).exec();
  }

  /**
   * N-13 (публичный каталог риэлторов, 14.09.2026): средний рейтинг и
   * количество — только по `approved`, тот же принцип видимости, что
   * listApproved. Пачкой по positionIds — страница каталога не должна
   * стоить N агрегаций.
   */
  async getApprovedStatsByPositionIds(
    positionIds: Types.ObjectId[],
  ): Promise<Map<string, { averageRating: number; reviewCount: number }>> {
    if (positionIds.length === 0) return new Map();
    const rows = await this.model.aggregate([
      { $match: { realtorPositionId: { $in: positionIds }, status: 'approved' } },
      { $group: { _id: '$realtorPositionId', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
    ]);
    return new Map(
      rows.map((row) => [row._id.toString(), { averageRating: row.averageRating as number, reviewCount: row.reviewCount as number }]),
    );
  }

  /** N-13: admin-очередь модерации — тот же `_id`-курсор, что DuplicateCandidateRepository.listForReview. */
  async listForReview(statuses: RealtorReviewStatus[], params: { cursor?: Types.ObjectId; limit: number }): Promise<RealtorReviewDocument[]> {
    const filter: Record<string, unknown> = { status: { $in: statuses } };
    if (params.cursor) filter._id = { $gt: params.cursor };
    return this.model.find(filter).sort({ _id: 1 }).limit(params.limit).exec();
  }

  /**
   * Admin critical action: CAS-фильтр `status: 'pending'` — только pending
   * можно промодерировать, тот же принцип, что ComplaintRepository.resolve
   * (в отличие от DuplicateCandidateRepository.markConfirmedDuplicate, здесь
   * нет "отменить прошлое решение" сценария — approved/rejected терминальны).
   */
  async moderate(
    id: Types.ObjectId,
    params: { decision: 'approved' | 'rejected'; reason: string; moderatedByAdminId: Types.ObjectId },
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, status: 'pending' },
        { $set: { status: params.decision, moderationReason: params.reason, moderatedByAdminId: params.moderatedByAdminId } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }
}
