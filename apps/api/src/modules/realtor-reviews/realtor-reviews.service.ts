import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AuditService } from '../audit/audit.service';
import { CrmService } from '../crm/crm.service';
import type { DealStage } from '../crm/deal-stage';
import { OrganizationsService } from '../organizations/organizations.service';
import { RealtorReviewRepository } from './repository/realtor-review.repository';
import type { RealtorReviewDocument, RealtorReviewStatus } from './schemas/realtor-review.schema';

function toView(doc: RealtorReviewDocument) {
  return {
    id: doc._id.toString(), realtorPositionId: doc.realtorPositionId.toString(),
    rating: doc.rating, text: doc.text, createdAt: doc.createdAt.toISOString(),
  };
}

export interface AdminRealtorReviewListItem {
  id: string;
  status: RealtorReviewStatus;
  realtorPositionId: string;
  reviewerIdentityId: string;
  completedDealId: string;
  rating: number;
  text: string;
  createdAt: string;
  moderationReason: string | null;
}

function toAdminListItem(doc: RealtorReviewDocument): AdminRealtorReviewListItem {
  return {
    id: doc._id.toString(),
    status: doc.status,
    realtorPositionId: doc.realtorPositionId.toString(),
    reviewerIdentityId: doc.reviewerIdentityId.toString(),
    completedDealId: doc.completedDealId.toString(),
    rating: doc.rating,
    text: doc.text,
    createdAt: doc.createdAt.toISOString(),
    moderationReason: doc.moderationReason ?? null,
  };
}

/** Race window between the pre-check and the insert (double-click, retried request) still hits the unique index — this maps that into the same 409 the pre-check gives, instead of a raw duplicate-key 500. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

/**
 * N-13: стадии, начиная с которых сделка считается достаточно доведённой до
 * конца, чтобы отзыв о риэлторе имел смысл — `showing`/`deposit` это ещё
 * ранние переговоры, не завершённая сделка. Терминальной "успешной" стадии
 * в CRM нет вовсе (только `closed_lost` — сорвалась), поэтому это решение
 * продукта, а не факт из схемы: "договор подписан" (`deal`) и всё, что
 * дальше по воронке, — то, что можно честно назвать завершённой сделкой.
 */
const REVIEW_ELIGIBLE_DEAL_STAGES: readonly DealStage[] = ['deal', 'golden', 'check_in', 'referral'];

const PENDING_REVIEW_STATUSES: RealtorReviewStatus[] = ['pending'];

@Injectable()
export class RealtorReviewsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repository: RealtorReviewRepository,
    private readonly crmService: CrmService,
    private readonly organizationsService: OrganizationsService,
    private readonly auditService: AuditService,
  ) {}

  listApproved(positionId: Types.ObjectId, limit = 50) {
    return this.repository.listApproved(positionId, Math.min(limit, 100)).then((docs) => docs.map(toView));
  }

  /** Публичный каталог риэлторов (PublicRealtorsService) — средний рейтинг и число отзывов пачкой по positionIds. */
  getApprovedStats(positionIds: Types.ObjectId[]) {
    return this.repository.getApprovedStatsByPositionIds(positionIds);
  }

  /**
   * Проверяет, что сделка реально существует, принадлежит именно этому
   * риэлтору и доведена как минимум до подписания договора — до этой
   * правки любой `completedDealId` принимался как есть, без единой
   * проверки (см. ревью первого backend-инкремента N-13,
   * docs/operations/buyer-requests-and-reviews.md).
   *
   * Сознательно НЕ проверяет, что автор отзыва (`reviewerIdentityId`,
   * аккаунт покупателя на маркетплейсе) — тот же человек, что клиент по
   * этой сделке в CRM (`Deal.contactId`, запись, которую риэлтор вписал
   * вручную): между аккаунтом покупателя на сайте и CRM-карточкой клиента
   * сегодня нет и не может быть автоматической связи (это две разные
   * системы учёта одного и того же человека), а строить её — отдельное
   * продуктовое решение с новым полем/механизмом. Решение владельца
   * 13.09.2026: эту часть проверяет модератор глазами при рассмотрении
   * pending-отзыва (см. moderate() ниже), не код.
   */
  private async assertDealEligibleForReview(realtorPositionId: Types.ObjectId, completedDealId: Types.ObjectId): Promise<void> {
    const organizationId = await this.organizationsService.getPositionOrganizationId(realtorPositionId);
    if (!organizationId) {
      throw new NotFoundException('Realtor not found');
    }

    const deal = await this.crmService.getDealForOrganization(completedDealId, organizationId);

    if (!deal.ownerPositionId.equals(realtorPositionId)) {
      throw new BadRequestException('This deal is not owned by the specified realtor');
    }

    if (!REVIEW_ELIGIBLE_DEAL_STAGES.includes(deal.stage)) {
      throw new BadRequestException('This deal has not reached a stage eligible for a review yet');
    }
  }

  async submit(params: { reviewerIdentityId: Types.ObjectId; realtorPositionId: Types.ObjectId; completedDealId: Types.ObjectId; rating: number; text: string }) {
    await this.assertDealEligibleForReview(params.realtorPositionId, params.completedDealId);

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

  /** Admin-очередь модерации отзывов (N-13) — тот же limit+1 паттерн, что AdminDuplicateCandidateService.list. */
  async listForAdminReview(params: {
    status?: RealtorReviewStatus;
    cursor?: Types.ObjectId;
    limit: number;
  }): Promise<{ items: AdminRealtorReviewListItem[]; nextCursor: string | null }> {
    const statuses = params.status ? [params.status] : PENDING_REVIEW_STATUSES;
    const docs = await this.repository.listForReview(statuses, { cursor: params.cursor, limit: params.limit + 1 });
    const hasMore = docs.length > params.limit;
    const pageItems = hasMore ? docs.slice(0, params.limit) : docs;
    const nextCursor = hasMore ? pageItems[pageItems.length - 1]!._id.toString() : null;
    return { items: pageItems.map(toAdminListItem), nextCursor };
  }

  /**
   * Admin critical action: approve публикует отзыв (виден в listApproved),
   * reject — терминальный отказ. CAS на `status: 'pending'` в репозитории —
   * повторная модерация уже промодерированного отзыва даёт 409, не
   * перезаписывает решение.
   */
  async moderate(params: {
    reviewId: Types.ObjectId;
    decision: 'approved' | 'rejected';
    reason: string;
    moderatedByAdminId: Types.ObjectId;
    correlationId: string;
  }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const review = await this.repository.findById(params.reviewId);
      if (!review) {
        throw new NotFoundException('Review not found');
      }
      if (review.status !== 'pending') {
        throw new ConflictException(`Review status is '${review.status}', only 'pending' can be moderated`);
      }

      const { modifiedCount } = await this.repository.moderate(
        params.reviewId,
        { decision: params.decision, reason: params.reason, moderatedByAdminId: params.moderatedByAdminId },
        session,
      );
      if (modifiedCount === 0) {
        throw new ConflictException(`Review status is '${review.status}', only 'pending' can be moderated`);
      }

      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: params.moderatedByAdminId },
          action: 'review.moderate',
          resource: 'review',
          resourceId: params.reviewId,
          reason: params.reason,
          after: { status: params.decision },
          correlationId: params.correlationId,
        },
        session,
      );
    });
  }
}
