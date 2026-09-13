import { IsBoolean, IsIn, IsNumber, IsString, Length, MaxLength, Min } from 'class-validator';

export class CreateBuyerRequestDto {
  @IsIn(['buy', 'rent'])
  dealType!: 'buy' | 'rent';

  @IsString()
  @MaxLength(40)
  city!: string;

  @IsString()
  @MaxLength(40)
  propertyKind!: string;

  @IsString()
  @MaxLength(255)
  title!: string;

  @IsString()
  @MaxLength(4000)
  comment!: string;

  @IsString()
  @Length(1, 30)
  phone!: string;

  @IsNumber()
  @Min(0)
  budgetAmount!: number;

  @IsIn(['USD', 'GEL', 'RUB'])
  budgetCurrency!: 'USD' | 'GEL' | 'RUB';

  @IsBoolean()
  budgetPerMonth!: boolean;
}
