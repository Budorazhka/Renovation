import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { MarketplaceAccountGuard } from '../../shared/marketplace-account/marketplace-account.guard';
import { requireMarketplaceAccountContext } from '../../shared/marketplace-account/marketplace-account-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BuyerRequestsService } from './buyer-requests.service';
import { CreateBuyerRequestDto } from './dto/create-buyer-request.dto';

@Controller('marketplace/requests')
@UseGuards(MarketplaceAccountGuard)
export class MarketplaceBuyerRequestsController {
  constructor(private readonly service: BuyerRequestsService) {}

  @Get()
  listMine(@Req() req: FastifyRequest) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.listMine(new Types.ObjectId(account.identityId));
  }

  @Post()
  @HttpCode(201)
  create(@Req() req: FastifyRequest, @Body() dto: CreateBuyerRequestDto, @Headers('idempotency-key') key?: string) {
    if (!key) throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    const account = requireMarketplaceAccountContext(req);
    return this.service.create({ identityId: new Types.ObjectId(account.identityId), idempotencyKey: key, data: dto });
  }

  @Patch(':id/close')
  close(@Req() req: FastifyRequest, @Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.close(id, new Types.ObjectId(account.identityId));
  }
}
