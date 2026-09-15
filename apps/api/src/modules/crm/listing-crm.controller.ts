import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CrmService } from './crm.service';
import { RevealContactDto, toUtmRecord } from './dto/reveal-contact.dto';
import { RedisRateLimitGuard } from '../../shared/rate-limit/redis-rate-limit.guard';

/**
 * MKT-002 / LEAD-001: публичный (гостевой, БЕЗ TenantGuard/PermissionGuard)
 * reveal-contact endpoint для вторички и аренды. Тот же паттерн rate-limiting,
 * что CrmController для developments: @UseGuards(RedisRateLimitGuard) —
 * Redis-backed, shared между всеми API-инстансами (см. её докстринг),
 * заменил @nestjs/throttler ThrottlerGuard (in-memory, не shared).
 */
@Controller('public/listings')
@UseGuards(RedisRateLimitGuard)
export class ListingCrmController {
  constructor(private readonly crmService: CrmService) {}

  /**
   * Idempotency-Key ОПЦИОНАЛЕН здесь (в отличие от ADR-006 publish/book/cancel
   * — см. IdempotencyKeyHeader в OpenAPI) — повтор без ключа сохраняет
   * текущую совместимость (всегда новый Lead), см. PublicRevealIdempotencyService.
   */
  @Post(':slug/reveal-contact')
  @HttpCode(200)
  async revealContact(
    @Req() req: FastifyRequest,
    @Param('slug') slug: string,
    @Body() dto: RevealContactDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.crmService.revealListingContact({
      slug,
      requesterName: dto.requesterName,
      requesterPhone: dto.requesterPhone,
      utm: toUtmRecord(dto.utm),
      referrer: req.headers.referer,
      correlationId: req.correlationId,
      idempotencyKey,
    });

    return {
      phone: result.phone,
      whatsapp: result.whatsapp,
      telegram: result.telegram,
      ...(result.leadId ? { leadId: result.leadId.toString() } : {}),
    };
  }
}
