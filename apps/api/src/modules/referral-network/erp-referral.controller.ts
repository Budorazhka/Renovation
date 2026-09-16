import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { ReferralNetworkService } from './referral-network.service';

/**
 * Сеть в ERP. Руководитель агентства видит кураторов своей компании и их
 * команды — без денег: начисления это отношения BAZA и куратора. Сотрудник
 * видит свою команду или своего куратора.
 */
@Controller('referral-network')
@UseGuards(TenantGuard)
export class ErpReferralController {
  constructor(private readonly network: ReferralNetworkService) {}

  @Get('organization')
  @UseGuards(PermissionGuard)
  @RequirePermission('referral_network', 'read')
  organization(@Req() req: FastifyRequest) {
    const tenantContext = requireTenantContext(req);
    return this.network.getOrganizationTree(new Types.ObjectId(tenantContext.organizationId));
  }

  @Get('me')
  me(@Req() req: FastifyRequest) {
    const tenantContext = requireTenantContext(req);
    return this.network.getMine(new Types.ObjectId(tenantContext.identityId));
  }
}
