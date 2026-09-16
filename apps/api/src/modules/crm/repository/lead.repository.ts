import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { LeadDocument, LeadSource, LeadStage, LeadProductType, RealtorStage, CuratorStage } from '../schemas/lead.schema';

export interface LeadWithStalled {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  contactId: Types.ObjectId;
  ownerPositionId?: Types.ObjectId;
  productType?: LeadProductType;
  stage: LeadStage;
  version: number;
  source: LeadSource;
  createdAt: Date;
  stalled: boolean;
  city?: string;
  notes?: string;
  tags?: string[];
  dealValue?: number;
  budgetValue?: number;
  budgetCurrency?: string;
  expectedCloseDate?: string;
  rejectionReason?: string;
  rejectionComment?: string;
  telegram?: string;
  country?: string;
  realtorStage?: RealtorStage;
  curatorStage?: CuratorStage;
  attachedAssetIds?: Types.ObjectId[];
  whatsapp?: string;
  lastContactAt?: Date;
  checklist?: Record<string, boolean>;
  stageNotes?: Record<string, { text: string; updatedAt: Date }>;
}

/**
 * Единственная точка доступа к коллекции leads (ADR-002 требование 2).
 */
@Injectable()
export class LeadRepository {
  constructor(@InjectModel(LeadDocument.name) private readonly model: Model<LeadDocument>) {}

  /**
   * `stage` — опционален, по умолчанию 'new' (generic-путь, как раньше).
   * Продуктовые воронки лида: вызывающий (CrmService.createLead) явно
   * передаёт первую стадию продукта, когда задан `productType` — этот
   * метод её не вычисляет, только сохраняет то, что пришло.
   */
  async create(
    params: {
      organizationId: Types.ObjectId;
      contactId: Types.ObjectId;
      source: LeadSource;
      productType?: LeadProductType;
      stage?: LeadStage;
      /** `[legacy-base-import]` — см. CrmService.createLead докстринг у route/telegram/whatsapp/notes/tags/lastContactAt. */
      telegram?: string;
      whatsapp?: string;
      notes?: string;
      tags?: string[];
      lastContactAt?: Date;
    },
    session?: ClientSession,
  ): Promise<LeadDocument> {
    const [doc] = await this.model.create([{ ...params, stage: params.stage ?? 'new' }], { session });
    return doc!;
  }

  /**
   * `status: {$ne: 'deleted'}` — тот же exclusion-паттерн, что
   * PositionRepository.findAllByOrganization исключает `status:'closed'`:
   * soft-deleted лид не должен быть виден ни по прямому id, ни в списке,
   * ни как "свой" own-scope лид. Существующие лиды без поля `status`
   * (созданы до этого прохода) проходят фильтр как обычно — `$ne` не
   * матчит отсутствующее поле как 'deleted', то есть они остаются видимы
   * (тот же backward-compatibility принцип, что version:{$exists:false}
   * в changeStageWithVersionCheck).
   */
  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    ownerPositionId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LeadDocument | null> {
    return this.model
      .findOne(
        {
          _id: id,
          organizationId,
          status: { $ne: 'deleted' },
          ...(ownerPositionId ? { ownerPositionId } : {}),
        },
        null,
        { session },
      )
      .exec();
  }

  /**
   * Cursor pagination по `_id` (не `createdAt`) — тот же принцип, что
   * AuditEventRepository.listForAdmin: ObjectId монотонно возрастает и
   * уникален, поэтому `_id`-курсор не имеет дублей/пропусков даже когда
   * несколько лидов созданы в одну и ту же миллисекунду. Newest-first
   * (`$lt` на курсор), симметрично AuditEventRepository. limit+1 — на одну
   * запись больше, чем запрошено, вызывающий код (CrmService.listLeads)
   * решает hasMore/nextCursor по факту лишней записи, не отдельным count().
   *
   * CRM-004: вычисляет `stalled` статус лида через $lookup на открытые задачи:
   * stalled = true для активных стадий (new, contacted, qualified) без открытых задач;
   * stalled = false для терминальных стадий (converted, lost) или при наличии >= 1 открытой задачи.
   */
  async listForOrganization(
    organizationId: Types.ObjectId,
    params: {
      ownerPositionId?: Types.ObjectId;
      stage?: LeadStage;
      stalled?: boolean;
      cursor?: Types.ObjectId;
      limit: number;
    },
  ): Promise<LeadWithStalled[]> {
    const matchStage: Record<string, unknown> = {
      organizationId,
      status: { $ne: 'deleted' },
      ...(params.ownerPositionId ? { ownerPositionId: params.ownerPositionId } : {}),
      ...(params.stage ? { stage: params.stage } : {}),
    };
    if (params.cursor) {
      matchStage._id = { $lt: params.cursor };
    }

    const openTasksLookup: PipelineStage = {
      $lookup: {
        from: 'tasks',
        let: { leadId: '$_id', orgId: '$organizationId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$leadId', '$$leadId'] },
                  { $eq: ['$organizationId', '$$orgId'] },
                  { $eq: ['$status', 'open'] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'openTasks',
      },
    };

    const addStalledField: PipelineStage = {
      $addFields: {
        stalled: {
          $cond: {
            if: { $in: ['$stage', ['converted', 'lost']] },
            then: false,
            else: { $eq: [{ $size: '$openTasks' }, 0] },
          },
        },
      },
    };

    const removeOpenTasks: PipelineStage = {
      $project: { openTasks: 0 },
    };

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      { $sort: { _id: -1 } },
    ];

    if (params.stalled === undefined) {
      pipeline.push(
        { $limit: params.limit },
        openTasksLookup,
        addStalledField,
        removeOpenTasks,
      );
    } else {
      pipeline.push(
        openTasksLookup,
        addStalledField,
        { $match: { stalled: params.stalled } },
        { $limit: params.limit },
        removeOpenTasks,
      );
    }

    return this.model.aggregate<LeadWithStalled>(pipeline).exec();
  }

  async findLeadIdsForContact(
    organizationId: Types.ObjectId,
    contactId: Types.ObjectId,
    ownerPositionId?: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const filter: Record<string, unknown> = { organizationId, contactId };
    if (ownerPositionId) {
      filter.ownerPositionId = ownerPositionId;
    }
    return this.model.distinct('_id', filter).exec();
  }

  /**
   * GET /contacts own-scope (contact.read scope:'own', permission-matrix.md):
   * Contact сам по себе не хранит ownerPositionId — "свой" контакт для
   * manager'а определён transитивно через Lead (contact связан с лидом,
   * ownerPositionId которого — эта Position). distinct() возвращает
   * уникальные contactId без дублей, даже если у Position несколько лидов
   * на один и тот же Contact (повторный reveal того же телефона — см.
   * CrmService.resolveContact докстринг). ContactController/CrmService
   * резолвит это множество ОДИН раз в начале запроса, передаёт как
   * ContactRepository.listForOrganization({contactIds}) — не постфильтрация
   * уже прочитанного списка контактов.
   */
  async distinctContactIdsForOwner(
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    return this.model.distinct('contactId', { organizationId, ownerPositionId }).exec();
  }

  /**
   * Стадия каждого лида организации с его contactId — тот же вход для
   * CrmService.buildContactSegmentIndex, что
   * DealRepository.listContactStagesForOrganization, для контактов, у
   * которых ещё нет сделки. Полный скан организации — тот же MVP-масштаб.
   */
  async listContactStagesForOrganization(
    organizationId: Types.ObjectId,
  ): Promise<Array<{ contactId: Types.ObjectId; stage: LeadStage }>> {
    const rows = await this.model
      .find({ organizationId }, { contactId: 1, stage: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({ contactId: row.contactId, stage: row.stage as LeadStage }));
  }

  /** То же, что listContactStagesForOrganization, но для одного контакта — GET /contacts/:id. */
  async listStagesForContact(organizationId: Types.ObjectId, contactId: Types.ObjectId): Promise<LeadStage[]> {
    const rows = await this.model.find({ organizationId, contactId }, { stage: 1 }).lean().exec();
    return rows.map((row) => row.stage as LeadStage);
  }

  /**
   * assignLead (permission-matrix.md `lead.assign.organization`) — не
   * версионировано (в отличие от Development/Unit): concurrent assign той
   * же lead двумя РОПами одновременно — редкий edge case на MVP-масштабе,
   * последний write выигрывает, явно не защищено optimistic concurrency
   * (D-01 паттерн здесь не переносится автоматически, это сознательное
   * упрощение первого прохода CRM-модуля, не молчаливый пробел).
   */
  async assignOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    ownerPositionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne({ _id: id, organizationId }, { $set: { ownerPositionId } }, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * unassignLead — обратное действие assignOwner (тот же грант `lead.assign`,
   * см. CrmService.unassignLead докстринг): очищает ownerPositionId, не
   * версионировано — тот же сознательный выбор, что и assignOwner выше.
   */
  /**
   * `matchedCount` и `modifiedCount` возвращаются раздельно намеренно
   * (найдено 03.09.2026 внешним ревью): лид, уже снятый с назначения,
   * даёт `matchedCount:1, modifiedCount:0` (Mongo не считает $unset
   * несуществующего поля изменением) — вызывающий код обязан считать это
   * идемпотентным успехом, а не "лид не найден". `matchedCount:0` — лид
   * реально не существует или не в этой организации, единственный законный
   * повод для NotFoundException. `status: {$ne:'deleted'}` — тот же фильтр,
   * что уже стоит в updateFields ниже, здесь был пропущен.
   */
  async unassignOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $unset: { ownerPositionId: '' } },
        { session },
      )
      .exec();
    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  /**
   * conventions.md разд.5 optimistic concurrency — тот же паттерн, что
   * UnitRepository.updateStatusWithVersionCheck: `version: expectedVersion`
   * И `stage: { $in: allowedFromStages }` в ОДНОМ атомарном Mongo-фильтре
   * (не два отдельных read-then-write шага) — единственная гарантия, что
   * два параллельных PATCH .../stage не оба проходят transition-проверку
   * против одного и того же прочитанного состояния и оба безусловно
   * записывают (lost update). Добавлено 27.08.2026 — до этого changeStage
   * был безусловным updateOne({_id,organizationId}), ноль concurrency-защиты.
   */
  async changeStageWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    stage: LeadStage,
    allowedFromStages: readonly LeadStage[],
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    // Backward compatibility for leads created before Lead.version was added:
    // a missing field is the same logical initial version (0). Once this
    // update succeeds, $inc materializes version:1 on the legacy document.
    const versionFilter = expectedVersion === 0
      ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
      : { version: expectedVersion };
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, ...versionFilter, stage: { $in: allowedFromStages } },
        { $set: { stage }, $inc: { version: 1 } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * PATCH /leads/:leadId — общее обновление сопутствующих полей лида
   * (city/notes/tags/dealValue/budgetValue/budgetCurrency/expectedCloseDate/
   * rejectionReason/rejectionComment/telegram/country/realtorStage/
   * curatorStage). НИКОГДА `stage` — тот путь остаётся только за
   * changeStageWithVersionCheck (CAS/idempotency, не дублируется здесь).
   * Не версионировано — тот же сознательный выбор, что assignOwner/
   * unassignOwner (D-01 optimistic concurrency здесь не перенесён, это
   * сопутствующие поля, не критичная для отчётности воронка).
   */
  async updateFields(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    fields: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne({ _id: id, organizationId, status: { $ne: 'deleted' } }, { $set: fields }, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * PATCH /leads/:leadId — смена productType (CrmService.updateLead
   * докстринг): productType + сброс stage на "Новый лид" нового продукта —
   * ЕДИНСТВЕННОЕ место, где updateLead трогает stage, и ровно поэтому (в
   * отличие от остальных полей updateFields выше) инкрементирует `version`
   * — то же поле, что changeStageWithVersionCheck использует для CAS: без
   * инкремента здесь следующий PATCH /leads/:leadId/stage клиента со
   * старым expectedVersion молча прошёл бы version-проверку, хотя stage
   * фактически уже сменился этим путём.
   */
  async updateFieldsWithProductReset(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    fields: Record<string, unknown>,
    productReset: { productType: LeadProductType; stage: LeadStage },
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $set: { ...fields, productType: productReset.productType, stage: productReset.stage }, $inc: { version: 1 } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * GET/PATCH /leads/:leadId/checklist. Атомарный per-item `$set` по dot-
   * path (`checklist.<stage>:<index>`), НЕ read-merge-write целого массива
   * (в отличие от DealRepository.updateChecklist + expectedVersion): чек-лист
   * отмечают часто и независимо разными пунктами, CAS по версии ВСЕГО лида
   * здесь давал бы ложные 409 между двумя менеджерами, отмечающими РАЗНЫЕ
   * пункты одного лида одновременно, либо между отметкой пункта и, скажем,
   * PATCH сопутствующих полей — конфликт, которого по сути нет. Каждый
   * dot-path — независимая запись в документе, MongoDB применяет все $set
   * одной операции атомарно, конкурентные PATCH на РАЗНЫЕ ключи никогда не
   * затирают друг друга; на ОДИН и тот же ключ — last-write-wins, тот же
   * компромисс, что assignOwner/unassignOwner (не версионировано).
   */
  async updateChecklist(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    changes: Array<{ key: string; checked: boolean }>,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const set: Record<string, boolean> = {};
    for (const change of changes) {
      set[`checklist.${change.key}`] = change.checked;
    }
    const result = await this.model
      .updateOne({ _id: id, organizationId, status: { $ne: 'deleted' } }, { $set: set }, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * PUT /leads/:leadId/stage-notes/:stage. `note: null` удаляет запись
   * (`$unset`) — пустой `text` из CrmService.setLeadStageNote докстринга,
   * не версионировано — тот же принцип независимости от остального лида,
   * что updateChecklist выше (заметка одной стадии не должна конфликтовать
   * с правкой другой стадии или сопутствующих полей).
   */
  async setStageNote(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    stage: string,
    note: { text: string; updatedAt: Date } | null,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const update: Record<string, unknown> =
      note === null ? { $unset: { [`stageNotes.${stage}`]: '' } } : { $set: { [`stageNotes.${stage}`]: note } };
    const result = await this.model
      .updateOne({ _id: id, organizationId, status: { $ne: 'deleted' } }, update, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Soft delete (см. LeadDocument.status докстринг) — лид с историей
   * (LeadEvent/audit/Task/Deal) не может быть физически удалён без потери
   * этой истории. Идемпотентно на "уже удалён": вызывающий код
   * (CrmService.deleteLead) сам решает, звать ли повторно — здесь просто
   * атомарная запись статуса, тот же паттерн, что PositionRepository.
   * closeVacantPosition фильтрует по текущему статусу в самом фильтре.
   */
  async softDelete(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    deletedAt: Date,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $set: { status: 'deleted', deletedAt } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /** GET /leads/:leadId/files, POST .../files — добавляет assetId в конец attachedAssetIds (порядок = порядок прикрепления). */
  async addAttachedAsset(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    assetId: Types.ObjectId,
    session?: ClientSession,
    fileName?: string,
  ): Promise<{ modifiedCount: number }> {
    const update: Record<string, unknown> = { $addToSet: { attachedAssetIds: assetId } };
    if (fileName) {
      update.$set = { [`attachedFileNames.${assetId.toString()}`]: fileName };
    }
    const result = await this.model
      .updateOne({ _id: id, organizationId, status: { $ne: 'deleted' } }, update, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /** DELETE /leads/:leadId/files/:assetId — убирает assetId из attachedAssetIds. */
  async removeAttachedAsset(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    assetId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $pull: { attachedAssetIds: assetId }, $unset: { [`attachedFileNames.${assetId.toString()}`]: 1 } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * `[lead-legacy-migration-tool]`: единственная точка поиска уже
   * мигрированного лида — тот же (organizationId, legacyId), что unique
   * partial-индекс на схеме. Идемпотентность importLegacyLeads целиком
   * опирается на этот метод: найден → updateFields, не найден → createFromMigration.
   */
  async findByLegacyId(
    organizationId: Types.ObjectId,
    legacyId: string,
    session?: ClientSession,
  ): Promise<LeadDocument | null> {
    return this.model.findOne({ organizationId, legacyId }, null, { session }).exec();
  }

  /**
   * `[lead-legacy-migration-tool]`: отдельный от `create()` метод — тот не
   * принимает явный `createdAt`/сопутствующие поля лида и используется всеми
   * остальными HTTP-путями (reveal-contact, ручная форма, CSV-импорт), где
   * `createdAt` обязан быть моментом реального вызова. Миграция переносит
   * НАСТОЯЩУЮ историческую дату создания легаси-лида — явно передаёт её сюда.
   * Mongoose timestamps-плагин НЕ перезаписывает уже установленное значение
   * `createdAt` на новом документе (см. LeadMigrationService докстринг и
   * lead-migration-timestamps.integration-spec.ts — экспериментально
   * подтверждено, не предположение).
   */
  async createFromMigration(
    params: {
      organizationId: Types.ObjectId;
      contactId: Types.ObjectId;
      legacyId: string;
      source: LeadSource;
      productType?: LeadProductType;
      stage: LeadStage;
      realtorStage?: RealtorStage;
      curatorStage?: CuratorStage;
      ownerPositionId?: Types.ObjectId;
      city?: string;
      notes?: string;
      tags?: string[];
      dealValue?: number;
      budgetValue?: number;
      budgetCurrency?: string;
      expectedCloseDate?: string;
      rejectionReason?: string;
      rejectionComment?: string;
      createdAt: Date;
    },
    session?: ClientSession,
  ): Promise<LeadDocument> {
    const [doc] = await this.model.create([{ ...params }], { session });
    return doc!;
  }

  /**
   * GET /crm/reports/positions — количество лидов на позицию (ownerPositionId)
   * за период (`createdAt`), с разбивкой по текущей стадии. Текущее
   * состояние Lead, НЕ событийная история (в отличие от
   * LeadEventRepository.aggregateStageFunnel) — отчёт по позиции отвечает
   * на вопрос "сколько лидов сейчас в работе у сотрудника и на каком этапе
   * они СЕЙЧАС", не "через какие стадии они проходили". `ownerPositionId:
   * null` группирует ещё не назначенные лиды отдельной строкой — CrmService
   * решает, показывать её вызывающему или отбросить.
   */
  async aggregateByOwnerPosition(
    organizationId: Types.ObjectId,
    params: { from?: Date; to?: Date },
  ): Promise<Array<{ ownerPositionId: Types.ObjectId | null; stage: LeadStage; count: number }>> {
    const match: Record<string, unknown> = { organizationId, status: { $ne: 'deleted' } };
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) createdAt.$gte = params.from;
      if (params.to) createdAt.$lte = params.to;
      match.createdAt = createdAt;
    }

    return this.model
      .aggregate<{ ownerPositionId: Types.ObjectId | null; stage: LeadStage; count: number }>([
        { $match: match },
        {
          $group: {
            _id: { ownerPositionId: { $ifNull: ['$ownerPositionId', null] }, stage: '$stage' },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            ownerPositionId: '$_id.ownerPositionId',
            stage: '$_id.stage',
            count: 1,
          },
        },
      ])
      .exec();
  }

  async aggregateTimeseries(
    organizationId: Types.ObjectId,
    params: { from?: Date; to?: Date; ownerPositionId?: Types.ObjectId },
  ): Promise<Array<{ date: string; count: number }>> {
    const match: Record<string, unknown> = { organizationId, status: { $ne: 'deleted' } };
    if (params.ownerPositionId) {
      match.ownerPositionId = params.ownerPositionId;
    }
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) createdAt.$gte = params.from;
      if (params.to) createdAt.$lte = params.to;
      match.createdAt = createdAt;
    }

    return this.model
      .aggregate<{ date: string; count: number }>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
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
