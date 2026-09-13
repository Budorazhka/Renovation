import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MessengerDialogRepository,
  MessengerMessageRepository,
  MessengerDialogDocument,
  MessengerDialogSchema,
  MessengerMessageDocument,
  MessengerMessageSchema,
} from '@baza/messenger';

/**
 * ИСПРАВЛЕНО 11.09.2026: MessengerService.deleteAccount удалял только сам
 * аккаунт — диалоги с уже несуществующим accountId оставались висеть (тот
 * же класс проблемы, что чистка N-02 в community). Каскад теперь через
 * MessengerDialogRepository.deleteByAccountId (возвращает id удалённых
 * диалогов) + MessengerMessageRepository.deleteByDialogIds. Здесь —
 * репозиторный уровень на настоящей MongoDB: правильность $in-фильтра,
 * изоляция по organizationId/accountId, отсутствие эффекта на чужие
 * диалоги/сообщения. Wiring внутри самого deleteAccount (что сервис вызывает
 * оба метода в правильном порядке с правильными id) уже проверен моками в
 * messenger.service.spec.ts — сюда сознательно не дублировали полный
 * AppModule/HTTP-bootstrap, риск здесь в семантике самого Mongo-запроса, не
 * в транспортном слое.
 */
describe('Messenger account delete cascade: диалоги и сообщения удалённого аккаунта не остаются висеть', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let dialogRepository: MessengerDialogRepository;
  let messageRepository: MessengerMessageRepository;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    const DialogModel = connection.model(MessengerDialogDocument.name, MessengerDialogSchema);
    const MessageModel = connection.model(MessengerMessageDocument.name, MessengerMessageSchema);
    dialogRepository = new MessengerDialogRepository(DialogModel);
    messageRepository = new MessengerMessageRepository(MessageModel);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('messenger_dialogs').deleteMany({});
    await connection.collection('messenger_messages').deleteMany({});
  });

  it('удаляет диалоги удалённого аккаунта и их сообщения, не трогая другой аккаунт той же организации', async () => {
    const organizationId = new Types.ObjectId();
    const deletedAccountId = new Types.ObjectId();
    const survivingAccountId = new Types.ObjectId();

    const dialogA = await dialogRepository.create({
      organizationId,
      accountId: deletedAccountId,
      platform: 'telegram',
      externalChatId: 'chat-a',
      name: 'Клиент А',
    });
    const dialogB = await dialogRepository.create({
      organizationId,
      accountId: deletedAccountId,
      platform: 'telegram',
      externalChatId: 'chat-b',
      name: 'Клиент Б',
    });
    const survivingDialog = await dialogRepository.create({
      organizationId,
      accountId: survivingAccountId,
      platform: 'whatsapp',
      externalChatId: 'chat-c',
      name: 'Клиент В (другой аккаунт)',
    });

    await messageRepository.create({ organizationId, dialogId: dialogA._id, author: 'agent', text: 'A1' });
    await messageRepository.create({ organizationId, dialogId: dialogA._id, author: 'client', text: 'A2' });
    await messageRepository.create({ organizationId, dialogId: dialogB._id, author: 'agent', text: 'B1' });
    await messageRepository.create({ organizationId, dialogId: survivingDialog._id, author: 'agent', text: 'C1' });

    const deletedDialogIds = await dialogRepository.deleteByAccountId(organizationId, deletedAccountId);
    expect(deletedDialogIds.map((id) => id.toString()).sort()).toEqual(
      [dialogA._id.toString(), dialogB._id.toString()].sort(),
    );

    const deletedMessagesCount = await messageRepository.deleteByDialogIds(organizationId, deletedDialogIds);
    expect(deletedMessagesCount).toBe(3);

    expect(await connection.collection('messenger_dialogs').countDocuments({ accountId: deletedAccountId })).toBe(0);
    expect(await connection.collection('messenger_messages').countDocuments({ dialogId: { $in: [dialogA._id, dialogB._id] } })).toBe(0);

    // Другой аккаунт той же организации не затронут.
    const survivingDialogDoc = await connection.collection('messenger_dialogs').findOne({ _id: survivingDialog._id });
    expect(survivingDialogDoc).not.toBeNull();
    expect(await connection.collection('messenger_messages').countDocuments({ dialogId: survivingDialog._id })).toBe(1);
  });

  it('аккаунт без диалогов — пустой массив id, ни одно сообщение не удаляется', async () => {
    const organizationId = new Types.ObjectId();
    const accountId = new Types.ObjectId();

    const deletedDialogIds = await dialogRepository.deleteByAccountId(organizationId, accountId);
    expect(deletedDialogIds).toEqual([]);

    const deletedMessagesCount = await messageRepository.deleteByDialogIds(organizationId, deletedDialogIds);
    expect(deletedMessagesCount).toBe(0);
  });

  it('изоляция по организации: тот же accountId в чужой организации не затрагивается', async () => {
    const organizationId = new Types.ObjectId();
    const foreignOrganizationId = new Types.ObjectId();
    const accountId = new Types.ObjectId();

    await dialogRepository.create({
      organizationId: foreignOrganizationId,
      accountId,
      platform: 'telegram',
      externalChatId: 'chat-foreign',
      name: 'Клиент чужой организации',
    });

    const deletedDialogIds = await dialogRepository.deleteByAccountId(organizationId, accountId);
    expect(deletedDialogIds).toEqual([]);
    expect(await connection.collection('messenger_dialogs').countDocuments({ organizationId: foreignOrganizationId })).toBe(1);
  });
});
