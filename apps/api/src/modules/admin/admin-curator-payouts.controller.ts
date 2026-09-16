import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { MarkCuratorPaidDto } from '../referral-network/dto/referral-network.dto';
import { AdminReferralService } from './admin-referral.service';

/** Менеджер BAZA отмечает выплаты кураторам (`curator_payout.mark`). */
@Controller('admin/curator-payouts')
@UseGuards(AdminGuard)
export class AdminCuratorPayoutsController {
  constructor(private readonly service: AdminReferralService) {}

  @Get()
  list(@Req() req: FastifyRequest) {
    return this.service.listPayouts(requireAdminContext(req));
  }

  @Get(':identityId/accruals')
  accruals(@Req() req: FastifyRequest, @Param('identityId', ParseObjectIdPipe) identityId: Types.ObjectId) {
    return this.service.curatorAccruals(requireAdminContext(req), identityId);
  }

  @Post(':identityId/pay')
  @HttpCode(200)
  pay(
    @Req() req: FastifyRequest,
    @Param('identityId', ParseObjectIdPipe) identityId: Types.ObjectId,
    @Body() dto: MarkCuratorPaidDto,
  ) {
    return this.service.markPaid(requireAdminContext(req), {
      curatorIdentityId: identityId,
      accrualIds: dto.accrualIds.map((id) => new Types.ObjectId(id)),
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      correlationId: req.correlationId,
    });
  }
}
