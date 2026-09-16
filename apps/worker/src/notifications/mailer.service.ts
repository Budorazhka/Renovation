import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { readNotificationChannels } from '@baza/notifications';

/**
 * Ошибка SMTP, которую повтор не исправит: сервер отверг адрес или письмо
 * (ответ 5xx) либо адрес некорректен. Временные (4xx, обрыв соединения,
 * таймаут) пробрасываются как есть — outbox повторит доставку.
 */
export class PermanentMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMailError';
  }
}

function isPermanent(error: unknown): boolean {
  const smtp = error as { responseCode?: number; code?: string };
  return (typeof smtp.responseCode === 'number' && smtp.responseCode >= 500) || smtp.code === 'EENVELOPE';
}

/**
 * Отправка писем через SMTP (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
 * SMTP_PASSWORD, MAIL_FROM). Без SMTP_HOST/MAIL_FROM канал считается не
 * настроенным — доставки помечаются skipped, а не висят в очереди.
 */
@Injectable()
export class MailerService {
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return readNotificationChannels((key) => this.config.get<string>(key)).email;
  }

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    try {
      await this.getTransporter().sendMail({
        from: this.config.getOrThrow<string>('MAIL_FROM'),
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      if (isPermanent(error)) {
        throw new PermanentMailError((error as Error).message);
      }
      throw error;
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const user = this.config.get<string>('SMTP_USER')?.trim();
      this.transporter = createTransport({
        host: this.config.getOrThrow<string>('SMTP_HOST'),
        port,
        secure: (this.config.get<string>('SMTP_SECURE') ?? (port === 465 ? 'true' : 'false')) === 'true',
        auth: user ? { user, pass: this.config.get<string>('SMTP_PASSWORD') ?? '' } : undefined,
      });
    }
    return this.transporter;
  }
}
