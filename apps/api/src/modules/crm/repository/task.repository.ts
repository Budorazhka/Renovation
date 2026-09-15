import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import {
  TaskDocument,
  UNFINISHED_TASK_STATUSES,
  type TaskStatus,
  type TaskCategory,
  type TaskType,
} from '../schemas/task.schema';

export interface ListTasksFilter {
  assignedPositionId?: Types.ObjectId;
  /**
   * ИСПРАВЛЕНО 11.09.2026 (task-model-audit-followup.md, седьмое наблюдение
   * аудита): личные задачи (`taskCategory: 'personal'`) видны только своему
   * исполнителю — сервер раньше отдавал их org-wide грантам целиком,
   * видимость держал только клиент. Отличается от `assignedPositionId` выше:
   * тот сужает ВЕСЬ список (own-scope грант), этот — только `personal`-
   * записи чужих исполнителей, даже при organization-scope гранте. Всегда
   * обязателен — звонящий код обязан явно передать позицию вызывающего, не
   * полагаться на дефолт.
   */
  callerPositionId: Types.ObjectId;
  leadId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  status?: TaskStatus;
  dueBefore?: Date;
  dueAfter?: Date;
  cursor?: Types.ObjectId;
  limit: number;
}

export interface CreateTaskParams {
  organizationId: Types.ObjectId;
  title: string;
  description?: string;
  status?: TaskStatus;
  dueAt?: Date;
  assignedPositionId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  startAt?: Date;
  isUrgent?: boolean;
  isImportant?: boolean;
  taskCategory?: TaskCategory;
  taskType?: TaskType;
  colorHex?: string | null;
  reminderOffsetsMinutes?: number[];
  subtasks?: Array<{ id: string; title: string; done: boolean }>;
  attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
  createdByPositionId?: Types.ObjectId;
}

export interface UpdateTaskParams {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  dueAt?: Date | null;
  startAt?: Date | null;
  subtasks?: Array<{ id: string; title: string; done: boolean }>;
  isUrgent?: boolean;
  isImportant?: boolean;
  taskCategory?: TaskCategory;
  taskType?: TaskType;
  /** default схемы — null, поэтому явный null пишется напрямую, а не $unset. */
  colorHex?: string | null;
  /** null отвязывает лид и (см. contactId) снимает контакт, пришедший через него. */
  leadId?: Types.ObjectId | null;
  contactId?: Types.ObjectId | null;
  attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
}

/**
 * Repository layer for CRM tasks.
 * All mutations and reads strictly enforce tenant isolation (organizationId).
 */
@Injectable()
export class TaskRepository {
  constructor(@InjectModel(TaskDocument.name) private readonly model: Model<TaskDocument>) {}

  async create(params: CreateTaskParams, session?: ClientSession): Promise<TaskDocument> {
    const docData: Record<string, unknown> = {
      organizationId: params.organizationId,
      title: params.title,
      status: params.status ?? 'open',
    };

    if (params.description !== undefined) docData.description = params.description;
    if (params.dueAt !== undefined) docData.dueAt = params.dueAt;
    if (params.assignedPositionId !== undefined) docData.assignedPositionId = params.assignedPositionId;
    if (params.leadId !== undefined) docData.leadId = params.leadId;
    if (params.contactId !== undefined) docData.contactId = params.contactId;
    // Ниже — поля, которыми пользуется экран задач. Каждое проставляется
    // только если пришло: у остальных работают defaults схемы, и запись «как
    // есть» не должна затирать их undefined'ом.
    if (params.startAt !== undefined) docData.startAt = params.startAt;
    if (params.isUrgent !== undefined) docData.isUrgent = params.isUrgent;
    if (params.isImportant !== undefined) docData.isImportant = params.isImportant;
    if (params.taskCategory !== undefined) docData.taskCategory = params.taskCategory;
    if (params.taskType !== undefined) docData.taskType = params.taskType;
    if (params.colorHex !== undefined) docData.colorHex = params.colorHex;
    if (params.reminderOffsetsMinutes !== undefined) docData.reminderOffsetsMinutes = params.reminderOffsetsMinutes;
    if (params.subtasks !== undefined) docData.subtasks = params.subtasks;
    if (params.attachments !== undefined) docData.attachments = params.attachments;
    if (params.createdByPositionId !== undefined) docData.createdByPositionId = params.createdByPositionId;

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  /**
   * `callerPositionId` — новый, необязательный, ПОСЛЕДНИЙ параметр (не
   * трогает порядок уже существующих вызовов с `session`): передаётся
   * только со стороны чтения (getTask), где нужна проверка видимости
   * personal-задачи (см. ListTasksFilter.callerPositionId выше). Пути
   * записи (updateTask/completeTask/reassignTask/changeStage) его не
   * передают — тот же класс задачи, что own-scope конкретной записи в
   * link-crm мессенджера: сознательно отложено, не тот же баг, что
   * видимость в списке/чтении, см. task-model-audit-followup.md.
   */
  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    assignedPositionId?: Types.ObjectId,
    session?: ClientSession,
    callerPositionId?: Types.ObjectId,
  ): Promise<TaskDocument | null> {
    const filter: FilterQuery<TaskDocument> = { _id: id, organizationId };
    if (assignedPositionId) {
      filter.assignedPositionId = assignedPositionId;
    }
    if (callerPositionId) {
      filter.$or = [{ taskCategory: { $ne: 'personal' } }, { assignedPositionId: callerPositionId }];
    }
    if (session) {
      return this.model.findOne(filter, null, { session }).exec();
    }
    return this.model.findOne(filter).exec();
  }

  async listForOrganization(
    organizationId: Types.ObjectId,
    filter: ListTasksFilter,
  ): Promise<TaskDocument[]> {
    const queryFilter: FilterQuery<TaskDocument> = { organizationId };

    if (filter.cursor) {
      queryFilter._id = { $lt: filter.cursor };
    }

    if (filter.status) {
      queryFilter.status = filter.status;
    }

    if (filter.assignedPositionId) {
      queryFilter.assignedPositionId = filter.assignedPositionId;
    }

    if (filter.leadId) {
      queryFilter.leadId = filter.leadId;
    }

    if (filter.contactId) {
      queryFilter.contactId = filter.contactId;
    }

    if (filter.dueBefore || filter.dueAfter) {
      const dueFilter: Record<string, Date> = {};
      if (filter.dueBefore) dueFilter.$lte = filter.dueBefore;
      if (filter.dueAfter) dueFilter.$gte = filter.dueAfter;
      queryFilter.dueAt = dueFilter;
    }

    // Личная задача чужого исполнителя не проходит, даже если
    // filter.assignedPositionId выше не сузил список вовсе (organization-
    // scope грант). Рабочие задачи (taskCategory !== 'personal') это условие
    // пропускает без исключений.
    queryFilter.$or = [
      { taskCategory: { $ne: 'personal' } },
      { assignedPositionId: filter.callerPositionId },
    ];

    return this.model
      .find(queryFilter)
      .sort({ _id: -1 })
      .limit(filter.limit)
      .exec();
  }

  /**
   * conventions.md разд.5 optimistic concurrency — тот же паттерн, что
   * LeadRepository.changeStageWithVersionCheck/UnitRepository.updateStatusWithVersionCheck:
   * `version: expectedVersion` в ОДНОМ атомарном Mongo-фильтре с самим
   * изменением, не read-then-write. TaskDocument.version существует с
   * первого дня схемы (default:0) — нет legacy-документов без него,
   * поэтому, в отличие от Lead, здесь не нужен `$or` fallback на
   * отсутствующее поле.
   */
  async updateTask(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    params: UpdateTaskParams,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, number> = {};

    if (params.title !== undefined) $set.title = params.title;
    if (params.status !== undefined) $set.status = params.status;
    if (params.subtasks !== undefined) $set.subtasks = params.subtasks;
    if (params.isUrgent !== undefined) $set.isUrgent = params.isUrgent;
    if (params.isImportant !== undefined) $set.isImportant = params.isImportant;
    if (params.taskCategory !== undefined) $set.taskCategory = params.taskCategory;
    if (params.taskType !== undefined) $set.taskType = params.taskType;
    if (params.attachments !== undefined) $set.attachments = params.attachments;
    // colorHex по умолчанию в схеме — null, а не "поля нет", поэтому явный
    // null пишется как обычное значение ($set), а не снимается ($unset), как
    // остальные поля без default ниже.
    if (params.colorHex !== undefined) $set.colorHex = params.colorHex;

    if (params.description === null) {
      $unset.description = 1;
    } else if (params.description !== undefined) {
      $set.description = params.description;
    }

    if (params.dueAt === null) {
      $unset.dueAt = 1;
    } else if (params.dueAt !== undefined) {
      $set.dueAt = params.dueAt;
    }

    if (params.startAt === null) {
      $unset.startAt = 1;
    } else if (params.startAt !== undefined) {
      $set.startAt = params.startAt;
    }

    if (params.leadId === null) {
      $unset.leadId = 1;
    } else if (params.leadId !== undefined) {
      $set.leadId = params.leadId;
    }

    if (params.contactId === null) {
      $unset.contactId = 1;
    } else if (params.contactId !== undefined) {
      $set.contactId = params.contactId;
    }

    const updateDoc: Record<string, unknown> = { $inc: { version: 1 } };
    if (Object.keys($set).length > 0) updateDoc.$set = $set;
    if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;

    const result = await this.model
      .updateOne({ _id: id, organizationId, version: expectedVersion }, updateDoc, { session })
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * PATCH /tasks/:taskId/reassign — единственный путь смены
   * assignedPositionId, физически отдельный от updateTask (task.reassign —
   * отдельный action/grant, не task.edit, тот же принцип, что
   * lead.assign отделён от lead.changeStage). CAS на version, тот же
   * паттерн, что updateTask.
   */
  async reassignTask(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    assignedPositionId: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const updateDoc: Record<string, unknown> =
      assignedPositionId === null
        ? { $unset: { assignedPositionId: 1 }, $inc: { version: 1 } }
        : { $set: { assignedPositionId }, $inc: { version: 1 } };

    const result = await this.model
      .updateOne({ _id: id, organizationId, version: expectedVersion }, updateDoc, { session })
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async completeTask(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    completedByPositionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, version: expectedVersion },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            completedByPositionId,
          },
          $inc: { version: 1 },
        },
        { session },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async countOpenForLead(organizationId: Types.ObjectId, leadId: Types.ObjectId): Promise<number> {
    return this.model
      .countDocuments({ organizationId, leadId, status: { $in: UNFINISHED_TASK_STATUSES } })
      .exec();
  }

  async listForLead(organizationId: Types.ObjectId, leadId: Types.ObjectId): Promise<TaskDocument[]> {
    return this.model.find({ organizationId, leadId }).sort({ _id: -1 }).exec();
  }

  async listForContact(organizationId: Types.ObjectId, contactId: Types.ObjectId): Promise<TaskDocument[]> {
    return this.model.find({ organizationId, contactId }).sort({ _id: -1 }).exec();
  }

  /**
   * CRM-003 hasOpenNextAction для GET /leads (список) — тот же принцип
   * батчинга, что ContactRepository.findByIdsForOrganization: ОДИН запрос
   * на всю страницу лидов вместо N countOpenForLead (N+1 query). Возвращает
   * множество leadId, у которых есть хотя бы одна незавершённая задача — caller
   * (CrmService.listLeads) проверяет через Set.has(), не считает точное
   * количество (странице всё равно нужен только boolean-флаг).
   */
  async distinctLeadIdsWithOpenTask(
    organizationId: Types.ObjectId,
    leadIds: Types.ObjectId[],
  ): Promise<Types.ObjectId[]> {
    if (leadIds.length === 0) return [];
    return this.model
      .distinct('leadId', {
        organizationId,
        leadId: { $in: leadIds },
        status: { $in: UNFINISHED_TASK_STATUSES },
      })
      .exec();
  }

  /**
   * Факт по плану сотрудника: сколько задач-звонков и задач-встреч
   * исполнитель закрыл в периоде (по completedAt, не по createdAt — план
   * меряет сделанное, а не поставленное).
   */
  async aggregateCompletedActivitiesByPosition(
    organizationId: Types.ObjectId,
    params: { from: Date; to: Date },
  ): Promise<Array<{ assignedPositionId: Types.ObjectId; taskType: 'call' | 'meeting'; count: number }>> {
    return this.model
      .aggregate<{ assignedPositionId: Types.ObjectId; taskType: 'call' | 'meeting'; count: number }>([
        {
          $match: {
            organizationId,
            status: 'completed',
            taskType: { $in: ['call', 'meeting'] },
            assignedPositionId: { $ne: null },
            completedAt: { $gte: params.from, $lte: params.to },
          },
        },
        { $group: { _id: { assignedPositionId: '$assignedPositionId', taskType: '$taskType' }, count: { $sum: 1 } } },
        { $project: { _id: 0, assignedPositionId: '$_id.assignedPositionId', taskType: '$_id.taskType', count: 1 } },
      ])
      .exec();
  }

  async aggregateByAssignedPosition(
    organizationId: Types.ObjectId,
    params: { from?: Date; to?: Date },
  ): Promise<Array<{
    assignedPositionId: Types.ObjectId | null;
    status: TaskStatus;
    count: number;
    completedOnTimeCount: number;
    overdueCount: number;
  }>> {
    const match: Record<string, unknown> = { organizationId };
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) createdAt.$gte = params.from;
      if (params.to) createdAt.$lte = params.to;
      match.createdAt = createdAt;
    }

    return this.model
      .aggregate<{
        assignedPositionId: Types.ObjectId | null;
        status: TaskStatus;
        count: number;
        completedOnTimeCount: number;
        overdueCount: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: {
              assignedPositionId: { $ifNull: ['$assignedPositionId', null] },
              status: '$status',
            },
            count: { $sum: 1 },
            completedOnTimeCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'completed'] },
                      { $ne: ['$dueAt', null] },
                      { $lte: ['$completedAt', '$dueAt'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            overdueCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $and: [
                          { $eq: ['$status', 'completed'] },
                          { $ne: ['$dueAt', null] },
                          { $gt: ['$completedAt', '$dueAt'] },
                        ],
                      },
                      {
                        $and: [
                          { $in: ['$status', ['open']] },
                          { $ne: ['$dueAt', null] },
                          { $lt: ['$dueAt', new Date()] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            assignedPositionId: '$_id.assignedPositionId',
            status: '$_id.status',
            count: 1,
            completedOnTimeCount: 1,
            overdueCount: 1,
          },
        },
      ])
      .exec();
  }

  async aggregateTimeseries(
    organizationId: Types.ObjectId,
    params: { from?: Date; to?: Date; assignedPositionId?: Types.ObjectId },
  ): Promise<Array<{ date: string; count: number }>> {
    const match: Record<string, unknown> = { organizationId, status: 'completed' };
    if (params.assignedPositionId) {
      match.assignedPositionId = params.assignedPositionId;
    }
    if (params.from || params.to) {
      const dateFilter: Record<string, Date> = {};
      if (params.from) dateFilter.$gte = params.from;
      if (params.to) dateFilter.$lte = params.to;
      match.completedAt = dateFilter;
    }

    return this.model
      .aggregate<{ date: string; count: number }>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            count: 1,
          },
        },
        { $sort: { date: 1 } },
      ])
      .exec();
  }
}
