import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  MessengerDialogRepository,
  decodeDialogListCursor,
  encodeDialogListCursor,
  MessengerDialogDocument,
  MessengerDialogSchema,
} from '@baza/messenger';

/**
 * ИСПРАВЛЕНО 11.09.2026: список диалогов сортируется `{pinned: -1,
 * 'lastMessage.sentAt': -1, _id: -1}`, но курсор фильтровал только по `_id`.
 * Диалог поднимается в списке при новом сообщении независимо от даты
 * создания — порядок по `_id` и порядок сортировки расходятся не в редких
 * случаях, а почти всегда. Конкретный сценарий ниже показывает и то, и
 * другое: закреплённый диалог со старым `_id` возвращался бы повторно на
 * каждой следующей странице (проходит фильтр `_id < cursor` бесконечно),
 * а диалог с более новым `_id`, но без буста, терялся бы.
 *
 * `select:false`-подобные вещи здесь не при чём — это чистая семантика
 * Mongo-запроса ($lt против null/missing, составной $or/$and), поэтому
 * проверяется на настоящей MongoDB напрямую через репозиторий, без полного
 * AppModule (тот же лёгкий паттерн, что messenger-bot-token-hidden).
 */
describe('MessengerDialogRepository.listForOrganization: составной seek-курсор', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let DialogModel: mongoose.Model<MessengerDialogDocument>;
  let repository: MessengerDialogRepository;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    DialogModel = connection.model(MessengerDialogDocument.name, MessengerDialogSchema);
    repository = new MessengerDialogRepository(DialogModel);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await DialogModel.deleteMany({});
  });

  it('закреплённый диалог со старым _id не дублируется вечно, диалог с новым _id без буста не теряется', async () => {
    const organizationId = new Types.ObjectId();
    const accountId = new Types.ObjectId();

    // Порядок создания (по возрастанию _id): L, M, N, O.
    const L = await repository.create({ organizationId, accountId, platform: 'telegram', externalChatId: 'L', name: 'L' });
    const M = await repository.create({ organizationId, accountId, platform: 'telegram', externalChatId: 'M', name: 'M' });
    const N = await repository.create({ organizationId, accountId, platform: 'telegram', externalChatId: 'N', name: 'N' });
    const O = await repository.create({ organizationId, accountId, platform: 'telegram', externalChatId: 'O', name: 'O' });

    // M закрепляют (старый _id, но должен сортироваться первым).
    await DialogModel.updateOne({ _id: M._id }, { $set: { pinned: true } }).exec();

    // Ожидаемый порядок: M (pinned) первым; L, N, O без lastMessage и без
    // pinned — тай-брейк по _id по убыванию: O, N, L.
    const expectedOrder = [M._id.toString(), O._id.toString(), N._id.toString(), L._id.toString()];

    // Полный список без курсора — эталон (сортировку Mongo здесь не
    // проверяем отдельно, доверяем .sort(), проверяем только курсор).
    const full = await repository.listForOrganization({ organizationId, limit: 100 });
    expect(full.map((d) => d._id.toString())).toEqual(expectedOrder);

    // Постранично по 2 через новый seek-курсор — должно дать ТОТ ЖЕ порядок,
    // без пропусков и без повторов.
    const page1 = await repository.listForOrganization({ organizationId, limit: 2 });
    expect(page1.map((d) => d._id.toString())).toEqual([M._id.toString(), O._id.toString()]);

    const cursorAfterPage1 = decodeDialogListCursor(encodeDialogListCursor(page1[page1.length - 1]!));
    const page2 = await repository.listForOrganization({ organizationId, limit: 2, cursor: cursorAfterPage1 });
    expect(page2.map((d) => d._id.toString())).toEqual([N._id.toString(), L._id.toString()]);

    const cursorAfterPage2 = decodeDialogListCursor(encodeDialogListCursor(page2[page2.length - 1]!));
    const page3 = await repository.listForOrganization({ organizationId, limit: 2, cursor: cursorAfterPage2 });
    expect(page3).toHaveLength(0);

    // Старый баг: курсор по голому _id = M._id — `_id < M._id` матчит только
    // L (создан раньше M). N и O созданы ПОЗЖЕ M (несмотря на то что M
    // закреплён и показан первым), поэтому `_id < M._id` их не находит —
    // они терялись бы полностью, хотя не были показаны на page1.
    const legacyCursorFromM = { kind: 'legacy' as const, id: M._id };
    const page2Legacy = await repository.listForOrganization({ organizationId, limit: 2, cursor: legacyCursorFromM });
    expect(page2Legacy.map((d) => d._id.toString())).toEqual([L._id.toString()]);
    // ^ подтверждает регресс, который фиксил этот коммит: легаси-фильтр по
    // одному _id теряет N и O, а не воспроизводит page2 целиком ([N, O] —
    // корректный результат составного seek-курсора, проверенный выше).
  });

  it('диалог без единого сообщения (lastMessage отсутствует) корректно участвует в seek-курсоре', async () => {
    const organizationId = new Types.ObjectId();
    const accountId = new Types.ObjectId();

    const A = await repository.create({ organizationId, accountId, platform: 'telegram', externalChatId: 'A', name: 'A' });
    const B = await repository.create({ organizationId, accountId, platform: 'telegram', externalChatId: 'B', name: 'B' });

    // A получает сообщение (свежее), B — нет. A должен подняться выше B,
    // несмотря на то что создан раньше.
    await repository.updateLastMessage(A._id, organizationId, { text: 'привет', sentAt: new Date(), fromMe: false, author: 'client' }, false);

    const page1 = await repository.listForOrganization({ organizationId, limit: 1 });
    expect(page1.map((d) => d._id.toString())).toEqual([A._id.toString()]);

    const cursor = decodeDialogListCursor(encodeDialogListCursor(page1[0]!));
    const page2 = await repository.listForOrganization({ organizationId, limit: 1, cursor });
    expect(page2.map((d) => d._id.toString())).toEqual([B._id.toString()]);
  });
});
