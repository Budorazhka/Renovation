import { Injectable } from '@nestjs/common';

/**
 * N-12 (roadmap-2026-09.md): тонкий клиент к Telegram Bot API. Тот же
 * стиль, что `apps/api/src/jobs/legacy-lead-export/legacy-api-client.ts` —
 * нативный `fetch`, без добавления HTTP-библиотеки: единственный такой
 * прецедент в кодовой базе (media-storage — AWS SDK, не общий HTTP).
 *
 * Живёт в `@baza/messenger` (не в `apps/api`), потому что и API-процесс
 * (подключение бота — `getMe`/`setWebhook`), и worker-процесс (реальная
 * отправка — `sendMessage`) вызывают ОДИН и тот же внешний API — тот же
 * module-boundary принцип, что схемы/репозитории этого пакета.
 *
 * Токен передаётся per-call, не хранится в клиенте: у каждого
 * MessengerAccountDocument свой botToken, клиент — stateless.
 */
export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode?: number,
    /**
     * Грубая эвристика "не будет дозакрыто повтором": Telegram отвечает
     * 400 (bad request — например неверный chat_id) и 403 (бот заблокирован
     * пользователем/кикнут из чата) детерминированно для любого будущего
     * повтора с тем же аргументом. 401 — токен отозван/невалиден, тоже
     * постоянно. 429 (rate limit) и 5xx — временные, outbox должен
     * повторить с задержкой, не сразу считать сообщение недоставленным.
     */
    readonly permanent = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export interface TelegramGetMeResult {
  id: number;
  isBot: boolean;
  username?: string;
  firstName: string;
}

export interface TelegramSendMessageResult {
  externalMessageId: string;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

const API_BASE = 'https://api.telegram.org';

function isPermanentErrorCode(errorCode: number | undefined): boolean {
  // 429 (rate limit) и 5xx (провайдер временно недоступен) — единственные
  // коды, для которых имеет смысл ждать и повторить; всё остальное в
  // диапазоне 4xx (400/401/403/404 — неверный запрос, отозванный токен,
  // бот заблокирован, чат не существует) не изменится от повторной попытки
  // с теми же аргументами.
  if (errorCode === undefined) return false;
  return errorCode !== 429 && errorCode < 500;
}

@Injectable()
export class TelegramBotClient {
  /**
   * Единственная точка сетевого вызова. Ретраит ТОЛЬКО сетевые сбои
   * (fetch бросил — обрыв соединения, DNS и т.п.), не ответы самого
   * Telegram: у них есть собственная семантика success/failure
   * (`ok: false` + `error_code`), которую обязан разобрать вызывающий код
   * этого клиента (worker-хендлер — постоянная ошибка -> `markFailed`,
   * временная -> пробросить дальше для retry самого outbox).
   */
  private async call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${API_BASE}/bot${token}/${method}`;
    const maxNetworkAttempts = 2;
    let response: Response | undefined;

    for (let attempt = 1; attempt <= maxNetworkAttempts; attempt += 1) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        break;
      } catch (error) {
        if (attempt >= maxNetworkAttempts) {
          throw new TelegramApiError(
            `Telegram ${method}: сетевой сбой — ${(error as Error).message}`,
            undefined,
            false,
          );
        }
        await sleep(300 * attempt);
      }
    }

    const envelope = (await response!.json().catch(() => null)) as TelegramEnvelope<T> | null;
    if (!envelope) {
      throw new TelegramApiError(`Telegram ${method}: ответ не JSON (HTTP ${response!.status})`, response!.status);
    }
    if (!envelope.ok) {
      throw new TelegramApiError(
        `Telegram ${method}: ${envelope.description ?? `HTTP ${response!.status}`}`,
        envelope.error_code ?? response!.status,
        isPermanentErrorCode(envelope.error_code ?? response!.status),
        envelope.parameters?.retry_after,
      );
    }
    return envelope.result as T;
  }

  /** Подключение бота: проверяет токен у самого Telegram, до сохранения аккаунта. */
  async getMe(token: string): Promise<TelegramGetMeResult> {
    const result = await this.call<{ id: number; is_bot: boolean; username?: string; first_name: string }>(
      token,
      'getMe',
      {},
    );
    return { id: result.id, isBot: result.is_bot, username: result.username, firstName: result.first_name };
  }

  /**
   * `secretToken` — Telegram присылает его обратно в заголовке
   * `X-Telegram-Bot-Api-Secret-Token` на каждом апдейте; единственная
   * проверка подлинности вебхука на нашей стороне (см. докстринг
   * MessengerAccountDocument.webhookSecret).
   */
  async setWebhook(token: string, url: string, secretToken: string): Promise<void> {
    await this.call<true>(token, 'setWebhook', { url, secret_token: secretToken });
  }

  async deleteWebhook(token: string): Promise<void> {
    await this.call<true>(token, 'deleteWebhook', {});
  }

  async sendMessage(token: string, chatId: string, text: string): Promise<TelegramSendMessageResult> {
    const result = await this.call<{ message_id: number }>(token, 'sendMessage', { chat_id: chatId, text });
    return { externalMessageId: result.message_id.toString() };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
