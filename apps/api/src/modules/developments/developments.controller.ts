import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { TenantGuard } from '../../shared/tenant/tenant.guard';
import { requireTenantContext } from '../../shared/tenant/tenant-context.middleware';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { DevelopmentsService } from './developments.service';
import { ChessboardWorkbookService } from './chessboard-workbook.service';
import { chessboardFileName } from './chessboard-export';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CreateDevelopmentDto } from './dto/create-development.dto';
import { UpdateDevelopmentDto } from './dto/update-development.dto';
import { CreateBuildingDto } from './dto/create-building.dto';
import { CreateSectionDto } from './dto/create-section.dto';
import { CreateFloorDto } from './dto/create-floor.dto';
import { CreateFloorPlanDto } from './dto/create-floor-plan.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitPriceDto } from './dto/update-unit-price.dto';
import { UpdateUnitStatusDto } from './dto/update-unit-status.dto';
import { ListUnitsQueryDto } from './dto/list-units-query.dto';
import { GenerateChessboardDto } from './dto/generate-chessboard.dto';
import { BatchCreateUnitsDto } from './dto/batch-create-units.dto';
import { BatchUpdatePricesDto } from './dto/batch-update-prices.dto';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';
import { ListInstallmentPlansQueryDto } from './dto/list-installment-plans-query.dto';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/**
 * D-01: Development aggregate — Development/Building/Section/Floor/Unit/
 * FloorPlan CRUD (docs/api/v1-first-vertical-slice.yaml специфицирует
 * только Development/Building/Floor/Unit create-пути для vertical slice
 * до publish, D-03 — update/price/status команды здесь добавлены как
 * прямое следствие domain-model.md commands list и permission-matrix.md
 * `unit.price.update.project`/`unit.status.update.project`, отсутствуют
 * в узкой OpenAPI-спеке v1-first-vertical-slice.yaml — тот же паттерн
 * явного расхождения, что уже применялся для media_asset.upload).
 *
 * permission-matrix.md 1.2: `development.read.organization`,
 * `development.edit.organization` (Building/Floor/FloorPlan создание —
 * часть "редактирования" ЖК-агрегата, отдельных прав на под-уровни матрица
 * не предусматривает), `unit.price.update.project`/`unit.status.update.project`
 * (scope `project` на MVP не проверяется отдельно от `organization` —
 * permission-matrix.md явно отмечает: "ни одна строка ERP-матрицы... не
 * пользуется project-scope на MVP-уровне").
 */
@Controller()
@UseGuards(TenantGuard, PermissionGuard)
export class DevelopmentsController {
  constructor(
    private readonly developmentsService: DevelopmentsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly chessboardWorkbookService: ChessboardWorkbookService,
  ) {}

  @Post('developments')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async createDevelopment(@Req() req: FastifyRequest, @Body() dto: CreateDevelopmentDto, @Headers('idempotency-key') idempotencyKey?: string,) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { name: dto.name, city: dto.location?.city ?? null, address: dto.location?.address ?? null };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateDevelopment', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createDevelopment({
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      name: dto.name,
      location: {
        country: dto.location.country,
        city: dto.location.city,
        address: dto.location.address,
        geo: dto.location.geo,
      },
      contact: {
        phone: dto.contact.phone,
        whatsapp: dto.contact.whatsapp,
        telegram: dto.contact.telegram,
      },
      classType: dto.classType,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      completionDate: dto.completionDate ? new Date(dto.completionDate) : undefined,
      description: dto.description,
      idempotency: { identityId, operation: 'devCreateDevelopment', key: idempotencyKey, requestBody },
    });
  }

  @Get('developments')
  @RequirePermission('development', 'read')
  async listDevelopments(
    @Req() req: FastifyRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limitParam?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    const limit = Math.min(limitParam ? Number(limitParam) : DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

    const items = await this.developmentsService.listDevelopmentsForOrganization(
      new Types.ObjectId(tenantContext.organizationId),
      { cursor: cursor ? new Types.ObjectId(cursor) : undefined, limit },
    );

    const nextCursor = items.length === limit ? items[items.length - 1]!._id.toString() : null;
    return { items, nextCursor };
  }

  @Get('developments/:developmentId')
  @RequirePermission('development', 'read')
  async getDevelopment(@Req() req: FastifyRequest, @Param('developmentId') developmentId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.getDevelopmentForOrganization(
      new Types.ObjectId(developmentId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Patch('developments/:developmentId')
  @RequirePermission('development', 'edit')
  async updateDevelopment(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Body() dto: UpdateDevelopmentDto,
  ) {
    const tenantContext = requireTenantContext(req);

    await this.developmentsService.updateDevelopment({
      id: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion: dto.expectedVersion,
      correlationId: req.correlationId,
      changes: {
        name: dto.name,
        location: dto.location,
        contact: dto.contact,
        classType: dto.classType,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        completionDate: dto.completionDate ? new Date(dto.completionDate) : undefined,
        description: dto.description,
      },
    });

    return this.developmentsService.getDevelopmentForOrganization(
      new Types.ObjectId(developmentId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  /**
   * ADR-005/ADR-006: 202 Accepted — publication_pending, worker строит
   * полную проекцию асинхронно (см. v1-first-vertical-slice.yaml).
   * Idempotency-Key header — required (OpenAPI-контракт), механизм
   * idempotency_records реализован (26.08.2026, honest gap закрыт):
   * replay-проверка ДО вызова сервиса — совпадающий (identity, operation,
   * key) с тем же requestHash возвращает сохранённый ответ БЕЗ повторного
   * выполнения publish (не создаёт вторую MarketplacePublication, не
   * инкрементирует version повторно). Несовпадающий hash или отсутствие
   * заголовка — явная ошибка (checkReplay/этот метод бросают AppException
   * до входа в DevelopmentsService).
   */
  @Post('developments/:developmentId/publish')
  @RequirePermission('development', 'edit')
  async publishDevelopment(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('developmentId') developmentId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);

    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const actorIdentityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId };

    const replay = await this.idempotencyService.checkReplay({
      identityId: actorIdentityId,
      operation: 'publishDevelopment',
      key: idempotencyKey,
      requestBody,
    });
    if (replay) {
      reply.status(replay.responseStatus);
      return replay.responseBody;
    }

    const result = await this.developmentsService.publishDevelopment({
      id: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      actorIdentityId,
      idempotencyKey,
      correlationId: req.correlationId,
    });

    // Гонка двух параллельных publish с одним Idempotency-Key (см.
    // DevelopmentsService.publishDevelopment): второй запрос теряет
    // атомарный updateStatus, но сервис сам нашёл record, который только
    // что записал конкурент-победитель — это replay ЭТОЙ попытки, не новая
    // публикация. Возвращаем сохранённый ответ как есть, не 202 с "новым"
    // телом (тот же принцип, что checkReplay ДО транзакции выше).
    if (result.replay) {
      reply.status(result.replay.responseStatus);
      return result.replay.responseBody;
    }

    reply.status(202);
    return {
      id: result.publicationId.toString(),
      sourceType: 'development',
      sourceId: developmentId,
      status: result.status,
    };
  }

  @Post('developments/:developmentId/buildings')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async createBuilding(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Body() dto: CreateBuildingDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, name: dto.name, floorsCount: dto.floorsCount };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateBuilding', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createBuilding({
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      name: dto.name,
      floorsCount: dto.floorsCount,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      completionDate: dto.completionDate ? new Date(dto.completionDate) : undefined,
      idempotency: { identityId, operation: 'devCreateBuilding', key: idempotencyKey, requestBody },
    });
  }

  /**
   * D-02 COMPLETE: read-side дочерней иерархии — @RequirePermission('development','read')
   * на каждом (то же resource/action, что getDevelopment/listDevelopments
   * выше). organizationId только из TenantContext, никогда от клиента.
   * Единый 404 (NotFoundException) для "не существует" и "чужая
   * организация" — та же tenant isolation, что write-команды.
   */
  @Get('developments/:developmentId/buildings')
  @RequirePermission('development', 'read')
  async listBuildings(@Req() req: FastifyRequest, @Param('developmentId') developmentId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.listBuildingsForDevelopment(
      new Types.ObjectId(developmentId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Get('buildings/:buildingId/sections')
  @RequirePermission('development', 'read')
  async listSections(@Req() req: FastifyRequest, @Param('buildingId') buildingId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.listSectionsForBuilding(
      new Types.ObjectId(buildingId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Get('buildings/:buildingId/floors')
  @RequirePermission('development', 'read')
  async listFloors(@Req() req: FastifyRequest, @Param('buildingId') buildingId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.listFloorsForBuilding(
      new Types.ObjectId(buildingId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Get('buildings/:buildingId/floor-plans')
  @RequirePermission('development', 'read')
  async listFloorPlans(@Req() req: FastifyRequest, @Param('buildingId') buildingId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.listFloorPlansForBuilding(
      new Types.ObjectId(buildingId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  /**
   * kind?/status?/limit(максимум 500, ListUnitsQueryDto @Max) — единственные
   * принимаемые query-фильтры. Никакого произвольного Mongo-фильтра:
   * глобальный ValidationPipe({whitelist,forbidNonWhitelisted}) отклоняет
   * любое неизвестное поле (включая organizationId) с 400 до входа сюда.
   */
  @Get('buildings/:buildingId/units')
  @RequirePermission('development', 'read')
  async listUnits(
    @Req() req: FastifyRequest,
    @Param('buildingId') buildingId: string,
    @Query() dto: ListUnitsQueryDto,
  ) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.listUnitsForBuilding(
      new Types.ObjectId(buildingId),
      new Types.ObjectId(tenantContext.organizationId),
      { kind: dto.kind, status: dto.status, limit: dto.limit },
    );
  }

  /**
   * chessboard.export — грант из permission-matrix.md, выданный почти всем
   * ролям (owner/director/rop/administrator/marketer/developer), но до
   * этого коммита не проверявшийся нигде: выгрузки шахматки просто не
   * существовало.
   *
   * ЕДИНСТВЕННЫЙ эндпоинт API, отдающий не JSON. `@Res` без passthrough —
   * тело пишется напрямую в FastifyReply, минуя сериализацию Nest; helmet
   * настроен в main.api.ts на JSON-only ответы, поэтому Content-Type
   * ставится здесь явно. ADR-008 (файлы не ходят телом через API) здесь
   * НЕ нарушается по смыслу: он про пользовательские медиа произвольного
   * размера в S3, а тут — сгенерированный на лету отчёт в сотни
   * килобайт, живущий ровно один запрос и нигде не хранимый.
   */
  @Get('developments/:developmentId/chessboard/export')
  @RequirePermission('chessboard', 'export')
  async exportChessboard(
    @Req() req: FastifyRequest,
    @Param('developmentId', ParseObjectIdPipe) developmentId: Types.ObjectId,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const tenantContext = requireTenantContext(req);

    const { developmentName, currency, units } = await this.developmentsService.buildChessboardExport(
      developmentId,
      new Types.ObjectId(tenantContext.organizationId),
    );
    const workbook = await this.chessboardWorkbookService.build({ currency, units });
    const fileName = chessboardFileName(developmentName, new Date());

    await reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      // filename* (RFC 5987) — имя файла кириллическое, в голом filename= оно
      // не выживет; ASCII-фолбэк остаётся для старых клиентов.
      .header(
        'Content-Disposition',
        `attachment; filename="chessboard.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      )
      .send(workbook);
  }

  @Get('units/:unitId')
  @RequirePermission('development', 'read')
  async getUnit(@Req() req: FastifyRequest, @Param('unitId') unitId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.getUnitForOrganization(
      new Types.ObjectId(unitId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  /**
   * D-03: ERP polling после publish — читает РЕАЛЬНЫЙ статус
   * MarketplacePublication (publication_pending/published/unpublished/
   * build_failed), не canonical Development.status (тот меняется
   * синхронно до того, как worker вообще начал строить проекцию). Единый
   * 404 для "Development не существует/чужой" и "публикация никогда не
   * запускалась" — тот же tenant isolation паттерн, что остальные
   * read-методы этого контроллера.
   */
  @Get('developments/:developmentId/publication-status')
  @RequirePermission('development', 'read')
  async getPublicationStatus(@Req() req: FastifyRequest, @Param('developmentId') developmentId: string) {
    const tenantContext = requireTenantContext(req);

    return this.developmentsService.getPublicationStatus(
      new Types.ObjectId(developmentId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  /**
   * НЕ в узкой OpenAPI-спеке — d01-development-aggregate.md "Не покрыто":
   * repository готов с D-01, HTTP-подключение отсутствовало.
   */
  @Post('buildings/:buildingId/sections')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async createSection(
    @Req() req: FastifyRequest,
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateSectionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { buildingId, name: dto.name };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateSection', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createSection({
      buildingId: new Types.ObjectId(buildingId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      name: dto.name,
      idempotency: { identityId, operation: 'devCreateSection', key: idempotencyKey, requestBody },
    });
  }

  /**
   * НЕ в узкой OpenAPI-спеке — тот же честный пробел, что createSection выше.
   */
  @Post('buildings/:buildingId/floor-plans')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async createFloorPlan(
    @Req() req: FastifyRequest,
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateFloorPlanDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { buildingId, name: dto.name, rooms: dto.rooms, area: dto.area };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateFloorPlan', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createFloorPlan({
      buildingId: new Types.ObjectId(buildingId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      name: dto.name,
      rooms: dto.rooms,
      area: dto.area,
      isEuro: dto.isEuro,
      imageAssetId: dto.imageAssetId ? new Types.ObjectId(dto.imageAssetId) : undefined,
      tags: dto.tags,
      idempotency: { identityId, operation: 'devCreateFloorPlan', key: idempotencyKey, requestBody },
    });
  }

  @Post('buildings/:buildingId/floors')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async createFloor(
    @Req() req: FastifyRequest,
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateFloorDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { buildingId, floorNumber: dto.floorNumber };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateFloor', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createFloor({
      buildingId: new Types.ObjectId(buildingId),
      sectionId: dto.sectionId ? new Types.ObjectId(dto.sectionId) : undefined,
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      floorNumber: dto.floorNumber,
      floorType: dto.floorType,
      idempotency: { identityId, operation: 'devCreateFloor', key: idempotencyKey, requestBody },
    });
  }

  @Post('floors/:floorId/units')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async createUnit(
    @Req() req: FastifyRequest,
    @Param('floorId') floorId: string,
    @Query('buildingId') buildingIdParam: string,
    @Body() dto: CreateUnitDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { floorId, number: dto.number, kind: dto.kind, area: dto.area };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateUnit', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    // buildingId не часть URL-пути (OpenAPI-спека: POST /floors/{floorId}/units,
    // без buildingId в path) — передаётся query-параметром явно клиентом,
    // сервис всё равно server-side сверяет floor.buildingId с ним (не
    // доверяет напрямую), см. DevelopmentsService.createUnit.
    if (!buildingIdParam) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'buildingId query parameter is required');
    }

    return this.developmentsService.createUnit({
      buildingId: new Types.ObjectId(buildingIdParam),
      floorId: new Types.ObjectId(floorId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      number: dto.number,
      kind: dto.kind,
      rooms: dto.rooms,
      area: dto.area,
      areaLiving: dto.areaLiving,
      areaBalcony: dto.areaBalcony,
      price: dto.price,
      floorPlanId: dto.floorPlanId ? new Types.ObjectId(dto.floorPlanId) : undefined,
      idempotency: { identityId, operation: 'devCreateUnit', key: idempotencyKey, requestBody },
    });
  }

  @Patch('units/:unitId/price')
  @RequirePermission('unit', 'price.update')
  async updateUnitPrice(
    @Req() req: FastifyRequest,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitPriceDto,
  ) {
    const tenantContext = requireTenantContext(req);

    await this.developmentsService.updateUnitPrice({
      unitId: new Types.ObjectId(unitId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion: dto.expectedVersion,
      price: dto.price,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      correlationId: req.correlationId,
    });

    return this.developmentsService.getUnitForOrganization(
      new Types.ObjectId(unitId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Patch('units/:unitId/status')
  @RequirePermission('unit', 'status.update')
  async updateUnitStatus(
    @Req() req: FastifyRequest,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitStatusDto,
  ) {
    const tenantContext = requireTenantContext(req);

    await this.developmentsService.updateUnitStatus({
      unitId: new Types.ObjectId(unitId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion: dto.expectedVersion,
      status: dto.status,
      actorIdentityId: new Types.ObjectId(tenantContext.identityId),
      correlationId: req.correlationId,
    });

    return this.developmentsService.getUnitForOrganization(
      new Types.ObjectId(unitId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Post('buildings/:buildingId/chessboard/generate')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async generateChessboard(
    @Req() req: FastifyRequest,
    @Param('buildingId') buildingId: string,
    @Body() dto: GenerateChessboardDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    // ИСПРАВЛЕНО 10.09.2026: заголовок требовался, но никуда не передавался
    // — сетевой ретрай или двойной клик плодили дублирующиеся юниты. Тот же
    // паттерн checkCreateReplay, что уже применяется в createDevelopment.
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { buildingId, ...dto };
    const replay = await this.developmentsService.checkCreateReplay(
      identityId,
      'devGenerateChessboard',
      idempotencyKey,
      requestBody,
    );
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.generateChessboard({
      buildingId: new Types.ObjectId(buildingId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      sectionId: dto.sectionId ? new Types.ObjectId(dto.sectionId) : undefined,
      fromFloor: dto.fromFloor,
      toFloor: dto.toFloor,
      unitsPerFloor: dto.unitsPerFloor,
      numberingScheme: dto.numberingScheme,
      defaultKind: dto.defaultKind,
      rooms: dto.rooms,
      defaultArea: dto.defaultArea,
      defaultAreaLiving: dto.defaultAreaLiving,
      defaultAreaBalcony: dto.defaultAreaBalcony,
      defaultPrice: dto.defaultPrice,
      floorPlanId: dto.floorPlanId ? new Types.ObjectId(dto.floorPlanId) : undefined,
      actorIdentityId: identityId,
      correlationId: req.correlationId,
      idempotency: { identityId, operation: 'devGenerateChessboard', key: idempotencyKey, requestBody },
    });
  }

  @Post('buildings/:buildingId/units/batch')
  @HttpCode(201)
  @RequirePermission('development', 'edit')
  async batchCreateUnits(
    @Req() req: FastifyRequest,
    @Param('buildingId') buildingId: string,
    @Body() dto: BatchCreateUnitsDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    // ИСПРАВЛЕНО 10.09.2026: см. generateChessboard выше — без этого повтор
    // запроса плодил дубли юнитов (в схеме нет unique-индекса на (buildingId, number)).
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { buildingId, units: dto.units };
    const replay = await this.developmentsService.checkCreateReplay(
      identityId,
      'devBatchCreateUnits',
      idempotencyKey,
      requestBody,
    );
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.batchCreateUnits({
      buildingId: new Types.ObjectId(buildingId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      units: dto.units,
      actorIdentityId: identityId,
      correlationId: req.correlationId,
      idempotency: { identityId, operation: 'devBatchCreateUnits', key: idempotencyKey, requestBody },
    });
  }

  @Post('developments/:developmentId/units/batch-price-update')
  @HttpCode(200)
  @RequirePermission('unit', 'price.update')
  async batchUpdatePrices(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Body() dto: BatchUpdatePricesDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    // ИСПРАВЛЕНО 10.09.2026: без этого повторный запрос ("+10%" два раза
    // подряд из-за ретрая/двойного клика) применял процентную наценку дважды.
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, ...dto };
    const replay = await this.developmentsService.checkCreateReplay(
      identityId,
      'devBatchUpdatePrices',
      idempotencyKey,
      requestBody,
    );
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.batchUpdatePrices({
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      buildingId: dto.buildingId ? new Types.ObjectId(dto.buildingId) : undefined,
      floorMin: dto.floorMin,
      floorMax: dto.floorMax,
      kind: dto.kind,
      unitIds: dto.unitIds?.map((id) => new Types.ObjectId(id)),
      operationType: dto.operationType,
      value: dto.value,
      reason: dto.reason,
      actorIdentityId: identityId,
      actorPositionId: new Types.ObjectId(tenantContext.positionId),
      correlationId: req.correlationId,
      idempotency: { identityId, operation: 'devBatchUpdatePrices', key: idempotencyKey, requestBody },
    });
  }

  @Post('developments/:developmentId/installment-plans')
  @HttpCode(201)
  @RequirePermission('installment_plan', 'create')
  async createInstallmentPlan(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Body() dto: CreateInstallmentPlanDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, title: dto.title, downPaymentValue: dto.downPaymentValue };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateInstallmentPlan', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createInstallmentPlan({
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      unitId: dto.unitId ? new Types.ObjectId(dto.unitId) : undefined,
      title: dto.title,
      isActive: dto.isActive,
      applyTo: dto.applyTo,
      downPaymentType: dto.downPaymentType,
      downPaymentValue: dto.downPaymentValue,
      termType: dto.termType,
      termMonths: dto.termMonths,
      endDate: dto.endDate,
      paymentFrequency: dto.paymentFrequency,
      useDiscount: dto.useDiscount,
      discountFromDownPayment: dto.discountFromDownPayment,
      discountPercent: dto.discountPercent,
      description: dto.description,
      sortOrder: dto.sortOrder,
      idempotency: { identityId, operation: 'devCreateInstallmentPlan', key: idempotencyKey, requestBody },
    });
  }

  @Get('developments/:developmentId/installment-plans')
  @RequirePermission('installment_plan', 'read')
  async listInstallmentPlans(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Query() query: ListInstallmentPlansQueryDto,
  ) {
    const tenantContext = requireTenantContext(req);
    return this.developmentsService.listInstallmentPlans(
      new Types.ObjectId(developmentId),
      new Types.ObjectId(tenantContext.organizationId),
      { unitId: query.unitId ? new Types.ObjectId(query.unitId) : undefined },
    );
  }

  @Patch('developments/:developmentId/installment-plans/:id')
  @RequirePermission('installment_plan', 'update')
  async updateInstallmentPlan(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInstallmentPlanDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, id, expectedVersion: dto.expectedVersion, title: dto.title };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devUpdateInstallmentPlan', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const { expectedVersion, ...patchFields } = dto;
    return this.developmentsService.updateInstallmentPlan({
      id: new Types.ObjectId(id),
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion,
      patch: {
        ...patchFields,
        unitId: patchFields.unitId ? new Types.ObjectId(patchFields.unitId) : undefined,
      },
      idempotency: { identityId, operation: 'devUpdateInstallmentPlan', key: idempotencyKey, requestBody },
    });
  }

  @Delete('developments/:developmentId/installment-plans/:id')
  @HttpCode(204)
  @RequirePermission('installment_plan', 'delete')
  async deleteInstallmentPlan(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Param('id') id: string,
    @Query('expectedVersion') expectedVersionParam?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const expectedVersion = expectedVersionParam !== undefined ? parseInt(expectedVersionParam, 10) : 0;
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, id, expectedVersion };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devDeleteInstallmentPlan', idempotencyKey, requestBody);
    if (replay) {
      return;
    }

    await this.developmentsService.deleteInstallmentPlan({
      id: new Types.ObjectId(id),
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion,
      idempotency: { identityId, operation: 'devDeleteInstallmentPlan', key: idempotencyKey, requestBody },
    });
  }

  @Post('developments/:developmentId/commission-rules')
  @HttpCode(201)
  @RequirePermission('commission_rule', 'create')
  async createCommissionRule(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Body() dto: CreateCommissionRuleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, partnerType: dto.partnerType, commissionPercent: dto.commissionPercent };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devCreateCommissionRule', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    return this.developmentsService.createCommissionRule({
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      partnerType: dto.partnerType,
      commissionPercent: dto.commissionPercent,
      idempotency: { identityId, operation: 'devCreateCommissionRule', key: idempotencyKey, requestBody },
    });
  }

  @Get('developments/:developmentId/commission-rules')
  @RequirePermission('commission_rule', 'read')
  async listCommissionRules(@Req() req: FastifyRequest, @Param('developmentId') developmentId: string) {
    const tenantContext = requireTenantContext(req);
    return this.developmentsService.listCommissionRules(
      new Types.ObjectId(developmentId),
      new Types.ObjectId(tenantContext.organizationId),
    );
  }

  @Patch('developments/:developmentId/commission-rules/:id')
  @RequirePermission('commission_rule', 'update')
  async updateCommissionRule(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommissionRuleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, id, expectedVersion: dto.expectedVersion, partnerType: dto.partnerType, commissionPercent: dto.commissionPercent };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devUpdateCommissionRule', idempotencyKey, requestBody);
    if (replay) {
      return replay.responseBody;
    }

    const { expectedVersion, ...patchFields } = dto;
    return this.developmentsService.updateCommissionRule({
      id: new Types.ObjectId(id),
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion,
      patch: patchFields,
      idempotency: { identityId, operation: 'devUpdateCommissionRule', key: idempotencyKey, requestBody },
    });
  }

  @Delete('developments/:developmentId/commission-rules/:id')
  @HttpCode(204)
  @RequirePermission('commission_rule', 'delete')
  async deleteCommissionRule(
    @Req() req: FastifyRequest,
    @Param('developmentId') developmentId: string,
    @Param('id') id: string,
    @Query('expectedVersion') expectedVersionParam?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const tenantContext = requireTenantContext(req);
    if (!idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const expectedVersion = expectedVersionParam !== undefined ? parseInt(expectedVersionParam, 10) : 0;
    const identityId = new Types.ObjectId(tenantContext.identityId);
    const requestBody = { developmentId, id, expectedVersion };
    const replay = await this.developmentsService.checkCreateReplay(identityId, 'devDeleteCommissionRule', idempotencyKey, requestBody);
    if (replay) {
      return;
    }

    await this.developmentsService.deleteCommissionRule({
      id: new Types.ObjectId(id),
      developmentId: new Types.ObjectId(developmentId),
      organizationId: new Types.ObjectId(tenantContext.organizationId),
      expectedVersion,
      idempotency: { identityId, operation: 'devDeleteCommissionRule', key: idempotencyKey, requestBody },
    });
  }
}
