import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
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
import { NewsService } from './news.service';
import { CreateNewsArticleDto, UpdateNewsArticleDto, newsIdempotencyBody } from './dto/create-news-article.dto';

/**
 * Лента новостей ERP (permission-matrix.md §1.12). news.read — у всех ролей:
 * новости платформы и своей организации. news.create/update/delete (scope
 * organization) — руководители публикуют, правят и удаляют новости компании.
 * Новости платформы здесь только читаются: их ведёт админка (/admin/news).
 */
@Controller('news')
@UseGuards(TenantGuard, PermissionGuard)
export class NewsController {
  constructor(
    private readonly newsService: NewsService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('news', 'read')
  async list(@Req() req: FastifyRequest) {
    const tenantContext = requireTenantContext(req);
    const canPublish = await this.canPublish(tenantContext.positionId);
    const items = await this.newsService.listFeed(new Types.ObjectId(tenantContext.organizationId), { withDelivery: canPublish });
    return { items, canPublish, channels: this.newsService.deliveryChannels() };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('news', 'create')
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateNewsArticleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = newsIdempotencyBody(dto);
    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'createNewsArticle',
      key: idempotencyKey,
      requestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.newsService.publishForOrganization({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      callerPositionId: new Types.ObjectId(tenantContext.positionId),
      input: dto,
      delivery: { email: dto.sendEmail ?? false, telegram: dto.sendTelegram ?? false },
      idempotency: { actorIdentityId, key: idempotencyKey, requestBody },
      correlationId: req.correlationId,
    });
  }

  @Put(':newsId')
  @RequirePermission('news', 'update')
  async update(
    @Req() req: FastifyRequest,
    @Param('newsId', ParseObjectIdPipe) newsId: Types.ObjectId,
    @Body() dto: UpdateNewsArticleDto,
  ) {
    const tenantContext = requireTenantContext(req);
    const { expectedVersion, ...input } = dto;
    return this.newsService.updateForOrganization({
      newsId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      input,
      expectedVersion,
      correlationId: req.correlationId,
    });
  }

  @Delete(':newsId')
  @HttpCode(204)
  @RequirePermission('news', 'delete')
  async remove(@Req() req: FastifyRequest, @Param('newsId', ParseObjectIdPipe) newsId: Types.ObjectId) {
    const tenantContext = requireTenantContext(req);
    await this.newsService.deleteForOrganization({
      newsId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });
  }

  /** Может ли позиция публиковать новости компании — чтобы ERP показывал форму только тем, у кого она сработает. */
  private async canPublish(positionId: string): Promise<boolean> {
    const scopes = await this.policyEvaluator.matchingScopes({
      subjectType: 'position',
      subjectId: new Types.ObjectId(positionId),
      resource: 'news',
      action: 'create',
    });
    return scopes.length > 0;
  }
}
