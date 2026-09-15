import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PlansService } from './plans.service';
import { PLAN_PERIOD_PATTERN, PlanPeriodQueryDto, UpsertPlanDto } from './dto/plan.dto';

/**
 * Планы сотрудников (permission-matrix.md §1.11). plan.read/plan.update со
 * scope organization — руководитель видит и ставит планы всей организации;
 * scope own — сотрудник видит и ставит только свой план.
 */
@Controller('plans')
@UseGuards(TenantGuard, PermissionGuard)
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly policyEvaluator: PolicyEvaluatorService,
  ) {}

  @Get()
  @RequirePermission('plan', 'read')
  async listPlans(@Req() req: FastifyRequest, @Query() dto: PlanPeriodQueryDto) {
    const tenantContext = requireTenantContext(req);
    return this.plansService.listPlans({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      period: dto.period,
      canManageTeam: await this.hasOrganizationScope(tenantContext.positionId, 'read'),
    });
  }

  @Get('progress')
  @RequirePermission('plan', 'read')
  async getProgress(@Req() req: FastifyRequest, @Query() dto: PlanPeriodQueryDto) {
    const tenantContext = requireTenantContext(req);
    return this.plansService.getProgress({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      period: dto.period,
      positionId: dto.positionId ? new Types.ObjectId(dto.positionId) : undefined,
      canManageTeam: await this.hasOrganizationScope(tenantContext.positionId, 'read'),
    });
  }

  @Put(':positionId/:period')
  @RequirePermission('plan', 'update')
  async upsertPlan(
    @Req() req: FastifyRequest,
    @Param('positionId', ParseObjectIdPipe) positionId: Types.ObjectId,
    @Param('period') period: string,
    @Body() dto: UpsertPlanDto,
  ) {
    if (!PLAN_PERIOD_PATTERN.test(period)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'period must be YYYY-MM');
    }
    const tenantContext = requireTenantContext(req);
    return this.plansService.upsertPlan({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      positionId,
      period,
      targets: {
        revenueTargetMinorUnits: dto.revenueTargetMinorUnits,
        currency: dto.currency,
        leadsTarget: dto.leadsTarget,
        dealsTarget: dto.dealsTarget,
        callsTarget: dto.callsTarget,
        meetingsTarget: dto.meetingsTarget,
        showingsTarget: dto.showingsTarget,
      },
      expectedVersion: dto.expectedVersion,
      canManageTeam: await this.hasOrganizationScope(tenantContext.positionId, 'update'),
      correlationId: req.correlationId,
    });
  }

  /** Есть ли у позиции грант со scope organization/global — работа с планами всей организации. */
  private async hasOrganizationScope(positionId: string, action: 'read' | 'update'): Promise<boolean> {
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: new Types.ObjectId(positionId),
      resource: 'plan',
      action,
    });
    return scopes.some((scope) => scope === 'organization' || scope === 'global');
  }
}
