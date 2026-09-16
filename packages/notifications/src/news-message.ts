/** Сколько текста новости уходит в Telegram: сообщение — анонс, целиком новость читают в ERP. */
const TELEGRAM_BODY_LIMIT = 700;

export interface NewsMessageInput {
  title: string;
  body: string;
  /** Кто публикует: «BAZA» или название компании. */
  from: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  /** Адрес ленты новостей в ERP (ERP_PUBLIC_URL + маршрут), если известен. */
  feedUrl?: string | null;
}

export interface NewsMessage {
  subject: string;
  /** Текст письма целиком. */
  emailText: string;
  /** Сокращённый текст для Telegram (обычный текст, без разметки). */
  telegramText: string;
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

/**
 * Письмо и сообщение Telegram о новости. Обычный текст без HTML и
 * Markdown: заголовок новости пишет человек, разметка сломалась бы на
 * первом же символе `*` или `<`.
 */
export function formatNewsMessage(input: NewsMessageInput): NewsMessage {
  const link = input.linkUrl ? `${input.linkLabel?.trim() || 'Подробнее'}: ${input.linkUrl}` : null;
  const feed = input.feedUrl ? `Открыть в BAZA: ${input.feedUrl}` : null;

  const emailText = [input.title, '', input.body, '', link, feed, '', `${input.from} · новости BAZA`]
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const telegramText = [`📢 ${input.title}`, '', cut(input.body, TELEGRAM_BODY_LIMIT), '', link, feed, '', input.from]
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { subject: `${input.from}: ${input.title}`, emailText, telegramText };
}
