import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { IpRateLimitGuard } from '../../shared/rate-limit/ip-rate-limit.guard';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { BuyerRequestsService } from './buyer-requests.service';
import { ListBuyerRequestsDto } from './dto/list-buyer-requests.dto';

@Controller('public/requests')
export class PublicBuyerRequestsController {
  constructor(private readonly service: BuyerRequestsService) {}

  @Get()
  list(@Query() dto: ListBuyerRequestsDto) {
    return this.service.listPublic({
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: 20,
      dealType: dto.dealType,
      city: dto.city,
      propertyKind: dto.propertyKind,
    });
  }

  /**
   * Owner decision 14.09.2026: телефон автора запроса раскрывается по
   * явному клику, не в общем списке — anti-scraping rate-limit, тот же
   * generic guard, что complaint-submit/telegram-webhook (не
   * RedisRateLimitGuard: тот жёстко под slug+Lead-создание reveal-contact,
   * здесь нет ни того, ни другого).
   */
  @Get(':id/reveal-phone')
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'buyer-request-reveal-phone', limit: 20, windowSeconds: 60 })
  revealPhone(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.service.revealPhone(id);
  }
}
