import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { BuyerRequestsService } from './buyer-requests.service';
import { RespondToBuyerRequestDto } from './dto/respond-to-buyer-request.dto';
import { ListBuyerRequestResponsesDto } from './dto/list-buyer-request-responses.dto';

/**
 * N-13: ERP-сторона доски запросов покупателей — организация откликается на
 * публичный запрос (`GET /public/requests`, без авторизации, уже отдаёт
 * полный текст запроса, отдельного "получить один запрос" эндпоинта здесь
 * поэтому не нужно). `buyer_request.respond` — единственный грант и на
 * отклик, и на чтение своих откликов (та же экономия, что у
 * community_reply: отдельный read-грант не заведён, где вся видимость и
 * так own-scope по organizationId вызывающего).
 */
@Controller('buyer-requests')
@UseGuards(TenantGuard, PermissionGuard)
export class ErpBuyerRequestsController {
  constructor(private readonly service: BuyerRequestsService) {}

  @Post(':id/respond')
  @HttpCode(200)
  @RequirePermission('buyer_request', 'respond')
  respond(@Req() req: FastifyRequest, @Param('id', ParseObjectIdPipe) id: Types.ObjectId, @Body() dto: RespondToBuyerRequestDto) {
    const tenantContext = requireTenantContext(req);
    return this.service.respond({
      buyerRequestId: id,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      respondedByPositionId: new Types.ObjectId(tenantContext.positionId),
      message: dto.message,
    });
  }

  @Get('responses')
  @RequirePermission('buyer_request', 'respond')
  listMyResponses(@Req() req: FastifyRequest, @Query() dto: ListBuyerRequestResponsesDto) {
    const tenantContext = requireTenantContext(req);
    return this.service.listMyResponses(new Types.ObjectId(tenantContext.organizationId), {
      cursor: dto.cursor ? new Types.ObjectId(dto.cursor) : undefined,
      limit: dto.limit,
    });
  }
}
