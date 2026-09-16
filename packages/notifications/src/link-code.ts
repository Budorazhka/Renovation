import { createHash, randomBytes } from 'node:crypto';

/** Сколько живёт ссылка привязки Telegram: достаточно, чтобы открыть Telegram и нажать «Старт». */
export const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Код для `t.me/<бот>?start=<код>`: 128 бит случайности в base64url —
 * Telegram пропускает в start-параметре только [A-Za-z0-9_-] до 64 символов.
 */
export function generateLinkCode(): string {
  return randomBytes(16).toString('base64url');
}

/** В базе хранится только хеш: предъявить код может лишь тот, кому ERP показал ссылку. */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
