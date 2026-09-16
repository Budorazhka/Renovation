import { ConflictException, Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { IdentityRepository } from './repository/identity.repository';
import { ProductAccessRepository } from './repository/product-access.repository';
import { SessionService } from './session.service';
import type { ProductAudience } from './schemas/session.schema';
import type { ProductAccessProduct } from './schemas/product-access.schema';
import type { IdentityDocument } from './schemas/identity.schema';

/**
 * OpenAPI `/auth/login` + ADR-004. Единый auth-модуль для всех трёх
 * product audience (не три копии auth-логики, ADR-004 Operational impact) —
 * audience определяется вызывающим кодом (AuthController) по Origin
 * запроса, не полем в теле, этот сервис принимает уже резолвленный audience.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly productAccessRepository: ProductAccessRepository,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * ADR-004: marketplace НЕ требует ProductAccess (базовый доступ любой
   * активной Identity) — erp/admin требуют явного гранта, иначе
   * AUTH_INVALID_CREDENTIALS (не отдельный "доступ запрещён" код: не
   * раскрываем гостю разницу между "неверный пароль" и "пароль верный, но
   * нет доступа к этому продукту" — та же non-disclosure логика, что уже
   * применяется к cross-tenant существованию в error-catalog.md).
   */
  /**
   * Общий префикс login()/registerOrganizationOwner (OrganizationsService):
   * найти активную Identity по логину и проверить пароль — БЕЗ проверки
   * ProductAccess/2FA/audience (та часть специфична каждому вызывающему
   * flow). Вынесено отдельно 27.08.2026 — organizations.controller
   * онбординг для нового пользователя должен повторно подтвердить владение
   * Identity (между /auth/register и созданием организации сессии ещё нет),
   * не дублируя anti-enumeration логику login() второй раз.
   */
  private async verifyCredentials(login: string, password: string): Promise<IdentityDocument> {
    const normalizedLogin = login.trim().toLowerCase();
    const identity = await this.identityRepository.findByNormalizedLoginWithPasswordHash(normalizedLogin);

    if (!identity || identity.status !== 'active' || (!identity.passwordHash && !identity.legacyPasswordHash)) {
      // Тот же AUTH_INVALID_CREDENTIALS и для "логин не существует", и для
      // "деактивирован", и для "pending_invite без пароля" — не раскрываем
      // гостю факт существования/состояния аккаунта (anti-enumeration
      // принцип). !identity.passwordHash — явная проверка (invite-flow,
      // ИЗМЕНЕНО): passwordHash теперь optional на схеме, argon2.verify(
      // undefined, ...) не самодостаточная защита, упала бы с TypeError,
      // не с ожидаемым false. legacyPasswordHash расширяет то же условие
      // (ИЗМЕНЕНО, identity-legacy-migration) — Identity без обоих хешей
      // не может пройти ни одним путём ниже.
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid login or password');
    }

    if (identity.passwordHash) {
      const passwordValid = await argon2.verify(identity.passwordHash, password);
      if (!passwordValid) {
        throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid login or password');
      }
      return identity;
    }

    // `[identity-legacy-migration]`: passwordHash отсутствует, но
    // legacyPasswordHash есть — Identity импортирована из старой системы
    // (bcrypt) и ещё ни разу не логинилась здесь. Проверяем bcrypt'ом,
    // не argon2 — старый хеш в принципе не пройдёт argon2.verify (другой
    // формат), это не альтернативная попытка того же пароля, а другой
    // алгоритм хеширования той же сущности "правильный пароль".
    //
    // Что старая система хеширует именно bcrypt — ПРЕДПОЛОЖЕНИЕ (11.09.2026),
    // не проверено на копии базы: см. docs/operations/legacy-migration.md.
    // Хеш другого формата bcryptjs либо отклоняет (false), либо бросает
    // («Invalid salt revision» на `$2x$`) — второе без try/catch стало бы 500
    // вместо «неверный логин или пароль».
    let legacyPasswordValid = false;
    try {
      legacyPasswordValid = await bcrypt.compare(password, identity.legacyPasswordHash!);
    } catch {
      legacyPasswordValid = false;
    }
    if (!legacyPasswordValid) {
      // Тот же AUTH_INVALID_CREDENTIALS, что и обычный неверный пароль —
      // не раскрываем гостю, что аккаунт находится в переходном
      // legacy-состоянии (тот же non-disclosure принцип, что и у
      // pending_invite выше).
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid login or password');
    }

    // Успешная legacy-проверка — единственный момент, когда Identity
    // переходит на argon2 необратимо: fallback-ветка выше для неё больше
    // недостижима на следующем логине (passwordHash уже будет задан).
    const passwordHash = await argon2.hash(password);
    await this.identityRepository.upgradeLegacyPasswordHash(identity._id, passwordHash);

    return identity;
  }

  /**
   * OrganizationsController онбординг (новая identity ещё без организации):
   * подтверждает владение Identity паролем и возвращает identityId — сам
   * flow создания организации+owner+ProductAccess+сессии реализован в
   * OrganizationsService.registerOrganizationOwner (composite-команда,
   * ADR-001 модульная граница — Organizations-модуль не должен напрямую
   * трогать identityRepository/argon2, тот же принцип, что уже применён к
   * findByIds/grantErpAccess).
   */
  async verifyCredentialsForOnboarding(login: string, password: string): Promise<Types.ObjectId> {
    const identity = await this.verifyCredentials(login, password);
    return identity._id;
  }

  async login(params: {
    login: string;
    password: string;
    audience: ProductAudience;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ identityId: Types.ObjectId; requires2fa: boolean; sessionToken: string; sessionExpiresAt: Date }> {
    const identity = await this.verifyCredentials(params.login, params.password);

    if (params.audience !== 'marketplace') {
      const hasAccess = await this.productAccessRepository.hasActiveAccess(
        identity._id,
        params.audience as ProductAccessProduct,
      );
      if (!hasAccess) {
        throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid login or password');
      }
    }

    if (identity.twoFactorMethod !== 'none') {
      // 2FA verification flow (второй шаг подтверждения кода) — вне scope
      // этого первого прохода auth-модуля, не реализовано нигде в кодовой
      // базе. Session здесь НЕ создаётся — requires2fa:true сигнализирует
      // клиенту, что логин не завершён, а не что он завершён с доп. шагом
      // после. Честный пробел, зафиксирован явно, не молчаливая заглушка.
      throw new AppException(
        ErrorCode.AUTH_2FA_REQUIRED,
        '2FA verification is not implemented in this pass — identity requires 2FA to complete login',
      );
    }

    const session = await this.sessionService.createSession({
      identityId: identity._id,
      productAudience: params.audience,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return {
      identityId: identity._id,
      requires2fa: false,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    };
  }

  /**
   * domain-model.md Module 1 Identity commands: `register`. Не в узкой
   * D-07 OpenAPI-спеке (v1-first-vertical-slice.yaml специфицирует только
   * /auth/login) — тот же паттерн, что unit.price.update/status.update в
   * D-01: реализовано, потому что уже часть command-модели domain-model.md,
   * не изобретено с нуля. Без этой команды НИ ОДНА Identity не может
   * появиться в системе никаким путём — createOrganizationWithOwner
   * принимает ownerIdentityId как уже существующий параметр, не создаёт
   * его сам.
   *
   * passwordHash хешируется здесь (argon2id — библиотечный дефолт,
   * совпадает с domain-model.md "Argon2id" требованием без явных опций),
   * не в repository — та же граница ответственности, что verify() в login().
   */
  /**
   * Смена своего пароля вошедшим: текущий пароль подтверждает, что за
   * клавиатурой владелец аккаунта (украденная cookie сама по себе пароль не
   * меняет). Проверяется тот же способ, которым человек входит — argon2 или
   * унаследованный bcrypt (`[identity-legacy-migration]`); новый пароль
   * хешируется argon2, старый bcrypt-хеш снимается.
   *
   * Прочие сессии человека закрываются: после смены пароля чужое устройство
   * не должно остаться внутри. Текущая сессия сохраняется — иначе человек
   * выбрасывал бы сам себя нажатием «Сохранить».
   */
  async changePassword(params: {
    identityId: Types.ObjectId;
    currentPassword: string;
    newPassword: string;
    currentSessionToken?: string;
  }): Promise<{ revokedSessions: number }> {
    const identity = await this.identityRepository.findByIdWithPasswordHash(params.identityId);
    if (!identity || identity.status !== 'active') {
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid current password');
    }
    if (!(await this.passwordMatches(identity, params.currentPassword))) {
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid current password');
    }
    if (params.currentPassword === params.newPassword) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'New password must differ from the current one');
    }

    const passwordHash = await argon2.hash(params.newPassword);
    const { modifiedCount } = await this.identityRepository.setPassword(params.identityId, passwordHash);
    if (modifiedCount === 0) {
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid current password');
    }

    const revokedSessions = params.currentSessionToken
      ? await this.sessionService.revokeOtherSessions(params.identityId, params.currentSessionToken)
      : 0;
    return { revokedSessions };
  }

  /** Проверка пароля уже найденной Identity: argon2, а для непереведённой из старой системы — bcrypt. */
  private async passwordMatches(identity: IdentityDocument, password: string): Promise<boolean> {
    if (identity.passwordHash) {
      return argon2.verify(identity.passwordHash, password);
    }
    if (!identity.legacyPasswordHash) return false;
    try {
      return await bcrypt.compare(password, identity.legacyPasswordHash);
    } catch {
      return false;
    }
  }

  async registerIdentity(params: { login: string; password: string }): Promise<Types.ObjectId> {
    const normalizedLogin = params.login.trim().toLowerCase();
    const passwordHash = await argon2.hash(params.password);

    try {
      const identity = await this.identityRepository.create({ normalizedLogin, passwordHash });
      return identity._id;
    } catch (error) {
      // normalizedLogin unique index (IdentityDocument) — domain-model.md
      // invariant "уникален глобально". Тот же паттерн перевода MongoDB
      // duplicate key error (code 11000) в доменную ConflictException,
      // что уже применён в PositionAssignmentRepository.createAssignment.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('This login is already registered');
      }
      throw error;
    }
  }

  /**
   * ADR-003/ADR-004: "создание позиции автоматически подразумевает
   * ProductAccess к ERP для этой identity" — вызывается из
   * OrganizationsService.assignOccupant, не напрямую ProductAccessRepository
   * (module-boundaries тест C-03 запрещает импорт repository другого
   * модуля напрямую — тот же принцип, что уже применён к
   * PolicyEvaluatorService.grant() в D-06).
   */
  async grantErpAccess(identityId: Types.ObjectId): Promise<void> {
    await this.productAccessRepository.grantIfNotActive(identityId, 'erp');
  }

  /**
   * ADR-004: Admin — отдельный product audience, поэтому AdminAccount сам
   * по себе недостаточен для входа. Вызывается только из
   * AdminAccountService внутри его транзакции: account + ProductAccess +
   * audit должны коммититься либо откатываться вместе.
   */
  async grantAdminAccess(identityId: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.productAccessRepository.grantIfNotActive(identityId, 'admin', session);
  }

  /**
   * Не вызывается пока нигде в кодовой базе (vacatePosition отзывает
   * СЕССИИ, не ProductAccess — человек может временно не занимать позицию,
   * но сохранить право доступа к ERP при повторном назначении; отзыв самого
   * доступа — отдельное явное административное действие, не автоматическое
   * следствие vacate). Метод существует для симметрии API и будущего
   * явного "отозвать ERP-доступ у identity" действия.
   */
  async revokeErpAccess(identityId: Types.ObjectId): Promise<void> {
    await this.productAccessRepository.revokeAllForIdentity(identityId, 'erp');
  }

  /**
   * Read-only lookup для внешних модулей (TeamService/team-users read-model,
   * ADR-002 требование 2/module-boundaries тест — IdentityRepository не
   * должен импортироваться напрямую другими модулями). Возвращает ТОЛЬКО
   * безопасное подмножество полей (не весь IdentityDocument — passwordHash
   * никогда не покидает этот метод, select:false на схеме и так не
   * возвращает его по умолчанию, но явное сужение здесь фиксирует контракт
   * для вызывающего кода независимо от схемы).
   */
  async findByIds(ids: Types.ObjectId[]): Promise<Array<{ id: Types.ObjectId; normalizedLogin: string; status: string }>> {
    const identities = await this.identityRepository.findByIds(ids);
    return identities.map((i) => ({ id: i._id, normalizedLogin: i.normalizedLogin, status: i.status }));
  }

  /**
   * domain-model.md Module 1 Identity command `deactivate` — teamApi.ts::
   * setStatus(id, 'blocked') резолвится в эту команду через TeamService
   * (Position→текущий occupant Identity, не Position сама по себе — status
   * в TeamUser-контракте фронтенда описывает СОТРУДНИКА, не позицию).
   * Немедленно отзывает ERP-сессии — та же семантика, что vacatePosition
   * (uволенный/заблокированный сотрудник теряет доступ мгновенно, не по
   * истечении TTL).
   */
  async deactivateIdentity(identityId: Types.ObjectId): Promise<void> {
    await this.identityRepository.updateStatus(identityId, 'deactivated');
    await this.sessionService.revokeAllErpSessions(identityId);
  }

  /**
   * teamApi.ts::setStatus(id, 'active') — обратная команда, не отдельная
   * бизнес-логика (симметрично deactivateIdentity, без revoke — реактивация
   * не должна создавать сессию сама по себе, человек логинится заново).
   */
  async reactivateIdentity(identityId: Types.ObjectId): Promise<void> {
    await this.identityRepository.updateStatus(identityId, 'active');
  }

  /**
   * assignOccupant-invite-flow (organizations.service.ts): резолвит email в
   * Identity — существующая (любого статуса, включая pending_invite от
   * прошлого незавершённого приглашения) линкуется как есть, иначе
   * создаётся новая pending_invite Identity без пароля. isNew различает
   * "нужен ли inviteToken" от вызывающего кода — не дублирует эту логику
   * там же.
   */
  async findOrCreatePendingIdentity(login: string): Promise<{ identityId: Types.ObjectId; isNew: boolean }> {
    const normalizedLogin = login.trim().toLowerCase();
    const existing = await this.identityRepository.findByNormalizedLogin(normalizedLogin);
    if (existing) {
      return { identityId: existing._id, isNew: false };
    }

    try {
      const identity = await this.identityRepository.createPendingInvite(normalizedLogin);
      return { identityId: identity._id, isNew: true };
    } catch (error) {
      // Гонка: другой запрос создал Identity с тем же normalizedLogin между
      // findByNormalizedLogin и createPendingInvite здесь — тот же паттерн
      // перевода duplicate key error в доменную обработку, что
      // registerIdentity выше. Не ConflictException наружу — просто
      // разрешаем гонку, находя запись, которую только что создал конкурент.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const raced = await this.identityRepository.findByNormalizedLogin(normalizedLogin);
        if (raced) {
          return { identityId: raced._id, isNew: false };
        }
      }
      throw error;
    }
  }

  /**
   * POST /invite/:token/activate (InvitationService, публичный endpoint):
   * приглашённый ставит себе пароль впервые. modifiedCount:0 означает
   * Identity уже не pending_invite (повторная активация — вызывающий код
   * различает это от "не найдена" по отдельной проверке).
   */
  async activatePendingIdentity(identityId: Types.ObjectId, password: string): Promise<{ activated: boolean }> {
    const passwordHash = await argon2.hash(password);
    const { modifiedCount } = await this.identityRepository.setPasswordAndActivate(identityId, passwordHash);
    return { activated: modifiedCount > 0 };
  }
}
