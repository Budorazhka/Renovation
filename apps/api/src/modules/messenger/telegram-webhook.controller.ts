import { Body, Controller, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { IpRateLimitGuard } from '../../shared/rate-limit/ip-rate-limit.guard';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { MessengerService } from './messenger.service';
import type { TelegramUpdate } from './telegram-update.types';

/**
 * N-12 (roadmap-2026-09.md): входящие апдейты Telegram Bot API.
 * ПУБЛИЧНЫЙ контроллер — без TenantGuard/PermissionGuard совсем, тот же
 * принцип, что PublicComplaintController: вызывающий не наш аутентифицированный
 * клиент, а серверы Telegram. Подлинность подтверждает не guard прав, а
 * секрет вебхука (см. MessengerService.handleTelegramUpdate) — сверка
 * происходит в сервисе, не здесь, потому что сравнивать есть с чем только
 * после чтения аккаунта по `:accountId` из БД.
 *
 * `:accountId` в пути — тот же URL, что зарегистрирован в Telegram через
 * `setWebhook` при подключении бота (MessengerService.addTelegramBot).
 *
 * Rate limit — тот же generic IpRateLimitGuard + @RateLimit, что у
 * complaint-submit: единственная защита от постороннего трафика на публичный
 * путь помимо секрета (Telegram сам не имеет фиксированных IP-диапазонов,
 * поэтому IP-allowlist здесь не вариант).
 */
@Controller('public/messenger/telegram')
export class TelegramWebhookController {
  constructor(private readonly messengerService: MessengerService) {}

  @Post(':accountId')
  @HttpCode(200)
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'telegram-webhook', limit: 60, windowSeconds: 60 })
  async receiveUpdate(
    @Param('accountId', ParseObjectIdPipe) accountId: Types.ObjectId,
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    await this.messengerService.handleTelegramUpdate({ accountId, secretToken, update });
    // Всегда 200 (при валидном :accountId-формате) — Telegram трактует
    // не-2xx как "не доставлено" и повторяет апдейт; отказ по секрету/
    // неизвестному аккаунту уже обработан молча внутри сервиса.
    return { ok: true };
  }
}
