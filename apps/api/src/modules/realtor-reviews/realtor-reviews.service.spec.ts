import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RealtorReviewsService } from './realtor-reviews.service';

describe('RealtorReviewsService', () => {
  const fakeSession = {
    withTransaction: jest.fn().mockImplementation((cb) => cb(fakeSession as never)),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const fakeConnection = { startSession: jest.fn().mockResolvedValue(fakeSession) };

  function buildDeps(overrides: { organizationId?: Types.ObjectId | null; deal?: Record<string, unknown> } = {}) {
    const organizationId = overrides.organizationId === undefined ? new Types.ObjectId() : overrides.organizationId;
    const realtorPositionId = new Types.ObjectId();
    const deal = {
      _id: new Types.ObjectId(),
      organizationId,
      ownerPositionId: realtorPositionId,
      stage: 'deal',
      ...overrides.deal,
    };
    const organizationsService = { getPositionOrganizationId: jest.fn().mockResolvedValue(organizationId) };
    const crmService = { getDealForOrganization: jest.fn().mockResolvedValue(deal) };
    const auditService = { append: jest.fn().mockResolvedValue(undefined) };
    return { organizationsService, crmService, auditService, realtorPositionId, deal };
  }

  function buildService(repository: unknown, crmService: unknown, organizationsService: unknown, auditService: unknown = { append: jest.fn() }) {
    return new RealtorReviewsService(fakeConnection as never, repository as never, crmService as never, organizationsService as never, auditService as never);
  }

  it('не публикует отзыв сразу: новый отзыв получает pending', async () => {
    const id = new Types.ObjectId();
    const { organizationsService, crmService, realtorPositionId } = buildDeps();
    const repository = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: id, status: 'pending' }),
    };
    const service = buildService(repository, crmService, organizationsService);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 5, text: 'Отлично' })).resolves.toEqual({ id: id.toString(), status: 'pending' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  it('запрещает второй отзыв по той же сделке и риэлтору', async () => {
    const { organizationsService, crmService, realtorPositionId } = buildDeps();
    const repository = { findDuplicate: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const service = buildService(repository, crmService, organizationsService);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 4, text: 'Повтор' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('гонка на вставке (findDuplicate ещё не увидел конкурента) даёт 409, а не сырую ошибку дубль-ключа', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const { organizationsService, crmService, realtorPositionId } = buildDeps();
    const repository = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(duplicateKeyError),
    };
    const service = buildService(repository, crmService, organizationsService);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 4, text: 'Гонка' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('прочие ошибки create пробрасываются как есть, не превращаются в ConflictException', async () => {
    const { organizationsService, crmService, realtorPositionId } = buildDeps();
    const repository = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(new Error('connection lost')),
    };
    const service = buildService(repository, crmService, organizationsService);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 4, text: 'Сбой' })).rejects.toThrow('connection lost');
  });

  describe('assertDealEligibleForReview: сделка проверяется у CRM (N-13)', () => {
    it('позиция риэлтора не существует — NotFoundException, отзыв не создаётся', async () => {
      const { crmService } = buildDeps();
      const organizationsService = { getPositionOrganizationId: jest.fn().mockResolvedValue(null) };
      const repository = { findDuplicate: jest.fn(), create: jest.fn() };
      const service = buildService(repository, crmService, organizationsService);
      await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId: new Types.ObjectId(), completedDealId: new Types.ObjectId(), rating: 5, text: 'X' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('сделка не найдена (или чужой организации) — пробрасывает NotFoundException CrmService, отзыв не создаётся', async () => {
      const { organizationsService, realtorPositionId } = buildDeps();
      const crmService = { getDealForOrganization: jest.fn().mockRejectedValue(new NotFoundException('Deal not found')) };
      const repository = { findDuplicate: jest.fn(), create: jest.fn() };
      const service = buildService(repository, crmService, organizationsService);
      await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 5, text: 'X' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('сделка принадлежит другому риэлтору — BadRequestException, отзыв не создаётся', async () => {
      const otherPositionId = new Types.ObjectId();
      const { organizationsService, crmService, realtorPositionId } = buildDeps({ deal: { ownerPositionId: otherPositionId } });
      const repository = { findDuplicate: jest.fn(), create: jest.fn() };
      const service = buildService(repository, crmService, organizationsService);
      await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 5, text: 'X' })).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each(['showing', 'deposit', 'closed_lost'])('сделка на стадии %s ещё не даёт оставить отзыв — BadRequestException', async (stage) => {
      const { organizationsService, crmService, realtorPositionId } = buildDeps({ deal: { stage } });
      const repository = { findDuplicate: jest.fn(), create: jest.fn() };
      const service = buildService(repository, crmService, organizationsService);
      await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 5, text: 'X' })).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each(['deal', 'golden', 'check_in', 'referral'])('сделка на стадии %s — договор подписан или дальше, отзыв создаётся', async (stage) => {
      const id = new Types.ObjectId();
      const { organizationsService, crmService, realtorPositionId } = buildDeps({ deal: { stage } });
      const repository = {
        findDuplicate: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ _id: id, status: 'pending' }),
      };
      const service = buildService(repository, crmService, organizationsService);
      await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId, completedDealId: new Types.ObjectId(), rating: 5, text: 'X' })).resolves.toEqual({ id: id.toString(), status: 'pending' });
    });
  });

  describe('listForAdminReview: очередь модерации (N-13)', () => {
    it('без явного статуса показывает только pending, limit+1 обрезается в nextCursor', async () => {
      const { organizationsService, crmService } = buildDeps();
      const docs = [0, 1].map(() => ({
        _id: new Types.ObjectId(), status: 'pending', realtorPositionId: new Types.ObjectId(),
        reviewerIdentityId: new Types.ObjectId(), completedDealId: new Types.ObjectId(),
        rating: 5, text: 'X', createdAt: new Date('2026-09-13T00:00:00Z'), moderationReason: undefined,
      }));
      const repository = { listForReview: jest.fn().mockResolvedValue(docs) };
      const service = buildService(repository, crmService, organizationsService);
      const result = await service.listForAdminReview({ limit: 1 });
      expect(repository.listForReview).toHaveBeenCalledWith(['pending'], expect.objectContaining({ limit: 2 }));
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(docs[0]!._id.toString());
    });
  });

  describe('moderate: admin решает pending-отзыв (N-13)', () => {
    it('отзыв не найден — NotFoundException, аудит не пишется', async () => {
      const { organizationsService, crmService, auditService } = buildDeps();
      const repository = { findById: jest.fn().mockResolvedValue(null), moderate: jest.fn() };
      const service = buildService(repository, crmService, organizationsService, auditService);
      await expect(service.moderate({ reviewId: new Types.ObjectId(), decision: 'approved', reason: 'Проверено, всё ок', moderatedByAdminId: new Types.ObjectId(), correlationId: 'cor-1' })).rejects.toBeInstanceOf(NotFoundException);
      expect(auditService.append).not.toHaveBeenCalled();
    });

    it('отзыв уже промодерирован — ConflictException, повторно не перезаписывает', async () => {
      const { organizationsService, crmService, auditService } = buildDeps();
      const repository = {
        findById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), status: 'approved' }),
        moderate: jest.fn(),
      };
      const service = buildService(repository, crmService, organizationsService, auditService);
      await expect(service.moderate({ reviewId: new Types.ObjectId(), decision: 'rejected', reason: 'Повторно', moderatedByAdminId: new Types.ObjectId(), correlationId: 'cor-2' })).rejects.toBeInstanceOf(ConflictException);
      expect(repository.moderate).not.toHaveBeenCalled();
      expect(auditService.append).not.toHaveBeenCalled();
    });

    it('approve — статус меняется, пишется аудит с action review.moderate', async () => {
      const { organizationsService, crmService, auditService } = buildDeps();
      const reviewId = new Types.ObjectId();
      const adminId = new Types.ObjectId();
      const repository = {
        findById: jest.fn().mockResolvedValue({ _id: reviewId, status: 'pending' }),
        moderate: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      const service = buildService(repository, crmService, organizationsService, auditService);
      await service.moderate({ reviewId, decision: 'approved', reason: 'Клиент подтвердил сделку', moderatedByAdminId: adminId, correlationId: 'cor-3' });
      expect(repository.moderate).toHaveBeenCalledWith(reviewId, expect.objectContaining({ decision: 'approved' }), fakeSession);
      expect(auditService.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'review.moderate', resource: 'review', resourceId: reviewId, after: { status: 'approved' } }),
        fakeSession,
      );
    });
  });
});
