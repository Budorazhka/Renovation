import { Types } from 'mongoose';
import { SessionRepository } from './session.repository';

describe('SessionRepository.findActiveByIdentity', () => {
  it('фильтрует по identityId, productAudience, активности; сортирует свежие первыми', async () => {
    const identityId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue([]);
    const sortSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
    const repository = new SessionRepository({ find: findSpy } as never);

    await repository.findActiveByIdentity(identityId, 'erp');

    expect(findSpy).toHaveBeenCalledWith({
      identityId,
      productAudience: 'erp',
      revokedAt: { $exists: false },
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(sortSpy).toHaveBeenCalledWith({ createdAt: -1 });
  });
});

describe('SessionRepository.revokeById', () => {
  it('фильтрует по {_id, identityId} — не по одному _id', async () => {
    const identityId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new SessionRepository({ updateOne: updateOneSpy } as never);

    const result = await repository.revokeById(identityId, sessionId);

    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: sessionId, identityId },
      { $set: { revokedAt: expect.any(Date) } },
    );
    expect(result).toBe(true);
  });

  it('matchedCount:0 (чужая сессия или несуществующий id) — возвращает false', async () => {
    const identityId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new SessionRepository({ updateOne: updateOneSpy } as never);

    const result = await repository.revokeById(identityId, sessionId);

    expect(result).toBe(false);
  });

  it('своя уже отозванная сессия (matchedCount:1, modifiedCount:0) — идемпотентный true, не false', async () => {
    const identityId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new SessionRepository({ updateOne: updateOneSpy } as never);

    const result = await repository.revokeById(identityId, sessionId);

    expect(result).toBe(true);
  });
});
