import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ListNotesDto } from './dto/list-notes.dto';

/**
 * Личный блокнот менеджера в ERP. ВСЕГДА own-scope, у всех ролей без
 * исключения (permission-matrix.md §1.9) — в отличие от Task/Lead здесь
 * нет organization-wide гранта: заметка видна и меняется только своим
 * автором (tenantContext.positionId), owner/director чужую не видят.
 */
@Controller('notes')
@UseGuards(TenantGuard, PermissionGuard)
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('note', 'read')
  async listNotes(@Req() req: FastifyRequest, @Query() dto: ListNotesDto) {
    const tenantContext = requireTenantContext(req);
    return this.notesService.listNotes({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      authorPositionId: new Types.ObjectId(tenantContext.positionId),
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }

  @Get(':noteId')
  @RequirePermission('note', 'read')
  async getNote(@Req() req: FastifyRequest, @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.notesService.getNote({
      noteId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      authorPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  @Get(':noteId/attachments/:assetId/download')
  @RequirePermission('note', 'read')
  async downloadAttachment(
    @Req() req: FastifyRequest,
    @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId,
    @Param('assetId', ParseObjectIdPipe) assetId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.notesService.getNoteAttachmentDownloadUrl({
      noteId,
      assetId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      authorPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('note', 'create')
  async createNote(
    @Req() req: FastifyRequest,
    @Body() dto: CreateNoteDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = {
      title: dto.title,
      content: dto.content ?? null,
      isPinned: dto.isPinned ?? null,
      category: dto.category ?? null,
      leadId: dto.leadId ?? null,
      attachments: dto.attachments ?? null,
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createNote',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    const leadScope = dto.leadId ? await this.leadScopeForCaller(tenantContext.positionId) : undefined;

    return this.notesService.createNote({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      authorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      title: dto.title,
      content: dto.content,
      isPinned: dto.isPinned,
      category: dto.category,
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      leadScopeAllowed: leadScope?.allowed,
      leadOwnerPositionId: leadScope?.ownerPositionId,
      attachments: dto.attachments?.map((item) => ({
        assetId: new Types.ObjectId(item.assetId),
        fileName: item.fileName,
      })),
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Patch(':noteId')
  @HttpCode(200)
  @RequirePermission('note', 'update')
  async updateNote(
    @Req() req: FastifyRequest,
    @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId,
    @Body() dto: UpdateNoteDto,
  ) {
    const tenantContext = requireTenantContext(req);
    const leadScope = dto.leadId ? await this.leadScopeForCaller(tenantContext.positionId) : undefined;

    return this.notesService.updateNote({
      noteId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      authorPositionId: new Types.ObjectId(tenantContext.positionId),
      expectedVersion: dto.expectedVersion,
      title: dto.title,
      content: dto.content,
      isPinned: dto.isPinned,
      category: dto.category,
      leadId: dto.leadId !== undefined ? (dto.leadId ? new Types.ObjectId(dto.leadId) : null) : undefined,
      leadScopeAllowed: leadScope?.allowed,
      leadOwnerPositionId: leadScope?.ownerPositionId,
      attachments: dto.attachments?.map((item) => ({
        assetId: new Types.ObjectId(item.assetId),
        fileName: item.fileName,
      })),
    });
  }

  @Delete(':noteId')
  @HttpCode(204)
  @RequirePermission('note', 'delete')
  async deleteNote(@Req() req: FastifyRequest, @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    await this.notesService.deleteNote({
      noteId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      authorPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  /**
   * lead.read scope вызывающего — определяет, можно ли привязать leadId к
   * заметке, и если да, каким ownerPositionId сузить getLeadForOrganization
   * (см. NotesService.createNote/updateNote докстринг). `allowed:false`
   * означает "гранта lead.read нет вовсе" — тот же случай, когда сервис
   * обязан вернуть 403, не пропустить привязку молча.
   */
  private async leadScopeForCaller(positionId: string): Promise<{ allowed: boolean; ownerPositionId?: Types.ObjectId }> {
    const positionObjectId = new Types.ObjectId(positionId);
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: positionObjectId,
      resource: 'lead',
      action: 'read',
    });
    if (scopes.length === 0) {
      return { allowed: false };
    }
    const wide = scopes.some((scope) => scope === 'organization' || scope === 'global');
    return { allowed: true, ownerPositionId: wide ? undefined : positionObjectId };
  }
}
