export { NotificationSettingsDocument, NotificationSettingsSchema } from './schemas/notification-settings.schema';
export { TelegramLinkCodeDocument, TelegramLinkCodeSchema } from './schemas/telegram-link-code.schema';
export {
  NotificationDeliveryDocument,
  NotificationDeliverySchema,
  NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  type NotificationKind,
  type NotificationChannel,
  type NotificationDeliveryStatus,
} from './schemas/notification-delivery.schema';
export { TelegramBotStateDocument, TelegramBotStateSchema } from './schemas/telegram-bot-state.schema';

export { NotificationSettingsRepository, type NotificationPreferences } from './repository/notification-settings.repository';
export { TelegramLinkCodeRepository } from './repository/telegram-link-code.repository';
export {
  NotificationDeliveryRepository,
  emptyDeliveryStats,
  type QueueDeliveryParams,
  type DeliveryCounts,
  type DeliveryStats,
} from './repository/notification-delivery.repository';
export { TelegramBotStateRepository } from './repository/telegram-bot-state.repository';

export { generateLinkCode, hashLinkCode, TELEGRAM_LINK_CODE_TTL_MS } from './link-code';
export { readNotificationChannels, emailFromLogin, type NotificationChannels, type EnvReader } from './channels';
export { formatNewsMessage, type NewsMessage, type NewsMessageInput } from './news-message';
