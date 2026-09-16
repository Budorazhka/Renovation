import { Types } from 'mongoose';
import type { ConfigService } from '@nestjs/config';
import type { OutboxEventDocument } from '@baza/domain-events';
import { TelegramApiError, type TelegramBotClient } from '@baza/messenger';
import type { NotificationDeliveryRepository, NotificationSettingsRepository } from '@baza/notifications';
import { NotificationDeliveriesQueuedHandler } from './notification-deliveries-queued.handler';
import { PermanentMailError, type MailerService } from './mailer.service';

const FULL_ENV: Record<string, string> = {
  SMTP_HOST: 'smtp.example.ge',
  MAIL_FROM: 'BAZA <news@baza.sale>',
  TELEGRAM_NOTIFY_BOT_TOKEN: '123:abc',
  TELEGRAM_NOTIFY_BOT_USERNAME: 'baza_notify_bot',
};

const refId = new Types.ObjectId();
const event = { payload: { kind: 'news', refId: refId.toString() } } as unknown as OutboxEventDocument;

function delivery(channel: 'email' | 'telegram', address: string) {
  return { _id: new Types.ObjectId(), channel, address, subject: 'BAZA: Новость', text: `текст для ${channel}` };
}

function makeHandler(options: { batches: unknown[][]; env?: Record<string, string>; mailer?: Partial<MailerService>; telegram?: Partial<TelegramBotClient> }) {
  const listPending = jest.fn();
  for (const batch of options.batches) listPending.mockResolvedValueOnce(batch);
  listPending.mockResolvedValue([]);
  const deliveries = {
    listPending,
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markSkipped: jest.fn().mockResolvedValue(undefined),
  };
  const settings = { unlinkTelegramChat: jest.fn().mockResolvedValue(true) };
  const mailer = { send: jest.fn().mockResolvedValue(undefined), ...options.mailer };
  const telegram = { sendMessage: jest.fn().mockResolvedValue({ externalMessageId: '1' }), ...options.telegram };
  const env = options.env ?? FULL_ENV;
  const config = { get: (key: string) => env[key], getOrThrow: (key: string) => env[key] };
  const handler = new NotificationDeliveriesQueuedHandler(
    deliveries as unknown as NotificationDeliveryRepository,
    settings as unknown as NotificationSettingsRepository,
    mailer as unknown as MailerService,
    telegram as unknown as TelegramBotClient,
    config as unknown as ConfigService,
  );
  return { handler, deliveries, settings, mailer, telegram };
}

describe('NotificationDeliveriesQueuedHandler', () => {
  it('отправляет письмо и сообщение Telegram, помечает sent', async () => {
    const email = delivery('email', 'agent@agency.ge');
    const tg = delivery('telegram', '555');
    const { handler, deliveries, mailer, telegram } = makeHandler({ batches: [[email, tg]] });

    await handler.handle(event);

    expect(deliveries.listPending).toHaveBeenCalledWith('news', refId, 50);
    expect(mailer.send).toHaveBeenCalledWith({ to: 'agent@agency.ge', subject: 'BAZA: Новость', text: 'текст для email' });
    expect(telegram.sendMessage).toHaveBeenCalledWith('123:abc', '555', 'текст для telegram');
    expect(deliveries.markSent).toHaveBeenCalledWith(email._id);
    expect(deliveries.markSent).toHaveBeenCalledWith(tg._id);
  });

  it('канал не настроен — skipped, а не вечный pending', async () => {
    const email = delivery('email', 'agent@agency.ge');
    const { handler, deliveries, mailer } = makeHandler({ batches: [[email]], env: {} });

    await handler.handle(event);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(deliveries.markSkipped).toHaveBeenCalledWith(email._id, expect.any(String));
  });

  it('адрес отвергнут сервером — failed; временная ошибка SMTP пробрасывается для повтора', async () => {
    const rejected = delivery('email', 'nobody@agency.ge');
    const permanent = makeHandler({
      batches: [[rejected]],
      mailer: { send: jest.fn().mockRejectedValue(new PermanentMailError('550 mailbox unavailable')) },
    });
    await permanent.handler.handle(event);
    expect(permanent.deliveries.markFailed).toHaveBeenCalledWith(rejected._id, '550 mailbox unavailable');

    const temporary = makeHandler({
      batches: [[delivery('email', 'agent@agency.ge')]],
      mailer: { send: jest.fn().mockRejectedValue(new Error('ECONNECTION')) },
    });
    await expect(temporary.handler.handle(event)).rejects.toThrow('ECONNECTION');
    expect(temporary.deliveries.markSent).not.toHaveBeenCalled();
  });

  it('бот заблокирован пользователем — failed и привязка чата снимается', async () => {
    const tg = delivery('telegram', '555');
    const { handler, deliveries, settings } = makeHandler({
      batches: [[tg]],
      telegram: { sendMessage: jest.fn().mockRejectedValue(new TelegramApiError('Forbidden: bot was blocked by the user', 403, true)) },
    });

    await handler.handle(event);

    expect(deliveries.markFailed).toHaveBeenCalledWith(tg._id, 'Forbidden: bot was blocked by the user');
    expect(settings.unlinkTelegramChat).toHaveBeenCalledWith('555');
  });
});
