import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * `in_progress` добавлен 02.09.2026: экран задач ERP показывает четыре
 * состояния — «Новая», «В работе», «Выполнена», «Просрочена», — и требование
 * к продукту такое, что интерфейс не меняется, а модель подстраивается под
 * него. Три из четырёх ложатся на хранимые статусы (`open`, `in_progress`,
 * `completed`); «Просрочена» НЕ хранится и не может храниться — это
 * производное от `dueAt < now` при незавершённой задаче, и хранить его
 * значило бы заводить поле, которое устаревает само по себе каждую полночь.
 *
 * `cancelled` собственного отображения на экране пока не имеет — состояние
 * серверное, остаётся как было.
 */
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'completed',
  'cancelled',
] as const;

/**
 * Незавершённые статусы — то, что для лида означает «следующее действие ещё
 * не сделано». Именно этот набор, а не один `open`: задача, взятая в работу,
 * остаётся следующим действием, и считать иначе значило бы гасить признак
 * ровно в тот момент, когда за задачу взялись.
 */
export const UNFINISHED_TASK_STATUSES: readonly TaskStatus[] = ['open', 'in_progress'] as const;

/**
 * Приоритет — понятие модели чтения, не хранения. Экран оперирует двумя
 * признаками, «срочно» и «важно», и матрицей Эйзенхауэра; хранятся именно они.
 * Порядковая шкала `low < medium < high < critical` была отпечатком типа
 * легаси-клиента: в ней `high` значило «срочно, не важно», а `medium` —
 * «важно, не срочно», и первая же серверная сортировка поставила бы неважное
 * выше важного (аудит 02.09.2026, docs/architecture/screen-as-spec-boundary-audit-2026-09-02.md).
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'critical'] as const;

/** Квадрант матрицы → название, которым пользуется экран. Обратимо без потерь. */
export function priorityFromFlags(isUrgent: boolean, isImportant: boolean): TaskPriority {
  if (isUrgent && isImportant) return 'critical';
  if (isUrgent) return 'high';
  if (isImportant) return 'medium';
  return 'low';
}

export function flagsFromPriority(priority: TaskPriority): { isUrgent: boolean; isImportant: boolean } {
  return {
    isUrgent: priority === 'critical' || priority === 'high',
    isImportant: priority === 'critical' || priority === 'medium',
  };
}

/** Рабочая или личная задача — отдельные вкладки реестра. */
export type TaskCategory = 'work' | 'personal';

export const TASK_CATEGORIES: readonly TaskCategory[] = ['work', 'personal'] as const;

/** Вид задачи — обычная, звонок или встреча. Отдельные иконки на экране. */
export type TaskType = 'standard' | 'call' | 'meeting';

export const TASK_TYPES: readonly TaskType[] = ['standard', 'call', 'meeting'] as const;

/**
 * К чему привязана задача — понятие модели чтения. Выводится из `leadId` и
 * `contactId`, а не хранится рядом с ними: две пары полей про одну связь были
 * двумя источниками правды, и ничто не проверяло их согласованность (аудит
 * 02.09.2026). `none` — самостоятельная задача без объекта, штатный случай.
 * `deal`/`property`/`booking` появятся вместе с соответствующими ссылками.
 */
export type TaskEntityType = 'lead' | 'client' | 'deal' | 'property' | 'booking' | 'none';

export const TASK_ENTITY_TYPES: readonly TaskEntityType[] = [
  'lead',
  'client',
  'deal',
  'property',
  'booking',
  'none',
] as const;

/**
 * docs/architecture/domain-model.md Module 7 / mongodb-schema.md `tasks`.
 * CRM-003: Tasks / Next Action vertical slice.
 *
 * Tenant-scoped CRM task linked to a Lead and/or Contact.
 * Assigned to a Position inside the organization.
 */
@Schema({ collection: 'tasks', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })
export class TaskDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ required: true, enum: TASK_STATUSES, default: 'open' })
  status!: TaskStatus;

  @Prop({ required: false, type: Date })
  dueAt?: Date;

  /**
   * Плановое начало. Экран разделяет дату и время отдельными полями, но
   * хранится один момент времени: две части одного значения, разнесённые по
   * колонкам, неизбежно разъезжаются. Разделение — забота представления.
   */
  @Prop({ required: false, type: Date })
  startAt?: Date;

  /** Признаки матрицы Эйзенхауэра — то, что экран действительно спрашивает. */
  @Prop({ required: true, default: false })
  isUrgent!: boolean;

  @Prop({ required: true, default: true })
  isImportant!: boolean;

  @Prop({ required: true, enum: TASK_CATEGORIES, default: 'work' })
  taskCategory!: TaskCategory;

  /** Вид задачи — обычная/звонок/встреча. Отсутствие у старых документов читается как 'standard'. */
  @Prop({ required: true, enum: TASK_TYPES, default: 'standard' })
  taskType!: TaskType;

  /** Цветовая метка задачи в формате #rrggbb; отсутствие метки — не цвет, а null. */
  @Prop({ required: false, type: String, default: null })
  colorHex?: string | null;

  /** Напоминания: за сколько минут до начала. Пустой массив — напоминаний нет. */
  @Prop({ type: [Number], default: [] })
  reminderOffsetsMinutes!: number[];

  /**
   * Подзадачи хранятся вложенным массивом, а не отдельной коллекцией: они не
   * существуют вне своей задачи, не адресуются снаружи и всегда читаются
   * вместе с ней.
   */
  @Prop({
    type: [{ id: String, title: String, done: Boolean }],
    default: [],
  })
  subtasks!: Array<{ id: string; title: string; done: boolean }>;

  /**
   * Вложения — ссылки на MediaAsset по образцу avatarAssetId позиции, плюс
   * имя, которое человек видел при выборе файла. Имя живёт на связи, а не на
   * asset'е: MediaAsset хранит путь и тип, а имя — это подпись пользователя,
   * как alt у медиа объекта.
   *
   * До 02.09.2026 хранились только имена без файлов — «демо, без загрузки»,
   * как честно называл это легаси-тип клиента. Экран обещал вложения, а
   * сервер хранил строки (аудит границы «экран — спецификация»).
   */
  @Prop({
    type: [{ assetId: { type: Types.ObjectId, ref: 'MediaAssetDocument' }, fileName: String }],
    default: [],
  })
  attachments!: Array<{ assetId: Types.ObjectId; fileName: string }>;

  /**
   * Создана автоматически по правилу, а не человеком. Провенанс: ставит только
   * сервер, из запроса не принимается — по образцу `createdByPositionId`. Пока
   * серверных правил, создающих задачи, нет, значение всегда false.
   */
  @Prop({ required: true, default: false })
  isAutomatic!: boolean;

  /** Ссылка на правило, создавшее задачу. Появится вместе с реестром правил. */
  @Prop({ required: false, trim: true })
  triggerType?: string;

  @Prop({ type: Types.ObjectId, required: false })
  assignedPositionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  contactId?: Types.ObjectId;

  @Prop({ required: false, type: Date })
  completedAt?: Date;

  @Prop({ type: Types.ObjectId, required: false })
  completedByPositionId?: Types.ObjectId;

  /**
   * Кто создал задачу. Экран показывает «Создал» отдельной строкой, а до
   * 02.09.2026 создатель нигде не сохранялся — он был известен в момент
   * создания (actorPositionId) и терялся сразу после.
   */
  @Prop({ type: Types.ObjectId, required: false })
  createdByPositionId?: Types.ObjectId;

  /**
   * conventions.md разд.5 optimistic concurrency — тот же паттерн, что
   * LeadDocument.version/UnitDocument.version: PATCH /tasks/:taskId,
   * POST /tasks/:taskId/complete и PATCH /tasks/:taskId/reassign
   * принимают expectedVersion и атомарно проверяют его в одном Mongo
   * updateOne (не read-then-write), чтобы два параллельных изменения
   * одной задачи не затирали друг друга молча.
   */
  @Prop({ required: true, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const TaskSchema = SchemaFactory.createForClass(TaskDocument);

// Compound indexes for pagination and filtered lookups
TaskSchema.index({ organizationId: 1, _id: -1 });
TaskSchema.index({ organizationId: 1, assignedPositionId: 1, status: 1 });
TaskSchema.index({ organizationId: 1, leadId: 1, status: 1 });
TaskSchema.index({ organizationId: 1, contactId: 1 });
TaskSchema.index({ organizationId: 1, dueAt: 1 });
TaskSchema.index({ organizationId: 1, status: 1 });
