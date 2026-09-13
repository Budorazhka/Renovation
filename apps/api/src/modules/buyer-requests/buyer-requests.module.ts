import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BuyerRequestDocument, BuyerRequestSchema } from './schemas/buyer-request.schema';
import { BuyerRequestResponseDocument, BuyerRequestResponseSchema } from './schemas/buyer-request-response.schema';
import { BuyerRequestRepository } from './repository/buyer-request.repository';
import { BuyerRequestResponseRepository } from './repository/buyer-request-response.repository';
import { BuyerRequestsService } from './buyer-requests.service';
import { PublicBuyerRequestsController } from './public-buyer-requests.controller';
import { MarketplaceBuyerRequestsController } from './marketplace-buyer-requests.controller';
import { ErpBuyerRequestsController } from './erp-buyer-requests.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BuyerRequestDocument.name, schema: BuyerRequestSchema },
      { name: BuyerRequestResponseDocument.name, schema: BuyerRequestResponseSchema },
    ]),
    IdempotencyModule,
    AuthorizationModule,
    RateLimitModule,
  ],
  controllers: [MarketplaceBuyerRequestsController, PublicBuyerRequestsController, ErpBuyerRequestsController],
  providers: [BuyerRequestRepository, BuyerRequestResponseRepository, BuyerRequestsService],
  exports: [BuyerRequestsService],
})
export class BuyerRequestsModule {}
