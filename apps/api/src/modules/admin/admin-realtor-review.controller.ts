import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { AdminRealtorReviewService } from './admin-realtor-review.service';
import { ListRealtorReviewsQueryDto } from './dto/list-realtor-reviews-query.dto';
import { ModerateRealtorReviewRequestDto } from './dto/moderate-realtor-review-request.dto';

/**
 * ADMIN-OPS-001. AdminGuard — только аутентификация Admin-актора (тот же
 * принцип, что AdminComplaintController/AdminDuplicateCandidateController),
 * permission-проверка (`review.moderate`) выполняется внутри
 * AdminRealtorReviewService.
 */
@Controller('admin/realtor-reviews')
@UseGuards(AdminGuard)
export class AdminRealtorReviewController {
  constructor(private readonly service: AdminRealtorReviewService) {}

  @Get()
  async list(@Req() req: FastifyRequest, @Query() dto: ListRealtorReviewsQueryDto) {
    const adminContext = requireAdminContext(req);
    return this.service.list(adminContext, dto);
  }

  @Post(':reviewId/moderate')
  @HttpCode(200)
  async moderate(
    @Req() req: FastifyRequest,
    @Param('reviewId', ParseObjectIdPipe) reviewId: Types.ObjectId,
    @Body() dto: ModerateRealtorReviewRequestDto,
  ) {
    const adminContext = requireAdminContext(req);

    await this.service.moderate(adminContext, {
      reviewId,
      decision: dto.decision,
      reason: dto.reason,
      correlationId: req.correlationId,
    });

    return { id: reviewId.toString(), status: dto.decision };
  }
}
