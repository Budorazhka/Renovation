import {
  IsOptional,
  IsString,
  IsMongoId,
  IsIn,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyAmountDto } from '../../developments/dto/money-amount.dto';
import { DEAL_TYPES, type DealType } from '../../crm/deal-type';

export class ConvertBookingToDealDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @IsOptional()
  @IsIn(DEAL_TYPES)
  dealType?: DealType;

  @IsOptional()
  @IsMongoId()
  installmentPlanId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyAmountDto)
  downPayment?: MoneyAmountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyAmountDto)
  expectedCommission?: MoneyAmountDto;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}
