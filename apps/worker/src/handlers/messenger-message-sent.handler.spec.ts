import { Types } from 'mongoose';
import { MessengerMessageSentHandler } from './messenger-message-sent.handler';
import type { OutboxEventDocument } from '@baza/domain-events';
import type { MessengerAccountRepository, MessengerMessageRepository } from '@baza/messenger';
import { TelegramApiError } from '@baza/messenger';

describe('MessengerMessageSentHandler', () => {
  function buildEvent(overrides: Partial<{ messageId: Types.ObjectId; accountId: Types.ObjectId; platform: string; externalChatId: string; text: string }> = {}) {
    return {
      aggregateId: overrides.messageId ?? new Types.ObjectId(),
      payload: {
        dialogId: new Types.ObjectId().toString(),
        messageId: (overrides.messageId ?? new Types.ObjectId()).toString(),
        accountId: (overrides.accountId ?? new Types.ObjectId()).toString(),
        platform: overrides.platform ?? 'telegram',
        externalChatId: overrides.externalChatId ?? '555',
        text: overrides.text ?? 'Здравствуйте!',
      },
    } as unknown as OutboxEventDocument;
  }

  it('сообщение не найдено — выходит без ошибки, ничего не вызывает', async () => {
    const messageRepository = { findById: jest.fn().mockResolvedValue(null), markFailed: jest.fn(), markSent: jest.fn() };
    const accountRepository = { findByIdWithToken: jest.fn() };
    const telegramBotClient = { sendMessage: jest.fn() };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await handler.handle(buildEvent());

    expect(accountRepository.findByIdWithToken).not.toHaveBeenCalled();
    expect(telegramBotClient.sendMessage).not.toHaveBeenCalled();
  });

  it('сообщение уже sent (replay события) — не отправляет повторно', async () => {
    const messageId = new Types.ObjectId();
    const messageRepository = {
      findById: jest.fn().mockResolvedValue({ _id: messageId, status: 'sent' }),
      markFailed: jest.fn(),
      markSent: jest.fn(),
    };
    const accountRepository = { findByIdWithToken: jest.fn() };
    const telegramBotClient = { sendMessage: jest.fn() };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await handler.handle(buildEvent({ messageId }));

    expect(telegramBotClient.sendMessage).not.toHaveBeenCalled();
  });

  it('platform whatsapp — не поддержана, сообщение сразу помечается failed', async () => {
    const messageId = new Types.ObjectId();
    const messageRepository = {
      findById: jest.fn().mockResolvedValue({ _id: messageId, status: 'queued' }),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markSent: jest.fn(),
    };
    const accountRepository = { findByIdWithToken: jest.fn() };
    const telegramBotClient = { sendMessage: jest.fn() };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await handler.handle(buildEvent({ messageId, platform: 'whatsapp' }));

    expect(messageRepository.markFailed).toHaveBeenCalledWith(messageId);
    expect(accountRepository.findByIdWithToken).not.toHaveBeenCalled();
    expect(telegramBotClient.sendMessage).not.toHaveBeenCalled();
  });

  it('аккаунт не найден — сообщение помечается failed', async () => {
    const messageId = new Types.ObjectId();
    const messageRepository = {
      findById: jest.fn().mockResolvedValue({ _id: messageId, status: 'queued' }),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markSent: jest.fn(),
    };
    const accountRepository = { findByIdWithToken: jest.fn().mockResolvedValue(null) };
    const telegramBotClient = { sendMessage: jest.fn() };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await handler.handle(buildEvent({ messageId }));

    expect(messageRepository.markFailed).toHaveBeenCalledWith(messageId);
    expect(telegramBotClient.sendMessage).not.toHaveBeenCalled();
  });

  it('успешная отправка — сообщение помечается sent с externalMessageId', async () => {
    const messageId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const messageRepository = {
      findById: jest.fn().mockResolvedValue({ _id: messageId, status: 'queued' }),
      markFailed: jest.fn(),
      markSent: jest.fn().mockResolvedValue(undefined),
    };
    const accountRepository = {
      findByIdWithToken: jest.fn().mockResolvedValue({ _id: accountId, botToken: '12345:token' }),
    };
    const telegramBotClient = { sendMessage: jest.fn().mockResolvedValue({ externalMessageId: '999' }) };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await handler.handle(buildEvent({ messageId, accountId, externalChatId: '555', text: 'Привет' }));

    expect(telegramBotClient.sendMessage).toHaveBeenCalledWith('12345:token', '555', 'Привет');
    expect(messageRepository.markSent).toHaveBeenCalledWith(messageId, '999');
    expect(messageRepository.markFailed).not.toHaveBeenCalled();
  });

  it('постоянная ошибка Telegram (permanent) — сообщение помечается failed, не бросает', async () => {
    const messageId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const messageRepository = {
      findById: jest.fn().mockResolvedValue({ _id: messageId, status: 'queued' }),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markSent: jest.fn(),
    };
    const accountRepository = {
      findByIdWithToken: jest.fn().mockResolvedValue({ _id: accountId, botToken: '12345:token' }),
    };
    const telegramBotClient = {
      sendMessage: jest.fn().mockRejectedValue(new TelegramApiError('Forbidden: bot was blocked', 403, true)),
    };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await handler.handle(buildEvent({ messageId, accountId }));

    expect(messageRepository.markFailed).toHaveBeenCalledWith(messageId);
    expect(messageRepository.markSent).not.toHaveBeenCalled();
  });

  it('временная ошибка Telegram (429/5xx) — пробрасывается дальше для retry outbox, сообщение остаётся queued', async () => {
    const messageId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const messageRepository = {
      findById: jest.fn().mockResolvedValue({ _id: messageId, status: 'queued' }),
      markFailed: jest.fn(),
      markSent: jest.fn(),
    };
    const accountRepository = {
      findByIdWithToken: jest.fn().mockResolvedValue({ _id: accountId, botToken: '12345:token' }),
    };
    const telegramBotClient = {
      sendMessage: jest.fn().mockRejectedValue(new TelegramApiError('Too Many Requests', 429, false, 5)),
    };

    const handler = new MessengerMessageSentHandler(
      messageRepository as unknown as MessengerMessageRepository,
      accountRepository as unknown as MessengerAccountRepository,
      telegramBotClient as never,
    );

    await expect(handler.handle(buildEvent({ messageId, accountId }))).rejects.toThrow(TelegramApiError);

    expect(messageRepository.markFailed).not.toHaveBeenCalled();
    expect(messageRepository.markSent).not.toHaveBeenCalled();
  });
});
