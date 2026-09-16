import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ClientRegistrationDocument,
  ClientRegistrationSchema,
} from './schemas/client-registration.schema';
import { ClientRegistrationRepository } from './repository/client-registration.repository';
import { ClientRegistrationsService } from './client-registrations.service';
import { ClientRegistrationsController } from './client-registrations.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { DevelopmentsModule } from '../developments/developments.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PublicationModule } from '../publication/publication.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';

/**
 * Фиксация клиента у застройщика. Комплекс и организация застройщика
 * читаются через DevelopmentsService и OrganizationsService (ADR-001:
 * cross-module только через сервис, не через чужой репозиторий).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClientRegistrationDocument.name, schema: ClientRegistrationSchema },
    ]),
    AuthorizationModule,
    AuditModule,
    DevelopmentsModule,
    OrganizationsModule,
    PublicationModule,
    IdempotencyModule,
  ],
  controllers: [ClientRegistrationsController],
  providers: [ClientRegistrationRepository, ClientRegistrationsService],
  exports: [ClientRegistrationsService],
})
export class ClientRegistrationsModule {}
