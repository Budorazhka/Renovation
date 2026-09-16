import { IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateCommissionRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  partnerType!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercent!: number;
}
