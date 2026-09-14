import { IsIn, IsOptional } from 'class-validator';

/**
 * `?tag=old_base` — POST /leads/import query-параметр. Единственное
 * допустимое значение сегодня; другое значение — 400 VALIDATION_FAILED
 * (глобальный ValidationPipe: whitelist+forbidNonWhitelisted+`@IsIn`).
 */
export class ImportLeadsQueryDto {
  @IsOptional()
  @IsIn(['old_base'])
  tag?: 'old_base';
}
