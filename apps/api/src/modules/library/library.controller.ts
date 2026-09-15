import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { LibraryService } from './library.service';
import { ListLibraryItemsDto } from './dto/list-library-items.dto';
import { CreateLibraryItemDto } from './dto/create-library-item.dto';
import { CreateLibraryFolderDto, ListLibraryFoldersDto } from './dto/library-folder.dto';

/**
 * Библиотека материалов CRM (permission-matrix.md §1.10). library_item.read —
 * у всех ролей; create/delete со scope organization — может менять общие
 * материалы организации, scope own — только свою личную библиотеку. Папки
 * есть только у личной библиотеки и подчиняются тем же create/delete.
 */
@Controller('library')
@UseGuards(TenantGuard, PermissionGuard)
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get('items')
  @RequirePermission('library_item', 'read')
  async listItems(@Req() req: FastifyRequest, @Query() dto: ListLibraryItemsDto) {
    const tenantContext = requireTenantContext(req);
    return this.libraryService.listItems({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      scope: dto.scope,
      productType: dto.productType,
      folderId: dto.folderId ? new Types.ObjectId(dto.folderId) : undefined,
      canManageOrganization: await this.hasOrganizationScope(tenantContext.positionId, 'create'),
    });
  }

  @Get('items/:itemId/download')
  @RequirePermission('library_item', 'read')
  async downloadItem(@Req() req: FastifyRequest, @Param('itemId', ParseObjectIdPipe) itemId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.libraryService.getItemDownloadUrl({
      itemId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  @Post('items')
  @HttpCode(201)
  @RequirePermission('library_item', 'create')
  async createItem(
    @Req() req: FastifyRequest,
    @Body() dto: CreateLibraryItemDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = {
      scope: dto.scope,
      assetId: dto.assetId,
      fileName: dto.fileName,
      productType: dto.productType ?? null,
      folderId: dto.folderId ?? null,
    };
    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createLibraryItem',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.libraryService.createItem({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      scope: dto.scope,
      assetId: new Types.ObjectId(dto.assetId),
      fileName: dto.fileName,
      productType: dto.productType,
      folderId: dto.folderId ? new Types.ObjectId(dto.folderId) : undefined,
      canManageOrganization: await this.hasOrganizationScope(tenantContext.positionId, 'create'),
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Delete('items/:itemId')
  @HttpCode(204)
  @RequirePermission('library_item', 'delete')
  async deleteItem(@Req() req: FastifyRequest, @Param('itemId', ParseObjectIdPipe) itemId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    await this.libraryService.deleteItem({
      itemId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      canManageOrganization: await this.hasOrganizationScope(tenantContext.positionId, 'delete'),
    });
  }

  @Get('folders')
  @RequirePermission('library_item', 'read')
  async listFolders(@Req() req: FastifyRequest, @Query() dto: ListLibraryFoldersDto) {
    const tenantContext = requireTenantContext(req);
    return this.libraryService.listFolders({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: new Types.ObjectId(tenantContext.positionId),
      parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : undefined,
    });
  }

  @Post('folders')
  @HttpCode(201)
  @RequirePermission('library_item', 'create')
  async createFolder(
    @Req() req: FastifyRequest,
    @Body() dto: CreateLibraryFolderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = { name: dto.name, parentId: dto.parentId ?? null };
    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createLibraryFolder',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.libraryService.createFolder({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      name: dto.name,
      parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : undefined,
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Delete('folders/:folderId')
  @HttpCode(204)
  @RequirePermission('library_item', 'delete')
  async deleteFolder(@Req() req: FastifyRequest, @Param('folderId', ParseObjectIdPipe) folderId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    await this.libraryService.deleteFolder({
      folderId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  /** Есть ли у позиции грант действия со scope organization/global — право менять общие материалы организации. */
  private async hasOrganizationScope(positionId: string, action: 'create' | 'delete'): Promise<boolean> {
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: new Types.ObjectId(positionId),
      resource: 'library_item',
      action,
    });
    return scopes.some((scope) => scope === 'organization' || scope === 'global');
  }
}
