import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import {
  AppointCuratorDto,
  AssignReferralMemberDto,
  DecideReferralRequestDto,
  FindReferralPersonQueryDto,
  ListReferralRequestsQueryDto,
  ReferralReasonDto,
} from '../referral-network/dto/referral-network.dto';
import { AdminReferralService } from './admin-referral.service';

/**
 * Реферальная сеть BAZA в админке. AdminGuard — только аутентификация
 * администратора; права (`referral_network.read/manage`) проверяет
 * AdminReferralService, тот же принцип, что у модерации отзывов.
 */
@Controller('admin/referral-network')
@UseGuards(AdminGuard)
export class AdminReferralNetworkController {
  constructor(private readonly service: AdminReferralService) {}

  @Get()
  tree(@Req() req: FastifyRequest) {
    return this.service.tree(requireAdminContext(req));
  }

  @Get('people')
  findPerson(@Req() req: FastifyRequest, @Query() dto: FindReferralPersonQueryDto) {
    return this.service.findPerson(requireAdminContext(req), dto.login);
  }

  @Get('people/:identityId/history')
  history(@Req() req: FastifyRequest, @Param('identityId', ParseObjectIdPipe) identityId: Types.ObjectId) {
    return this.service.memberHistory(requireAdminContext(req), identityId);
  }

  @Post('curators')
  @HttpCode(200)
  appoint(@Req() req: FastifyRequest, @Body() dto: AppointCuratorDto) {
    return this.service.appointCurator(requireAdminContext(req), {
      identityId: new Types.ObjectId(dto.identityId),
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Post('curators/:identityId/retire')
  @HttpCode(200)
  retire(
    @Req() req: FastifyRequest,
    @Param('identityId', ParseObjectIdPipe) identityId: Types.ObjectId,
    @Body() dto: ReferralReasonDto,
  ) {
    return this.service.retireCurator(requireAdminContext(req), { identityId, reason: dto.reason, correlationId: req.correlationId });
  }

  @Post('members')
  @HttpCode(200)
  assign(@Req() req: FastifyRequest, @Body() dto: AssignReferralMemberDto) {
    return this.service.assignMember(requireAdminContext(req), {
      memberIdentityId: new Types.ObjectId(dto.memberIdentityId),
      curatorIdentityId: new Types.ObjectId(dto.curatorIdentityId),
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Post('members/:identityId/remove')
  @HttpCode(200)
  remove(
    @Req() req: FastifyRequest,
    @Param('identityId', ParseObjectIdPipe) identityId: Types.ObjectId,
    @Body() dto: ReferralReasonDto,
  ) {
    return this.service.removeMember(requireAdminContext(req), {
      memberIdentityId: identityId,
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Get('requests')
  requests(@Req() req: FastifyRequest, @Query() dto: ListReferralRequestsQueryDto) {
    return this.service.listRequests(requireAdminContext(req), dto.status);
  }

  @Post('requests/:requestId/decide')
  @HttpCode(200)
  decide(
    @Req() req: FastifyRequest,
    @Param('requestId', ParseObjectIdPipe) requestId: Types.ObjectId,
    @Body() dto: DecideReferralRequestDto,
  ) {
    return this.service.decideRequest(requireAdminContext(req), {
      requestId,
      decision: dto.decision,
      comment: dto.comment,
      correlationId: req.correlationId,
    });
  }
}
