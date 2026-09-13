import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { MarketplaceAccountGuard } from '../../shared/marketplace-account/marketplace-account.guard';
import { requireMarketplaceAccountContext } from '../../shared/marketplace-account/marketplace-account-context.middleware';
import { CreateRealtorReviewDto } from './dto/create-realtor-review.dto';
import { RealtorReviewsService } from './realtor-reviews.service';

@Controller('marketplace/realtor-reviews')
@UseGuards(MarketplaceAccountGuard)
export class MarketplaceRealtorReviewsController {
  constructor(private readonly service: RealtorReviewsService) {}
  @Post()
  @HttpCode(201)
  submit(@Req() req: FastifyRequest, @Body() dto: CreateRealtorReviewDto) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.submit({
      reviewerIdentityId: new Types.ObjectId(account.identityId),
      realtorPositionId: new Types.ObjectId(dto.realtorPositionId),
      completedDealId: new Types.ObjectId(dto.completedDealId),
      rating: dto.rating,
      text: dto.text,
    });
  }
}
