import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMarketplaceSelectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}
