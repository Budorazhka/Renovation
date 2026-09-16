import { ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { IdentityRepository } from './repository/identity.repository';
import type { ProductAccessRepository } from './repository/product-access.repository';
import type { SessionService } from './session.service';

async function makeIdentity(overrides: Partial<{
  status: 'active' | 'deactivated';
  twoFactorMethod: 'none' | 'telegram_bot' | 'totp';
  password: string;
}> = {}) {
  const password = overrides.password ?? 'correct-horse-battery-staple';
  return {
    _id: new Types.ObjectId(),
    normalizedLogin: 'owner@example.com',
    passwordHash: await argon2.hash(password),
    status: overrides.status ?? 'active',
    twoFactorMethod: overrides.twoFactorMethod ?? 'none',
  };
}

describe('AuthService.login', () => {
  it('успешный логин: создаёт session для marketplace без проверки ProductAccess', async () => {
    const identity = await makeIdentity();
    const hasActiveAccessSpy = jest.fn();
    const createSessionSpy = jest.fn().mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      { hasActiveAccess: hasActiveAccessSpy } as unknown as ProductAccessRepository,
      { createSession: createSessionSpy } as unknown as SessionService,
    );

    const result = await service.login({
      login: identity.normalizedLogin,
      password: 'correct-horse-battery-staple',
      audience: 'marketplace',
    });

    expect(hasActiveAccessSpy).not.toHaveBeenCalled();
    expect(createSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ identityId: identity._id, productAudience: 'marketplace' }),
    );
    expect(result.identityId).toBe(identity._id);
    expect(result.requires2fa).toBe(false);
  });

  it('erp audience: проверяет ProductAccess, создаёт session при наличии активного гранта', async () => {
    const identity = await makeIdentity();
    const createSessionSpy = jest.fn().mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      { hasActiveAccess: jest.fn().mockResolvedValue(true) } as unknown as ProductAccessRepository,
      { createSession: createSessionSpy } as unknown as SessionService,
    );

    await service.login({
      login: identity.normalizedLogin,
      password: 'correct-horse-battery-staple',
      audience: 'erp',
    });

    expect(createSessionSpy).toHaveBeenCalled();
  });

  it('erp audience без активного ProductAccess: AUTH_INVALID_CREDENTIALS, session не создаётся', async () => {
    const identity = await makeIdentity();
    const createSessionSpy = jest.fn();

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      { hasActiveAccess: jest.fn().mockResolvedValue(false) } as unknown as ProductAccessRepository,
      { createSession: createSessionSpy } as unknown as SessionService,
    );

    await expect(
      service.login({ login: identity.normalizedLogin, password: 'correct-horse-battery-staple', audience: 'erp' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));

    expect(createSessionSpy).not.toHaveBeenCalled();
  });

  it('неверный пароль: AUTH_INVALID_CREDENTIALS', async () => {
    const identity = await makeIdentity();

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: jest.fn() } as unknown as SessionService,
    );

    await expect(
      service.login({ login: identity.normalizedLogin, password: 'wrong-password', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));
  });

  it('identity не найдена: AUTH_INVALID_CREDENTIALS (не раскрывает отсутствие аккаунта)', async () => {
    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(null) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: jest.fn() } as unknown as SessionService,
    );

    await expect(
      service.login({ login: 'nobody@example.com', password: 'anything', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));
  });

  it('деактивированная identity: AUTH_INVALID_CREDENTIALS (тот же код, что и неверный пароль)', async () => {
    const identity = await makeIdentity({ status: 'deactivated' });

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: jest.fn() } as unknown as SessionService,
    );

    await expect(
      service.login({ login: identity.normalizedLogin, password: 'correct-horse-battery-staple', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));
  });

  /**
   * invite-flow (ИЗМЕНЕНО): passwordHash теперь optional на схеме —
   * pending_invite Identity (создана assignOccupantByEmail для нового
   * человека, ещё не активировавшего приглашение) не должна давать login()
   * пройти дальше проверки статуса. Явная защита в login() против
   * argon2.verify(undefined, ...) — без неё это TypeError, не ожидаемое
   * false/AUTH_INVALID_CREDENTIALS.
   */
  it('pending_invite identity без passwordHash: AUTH_INVALID_CREDENTIALS, не падает TypeError', async () => {
    const identity = {
      _id: new Types.ObjectId(),
      normalizedLogin: 'invited@example.com',
      passwordHash: undefined,
      status: 'pending_invite',
      twoFactorMethod: 'none',
    };

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: jest.fn() } as unknown as SessionService,
    );

    await expect(
      service.login({ login: identity.normalizedLogin, password: 'anything', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));
  });

  /**
   * `[identity-legacy-migration]`: passwordHash отсутствует (Identity
   * импортирована из старой системы), legacyPasswordHash есть — bcrypt-
   * проверка успешна, апгрейд на argon2 должен произойти прозрачно, без
   * дополнительного шага со стороны пользователя.
   */
  it('legacy bcrypt логин: успешен, апгрейдит на argon2 и очищает legacyPasswordHash', async () => {
    const identityId = new Types.ObjectId();
    const legacyPasswordHash = await bcrypt.hash('old-password-123', 10);
    const identity = {
      _id: identityId,
      normalizedLogin: 'legacy@example.com',
      passwordHash: undefined,
      legacyPasswordHash,
      status: 'active',
      twoFactorMethod: 'none',
    };
    const upgradeLegacyPasswordHashSpy = jest.fn().mockResolvedValue(undefined);
    const createSessionSpy = jest.fn().mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });

    const service = new AuthService(
      {
        findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity),
        upgradeLegacyPasswordHash: upgradeLegacyPasswordHashSpy,
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: createSessionSpy } as unknown as SessionService,
    );

    const result = await service.login({
      login: identity.normalizedLogin,
      password: 'old-password-123',
      audience: 'marketplace',
    });

    expect(result.identityId).toBe(identityId);
    expect(upgradeLegacyPasswordHashSpy).toHaveBeenCalledTimes(1);
    const [upgradedId, newPasswordHash] = upgradeLegacyPasswordHashSpy.mock.calls[0] as [
      typeof identityId,
      string,
    ];
    expect(upgradedId).toBe(identityId);
    expect(newPasswordHash).not.toBe(legacyPasswordHash);
    await expect(argon2.verify(newPasswordHash, 'old-password-123')).resolves.toBe(true);
    expect(createSessionSpy).toHaveBeenCalled();
  });

  it('legacy bcrypt логин с неверным паролем: AUTH_INVALID_CREDENTIALS, без апгрейда и без раскрытия legacy-состояния', async () => {
    const legacyPasswordHash = await bcrypt.hash('old-password-123', 10);
    const identity = {
      _id: new Types.ObjectId(),
      normalizedLogin: 'legacy@example.com',
      passwordHash: undefined,
      legacyPasswordHash,
      status: 'active',
      twoFactorMethod: 'none',
    };
    const upgradeLegacyPasswordHashSpy = jest.fn();

    const service = new AuthService(
      {
        findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity),
        upgradeLegacyPasswordHash: upgradeLegacyPasswordHashSpy,
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: jest.fn() } as unknown as SessionService,
    );

    await expect(
      service.login({ login: identity.normalizedLogin, password: 'wrong-password', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));

    expect(upgradeLegacyPasswordHashSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['не-bcrypt хеш, на котором bcryptjs бросает', `$2x$10$${'a'.repeat(53)}`],
    ['md5 вместо bcrypt', 'e10adc3949ba59abbe56e057f20f883e'],
  ])('legacy-хеш другого формата (%s): AUTH_INVALID_CREDENTIALS, а не 500', async (_label, legacyPasswordHash) => {
    const upgradeLegacyPasswordHashSpy = jest.fn();
    const service = new AuthService(
      {
        findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          normalizedLogin: 'legacy@example.com',
          passwordHash: undefined,
          legacyPasswordHash,
          status: 'active',
          twoFactorMethod: 'none',
        }),
        upgradeLegacyPasswordHash: upgradeLegacyPasswordHashSpy,
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: jest.fn() } as unknown as SessionService,
    );

    await expect(
      service.login({ login: 'legacy@example.com', password: 'anything', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }));
    expect(upgradeLegacyPasswordHashSpy).not.toHaveBeenCalled();
  });

  it('обычный argon2-логин не затронут: legacyPasswordHash игнорируется, если passwordHash уже задан', async () => {
    const identity = await makeIdentity();
    const upgradeLegacyPasswordHashSpy = jest.fn();
    const createSessionSpy = jest.fn().mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });

    const service = new AuthService(
      {
        findByNormalizedLoginWithPasswordHash: jest
          .fn()
          .mockResolvedValue({ ...identity, legacyPasswordHash: await bcrypt.hash('irrelevant', 10) }),
        upgradeLegacyPasswordHash: upgradeLegacyPasswordHashSpy,
      } as unknown as IdentityRepository,
      { hasActiveAccess: jest.fn() } as unknown as ProductAccessRepository,
      { createSession: createSessionSpy } as unknown as SessionService,
    );

    const result = await service.login({
      login: identity.normalizedLogin,
      password: 'correct-horse-battery-staple',
      audience: 'marketplace',
    });

    expect(result.identityId).toBe(identity._id);
    expect(upgradeLegacyPasswordHashSpy).not.toHaveBeenCalled();
    expect(createSessionSpy).toHaveBeenCalled();
  });

  it('twoFactorMethod !== none: AUTH_2FA_REQUIRED, session НЕ создаётся', async () => {
    const identity = await makeIdentity({ twoFactorMethod: 'totp' });
    const createSessionSpy = jest.fn();

    const service = new AuthService(
      { findByNormalizedLoginWithPasswordHash: jest.fn().mockResolvedValue(identity) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { createSession: createSessionSpy } as unknown as SessionService,
    );

    await expect(
      service.login({ login: identity.normalizedLogin, password: 'correct-horse-battery-staple', audience: 'marketplace' }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.AUTH_2FA_REQUIRED }));

    expect(createSessionSpy).not.toHaveBeenCalled();
  });
});

describe('AuthService.registerIdentity', () => {
  it('хеширует пароль через argon2 (не хранит plaintext), создаёт Identity через repository', async () => {
    const createdId = new Types.ObjectId();
    const createSpy = jest.fn().mockResolvedValue({ _id: createdId });

    const service = new AuthService(
      { create: createSpy } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const result = await service.registerIdentity({ login: 'New@Example.com', password: 'password123' });

    expect(result).toBe(createdId);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [params] = createSpy.mock.calls[0] as [{ normalizedLogin: string; passwordHash: string }];
    expect(params.normalizedLogin).toBe('new@example.com');
    expect(params.passwordHash).not.toBe('password123');
    // Хеш реально верифицируется тем же argon2, что использует login().
    await expect(argon2.verify(params.passwordHash, 'password123')).resolves.toBe(true);
  });

  it('переводит MongoDB duplicate key error (code 11000) в ConflictException', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const service = new AuthService(
      { create: jest.fn().mockRejectedValue(duplicateKeyError) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    await expect(
      service.registerIdentity({ login: 'existing@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('пробрасывает непредвиденную ошибку без изменений', async () => {
    const unexpectedError = new Error('connection lost');
    const service = new AuthService(
      { create: jest.fn().mockRejectedValue(unexpectedError) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    await expect(
      service.registerIdentity({ login: 'someone@example.com', password: 'password123' }),
    ).rejects.toThrow('connection lost');
  });
});

describe('AuthService.findByIds', () => {
  it('возвращает только безопасное подмножество полей (не passwordHash)', async () => {
    const id = new Types.ObjectId();
    const identity = await makeIdentity();
    const service = new AuthService(
      { findByIds: jest.fn().mockResolvedValue([{ _id: id, normalizedLogin: identity.normalizedLogin, status: 'active' }]) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const [result] = await service.findByIds([id]);

    expect(result).toEqual({ id, normalizedLogin: identity.normalizedLogin, status: 'active' });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('делегирует IdentityRepository.findByIds с переданным массивом id', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    const findByIdsSpy = jest.fn().mockResolvedValue([]);
    const service = new AuthService(
      { findByIds: findByIdsSpy } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    await service.findByIds(ids);

    expect(findByIdsSpy).toHaveBeenCalledWith(ids);
  });
});

describe('AuthService.grantErpAccess / revokeErpAccess', () => {
  it('grantErpAccess вызывает grantIfNotActive с product:erp', async () => {
    const identityId = new Types.ObjectId();
    const grantIfNotActiveSpy = jest.fn().mockResolvedValue(undefined);

    const service = new AuthService(
      {} as unknown as IdentityRepository,
      { grantIfNotActive: grantIfNotActiveSpy } as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    await service.grantErpAccess(identityId);

    expect(grantIfNotActiveSpy).toHaveBeenCalledWith(identityId, 'erp');
  });

  it('revokeErpAccess вызывает revokeAllForIdentity с product:erp', async () => {
    const identityId = new Types.ObjectId();
    const revokeAllForIdentitySpy = jest.fn().mockResolvedValue(undefined);

    const service = new AuthService(
      {} as unknown as IdentityRepository,
      { revokeAllForIdentity: revokeAllForIdentitySpy } as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    await service.revokeErpAccess(identityId);

    expect(revokeAllForIdentitySpy).toHaveBeenCalledWith(identityId, 'erp');
  });
});

describe('AuthService.deactivateIdentity / reactivateIdentity', () => {
  it('deactivateIdentity меняет status на deactivated И немедленно отзывает ERP-сессии', async () => {
    const identityId = new Types.ObjectId();
    const updateStatusSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const revokeAllErpSessionsSpy = jest.fn().mockResolvedValue(undefined);

    const service = new AuthService(
      { updateStatus: updateStatusSpy } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { revokeAllErpSessions: revokeAllErpSessionsSpy } as unknown as SessionService,
    );

    await service.deactivateIdentity(identityId);

    expect(updateStatusSpy).toHaveBeenCalledWith(identityId, 'deactivated');
    expect(revokeAllErpSessionsSpy).toHaveBeenCalledWith(identityId);
  });

  it('reactivateIdentity меняет status на active, НЕ отзывает сессии (их и так нет)', async () => {
    const identityId = new Types.ObjectId();
    const updateStatusSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const revokeAllErpSessionsSpy = jest.fn();

    const service = new AuthService(
      { updateStatus: updateStatusSpy } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { revokeAllErpSessions: revokeAllErpSessionsSpy } as unknown as SessionService,
    );

    await service.reactivateIdentity(identityId);

    expect(updateStatusSpy).toHaveBeenCalledWith(identityId, 'active');
    expect(revokeAllErpSessionsSpy).not.toHaveBeenCalled();
  });
});

describe('AuthService.findOrCreatePendingIdentity', () => {
  it('существующая identity (любого статуса): линкует, isNew:false, не создаёт новую', async () => {
    const existingId = new Types.ObjectId();
    const createSpy = jest.fn();

    const service = new AuthService(
      {
        findByNormalizedLogin: jest.fn().mockResolvedValue({ _id: existingId }),
        createPendingInvite: createSpy,
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const result = await service.findOrCreatePendingIdentity('Existing@Example.com');

    expect(result).toEqual({ identityId: existingId, isNew: false });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('новый email: создаёт pending_invite Identity, isNew:true, normalizedLogin в нижнем регистре', async () => {
    const newId = new Types.ObjectId();
    const createSpy = jest.fn().mockResolvedValue({ _id: newId });

    const service = new AuthService(
      {
        findByNormalizedLogin: jest.fn().mockResolvedValue(null),
        createPendingInvite: createSpy,
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const result = await service.findOrCreatePendingIdentity('New@Example.com ');

    expect(result).toEqual({ identityId: newId, isNew: true });
    expect(createSpy).toHaveBeenCalledWith('new@example.com');
  });

  it('гонка (duplicate key на create): разрешает через повторный findByNormalizedLogin, не пробрасывает ConflictException', async () => {
    const racedId = new Types.ObjectId();
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const findByNormalizedLoginSpy = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: racedId });

    const service = new AuthService(
      {
        findByNormalizedLogin: findByNormalizedLoginSpy,
        createPendingInvite: jest.fn().mockRejectedValue(duplicateKeyError),
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const result = await service.findOrCreatePendingIdentity('race@example.com');

    expect(result).toEqual({ identityId: racedId, isNew: false });
  });

  it('пробрасывает непредвиденную ошибку create без изменений', async () => {
    const unexpectedError = new Error('connection lost');
    const service = new AuthService(
      {
        findByNormalizedLogin: jest.fn().mockResolvedValue(null),
        createPendingInvite: jest.fn().mockRejectedValue(unexpectedError),
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    await expect(service.findOrCreatePendingIdentity('someone@example.com')).rejects.toThrow('connection lost');
  });
});

describe('AuthService.activatePendingIdentity', () => {
  it('хеширует пароль через argon2, делегирует setPasswordAndActivate', async () => {
    const identityId = new Types.ObjectId();
    const setPasswordAndActivateSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const service = new AuthService(
      { setPasswordAndActivate: setPasswordAndActivateSpy } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const result = await service.activatePendingIdentity(identityId, 'new-password-123');

    expect(result).toEqual({ activated: true });
    expect(setPasswordAndActivateSpy).toHaveBeenCalledTimes(1);
    const [id, passwordHash] = setPasswordAndActivateSpy.mock.calls[0] as [typeof identityId, string];
    expect(id).toBe(identityId);
    expect(passwordHash).not.toBe('new-password-123');
    await expect(argon2.verify(passwordHash, 'new-password-123')).resolves.toBe(true);
  });

  it('modifiedCount:0 (уже активирована/не pending) — activated:false', async () => {
    const service = new AuthService(
      { setPasswordAndActivate: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      {} as unknown as SessionService,
    );

    const result = await service.activatePendingIdentity(new Types.ObjectId(), 'password');

    expect(result).toEqual({ activated: false });
  });
});

describe('AuthService.changePassword', () => {
  function makeService(identity: unknown, setPassword = jest.fn().mockResolvedValue({ modifiedCount: 1 })) {
    const revokeOtherSessions = jest.fn().mockResolvedValue(2);
    const service = new AuthService(
      {
        findByIdWithPasswordHash: jest.fn().mockResolvedValue(identity),
        setPassword,
      } as unknown as IdentityRepository,
      {} as unknown as ProductAccessRepository,
      { revokeOtherSessions } as unknown as SessionService,
    );
    return { service, setPassword, revokeOtherSessions };
  }

  it('меняет пароль на argon2-хеш нового и закрывает остальные сессии, текущую оставляет', async () => {
    const identity = await makeIdentity({ password: 'old-password-1' });
    const { service, setPassword, revokeOtherSessions } = makeService(identity);

    const result = await service.changePassword({
      identityId: identity._id,
      currentPassword: 'old-password-1',
      newPassword: 'new-password-2',
      currentSessionToken: 'raw-token',
    });

    expect(result).toEqual({ revokedSessions: 2 });
    const [, passwordHash] = setPassword.mock.calls[0] as [unknown, string];
    await expect(argon2.verify(passwordHash, 'new-password-2')).resolves.toBe(true);
    expect(revokeOtherSessions).toHaveBeenCalledWith(identity._id, 'raw-token');
  });

  it('неверный текущий пароль — AUTH_INVALID_CREDENTIALS, пароль не меняется', async () => {
    const identity = await makeIdentity({ password: 'old-password-1' });
    const { service, setPassword } = makeService(identity);

    await expect(
      service.changePassword({ identityId: identity._id, currentPassword: 'wrong', newPassword: 'new-password-2' }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('новый пароль совпадает с текущим — отказ', async () => {
    const identity = await makeIdentity({ password: 'old-password-1' });
    const { service, setPassword } = makeService(identity);

    await expect(
      service.changePassword({ identityId: identity._id, currentPassword: 'old-password-1', newPassword: 'old-password-1' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('пароль из старой системы (bcrypt) подходит как текущий, новый сохраняется argon2', async () => {
    const identity = {
      _id: new Types.ObjectId(),
      status: 'active',
      legacyPasswordHash: await bcrypt.hash('legacy-password', 4),
    };
    const { service, setPassword } = makeService(identity);

    await service.changePassword({
      identityId: identity._id,
      currentPassword: 'legacy-password',
      newPassword: 'new-password-2',
    });

    const [, passwordHash] = setPassword.mock.calls[0] as [unknown, string];
    await expect(argon2.verify(passwordHash, 'new-password-2')).resolves.toBe(true);
  });

  it('деактивированная identity пароль не меняет', async () => {
    const identity = await makeIdentity({ status: 'deactivated', password: 'old-password-1' });
    const { service, setPassword } = makeService(identity);

    await expect(
      service.changePassword({ identityId: identity._id, currentPassword: 'old-password-1', newPassword: 'new-password-2' }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
    expect(setPassword).not.toHaveBeenCalled();
  });
});
