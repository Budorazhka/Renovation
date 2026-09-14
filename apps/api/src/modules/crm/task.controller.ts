import {
  BadRequestException,
  Body,
  Headers,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { CrmService } from './crm.service';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReassignTaskDto } from './dto/reassign-task.dto';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';

/**
 * ERP tenant-scoped Task endpoints.
 * All operations enforce tenant isolation and RBAC permission scoping (own vs organization).
 */
@Controller('tasks')
@UseGuards(TenantGuard, PermissionGuard)
export class TaskController {
  constructor(
    private readonly crmService: CrmService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('task', 'read')
  async listTasks(@Req() req: FastifyRequest, @Query() dto: ListTasksDto) {
    const tenantContext = requireTenantContext(req);
    const organizationId = new Types.ObjectId(tenantContext.organizationId);
    const assignedPositionId = this.resolveOwnerFilter(
      await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      dto.assignedPositionId,
    );

    return this.crmService.listTasks({
      organizationId,
      assignedPositionId,
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      contactId: dto.contactId ? new Types.ObjectId(dto.contactId) : undefined,
      status: dto.status,
      dueBefore: dto.dueBefore ? new Date(dto.dueBefore) : undefined,
      dueAfter: dto.dueAfter ? new Date(dto.dueAfter) : undefined,
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }

  @Get(':taskId')
  @RequirePermission('task', 'read')
  async getTask(
    @Req() req: FastifyRequest,
    @Param('taskId', ParseObjectIdPipe) taskId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getTask({
      taskId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      assignedPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  /**
   * task-attachments-media-assets.md: "скачать вложение из карточки
   * нельзя" — единственный недостающий кусок, storage-примитив
   * (MediaStorageService.createDownloadUrl) уже существовал, вызывать
   * его было неоткуда. Тот же task.read grant и own/personal-scope, что
   * getTask (переиспользует его целиком в сервисе) — если задача не видна
   * вызывающему, до вложения он не доходит.
   */
  @Get(':taskId/attachments/:assetId/download')
  @RequirePermission('task', 'read')
  async downloadAttachment(
    @Req() req: FastifyRequest,
    @Param('taskId', ParseObjectIdPipe) taskId: Types.ObjectId,
    @Param('assetId', ParseObjectIdPipe) assetId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getTaskAttachmentDownloadUrl({
      taskId,
      assetId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      assignedPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
    });
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('task', 'create')
  async createTask(
    @Req() req: FastifyRequest,
    @Body() dto: CreateTaskDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = {
      title: dto.title,
      description: dto.description ?? null,
      dueAt: dto.dueAt ?? null,
      assignedPositionId: dto.assignedPositionId ?? null,
      leadId: dto.leadId ?? null,
      contactId: dto.contactId ?? null,
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createTask',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.crmService.createTask({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      idempotencyKey,
      idempotencyRequestBody,
      idempotencyOperation: 'createTask',
      requiredScopePositionId: await this.ownerFilterForAction(tenantContext.positionId, 'create'),
      title: dto.title,
      description: dto.description,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      assignedPositionId: dto.assignedPositionId ? new Types.ObjectId(dto.assignedPositionId) : undefined,
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      contactId: dto.contactId ? new Types.ObjectId(dto.contactId) : undefined,
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      isUrgent: dto.isUrgent,
      isImportant: dto.isImportant,
      taskCategory: dto.taskCategory,
      taskType: dto.taskType,
      colorHex: dto.colorHex,
      reminderOffsetsMinutes: dto.reminderOffsetsMinutes,
      subtasks: dto.subtasks?.map((item) => ({ id: item.id, title: item.title, done: item.done ?? false })),
      attachments: dto.attachments?.map((item) => ({
        assetId: new Types.ObjectId(item.assetId),
        fileName: item.fileName,
      })),
      correlationId: req.correlationId,
    });
  }

  @Patch(':taskId')
  @HttpCode(200)
  @RequirePermission('task', 'edit')
  async updateTask(
    @Req() req: FastifyRequest,
    @Param('taskId', ParseObjectIdPipe) taskId: Types.ObjectId,
    @Body() dto: UpdateTaskDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.updateTask({
      taskId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      requiredScopePositionId: await this.ownerFilterForAction(tenantContext.positionId, 'edit'),
      expectedVersion: dto.expectedVersion,
      title: dto.title,
      description: dto.description,
      dueAt: dto.dueAt !== undefined ? (dto.dueAt ? new Date(dto.dueAt) : null) : undefined,
      startAt: dto.startAt !== undefined ? (dto.startAt ? new Date(dto.startAt) : null) : undefined,
      status: dto.status,
      subtasks: dto.subtasks?.map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        done: Boolean(subtask.done),
      })),
      isUrgent: dto.isUrgent,
      isImportant: dto.isImportant,
      taskCategory: dto.taskCategory,
      taskType: dto.taskType,
      colorHex: dto.colorHex,
      leadId: dto.leadId !== undefined ? (dto.leadId ? new Types.ObjectId(dto.leadId) : null) : undefined,
      attachments: dto.attachments?.map((item) => ({
        assetId: new Types.ObjectId(item.assetId),
        fileName: item.fileName,
      })),
      correlationId: req.correlationId,
    });
  }

  /**
   * task.reassign — отдельный grant от task.edit (см. CrmService.reassignTask
   * докстринг). PATCH, не POST — идемпотентная замена значения поля
   * assignedPositionId, тот же HTTP-семантический выбор, что PATCH
   * /leads/:id/stage (не POST /leads/:id/assign — здесь endpoint новый,
   * выбираем PATCH единообразно с остальными Task-мутациями по одному ресурсу).
   */
  @Patch(':taskId/reassign')
  @HttpCode(200)
  @RequirePermission('task', 'reassign')
  async reassignTask(
    @Req() req: FastifyRequest,
    @Param('taskId', ParseObjectIdPipe) taskId: Types.ObjectId,
    @Body() dto: ReassignTaskDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.reassignTask({
      taskId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      requiredScopePositionId: await this.ownerFilterForAction(tenantContext.positionId, 'reassign'),
      expectedVersion: dto.expectedVersion,
      assignedPositionId: dto.assignedPositionId ? new Types.ObjectId(dto.assignedPositionId) : null,
      correlationId: req.correlationId,
    });
  }

  @Post(':taskId/complete')
  @HttpCode(200)
  @RequirePermission('task', 'complete')
  async completeTask(
    @Req() req: FastifyRequest,
    @Param('taskId', ParseObjectIdPipe) taskId: Types.ObjectId,
    @Body() dto: CompleteTaskDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.completeTask({
      taskId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      requiredScopePositionId: await this.ownerFilterForAction(tenantContext.positionId, 'complete'),
      expectedVersion: dto.expectedVersion,
      correlationId: req.correlationId,
    });
  }

  private resolveOwnerFilter(
    scopeFilter: Types.ObjectId | undefined,
    clientAssignedPositionId: string | undefined,
  ): Types.ObjectId | undefined {
    if (!clientAssignedPositionId) {
      return scopeFilter;
    }
    const requested = new Types.ObjectId(clientAssignedPositionId);
    if (scopeFilter && !scopeFilter.equals(requested)) {
      throw new BadRequestException('assignedPositionId filter is outside the caller permission scope');
    }
    return requested;
  }

  private async ownerFilterForAction(positionId: string, action: string): Promise<Types.ObjectId | undefined> {
    const positionObjectId = new Types.ObjectId(positionId);
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: positionObjectId,
      resource: 'task',
      action,
    });
    return scopes.some((scope) => scope === 'organization' || scope === 'global')
      ? undefined
      : positionObjectId;
  }
}
