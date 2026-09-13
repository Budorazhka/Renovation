import { ConflictException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { RealtorReviewRepository } from './repository/realtor-review.repository';
import type { RealtorReviewDocument } from './schemas/realtor-review.schema';

function toView(doc: RealtorReviewDocument) {
  return {
    id: doc._id.toString(), realtorPositionId: doc.realtorPositionId.toString(),
    rating: doc.rating, text: doc.text, createdAt: doc.createdAt.toISOString(),
  };
}

/** Race window between the pre-check and the insert (double-click, retried request) still hits the unique index — this maps that into the same 409 the pre-check gives, instead of a raw duplicate-key 500. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

@Injectable()
export class RealtorReviewsService {
  constructor(private readonly repository: RealtorReviewRepository) {}

  listApproved(positionId: Types.ObjectId, limit = 50) {
    return this.repository.listApproved(positionId, Math.min(limit, 100)).then((docs) => docs.map(toView));
  }

  async submit(params: { reviewerIdentityId: Types.ObjectId; realtorPositionId: Types.ObjectId; completedDealId: Types.ObjectId; rating: number; text: string }) {
    const duplicate = await this.repository.findDuplicate(params.reviewerIdentityId, params.completedDealId, params.realtorPositionId);
    if (duplicate) throw new ConflictException('A review for this completed deal already exists');
    // The deal id is mandatory and the review remains pending until moderation.
    // A later CRM verifier can reject a forged/non-completed deal without ever
    // exposing it in the public projection.
    try {
      const doc = await this.repository.create({ ...params, status: 'pending' });
      return { id: doc._id.toString(), status: doc.status };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A review for this completed deal already exists');
      }
      throw error;
    }
  }
}
