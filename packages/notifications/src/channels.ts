/**
 * Какие каналы рассылки настроены на сервере. Читается одинаково API
 * (показать в ERP, можно ли отправить на почту/в Telegram, выдать ссылку
 * привязки) и worker'ом (отправить или честно пометить skipped).
 *
 * Почта — SMTP_HOST и MAIL_FROM; Telegram — токен и имя бота уведомлений
 * (TELEGRAM_NOTIFY_BOT_TOKEN, TELEGRAM_NOTIFY_BOT_USERNAME). Это отдельный
 * бот платформы, не боты организаций из модуля messenger.
 */
export interface NotificationChannels {
  email: boolean;
  telegram: boolean;
}

export type EnvReader = (key: string) => string | undefined;

export function readNotificationChannels(env: EnvReader): NotificationChannels {
  return {
    email: !!env('SMTP_HOST')?.trim() && !!env('MAIL_FROM')?.trim(),
    telegram: !!env('TELEGRAM_NOTIFY_BOT_TOKEN')?.trim() && !!env('TELEGRAM_NOTIFY_BOT_USERNAME')?.trim(),
  };
}

/** Логин identity годится как адрес почты, только если это адрес. */
export function emailFromLogin(login: string | undefined): string | null {
  if (!login) return null;
  const value = login.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
