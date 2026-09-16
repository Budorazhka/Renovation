import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CreateNewsArticleDto, UpdateNewsArticleDto, newsIdempotencyBody } from '../news/dto/create-news-article.dto';
import { AdminNewsService } from './admin-news.service';
import { NewsImageUploadIntentDto } from './dto/news-image-upload-intent.dto';

/**
 * Новости платформы BAZA: их видят сотрудники всех организаций в ленте ERP.
 * AdminGuard — только аутентификация администратора, право (`news.publish`)
 * проверяет AdminNewsService. Картинка грузится двумя шагами, как любое медиа
 * (ADR-008): upload-intent → PUT по presigned URL → confirm.
 */
@Controller('admin/news')
@UseGuards(AdminGuard)
export class AdminNewsController {
  constructor(
    private readonly service: AdminNewsService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get()
  async list(@Req() req: FastifyRequest) {
    return this.service.list(requireAdminContext(req));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateNewsArticleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const adminContext = requireAdminContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const requestBody = newsIdempotencyBody(dto);
    const replay = await this.idempotencyService.checkReplay({
      identityId: new Types.ObjectId(adminContext.identityId),
      operation: 'createPlatformNewsArticle',
      key: idempotencyKey,
      requestBody,
    });
    if (replay) {
      return replay.responseBody;
    }

    return this.service.publish(adminContext, {
      input: dto,
      delivery: { email: dto.sendEmail ?? false, telegram: dto.sendTelegram ?? false },
      idempotency: { key: idempotencyKey, requestBody },
      correlationId: req.correlationId,
    });
  }

  @Post('images/upload-intent')
  @HttpCode(201)
  async createImageUploadIntent(@Req() req: FastifyRequest, @Body() dto: NewsImageUploadIntentDto) {
    return this.service.createImageUploadIntent(requireAdminContext(req), {
      declaredMimeType: dto.declaredMimeType,
      sizeBytes: dto.sizeBytes,
    });
  }

  @Post('images/:assetId/confirm')
  @HttpCode(200)
  async confirmImageUpload(@Req() req: FastifyRequest, @Param('assetId', ParseObjectIdPipe) assetId: Types.ObjectId) {
    return this.service.confirmImageUpload(requireAdminContext(req), { assetId, correlationId: req.correlationId });
  }

  @Put(':newsId')
  async update(
    @Req() req: FastifyRequest,
    @Param('newsId', ParseObjectIdPipe) newsId: Types.ObjectId,
    @Body() dto: UpdateNewsArticleDto,
  ) {
    const { expectedVersion, ...input } = dto;
    return this.service.update(requireAdminContext(req), {
      newsId,
      input,
      expectedVersion,
      correlationId: req.correlationId,
    });
  }

  @Delete(':newsId')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('newsId', ParseObjectIdPipe) newsId: Types.ObjectId) {
    await this.service.remove(requireAdminContext(req), { newsId, correlationId: req.correlationId });
  }
}
