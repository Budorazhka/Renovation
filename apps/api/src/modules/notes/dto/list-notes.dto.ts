import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_NOTE_LIST_LIMIT = 50;
export const MAX_NOTE_LIST_LIMIT = 100;

export class ListNotesDto {
  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_NOTE_LIST_LIMIT)
  limit: number = DEFAULT_NOTE_LIST_LIMIT;
}
