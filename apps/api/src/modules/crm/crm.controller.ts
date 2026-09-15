import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CrmService } from './crm.service';
import { RevealContactDto, toUtmRecord } from './dto/reveal-contact.dto';
import { RedisRateLimitGuard } from '../../shared/rate-limit/redis-rate-limit.guard';

/**
 * D-05/OpenAPI v1-first-vertical-slice.yaml: публичный (гостевой, БЕЗ
 * TenantGuard/PermissionGuard — тот же принцип, что PublicController)
 * reveal-contact endpoint. master plan явно требует "отдельная rate-
 * limited команда" — @UseGuards(RedisRateLimitGuard) применён точечно
 * здесь, не глобально на все контроллеры. Redis-backed (см. её докстринг)
 * — shared между всеми API-инстансами, заменил @nestjs/throttler
 * ThrottlerGuard (in-memory, не shared между процессами за балансировщиком).
 */
@Controller('public/developments')
@UseGuards(RedisRateLimitGuard)
export class CrmController {
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
    const result = await this.crmService.revealContact({
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
