import { Controller, Get, Param, Query } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { ListRealtorReviewsDto } from './dto/list-realtor-reviews.dto';
import { RealtorReviewsService } from './realtor-reviews.service';

@Controller('public/realtors')
export class PublicRealtorReviewsController {
  constructor(private readonly service: RealtorReviewsService) {}
  @Get(':positionId/reviews')
  list(@Param('positionId', ParseObjectIdPipe) positionId: Types.ObjectId, @Query() query: ListRealtorReviewsDto) {
    return this.service.listApproved(positionId, query.limit);
  }
}
