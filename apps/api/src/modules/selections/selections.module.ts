import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PropertyAssetDocument,
  PropertyAssetSchema,
  PropertyAssetRepository,
  ListingDocument,
  ListingSchema,
  ListingRepository,
} from '@baza/property-assets';
import { DevSelectionDocument, DevSelectionSchema } from './schemas/dev-selection.schema';
import { DevSelectionRepository } from './repository/dev-selection.repository';
import { SelectionsService } from './selections.service';
import { SelectionsController } from './selections.controller';
import { PublicSelectionsController } from './public-selections.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { DevelopmentsModule } from '../developments/developments.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DevSelectionDocument.name, schema: DevSelectionSchema },
      // N-27: лот подборки — юнит новостройки ИЛИ объявление вторички
      // (@baza/property-assets, тот же паттерн регистрации, что CrmModule).
      { name: PropertyAssetDocument.name, schema: PropertyAssetSchema },
      { name: ListingDocument.name, schema: ListingSchema },
    ]),
    AuthorizationModule,
    IdempotencyModule,
    // Unit-существование (getUnitForOrganization) и Lead-существование
    // (getLeadForOrganization) — только через сервисы этих модулей
    // (ADR-001, apps/api/test/architecture/module-boundaries.test.ts).
    DevelopmentsModule,
    CrmModule,
  ],
  controllers: [SelectionsController, PublicSelectionsController],
  providers: [DevSelectionRepository, SelectionsService, PropertyAssetRepository, ListingRepository],
})
export class SelectionsModule {}
