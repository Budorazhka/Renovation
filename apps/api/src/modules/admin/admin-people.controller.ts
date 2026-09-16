import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AdminGuard } from '../../shared/admin/admin.guard';
import { requireAdminContext } from '../../shared/admin/admin-context.middleware';
import { ParseObjectIdPipe } from '../../shared/validation/parse-object-id.pipe';
import { AdminPeopleService } from './admin-people.service';
import { RenamePersonDto } from './dto/rename-person.dto';

/**
 * Люди платформы в админке. AdminGuard — только аутентификация администратора;
 * право `person.rename` проверяет AdminPeopleService.
 */
@Controller('admin/people')
@UseGuards(AdminGuard)
export class AdminPeopleController {
  constructor(private readonly service: AdminPeopleService) {}

  @Patch(':identityId')
  rename(
    @Req() req: FastifyRequest,
    @Param('identityId', ParseObjectIdPipe) identityId: Types.ObjectId,
    @Body() dto: RenamePersonDto,
  ) {
    return this.service.rename(requireAdminContext(req), {
      identityId,
      name: dto.name,
      reason: dto.reason,
      correlationId: req.correlationId,
    });
  }
}
