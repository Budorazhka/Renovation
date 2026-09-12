import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { CommunityService } from './community.service';
import {
  CreateCommunityThreadDto,
  UpdateCommunityThreadDto,
  CreateCommunityReplyDto,
  UpdateCommunityReplyDto,
  UpdateExchangeStatusDto,
  ListCommunityThreadsQueryDto,
  ListCommunityRepliesQueryDto,
  ListCommunityEventsQueryDto,
} from './dto/community.dto';

@Controller('community')
@UseGuards(TenantGuard, PermissionGuard)
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // ─── Разделы форума ──────────────────────────────────────────────────────────

  @Get('sections')
  @RequirePermission('community_thread', 'read')
  async getSections() {
    const data = await this.communityService.getSections();
    return { success: true, data };
  }

  @Get('sections/:id')
  @RequirePermission('community_thread', 'read')
  async getSection(@Param('id') id: string) {
    const data = await this.communityService.getSection(id);
    return { success: true, data };
  }

  // ─── Темы (треды) ──────────────────────────────────────────────────────────

  @Get('threads')
  @RequirePermission('community_thread', 'read')
  async listThreads(@Req() req: FastifyRequest, @Query() query: ListCommunityThreadsQueryDto) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.listThreads(
      query,
      new Types.ObjectId(tenantContext.organizationId),
    );
    return { success: true, data };
  }

  @Get('threads/:threadId')
  @RequirePermission('community_thread', 'read')
  async getThread(@Req() req: FastifyRequest, @Param('threadId') threadId: string) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.getThread(
      threadId,
      new Types.ObjectId(tenantContext.organizationId),
    );
    return { success: true, data };
  }

  @Post('threads')
  @HttpCode(201)
  @RequirePermission('community_thread', 'create')
  async createThread(
    @Req() req: FastifyRequest,
    @Body() dto: CreateCommunityThreadDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const data = await this.communityService.createThread({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      positionId: new Types.ObjectId(tenantContext.positionId),
      identityId: new Types.ObjectId(tenantContext.identityId),
      idempotencyKey,
      data: dto,
    });
    return { success: true, data };
  }

  @Patch('threads/:threadId')
  @RequirePermission('community_thread', 'create')
  async updateThread(
    @Req() req: FastifyRequest,
    @Param('threadId') threadId: string,
    @Body() dto: UpdateCommunityThreadDto,
  ) {
    const tenantContext = requireTenantContext(req);
    // ИСПРАВЛЕНО 13.09.2026 (найдено ревью): декоратор здесь — 'create'
    // (база "участник площадки"), не 'manage', поэтому правку контента
    // ЧУЖОЙ темы сервис обязан отдельно проверять по гранту 'manage' у
    // самого actor'а, а не по одному лишь совпадению организации — иначе
    // любой сотрудник с правом просто создавать темы мог править чужие
    // темы коллег по организации без выданного grant'а. Автору своя тема
    // доступна всегда, без проверки granta.
    const data = await this.communityService.updateThread(
      threadId,
      new Types.ObjectId(tenantContext.identityId),
      new Types.ObjectId(tenantContext.organizationId),
      new Types.ObjectId(tenantContext.positionId),
      dto,
    );
    return { success: true, data };
  }

  @Delete('threads/:threadId')
  @RequirePermission('community_thread', 'manage')
  async deleteThread(@Req() req: FastifyRequest, @Param('threadId') threadId: string) {
    const tenantContext = requireTenantContext(req);
    // ИСПРАВЛЕНО 10.09.2026: было захардкожено isModerator = true — любая
    // организация с грантом 'manage' (owner/director/rop/administrator/
    // developer, т.е. большинство ролей) могла удалить чужую тему на общей
    // площадке. community — межорганизационный форум и MLS-биржа, поэтому
    // модерация ограничивается темами своей же организации.
    const data = await this.communityService.deleteThread(
      threadId,
      new Types.ObjectId(tenantContext.identityId),
      new Types.ObjectId(tenantContext.organizationId),
    );
    return { success: true, data };
  }

  @Post('threads/:threadId/like')
  @RequirePermission('community_thread', 'create')
  async toggleThreadReaction(@Req() req: FastifyRequest, @Param('threadId') threadId: string) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.toggleThreadReaction(
      threadId,
      new Types.ObjectId(tenantContext.identityId),
    );
    return { success: true, data };
  }

  @Patch('threads/:threadId/pin')
  @RequirePermission('community_thread', 'manage')
  async pinThread(
    @Req() req: FastifyRequest,
    @Param('threadId') threadId: string,
    @Body('pinned') pinned: boolean,
  ) {
    const tenantContext = requireTenantContext(req);
    if (pinned !== undefined && typeof pinned !== 'boolean') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'pinned must be a boolean');
    }
    // ИСПРАВЛЕНО 10.09.2026: раньше проверок владения не было вообще —
    // любая организация с грантом 'manage' могла закрепить чужую тему
    // поверх общей ленты у всех. Ограничено темами своей организации.
    const data = await this.communityService.pinThread(
      threadId,
      new Types.ObjectId(tenantContext.organizationId),
      pinned ?? true,
    );
    return { success: true, data };
  }

  // ─── Ответы (Replies) ────────────────────────────────────────────────────────

  @Get('threads/:threadId/replies')
  @RequirePermission('community_thread', 'read')
  async listReplies(
    @Req() req: FastifyRequest,
    @Param('threadId') threadId: string,
    @Query() query: ListCommunityRepliesQueryDto,
  ) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.listReplies(
      threadId,
      query,
      new Types.ObjectId(tenantContext.organizationId),
    );
    return { success: true, data };
  }

  @Post('threads/:threadId/replies')
  @HttpCode(201)
  @RequirePermission('community_reply', 'create')
  async createReply(
    @Req() req: FastifyRequest,
    @Param('threadId') threadId: string,
    @Body() dto: CreateCommunityReplyDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const data = await this.communityService.createReply({
      threadId,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      positionId: new Types.ObjectId(tenantContext.positionId),
      identityId: new Types.ObjectId(tenantContext.identityId),
      idempotencyKey,
      data: dto,
    });
    return { success: true, data };
  }

  @Patch('replies/:replyId')
  @RequirePermission('community_reply', 'create')
  async updateReply(
    @Req() req: FastifyRequest,
    @Param('replyId') replyId: string,
    @Body() dto: UpdateCommunityReplyDto,
  ) {
    const tenantContext = requireTenantContext(req);
    // ИСПРАВЛЕНО 13.09.2026 — тот же класс проблемы, что updateThread выше.
    const data = await this.communityService.updateReply(
      replyId,
      new Types.ObjectId(tenantContext.identityId),
      new Types.ObjectId(tenantContext.organizationId),
      new Types.ObjectId(tenantContext.positionId),
      dto,
    );
    return { success: true, data };
  }

  @Delete('replies/:replyId')
  @RequirePermission('community_reply', 'manage')
  async deleteReply(@Req() req: FastifyRequest, @Param('replyId') replyId: string) {
    const tenantContext = requireTenantContext(req);
    // ИСПРАВЛЕНО 10.09.2026: было isModerator = true безусловно, см. deleteThread.
    const data = await this.communityService.deleteReply(
      replyId,
      new Types.ObjectId(tenantContext.identityId),
      new Types.ObjectId(tenantContext.organizationId),
    );
    return { success: true, data };
  }

  @Post('replies/:replyId/like')
  @RequirePermission('community_reply', 'create')
  async toggleReplyReaction(@Req() req: FastifyRequest, @Param('replyId') replyId: string) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.toggleReplyReaction(
      replyId,
      new Types.ObjectId(tenantContext.identityId),
    );
    return { success: true, data };
  }

  @Patch('replies/:replyId/accept')
  @RequirePermission('community_reply', 'create')
  async acceptReply(
    @Req() req: FastifyRequest,
    @Param('replyId') replyId: string,
    @Body('threadId') threadId: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (typeof threadId !== 'string' || threadId.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'threadId must be a non-empty string');
    }
    const data = await this.communityService.acceptReply(
      threadId,
      replyId,
      new Types.ObjectId(tenantContext.identityId),
    );
    return { success: true, data };
  }

  // ─── Биржа сделок MLS (Exchange) ─────────────────────────────────────────────

  @Get('exchange')
  @RequirePermission('community_exchange', 'read')
  async listExchangeDeals(@Req() req: FastifyRequest, @Query() query: ListCommunityThreadsQueryDto) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.listExchangeDeals(
      query,
      new Types.ObjectId(tenantContext.organizationId),
    );
    return { success: true, data };
  }

  @Patch('exchange/:threadId/status')
  @RequirePermission('community_exchange', 'create')
  async updateExchangeStatus(
    @Req() req: FastifyRequest,
    @Param('threadId') threadId: string,
    @Body() dto: UpdateExchangeStatusDto,
  ) {
    const tenantContext = requireTenantContext(req);
    const isModerator = false;
    const data = await this.communityService.updateExchangeStatus(
      threadId,
      new Types.ObjectId(tenantContext.identityId),
      isModerator,
      dto.status,
    );
    return { success: true, data };
  }

  // ─── Мероприятия (Events) ────────────────────────────────────────────────────

  @Get('events')
  @RequirePermission('community_event', 'read')
  async listEvents(@Req() req: FastifyRequest, @Query() query: ListCommunityEventsQueryDto) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.listEvents(
      query,
      new Types.ObjectId(tenantContext.identityId),
    );
    return { success: true, data };
  }

  @Get('events/:eventId')
  @RequirePermission('community_event', 'read')
  async getEvent(@Req() req: FastifyRequest, @Param('eventId') eventId: string) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.getEvent(
      eventId,
      new Types.ObjectId(tenantContext.identityId),
    );
    return { success: true, data };
  }

  @Post('events/:eventId/attend')
  @RequirePermission('community_event', 'attend')
  async toggleEventAttendance(@Req() req: FastifyRequest, @Param('eventId') eventId: string) {
    const tenantContext = requireTenantContext(req);
    const data = await this.communityService.toggleEventAttendance(
      eventId,
      new Types.ObjectId(tenantContext.identityId),
    );
    return { success: true, data };
  }

  // ─── Лидерборд ──────────────────────────────────────────────────────────────

  @Get('leaderboard')
  @RequirePermission('community_thread', 'read')
  async getLeaderboard() {
    const data = await this.communityService.getLeaderboard();
    return { success: true, data };
  }
}
