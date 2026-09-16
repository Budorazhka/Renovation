import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TelegramBotClient } from '@baza/messenger';
import {
  NotificationDeliveryDocument,
  NotificationDeliveryRepository,
  NotificationDeliverySchema,
  NotificationSettingsDocument,
  NotificationSettingsRepository,
  NotificationSettingsSchema,
  TelegramBotStateDocument,
  TelegramBotStateRepository,
  TelegramBotStateSchema,
  TelegramLinkCodeDocument,
  TelegramLinkCodeRepository,
  TelegramLinkCodeSchema,
} from '@baza/notifications';
import { MailerService } from './mailer.service';
import { NotificationDeliveriesQueuedHandler } from './notification-deliveries-queued.handler';
import { TelegramNotifyBotService } from './telegram-notify-bot.service';

/**
 * Рассылка уведомлений (почта, Telegram) и бот уведомлений платформы.
 * NotificationDeliveriesQueuedHandler регистрируется в HandlersModule, как
 * остальные обработчики outbox.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationSettingsDocument.name, schema: NotificationSettingsSchema },
      { name: TelegramLinkCodeDocument.name, schema: TelegramLinkCodeSchema },
      { name: NotificationDeliveryDocument.name, schema: NotificationDeliverySchema },
      { name: TelegramBotStateDocument.name, schema: TelegramBotStateSchema },
    ]),
  ],
  providers: [
    NotificationSettingsRepository,
    TelegramLinkCodeRepository,
    NotificationDeliveryRepository,
    TelegramBotStateRepository,
    TelegramBotClient,
    MailerService,
    NotificationDeliveriesQueuedHandler,
    TelegramNotifyBotService,
  ],
  exports: [NotificationDeliveriesQueuedHandler],
})
export class NotificationsModule {}
