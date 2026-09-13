import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AdminContext } from '../../shared/admin/admin-context';
import { RealtorReviewsService, type AdminRealtorReviewListItem } from '../realtor-reviews/realtor-reviews.service';
import type { RealtorReviewStatus } from '../realtor-reviews/schemas/realtor-review.schema';
import { AdminPolicyService } from './admin-policy.service';

/**
 * N-13 (permission-matrix.md разд.2.2 «Модератор отзывов»:
 * `review.moderate.global`; docs/operations/buyer-requests-and-reviews.md).
 * Тот же паттерн, что AdminDuplicateCandidateService: AdminGuard на
 * контроллере — только аутентификация Admin-актора, permission-проверка
 * (resource:'review', action:'moderate', global scope — отзыв не привязан
 * к городу как первичному измерению, в отличие от жалоб на листинги)
 * выполняется explicit-вызовом здесь, в service-слое.
 */
@Injectable()
export class AdminRealtorReviewService {
  constructor(
    private readonly realtorReviewsService: RealtorReviewsService,
    private readonly adminPolicy: AdminPolicyService,
  ) {}

  async list(
    adminContext: AdminContext,
    params: { status?: RealtorReviewStatus; cursor?: string; limit: number },
  ): Promise<{ items: AdminRealtorReviewListItem[]; nextCursor: string | null }> {
    await this.adminPolicy.requireGrant({ adminContext, resource: 'review', action: 'moderate' });

    return this.realtorReviewsService.listForAdminReview({
      status: params.status,
      cursor: params.cursor ? new Types.ObjectId(params.cursor) : undefined,
      limit: params.limit,
    });
  }

  async moderate(
    adminContext: AdminContext,
    params: { reviewId: Types.ObjectId; decision: 'approved' | 'rejected'; reason: string; correlationId: string },
  ): Promise<void> {
    this.adminPolicy.requireReason(params.reason);
    await this.adminPolicy.requireGrant({ adminContext, resource: 'review', action: 'moderate' });

    await this.realtorReviewsService.moderate({
      reviewId: params.reviewId,
      decision: params.decision,
      reason: params.reason,
      moderatedByAdminId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: params.correlationId,
    });
  }
}
