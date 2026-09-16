import { Types } from 'mongoose';
import { hashLinkCode, type NotificationDeliveryRepository, type NotificationSettingsRepository, type TelegramLinkCodeRepository } from '@baza/notifications';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../identity/auth.service';
import type { OutboxService } from '../outbox/outbox.service';
import { NotificationsService } from './notifications.service';

const FULL_ENV: Record<string, string> = {
  SMTP_HOST: 'smtp.example.ge',
  MAIL_FROM: 'BAZA <news@baza.sale>',
  TELEGRAM_NOTIFY_BOT_TOKEN: '123:abc',
  TELEGRAM_NOTIFY_BOT_USERNAME: '@baza_notify_bot',
  ERP_PUBLIC_URL: 'https://erp.baza.sale/',
};

function makeService(overrides: {
  env?: Record<string, string>;
  identities?: Array<{ id: Types.ObjectId; normalizedLogin: string; status: string }>;
  settings?: Array<Record<string, unknown>>;
} = {}) {
  const env = overrides.env ?? FULL_ENV;
  const settingsRepo = {
    findByIdentity: jest.fn().mockResolvedValue(null),
    findByIdentityIds: jest.fn().mockResolvedValue(overrides.settings ?? []),
    updatePreferences: jest.fn().mockResolvedValue(undefined),
    unlinkTelegram: jest.fn().mockResolvedValue(undefined),
  };
  const linkCodes = { replaceForIdentity: jest.fn().mockResolvedValue(undefined) };
  const deliveries = { queue: jest.fn().mockResolvedValue(0), statsByRefIds: jest.fn().mockResolvedValue(new Map()) };
  const publish = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationsService(
    settingsRepo as unknown as NotificationSettingsRepository,
    linkCodes as unknown as TelegramLinkCodeRepository,
    deliveries as unknown as NotificationDeliveryRepository,
    { findByIds: jest.fn().mockResolvedValue(overrides.identities ?? []) } as unknown as AuthService,
    { publish } as unknown as OutboxService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
  );
  return { service, settingsRepo, linkCodes, deliveries, publish };
}

const message = { subject: 'BAZA: Новость', emailText: 'полный текст', telegramText: 'анонс' };
const session = {} as never;

describe('NotificationsService.queueNewsDeliveries', () => {
  it('письмо — тем, у кого логин является адресом и почта не выключена; Telegram — тем, кто привязал бота', async () => {
    const withEmail = new Types.ObjectId();
    const noEmailLogin = new Types.ObjectId();
    const emailOff = new Types.ObjectId();
    const telegramLinked = new Types.ObjectId();
    const deactivated = new Types.ObjectId();
    const newsId = new Types.ObjectId();
    const { service, deliveries, publish } = makeService({
      identities: [
        { id: withEmail, normalizedLogin: 'agent@agency.ge', status: 'active' },
        { id: noEmailLogin, normalizedLogin: 'demo-agent', status: 'active' },
        { id: emailOff, normalizedLogin: 'quiet@agency.ge', status: 'active' },
        { id: telegramLinked, normalizedLogin: 'tg-user', status: 'active' },
        { id: deactivated, normalizedLogin: 'gone@agency.ge', status: 'deactivated' },
      ],
      settings: [
        { identityId: emailOff, newsEmail: false, newsTelegram: true },
        { identityId: telegramLinked, newsEmail: true, newsTelegram: true, telegramChatId: '555' },
      ],
    });

    const queued = await service.queueNewsDeliveries(
      {
        newsId,
        recipientIdentityIds: [withEmail, noEmailLogin, emailOff, telegramLinked, deactivated],
        channels: { email: true, telegram: true },
        message,
      },
      session,
    );

    expect(queued).toEqual({ email: 1, telegram: 1 });
    const rows = deliveries.queue.mock.calls[0]![0] as Array<{ channel: string; address: string; text: string }>;
    expect(rows.map((row) => [row.channel, row.address, row.text])).toEqual([
      ['email', 'agent@agency.ge', 'полный текст'],
      ['telegram', '555', 'анонс'],
    ]);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'NotificationDeliveriesQueued', aggregateId: newsId, payload: { kind: 'news', refId: newsId.toString() } }),
      session,
    );
  });

  it('канал не настроен на сервере — в очередь не ставится, событие не публикуется', async () => {
    const recipient = new Types.ObjectId();
    const { service, deliveries, publish } = makeService({
      env: {},
      identities: [{ id: recipient, normalizedLogin: 'agent@agency.ge', status: 'active' }],
    });

    const queued = await service.queueNewsDeliveries(
      { newsId: new Types.ObjectId(), recipientIdentityIds: [recipient], channels: { email: true, telegram: true }, message },
      session,
    );

    expect(queued).toEqual({ email: 0, telegram: 0 });
    expect(deliveries.queue).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('NotificationsService — Telegram и настройки', () => {
  it('ссылка привязки: t.me/<бот>?start=<код>, в базе — хеш кода', async () => {
    const identityId = new Types.ObjectId();
    const { service, linkCodes } = makeService();

    const link = await service.createTelegramLink(identityId);

    const code = link.url.replace('https://t.me/baza_notify_bot?start=', '');
    expect(link.url.startsWith('https://t.me/baza_notify_bot?start=')).toBe(true);
    expect(linkCodes.replaceForIdentity).toHaveBeenCalledWith(identityId, hashLinkCode(code), expect.any(Date));
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('без бота уведомлений ссылку не выдать — NOTIFICATION_CHANNEL_NOT_CONFIGURED', async () => {
    const { service } = makeService({ env: {} });
    await expect(service.createTelegramLink(new Types.ObjectId())).rejects.toMatchObject({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURED' });
  });

  it('настройки по умолчанию: всё включено, адрес — из логина, ссылка на ленту — из ERP_PUBLIC_URL', async () => {
    const identityId = new Types.ObjectId();
    const { service } = makeService({ identities: [{ id: identityId, normalizedLogin: 'owner@agency.ge', status: 'active' }] });

    expect(await service.getSettings(identityId)).toEqual({
      email: { address: 'owner@agency.ge', news: true, configured: true },
      telegram: { linked: false, username: null, news: true, configured: true },
    });
    expect(service.newsFeedUrl()).toBe('https://erp.baza.sale/#/dashboard/settings/info/news');
  });
});
