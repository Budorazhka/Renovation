import { emailFromLogin, readNotificationChannels } from './channels';
import { generateLinkCode, hashLinkCode } from './link-code';
import { formatNewsMessage } from './news-message';

describe('каналы рассылки', () => {
  it('почта — только с SMTP_HOST и MAIL_FROM, Telegram — только с токеном и именем бота', () => {
    const env = (values: Record<string, string>) => (key: string) => values[key];

    expect(readNotificationChannels(env({}))).toEqual({ email: false, telegram: false });
    expect(readNotificationChannels(env({ SMTP_HOST: 'smtp.example.ge' }))).toEqual({ email: false, telegram: false });
    expect(
      readNotificationChannels(
        env({
          SMTP_HOST: 'smtp.example.ge',
          MAIL_FROM: 'BAZA <news@baza.sale>',
          TELEGRAM_NOTIFY_BOT_TOKEN: '123:abc',
          TELEGRAM_NOTIFY_BOT_USERNAME: 'baza_notify_bot',
        }),
      ),
    ).toEqual({ email: true, telegram: true });
  });

  it('адрес почты берётся из логина, только если логин — адрес', () => {
    expect(emailFromLogin('owner@agency.ge')).toBe('owner@agency.ge');
    expect(emailFromLogin('demo-owner-check')).toBeNull();
    expect(emailFromLogin(undefined)).toBeNull();
  });
});

describe('код привязки Telegram', () => {
  it('код подходит для start-параметра Telegram, в базе — только хеш', () => {
    const code = generateLinkCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(hashLinkCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkCode(code)).toBe(hashLinkCode(code));
    expect(generateLinkCode()).not.toBe(code);
  });
});

describe('текст новости для письма и Telegram', () => {
  it('письмо — целиком, Telegram — анонс со ссылкой в ленту', () => {
    const body = 'Очень длинный текст. '.repeat(60);
    const message = formatNewsMessage({
      title: 'Планёрка в пятницу',
      body,
      from: 'BAZA Realty',
      linkUrl: 'https://baza.sale/rules',
      linkLabel: '',
      feedUrl: 'https://erp.baza.sale/#/dashboard/settings/info/news',
    });

    expect(message.subject).toBe('BAZA Realty: Планёрка в пятницу');
    expect(message.emailText).toContain(body.trim());
    expect(message.emailText).toContain('Подробнее: https://baza.sale/rules');
    expect(message.telegramText.length).toBeLessThan(body.length);
    expect(message.telegramText).toContain('Открыть в BAZA: https://erp.baza.sale/#/dashboard/settings/info/news');
    expect(message.telegramText).not.toMatch(/\n{3,}/);
  });

  it('без ссылок — без пустых строк про ссылки', () => {
    const message = formatNewsMessage({ title: 'T', body: 'B', from: 'BAZA' });
    expect(message.emailText).toBe('T\n\nB\n\nBAZA · новости BAZA');
  });
});
