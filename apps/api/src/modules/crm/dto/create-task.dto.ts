import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TASK_CATEGORIES, type TaskCategory, TASK_TYPES, type TaskType } from '../schemas/task.schema';

/** Подзадача. `id` генерирует клиент — он же переставляет их локально до сохранения. */
export class CreateTaskSubtaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

/** Вложение: уже загруженный и подтверждённый MediaAsset плюс имя для экрана. */
export class CreateTaskAttachmentDto {
  @IsMongoId()
  assetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsMongoId()
  assignedPositionId?: string;

  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  /** Признаки матрицы Эйзенхауэра. По умолчанию — «важно, не срочно», как в форме. */
  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  @IsOptional()
  @IsBoolean()
  isImportant?: boolean;

  @IsOptional()
  @IsIn(TASK_CATEGORIES)
  taskCategory?: TaskCategory;

  /** Вид задачи. По умолчанию — 'standard', как в схеме. */
  @IsOptional()
  @IsIn(TASK_TYPES)
  taskType?: TaskType;

  /** `null` — снять метку. Отсутствие поля и null — разные намерения. */
  @IsOptional()
  @IsHexColor()
  colorHex?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  reminderOffsetsMinutes?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskSubtaskDto)
  subtasks?: CreateTaskSubtaskDto[];

  /**
   * Файлы загружаются заранее через POST /media/upload-intent с purpose
   * task_attachment и подтверждаются; сюда приходят только ссылки. Сервер
   * проверяет, что каждый asset принадлежит организации и подтверждён.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskAttachmentDto)
  attachments?: CreateTaskAttachmentDto[];

  // entityType/entityId не принимаются: связь выводится из leadId/contactId.
  // isAutomatic/triggerType не принимаются: провенанс ставит только сервер.
}
