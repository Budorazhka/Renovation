import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { OutboxEventDocument } from '@baza/domain-events';
import {
  MessengerAccountRepository,
  MessengerMessageRepository,
  TelegramBotClient,
  TelegramApiError,
  type MessengerPlatform,
} from '@baza/messenger';
import type { EventHandler } from '../outbox/event-handler';

/**
 * MessengerMessageSent payload — точная структура, публикуемая
 * apps/api/src/modules/messenger/messenger.service.ts (sendTextMessage/
 * sendMediaMessage), тот же принцип, что MediaVerifiedHandler.
 */
interface MessengerMessageSentPayload {
  dialogId: string;
  messageId: string;
  accountId: string;
  platform: MessengerPlatform;
  externalChatId: string;
  text: string;
}

/**
 * N-12 (roadmap-2026-09.md): реальная отправка исходящего сообщения через
 * Telegram Bot API. До этого хендлера `MessengerMessageSent` состоял в
 * ACKNOWLEDGED_ONLY_EVENT_TYPES — сообщение навсегда оставалось `queued`
 * (messenger-skeleton.md, открытый пункт 1).
 *
 * ADR-006 идемпотентность: `status: 'queued'` проверяется ДО отправки —
 * at-least-once доставка outbox может вызвать handle() повторно для уже
 * отправленного сообщения (после сбоя между markSent и коммитом получения
 * события); повторный вызов на уже `sent`/`failed` сообщении просто
 * ничего не делает, не шлёт тот же текст в Telegram второй раз.
 */
@Injectable()
export class MessengerMessageSentHandler implements EventHandler {
  private readonly logger = new Logger(MessengerMessageSentHandler.name);

  constructor(
    private readonly messageRepository: MessengerMessageRepository,
    private readonly accountRepository: MessengerAccountRepository,
    private readonly telegramBotClient: TelegramBotClient,
  ) {}

  async handle(event: OutboxEventDocument): Promise<void> {
    const payload = event.payload as unknown as MessengerMessageSentPayload;
    const messageId = new Types.ObjectId(payload.messageId);

    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      this.logger.warn(`MessengerMessageSent: сообщение ${payload.messageId} не найдено.`);
      return;
    }
    if (message.status !== 'queued') {
      this.logger.log(
        `MessengerMessageSent: сообщение ${payload.messageId} уже в статусе ${message.status} (replay события) — пропускаю повторную отправку.`,
      );
      return;
    }

    // WhatsApp пока не поддержан вообще (messenger-skeleton.md) — честный
    // терминальный статус вместо вечного `queued`, тот же принцип "honest
    // status", что уже применён к authStatus аккаунта.
    if (payload.platform !== 'telegram') {
      this.logger.warn(
        `MessengerMessageSent: платформа ${payload.platform} пока не поддержана — сообщение ${payload.messageId} помечено failed.`,
      );
      await this.messageRepository.markFailed(messageId);
      return;
    }

    const account = await this.accountRepository.findByIdWithToken(new Types.ObjectId(payload.accountId));
    if (!account) {
      this.logger.warn(
        `MessengerMessageSent: аккаунт ${payload.accountId} не найден — сообщение ${payload.messageId} помечено failed.`,
      );
      await this.messageRepository.markFailed(messageId);
      return;
    }

    try {
      const result = await this.telegramBotClient.sendMessage(account.botToken!, payload.externalChatId, payload.text);
      await this.messageRepository.markSent(messageId, result.externalMessageId);
      this.logger.log(`MessengerMessageSent: сообщение ${payload.messageId} отправлено (externalMessageId=${result.externalMessageId}).`);
    } catch (error) {
      if (error instanceof TelegramApiError && error.permanent) {
        this.logger.warn(`MessengerMessageSent: постоянная ошибка Telegram для сообщения ${payload.messageId}: ${error.message}`);
        await this.messageRepository.markFailed(messageId);
        return;
      }
      // Временная ошибка (сеть, 429, 5xx) — пробрасываем дальше, чтобы outbox
      // повторил доставку с задержкой (ADR-006), сообщение остаётся `queued`.
      throw error;
    }
  }
}
