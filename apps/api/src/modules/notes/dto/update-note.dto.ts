import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateNoteAttachmentDto } from './create-note.dto';
import { NOTE_CATEGORIES, type NoteCategory } from '../schemas/note.schema';

export class UpdateNoteDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsIn(NOTE_CATEGORIES)
  category?: NoteCategory;

  /** Отсутствие поля — не менять; `null` — отвязать лид. */
  @IsOptional()
  @IsMongoId()
  leadId?: string | null;

  /** Полный новый список, заменяет прежний целиком — тот же принцип, что UpdateTaskDto.subtasks. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateNoteAttachmentDto)
  attachments?: CreateNoteAttachmentDto[];
}
