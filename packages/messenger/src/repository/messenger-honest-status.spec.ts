import { Types } from 'mongoose';
import { MessengerAccountRepository } from './messenger-account.repository';
import { MessengerMessageRepository } from './messenger-message.repository';

/**
 * 11.09.2026: транспорта в мессенджер не было (этап 10 не начат), поэтому
 * репозитории не должны сами объявлять аккаунт подключённым, а исходящее —
 * отправленным. Раньше create ставил 'authenticated' + lastSyncAt и 'sent'.
 * N-12 (13.09.2026): реальная верификация/отправка появилась, но именно
 * поэтому статус теперь обязана ставить верифицирующая/отправляющая сторона
 * (MessengerService.addTelegramBot после getMe, MessengerMessageSentHandler
 * после ответа Telegram) — САМ repository.create без явного authStatus/
 * status по-прежнему не имеет права ничего утверждать.
 */
function modelWithCreate() {
  const create = jest.fn().mockImplementation(async (docs: unknown[]) => docs);
  return { model: { create } as never, create };
}

describe('Мессенджер: репозитории не выдают статус, которого не было', () => {
  it('новый аккаунт без явного authStatus — pending и без отметки синхронизации', async () => {
    const { model, create } = modelWithCreate();
    const repository = new MessengerAccountRepository(model);

    await repository.create({
      organizationId: new Types.ObjectId(),
      platform: 'telegram',
      name: 'Sales Bot',
      botToken: '12345:token',
    });

    const doc = create.mock.calls[0][0][0];
    expect(doc).toMatchObject({ authStatus: 'pending', isActive: true });
    expect(doc).not.toHaveProperty('lastSyncAt');
  });

  it('верифицированный аккаунт (N-12: getMe прошёл до create) сохраняет переданный authStatus/lastSyncAt', async () => {
    const { model, create } = modelWithCreate();
    const repository = new MessengerAccountRepository(model);
    const lastSyncAt = new Date('2026-09-13T00:00:00.000Z');

    await repository.create({
      organizationId: new Types.ObjectId(),
      platform: 'telegram',
      name: 'Sales Bot',
      botToken: '12345:token',
      webhookSecret: 'a'.repeat(64),
      telegramBotUsername: 'sales_bot',
      authStatus: 'authenticated',
      lastSyncAt,
    });

    const doc = create.mock.calls[0][0][0];
    expect(doc).toMatchObject({ authStatus: 'authenticated', telegramBotUsername: 'sales_bot', lastSyncAt });
  });

  it('исходящее без явного статуса — queued, входящее — delivered', async () => {
    const { model, create } = modelWithCreate();
    const repository = new MessengerMessageRepository(model);
    const base = {
      organizationId: new Types.ObjectId(),
      dialogId: new Types.ObjectId(),
      text: 'Добрый день!',
    };

    await repository.create({ ...base, author: 'agent' });
    await repository.create({ ...base, author: 'client' });

    expect(create.mock.calls[0][0][0]).toMatchObject({ status: 'queued' });
    expect(create.mock.calls[1][0][0]).toMatchObject({ status: 'delivered' });
  });
});
