import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { OrganizationsService } from './organizations.service';
import { AssignOccupantByIdentityDto } from './dto/assign-occupant-by-identity.dto';
import { GrantPositionPermissionDto } from './dto/grant-position-permission.dto';
import { RevokePositionGrantDto } from './dto/revoke-position-grant.dto';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';

/**
 * ERP tenant-scoped endpoints (ADR-002, ADR-003). Первый реальный vertical
 * slice, демонстрирующий полную цепочку TenantGuard → PermissionGuard →
 * транзакционный command → audit + outbox (C-07/C-08 интеграция).
 */
@Controller('organizations')
@UseGuards(TenantGuard, PermissionGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * permission-matrix.md 1.4: position.assign_occupant.organization.
   * :organizationId в URL используется только для читаемости REST-пути —
   * фактическая tenant-принадлежность позиции проверяется ниже сравнением
   * с TenantContext.organizationId (ADR-002 требование 1: organizationId
   * из URL/body клиента никогда не доверяется напрямую).
   */
  @Post(':organizationId/positions/:positionId/assign')
  @HttpCode(200)
  @RequirePermission('position', 'assign_occupant')
  async assignOccupant(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Param('positionId') positionIdParam: string,
    @Body() dto: AssignOccupantByIdentityDto,
  ): Promise<{ assignmentId: string }> {
    const tenantContext = requireTenantContext(req);

    // Deny-by-default защита от подмены organizationId в URL (ADR-002
    // требование 1): URL — не источник истины. Сервис ниже дополнительно
    // проверяет фактическую organizationId позиции по БД через position;
    // эта проверка — быстрый reject без похода в БД, когда URL и
    // session-контекст просто не совпадают синтаксически.
    if (organizationIdParam !== tenantContext.organizationId.toString()) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Organization not found');
    }

    const assignmentId = await this.organizationsService.assignOccupant({
      positionId: new Types.ObjectId(positionIdParam),
      identityId: new Types.ObjectId(dto.identityId),
      occupantDisplayName: dto.occupantDisplayName,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      correlationId: req.correlationId,
    });

    return { assignmentId: assignmentId.toString() };
  }

  /**
   * permission-matrix.md 1.4: personal_access.grant.position — owner/
   * director explicit ⚙-toggle (owner decision xlsx #53/#24 "тумблер").
   * :organizationId в URL — та же читаемость-only роль, что assignOccupant
   * выше, фактическая проверка — expectedOrganizationId из TenantContext.
   */
  @Post(':organizationId/positions/:positionId/grants')
  @HttpCode(200)
  @RequirePermission('personal_access', 'grant')
  async grantPositionPermission(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Param('positionId') positionIdParam: string,
    @Body() dto: GrantPositionPermissionDto,
  ): Promise<{ granted: true }> {
    const tenantContext = requireTenantContext(req);

    if (organizationIdParam !== tenantContext.organizationId.toString()) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Organization not found');
    }

    await this.organizationsService.grantPositionPermission({
      positionId: new Types.ObjectId(positionIdParam),
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      resource: dto.resource,
      action: dto.action,
      scope: dto.scope,
      scopeValue: dto.scopeValue,
    });

    return { granted: true };
  }

  /**
   * `personal_access.read.position` — полный список грантов позиции
   * (включая отозванные, с version для последующего revoke).
   * :organizationId — та же читаемость-only роль, что у соседних роутов.
   */
  @Get(':organizationId/positions/:positionId/grants')
  @RequirePermission('personal_access', 'read')
  async listPositionGrants(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Param('positionId') positionIdParam: string,
  ) {
    const tenantContext = requireTenantContext(req);

    if (organizationIdParam !== tenantContext.organizationId.toString()) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Organization not found');
    }

    const grants = await this.organizationsService.listPositionGrants({
      positionId: new Types.ObjectId(positionIdParam),
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
    });

    return {
      items: grants.map((g) => ({
        id: g.id.toString(),
        resource: g.resource,
        action: g.action,
        scope: g.scope,
        scopeValue: g.scopeValue,
        version: g.version,
        revokedAt: g.revokedAt?.toISOString(),
        revokeReason: g.revokeReason,
      })),
    };
  }

  /**
   * `personal_access.revoke.position` — обратная операция к POST .../grants
   * (owner decision xlsx #53/#24 «тумблер» — выключение права поверх
   * дефолтного набора роли, append-only, см. OrganizationsService.
   * revokePositionGrant докстринг).
   */
  @Post(':organizationId/positions/:positionId/grants/:grantId/revoke')
  @HttpCode(200)
  @RequirePermission('personal_access', 'revoke')
  async revokePositionGrant(
    @Req() req: FastifyRequest,
    @Param('organizationId') organizationIdParam: string,
    @Param('positionId') positionIdParam: string,
    @Param('grantId', ParseObjectIdPipe) grantId: Types.ObjectId,
    @Body() dto: RevokePositionGrantDto,
  ): Promise<{ revoked: true }> {
    const tenantContext = requireTenantContext(req);

    if (organizationIdParam !== tenantContext.organizationId.toString()) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Organization not found');
    }

    await this.organizationsService.revokePositionGrant({
      positionId: new Types.ObjectId(positionIdParam),
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      grantId,
      expectedVersion: dto.expectedVersion,
      reason: dto.reason,
      revokedBy: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });

    return { revoked: true };
  }
}
