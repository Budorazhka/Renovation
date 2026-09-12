import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { AdminOrganizationService } from './admin-organization.service';
import { ListAdminOrganizationsQueryDto } from './dto/list-admin-organizations-query.dto';
import { FreezeOrganizationRequestDto } from './dto/freeze-organization-request.dto';
import { VerifyMlsRequestDto } from './dto/verify-mls-request.dto';
import { RevokeMlsVerificationRequestDto } from './dto/revoke-mls-verification-request.dto';

@Controller('admin/organizations')
@UseGuards(AdminGuard)
export class AdminOrganizationController {
  constructor(private readonly service: AdminOrganizationService) {}

  @Get()
  async list(@Req() req: FastifyRequest, @Query() dto: ListAdminOrganizationsQueryDto) {
    const adminContext = requireAdminContext(req);
    return this.service.list(adminContext, dto);
  }

  @Get(':organizationId')
  async getById(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
  ) {
    const adminContext = requireAdminContext(req);
    return this.service.getById(adminContext, new Types.ObjectId(organizationIdParam));
  }

  @Post(':organizationId/freeze')
  @HttpCode(200)
  async freeze(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Body() dto: FreezeOrganizationRequestDto,
  ) {
    const adminContext = requireAdminContext(req);
    return this.service.freeze(adminContext, {
      id: new Types.ObjectId(organizationIdParam),
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Post(':organizationId/unfreeze')
  @HttpCode(200)
  async unfreeze(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Body() dto: FreezeOrganizationRequestDto,
  ) {
    const adminContext = requireAdminContext(req);
    return this.service.unfreeze(adminContext, {
      id: new Types.ObjectId(organizationIdParam),
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Post(':organizationId/verify-mls')
  @HttpCode(200)
  async verifyMls(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Body() dto: VerifyMlsRequestDto,
  ) {
    const adminContext = requireAdminContext(req);
    return this.service.verifyMls(adminContext, {
      id: new Types.ObjectId(organizationIdParam),
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Post(':organizationId/revoke-mls-verification')
  @HttpCode(200)
  async revokeMlsVerification(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Body() dto: RevokeMlsVerificationRequestDto,
  ) {
    const adminContext = requireAdminContext(req);
    return this.service.revokeMlsVerification(adminContext, {
      id: new Types.ObjectId(organizationIdParam),
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }
}
