import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CrmModule } from '../crm/crm.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuditModule } from '../audit/audit.module';
import { RealtorReviewDocument, RealtorReviewSchema } from './schemas/realtor-review.schema';
import { RealtorReviewRepository } from './repository/realtor-review.repository';
import { RealtorReviewsService } from './realtor-reviews.service';
import { PublicRealtorReviewsController } from './public-realtor-reviews.controller';
import { MarketplaceRealtorReviewsController } from './marketplace-realtor-reviews.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RealtorReviewDocument.name, schema: RealtorReviewSchema }]),
    CrmModule,
    OrganizationsModule,
    AuditModule,
  ],
  controllers: [PublicRealtorReviewsController, MarketplaceRealtorReviewsController],
  providers: [RealtorReviewRepository, RealtorReviewsService],
  exports: [RealtorReviewsService],
})
export class RealtorReviewsModule {}
