import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RealtorReviewsService } from './realtor-reviews.service';

describe('RealtorReviewsService', () => {
  it('не публикует отзыв сразу: новый отзыв получает pending', async () => {
    const id = new Types.ObjectId();
    const repository = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: id, status: 'pending' }),
    };
    const service = new RealtorReviewsService(repository as never);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId: new Types.ObjectId(), completedDealId: new Types.ObjectId(), rating: 5, text: 'Отлично' })).resolves.toEqual({ id: id.toString(), status: 'pending' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  it('запрещает второй отзыв по той же сделке и риэлтору', async () => {
    const repository = { findDuplicate: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const service = new RealtorReviewsService(repository as never);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId: new Types.ObjectId(), completedDealId: new Types.ObjectId(), rating: 4, text: 'Повтор' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('гонка на вставке (findDuplicate ещё не увидел конкурента) даёт 409, а не сырую ошибку дубль-ключа', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const repository = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(duplicateKeyError),
    };
    const service = new RealtorReviewsService(repository as never);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId: new Types.ObjectId(), completedDealId: new Types.ObjectId(), rating: 4, text: 'Гонка' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('прочие ошибки create пробрасываются как есть, не превращаются в ConflictException', async () => {
    const repository = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(new Error('connection lost')),
    };
    const service = new RealtorReviewsService(repository as never);
    await expect(service.submit({ reviewerIdentityId: new Types.ObjectId(), realtorPositionId: new Types.ObjectId(), completedDealId: new Types.ObjectId(), rating: 4, text: 'Сбой' })).rejects.toThrow('connection lost');
  });
});
