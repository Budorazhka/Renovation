import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DevelopmentDocument, DevelopmentSchema, DevelopmentRepository } from '@baza/development';
import { BuildingDocument, BuildingSchema } from './schemas/building.schema';
import { SectionDocument, SectionSchema } from './schemas/section.schema';
import { FloorDocument, FloorSchema } from './schemas/floor.schema';
import { FloorPlanDocument, FloorPlanSchema } from './schemas/floor-plan.schema';
import { UnitDocument, UnitSchema } from './schemas/unit.schema';
import { InstallmentPlanDocument, InstallmentPlanSchema } from './schemas/installment-plan.schema';
import { CommissionRuleDocument, CommissionRuleSchema } from './schemas/commission-rule.schema';
import { BuildingRepository } from './repository/building.repository';
import { SectionRepository } from './repository/section.repository';
import { FloorRepository } from './repository/floor.repository';
import { FloorPlanRepository } from './repository/floor-plan.repository';
import { UnitRepository } from './repository/unit.repository';
import { InstallmentPlanRepository } from './repository/installment-plan.repository';
import { CommissionRuleRepository } from './repository/commission-rule.repository';
import { DevelopmentsService } from './developments.service';
import { ChessboardWorkbookService } from './chessboard-workbook.service';
import { DevelopmentsController } from './developments.controller';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PublicationModule } from '../publication/publication.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DevelopmentDocument.name, schema: DevelopmentSchema },
      { name: BuildingDocument.name, schema: BuildingSchema },
      { name: SectionDocument.name, schema: SectionSchema },
      { name: FloorDocument.name, schema: FloorSchema },
      { name: FloorPlanDocument.name, schema: FloorPlanSchema },
      { name: UnitDocument.name, schema: UnitSchema },
      { name: InstallmentPlanDocument.name, schema: InstallmentPlanSchema },
      { name: CommissionRuleDocument.name, schema: CommissionRuleSchema },
    ]),
    AuditModule,
    OutboxModule,
    AuthorizationModule,
    PublicationModule,
    IdempotencyModule,
    // OrganizationsService.getOrganizationById — только застройщик
    // (organization.type === 'developer') может создавать/публиковать ЖК
    // (см. DevelopmentsService.requireDeveloperOrganization).
    OrganizationsModule,
  ],
  controllers: [DevelopmentsController],
  providers: [
    DevelopmentRepository,
    BuildingRepository,
    SectionRepository,
    FloorRepository,
    FloorPlanRepository,
    UnitRepository,
    InstallmentPlanRepository,
    CommissionRuleRepository,
    DevelopmentsService,
    ChessboardWorkbookService,
  ],
  exports: [DevelopmentsService],
})
export class DevelopmentsModule {}
