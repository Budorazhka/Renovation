import { Controller, Get, Query } from '@nestjs/common';
import { Types } from 'mongoose';
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
}
