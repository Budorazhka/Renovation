import { Types } from 'mongoose';
import type { ConfigService } from '@nestjs/config';
import type { TelegramBotClient } from '@baza/messenger';
import {
  hashLinkCode,
  type NotificationSettingsRepository,
  type TelegramBotStateRepository,
  type TelegramLinkCodeRepository,
} from '@baza/notifications';
import { BOT_REPLIES, TelegramNotifyBotService } from './telegram-notify-bot.service';

function makeBot(options: { link?: { identityId: Types.ObjectId } | null; wasLinked?: boolean } = {}) {
  const client = { sendMessage: jest.fn().mockResolvedValue({ externalMessageId: '1' }), getUpdates: jest.fn(), deleteWebhook: jest.fn() };
  const linkCodes = { consume: jest.fn().mockResolvedValue(options.link ?? null) };
  const settings = {
    linkTelegram: jest.fn().mockResolvedValue(undefined),
    unlinkTelegramChat: jest.fn().mockResolvedValue(options.wasLinked ?? false),
  };
  const state = { getOffset: jest.fn().mockResolvedValue(0), saveOffset: jest.fn() };
  const bot = new TelegramNotifyBotService(
    { get: () => undefined } as unknown as ConfigService,
    client as unknown as TelegramBotClient,
    linkCodes as unknown as TelegramLinkCodeRepository,
    settings as unknown as NotificationSettingsRepository,
    state as unknown as TelegramBotStateRepository,
  );
  return { bot, client, linkCodes, settings, state };
}

const message = (text: string, chatType = 'private') => ({
  updateId: 1,
  message: { text, chatId: '555', chatType, fromUsername: 'agent' },
});

describe('TelegramNotifyBotService', () => {
  it('/start с действующим кодом привязывает чат к аккаунту из кода', async () => {
    const identityId = new Types.ObjectId();
    const { bot, client, linkCodes, settings } = makeBot({ link: { identityId } });

    await bot.handleUpdate('token', message('/start abc123'));

    expect(linkCodes.consume).toHaveBeenCalledWith(hashLinkCode('abc123'), expect.any(Date));
    expect(settings.linkTelegram).toHaveBeenCalledWith(identityId, '555', 'agent');
    expect(client.sendMessage).toHaveBeenCalledWith('token', '555', BOT_REPLIES.linked);
  });

  it('устаревший или использованный код — пояснение, привязки нет', async () => {
    const { bot, client, settings } = makeBot({ link: null });

    await bot.handleUpdate('token', message('/start old'));

    expect(settings.linkTelegram).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalledWith('token', '555', BOT_REPLIES.expired);
  });

  it('/start без кода — подсказка, где взять ссылку', async () => {
    const { bot, client, linkCodes } = makeBot();

    await bot.handleUpdate('token', message('/start'));

    expect(linkCodes.consume).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalledWith('token', '555', BOT_REPLIES.noCode);
  });

  it('/stop отвязывает чат', async () => {
    const { bot, client, settings } = makeBot({ wasLinked: true });

    await bot.handleUpdate('token', message('/stop'));

    expect(settings.unlinkTelegramChat).toHaveBeenCalledWith('555');
    expect(client.sendMessage).toHaveBeenCalledWith('token', '555', BOT_REPLIES.stopped);
  });

  it('сообщения из групп игнорируются: уведомления — только в личный чат', async () => {
    const { bot, client, linkCodes } = makeBot({ link: { identityId: new Types.ObjectId() } });

    await bot.handleUpdate('token', message('/start abc', 'group'));

    expect(linkCodes.consume).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('без токена бот не запускает опрос', () => {
    const { bot, client } = makeBot();
    bot.onApplicationBootstrap();
    expect(client.deleteWebhook).not.toHaveBeenCalled();
    expect(client.getUpdates).not.toHaveBeenCalled();
  });
});
