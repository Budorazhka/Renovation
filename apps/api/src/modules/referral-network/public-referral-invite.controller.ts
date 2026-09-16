import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { IpRateLimitGuard } from '../../shared/rate-limit/ip-rate-limit.guard';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { ReferralNetworkService } from './referral-network.service';

/**
 * Страница ссылки-приглашения до регистрации: посетитель ещё без аккаунта и
 * должен увидеть, кто его зовёт. Отдаётся только имя куратора; перебор
 * кодов ограничен по IP.
 */
@Controller('public/referral-invites')
export class PublicReferralInviteController {
  constructor(private readonly network: ReferralNetworkService) {}

  @Get(':code')
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'referral-invite-preview', limit: 30, windowSeconds: 60 })
  preview(@Param('code') code: string) {
    return this.network.previewInvite(code);
  }
}
