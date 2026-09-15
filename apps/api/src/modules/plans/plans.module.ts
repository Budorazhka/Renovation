import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlanDocument, PlanSchema } from './schemas/plan.schema';
import { PlanRepository } from './repository/plan.repository';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { CrmModule } from '../crm/crm.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PlanDocument.name, schema: PlanSchema }]),
    AuthorizationModule,
    AuditModule,
    // Факт по плану — только через CrmService (ADR-001, module-boundaries.test.ts).
    CrmModule,
    OrganizationsModule,
  ],
  controllers: [PlansController],
  providers: [PlanRepository, PlansService],
})
export class PlansModule {}
