import { IsArray, IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

/** N-27: то же, что CreateSelectionDto — хотя бы один из unitIds/listingIds непуст. */
export class AddSelectionItemsDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  unitIds?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  listingIds?: string[];
}
