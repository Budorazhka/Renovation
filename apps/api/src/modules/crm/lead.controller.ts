import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { CrmService } from './crm.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { ChangeLeadStageDto } from './dto/change-lead-stage.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { AttachLeadFileDto } from './dto/attach-lead-file.dto';
import { RecordContactActionDto } from './dto/record-contact-action.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { ListLeadEventsDto } from './dto/list-lead-events.dto';
import { ListTimelineDto } from './dto/list-timeline.dto';
import { UpdateLeadChecklistDto } from './dto/update-lead-checklist.dto';
import { SetLeadStageNoteDto } from './dto/set-lead-stage-note.dto';
import { ALL_LEAD_STAGE_VALUES } from './lead-stage';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';

/**
 * ERP tenant-scoped lead-management endpoints — физически отдельный
 * controller от CrmController (публичный reveal-contact, без guard'ов),
 * тот же принцип разделения, что PublicController/AdminPublicationController.
 */
@Controller('leads')
@UseGuards(TenantGuard, PermissionGuard)
export class LeadController {
  constructor(
    private readonly crmService: CrmService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * lead.create.organization — CrmService.createLead докстринг: ровно один
   * из contactId/requesterPhone, лид создаётся unassigned (не auto-
   * assign на actor'а — assignLead отдельная explicit команда).
   *
   * Idempotency-Key ОБЯЗАТЕЛЕН. Раньше здесь стояло обратное со ссылкой на
   * то, что ADR-006 перечисляет только publish/book/cancel/manual-ledger. Но
   * перечень ADR-006 — это примеры критических команд, а не исчерпывающий
   * список: повтор создания лида порождает второй лид, а дубль лида искажает
   * воронку и отчётность по менеджерам, то есть данные, по которым принимают
   * решения. Это дороже дубля справочной сущности.
   *
   * Требование безопасно ввести именно сейчас: на 01.09.2026 ни один клиент
   * этот endpoint не вызывает (ERP ходит в legacy /crm/leads, leadsApiV2
   * использует только чтение), поэтому обязательный header ничего не ломает.
   * Через месяц это было бы breaking change.
   */
  @Post()
  @HttpCode(201)
  @RequirePermission('lead', 'create')
  async createLead(
    @Req() req: FastifyRequest,
    @Body() dto: CreateLeadDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = {
      contactId: dto.contactId ?? null,
      requesterName: dto.requesterName ?? null,
      requesterPhone: dto.requesterPhone ?? null,
      // Не `?? null` намеренно: undefined-значение опускается при
      // сериализации хеша (тот же результат, что "поле вообще не
      // передано"), сохраняя хеш существующих клиентов без productType
      // байт-в-байт идентичным — только явно переданный productType
      // меняет хеш (и, соответственно, стартовую стадию лида).
      productType: dto.productType,
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createLead',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.crmService.createLead({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      contactId: dto.contactId ? new Types.ObjectId(dto.contactId) : undefined,
      requesterName: dto.requesterName,
      requesterPhone: dto.requesterPhone,
      productType: dto.productType,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      correlationId: req.correlationId,
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  @Get()
  @RequirePermission('lead', 'read')
  async listLeads(@Req() req: FastifyRequest, @Query() dto: ListLeadsDto) {
    const tenantContext = requireTenantContext(req);
    const organizationId = new Types.ObjectId(tenantContext.organizationId);
    const ownerPositionId = this.resolveOwnerFilter(
      await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      dto.ownerPositionId,
    );
    return this.crmService.listLeads({
      organizationId,
      ownerPositionId,
      stage: dto.stage,
      stalled: dto.stalled,
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }

  @Get(':leadId')
  @RequirePermission('lead', 'read')
  async getLead(@Req() req: FastifyRequest, @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getLead({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
    });
  }

  /**
   * PATCH /leads/:leadId — сопутствующие поля лида (см. UpdateLeadDto/
   * CrmService.updateLead докстринги). НЕ трогает `stage` — тот путь
   * остаётся под PATCH /leads/:leadId/stage (не дублируется здесь).
   * `lead.update` — новый грант (D-05B прецедент lead.changeStage): та же
   * scope-модель, own для manager/organization для owner/director/rop.
   */
  @Patch(':leadId')
  @HttpCode(200)
  @RequirePermission('lead', 'update')
  async updateLead(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Body() dto: UpdateLeadDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.updateLead({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredOwnerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
      city: dto.city,
      notes: dto.notes,
      tags: dto.tags,
      dealValue: dto.dealValue,
      budgetValue: dto.budgetValue,
      budgetCurrency: dto.budgetCurrency,
      expectedCloseDate: dto.expectedCloseDate,
      rejectionReason: dto.rejectionReason,
      rejectionComment: dto.rejectionComment,
      telegram: dto.telegram,
      country: dto.country,
      realtorStage: dto.realtorStage,
      curatorStage: dto.curatorStage,
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      productType: dto.productType,
    });
  }

  /**
   * GET /leads/:leadId/checklist — lead.read, тот же own/organization
   * scope, что GET /leads/:leadId.
   */
  @Get(':leadId/checklist')
  @RequirePermission('lead', 'read')
  async getLeadChecklist(@Req() req: FastifyRequest, @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getLeadChecklist({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
    });
  }

  /**
   * PATCH /leads/:leadId/checklist — lead.update, тот же own/organization
   * scope, что PATCH /leads/:leadId. Не версионирован намеренно — см.
   * CrmService.updateLeadChecklist/LeadRepository.updateChecklist докстринг.
   */
  @Patch(':leadId/checklist')
  @HttpCode(200)
  @RequirePermission('lead', 'update')
  async updateLeadChecklist(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Body() dto: UpdateLeadChecklistDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.updateLeadChecklist({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredOwnerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      changes: dto.changes,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  /**
   * PUT /leads/:leadId/stage-notes/:stage — lead.update. `stage` —
   * path-параметр, та же coarse-проверка `ALL_LEAD_STAGE_VALUES`, что
   * ChangeLeadStageDto/LeadChecklistChangeDto — здесь вручную, поскольку
   * path-параметр class-validator не проверяет.
   */
  @Put(':leadId/stage-notes/:stage')
  @HttpCode(200)
  @RequirePermission('lead', 'update')
  async setLeadStageNote(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Param('stage') stage: string,
    @Body() dto: SetLeadStageNoteDto,
  ) {
    if (!ALL_LEAD_STAGE_VALUES.includes(stage)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, `"${stage}" is not a known lead stage`, { field: 'stage' });
    }
    const tenantContext = requireTenantContext(req);
    return this.crmService.setLeadStageNote({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredOwnerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      stage,
      text: dto.text,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  /**
   * DELETE /leads/:leadId — soft delete (см. CrmService.deleteLead
   * докстринг). Отдельный грант `lead.delete`, не переиспользует
   * `lead.update` — удаление разрушительнее сопутствующей правки полей,
   * тот же круг ролей, что `lead.assign` (owner/director/rop/developer,
   * organization-wide, БЕЗ manager).
   */
  @Delete(':leadId')
  @HttpCode(200)
  @RequirePermission('lead', 'delete')
  async deleteLead(@Req() req: FastifyRequest, @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.deleteLead({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredOwnerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'delete'),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  /** GET /leads/:leadId/files — легаси getLeadFiles. Read-grant, тот же own/organization scope, что GET /leads/:leadId. */
  @Get(':leadId/files')
  @RequirePermission('lead', 'read')
  async listLeadFiles(@Req() req: FastifyRequest, @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.listLeadFiles({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
    });
  }

  /** POST /leads/:leadId/files — легаси uploadAndRegisterFile. Переиспользует lead.update (мутация лида). */
  @Post(':leadId/files')
  @HttpCode(201)
  @RequirePermission('lead', 'update')
  async attachLeadFile(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Body() dto: AttachLeadFileDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.attachLeadFile({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      assetId: new Types.ObjectId(dto.assetId),
      fileName: dto.fileName,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  /** GET /leads/:leadId/files/:assetId/download — временная ссылка на оригинал вложения, тот же read-scope, что список файлов. */
  @Get(':leadId/files/:assetId/download')
  @RequirePermission('lead', 'read')
  async downloadLeadFile(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Param('assetId', ParseObjectIdPipe) assetId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getLeadFileDownloadUrl({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      assetId,
    });
  }

  /** DELETE /leads/:leadId/files/:assetId — легаси deleteLeadFileByName (по assetId, см. CrmService.detachLeadFile). */
  @Delete(':leadId/files/:assetId')
  @HttpCode(200)
  @RequirePermission('lead', 'update')
  async detachLeadFile(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Param('assetId', ParseObjectIdPipe) assetId: Types.ObjectId,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.detachLeadFile({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      assetId,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  /**
   * POST /leads/:leadId/contact-actions — легаси recordLeadContactAction.
   * Append-only лог (CrmService.recordContactAction докстринг) — переиспользует
   * lead.update (та же мутация-класса действие, что PATCH сопутствующих полей).
   */
  @Post(':leadId/contact-actions')
  @HttpCode(201)
  @RequirePermission('lead', 'update')
  async recordContactAction(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Body() dto: RecordContactActionDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.recordContactAction({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'update'),
      contactType: dto.contactType,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  @Get(':leadId/events')
  @RequirePermission('lead', 'read')
  async listLeadEvents(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Query() dto: ListLeadEventsDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.listLeadEvents({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }

  @Get(':leadId/timeline')
  @RequirePermission('lead', 'read')
  async getLeadTimeline(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Query() dto: ListTimelineDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.getLeadTimeline({
      leadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      ownerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'read'),
      type: dto.type,
      from: dto.from,
      to: dto.to,
      cursor: dto.cursor,
      limit: dto.limit,
    });
  }

  @Post(':leadId/assign')
  @HttpCode(200)
  @RequirePermission('lead', 'assign')
  async assignLead(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Body() dto: AssignLeadDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.assignLead({
      leadId,
      assigneePositionId: new Types.ObjectId(dto.assigneePositionId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      correlationId: req.correlationId,
    });
  }

  /**
   * unassignLead — обратное действие assignLead, тот же грант `lead.assign`
   * (см. CrmService.unassignLead докстринг: снять назначение доступно тому
   * же кругу ролей, что и назначить, отдельный grant не нужен).
   */
  @Post(':leadId/unassign')
  @HttpCode(200)
  @RequirePermission('lead', 'assign')
  async unassignLead(@Req() req: FastifyRequest, @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    return this.crmService.unassignLead({
      leadId,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      correlationId: req.correlationId,
    });
  }

  /**
   * НЕ в узкой OpenAPI-спеке — см. CrmService.changeLeadStage комментарий.
   * D-05B: отдельный grant `lead.changeStage` (не переиспользует
   * `lead.assign`) — подтверждено владельцем: manager должен мочь менять
   * стадию СВОИХ лидов (scope 'own' в DEFAULT_ROLE_GRANTS), в отличие от
   * assign (только owner/director/rop, organization-wide). PermissionGuard
   * проверяет только НАЛИЧИЕ гранта, не сужает по scope (см.
   * PolicyEvaluatorService.scopeCovers) — own-scope сужение до конкретного
   * лида делает ownerFilterForAction ниже, тот же паттерн, что уже
   * применяется для read.
   *
   * Idempotency-Key ОБЯЗАТЕЛЕН — тот же паттерн, что createLead выше:
   * стадия лида напрямую участвует в отчётах по воронке и метриках
   * менеджеров, повтор запроса (клиентский таймаут + ретрай) не должен
   * применить смену стадии дважды и задвоить запись в истории переходов
   * (leadEventRepository.append — event-based история).
   */
  @Patch(':leadId/stage')
  @HttpCode(200)
  @RequirePermission('lead', 'changeStage')
  async changeStage(
    @Req() req: FastifyRequest,
    @Param('leadId', ParseObjectIdPipe) leadId: Types.ObjectId,
    @Body() dto: ChangeLeadStageDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const idempotencyRequestBody = {
      leadId: leadId.toString(),
      stage: dto.stage,
      expectedVersion: dto.expectedVersion,
      // Не `?? null` намеренно (тот же принцип, что createLead::productType):
      // undefined опускается при сериализации хеша, сохраняя хеш существующих
      // клиентов без comment байт-в-байт идентичным.
      comment: dto.comment,
    };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'changeLeadStage',
      key: idempotencyKey,
      requestBody: idempotencyRequestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.crmService.changeLeadStage({
      leadId,
      newStage: dto.stage,
      expectedVersion: dto.expectedVersion,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId,
      expectedOrganizationId: new Types.ObjectId(tenantContext.organizationId),
      requiredOwnerPositionId: await this.ownerFilterForAction(tenantContext.positionId, 'changeStage'),
      comment: dto.comment,
      correlationId: req.correlationId,
      idempotencyKey,
      idempotencyRequestBody,
    });
  }

  /**
   * GET /leads фильтр ownerPositionId — клиентское значение ДОПОЛНИТЕЛЬНО
   * сужает, никогда не расширяет уже резолвленный permission scope
   * (тот же AND-принцип, что AdminAuditService.buildClientFilter):
   *  - scopeFilter===undefined (organization/global grant) → любой клиентский
   *    ownerPositionId проходит как есть, включая undefined (весь tenant).
   *  - scopeFilter задан (own/assigned grant, уже = своя Position) → клиент
   *    может явно запросить ТОЛЬКО ту же самую Position (идемпотентно) или
   *    не передавать фильтр вовсе; запрос чужой Position здесь — попытка
   *    расширить own-scope, отклоняется 400 (не 403 — сам grant на read
   *    есть, это невалидная комбинация фильтров, тот же класс ошибки, что
   *    невалидный cursor/limit, не authorization-отказ).
   */
  private resolveOwnerFilter(
    scopeFilter: Types.ObjectId | undefined,
    clientOwnerPositionId: string | undefined,
  ): Types.ObjectId | undefined {
    if (!clientOwnerPositionId) {
      return scopeFilter;
    }
    const requested = new Types.ObjectId(clientOwnerPositionId);
    if (scopeFilter && !scopeFilter.equals(requested)) {
      throw new BadRequestException('ownerPositionId filter is outside the caller permission scope');
    }
    return requested;
  }

  /**
   * Сужает non-organization/non-global scope до конкретной Position —
   * переиспользуется и для read (GET /leads, GET /leads/:id), и для write
   * (PATCH /leads/:id/stage). PermissionGuard уже подтвердил, что grant с
   * данным action существует (иначе запрос не дошёл бы сюда) — этот метод
   * решает ТОЛЬКО "весь tenant или только своя позиция", не allow/deny.
   */
  private async ownerFilterForAction(positionId: string, action: string): Promise<Types.ObjectId | undefined> {
    const positionObjectId = new Types.ObjectId(positionId);
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: positionObjectId,
      resource: 'lead',
      action,
    });
    // organization/global — весь tenant. Для own/assigned/position и
    // неизвестного будущего scope выбираем безопасное сужение до своей
    // позиции; расширение до team возможно только вместе с моделью
    // подчинённости и отдельным тестом, не "по умолчанию".
    return scopes.some((scope) => scope === 'organization' || scope === 'global')
      ? undefined
      : positionObjectId;
  }
}
