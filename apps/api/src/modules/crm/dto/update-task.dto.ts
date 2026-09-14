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
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateTaskAttachmentDto, CreateTaskSubtaskDto } from './create-task.dto';
import {
  TASK_CATEGORIES,
  TASK_TYPES,
  type TaskCategory,
  type TaskStatus,
  type TaskType,
} from '../schemas/task.schema';

/**
 * НЕ содержит assignedPositionId — смена исполнителя ТОЛЬКО через
 * PATCH /tasks/:taskId/reassign (task.reassign — отдельный action от
 * task.edit, см. CrmService.updateTask/reassignTask докстринги).
 */
export class UpdateTaskDto {
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
  @MaxLength(2000)
  description?: string;

  /** `null` снимает срок — тот же принцип, что colorHex/leadId ниже: отсутствие поля и null — разные намерения. */
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  /** `null` снимает плановое начало. */
  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  /**
   * `in_progress` добавлен 02.09.2026. Статус появился в модели вместе с
   * расширением задачи под экран ERP, но задать его было нечем: PATCH
   * принимал только `open` и `cancelled`, и «В работе» на экране оставалось
   * состоянием, в которое задача попасть не может.
   *
   * `completed` здесь по-прежнему нет намеренно: завершение — отдельная
   * команда `POST /tasks/:taskId/complete`, она пишет `completedAt`,
   * `completedByPositionId` и событие `TaskCompleted`. Разрешить его тут
   * значило бы завести второй путь завершения, который ничего этого не
   * делает.
   */
  @IsOptional()
  @IsIn(['open', 'in_progress', 'cancelled'])
  status?: TaskStatus;

  /** Признаки матрицы Эйзенхауэра — те же, что принимает создание. */
  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  @IsOptional()
  @IsBoolean()
  isImportant?: boolean;

  @IsOptional()
  @IsIn(TASK_CATEGORIES)
  taskCategory?: TaskCategory;

  @IsOptional()
  @IsIn(TASK_TYPES)
  taskType?: TaskType;

  /** `null` — снять цветовую метку. Отсутствие поля и null — разные намерения. */
  @IsOptional()
  @IsHexColor()
  colorHex?: string | null;

  /** `null` — отвязать лид (и вместе с ним контакт, пришедший через лид). */
  @IsOptional()
  @IsMongoId()
  leadId?: string | null;

  /**
   * Полный список подзадач. Заменяет прежний целиком, а не сливается с ним:
   * подзадачи живут только внутри своей задачи, экран всегда держит их все и
   * отправляет тоже все. Частичное слияние потребовало бы отдельного языка
   * операций ради списка из трёх строк.
   *
   * Добавлено 02.09.2026: модель хранила `done` у каждой подзадачи с самого
   * начала, но поставить эту отметку было нечем — экран показывал чекбоксы,
   * которые не сохранялись.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskSubtaskDto)
  subtasks?: CreateTaskSubtaskDto[];

  /**
   * Полный список вложений. Заменяет прежний целиком — тот же принцип, что
   * subtasks выше. Проверка asset'ов та же, что в createTask (owner scope +
   * verified).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskAttachmentDto)
  attachments?: CreateTaskAttachmentDto[];
}
