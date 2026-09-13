import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
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
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { MessengerService } from './messenger.service';
import {
  AddTelegramBotAccountDto,
  AddWhatsAppAccountDto,
  ListAccountsQueryDto,
  ListDialogsQueryDto,
  ListMessagesQueryDto,
  SendTextMessageDto,
  SendMediaMessageDto,
  LinkDialogCrmDto,
  CreateTaskFromDialogDto,
} from './dto/messenger.dto';

@Controller('messenger')
@UseGuards(TenantGuard, PermissionGuard)
export class MessengerController {
  constructor(
    private readonly messengerService: MessengerService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * ИСПРАВЛЕНО 11.09.2026: раньше вызывался только для чтения (listDialogs/
   * getDialog/listMessages/markDialogRead) — отправка сообщений, link-crm и
   * создание задачи из диалога own-scope не проверяли вовсе. Менеджер с
   * грантом `own` на `messenger_message.send`/`messenger_dialog.link_crm`
   * (единственная роль с `own` на эти права, см. default-role-grants.ts)
   * мог писать в чужие диалоги своей организации и перепривязывать их к
   * другому лиду/сделке — `@RequirePermission` проверяет только сам факт
   * наличия гранта, не то, что каждый из этих действий должен применяться к
   * назначенному ЕМУ диалогу.
   *
   * `resource` — своя пара resource/action для КАЖДОГО права: own-scope на
   * `messenger_message.send` и `messenger_dialog.link_crm` — это два разных
   * гранта с независимым scope, не один и тот же `messenger_dialog.read`.
   */
  private async ownerFilterForAction(
    positionId: string,
    action: string,
    resource: string = 'messenger_dialog',
  ): Promise<Types.ObjectId | undefined> {
    const positionObjectId = new Types.ObjectId(positionId);
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: positionObjectId,
      resource,
      action,
    });
    return scopes.some((scope) => scope === 'organization' || scope === 'global')
      ? undefined
      : positionObjectId;
  }

  @Get('accounts')
  @RequirePermission('messenger_account', 'read')
  async listAccounts(@Req() req: FastifyRequest, @Query() dto: ListAccountsQueryDto) {
    const tenantContext = requireTenantContext(req);
    return this.messengerService.listAccounts(
      new Types.ObjectId(tenantContext.organizationId),
      dto.platform,
    );
  }

  @Post('accounts/telegram/bot')
  @RequirePermission('messenger_account', 'manage')
  async addTelegramBot(
    @Req() req: FastifyRequest,
    @Body() dto: AddTelegramBotAccountDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Заголовок Idempotency-Key обязателен');
    }
    const tenantContext = requireTenantContext(req);
    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = { name: dto.name, botToken: dto.botToken };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'addTelegramBotAccount',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.messengerService.addTelegramBot({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId,
      name: dto.name,
      botToken: dto.botToken,
      correlationId: req.correlationId ?? '',
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Post('accounts/whatsapp')
  @RequirePermission('messenger_account', 'manage')
  async addWhatsAppAccount(
    @Req() req: FastifyRequest,
    @Body() dto: AddWhatsAppAccountDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Заголовок Idempotency-Key обязателен');
    }
    const tenantContext = requireTenantContext(req);
    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = { name: dto.name, phoneNumber: dto.phoneNumber ?? null };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'addWhatsAppAccount',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.messengerService.addWhatsAppAccount({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId,
      name: dto.name,
      phoneNumber: dto.phoneNumber,
      correlationId: req.correlationId ?? '',
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Delete('accounts/:accountId')
  @RequirePermission('messenger_account', 'manage')
  async deleteAccount(
    @Req() req: FastifyRequest,
    @Param('accountId', ParseObjectIdPipe) accountId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    const success = await this.messengerService.deleteAccount({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      accountId,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId ?? '',
    });
    return { success };
  }

  @Get('dialogs')
  @RequirePermission('messenger_dialog', 'read')
  async listDialogs(@Req() req: FastifyRequest, @Query() dto: ListDialogsQueryDto) {
    const tenantContext = requireTenantContext(req);
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'read');

    return this.messengerService.listDialogs({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      assignedPositionId,
      accountId: dto.accountId ? new Types.ObjectId(dto.accountId) : undefined,
      platform: dto.platform,
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      contactId: dto.contactId ? new Types.ObjectId(dto.contactId) : undefined,
      dealId: dto.dealId ? new Types.ObjectId(dto.dealId) : undefined,
      search: dto.search,
      cursor: dto.cursor,
      limit: dto.limit,
    });
  }

  @Get('dialogs/:dialogId')
  @RequirePermission('messenger_dialog', 'read')
  async getDialog(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'read');

    return this.messengerService.getDialog({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
    });
  }

  @Get('dialogs/:dialogId/messages')
  @RequirePermission('messenger_dialog', 'read')
  async listMessages(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
    @Query() dto: ListMessagesQueryDto,
  ) {
    const tenantContext = requireTenantContext(req);
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'read');

    return this.messengerService.listMessages({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }

  @Post('dialogs/:dialogId/messages')
  @RequirePermission('messenger_message', 'send')
  async sendTextMessage(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
    @Body() dto: SendTextMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Заголовок Idempotency-Key обязателен');
    }
    const tenantContext = requireTenantContext(req);
    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    // 'send', не 'read': own-scope здесь — отдельный грант messenger_message.send.
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'send', 'messenger_message');
    const idempotencyRequestBody = { dialogId: dialogId.toString(), text: dto.text };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'sendMessengerTextMessage',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.messengerService.sendTextMessage({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
      senderPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      text: dto.text,
      correlationId: req.correlationId ?? '',
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Post('dialogs/:dialogId/messages/media')
  @RequirePermission('messenger_message', 'send')
  async sendMediaMessage(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
    @Body() dto: SendMediaMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Заголовок Idempotency-Key обязателен');
    }
    const tenantContext = requireTenantContext(req);
    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'send', 'messenger_message');
    const idempotencyRequestBody = {
      dialogId: dialogId.toString(),
      text: dto.text ?? null,
      messageType: dto.messageType ?? 'text',
      assetId: dto.assetId ?? null,
      url: dto.url ?? null,
      fileName: dto.fileName ?? null,
      mimeType: dto.mimeType ?? null,
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'sendMessengerMediaMessage',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.messengerService.sendMediaMessage({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
      senderPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      text: dto.text,
      messageType: dto.messageType,
      media: {
        assetId: dto.assetId ? new Types.ObjectId(dto.assetId) : undefined,
        url: dto.url,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
      },
      correlationId: req.correlationId ?? '',
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Post('dialogs/:dialogId/read')
  @HttpCode(200)
  @RequirePermission('messenger_dialog', 'read')
  async markDialogRead(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'read');

    const success = await this.messengerService.markDialogRead({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
    });
    return { success };
  }

  @Post('dialogs/:dialogId/link-crm')
  @HttpCode(200)
  @RequirePermission('messenger_dialog', 'link_crm')
  async linkDialogToCrm(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
    @Body() dto: LinkDialogCrmDto,
  ) {
    const tenantContext = requireTenantContext(req);
    // Тот же resource, что у getDialog/listDialogs — messenger_dialog.link_crm
    // own-scope у manager (default-role-grants.ts), в отличие от send выше.
    // Передаётся и в саму привязку диалога (assertDialogOwnership), и в
    // проверку лида/контакта/сделки (own-scope конкретной записи,
    // messenger-skeleton.md, закрыто 14.09.2026) — до этого сужалась только
    // принадлежность организации, manager с own-scope мог привязать диалог
    // к лиду/сделке чужого менеджера той же организации.
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'link_crm');
    return this.messengerService.linkDialogToCrm({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : undefined,
      contactId: dto.contactId ? new Types.ObjectId(dto.contactId) : undefined,
      dealId: dto.dealId ? new Types.ObjectId(dto.dealId) : undefined,
      expectedVersion: dto.expectedVersion,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId ?? '',
    });
  }

  @Post('dialogs/:dialogId/create-task')
  @RequirePermission('task', 'create')
  async createTaskFromDialog(
    @Req() req: FastifyRequest,
    @Param('dialogId', ParseObjectIdPipe) dialogId: Types.ObjectId,
    @Body() dto: CreateTaskFromDialogDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Заголовок Idempotency-Key обязателен');
    }
    const tenantContext = requireTenantContext(req);
    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    // Тот же грант, что открывает сам диалог: нельзя создать задачу из
    // диалога, который own-scope и так не даёт увидеть.
    const assignedPositionId = await this.ownerFilterForAction(tenantContext.positionId, 'read');
    const idempotencyRequestBody = {
      dialogId: dialogId.toString(),
      title: dto.title,
      description: dto.description ?? null,
      dueAt: dto.dueAt ?? null,
      isUrgent: dto.isUrgent ?? null,
      isImportant: dto.isImportant ?? null,
    };

    // ИСПРАВЛЕНО 11.09.2026: было 'createTask' — тот же operation, что
    // POST /tasks (task.controller.ts). Одинаковый Idempotency-Key на двух
    // разных эндпоинтах ловил чужую запись по (identityId, operation, key) и
    // давал IDEMPOTENCY_KEY_CONFLICT вместо двух независимых задач — тела
    // запросов у них разные (см. CreateTaskDto vs CreateTaskFromDialogDto),
    // поэтому дальше чем "конфликт хешей" это даже не доходило.
    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createTaskFromDialog',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.messengerService.createTaskFromDialog({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      dialogId,
      assignedPositionId,
      actorIdentityId,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      title: dto.title,
      description: dto.description,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      isUrgent: dto.isUrgent,
      isImportant: dto.isImportant,
      correlationId: req.correlationId ?? '',
      idempotencyKey,
      idempotencyRequestBody,
    });
  }
}
