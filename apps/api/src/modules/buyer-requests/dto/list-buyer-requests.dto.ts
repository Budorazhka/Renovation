import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class ListBuyerRequestsDto {
  @IsOptional()
  @Matches(/^[a-f\d]{24}$/i)
  cursor?: string;

  @IsOptional()
  @IsIn(['buy', 'rent'])
  dealType?: 'buy' | 'rent';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  propertyKind?: string;
}
