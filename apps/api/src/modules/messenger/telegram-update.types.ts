/**
 * N-12: узкий срез Telegram Bot API `Update` — только то, что реально
 * читается (`message.text`). Полная схема Telegram-объекта во много раз
 * больше (edited_message, channel_post, callback_query, ...); остальные
 * типы апдейтов сервис намеренно игнорирует (см. MessengerService
 * .handleTelegramUpdate) — не расширяем тип полями, которые никто не читает.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number | string; type: string };
  from?: { id: number; is_bot: boolean; first_name: string; last_name?: string; username?: string };
  text?: string;
}
