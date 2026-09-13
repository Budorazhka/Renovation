import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

const STATUSES = ['pending', 'approved', 'rejected'] as const;

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

/**
 * N-13: query-фильтры GET /admin/realtor-reviews — тот же паттерн, что
 * ListComplaintsQueryDto/ListDuplicateCandidatesQueryDto. status без
 * явного значения от клиента — AdminRealtorReviewService дефолтит на
 * ['pending'] (очередь, реально нуждающаяся в проверке).
 */
export class ListRealtorReviewsQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit: number = DEFAULT_LIST_LIMIT;
}
