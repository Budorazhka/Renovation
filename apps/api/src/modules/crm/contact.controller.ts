import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CrmService } from './crm.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { ListTimelineDto } from './dto/list-timeline.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

/**
 * ERP tenant-scoped contact endpoints — тот же принцип разделения, что
 * LeadController (физически отдельный controller от CrmController, у
 * которого публичный reveal-contact без guard'ов).
 */
@Controller('contacts')
@UseGuards(TenantGuard, PermissionGuard)
export class ContactController {
  constructor(
    private readonly crmService: CrmService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('contact', 'read')
  async listContacts(@Req() req: FastifyRequest, @Query() dto: ListContactsDto) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.listContacts({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      q: dto.q,
      segment: dto.segment,
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }

  /**
   * N-20: «Добавить клиента» в ERP без лида. Тот же Idempotency-Key
   * паттерн, что POST /leads (LeadController.createLead) — повтор не
   * должен завести второго клиента.
   */
  @Post()
  @HttpCode(201)
  @RequirePermission('contact', 'create')
  async createContact(
    @Req() req: FastifyRequest,
    @Body() dto: CreateContactDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = {
      name: dto.name,
      phone: dto.phone,
      email: dto.email ?? null,
      roles: dto.roles ?? [],
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createContact',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.crmService.createContact({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      roles: dto.roles,
      actorIdentityId,
      correlationId: req.correlationId,
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Get(':contactId')
  @RequirePermission('contact', 'read')
  async getContact(
    @Req() req: FastifyRequest,
    @Param('contactId', ParseObjectIdPipe) contactId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getContact({
      contactId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
    });
  }

  @Patch(':contactId')
  @RequirePermission('contact', 'update')
  async updateContact(
    @Req() req: FastifyRequest,
    @Param('contactId', ParseObjectIdPipe) contactId: Types.ObjectId,
    @Body() dto: UpdateContactDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.updateContact({
      contactId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      roles: dto.roles,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  @Get(':contactId/timeline')
  @RequirePermission('contact', 'read')
  async getContactTimeline(
    @Req() req: FastifyRequest,
    @Param('contactId', ParseObjectIdPipe) contactId: Types.ObjectId,
    @Query() dto: ListTimelineDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getContactTimeline({
      contactId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      type: dto.type,
      from: dto.from,
      to: dto.to,
      cursor: dto.cursor,
      limit: dto.limit,
    });
  }

  /**
   * Тот же паттерн, что LeadController.ownerFilterForAction — сужает
   * non-organization/non-global scope до текущей Position.
   * CrmService.listContacts/getContact резолвят это в множество "своих"
   * contactId ТРАНЗИТИВНО через Lead (см. их докстринги) — Contact сам по
   * себе не хранит ownerPositionId.
   */
  private async ownerFilterForAction(positionId: string, action: string): Promise<Types.ObjectId | undefined> {
    const positionObjectId = new Types.ObjectId(positionId);
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: positionObjectId,
      resource: 'contact',
      action,
    });
    return scopes.some((scope) => scope === 'organization' || scope === 'global')
      ? undefined
      : positionObjectId;
  }
}
