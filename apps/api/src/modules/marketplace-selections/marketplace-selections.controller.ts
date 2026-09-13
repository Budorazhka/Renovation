import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { MarketplaceAccountGuard } from '../../shared/marketplace-account/marketplace-account.guard';
import { requireMarketplaceAccountContext } from '../../shared/marketplace-account/marketplace-account-context.middleware';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { MarketplaceSelectionsService } from './marketplace-selections.service';
import { CreateMarketplaceSelectionDto } from './dto/create-marketplace-selection.dto';
import { RenameMarketplaceSelectionDto } from './dto/rename-marketplace-selection.dto';
import { MarketplaceSelectionItemDto } from './dto/marketplace-selection-item.dto';

/**
 * Подборки покупателя (N-11, roadmap-2026-09.md). Требует сессии — тот же
 * принцип, что FavoritesController: подборка живёт на сервере у аккаунта,
 * не в браузере одного устройства.
 */
@Controller('marketplace/selections')
@UseGuards(MarketplaceAccountGuard)
export class MarketplaceSelectionsController {
  constructor(private readonly service: MarketplaceSelectionsService) {}

  @Get()
  list(@Req() req: FastifyRequest) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.list(new Types.ObjectId(account.identityId));
  }

  @Post()
  @HttpCode(201)
  create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateMarketplaceSelectionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const account = requireMarketplaceAccountContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }
    return this.service.create({
      identityId: new Types.ObjectId(account.identityId),
      title: dto.title,
      idempotencyKey,
    });
  }

  @Patch(':id')
  rename(@Req() req: FastifyRequest, @Param('id') id: string, @Body() dto: RenameMarketplaceSelectionDto) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.rename(new Types.ObjectId(id), new Types.ObjectId(account.identityId), dto.title);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Req() req: FastifyRequest, @Param('id') id: string) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.remove(new Types.ObjectId(id), new Types.ObjectId(account.identityId));
  }

  @Post(':id/items')
  addItem(@Req() req: FastifyRequest, @Param('id') id: string, @Body() dto: MarketplaceSelectionItemDto) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.addItem(
      new Types.ObjectId(id),
      new Types.ObjectId(account.identityId),
      dto.targetType,
      dto.slug,
    );
  }

  /** DELETE с телом — тот же принцип, что FavoritesController.remove. */
  @Delete(':id/items')
  @HttpCode(200)
  removeItem(@Req() req: FastifyRequest, @Param('id') id: string, @Body() dto: MarketplaceSelectionItemDto) {
    const account = requireMarketplaceAccountContext(req);
    return this.service.removeItem(
      new Types.ObjectId(id),
      new Types.ObjectId(account.identityId),
      dto.targetType,
      dto.slug,
    );
  }
}
