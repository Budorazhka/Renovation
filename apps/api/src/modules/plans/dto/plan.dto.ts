import { IsIn, IsInt, IsMongoId, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Месяц `YYYY-MM`. */
export const PLAN_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Те же валюты, что у цен объектов и подписок. */
export const PLAN_CURRENCIES = ['USD', 'GEL', 'RUB'] as const;

/** GET /plans?period=YYYY-MM и GET /plans/progress?period=YYYY-MM&positionId= */
export class PlanPeriodQueryDto {
  @Matches(PLAN_PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsOptional()
  @IsMongoId()
  positionId?: string;
}

/** PUT /plans/:positionId/:period — полный набор целей; expectedVersion обязателен, если план уже есть. */
export class UpsertPlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  revenueTargetMinorUnits!: number;

  @IsIn(PLAN_CURRENCIES)
  currency!: (typeof PLAN_CURRENCIES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  leadsTarget!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  dealsTarget!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  callsTarget!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  meetingsTarget!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  showingsTarget!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
