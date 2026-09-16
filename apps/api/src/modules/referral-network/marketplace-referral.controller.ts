import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { MarketplaceAccountGuard } from '../../shared/marketplace-account/marketplace-account.guard';
import {
  requireMarketplaceAccountContext,
} from '../../shared/marketplace-account/marketplace-account-context.middleware';
import { ReferralNetworkService } from './referral-network.service';
import { CreateReferralRequestDto, JoinReferralTeamDto } from './dto/referral-network.dto';

/**
 * Реферальная сеть в личном кабинете маркетплейса. Человек видит и меняет
 * только своё: identity берётся из сессии. Вступление — по ссылке куратора;
 * уход и смена куратора — заявкой, её решает BAZA (решения владельца
 * 16.09.2026).
 */
@Controller('marketplace/referral')
@UseGuards(MarketplaceAccountGuard)
export class MarketplaceReferralController {
  constructor(private readonly network: ReferralNetworkService) {}

  @Get('me')
  me(@Req() req: FastifyRequest) {
    const account = requireMarketplaceAccountContext(req);
    return this.network.getMine(new Types.ObjectId(account.identityId));
  }

  /**
   * Повтор того же вступления упирается в «уже в этой команде» (409), а не
   * создаёт второе членство: уникальный индекс на открытое членство человека.
   */
  @Post('join')
  @HttpCode(200)
  join(@Req() req: FastifyRequest, @Body() dto: JoinReferralTeamDto) {
    const account = requireMarketplaceAccountContext(req);
    return this.network.joinByInvite({
      identityId: new Types.ObjectId(account.identityId),
      code: dto.code,
      correlationId: req.correlationId,
    });
  }

  /** Повтор заявки того же типа, пока прежняя не решена, — 409: одна в очереди BAZA. */
  @Post('requests')
  @HttpCode(201)
  createRequest(@Req() req: FastifyRequest, @Body() dto: CreateReferralRequestDto) {
    const account = requireMarketplaceAccountContext(req);
    return this.network.createRequest({
      identityId: new Types.ObjectId(account.identityId),
      type: dto.type,
      reason: dto.reason,
      targetInviteCode: dto.targetInviteCode,
      correlationId: req.correlationId,
    });
  }
}
