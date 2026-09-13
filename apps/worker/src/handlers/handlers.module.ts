import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaAssetDocument, MediaAssetSchema, MediaAssetRepository, MediaStorageService } from '@baza/media-storage';
import {
  DevelopmentDocument,
  DevelopmentSchema,
  DevelopmentRepository,
  BuildingDocument,
  BuildingSchema,
  BuildingRepository,
  UnitDocument,
  UnitSchema,
  UnitRepository,
  FloorPlanDocument,
  FloorPlanSchema,
  FloorPlanRepository,
} from '@baza/development';
import {
  PropertyAssetDocument,
  PropertyAssetSchema,
  PropertyAssetRepository,
  ListingDocument,
  ListingSchema,
  ListingRepository,
} from '@baza/property-assets';
import {
  MarketplacePublicationDocument,
  MarketplacePublicationSchema,
  MarketplacePublicationRepository,
} from '@baza/publication';
import {
  MessengerAccountDocument,
  MessengerAccountSchema,
  MessengerAccountRepository,
  MessengerMessageDocument,
  MessengerMessageSchema,
  MessengerMessageRepository,
  TelegramBotClient,
} from '@baza/messenger';
import { OutboxModule } from '../outbox/outbox.module';
import { EventHandlerRegistry } from '../outbox/event-handler.registry';
import { MediaVerifiedHandler } from './media-verified.handler';
import { MessengerMessageSentHandler } from './messenger-message-sent.handler';
import { PositionOccupantAssignedHandler } from './position-occupant-assigned.handler';
import { PublicationRequestedHandler } from './publication-requested.handler';
import { UnitPriceChangedHandler } from './unit-price-changed.handler';
import { UnitStatusChangedHandler } from './unit-status-changed.handler';
import { BookingCreatedHandler } from './booking-created.handler';
import { BookingCancelledHandler } from './booking-cancelled.handler';
import { BookingConfirmedHandler } from './booking-confirmed.handler';
import { BookingExtendedHandler } from './booking-extended.handler';
import { AcknowledgedEventHandler } from './acknowledged-event.handler';
import { ImageVariantService } from './image-variant.service';

/**
 * Типы событий, которые публикуются, но пока не имеют побочного эффекта.
 * Подтверждаются общим AcknowledgedEventHandler — см. его докстринг о том,
 * почему отсутствие handler'а хуже, чем no-op handler.
 *
 * Экспортируется, чтобы страж (handlers-coverage.spec.ts) мог сверить этот
 * список с тем, что реально публикуется в коде.
 */
export const ACKNOWLEDGED_ONLY_EVENT_TYPES = [
  'PositionVacated',
  'TaskCreated',
  'TaskCompleted',
  'TaskReassigned',
  'UnpublicationRequested',
  'BookingConvertedToDeal',
  // 11.09.2026: истечение брони по сроку. Побочный эффект (уведомить
  // менеджера) — будущая задача уведомлений; освобождение юнита уже сделано
  // в API той же транзакцией и приходит отдельным UnitStatusChanged.
  'BookingExpired',
  'LmsCourseCompleted',
  'CommunityThreadCreated',
  'CommunityReplyCreated',
  'ExchangeDealStatusChanged',
] as const;

/**
 * Регистрация handler'ов в EventHandlerRegistry при старте приложения —
 * новый handler добавляется здесь (provider + register() вызов), не
 * требует правки OutboxPollerService/EventHandlerRegistry самих по себе.
 */
@Module({
  imports: [
    OutboxModule,
    MongooseModule.forFeature([
      { name: MediaAssetDocument.name, schema: MediaAssetSchema },
      { name: DevelopmentDocument.name, schema: DevelopmentSchema },
      { name: BuildingDocument.name, schema: BuildingSchema },
      { name: UnitDocument.name, schema: UnitSchema },
      { name: FloorPlanDocument.name, schema: FloorPlanSchema },
      { name: PropertyAssetDocument.name, schema: PropertyAssetSchema },
      { name: ListingDocument.name, schema: ListingSchema },
      { name: MarketplacePublicationDocument.name, schema: MarketplacePublicationSchema },
      { name: MessengerAccountDocument.name, schema: MessengerAccountSchema },
      { name: MessengerMessageDocument.name, schema: MessengerMessageSchema },
    ]),
  ],
  providers: [
    MediaAssetRepository,
    MediaStorageService,
    ImageVariantService,
    DevelopmentRepository,
    BuildingRepository,
    UnitRepository,
    FloorPlanRepository,
    PropertyAssetRepository,
    ListingRepository,
    MarketplacePublicationRepository,
    MessengerAccountRepository,
    MessengerMessageRepository,
    TelegramBotClient,
    MediaVerifiedHandler,
    PositionOccupantAssignedHandler,
    PublicationRequestedHandler,
    UnitPriceChangedHandler,
    UnitStatusChangedHandler,
    BookingCreatedHandler,
    BookingCancelledHandler,
    BookingConfirmedHandler,
    BookingExtendedHandler,
    MessengerMessageSentHandler,
    AcknowledgedEventHandler,
  ],
})
export class HandlersModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly mediaVerifiedHandler: MediaVerifiedHandler,
    private readonly positionOccupantAssignedHandler: PositionOccupantAssignedHandler,
    private readonly publicationRequestedHandler: PublicationRequestedHandler,
    private readonly unitPriceChangedHandler: UnitPriceChangedHandler,
    private readonly unitStatusChangedHandler: UnitStatusChangedHandler,
    private readonly bookingCreatedHandler: BookingCreatedHandler,
    private readonly bookingCancelledHandler: BookingCancelledHandler,
    private readonly bookingConfirmedHandler: BookingConfirmedHandler,
    private readonly bookingExtendedHandler: BookingExtendedHandler,
    private readonly messengerMessageSentHandler: MessengerMessageSentHandler,
    private readonly acknowledgedEventHandler: AcknowledgedEventHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register('MediaVerified', this.mediaVerifiedHandler);
    this.registry.register('PositionOccupantAssigned', this.positionOccupantAssignedHandler);
    this.registry.register('PublicationRequested', this.publicationRequestedHandler);
    this.registry.register('UnitPriceChanged', this.unitPriceChangedHandler);
    this.registry.register('UnitStatusChanged', this.unitStatusChangedHandler);
    this.registry.register('BookingCreated', this.bookingCreatedHandler);
    this.registry.register('BookingCancelled', this.bookingCancelledHandler);
    this.registry.register('BookingConfirmed', this.bookingConfirmedHandler);
    this.registry.register('BookingExtended', this.bookingExtendedHandler);
    this.registry.register('MessengerMessageSent', this.messengerMessageSentHandler);

    for (const eventType of ACKNOWLEDGED_ONLY_EVENT_TYPES) {
      this.registry.register(eventType, this.acknowledgedEventHandler);
    }
  }
}
