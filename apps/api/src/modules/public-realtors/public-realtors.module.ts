import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RealtorReviewsModule } from '../realtor-reviews/realtor-reviews.module';
import { MediaModule } from '../media/media.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { PublicRealtorsService } from './public-realtors.service';
import { PublicRealtorsController } from './public-realtors.controller';

@Module({
  imports: [OrganizationsModule, RealtorReviewsModule, MediaModule, RateLimitModule],
  controllers: [PublicRealtorsController],
  providers: [PublicRealtorsService],
})
export class PublicRealtorsModule {}
