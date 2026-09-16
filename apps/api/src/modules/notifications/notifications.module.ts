import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NotificationDeliveryDocument,
  NotificationDeliveryRepository,
  NotificationDeliverySchema,
  NotificationSettingsDocument,
  NotificationSettingsRepository,
  NotificationSettingsSchema,
  TelegramLinkCodeDocument,
  TelegramLinkCodeRepository,
  TelegramLinkCodeSchema,
} from '@baza/notifications';
import { IdentityModule } from '../identity/identity.module';
import { OutboxModule } from '../outbox/outbox.module';
import { NotificationsService } from './notifications.service';
import { MeNotificationsController } from './me-notifications.controller';

/**
 * Уведомления: настройки человека, привязка Telegram, очередь доставок.
 * Схемы и репозитории — в @baza/notifications (их же читает worker, тот же
 * принцип, что @baza/messenger). Наружу — только NotificationsService.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationSettingsDocument.name, schema: NotificationSettingsSchema },
      { name: TelegramLinkCodeDocument.name, schema: TelegramLinkCodeSchema },
      { name: NotificationDeliveryDocument.name, schema: NotificationDeliverySchema },
    ]),
    IdentityModule,
    OutboxModule,
  ],
  controllers: [MeNotificationsController],
  providers: [NotificationSettingsRepository, TelegramLinkCodeRepository, NotificationDeliveryRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
