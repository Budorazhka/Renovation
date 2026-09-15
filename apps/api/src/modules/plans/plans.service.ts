import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AuditService } from '../audit/audit.service';
import { CrmService, type CrmPlanActuals } from '../crm/crm.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PlanRepository, type PlanTargets } from './repository/plan.repository';
import type { PlanDocument } from './schemas/plan.schema';

export interface PlanView extends PlanTargets {
  positionId: string;
  period: string;
  setByPositionId: string;
  version: number;
  updatedAt: string | null;
}

export interface PlanProgressPosition {
  positionId: string;
  plan: PlanView | null;
  month: CrmPlanActuals;
  week: CrmPlanActuals;
  today: CrmPlanActuals;
}

export interface PlanProgressView {
  period: string;
  /** Рабочие дни месяца (пн–пт) и сколько из них уже прошло, включая сегодня. */
  workingDays: number;
  workingDaysElapsed: number;
  positions: PlanProgressPosition[];
  /** Видит ли вызывающий всю команду (руководитель). */
  canManageTeam: boolean;
}

const EMPTY_ACTUALS: CrmPlanActuals = { leads: 0, deals: 0, revenue: [], calls: 0, meetings: 0, showings: 0 };
const DAY_MS = 86_400_000;

export function toPlanReadModel(plan: PlanDocument): PlanView {
  return {
    positionId: plan.positionId.toString(),
    period: plan.period,
    revenueTargetMinorUnits: plan.revenueTargetMinorUnits,
    currency: plan.currency,
    leadsTarget: plan.leadsTarget,
    dealsTarget: plan.dealsTarget,
    callsTarget: plan.callsTarget,
    meetingsTarget: plan.meetingsTarget,
    showingsTarget: plan.showingsTarget,
    setByPositionId: plan.setByPositionId.toString(),
    version: plan.version ?? 0,
    updatedAt: plan.updatedAt ? plan.updatedAt.toISOString() : null,
  };
}

/** Границы месяца в UTC: [первый день 00:00, первый день следующего месяца). */
export function monthRange(period: string): { from: Date; to: Date } {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1) - 1) };
}

function isWorkingDay(time: number): boolean {
  const weekday = new Date(time).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Рабочие дни месяца и прошедшие рабочие дни на `now` (UTC). */
export function workingDaysOf(period: string, now: Date): { total: number; elapsed: number } {
  const { from, to } = monthRange(period);
  let total = 0;
  let elapsed = 0;
  for (let time = from.getTime(); time <= to.getTime(); time += DAY_MS) {
    if (!isWorkingDay(time)) continue;
    total += 1;
    if (time <= now.getTime()) elapsed += 1;
  }
  return { total, elapsed };
}

/** Неделя (с понедельника) и сегодняшний день в UTC, обрезанные границами месяца. */
export function weekAndDayRanges(period: string, now: Date): { week: { from: Date; to: Date }; today: { from: Date; to: Date } } {
  const month = monthRange(period);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekday = (new Date(dayStart).getUTCDay() + 6) % 7;
  const clamp = (time: number) => Math.min(Math.max(time, month.from.getTime()), month.to.getTime());
  return {
    week: { from: new Date(clamp(dayStart - weekday * DAY_MS)), to: new Date(clamp(dayStart + DAY_MS - 1)) },
    today: { from: new Date(clamp(dayStart)), to: new Date(clamp(dayStart + DAY_MS - 1)) },
  };
}

/**
 * Планы сотрудников (см. PlanDocument). `canManageTeam` вычисляет
 * контроллер по scope грантов plan.read/plan.update: organization/global —
 * все позиции организации, own — только своя. Факт считает CrmService
 * (ADR-001: через сервис, не через репозитории CRM).
 */
@Injectable()
export class PlansService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly plans: PlanRepository,
    private readonly crmService: CrmService,
    private readonly organizationsService: OrganizationsService,
    private readonly auditService: AuditService,
  ) {}

  async listPlans(params: {
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    period: string;
    canManageTeam: boolean;
  }): Promise<{ items: PlanView[]; canManageTeam: boolean }> {
    const rows = await this.plans.listForPeriod(params.organizationId, params.period);
    const visible = params.canManageTeam ? rows : rows.filter((row) => row.positionId.equals(params.callerPositionId));
    return { items: visible.map(toPlanReadModel), canManageTeam: params.canManageTeam };
  }

  /**
   * PUT /plans/:positionId/:period. Руководитель ставит план любой позиции
   * организации, сотрудник — только себе. Чужая организация — 404. Новый
   * план создаётся без expectedVersion; существующий меняется только с
   * актуальным expectedVersion (иначе 409 — план успел поменять кто-то ещё).
   */
  async upsertPlan(params: {
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    positionId: Types.ObjectId;
    period: string;
    targets: PlanTargets;
    expectedVersion?: number;
    canManageTeam: boolean;
    correlationId: string;
  }): Promise<PlanView> {
    const isSelf = params.positionId.equals(params.callerPositionId);
    if (!isSelf && !params.canManageTeam) {
      throw new ForbiddenException('Caller can set only own plan');
    }
    if (!isSelf) {
      const positionOrganizationId = await this.organizationsService.getPositionOrganizationId(params.positionId);
      if (!positionOrganizationId || !positionOrganizationId.equals(params.organizationId)) {
        throw new NotFoundException('Position not found');
      }
    }

    return runInTransaction(this.connection, async (session) => {
      const existing = await this.plans.findForPosition(params.organizationId, params.positionId, params.period, session);
      if (existing) {
        if (params.expectedVersion === undefined || params.expectedVersion !== existing.version) {
          throw new ConflictException('Plan was modified by another request — refresh and retry');
        }
        const { modifiedCount } = await this.plans.updateWithVersionCheck(
          params.organizationId,
          params.positionId,
          params.period,
          params.expectedVersion,
          { ...params.targets, setByPositionId: params.callerPositionId },
          session,
        );
        if (modifiedCount === 0) {
          throw new ConflictException('Plan was modified by another request — refresh and retry');
        }
      } else {
        try {
          await this.plans.create(
            {
              organizationId: params.organizationId,
              positionId: params.positionId,
              period: params.period,
              setByPositionId: params.callerPositionId,
              ...params.targets,
            },
            session,
          );
        } catch (error) {
          // Два одновременных «первых» плана — уникальный индекс пропустит один.
          if ((error as { code?: number }).code === 11000) {
            throw new ConflictException('Plan was created by another request — refresh and retry');
          }
          throw error;
        }
      }

      // План влияет на оценку сотрудника — правка пишется в журнал (permission-matrix.md §4).
      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'plan.update',
          resource: 'position',
          resourceId: params.positionId,
          before: existing ? { period: params.period, ...pickTargets(existing) } : undefined,
          after: { period: params.period, ...params.targets },
          correlationId: params.correlationId,
        },
        session,
      );

      const saved = await this.plans.findForPosition(params.organizationId, params.positionId, params.period, session);
      return toPlanReadModel(saved!);
    });
  }

  /**
   * GET /plans/progress — план и факт за месяц, текущую неделю и сегодня.
   * Руководитель видит все позиции с планом или активностью за месяц,
   * сотрудник — только себя; positionId сужает до одной позиции.
   */
  async getProgress(params: {
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    period: string;
    positionId?: Types.ObjectId;
    canManageTeam: boolean;
    now?: Date;
  }): Promise<PlanProgressView> {
    const now = params.now ?? new Date();
    if (params.positionId && !params.positionId.equals(params.callerPositionId) && !params.canManageTeam) {
      throw new ForbiddenException('Caller can see only own progress');
    }

    const month = monthRange(params.period);
    const { week, today } = weekAndDayRanges(params.period, now);
    const [plans, monthActuals, weekActuals, todayActuals] = await Promise.all([
      this.plans.listForPeriod(params.organizationId, params.period),
      this.crmService.getPlanActuals({ organizationId: params.organizationId, ...month }),
      this.crmService.getPlanActuals({ organizationId: params.organizationId, ...week }),
      this.crmService.getPlanActuals({ organizationId: params.organizationId, ...today }),
    ]);

    const plansByPosition = new Map(plans.map((plan) => [plan.positionId.toString(), plan]));
    let positionIds: string[];
    if (params.positionId) positionIds = [params.positionId.toString()];
    else if (params.canManageTeam) positionIds = [...new Set([...plansByPosition.keys(), ...monthActuals.keys()])];
    else positionIds = [params.callerPositionId.toString()];

    const days = workingDaysOf(params.period, now);
    return {
      period: params.period,
      workingDays: days.total,
      workingDaysElapsed: days.elapsed,
      canManageTeam: params.canManageTeam,
      positions: positionIds.map((positionId) => {
        const plan = plansByPosition.get(positionId);
        return {
          positionId,
          plan: plan ? toPlanReadModel(plan) : null,
          month: monthActuals.get(positionId) ?? EMPTY_ACTUALS,
          week: weekActuals.get(positionId) ?? EMPTY_ACTUALS,
          today: todayActuals.get(positionId) ?? EMPTY_ACTUALS,
        };
      }),
    };
  }
}

function pickTargets(plan: PlanDocument): PlanTargets {
  return {
    revenueTargetMinorUnits: plan.revenueTargetMinorUnits,
    currency: plan.currency,
    leadsTarget: plan.leadsTarget,
    dealsTarget: plan.dealsTarget,
    callsTarget: plan.callsTarget,
    meetingsTarget: plan.meetingsTarget,
    showingsTarget: plan.showingsTarget,
  };
}
