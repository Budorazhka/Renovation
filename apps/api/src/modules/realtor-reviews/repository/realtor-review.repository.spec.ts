import { Types } from 'mongoose';
import { RealtorReviewRepository } from './realtor-review.repository';

describe('RealtorReviewRepository.getApprovedStatsByPositionIds (N-13)', () => {
  it('пустой массив id — не бьёт в базу, возвращает пустую карту', async () => {
    const aggregateSpy = jest.fn();
    const repository = new RealtorReviewRepository({ aggregate: aggregateSpy } as never);

    const result = await repository.getApprovedStatsByPositionIds([]);

    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('фильтрует по approved и заданным positionIds, группирует по realtorPositionId', async () => {
    const positionId = new Types.ObjectId();
    const aggregateSpy = jest.fn().mockResolvedValue([{ _id: positionId, averageRating: 4.5, reviewCount: 2 }]);
    const repository = new RealtorReviewRepository({ aggregate: aggregateSpy } as never);

    const result = await repository.getApprovedStatsByPositionIds([positionId]);

    const pipeline = aggregateSpy.mock.calls[0][0];
    expect(pipeline[0].$match).toEqual({ realtorPositionId: { $in: [positionId] }, status: 'approved' });
    expect(result.get(positionId.toString())).toEqual({ averageRating: 4.5, reviewCount: 2 });
  });
});
