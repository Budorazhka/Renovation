import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PositionAssignmentDocument } from '../schemas/position-assignment.schema';

/**
 * Единственная точка доступа к коллекции position_assignments (ADR-002 требование 2).
 */
@Injectable()
export class PositionAssignmentRepository {
  constructor(
    @InjectModel(PositionAssignmentDocument.name)
    private readonly model: Model<PositionAssignmentDocument>,
  ) {}

  async findActiveByIdentity(
    identityId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PositionAssignmentDocument | null> {
    return this.model.findOne({ identityId, endedAt: { $exists: false } }, null, { session }).exec();
  }

  async findActiveByPosition(
    positionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PositionAssignmentDocument | null> {
    return this.model.findOne({ positionId, endedAt: { $exists: false } }, null, { session }).exec();
  }

  /**
   * team-users read-model: все АКТИВНЫЕ assignment организации разом — не
   * по одному, чтобы TeamController.list не делал N+1 запросов на N позиций.
   */
  async findAllActiveByOrganization(organizationId: Types.ObjectId): Promise<PositionAssignmentDocument[]> {
    return this.model.find({ organizationId, endedAt: { $exists: false } }).exec();
  }

  /** Все, кто сейчас занимает позицию в какой-либо организации: получатели новостей платформы. */
  async findActiveIdentityIds(): Promise<Types.ObjectId[]> {
    return this.model.distinct('identityId', { endedAt: { $exists: false } }).exec();
  }

  /**
   * ADR-003: enforced на уровне БД через partial unique index — при попытке
   * создать второй активный assignment для той же identity/position MongoDB
   * вернёт duplicate key error (code 11000), перехватываем и превращаем
   * в доменную ошибку, не даём сырому Mongo-исключению утечь наружу.
   */
  async createAssignment(
    params: {
      identityId: Types.ObjectId;
      positionId: Types.ObjectId;
      organizationId: Types.ObjectId;
    },
    session?: ClientSession,
  ): Promise<PositionAssignmentDocument> {
    try {
      const [doc] = await this.model.create(
        [
          {
            identityId: params.identityId,
            positionId: params.positionId,
            organizationId: params.organizationId,
            startedAt: new Date(),
          },
        ],
        { session },
      );
      return doc!;
    } catch (err: unknown) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException(
          'Identity или Position уже имеет активный PositionAssignment (IAM-002/IAM-003)',
        );
      }
      throw err;
    }
  }

  /**
   * endedAt:{$exists:false} в фильтре (ИСПРАВЛЕНО, second-opinion ревью) —
   * раньше фильтр был только по _id, значит конкурентный повторный вызов
   * (два одновременных vacate той же позиции/assignment) мог перезаписать
   * endedAt/handoverNote более поздним значением поверх уже завершённого
   * assignment. matchedCount:0 сигнализирует вызывающему коду, что
   * assignment уже был завершён кем-то другим — та же TOCTOU-защита, что
   * partial unique index даёт createAssignment для occupied-случая.
   */
  async endAssignment(
    assignmentId: Types.ObjectId,
    handoverNote?: string,
    session?: ClientSession,
  ): Promise<{ matchedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: assignmentId, endedAt: { $exists: false } },
        { $set: { endedAt: new Date(), handoverNote } },
        { session },
      )
      .exec();
    return { matchedCount: result.matchedCount };
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 11000
    );
  }
}
