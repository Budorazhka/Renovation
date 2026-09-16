import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBotClient, type TelegramIncomingUpdate } from '@baza/messenger';
import {
  NotificationSettingsRepository,
  TelegramBotStateRepository,
  TelegramLinkCodeRepository,
  hashLinkCode,
  readNotificationChannels,
} from '@baza/notifications';

const STATE_KEY = 'notify';
const POLL_TIMEOUT_SECONDS = 25;
const RETRY_DELAY_MS = 5000;

export const BOT_REPLIES = {
  linked: 'Готово: сюда будут приходить новости BAZA. Отключить можно командой /stop или в ERP: Профиль → Уведомления.',
  expired: 'Ссылка устарела или уже использована. Откройте в ERP «Профиль → Уведомления» и нажмите «Подключить Telegram» ещё раз.',
  noCode: 'Чтобы получать новости BAZA, откройте в ERP «Профиль → Уведомления» и нажмите «Подключить Telegram».',
  stopped: 'Уведомления отключены. Подключить снова можно в ERP: Профиль → Уведомления.',
  notLinked: 'Этот чат не подключён к уведомлениям BAZA.',
  help: 'Это бот уведомлений BAZA. Команды: /stop — отключить уведомления.',
} as const;

/**
 * Бот уведомлений платформы: привязывает чат сотрудника к его аккаунту по
 * `/start <код>` (ссылка из ERP) и отвязывает по `/stop`. Long polling, а
 * не вебхук: боту не нужен публичный адрес, он работает и на стенде.
 * Запускается только при настроенных TELEGRAM_NOTIFY_BOT_TOKEN и
 * TELEGRAM_NOTIFY_BOT_USERNAME. Один worker — один опрос: Telegram не
 * разрешает два параллельных getUpdates одного бота (409).
 */
@Injectable()
export class TelegramNotifyBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramNotifyBotService.name);
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly client: TelegramBotClient,
    private readonly linkCodes: TelegramLinkCodeRepository,
    private readonly settings: NotificationSettingsRepository,
    private readonly state: TelegramBotStateRepository,
  ) {}

  onApplicationBootstrap(): void {
    if (!readNotificationChannels((key) => this.config.get<string>(key)).telegram) {
      this.logger.log('Бот уведомлений не настроен (TELEGRAM_NOTIFY_BOT_TOKEN/USERNAME) — опрос не запущен.');
      return;
    }
    void this.run();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  private async run(): Promise<void> {
    const token = this.config.getOrThrow<string>('TELEGRAM_NOTIFY_BOT_TOKEN');
    // getUpdates не работает, пока у бота установлен вебхук.
    await this.client.deleteWebhook(token).catch((error: unknown) => {
      this.logger.warn(`Бот уведомлений: deleteWebhook не удался — ${(error as Error).message}`);
    });
    let offset = await this.state.getOffset(STATE_KEY);
    this.logger.log(`Бот уведомлений: опрос запущен с offset ${offset}.`);

    while (!this.stopped) {
      try {
        const updates = await this.client.getUpdates(token, offset, POLL_TIMEOUT_SECONDS);
        for (const update of updates) {
          await this.handleUpdate(token, update);
          offset = update.updateId + 1;
          await this.state.saveOffset(STATE_KEY, offset);
        }
      } catch (error) {
        this.logger.warn(`Бот уведомлений: сбой опроса — ${(error as Error).message}. Повтор через ${RETRY_DELAY_MS / 1000} с.`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  /** Разбор одного сообщения; открыт для тестов. */
  async handleUpdate(token: string, update: TelegramIncomingUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text || message.chatType !== 'private') return;
    const text = message.text.trim();
    const reply = (body: string) => this.client.sendMessage(token, message.chatId, body);

    if (text === '/start' || text.startsWith('/start ')) {
      const code = text.slice('/start'.length).trim();
      if (!code) {
        await reply(BOT_REPLIES.noCode);
        return;
      }
      const link = await this.linkCodes.consume(hashLinkCode(code), new Date());
      if (!link) {
        await reply(BOT_REPLIES.expired);
        return;
      }
      await this.settings.linkTelegram(link.identityId, message.chatId, message.fromUsername);
      await reply(BOT_REPLIES.linked);
      return;
    }

    if (text === '/stop') {
      const wasLinked = await this.settings.unlinkTelegramChat(message.chatId);
      await reply(wasLinked ? BOT_REPLIES.stopped : BOT_REPLIES.notLinked);
      return;
    }

    await reply(BOT_REPLIES.help);
  }
}
