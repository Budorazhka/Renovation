import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { SessionService } from './session.service';
import type { SessionRepository } from './repository/session.repository';

function makeService(repository: Partial<SessionRepository> = {}): SessionService {
  return new SessionService(repository as SessionRepository);
}

function makeRequest(cookieHeader: string | undefined) {
  return { headers: { cookie: cookieHeader } } as never;
}

describe('SessionService — logout support', () => {
  it('revokeSession хеширует токен и делегирует revokeByTokenHash', async () => {
    const revokeByTokenHashSpy = jest.fn().mockResolvedValue(undefined);
    const service = makeService({ revokeByTokenHash: revokeByTokenHashSpy });

    await service.revokeSession('some-raw-token');

    expect(revokeByTokenHashSpy).toHaveBeenCalledWith(expect.any(String));
    expect(revokeByTokenHashSpy.mock.calls[0][0]).not.toBe('some-raw-token');
  });

  it('revokeSession идемпотентен: повторный вызов с тем же токеном не бросает', async () => {
    const revokeByTokenHashSpy = jest.fn().mockResolvedValue(undefined);
    const service = makeService({ revokeByTokenHash: revokeByTokenHashSpy });

    await service.revokeSession('some-raw-token');
    await service.revokeSession('some-raw-token');

    expect(revokeByTokenHashSpy).toHaveBeenCalledTimes(2);
  });

  it('getRawTokenFromRequest извлекает токен из baza_session cookie', () => {
    const service = makeService();
    const token = service.getRawTokenFromRequest(makeRequest('baza_session=abc123; other=xyz'));
    expect(token).toBe('abc123');
  });

  it('getRawTokenFromRequest возвращает undefined без cookie-заголовка', () => {
    const service = makeService();
    expect(service.getRawTokenFromRequest(makeRequest(undefined))).toBeUndefined();
  });

  it('revokeAllAdminSessions отзывает только admin-audience сессии этой identity', async () => {
    const revokeAllForIdentitySpy = jest.fn().mockResolvedValue(undefined);
    const service = makeService({ revokeAllForIdentity: revokeAllForIdentitySpy });
    const identityId = new Types.ObjectId();

    await service.revokeAllAdminSessions(identityId);

    expect(revokeAllForIdentitySpy).toHaveBeenCalledWith(identityId, 'admin');
  });
});

describe('SessionService.listSessions', () => {
  it('маппит документы репозитория и помечает current по совпадению tokenHash', async () => {
    const identityId = new Types.ObjectId();
    const currentId = new Types.ObjectId();
    const otherId = new Types.ObjectId();
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    const currentTokenHash = createHash('sha256').update('current-raw-token').digest('hex');

    const findActiveByIdentitySpy = jest.fn().mockResolvedValue([
      { _id: currentId, ipAddress: '1.2.3.4', userAgent: 'ua-1', createdAt, tokenHash: currentTokenHash },
      { _id: otherId, ipAddress: '5.6.7.8', userAgent: 'ua-2', createdAt, tokenHash: 'other-hash' },
    ]);
    const service = makeService({ findActiveByIdentity: findActiveByIdentitySpy });

    const result = await service.listSessions(identityId, 'erp', 'current-raw-token');

    expect(findActiveByIdentitySpy).toHaveBeenCalledWith(identityId, 'erp');
    expect(result).toEqual([
      { id: currentId.toString(), ipAddress: '1.2.3.4', userAgent: 'ua-1', createdAt, current: true },
      { id: otherId.toString(), ipAddress: '5.6.7.8', userAgent: 'ua-2', createdAt, current: false },
    ]);
  });

  it('без currentRawToken — ни одна сессия не помечена current', async () => {
    const identityId = new Types.ObjectId();
    const findActiveByIdentitySpy = jest.fn().mockResolvedValue([
      { _id: new Types.ObjectId(), createdAt: new Date(), tokenHash: 'some-hash' },
    ]);
    const service = makeService({ findActiveByIdentity: findActiveByIdentitySpy });

    const result = await service.listSessions(identityId, 'erp');

    expect(result[0]!.current).toBe(false);
  });
});

describe('SessionService.revokeSessionById', () => {
  it('запрещает отзыв текущей сессии: matching _id найденной по currentRawToken', async () => {
    const identityId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const findActiveByTokenHashSpy = jest.fn().mockResolvedValue({ _id: sessionId, equals: (id: Types.ObjectId) => id.equals(sessionId) });
    const revokeByIdSpy = jest.fn();
    const service = makeService({ findActiveByTokenHash: findActiveByTokenHashSpy, revokeById: revokeByIdSpy });

    const result = await service.revokeSessionById(identityId, sessionId, 'erp', 'current-raw-token');

    expect(result).toBe('cannot_revoke_current');
    expect(revokeByIdSpy).not.toHaveBeenCalled();
  });

  it('чужая (не текущая) сессия — делегирует revokeById и возвращает его итог', async () => {
    const identityId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const otherActiveId = new Types.ObjectId();
    const findActiveByTokenHashSpy = jest
      .fn()
      .mockResolvedValue({ _id: otherActiveId, equals: (id: Types.ObjectId) => id.equals(otherActiveId) });
    const revokeByIdSpy = jest.fn().mockResolvedValue(true);
    const service = makeService({ findActiveByTokenHash: findActiveByTokenHashSpy, revokeById: revokeByIdSpy });

    const result = await service.revokeSessionById(identityId, sessionId, 'erp', 'current-raw-token');

    expect(revokeByIdSpy).toHaveBeenCalledWith(identityId, sessionId);
    expect(result).toBe('revoked');
  });

  it('sessionId не найден среди сессий этой identity — not_found', async () => {
    const identityId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const revokeByIdSpy = jest.fn().mockResolvedValue(false);
    const service = makeService({ revokeById: revokeByIdSpy });

    const result = await service.revokeSessionById(identityId, sessionId, 'erp');

    expect(result).toBe('not_found');
  });
});
