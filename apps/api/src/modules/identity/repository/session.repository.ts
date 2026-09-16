import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SessionDocument, type ProductAudience } from '../schemas/session.schema';

/**
 * Единственная точка доступа к коллекции sessions (ADR-002 требование 2).
 * Никакой другой файл в этом модуле не импортирует SessionDocument-модель
 * напрямую — только через методы этого класса.
 */
@Injectable()
export class SessionRepository {
  constructor(@InjectModel(SessionDocument.name) private readonly model: Model<SessionDocument>) {}

  async create(params: {
    identityId: Types.ObjectId;
    productAudience: ProductAudience;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<SessionDocument> {
    return this.model.create(params);
  }

  async findActiveByTokenHash(
    tokenHash: string,
    productAudience: ProductAudience,
  ): Promise<SessionDocument | null> {
    return this.model
      .findOne({
        tokenHash,
        productAudience,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .exec();
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await this.model.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } }).exec();
  }

  /**
   * ADR-003: вызывается из vacatePosition — отзывает только ERP-сессии
   * этой identity, не трогает marketplace/admin сессии того же человека.
   */
  /**
   * Смена пароля: все прочие сессии человека обесцениваются, текущая
   * остаётся — иначе тот, кто только что сменил пароль, тут же оказывался бы
   * выброшен из своего же окна.
   */
  async revokeAllForIdentityExceptToken(identityId: Types.ObjectId, tokenHash: string): Promise<number> {
    const result = await this.model
      .updateMany(
        { identityId, revokedAt: { $exists: false }, tokenHash: { $ne: tokenHash } },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
    return result.modifiedCount;
  }

  async revokeAllForIdentity(identityId: Types.ObjectId, productAudience?: ProductAudience): Promise<void> {
    const filter: Record<string, unknown> = { identityId, revokedAt: { $exists: false } };
    if (productAudience) {
      filter.productAudience = productAudience;
    }
    await this.model.updateMany(filter, { $set: { revokedAt: new Date() } }).exec();
  }
}
