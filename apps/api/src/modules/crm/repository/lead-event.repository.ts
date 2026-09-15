import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { LeadEventDocument, LeadEventChangedBy } from '../schemas/lead-event.schema';
import type { LeadStage } from '../schemas/lead.schema';

/**
 * Единственная точка доступа к коллекции lead_events (ADR-002 требование
 * 2). Намеренно БЕЗ update/delete методов вообще — append-only, тот же
 * принцип, что AuditEventRepository (Module 3).
 */
@Injectable()
export class LeadEventRepository {
  constructor(
    @InjectModel(LeadEventDocument.name) private readonly model: Model<LeadEventDocument>,
  ) {}

  async append(
    params: {
      leadId: Types.ObjectId;
      organizationId: Types.ObjectId;
      stage: LeadStage;
      changedBy: LeadEventChangedBy;
      comment?: string;
      /**
       * `[lead-legacy-migration-tool]`: явная историческая дата перехода —
       * опционально, только для миграции (обычные HTTP-переходы стадии не
       * знают "прошлой" даты, changedAt для них всегда текущий момент через
       * timestamps-плагин). Тот же подтверждённый механизм, что
       * LeadRepository.createFromMigration: mongoose не перезаписывает уже
       * установленное значение.
       */
      changedAt?: Date,
    },
    session?: ClientSession,
  ): Promise<void> {
    await this.model.create([params], { session });
  }

  /**
   * GET /leads/:leadId/events — cursor pagination по `_id`, тот же принцип,
   * что LeadRepository.listForOrganization/AuditEventRepository.listForAdmin:
   * ObjectId монотонно возрастает и уникален, `_id`-курсор не имеет
   * дублей/пропусков даже когда несколько событий одного лида записаны в
   * одну транзакцию (одинаковый changedAt). Newest-first (`$lt` на курсор).
   * organizationId в фильтре — defense-in-depth, не единственная граница
   * tenant/owner-изоляции: вызывающий код (CrmService.listLeadEvents)
   * обязан проверить, что сам lead принадлежит organization/owner scope
   * ДО вызова этого метода (см. его докстринг) — 404 для чужого/
   * несуществующего лида решается на уровне lead, не lead_events.
   */
  async listForLead(
    leadId: Types.ObjectId,
    organizationId: Types.ObjectId,
    params?: { cursor?: Types.ObjectId; limit?: number },
  ): Promise<LeadEventDocument[]> {
    const filter: Record<string, unknown> = { leadId, organizationId };
    if (params?.cursor) {
      filter._id = { $lt: params.cursor };
    }
    let query = this.model.find(filter).sort({ _id: -1 });
    if (params?.limit) {
      query = query.limit(params.limit);
    }
    return query.exec();
  }

  async listForLeadIds(
    organizationId: Types.ObjectId,
    leadIds: Types.ObjectId[],
  ): Promise<LeadEventDocument[]> {
    if (leadIds.length === 0) return [];
    return this.model.find({ organizationId, leadId: { $in: leadIds } }).sort({ _id: -1 }).exec();
  }

  /**
   * Воронка лидов за период (GET /crm/reports/lead-funnel) — считает, СКОЛЬКО
   * РАЗНЫХ лидов побывало в каждой стадии за диапазон `changedAt`, не
   * количество событий. Лид, переходивший в одну и ту же стадию несколько
   * раз (например `callback` → `objections` → `callback`), обязан быть
   * посчитан в `callback` РОВНО ОДИН РАЗ — иначе конверсия по стадии была бы
   * задвоена количеством повторных заходов, а не количеством уникальных
   * лидов (owner decision этого прохода, зафиксировано в задаче: "учти, что
   * лид может проходить одну стадию много раз — важно не задвоить
   * конверсию"). Первый `$group` по паре (leadId, stage) схлопывает повторы
   * ДО подсчёта, второй `$group` считает уникальных лидов на стадию.
   *
   * `stages` — опциональный фильтр (см. stageIdsForProduct) для сужения на
   * стадии конкретного productType; без него считаются вообще все события
   * организации за период (продуктовая свобода воронки решается вызывающим
   * сервисом, не этим методом).
   */
  async aggregateStageFunnel(
    organizationId: Types.ObjectId,
    params: { stages?: string[]; from?: Date; to?: Date },
  ): Promise<Array<{ stage: string; leadCount: number }>> {
    const match: Record<string, unknown> = { organizationId };
    if (params.stages) {
      match.stage = { $in: params.stages };
    }
    if (params.from || params.to) {
      const changedAt: Record<string, Date> = {};
      if (params.from) changedAt.$gte = params.from;
      if (params.to) changedAt.$lte = params.to;
      match.changedAt = changedAt;
    }

    return this.model
      .aggregate<{ stage: string; leadCount: number }>([
        { $match: match },
        { $group: { _id: { leadId: '$leadId', stage: '$stage' } } },
        { $group: { _id: '$_id.stage', leadCount: { $sum: 1 } } },
        { $project: { _id: 0, stage: '$_id', leadCount: 1 } },
      ])
      .exec();
  }

  /**
   * Факт по плану «показы»: сколько разных лидов сотрудник перевёл на стадию
   * (например 'showing') в периоде — по changedBy.positionId события.
   */
  async countLeadsMovedToStageByPosition(
    organizationId: Types.ObjectId,
    stage: string,
    params: { from: Date; to: Date },
  ): Promise<Array<{ positionId: Types.ObjectId; count: number }>> {
    return this.model
      .aggregate<{ positionId: Types.ObjectId; count: number }>([
        {
          $match: {
            organizationId,
            stage,
            'changedBy.type': 'position',
            changedAt: { $gte: params.from, $lte: params.to },
          },
        },
        { $group: { _id: { positionId: '$changedBy.positionId', leadId: '$leadId' } } },
        { $group: { _id: '$_id.positionId', count: { $sum: 1 } } },
        { $project: { _id: 0, positionId: '$_id', count: 1 } },
      ])
      .exec();
  }
}
