import { Types } from 'mongoose';
import { AdminRealtorReviewService } from './admin-realtor-review.service';
import type { AdminContext } from '../../shared/admin/admin-context';
import type { RealtorReviewsService } from '../realtor-reviews/realtor-reviews.service';
import type { AdminPolicyService } from './admin-policy.service';

function makeAdminContext(overrides: Partial<AdminContext> = {}): AdminContext {
  return {
    identityId: new Types.ObjectId().toString(),
    adminAccountId: new Types.ObjectId().toString(),
    isSuperAdmin: false,
    ...overrides,
  };
}

describe('AdminRealtorReviewService.list', () => {
  it('требует grant review.moderate перед вызовом RealtorReviewsService', async () => {
    const requireGrantSpy = jest.fn().mockResolvedValue(undefined);
    const listForAdminReviewSpy = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const service = new AdminRealtorReviewService(
      { listForAdminReview: listForAdminReviewSpy } as unknown as RealtorReviewsService,
      { requireGrant: requireGrantSpy } as unknown as AdminPolicyService,
    );

    await service.list(makeAdminContext(), { limit: 20 });

    expect(requireGrantSpy).toHaveBeenCalledWith({ adminContext: expect.anything(), resource: 'review', action: 'moderate' });
  });

  it('cursor конвертируется в ObjectId, статус и limit пробрасываются как есть', async () => {
    const listForAdminReviewSpy = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const service = new AdminRealtorReviewService(
      { listForAdminReview: listForAdminReviewSpy } as unknown as RealtorReviewsService,
      { requireGrant: jest.fn().mockResolvedValue(undefined) } as unknown as AdminPolicyService,
    );
    const cursor = new Types.ObjectId();

    await service.list(makeAdminContext(), { status: 'approved', cursor: cursor.toString(), limit: 10 });

    const call = listForAdminReviewSpy.mock.calls[0][0] as { status: string; cursor: Types.ObjectId; limit: number };
    expect(call.status).toBe('approved');
    expect(call.limit).toBe(10);
    expect(call.cursor.equals(cursor)).toBe(true);
  });
});

describe('AdminRealtorReviewService.moderate', () => {
  it('требует reason и grant review.moderate перед вызовом RealtorReviewsService.moderate', async () => {
    const adminContext = makeAdminContext();
    const requireReasonSpy = jest.fn();
    const requireGrantSpy = jest.fn().mockResolvedValue(undefined);
    const moderateSpy = jest.fn().mockResolvedValue(undefined);
    const reviewId = new Types.ObjectId();

    const service = new AdminRealtorReviewService(
      { moderate: moderateSpy } as unknown as RealtorReviewsService,
      { requireReason: requireReasonSpy, requireGrant: requireGrantSpy } as unknown as AdminPolicyService,
    );

    await service.moderate(adminContext, { reviewId, decision: 'approved', reason: 'Клиент подтвердил сделку', correlationId: 'corr-1' });

    expect(requireReasonSpy).toHaveBeenCalledWith('Клиент подтвердил сделку');
    expect(requireGrantSpy).toHaveBeenCalledWith({ adminContext, resource: 'review', action: 'moderate' });
    expect(moderateSpy).toHaveBeenCalledWith({
      reviewId,
      decision: 'approved',
      reason: 'Клиент подтвердил сделку',
      moderatedByAdminId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: 'corr-1',
    });
  });
});
