import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NOTE_CATEGORIES, type NoteCategory } from '../schemas/note.schema';

/** Вложение: уже загруженный и подтверждённый MediaAsset плюс имя для экрана — тот же паттерн, что CreateTaskAttachmentDto. */
export class CreateNoteAttachmentDto {
  @IsMongoId()
  assetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;
}

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

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

  @IsOptional()
  @IsMongoId()
  leadId?: string;

  /**
   * Файлы загружаются заранее через POST /media/upload-intent с purpose
   * note_attachment и подтверждаются; сюда приходят только ссылки. Сервер
   * проверяет, что каждый asset принадлежит организации и подтверждён.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateNoteAttachmentDto)
  attachments?: CreateNoteAttachmentDto[];
}
