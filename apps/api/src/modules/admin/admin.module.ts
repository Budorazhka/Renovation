import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplacePublicationDocument, MarketplacePublicationSchema } from '@baza/publication';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { AdminAccountDocument, AdminAccountSchema } from './schemas/admin-account.schema';
import { AdminAccountRepository } from './repository/admin-account.repository';
import { AdminPolicyService } from './admin-policy.service';
import { AdminAccountService } from './admin-account.service';
import { AdminPublicationService } from './admin-publication.service';
import { AdminPublicationController } from './admin-publication.controller';
import { AdminAccountController } from './admin-account.controller';
import { AdminMeController } from './admin-me.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminDuplicateCandidateService } from './admin-duplicate-candidate.service';
import { AdminDuplicateCandidateController } from './admin-duplicate-candidate.controller';
import { AdminComplaintService } from './admin-complaint.service';
import { AdminComplaintController } from './admin-complaint.controller';
import { AdminRealtorReviewService } from './admin-realtor-review.service';
import { AdminRealtorReviewController } from './admin-realtor-review.controller';
import { AdminOrganizationService } from './admin-organization.service';
import { AdminOrganizationController } from './admin-organization.controller';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingPlansController } from './admin-billing-plans.controller';
import { AdminNewsService } from './admin-news.service';
import { AdminNewsController } from './admin-news.controller';
import { AdminReferralService } from './admin-referral.service';
import { AdminReferralNetworkController } from './admin-referral-network.controller';
import { AdminCommissionsController } from './admin-commissions.controller';
import { AdminCuratorPayoutsController } from './admin-curator-payouts.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PublicationModule } from '../publication/publication.module';
import { PropertyAssetsModule } from '../property-assets/property-assets.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingModule } from '../billing/billing.module';
import { RealtorReviewsModule } from '../realtor-reviews/realtor-reviews.module';
import { NewsModule } from '../news/news.module';
import { CrmModule } from '../crm/crm.module';
import { ReferralNetworkModule } from '../referral-network/referral-network.module';

/**
 * PermissionGrantRepository НЕ импортируется/регистрируется здесь напрямую
 * (test/architecture/module-boundaries.test.ts прямо это запрещает —
 * "модуль не импортирует repository другого модуля напрямую", ADR-001/002).
 * AdminAccountService пишет grants исключительно через
 * PolicyEvaluatorService.grant() (authorization-модуль владеет своим
 * repository, экспортирует только сервис поверх него) — тот же принцип,
 * что уже применяется к чтению прав (evaluate()).
 */
@Module({
  imports: [
    IdempotencyModule,
    MongooseModule.forFeature([
      { name: AdminAccountDocument.name, schema: AdminAccountSchema },
      // MarketplacePublicationDocument уже зарегистрирован в
      // PublicationModule, но MongooseModule.forFeature требует явной
      // регистрации в каждом модуле, использующем @InjectModel для этого
      // имени — тот же паттерн, что уже применён в CrmModule.
      { name: MarketplacePublicationDocument.name, schema: MarketplacePublicationSchema },
    ]),
    // PolicyEvaluatorService переиспользуется отсюда (не создаётся заново
    // как отдельный provider) — один DI-граф на весь процесс, не два
    // независимых инстанса с одинаковым поведением поверх той же коллекции.
    AuthorizationModule,
    PublicationModule,
    PropertyAssetsModule,
    AuditModule,
    IdentityModule,
    OrganizationsModule,
    BillingModule,
    RealtorReviewsModule,
    NewsModule,
    CrmModule,
    ReferralNetworkModule,
  ],
  controllers: [
    AdminPublicationController,
    AdminAccountController,
    AdminMeController,
    AdminAuditController,
    AdminDuplicateCandidateController,
    AdminComplaintController,
    AdminRealtorReviewController,
    AdminOrganizationController,
    AdminBillingController,
    AdminBillingPlansController,
    AdminNewsController,
    AdminReferralNetworkController,
    AdminCommissionsController,
    AdminCuratorPayoutsController,
  ],
  providers: [
    AdminAccountRepository,
    AdminPolicyService,
    AdminAccountService,
    AdminPublicationService,
    AdminAuditService,
    AdminDuplicateCandidateService,
    AdminComplaintService,
    AdminRealtorReviewService,
    AdminOrganizationService,
    AdminNewsService,
    AdminReferralService,
  ],
  exports: [AdminAccountRepository],
})
export class AdminModule {}
