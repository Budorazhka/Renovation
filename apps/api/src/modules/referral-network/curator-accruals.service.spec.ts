import { Types } from 'mongoose';
import { CuratorAccrualsService } from './curator-accruals.service';
import { totalsFromRows } from './referral-network.service';

const actor = { adminAccountId: new Types.ObjectId(), correlationId: 'corr' };
const session = {} as never;

function person(identityId: Types.ObjectId, organizationId: Types.ObjectId | null, organizationType: string | null) {
  return { identityId, login: 'x', name: 'x', positionId: null, organizationId, organizationName: null, organizationType };
}

function build(overrides: {
  occupant?: Types.ObjectId | null;
  membership?: { curatorIdentityId: Types.ObjectId; status: string; _id?: Types.ObjectId } | null;
  curatorActive?: boolean;
  people?: ReturnType<typeof person>[];
}) {
  const memberships = {
    findOpenByMember: jest.fn().mockResolvedValue(overrides.membership ?? null),
    markOnReview: jest.fn(),
  };
  const curators = { findActiveByIdentity: jest.fn().mockResolvedValue(overrides.curatorActive === false ? null : { _id: new Types.ObjectId() }) };
  const accruals = { create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
  const organizations = { getActiveOccupantIdentityId: jest.fn().mockResolvedValue(overrides.occupant ?? null) };
  const network = {
    peopleById: jest.fn().mockResolvedValue(new Map((overrides.people ?? []).map((p) => [p.identityId.toString(), p]))),
  };
  const audit = { append: jest.fn() };
  const service = new CuratorAccrualsService(
    curators as never,
    memberships as never,
    accruals as never,
    organizations as never,
    network as never,
    audit as never,
  );
  return { service, memberships, accruals, audit };
}

const deal = (dealType: string) => ({
  id: new Types.ObjectId(),
  organizationId: new Types.ObjectId(),
  dealType,
  ownerPositionId: new Types.ObjectId(),
});
const commission = { amountMinorUnits: 300_000, currency: 'USD' as const };

describe('CuratorAccrualsService.accrueForDeal', () => {
  it('вторичка куратору ничего не даёт', async () => {
    const { service, accruals } = build({});
    await expect(service.accrueForDeal(actor, { deal: deal('secondary'), commission }, session)).resolves.toEqual({
      accrued: false,
      reason: 'not_primary',
    });
    expect(accruals.create).not.toHaveBeenCalled();
  });

  it('связь под вопросом — начисления нет, пока BAZA не решит', async () => {
    const member = new Types.ObjectId();
    const { service, accruals } = build({
      occupant: member,
      membership: { curatorIdentityId: new Types.ObjectId(), status: 'on_review' },
    });
    await expect(service.accrueForDeal(actor, { deal: deal('primary'), commission }, session)).resolves.toEqual({
      accrued: false,
      reason: 'membership_on_review',
    });
    expect(accruals.create).not.toHaveBeenCalled();
  });

  it('участник перешёл в агентство другой компании — связь уходит под вопрос, в журнал аудита пишется причина', async () => {
    const member = new Types.ObjectId();
    const curatorId = new Types.ObjectId();
    const { service, accruals, memberships, audit } = build({
      occupant: member,
      membership: { curatorIdentityId: curatorId, status: 'active', _id: new Types.ObjectId() },
      people: [person(member, new Types.ObjectId(), 'agency'), person(curatorId, new Types.ObjectId(), 'agency')],
    });
    await expect(service.accrueForDeal(actor, { deal: deal('primary'), commission }, session)).resolves.toEqual({
      accrued: false,
      reason: 'company_mismatch',
    });
    expect(memberships.markOnReview).toHaveBeenCalledWith(member, session);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'referral_network.membership_on_review' }),
      session,
    );
    expect(accruals.create).not.toHaveBeenCalled();
  });

  it('куратора сняли — начисления нет', async () => {
    const member = new Types.ObjectId();
    const { service } = build({
      occupant: member,
      membership: { curatorIdentityId: new Types.ObjectId(), status: 'active' },
      curatorActive: false,
    });
    await expect(service.accrueForDeal(actor, { deal: deal('primary'), commission }, session)).resolves.toEqual({
      accrued: false,
      reason: 'curator_retired',
    });
  });

  it('независимый риэлтор в команде — 7% с процентом-снимком в записи', async () => {
    const member = new Types.ObjectId();
    const curatorId = new Types.ObjectId();
    const { service, accruals } = build({
      occupant: member,
      membership: { curatorIdentityId: curatorId, status: 'active' },
      people: [person(member, new Types.ObjectId(), 'independent_realtor'), person(curatorId, new Types.ObjectId(), 'agency')],
    });
    const outcome = await service.accrueForDeal(actor, { deal: deal('primary'), commission }, session);
    expect(outcome).toMatchObject({ accrued: true, amount: { amountMinorUnits: 21_000, currency: 'USD' } });
    expect(accruals.create).toHaveBeenCalledWith(expect.objectContaining({ ratePercent: 7 }), session);
  });
});

describe('итоги начислений', () => {
  it('отменённое не считается, выплаченное входит и в «начислено», и в «выплачено»', () => {
    const curatorIdentityId = new Types.ObjectId();
    const totals = totalsFromRows([
      { curatorIdentityId, status: 'accrued', currency: 'USD', amountMinorUnits: 1_000, count: 1 },
      { curatorIdentityId, status: 'paid', currency: 'USD', amountMinorUnits: 2_000, count: 1 },
      { curatorIdentityId, status: 'reversed', currency: 'USD', amountMinorUnits: 5_000, count: 1 },
      { curatorIdentityId, status: 'accrued', currency: 'GEL', amountMinorUnits: 700, count: 1 },
    ]);
    expect(totals.earned).toEqual([
      { amountMinorUnits: 3_000, currency: 'USD' },
      { amountMinorUnits: 700, currency: 'GEL' },
    ]);
    expect(totals.paid).toEqual([{ amountMinorUnits: 2_000, currency: 'USD' }]);
    expect(totals.due).toEqual([
      { amountMinorUnits: 1_000, currency: 'USD' },
      { amountMinorUnits: 700, currency: 'GEL' },
    ]);
  });
});
