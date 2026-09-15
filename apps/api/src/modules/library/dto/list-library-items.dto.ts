import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import {
  LIBRARY_PRODUCT_TYPES,
  LIBRARY_SCOPES,
  type LibraryProductType,
  type LibraryScope,
} from '../schemas/library-item.schema';

/**
 * GET /library/items?scope=organization&productType= — общие материалы
 * (productType сужает до продукта плюс материалы для всех продуктов);
 * GET /library/items?scope=personal&folderId= — личные материалы в папке
 * (без folderId — корень). productType при scope=personal и folderId при
 * scope=organization отклоняются сервисом, а не игнорируются молча.
 */
export class ListLibraryItemsDto {
  @IsIn(LIBRARY_SCOPES)
  scope!: LibraryScope;

  @IsOptional()
  @IsIn(LIBRARY_PRODUCT_TYPES)
  productType?: LibraryProductType;

  @IsOptional()
  @IsMongoId()
  folderId?: string;
}
