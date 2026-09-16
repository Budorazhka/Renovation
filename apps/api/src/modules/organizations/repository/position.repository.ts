import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { PositionDocument, type FixedRole } from '../schemas/position.schema';

/**
 * Единственная точка доступа к коллекции positions (ADR-002 требование 2).
 */
@Injectable()
export class PositionRepository {
  constructor(@InjectModel(PositionDocument.name) private readonly model: Model<PositionDocument>) {}

  async create(
    params: { organizationId: Types.ObjectId; fixedRole: FixedRole; parentPositionId?: Types.ObjectId },
    session?: ClientSession,
  ): Promise<PositionDocument> {
    const [doc] = await this.model.create(
      [
        {
          organizationId: params.organizationId,
          fixedRole: params.fixedRole,
          parentPositionId: params.parentPositionId,
          status: 'vacant',
        },
      ],
      { session },
    );
    return doc!;
  }

  async findById(id: Types.ObjectId): Promise<PositionDocument | null> {
    return this.model.findById(id).exec();
  }

  /** Пакетное чтение по id, взятым из активных назначений людей (OrganizationsService.getPeopleSummaries). */
  async findByIds(ids: Types.ObjectId[]): Promise<PositionDocument[]> {
    if (ids.length === 0) return [];
    return this.model.find({ _id: { $in: ids } }).exec();
  }

  /**
   * Tenant-scoped lookup (ADR-002 требование 1) — NOT_FOUND единый для
   * "не существует" и "чужая организация", не раскрывает cross-tenant
   * существование, тот же принцип, что assignOccupant.
   */
  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PositionDocument | null> {
    return this.model.findOne({ _id: id, organizationId }, undefined, { session }).exec();
  }

  /**
   * team-users read-model (TeamController.list/ensureTeam): позиции
   * организации в статусе vacant/occupied — фронтенд сам решает, как
   * отображать пустые слоты (TeamUser.vacant). closed ИСКЛЮЧЕНЫ явно —
   * найдено реальным E2E-прогоном: TeamUserView.status enum ('active'|
   * 'blocked'|'invited') не имеет представления для "закрытая позиция",
   * а сама Position.status:'closed' семантически означает "удалена"
   * (teamApi.ts::remove) — оставлять её в списке команды после удаления
   * было бы видимым багом в UI, не просто пробелом типизации.
   */
  async findAllByOrganization(organizationId: Types.ObjectId): Promise<PositionDocument[]> {
    return this.model.find({ organizationId, status: { $ne: 'closed' } }).exec();
  }

  /**
   * Доливка стартовых грантов (DefaultGrantsBackfillService, команда
   * grants-backfill): проход по позициям ВСЕХ организаций пачками по курсору
   * _id. closed — удалённые позиции (см. markClosed), права им не нужны.
   */
  async listNotClosedPage(params: { cursor?: Types.ObjectId; limit: number }): Promise<PositionDocument[]> {
    const filter = params.cursor ? { status: { $ne: 'closed' }, _id: { $gt: params.cursor } } : { status: { $ne: 'closed' } };
    return this.model.find(filter).sort({ _id: 1 }).limit(params.limit).exec();
  }

  async markOccupied(
    positionId: Types.ObjectId,
    occupantName: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: positionId },
        { $set: { status: 'occupied', currentOccupantName: occupantName } },
        { session },
      )
      .exec();
  }

  async markVacant(positionId: Types.ObjectId, session?: ClientSession): Promise<void> {
    await this.model
      .updateOne({ _id: positionId }, { $set: { status: 'vacant' }, $unset: { currentOccupantName: 1 } }, { session })
      .exec();
  }

  /**
   * teamApi.ts::move(id, managerId) — сменить руководителя (parentPositionId).
   * null явно допустим (позиция становится top-level, без родителя) — не
   * $unset, чтобы отличать "явно очищено" от "никогда не было задано" не
   * требуется здесь (parentPositionId и так optional), просто $set: null.
   *
   * matchedCount (не modifiedCount, ИСПРАВЛЕНО, second-opinion ревью):
   * повторный идемпотентный вызов с тем же parentPositionId, что уже стоит
   * на записи, даёт modifiedCount:0 (MongoDB не считает это модификацией),
   * хотя документ реально найден — вызывающий код (changePositionParent)
   * интерпретирует 0 как "позиция не найдена" и ошибочно бросал 404 для
   * логически успешного no-op. matchedCount не подвержен этой проблеме.
   */
  async updateParent(
    positionId: Types.ObjectId,
    parentPositionId: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<{ matchedCount: number }> {
    const result = await this.model
      .updateOne({ _id: positionId }, { $set: { parentPositionId } }, { session })
      .exec();
    return { matchedCount: result.matchedCount };
  }

  /**
   * teamApi.ts::remove(id) — Position lifecycle (domain-model.md Module 2):
   * "vacant → occupied (assignOccupant) → vacant (vacate) → closed (закрытие,
   * ТОЛЬКО из vacant)" — closed, не физическое удаление документа (append-
   * only принцип, распространённый по всей кодовой базе для сущностей с
   * историей — тот же, что endAssignment/deactivate, не delete). Условие
   * `status:'vacant'` в фильтре enforced на уровне запроса, не только
   * проверкой в вызывающем сервисе — modifiedCount:0 сигнализирует либо
   * "не найдена", либо "не vacant", вызывающий код различает через
   * дополнительный lookup (тот же паттерн, что updatePriceWithVersionCheck).
   */
  async markClosed(positionId: Types.ObjectId, session?: ClientSession): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne({ _id: positionId, status: 'vacant' }, { $set: { status: 'closed' } }, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * teamApi.ts::uploadAvatar — привязывает уже подтверждённый MediaAsset
   * (confirmUpload прошёл раньше, вне этого вызова) к позиции.
   */
  async setAvatarAsset(positionId: Types.ObjectId, assetId: Types.ObjectId): Promise<{ matchedCount: number }> {
    const result = await this.model.updateOne({ _id: positionId }, { $set: { avatarAssetId: assetId } }).exec();
    return { matchedCount: result.matchedCount };
  }

  /**
   * N-13 (owner decision 14.09.2026): "риэлтор" — не отдельный флаг
   * согласия, а сам факт наличия занятой Position в организации типа
   * agency/independent_realtor: тип организации выбирается один раз при
   * `POST /organizations/register`, дальше это не переключается point-in-
   * time чекбоксом на человеке. `developer`-организации исключены всегда
   * (тот же принцип, что CommunityService.isMlsEligible). Роли
   * administrator/marketer исключены — им никогда не выдаётся ни один
   * lead/deal-грант (default-role-grants.ts), это не клиентские агенты.
   *
   * `$lookup` вместо двух раздельных запросов: набор организаций нужного
   * типа может быть большим, а курсорная пагинация должна идти по единому
   * порядку _id самой Position, не по внешнему списку id организаций.
   */
  async listPublicRealtors(params: { cursor?: Types.ObjectId; limit: number; city?: string }): Promise<PositionDocument[]> {
    const match: Record<string, unknown> = {
      status: 'occupied',
      fixedRole: { $in: ['owner', 'director', 'rop', 'manager'] },
    };
    if (params.cursor) match._id = { $lt: params.cursor };

    // City lives on PositionProfile (a different collection) — filtering it
    // requires its own $lookup rather than a top-level $match field, since
    // Position itself has no city field.
    const cityStages: PipelineStage[] = params.city
      ? [
          { $lookup: { from: 'position_profiles', localField: '_id', foreignField: 'positionId', as: 'profile' } },
          { $match: { 'profile.city': params.city } },
        ]
      : [];

    const docs = await this.model.aggregate([
      { $match: match },
      { $sort: { _id: -1 } },
      {
        $lookup: {
          from: 'organizations',
          let: { orgId: '$organizationId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$orgId'] }, type: { $in: ['agency', 'independent_realtor'] }, status: 'active' } },
            { $project: { _id: 1 } },
          ],
          as: 'eligibleOrg',
        },
      },
      { $match: { eligibleOrg: { $ne: [] } } },
      ...cityStages,
      { $limit: params.limit },
      { $project: { eligibleOrg: 0, profile: 0 } },
    ]);
    return docs.map((doc) => this.model.hydrate(doc));
  }

  async findByIdPublicRealtor(positionId: Types.ObjectId): Promise<PositionDocument | null> {
    const docs = await this.model.aggregate([
      { $match: { _id: positionId, status: 'occupied', fixedRole: { $in: ['owner', 'director', 'rop', 'manager'] } } },
      {
        $lookup: {
          from: 'organizations',
          let: { orgId: '$organizationId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$orgId'] }, type: { $in: ['agency', 'independent_realtor'] }, status: 'active' } },
            { $project: { _id: 1 } },
          ],
          as: 'eligibleOrg',
        },
      },
      { $match: { eligibleOrg: { $ne: [] } } },
      { $limit: 1 },
      { $project: { eligibleOrg: 0 } },
    ]);
    return docs[0] ? this.model.hydrate(docs[0]) : null;
  }
}
