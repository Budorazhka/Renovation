import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { IpRateLimitGuard } from '../../shared/rate-limit/ip-rate-limit.guard';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { PublicRealtorsService } from './public-realtors.service';
import { ListPublicRealtorsDto } from './dto/list-public-realtors.dto';

@Controller('public/realtors')
export class PublicRealtorsController {
  constructor(private readonly service: PublicRealtorsService) {}

  @Get()
  list(@Query() dto: ListPublicRealtorsDto) {
    return this.service.listPublic({
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      city: dto.city,
      limit: dto.limit,
    });
  }

  @Get(':positionId')
  getOne(@Param('positionId', ParseObjectIdPipe) positionId: Types.ObjectId) {
    return this.service.getPublic(positionId);
  }

  /**
   * Owner decision 14.09.2026: телефон риэлтора раскрывается по клику, не в
   * общей проекции — та же защита от массового скрапинга, что у
   * buyer-request reveal-phone, тот же generic IpRateLimitGuard.
   */
  @Get(':positionId/reveal-phone')
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'public-realtor-reveal-phone', limit: 20, windowSeconds: 60 })
  revealPhone(@Param('positionId', ParseObjectIdPipe) positionId: Types.ObjectId) {
    return this.service.revealPhone(positionId);
  }
}
