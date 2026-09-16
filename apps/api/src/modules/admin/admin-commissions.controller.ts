import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import {
  CancelCommissionReceivedDto,
  ListCommissionsQueryDto,
  MarkCommissionReceivedDto,
} from '../referral-network/dto/referral-network.dto';
import { AdminReferralService } from './admin-referral.service';

/** Менеджер BAZA отмечает пришедшую комиссию по сделкам первички (`commission.confirm`). */
@Controller('admin/commissions')
@UseGuards(AdminGuard)
export class AdminCommissionsController {
  constructor(private readonly service: AdminReferralService) {}

  @Get()
  list(@Req() req: FastifyRequest, @Query() dto: ListCommissionsQueryDto) {
    return this.service.listCommissions(requireAdminContext(req), dto.received === 'true');
  }

  @Post(':dealId/received')
  @HttpCode(200)
  markReceived(
    @Req() req: FastifyRequest,
    @Param('dealId', ParseObjectIdPipe) dealId: Types.ObjectId,
    @Body() dto: MarkCommissionReceivedDto,
  ) {
    return this.service.markCommissionReceived(requireAdminContext(req), {
      dealId,
      expectedVersion: dto.expectedVersion,
      amount: { amountMinorUnits: dto.amountMinorUnits, currency: dto.currency },
      receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
      correlationId: req.correlationId,
    });
  }

  @Post(':dealId/cancel')
  @HttpCode(200)
  cancel(
    @Req() req: FastifyRequest,
    @Param('dealId', ParseObjectIdPipe) dealId: Types.ObjectId,
    @Body() dto: CancelCommissionReceivedDto,
  ) {
    return this.service.cancelCommissionReceived(requireAdminContext(req), {
      dealId,
      expectedVersion: dto.expectedVersion,
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }
}
