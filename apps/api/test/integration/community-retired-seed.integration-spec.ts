import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CommunityService } from '../../src/modules/community/community.service';
import {
  RETIRED_SEED_EVENT_IDS,
  RETIRED_SEED_THREAD_IDS,
  SEED_COMMUNITY_SECTIONS,
} from '../../src/modules/community/community-seed-data';
import { CommunitySectionRepository } from '../../src/modules/community/repository/community-section.repository';
import { CommunityThreadRepository } from '../../src/modules/community/repository/community-thread.repository';
import { CommunityReplyRepository } from '../../src/modules/community/repository/community-reply.repository';
import { CommunityEventRepository } from '../../src/modules/community/repository/community-event.repository';
import {
  CommunitySectionDocument,
  CommunitySectionSchema,
} from '../../src/modules/community/schemas/community-section.schema';
import {
  CommunityThreadDocument,
  CommunityThreadSchema,
} from '../../src/modules/community/schemas/community-thread.schema';
import {
  CommunityReplyDocument,
  CommunityReplySchema,
} from '../../src/modules/community/schemas/community-reply.schema';
import {
  CommunityEventDocument,
  CommunityEventSchema,
} from '../../src/modules/community/schemas/community-event.schema';

/**
 * 11.09.2026 засев выдуманных тем и мероприятий убран, а записи, которые он
 * успел положить в базы, CommunityService.seedDefaultsIfEmpty удаляет при
 * каждом старте. Код удаляет данные, поэтому проверяется на настоящей MongoDB:
 * уходят только фиксированные id бывшего засева, темы и ответы людей остаются.
 */
describe('Community: очистка выдуманного засева при старте', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let SectionModel: mongoose.Model<CommunitySectionDocument>;
  let ThreadModel: mongoose.Model<CommunityThreadDocument>;
  let ReplyModel: mongoose.Model<CommunityReplyDocument>;
  let EventModel: mongoose.Model<CommunityEventDocument>;
  let service: CommunityService;

  const author = {
    authorIdentityId: new Types.ObjectId(),
    authorPositionId: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    authorSnapshot: { name: 'Участник BAZA' },
  };

  function thread(threadId: string, sectionId = 'market') {
    return { threadId, type: 'discussion', sectionId, title: 'T', excerpt: 'E', body: 'B', ...author };
  }

  function event(eventId: string) {
    return { eventId, title: 'T', description: 'D', date: '2026-10-15', location: 'Батуми', format: 'offline' };
  }

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    SectionModel = connection.model(CommunitySectionDocument.name, CommunitySectionSchema);
    ThreadModel = connection.model(CommunityThreadDocument.name, CommunityThreadSchema);
    ReplyModel = connection.model(CommunityReplyDocument.name, CommunityReplySchema);
    EventModel = connection.model(CommunityEventDocument.name, CommunityEventSchema);

    service = new CommunityService(
      connection,
      new CommunitySectionRepository(SectionModel),
      new CommunityThreadRepository(ThreadModel),
      new CommunityReplyRepository(ReplyModel),
      new CommunityEventRepository(EventModel),
      // Засев не пишет ни идемпотентность, ни outbox, ни снимок автора,
      // ни проверку granta модератора.
      null as never,
      null as never,
      null as never,
      null as never,
    );
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  it('удаляет темы, ответы и мероприятия бывшего засева и не трогает настоящие', async () => {
    // База, которую успел засеять код до 11.09: три выдуманные темы, два
    // мероприятия. Плюс ответ живого человека под выдуманной темой и
    // настоящая тема с ответом.
    await ThreadModel.create(RETIRED_SEED_THREAD_IDS.map((id) => thread(id)));
    await EventModel.create(RETIRED_SEED_EVENT_IDS.map(event));
    const realThreadId = `th-${Date.now()}-a1b2c3d4`;
    await ThreadModel.create([thread(realThreadId, 'law')]);
    await ReplyModel.create([
      { replyId: 'rep-under-fake', threadId: RETIRED_SEED_THREAD_IDS[0]!, body: 'Интересно', ...author },
      { replyId: 'rep-real', threadId: realThreadId, body: 'Ответ по делу', ...author },
    ]);
    await EventModel.create([event('ev-some-other-event')]);

    await service.seedDefaultsIfEmpty();

    expect(await ThreadModel.find().distinct('threadId')).toEqual([realThreadId]);
    expect(await ReplyModel.find().distinct('replyId')).toEqual(['rep-real']);
    expect(await EventModel.find().distinct('eventId')).toEqual(['ev-some-other-event']);

    const sections = await SectionModel.find().sort({ order: 1 }).lean();
    expect(sections.map((s) => s.sectionId)).toEqual(SEED_COMMUNITY_SECTIONS.map((s) => s.sectionId));
    expect(sections.every((s) => s.threadCount === 0)).toBe(true);
  });

  it('повторный старт ничего не удаляет и не дублирует разделы', async () => {
    const threadsBefore = await ThreadModel.countDocuments();
    const repliesBefore = await ReplyModel.countDocuments();

    await service.seedDefaultsIfEmpty();

    expect(await ThreadModel.countDocuments()).toBe(threadsBefore);
    expect(await ReplyModel.countDocuments()).toBe(repliesBefore);
    expect(await SectionModel.countDocuments()).toBe(SEED_COMMUNITY_SECTIONS.length);
  });
});
