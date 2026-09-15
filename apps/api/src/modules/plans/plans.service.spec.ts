import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlansService, monthRange, weekAndDayRanges, workingDaysOf } from './plans.service';
import type { PlanRepository } from './repository/plan.repository';
import type { CrmService } from '../crm/crm.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { AuditService } from '../audit/audit.service';
import type { PlanDocument } from './schemas/plan.schema';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

const organizationId = new Types.ObjectId();
const callerPositionId = new Types.ObjectId();
const targets = {
  revenueTargetMinorUnits: 500_000,
  currency: 'USD',
  leadsTarget: 20,
  dealsTarget: 2,
  callsTarget: 60,
  meetingsTarget: 10,
  showingsTarget: 6,
};

function planDoc(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    _id: new Types.ObjectId(),
    organizationId,
    positionId: callerPositionId,
    period: '2026-09',
    setByPositionId: callerPositionId,
    version: 0,
    updatedAt: new Date('2026-09-15T00:00:00.000Z'),
    ...targets,
    ...overrides,
  } as unknown as PlanDocument;
}

function makeService(overrides: {
  plans?: Partial<PlanRepository>;
  crm?: Partial<CrmService>;
  organizations?: Partial<OrganizationsService>;
} = {}) {
  const append = jest.fn().mockResolvedValue(undefined);
  const service = new PlansService(
    makeMockConnection() as never,
    (overrides.plans ?? {}) as PlanRepository,
    (overrides.crm ?? {}) as CrmService,
    (overrides.organizations ?? {}) as OrganizationsService,
    { append } as unknown as AuditService,
  );
  return { service, append };
}

describe('календарь плана', () => {
  it('сентябрь 2026: 22 рабочих дня, к 15-му прошло 11', () => {
    expect(workingDaysOf('2026-09', new Date('2026-09-15T10:00:00.000Z'))).toEqual({ total: 22, elapsed: 11 });
  });

  it('границы месяца включают последний день целиком', () => {
    const { from, to } = monthRange('2026-02');
    expect(from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('неделя с понедельника не выходит за начало месяца', () => {
    const { week, today } = weekAndDayRanges('2026-10', new Date('2026-10-01T12:00:00.000Z'));
    expect(week.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(today.to.toISOString()).toBe('2026-10-01T23:59:59.999Z');
  });
});

describe('PlansService.upsertPlan', () => {
  const base = {
    organizationId,
    callerPositionId,
    actorIdentityId: new Types.ObjectId(),
    period: '2026-09',
    targets,
    correlationId: 'c',
  };

  it('сотрудник не ставит план другому — 403', async () => {
    const { service } = makeService();
    await expect(
      service.upsertPlan({ ...base, positionId: new Types.ObjectId(), canManageTeam: false }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('руководитель: позиция чужой организации — 404', async () => {
    const { service } = makeService({
      organizations: { getPositionOrganizationId: jest.fn().mockResolvedValue(new Types.ObjectId()) },
    });
    await expect(
      service.upsertPlan({ ...base, positionId: new Types.ObjectId(), canManageTeam: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('сотрудник ставит план себе впервые — создаётся и пишется в журнал', async () => {
    const create = jest.fn().mockResolvedValue(planDoc());
    const { service, append } = makeService({
      plans: {
        findForPosition: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(planDoc()),
        create,
      },
    });

    const view = await service.upsertPlan({ ...base, positionId: callerPositionId, canManageTeam: false });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ positionId: callerPositionId, leadsTarget: 20 }), expect.anything());
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'plan.update', resourceId: callerPositionId }), expect.anything());
    expect(view).toEqual(expect.objectContaining({ period: '2026-09', leadsTarget: 20, version: 0 }));
  });

  it('существующий план без актуальной версии — 409, не перезаписывается', async () => {
    const updateWithVersionCheck = jest.fn();
    const { service } = makeService({
      plans: { findForPosition: jest.fn().mockResolvedValue(planDoc({ version: 3 })), updateWithVersionCheck },
    });

    await expect(
      service.upsertPlan({ ...base, positionId: callerPositionId, canManageTeam: false, expectedVersion: 2 }),
    ).rejects.toThrow(ConflictException);
    await expect(service.upsertPlan({ ...base, positionId: callerPositionId, canManageTeam: false })).rejects.toThrow(
      ConflictException,
    );
    expect(updateWithVersionCheck).not.toHaveBeenCalled();
  });
});

describe('PlansService.getProgress', () => {
  const actuals = (value: number) => ({ leads: value, deals: 0, revenue: [], calls: 0, meetings: 0, showings: 0 });

  it('сотрудник видит только себя; чужую позицию запросить нельзя', async () => {
    const other = new Types.ObjectId();
    const getPlanActuals = jest.fn().mockResolvedValue(new Map([[other.toString(), actuals(5)]]));
    const { service } = makeService({
      plans: { listForPeriod: jest.fn().mockResolvedValue([planDoc({ positionId: other })]) },
      crm: { getPlanActuals },
    });

    const own = await service.getProgress({ organizationId, callerPositionId, period: '2026-09', canManageTeam: false });
    expect(own.positions.map((p) => p.positionId)).toEqual([callerPositionId.toString()]);
    expect(own.positions[0]!.plan).toBeNull();

    await expect(
      service.getProgress({ organizationId, callerPositionId, period: '2026-09', canManageTeam: false, positionId: other }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('руководитель видит позиции с планом и с активностью; факт за месяц, неделю и день', async () => {
    const withPlan = new Types.ObjectId();
    const withActivity = new Types.ObjectId();
    const getPlanActuals = jest
      .fn()
      .mockResolvedValueOnce(new Map([[withActivity.toString(), actuals(7)]]))
      .mockResolvedValueOnce(new Map([[withActivity.toString(), actuals(3)]]))
      .mockResolvedValueOnce(new Map([[withActivity.toString(), actuals(1)]]));
    const { service } = makeService({
      plans: { listForPeriod: jest.fn().mockResolvedValue([planDoc({ positionId: withPlan })]) },
      crm: { getPlanActuals },
    });

    const result = await service.getProgress({
      organizationId,
      callerPositionId,
      period: '2026-09',
      canManageTeam: true,
      now: new Date('2026-09-15T10:00:00.000Z'),
    });

    expect(result.workingDays).toBe(22);
    expect(result.workingDaysElapsed).toBe(11);
    const byId = new Map(result.positions.map((p) => [p.positionId, p]));
    expect(byId.get(withPlan.toString())!.plan).not.toBeNull();
    expect(byId.get(withActivity.toString())).toEqual(
      expect.objectContaining({ month: actuals(7), week: actuals(3), today: actuals(1), plan: null }),
    );
  });
});
