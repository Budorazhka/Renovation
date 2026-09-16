import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { ReferralCuratorDocument, ReferralCuratorSchema } from './schemas/referral-curator.schema';
import { ReferralMembershipDocument, ReferralMembershipSchema } from './schemas/referral-membership.schema';
import { ReferralRequestDocument, ReferralRequestSchema } from './schemas/referral-request.schema';
import { CuratorAccrualDocument, CuratorAccrualSchema } from './schemas/curator-accrual.schema';
import { ReferralCuratorRepository } from './repository/referral-curator.repository';
import { ReferralMembershipRepository } from './repository/referral-membership.repository';
import { ReferralRequestRepository } from './repository/referral-request.repository';
import { CuratorAccrualRepository } from './repository/curator-accrual.repository';
import { ReferralNetworkService } from './referral-network.service';
import { CuratorAccrualsService } from './curator-accruals.service';
import { MarketplaceReferralController } from './marketplace-referral.controller';
import { PublicReferralInviteController } from './public-referral-invite.controller';
import { ErpReferralController } from './erp-referral.controller';

/**
 * Реферальная сеть BAZA: кураторы, команды, заявки, начисления 7%.
 * Сервисы экспортируются админке: правку сети, отметку комиссий и выплаты
 * ведёт AdminModule (ADR-001 — только через сервис).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralCuratorDocument.name, schema: ReferralCuratorSchema },
      { name: ReferralMembershipDocument.name, schema: ReferralMembershipSchema },
      { name: ReferralRequestDocument.name, schema: ReferralRequestSchema },
      { name: CuratorAccrualDocument.name, schema: CuratorAccrualSchema },
    ]),
    AuditModule,
    AuthorizationModule,
    IdentityModule,
    OrganizationsModule,
    RateLimitModule,
  ],
  controllers: [MarketplaceReferralController, PublicReferralInviteController, ErpReferralController],
  providers: [
    ReferralCuratorRepository,
    ReferralMembershipRepository,
    ReferralRequestRepository,
    CuratorAccrualRepository,
    ReferralNetworkService,
    CuratorAccrualsService,
  ],
  exports: [ReferralNetworkService, CuratorAccrualsService],
})
export class ReferralNetworkModule {}
