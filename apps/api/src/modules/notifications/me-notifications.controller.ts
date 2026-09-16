import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

/**
 * Свои настройки уведомлений: почта и Telegram. Только identity из
 * TenantContext — чужих настроек этот контроллер не видит и не меняет,
 * поэтому специального права нет (тот же принцип, что GET /me).
 */
@Controller('me/notifications')
@UseGuards(TenantGuard)
export class MeNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async get(@Req() req: FastifyRequest) {
    return this.notificationsService.getSettings(new Types.ObjectId(requireTenantContext(req).identityId));
  }

  @Put()
  async update(@Req() req: FastifyRequest, @Body() dto: UpdateNotificationSettingsDto) {
    return this.notificationsService.updatePreferences(new Types.ObjectId(requireTenantContext(req).identityId), dto);
  }

  @Post('telegram-link')
  @HttpCode(201)
  async createTelegramLink(@Req() req: FastifyRequest) {
    return this.notificationsService.createTelegramLink(new Types.ObjectId(requireTenantContext(req).identityId));
  }

  @Delete('telegram')
  @HttpCode(204)
  async unlinkTelegram(@Req() req: FastifyRequest) {
    await this.notificationsService.unlinkTelegram(new Types.ObjectId(requireTenantContext(req).identityId));
  }
}
