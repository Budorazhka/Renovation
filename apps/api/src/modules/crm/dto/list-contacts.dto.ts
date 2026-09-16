import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CONTACT_SEGMENTS, type ContactSegment } from '../schemas/contact.schema';

export const DEFAULT_CONTACT_LIST_LIMIT = 20;
export const MAX_CONTACT_LIST_LIMIT = 100;

export class ListContactsDto {
  /** Единый поиск по name/phone (partial, регистронезависимый) — не два отдельных query-параметра. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Вкладка списка клиентов ERP — golden/active/archived/deferred, считается сервером (N-20). */
  @IsOptional()
  @IsIn(CONTACT_SEGMENTS)
  segment?: ContactSegment;

  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CONTACT_LIST_LIMIT)
  limit: number = DEFAULT_CONTACT_LIST_LIMIT;
}
