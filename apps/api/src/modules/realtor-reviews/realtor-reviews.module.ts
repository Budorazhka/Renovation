import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RealtorReviewDocument, RealtorReviewSchema } from './schemas/realtor-review.schema';
import { RealtorReviewRepository } from './repository/realtor-review.repository';
import { RealtorReviewsService } from './realtor-reviews.service';
import { PublicRealtorReviewsController } from './public-realtor-reviews.controller';
import { MarketplaceRealtorReviewsController } from './marketplace-realtor-reviews.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: RealtorReviewDocument.name, schema: RealtorReviewSchema }])],
  controllers: [PublicRealtorReviewsController, MarketplaceRealtorReviewsController],
  providers: [RealtorReviewRepository, RealtorReviewsService],
  exports: [RealtorReviewsService],
})
export class RealtorReviewsModule {}
