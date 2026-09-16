import { Types } from 'mongoose';
import { ownerScopesEqual } from './owner-scope';

/**
 * ADR-002 требование 1: единственная функция сравнения tenant-принадлежности
 * для сущностей с ownerScope/publisherScope паттерном (используется в
 * MediaService.confirmUpload для IDOR-защиты) — ошибка здесь означает
 * реальную tenant escape дыру, поэтому покрыта отдельно от вызывающего кода.
 */
describe('ownerScopesEqual', () => {
  it('true для одинакового organization scope (тот же organizationId)', () => {
    const organizationId = new Types.ObjectId();
    expect(
      ownerScopesEqual(
        { type: 'organization', organizationId },
        { type: 'organization', organizationId: new Types.ObjectId(organizationId.toString()) },
      ),
    ).toBe(true);
  });

  it('false для organization scope с РАЗНЫМ organizationId', () => {
    expect(
      ownerScopesEqual(
        { type: 'organization', organizationId: new Types.ObjectId() },
        { type: 'organization', organizationId: new Types.ObjectId() },
      ),
    ).toBe(false);
  });

  it('true для одинакового marketplace_account scope (тот же identityId)', () => {
    const identityId = new Types.ObjectId();
    expect(
      ownerScopesEqual(
        { type: 'marketplace_account', identityId },
        { type: 'marketplace_account', identityId: new Types.ObjectId(identityId.toString()) },
      ),
    ).toBe(true);
  });

  it('false для marketplace_account scope с РАЗНЫМ identityId', () => {
    expect(
      ownerScopesEqual(
        { type: 'marketplace_account', identityId: new Types.ObjectId() },
        { type: 'marketplace_account', identityId: new Types.ObjectId() },
      ),
    ).toBe(false);
  });

  it('platform равен только platform: контент платформы не совпадает ни с одной организацией', () => {
    expect(ownerScopesEqual({ type: 'platform' }, { type: 'platform' })).toBe(true);
    expect(ownerScopesEqual({ type: 'platform' }, { type: 'organization', organizationId: new Types.ObjectId() })).toBe(false);
    expect(ownerScopesEqual({ type: 'organization', organizationId: new Types.ObjectId() }, { type: 'platform' })).toBe(false);
  });

  it('false при разных type, даже если оба id технически совпадали бы по значению', () => {
    const sameHexId = new Types.ObjectId();
    expect(
      ownerScopesEqual(
        { type: 'organization', organizationId: sameHexId },
        { type: 'marketplace_account', identityId: sameHexId },
      ),
    ).toBe(false);
  });
});
