import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { ClientRegistrationsService } from './client-registrations.service';
import {
  CreateClientRegistrationDto,
  DecideClientRegistrationDto,
  ListClientRegistrationsDto,
  RejectClientRegistrationDto,
  UpdateClientRegistrationDto,
  clientRegistrationIdempotencyBody,
} from './dto/client-registration.dto';

/**
 * Фиксация клиента у застройщика (permission-matrix.md §1.13).
 *
 * Две стороны одной записи: агентство ведёт свой реестр
 * (`client_registration.read/create/update`), застройщик отвечает на
 * входящие (`client_registration.decide`). Сторона выводится из сессии, а не
 * из тела запроса: организация застройщика берётся из ЖК, а входящие
 * фильтруются по ней же.
 *
 * `incoming` объявлен ДО `:registrationId`: иначе Fastify разобрал бы слово
 * incoming как идентификатор заявки.
 */
@Controller('client-registrations')
@UseGuards(TenantGuard, PermissionGuard)
export class ClientRegistrationsController {
  constructor(
    private readonly service: ClientRegistrationsService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('client_registration', 'read')
  async list(@Req() req: FastifyRequest, @Query() dto: ListClientRegistrationsDto) {
    const tenantContext = requireTenantContext(req);
    const items = await this.service.listForOrganization(new Types.ObjectId(tenantContext.organizationId), {
      status: dto.status,
    });
    return { items };
  }

  @Get('incoming')
  @RequirePermission('client_registration', 'decide')
  async listIncoming(@Req() req: FastifyRequest, @Query() dto: ListClientRegistrationsDto) {
    const tenantContext = requireTenantContext(req);
    const items = await this.service.listIncoming(new Types.ObjectId(tenantContext.organizationId), {
      status: dto.status,
    });
    return { items };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('client_registration', 'create')
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateClientRegistrationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = clientRegistrationIdempotencyBody(dto);
    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createClientRegistration',
      key: idempotencyKey,
      requestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.service.create({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      agentPositionId: new Types.ObjectId(tenantContext.positionId),
      input: dto,
      idempotency: { actorIdentityId, key: idempotencyKey, requestBody },
      correlationId: req.correlationId,
    });
  }

  @Patch(':registrationId')
  @RequirePermission('client_registration', 'update')
  async edit(
    @Req() req: FastifyRequest,
    @Param('registrationId', ParseObjectIdPipe) registrationId: Types.ObjectId,
    @Body() dto: UpdateClientRegistrationDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.service.edit({
      registrationId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion: dto.expectedVersion,
      unitLabel: dto.unitLabel,
      notes: dto.notes,
    });
  }

  @Post(':registrationId/accept')
  @HttpCode(200)
  @RequirePermission('client_registration', 'decide')
  async accept(
    @Req() req: FastifyRequest,
    @Param('registrationId', ParseObjectIdPipe) registrationId: Types.ObjectId,
    @Body() dto: DecideClientRegistrationDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.service.accept({
      registrationId,
      developerOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      decidedByPositionId: new Types.ObjectId(tenantContext.positionId),
      expectedVersion: dto.expectedVersion,
      correlationId: req.correlationId,
    });
  }

  @Post(':registrationId/reject')
  @HttpCode(200)
  @RequirePermission('client_registration', 'decide')
  async reject(
    @Req() req: FastifyRequest,
    @Param('registrationId', ParseObjectIdPipe) registrationId: Types.ObjectId,
    @Body() dto: RejectClientRegistrationDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.service.reject({
      registrationId,
      developerOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      decidedByPositionId: new Types.ObjectId(tenantContext.positionId),
      expectedVersion: dto.expectedVersion,
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }

  @Post(':registrationId/confirm-external')
  @HttpCode(200)
  @RequirePermission('client_registration', 'update')
  async confirmExternal(
    @Req() req: FastifyRequest,
    @Param('registrationId', ParseObjectIdPipe) registrationId: Types.ObjectId,
    @Body() dto: DecideClientRegistrationDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.service.confirmExternal({
      registrationId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      decidedByPositionId: new Types.ObjectId(tenantContext.positionId),
      expectedVersion: dto.expectedVersion,
      correlationId: req.correlationId,
    });
  }

  @Post(':registrationId/complete')
  @HttpCode(200)
  @RequirePermission('client_registration', 'update')
  async complete(
    @Req() req: FastifyRequest,
    @Param('registrationId', ParseObjectIdPipe) registrationId: Types.ObjectId,
    @Body() dto: DecideClientRegistrationDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.service.complete({
      registrationId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      decidedByPositionId: new Types.ObjectId(tenantContext.positionId),
      expectedVersion: dto.expectedVersion,
      correlationId: req.correlationId,
    });
  }

  @Post(':registrationId/cancel')
  @HttpCode(200)
  @RequirePermission('client_registration', 'update')
  async cancel(
    @Req() req: FastifyRequest,
    @Param('registrationId', ParseObjectIdPipe) registrationId: Types.ObjectId,
    @Body() dto: DecideClientRegistrationDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.service.cancel({
      registrationId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      decidedByPositionId: new Types.ObjectId(tenantContext.positionId),
      expectedVersion: dto.expectedVersion,
      correlationId: req.correlationId,
    });
  }
}
