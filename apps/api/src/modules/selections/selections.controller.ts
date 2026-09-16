import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SelectionsService, toSelectionResponse } from './selections.service';
import { CreateSelectionDto } from './dto/create-selection.dto';
import { UpdateSelectionDto } from './dto/update-selection.dto';
import { SetSelectionStatusDto } from './dto/set-status.dto';
import { AddSelectionItemsDto } from './dto/add-items.dto';
import { UpdateSelectionItemDto } from './dto/update-item.dto';
import { ListSelectionsQueryDto } from './dto/list-selections-query.dto';

/**
 * Приватные (organization-scoped) эндпоинты подборок для клиента. Публичная
 * сторона (GET по publicToken, без аутентификации) — PublicSelectionsController.
 *
 * `dev_selection.*` — новый resource, own-scope у manager (видит/меняет
 * только созданные им подборки, тот же принцип, что booking.read.own),
 * organization-scope у owner/director/rop/developer — см.
 * default-role-grants.ts докстринг и `DEFAULT_ROLE_GRANTS`.
 */
@Controller('selections')
@UseGuards(TenantGuard, PermissionGuard)
export class SelectionsController {
  constructor(
    private readonly selectionsService: SelectionsService,
    private readonly policyEvaluator: PolicyEvaluatorService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('dev_selection', 'create')
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateSelectionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { title: dto.title, unitIds: dto.unitIds ?? [], listingIds: dto.listingIds ?? [] };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'createSelection', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const created = await this.selectionsService.createSelection({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      createdByPositionId: new Types.ObjectId(tenantContext.positionId),
      title: dto.title,
      unitIds: (dto.unitIds ?? []).map((id) => new Types.ObjectId(id)),
      listingIds: (dto.listingIds ?? []).map((id) => new Types.ObjectId(id)),
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      clientName: dto.clientName,
      clientPhone: dto.clientPhone,
      agentNote: dto.agentNote,
      customization: dto.customization,
      idempotency: { identityId, operation: 'createSelection', key: idempotencyKey, requestBody },
    });
    return toSelectionResponse(created);
  }

  @Get()
  @RequirePermission('dev_selection', 'read')
  async list(@Req() req: FastifyRequest, @Query() query: ListSelectionsQueryDto) {
    const tenantContext = requireTenantContext(req);
    const items = await this.selectionsService.listSelections(new Types.ObjectId(tenantContext.organizationId), {
      status: query.status,
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
    });
    return { items: items.map(toSelectionResponse) };
  }

  @Get(':id')
  @RequirePermission('dev_selection', 'read')
  async getOne(@Req() req: FastifyRequest, @Param('id') id: string) {
    const tenantContext = requireTenantContext(req);
    const selection = await this.selectionsService.getSelection(
      new Types.ObjectId(id),
      new Types.ObjectId(tenantContext.organizationId),
      await this.ownerFilterForAction(tenantContext.positionId, 'read'),
    );
    return toSelectionResponse(selection);
  }

  @Patch(':id')
  @RequirePermission('dev_selection', 'update')
  async update(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSelectionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { id, expectedVersion: dto.expectedVersion, title: dto.title };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'updateSelection', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const { expectedVersion, leadId, ...patchFields } = dto;
    const updated = await this.selectionsService.updateSelection({
      id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      expectedVersion,
      patch: { ...patchFields, leadId: leadId ? new Types.ObjectId(leadId) : undefined },
      idempotency: { identityId, operation: 'updateSelection', key: idempotencyKey, requestBody },
    });
    return toSelectionResponse(updated);
  }

  @Patch(':id/status')
  @RequirePermission('dev_selection', 'update')
  async setStatus(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: SetSelectionStatusDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { id, expectedVersion: dto.expectedVersion, status: dto.status };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'setSelectionStatus', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const updated = await this.selectionsService.setStatus({
      id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      expectedVersion: dto.expectedVersion,
      status: dto.status,
      idempotency: { identityId, operation: 'setSelectionStatus', key: idempotencyKey, requestBody },
    });
    return toSelectionResponse(updated);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('dev_selection', 'delete')
  async remove(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Query('expectedVersion') expectedVersionParam: string | undefined,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const expectedVersion = expectedVersionParam !== undefined ? parseInt(expectedVersionParam, 10) : 0;
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { id, expectedVersion };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'deleteSelection', idempotencyKey, requestBody);
    if (replay) {
      return;
    }

    await this.selectionsService.deleteSelection({
      id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'delete'),
      expectedVersion,
      idempotency: { identityId, operation: 'deleteSelection', key: idempotencyKey, requestBody },
    });
  }

  @Post(':id/items')
  @RequirePermission('dev_selection', 'update')
  async addItems(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: AddSelectionItemsDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { id, expectedVersion: dto.expectedVersion, unitIds: dto.unitIds ?? [], listingIds: dto.listingIds ?? [] };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'addSelectionItems', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const updated = await this.selectionsService.addItems({
      id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      expectedVersion: dto.expectedVersion,
      unitIds: (dto.unitIds ?? []).map((unitId) => new Types.ObjectId(unitId)),
      listingIds: (dto.listingIds ?? []).map((listingId) => new Types.ObjectId(listingId)),
      idempotency: { identityId, operation: 'addSelectionItems', key: idempotencyKey, requestBody },
    });
    return toSelectionResponse(updated);
  }

  /** itemId — id юнита либо объявления (N-27); SelectionsService.removeItem бьёт по обоим полям сразу, см. репозиторий. */
  @Delete(':id/items/:itemId')
  @RequirePermission('dev_selection', 'update')
  async removeItem(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Query('expectedVersion') expectedVersionParam: string | undefined,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const expectedVersion = expectedVersionParam !== undefined ? parseInt(expectedVersionParam, 10) : 0;
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { id, itemId, expectedVersion };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'removeSelectionItem', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const updated = await this.selectionsService.removeItem({
      id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      expectedVersion,
      itemId: new Types.ObjectId(itemId),
      idempotency: { identityId, operation: 'removeSelectionItem', key: idempotencyKey, requestBody },
    });
    return toSelectionResponse(updated);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('dev_selection', 'update')
  async updateItem(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSelectionItemDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { id, itemId, expectedVersion: dto.expectedVersion, agentNote: dto.agentNote, reaction: dto.reaction };
    const replay = await this.selectionsService.checkCreateReplay(identityId, 'updateSelectionItem', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const updated = await this.selectionsService.updateItem({
      id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      expectedVersion: dto.expectedVersion,
      itemId: new Types.ObjectId(itemId),
      patch: { agentNote: dto.agentNote, reaction: dto.reaction },
      idempotency: { identityId, operation: 'updateSelectionItem', key: idempotencyKey, requestBody },
    });
    return toSelectionResponse(updated);
  }

  /**
   * Сужает non-organization scope до конкретной Position — тот же паттерн,
   * что BookingsController/LeadController.ownerFilterForAction.
   * PermissionGuard уже подтвердил наличие гранта; этот метод решает
   * только "весь tenant или только своя подборка", не allow/deny.
   */
  private async ownerFilterForAction(positionId: string, action: string): Promise<Types.ObjectId | undefined> {
    const positionObjectId = new Types.ObjectId(positionId);
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: positionObjectId,
      resource: 'dev_selection',
      action,
    });
    return scopes.some((scope) => scope === 'organization' || scope === 'global') ? undefined : positionObjectId;
  }
}
