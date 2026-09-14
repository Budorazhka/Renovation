import { Controller, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { LeadImportService } from './lead-import.service';
import { ImportLeadsQueryDto } from './dto/import-leads.dto';

/**
 * POST /leads/import — отдельный контроллер (не LeadController), тот же
 * принцип разделения, что уже применён к ExportController: разная форма
 * тела запроса (multipart, не JSON) заслуживает отдельного файла, не
 * захламляет CRUD-эндпоинты /leads.
 *
 * Обычный `@fastify/multipart` upload, НЕ MediaModule: presigned-загрузка
 * с генерацией image-variants там рассчитана на постоянное хранение медиа
 * worker'ом, файл импорта нигде не хранится после разбора — лишняя
 * машинерия для разового чтения таблицы.
 */
@Controller('leads')
@UseGuards(TenantGuard, PermissionGuard)
export class LeadImportController {
  constructor(private readonly leadImportService: LeadImportService) {}

  @Post('import')
  @HttpCode(200)
  @RequirePermission('import', 'run')
  async importLeads(@Req() req: FastifyRequest, @Query() query: ImportLeadsQueryDto) {
    const tenantContext = requireTenantContext(req);

    // @fastify/multipart .file() бросает свой собственный FastifyError
    // (statusCode 406), не AppException, если Content-Type вообще не
    // multipart — ловим явно, иначе AppExceptionFilter отдал бы клиенту
    // общий 500 вместо понятной 400-ошибки на некорректный запрос.
    if (!req.isMultipart()) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Ожидается multipart/form-data с полем "file"');
    }
    const file = await req.file();
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Файл не передан (multipart-поле "file" обязательно)');
    }
    let fileBuffer: Buffer;
    try {
      fileBuffer = await file.toBuffer();
    } catch (error) {
      // FST_REQ_FILE_TOO_LARGE — файл превышает лимит, зарегистрированный
      // в main.api.ts (@fastify/multipart limits.fileSize) — та же логика,
      // что и с InvalidMultipartContentTypeError выше: без явной обработки
      // клиент получил бы generic 500 вместо понятной 400-ошибки.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Файл превышает допустимый размер');
      }
      throw error;
    }

    const result = await this.leadImportService.importLeads({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
      fileBuffer,
      fileName: file.filename,
      mimetype: file.mimetype,
      tag: query.tag,
    });

    return { success: true, data: result };
  }
}
