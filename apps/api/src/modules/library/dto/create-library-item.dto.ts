import { IsIn, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  LIBRARY_PRODUCT_TYPES,
  LIBRARY_SCOPES,
  type LibraryProductType,
  type LibraryScope,
} from '../schemas/library-item.schema';

/**
 * POST /library/items. Файл загружается заранее через POST /media/upload-intent
 * с purpose `library_file` и подтверждается; сюда приходит ссылка на asset и
 * имя для экрана. productType — только у общих материалов, folderId — только
 * у личных.
 */
export class CreateLibraryItemDto {
  @IsIn(LIBRARY_SCOPES)
  scope!: LibraryScope;

  @IsMongoId()
  assetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsIn(LIBRARY_PRODUCT_TYPES)
  productType?: LibraryProductType;

  @IsOptional()
  @IsMongoId()
  folderId?: string;
}
