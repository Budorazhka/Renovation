import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceSelectionDocument, MarketplaceSelectionSchema } from './schemas/marketplace-selection.schema';
import { MarketplaceSelectionRepository } from './repository/marketplace-selection.repository';
import { MarketplaceSelectionsService } from './marketplace-selections.service';
import { MarketplaceSelectionsController } from './marketplace-selections.controller';
import { PublicMarketplaceSelectionsController } from './public-marketplace-selections.controller';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MarketplaceSelectionDocument.name, schema: MarketplaceSelectionSchema }]),
    IdempotencyModule,
  ],
  controllers: [MarketplaceSelectionsController, PublicMarketplaceSelectionsController],
  providers: [MarketplaceSelectionRepository, MarketplaceSelectionsService],
})
export class MarketplaceSelectionsModule {}
