import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IdentityDocument, type IdentityStatus } from '../schemas/identity.schema';

/**
 * Единственная точка доступа к коллекции identities (ADR-002 требование 2).
 */
@Injectable()
export class IdentityRepository {
  constructor(@InjectModel(IdentityDocument.name) private readonly model: Model<IdentityDocument>) {}

  /**
   * passwordHash/legacyPasswordHash имеют `select: false` в схеме (не
   * должны утекать в обычные find/toJSON по умолчанию) — auth-flow явный
   * единственный легитимный потребитель, запрашивает оба явно через
   * `.select('+passwordHash +legacyPasswordHash')`. legacyPasswordHash
   * нужен здесь же (не отдельным запросом) — verifyCredentials должен
   * увидеть оба поля одним чтением, чтобы решить, каким алгоритмом
   * проверять пароль (см. auth.service.ts::verifyCredentials).
   */
  async findByNormalizedLoginWithPasswordHash(normalizedLogin: string): Promise<IdentityDocument | null> {
    return this.model.findOne({ normalizedLogin }).select('+passwordHash +legacyPasswordHash').exec();
  }

  /**
   * `[identity-legacy-migration]`: вызывается verifyCredentials ровно один
   * раз на Identity — сразу после первой успешной bcrypt-проверки
   * `legacyPasswordHash`. Атомарно завершает переходное окно: новый argon2
   * хеш занимает место `passwordHash`, `legacyPasswordHash` удаляется —
   * повторный логин той же Identity уже пойдёт обычным argon2-путём выше,
   * fallback-ветка для неё больше недостижима.
   *
   * Фильтр по `legacyPasswordHash: {$exists: true}`: если между проверкой и
   * этой записью пароль уже сменили (восстановление, второй параллельный
   * вход), новый passwordHash не затирается хешем старого пароля.
   */
  async upgradeLegacyPasswordHash(id: Types.ObjectId, passwordHash: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, legacyPasswordHash: { $exists: true } },
        { $set: { passwordHash }, $unset: { legacyPasswordHash: 1 } },
      )
      .exec();
  }

  /**
   * assignOccupant-invite-flow (organizations.service.ts): найти существующую
   * Identity по email БЕЗ пароля — не auth-путь, просто existence-check
   * перед решением "линковать существующую" vs "создать pending_invite".
   */
  async findByNormalizedLogin(normalizedLogin: string): Promise<IdentityDocument | null> {
    return this.model.findOne({ normalizedLogin }).exec();
  }

  async findById(id: Types.ObjectId): Promise<IdentityDocument | null> {
    return this.model.findOne({ _id: id }).exec();
  }

  /** Смена пароля вошедшим: текущий пароль сверяется по хешу этой же Identity, не по логину. */
  async findByIdWithPasswordHash(id: Types.ObjectId): Promise<IdentityDocument | null> {
    return this.model.findOne({ _id: id }).select('+passwordHash +legacyPasswordHash').exec();
  }

  /**
   * Новый пароль активной Identity. `legacyPasswordHash` снимается: после
   * смены пароля старый bcrypt-хеш не должен оставаться вторым рабочим
   * ключом (тот же принцип, что upgradeLegacyPasswordHash выше).
   */
  async setPassword(id: Types.ObjectId, passwordHash: string): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne({ _id: id, status: 'active' }, { $set: { passwordHash }, $unset: { legacyPasswordHash: 1 } })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * team-users read-model (TeamController.list): батчевое чтение вместо
   * N отдельных findById на N занятых позиций организации.
   */
  async findByIds(ids: Types.ObjectId[]): Promise<IdentityDocument[]> {
    return this.model.find({ _id: { $in: ids } }).exec();
  }

  /**
   * passwordHash уже захеширован вызывающим кодом (AuthService — тот же
   * единственный сервис, что делает argon2.verify на login-пути, argon2.hash
   * живёт там же, не здесь: repository не должен решать, каким алгоритмом
   * хешировать пароль — это забота auth-домена, не data-access слоя).
   */
  async create(params: { normalizedLogin: string; passwordHash: string }): Promise<IdentityDocument> {
    return this.model.create(params);
  }

  /**
   * assignOccupant-invite-flow: Identity для человека, который ещё не
   * поставил себе пароль — passwordHash отсутствует, status:'pending_invite'
   * (login() отклоняет такую Identity явно, см. auth.service.ts).
   */
  async createPendingInvite(normalizedLogin: string): Promise<IdentityDocument> {
    return this.model.create({ normalizedLogin, status: 'pending_invite' });
  }

  /**
   * POST /invite/:token/activate — приглашённый ставит себе пароль
   * впервые, pending_invite → active необратимо. Условие status:'pending_invite'
   * в фильтре enforced на уровне запроса — повторная активация уже
   * активной Identity невозможна (modifiedCount:0 сигнализирует об этом
   * вызывающему коду).
   */
  async setPasswordAndActivate(id: Types.ObjectId, passwordHash: string): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne({ _id: id, status: 'pending_invite' }, { $set: { passwordHash, status: 'active' } })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * domain-model.md Module 1 Identity command `deactivate` — единственный
   * mutation-метод для status/deactivatedAt. reactivate (status→'active')
   * переиспользует этот же метод (симметрично), не отдельная команда.
   */
  async updateStatus(id: Types.ObjectId, status: IdentityStatus): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id },
        status === 'active'
          ? { $set: { status }, $unset: { deactivatedAt: 1 } }
          : { $set: { status, deactivatedAt: new Date() } },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }
}
