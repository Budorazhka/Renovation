import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DEAL_STAGES, type DealStage } from '../deal-stage';
import { DEAL_TYPES, type DealType } from '../deal-type';
import { MoneyAmountDto } from './money-amount.dto';

export class CreateDealParticipantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  role!: string;

  @IsMongoId()
  contactId!: string;
}

export class CreateDealChecklistItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  label!: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class CreateDealDto {
  @IsMongoId()
  contactId!: string;

  @IsOptional()
  @IsMongoId()
  ownerPositionId?: string;

  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(DEAL_STAGES)
  stage?: DealStage;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyAmountDto)
  expectedCommission?: MoneyAmountDto;

  /** Первичка, вторичка, аренда, переуступка; по умолчанию вторичка. Куратору 7% идут только с первички. */
  @IsOptional()
  @IsIn(DEAL_TYPES)
  dealType?: DealType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDealParticipantDto)
  participants?: CreateDealParticipantDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDealChecklistItemDto)
  checklistItems?: CreateDealChecklistItemDto[];
}
