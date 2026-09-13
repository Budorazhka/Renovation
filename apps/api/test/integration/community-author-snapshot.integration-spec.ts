import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CommunityService } from '../../src/modules/community/community.service';
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
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { OrganizationRepository } from '../../src/modules/organizations/repository/organization.repository';
import { PositionRepository } from '../../src/modules/organizations/repository/position.repository';
import {
  OrganizationDocument,
  OrganizationSchema,
} from '../../src/modules/organizations/schemas/organization.schema';
import { PositionDocument, PositionSchema } from '../../src/modules/organizations/schemas/position.schema';
import type { IdempotencyService } from '../../src/shared/idempotency/idempotency.service';
import type { OutboxService } from '../../src/modules/outbox/outbox.service';
import type { PolicyEvaluatorService } from '../../src/modules/authorization/policy-evaluator.service';

/**
 * N-08 (11.09.2026): до этого коммита контроллер не передавал снимок
 * профиля вовсе, и каждая тема/ответ подписывались одним и тем же
 * DEFAULT_AUTHOR_SNAPSHOT — «Участник BAZA» без компании, даже от
 * застройщика. Проверяется на настоящей MongoDB: CommunityService читает
 * Position.currentOccupantName и Organization.name внутри той же
 * транзакции, что создаёт тему/ответ, и записывает их в authorSnapshot —
 * не только возвращает в DTO, но и реально сохраняет в базу.
 *
 * idempotencyService/outboxService — простые моки: их корректность
 * покрыта community.service.spec.ts, здесь важна только цепочка
 * Position/Organization → authorSnapshot через настоящий OrganizationsService.
 */
describe('Community: N-08 автор темы/ответа — реальное имя и организация', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let OrganizationModel: mongoose.Model<OrganizationDocument>;
  let PositionModel: mongoose.Model<PositionDocument>;
  let ThreadModel: mongoose.Model<CommunityThreadDocument>;
  let ReplyModel: mongoose.Model<CommunityReplyDocument>;
  let service: CommunityService;
  let idempotencyKeySeq = 0;

  async function createOrgAndPosition(params: {
    orgType: 'developer' | 'agency' | 'independent_realtor';
    orgName: string;
    fixedRole: 'developer' | 'owner' | 'manager';
    currentOccupantName?: string;
  }) {
    const [organization] = await OrganizationModel.create([{ type: params.orgType, name: params.orgName }]);
    const [position] = await PositionModel.create([
      {
        organizationId: organization!._id,
        fixedRole: params.fixedRole,
        status: 'occupied',
        currentOccupantName: params.currentOccupantName,
      },
    ]);
    return { organizationId: organization!._id, positionId: position!._id };
  }

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();

    OrganizationModel = connection.model(OrganizationDocument.name, OrganizationSchema);
    PositionModel = connection.model(PositionDocument.name, PositionSchema);
    const SectionModel = connection.model(CommunitySectionDocument.name, CommunitySectionSchema);
    ThreadModel = connection.model(CommunityThreadDocument.name, CommunityThreadSchema);
    ReplyModel = connection.model(CommunityReplyDocument.name, CommunityReplySchema);
    const EventModel = connection.model(CommunityEventDocument.name, CommunityEventSchema);

    // getPositionSummary/getOrganizationById — единственное, что здесь вызывается;
    // остальные зависимости OrganizationsService этим путём не трогаются.
    const organizationsService = new OrganizationsService(
      connection,
      new OrganizationRepository(OrganizationModel),
      new PositionRepository(PositionModel),
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );

    const idempotencyService: Pick<IdempotencyService, 'checkReplay' | 'record'> = {
      checkReplay: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const outboxService: Pick<OutboxService, 'publish'> = { publish: jest.fn().mockResolvedValue(undefined) };
    // Модерация (13.09.2026) здесь не проверяется — только N-08 подпись
    // автора; grant 'manage' не нужен ни одному из этих тестов.
    const policyEvaluator: Pick<PolicyEvaluatorService, 'evaluate'> = {
      evaluate: jest.fn().mockResolvedValue(false),
    };

    service = new CommunityService(
      connection,
      new CommunitySectionRepository(SectionModel),
      new CommunityThreadRepository(ThreadModel),
      new CommunityReplyRepository(ReplyModel),
      new CommunityEventRepository(EventModel),
      idempotencyService as unknown as IdempotencyService,
      outboxService as unknown as OutboxService,
      policyEvaluator as unknown as PolicyEvaluatorService,
      organizationsService,
    );

    await service.seedDefaultsIfEmpty();
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  function nextIdempotencyKey(): string {
    idempotencyKeySeq += 1;
    return `idem-author-snapshot-${idempotencyKeySeq}`;
  }

  it('createThread пишет в тему реальное имя позиции и название организации', async () => {
    const { organizationId, positionId } = await createOrgAndPosition({
      orgType: 'developer',
      orgName: 'ГК «Север»',
      fixedRole: 'developer',
      currentOccupantName: 'Никита Девелопер',
    });

    const created = await service.createThread({
      organizationId,
      positionId,
      identityId: new Types.ObjectId(),
      idempotencyKey: nextIdempotencyKey(),
      data: { type: 'discussion', sectionId: 'market', title: 'Старт продаж', body: 'Текст темы' },
    });

    expect(created.author).toEqual({
      name: 'Никита Девелопер',
      company: 'ГК «Север»',
      segment: 'developer',
      role: 'member',
      badges: ['Участник'],
    });

    // Не только в ответе API — реально сохранено в базе.
    const persisted = await ThreadModel.findOne({ threadId: created.id }).lean();
    expect(persisted!.authorSnapshot).toMatchObject({ name: 'Никита Девелопер', company: 'ГК «Север»' });
  });

  it('позиция без явно заданного имени — компания известна, имя остаётся подписью роли', async () => {
    const { organizationId, positionId } = await createOrgAndPosition({
      orgType: 'agency',
      orgName: 'Альфа-недвижимость',
      fixedRole: 'owner',
      currentOccupantName: undefined,
    });

    const created = await service.createThread({
      organizationId,
      positionId,
      identityId: new Types.ObjectId(),
      idempotencyKey: nextIdempotencyKey(),
      data: { type: 'discussion', sectionId: 'market', title: 'Вопрос', body: 'Текст' },
    });

    expect(created.author).toEqual({
      name: 'Участник BAZA',
      company: 'Альфа-недвижимость',
      segment: 'broker',
      role: 'member',
      badges: ['Участник'],
    });
  });

  it('createReply пишет в ответ то же реальное имя и организацию', async () => {
    const { organizationId, positionId } = await createOrgAndPosition({
      orgType: 'independent_realtor',
      orgName: 'Мария Ким',
      fixedRole: 'owner',
      currentOccupantName: 'Мария Ким',
    });
    const thread = await service.createThread({
      organizationId,
      positionId,
      identityId: new Types.ObjectId(),
      idempotencyKey: nextIdempotencyKey(),
      data: { type: 'question', sectionId: 'law', title: 'Вопрос по эскроу', body: 'Текст' },
    });

    const reply = await service.createReply({
      // createThread возвращает объединение с IdempotencyService.checkReplay's
      // responseBody (Record<string, unknown>) — .id сужается до unknown в
      // строгом контексте параметра, хотя в рантайме это всегда string.
      threadId: thread.id as string,
      organizationId,
      positionId,
      identityId: new Types.ObjectId(),
      idempotencyKey: nextIdempotencyKey(),
      data: { body: 'Ответ по делу' },
    });

    expect(reply.author).toEqual({
      name: 'Мария Ким',
      company: 'Мария Ким',
      segment: 'agent',
      role: 'member',
      badges: ['Участник'],
    });
    const persisted = await ReplyModel.findOne({ replyId: reply.id }).lean();
    expect(persisted!.authorSnapshot).toMatchObject({ name: 'Мария Ким', segment: 'agent' });
  });
});
