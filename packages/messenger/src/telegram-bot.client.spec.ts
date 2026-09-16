import { TelegramApiError, TelegramBotClient } from './telegram-bot.client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('TelegramBotClient', () => {
  const token = '12345:test-token';
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getMe возвращает распарсенные поля бота при успешном ответе', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, result: { id: 1, is_bot: true, username: 'sales_bot', first_name: 'Sales' } }),
    );
    const client = new TelegramBotClient();

    const result = await client.getMe(token);

    expect(result).toEqual({ id: 1, isBot: true, username: 'sales_bot', firstName: 'Sales' });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${token}/getMe`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('невалидный токен (401) — TelegramApiError с permanent:true, без retry сети', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { ok: false, error_code: 401, description: 'Unauthorized' }));
    const client = new TelegramBotClient();

    await expect(client.getMe(token)).rejects.toMatchObject({
      name: 'TelegramApiError',
      errorCode: 401,
      permanent: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rate limit (429) — TelegramApiError с permanent:false и retryAfterSeconds из ответа', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 5 } }),
    );
    const client = new TelegramBotClient();

    await expect(client.sendMessage(token, '123', 'привет')).rejects.toMatchObject({
      errorCode: 429,
      permanent: false,
      retryAfterSeconds: 5,
    });
  });

  it('chat не найден (400) — permanent:true', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
    const client = new TelegramBotClient();

    await expect(client.sendMessage(token, 'ghost-chat', 'привет')).rejects.toMatchObject({
      errorCode: 400,
      permanent: true,
    });
  });

  it('sendMessage успешно возвращает externalMessageId строкой', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 42 } }));
    const client = new TelegramBotClient();

    const result = await client.sendMessage(token, '123', 'привет');

    expect(result).toEqual({ externalMessageId: '42' });
  });

  it('сетевой сбой ретраится один раз, затем бросает TelegramApiError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 7 } }));
    const client = new TelegramBotClient();

    const result = await client.sendMessage(token, '123', 'привет');

    expect(result).toEqual({ externalMessageId: '7' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сетевой сбой на все попытки — TelegramApiError без permanent', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const client = new TelegramBotClient();

    await expect(client.sendMessage(token, '123', 'привет')).rejects.toBeInstanceOf(TelegramApiError);
  });

  it('getUpdates передаёт offset и timeout, разбирает текст, чат и автора', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        result: [
          { update_id: 10, message: { text: '/start abc', chat: { id: 555, type: 'private' }, from: { username: 'agent' } } },
          { update_id: 11 },
        ],
      }),
    );
    const client = new TelegramBotClient();

    const updates = await client.getUpdates(token, 10, 25);

    expect(updates).toEqual([
      { updateId: 10, message: { text: '/start abc', chatId: '555', chatType: 'private', fromUsername: 'agent' } },
      { updateId: 11, message: undefined },
    ]);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${token}/getUpdates`);
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ offset: 10, timeout: 25, allowed_updates: ['message'] });
  });

  it('setWebhook отправляет url и secret_token в теле запроса', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, result: true }));
    const client = new TelegramBotClient();

    await client.setWebhook(token, 'https://api.baza.sale/api/v1/public/messenger/telegram/abc', 'secret-value');

    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      url: 'https://api.baza.sale/api/v1/public/messenger/telegram/abc',
      secret_token: 'secret-value',
    });
  });
});
