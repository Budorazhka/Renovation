import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MessengerAccountRepository, MessengerAccountDocument, MessengerAccountSchema } from '@baza/messenger';

/**
 * ИСПРАВЛЕНО 11.09.2026: `botToken` не имел `select: false` — попадал в
 * ЛЮБОЙ `find()`/`findOne()` по умолчанию. `toAccountReadModel` его и так не
 * отдавал наружу (единственное место, что читает документ), но структурной
 * защиты не было — дамп базы, лог документа целиком или будущий код, не
 * учитывающий это явно, утекли бы токеном. Проверяется на настоящей
 * MongoDB: `select: false` — свойство запроса Mongoose, не TypeScript-типа,
 * мок модели его подтвердить не может.
 */
describe('MessengerAccount.botToken: select:false скрывает секрет от обычного чтения', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let AccountModel: mongoose.Model<MessengerAccountDocument>;
  let repository: MessengerAccountRepository;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    AccountModel = connection.model(MessengerAccountDocument.name, MessengerAccountSchema);
    repository = new MessengerAccountRepository(AccountModel);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  it('обычный find/findOne не возвращает botToken; явный +botToken — возвращает', async () => {
    const organizationId = new Types.ObjectId();
    const created = await repository.create({
      organizationId,
      platform: 'telegram',
      name: 'Sales Bot',
      botToken: '123456:AA-secret-telegram-bot-token',
    });
    // Сразу после create() поле в памяти есть — select:false не действует на
    // документ, который только что сконструировали, только на запросы.
    expect(created.botToken).toBe('123456:AA-secret-telegram-bot-token');

    const plain = await AccountModel.findOne({ _id: created._id }).lean();
    expect(plain).not.toBeNull();
    expect(plain).not.toHaveProperty('botToken');

    const plainList = await AccountModel.find({ organizationId }).lean();
    expect(plainList).toHaveLength(1);
    expect(plainList[0]).not.toHaveProperty('botToken');

    const explicit = await AccountModel.findOne({ _id: created._id }).select('+botToken').lean();
    expect(explicit?.botToken).toBe('123456:AA-secret-telegram-bot-token');
  });

  it('MessengerAccountRepository.findByIdForOrganization (auth-путь удаления) тоже не тянет токен', async () => {
    const organizationId = new Types.ObjectId();
    const created = await repository.create({
      organizationId,
      platform: 'telegram',
      name: 'Support Bot',
      botToken: 'another-secret-token',
    });

    const fetched = await repository.findByIdForOrganization(created._id, organizationId);
    expect(fetched).not.toBeNull();
    expect(fetched!.botToken).toBeUndefined();
  });
});
