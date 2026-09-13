import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { BuyerRequestDocument, BuyerRequestSchema } from './schemas/buyer-request.schema';
import { BuyerRequestRepository } from './repository/buyer-request.repository';
import { BuyerRequestsService } from './buyer-requests.service';
import { PublicBuyerRequestsController } from './public-buyer-requests.controller';
import { MarketplaceBuyerRequestsController } from './marketplace-buyer-requests.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: BuyerRequestDocument.name, schema: BuyerRequestSchema }]),
    IdempotencyModule,
  ],
  controllers: [MarketplaceBuyerRequestsController, PublicBuyerRequestsController],
  providers: [BuyerRequestRepository, BuyerRequestsService],
  exports: [BuyerRequestsService],
})
export class BuyerRequestsModule {}
