import { Types } from 'mongoose';
import { PositionRepository } from './position.repository';

describe('PositionRepository.findAllByOrganization', () => {
  /**
   * Найдено реальным E2E-прогоном: closed-позиции (teamApi.ts::remove)
   * оставались видны в GET /team-users list — исправлено фильтром на
   * уровне запроса, эта проверка защищает от регрессии.
   */
  it('фильтр исключает status:closed', async () => {
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue([]);
    const findSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new PositionRepository({ find: findSpy } as never);

    await repository.findAllByOrganization(organizationId);

    expect(findSpy).toHaveBeenCalledWith({ organizationId, status: { $ne: 'closed' } });
  });
});

describe('PositionRepository.updateParent', () => {
  /**
   * Реальный найденный баг (second-opinion ревью): раньше возвращался
   * modifiedCount, который MongoDB зануляет для no-op $set (тот же
   * parentPositionId, что уже стоит на записи) — идемпотентный повторный
   * вызов ошибочно трактовался вызывающим кодом как "позиция не найдена".
   * matchedCount не подвержен этой проблеме — эта проверка защищает от
   * регрессии на уровне repository.
   */
  it('возвращает matchedCount, не modifiedCount', async () => {
    const positionId = new Types.ObjectId();
    const parentPositionId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new PositionRepository({ updateOne: updateOneSpy } as never);

    const result = await repository.updateParent(positionId, parentPositionId);

    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: positionId },
      { $set: { parentPositionId } },
      { session: undefined },
    );
    expect(result).toEqual({ matchedCount: 1 });
  });
});

describe('PositionRepository.setAvatarAsset', () => {
  it('пишет avatarAssetId через $set', async () => {
    const positionId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new PositionRepository({ updateOne: updateOneSpy } as never);

    const result = await repository.setAvatarAsset(positionId, assetId);

    expect(updateOneSpy).toHaveBeenCalledWith({ _id: positionId }, { $set: { avatarAssetId: assetId } });
    expect(result).toEqual({ matchedCount: 1 });
  });
});

describe('PositionRepository.markClosed', () => {
  it('условие status:vacant в фильтре — не закрывает занятую позицию', async () => {
    const positionId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new PositionRepository({ updateOne: updateOneSpy } as never);

    await repository.markClosed(positionId);

    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: positionId, status: 'vacant' },
      { $set: { status: 'closed' } },
      { session: undefined },
    );
  });
});

describe('PositionRepository.listPublicRealtors (N-13)', () => {
  it('фильтрует по occupied + клиентским ролям, исключает administrator/marketer/developer из fixedRole', async () => {
    const aggregateSpy = jest.fn().mockResolvedValue([]);
    const repository = new PositionRepository({ aggregate: aggregateSpy, hydrate: jest.fn() } as never);

    await repository.listPublicRealtors({ limit: 20 });

    const pipeline = aggregateSpy.mock.calls[0][0];
    expect(pipeline[0].$match).toEqual({ status: 'occupied', fixedRole: { $in: ['owner', 'director', 'rop', 'manager'] } });
  });

  it('курсор добавляет _id: {$lt} к фильтру', async () => {
    const cursor = new Types.ObjectId();
    const aggregateSpy = jest.fn().mockResolvedValue([]);
    const repository = new PositionRepository({ aggregate: aggregateSpy, hydrate: jest.fn() } as never);

    await repository.listPublicRealtors({ cursor, limit: 20 });

    const pipeline = aggregateSpy.mock.calls[0][0];
    expect(pipeline[0].$match._id).toEqual({ $lt: cursor });
  });

  it('lookup-пайплайн допускает только organization.type agency/independent_realtor и status:active', async () => {
    const aggregateSpy = jest.fn().mockResolvedValue([]);
    const repository = new PositionRepository({ aggregate: aggregateSpy, hydrate: jest.fn() } as never);

    await repository.listPublicRealtors({ limit: 20 });

    const pipeline = aggregateSpy.mock.calls[0][0];
    const lookupStage = pipeline.find((stage: Record<string, unknown>) => '$lookup' in stage);
    const innerMatch = lookupStage.$lookup.pipeline[0].$match;
    expect(innerMatch.type).toEqual({ $in: ['agency', 'independent_realtor'] });
    expect(innerMatch.status).toBe('active');
  });

  it('city добавляет $lookup на position_profiles и фильтр по profile.city', async () => {
    const aggregateSpy = jest.fn().mockResolvedValue([]);
    const repository = new PositionRepository({ aggregate: aggregateSpy, hydrate: jest.fn() } as never);

    await repository.listPublicRealtors({ limit: 20, city: 'Батуми' });

    const pipeline = aggregateSpy.mock.calls[0][0];
    const profileLookup = pipeline.find((stage: Record<string, unknown>) => (stage as { $lookup?: { from?: string } }).$lookup?.from === 'position_profiles');
    expect(profileLookup).toBeDefined();
    const cityMatch = pipeline.find((stage: Record<string, unknown>) => (stage as { $match?: { 'profile.city'?: unknown } }).$match?.['profile.city']);
    expect(cityMatch.$match['profile.city']).toBe('Батуми');
  });

  it('без city не добавляет lookup на position_profiles', async () => {
    const aggregateSpy = jest.fn().mockResolvedValue([]);
    const repository = new PositionRepository({ aggregate: aggregateSpy, hydrate: jest.fn() } as never);

    await repository.listPublicRealtors({ limit: 20 });

    const pipeline = aggregateSpy.mock.calls[0][0];
    const profileLookup = pipeline.find((stage: Record<string, unknown>) => (stage as { $lookup?: { from?: string } }).$lookup?.from === 'position_profiles');
    expect(profileLookup).toBeUndefined();
  });
});
