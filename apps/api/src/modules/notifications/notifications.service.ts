import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientSession, Types } from 'mongoose';
import {
  NotificationDeliveryRepository,
  NotificationSettingsRepository,
  TelegramLinkCodeRepository,
  TELEGRAM_LINK_CODE_TTL_MS,
  emailFromLogin,
  generateLinkCode,
  hashLinkCode,
  readNotificationChannels,
  type DeliveryStats,
  type NewsMessage,
  type NotificationChannels,
  type NotificationPreferences,
  type QueueDeliveryParams,
} from '@baza/notifications';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuthService } from '../identity/auth.service';
import { OutboxService } from '../outbox/outbox.service';

export interface NotificationSettingsView {
  email: {
    /** Адрес из логина; null — логин не адрес почты, письма не придут. */
    address: string | null;
    news: boolean;
    /** Настроена ли почта на сервере. */
    configured: boolean;
  };
  telegram: {
    linked: boolean;
    username: string | null;
    news: boolean;
    /** Настроен ли бот уведомлений на сервере. */
    configured: boolean;
  };
}

export interface QueuedDeliveries {
  email: number;
  telegram: number;
}

/**
 * Уведомления человека: настройки, привязка Telegram к боту уведомлений
 * BAZA и постановка рассылок в очередь. Отправляет worker
 * (NotificationDeliveriesQueued), здесь — только решение, кому и куда.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly settings: NotificationSettingsRepository,
    private readonly linkCodes: TelegramLinkCodeRepository,
    private readonly deliveries: NotificationDeliveryRepository,
    private readonly authService: AuthService,
    private readonly outboxService: OutboxService,
    private readonly config: ConfigService,
  ) {}

  channels(): NotificationChannels {
    return readNotificationChannels((key) => this.config.get<string>(key));
  }

  /** Адрес ленты новостей в ERP для ссылки в письме и Telegram; без ERP_PUBLIC_URL ссылки нет. */
  newsFeedUrl(): string | null {
    const base = this.config.get<string>('ERP_PUBLIC_URL')?.trim().replace(/\/+$/, '');
    return base ? `${base}/#/dashboard/settings/info/news` : null;
  }

  async getSettings(identityId: Types.ObjectId): Promise<NotificationSettingsView> {
    const [settings, [identity]] = await Promise.all([
      this.settings.findByIdentity(identityId),
      this.authService.findByIds([identityId]),
    ]);
    const channels = this.channels();
    return {
      email: {
        address: emailFromLogin(identity?.normalizedLogin),
        news: settings?.newsEmail ?? true,
        configured: channels.email,
      },
      telegram: {
        linked: !!settings?.telegramChatId,
        username: settings?.telegramUsername ?? null,
        news: settings?.newsTelegram ?? true,
        configured: channels.telegram,
      },
    };
  }

  async updatePreferences(identityId: Types.ObjectId, preferences: NotificationPreferences): Promise<NotificationSettingsView> {
    await this.settings.updatePreferences(identityId, preferences);
    return this.getSettings(identityId);
  }

  /**
   * Ссылка привязки Telegram: `t.me/<бот>?start=<код>`. Код одноразовый,
   * живёт 15 минут, новый отменяет прежний. Бот (worker) по `/start <код>`
   * связывает чат с этой identity.
   */
  async createTelegramLink(identityId: Types.ObjectId): Promise<{ url: string; expiresAt: string }> {
    const username = this.config.get<string>('TELEGRAM_NOTIFY_BOT_USERNAME')?.trim().replace(/^@/, '');
    if (!this.channels().telegram || !username) {
      throw new AppException(ErrorCode.NOTIFICATION_CHANNEL_NOT_CONFIGURED, 'Telegram notifications bot is not configured');
    }
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MS);
    await this.linkCodes.replaceForIdentity(identityId, hashLinkCode(code), expiresAt);
    return { url: `https://t.me/${username}?start=${code}`, expiresAt: expiresAt.toISOString() };
  }

  async unlinkTelegram(identityId: Types.ObjectId): Promise<void> {
    await this.settings.unlinkTelegram(identityId);
  }

  /**
   * Ставит рассылку новости в очередь в транзакции публикации. Письмо — тем,
   * у кого логин является адресом и почта не выключена; Telegram — тем, кто
   * привязал бота и не выключил. Канал, не настроенный на сервере, не
   * ставится вовсе: иначе в журнале копились бы заведомо неотправимые записи.
   */
  async queueNewsDeliveries(
    params: {
      newsId: Types.ObjectId;
      recipientIdentityIds: Types.ObjectId[];
      channels: NotificationChannels;
      message: NewsMessage;
    },
    session: ClientSession,
  ): Promise<QueuedDeliveries> {
    const configured = this.channels();
    const wantEmail = params.channels.email && configured.email;
    const wantTelegram = params.channels.telegram && configured.telegram;
    if ((!wantEmail && !wantTelegram) || params.recipientIdentityIds.length === 0) {
      return { email: 0, telegram: 0 };
    }

    const [identities, settingsRows] = await Promise.all([
      this.authService.findByIds(params.recipientIdentityIds),
      this.settings.findByIdentityIds(params.recipientIdentityIds),
    ]);
    const settingsByIdentity = new Map(settingsRows.map((row) => [row.identityId.toString(), row]));

    const queue: QueueDeliveryParams[] = [];
    for (const identity of identities) {
      if (identity.status !== 'active') continue;
      const settings = settingsByIdentity.get(identity.id.toString());
      const base = { kind: 'news' as const, refId: params.newsId, identityId: identity.id, subject: params.message.subject };
      const email = emailFromLogin(identity.normalizedLogin);
      if (wantEmail && email && settings?.newsEmail !== false) {
        queue.push({ ...base, channel: 'email', address: email, text: params.message.emailText });
      }
      if (wantTelegram && settings?.telegramChatId && settings.newsTelegram !== false) {
        queue.push({ ...base, channel: 'telegram', address: settings.telegramChatId, text: params.message.telegramText });
      }
    }

    await this.deliveries.queue(queue, session);
    if (queue.length > 0) {
      await this.outboxService.publish(
        {
          eventType: 'NotificationDeliveriesQueued',
          aggregateType: 'news',
          aggregateId: params.newsId,
          payload: { kind: 'news', refId: params.newsId.toString() },
        },
        session,
      );
    }
    return {
      email: queue.filter((delivery) => delivery.channel === 'email').length,
      telegram: queue.filter((delivery) => delivery.channel === 'telegram').length,
    };
  }

  async newsDeliveryStats(newsIds: Types.ObjectId[]): Promise<Map<string, DeliveryStats>> {
    return this.deliveries.statsByRefIds('news', newsIds);
  }
}
