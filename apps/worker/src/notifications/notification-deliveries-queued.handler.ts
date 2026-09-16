import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type { OutboxEventDocument } from '@baza/domain-events';
import { TelegramApiError, TelegramBotClient } from '@baza/messenger';
import {
  NotificationDeliveryRepository,
  NotificationSettingsRepository,
  readNotificationChannels,
  type NotificationDeliveryDocument,
  type NotificationKind,
} from '@baza/notifications';
import type { EventHandler } from '../outbox/event-handler';
import { MailerService, PermanentMailError } from './mailer.service';

/** Структура, которую публикует apps/api NotificationsService.queueNewsDeliveries. */
interface NotificationDeliveriesQueuedPayload {
  kind: NotificationKind;
  refId: string;
}

const BATCH_SIZE = 50;

/**
 * Рассылка уведомлений: отправляет доставки `pending` одной новости по
 * почте и в Telegram и переводит каждую в sent/failed/skipped.
 *
 * ADR-006 идемпотентность: статус меняется только из pending, повтор
 * события пропускает уже отправленное. Временная ошибка (сеть, 429, 4xx
 * SMTP) пробрасывается — outbox повторит событие, отправленные письма при
 * этом второй раз не уйдут. Постоянная (адрес отвергнут, бот заблокирован)
 * помечает доставку failed; заблокированный бот ещё и снимает привязку
 * чата, чтобы следующие новости туда не пытались уйти.
 */
@Injectable()
export class NotificationDeliveriesQueuedHandler implements EventHandler {
  private readonly logger = new Logger(NotificationDeliveriesQueuedHandler.name);

  constructor(
    private readonly deliveries: NotificationDeliveryRepository,
    private readonly settings: NotificationSettingsRepository,
    private readonly mailer: MailerService,
    private readonly telegram: TelegramBotClient,
    private readonly config: ConfigService,
  ) {}

  async handle(event: OutboxEventDocument): Promise<void> {
    const payload = event.payload as unknown as NotificationDeliveriesQueuedPayload;
    const refId = new Types.ObjectId(payload.refId);
    const channels = readNotificationChannels((key) => this.config.get<string>(key));
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (;;) {
      const batch = await this.deliveries.listPending(payload.kind, refId, BATCH_SIZE);
      if (batch.length === 0) break;
      for (const delivery of batch) {
        const outcome = await this.deliver(delivery, channels);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'failed') failed += 1;
        else skipped += 1;
      }
    }

    this.logger.log(`Рассылка ${payload.kind} ${payload.refId}: отправлено ${sent}, ошибок ${failed}, пропущено ${skipped}.`);
  }

  private async deliver(
    delivery: NotificationDeliveryDocument,
    channels: { email: boolean; telegram: boolean },
  ): Promise<'sent' | 'failed' | 'skipped'> {
    if (delivery.channel === 'email') {
      if (!channels.email) {
        await this.deliveries.markSkipped(delivery._id, 'Почта не настроена на сервере');
        return 'skipped';
      }
      try {
        await this.mailer.send({ to: delivery.address, subject: delivery.subject, text: delivery.text });
      } catch (error) {
        if (error instanceof PermanentMailError) {
          await this.deliveries.markFailed(delivery._id, error.message);
          return 'failed';
        }
        throw error;
      }
      await this.deliveries.markSent(delivery._id);
      return 'sent';
    }

    if (!channels.telegram) {
      await this.deliveries.markSkipped(delivery._id, 'Бот уведомлений не настроен на сервере');
      return 'skipped';
    }
    try {
      await this.telegram.sendMessage(this.config.getOrThrow<string>('TELEGRAM_NOTIFY_BOT_TOKEN'), delivery.address, delivery.text);
    } catch (error) {
      if (error instanceof TelegramApiError && error.permanent) {
        await this.deliveries.markFailed(delivery._id, error.message);
        if (error.errorCode === 403 || error.errorCode === 400) {
          await this.settings.unlinkTelegramChat(delivery.address);
        }
        return 'failed';
      }
      throw error;
    }
    await this.deliveries.markSent(delivery._id);
    return 'sent';
  }
}
