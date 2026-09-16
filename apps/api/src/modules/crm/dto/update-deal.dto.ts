import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DEAL_TYPES, type DealType } from '../deal-type';
import { MoneyAmountDto } from './money-amount.dto';

/**
 * НЕ содержит ownerPositionId — смена владельца сделки ТОЛЬКО через
 * PATCH /deals/:dealId/reassign (client.reassign — отдельный action от
 * deal.edit, см. CrmService.updateDeal/reassignDeal докстринги, тот же
 * принцип, что уже применён к UpdateTaskDto/task.reassign).
 */
export class UpdateDealDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyAmountDto)
  expectedCommission?: MoneyAmountDto;

  /** Меняется, пока BAZA не отметила пришедшую комиссию; после отметки — DEAL_TYPE_LOCKED. */
  @IsOptional()
  @IsIn(DEAL_TYPES)
  dealType?: DealType;
}
