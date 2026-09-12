import { Types } from 'mongoose';
import { CommunityService } from './community.service';
import {
  RETIRED_SEED_EVENT_IDS,
  RETIRED_SEED_THREAD_IDS,
  SEED_COMMUNITY_SECTIONS,
} from './community-seed-data';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { CommunitySectionRepository } from './repository/community-section.repository';
import type { CommunityThreadRepository } from './repository/community-thread.repository';
import type { CommunityReplyRepository } from './repository/community-reply.repository';
import type { CommunityEventRepository } from './repository/community-event.repository';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import type { OutboxService } from '../outbox/outbox.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { CommunityThreadDocument } from './schemas/community-thread.schema';
import type { CommunityReplyDocument } from './schemas/community-reply.schema';
import type { CommunitySectionDocument } from './schemas/community-section.schema';

function makeTransactionConnection() {
  const session = {
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  return {
    startSession: jest.fn().mockResolvedValue({
      ...session,
      withTransaction: async (work: (s: typeof session) => Promise<unknown>) => work(session),
    }),
  };
}

interface MockSectionRepo {
  listAll: jest.Mock;
  findById: jest.Mock;
  incrementThreadCount: jest.Mock;
  seedSystemSectionsIfEmpty: jest.Mock;
}

interface MockThreadRepo {
  findPaginated: jest.Mock;
  findById: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  incrementViews: jest.Mock;
  toggleReaction: jest.Mock;
  incrementReplyCount: jest.Mock;
  updateExchangeStatus: jest.Mock;
  deleteByThreadIds: jest.Mock;
}

interface MockReplyRepo {
  findPaginated: jest.Mock;
  findById: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  toggleReaction: jest.Mock;
  markAsBest: jest.Mock;
  deleteByThreadIds: jest.Mock;
}

interface MockEventRepo {
  findUpcoming: jest.Mock;
  findById: jest.Mock;
  toggleAttendance: jest.Mock;
  deleteByEventIds: jest.Mock;
}

interface MockIdempotencyService {
  checkReplay: jest.Mock;
  record: jest.Mock;
}

interface MockOutboxService {
  publish: jest.Mock;
}

interface MockOrganizationsService {
  getPositionSummary: jest.Mock;
  getOrganizationById: jest.Mock;
}

interface MockPolicyEvaluatorService {
  evaluate: jest.Mock;
}

describe('CommunityService', () => {
  let service: CommunityService;
  let sectionRepo: MockSectionRepo;
  let threadRepo: MockThreadRepo;
  let replyRepo: MockReplyRepo;
  let eventRepo: MockEventRepo;
  let idempotencyService: MockIdempotencyService;
  let outboxService: MockOutboxService;
  let policyEvaluator: MockPolicyEvaluatorService;
  let organizationsService: MockOrganizationsService;

  const orgId = new Types.ObjectId();
  const positionId = new Types.ObjectId();
  const identityId = new Types.ObjectId();

  beforeEach(() => {
    sectionRepo = {
      listAll: jest.fn(),
      findById: jest.fn(),
      incrementThreadCount: jest.fn().mockResolvedValue(undefined),
      seedSystemSectionsIfEmpty: jest.fn().mockResolvedValue(undefined),
    };
    threadRepo = {
      findPaginated: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      incrementViews: jest.fn().mockResolvedValue(undefined),
      toggleReaction: jest.fn(),
      incrementReplyCount: jest.fn().mockResolvedValue(undefined),
      updateExchangeStatus: jest.fn(),
      deleteByThreadIds: jest.fn().mockResolvedValue(0),
    };
    replyRepo = {
      findPaginated: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      toggleReaction: jest.fn(),
      markAsBest: jest.fn(),
      deleteByThreadIds: jest.fn().mockResolvedValue(0),
    };
    eventRepo = {
      findUpcoming: jest.fn(),
      findById: jest.fn(),
      toggleAttendance: jest.fn(),
      deleteByEventIds: jest.fn().mockResolvedValue(0),
    };
    idempotencyService = {
      checkReplay: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    };
    outboxService = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    // По умолчанию — без гранта 'manage': тесты не про модерацию не должны
    // случайно получать права модератора просто по совпадению организации.
    policyEvaluator = {
      evaluate: jest.fn().mockResolvedValue(false),
    };
    // По умолчанию — как позиция без профиля/новая организация: buildAuthorSnapshot
    // должен откатиться на DEFAULT_AUTHOR_SNAPSHOT, не бросить и не подставить выдумку.
    organizationsService = {
      getPositionSummary: jest.fn().mockResolvedValue(null),
      getOrganizationById: jest.fn().mockResolvedValue(null),
    };

    service = new CommunityService(
      makeTransactionConnection() as never,
      sectionRepo as unknown as CommunitySectionRepository,
      threadRepo as unknown as CommunityThreadRepository,
      replyRepo as unknown as CommunityReplyRepository,
      eventRepo as unknown as CommunityEventRepository,
      idempotencyService as unknown as IdempotencyService,
      outboxService as unknown as OutboxService,
      policyEvaluator as unknown as PolicyEvaluatorService,
      organizationsService as unknown as OrganizationsService,
    );
  });

  // ─── Засев при старте ──────────────────────────────────────────────────────

  describe('seedDefaultsIfEmpty', () => {
    it('засевает только разделы и вычищает выдуманные темы, ответы и мероприятия прежнего засева', async () => {
      threadRepo.deleteByThreadIds.mockResolvedValue(3);
      replyRepo.deleteByThreadIds.mockResolvedValue(1);
      eventRepo.deleteByEventIds.mockResolvedValue(2);

      await service.seedDefaultsIfEmpty();

      expect(sectionRepo.seedSystemSectionsIfEmpty).toHaveBeenCalledWith(SEED_COMMUNITY_SECTIONS);
      expect(threadRepo.deleteByThreadIds).toHaveBeenCalledWith(RETIRED_SEED_THREAD_IDS);
      expect(replyRepo.deleteByThreadIds).toHaveBeenCalledWith(RETIRED_SEED_THREAD_IDS);
      expect(eventRepo.deleteByEventIds).toHaveBeenCalledWith(RETIRED_SEED_EVENT_IDS);
      expect(threadRepo.create).not.toHaveBeenCalled();
    });

    it('не валит старт приложения, если засев упал', async () => {
      sectionRepo.seedSystemSectionsIfEmpty.mockRejectedValue(new Error('replica set not ready'));

      await expect(service.seedDefaultsIfEmpty()).resolves.toBeUndefined();
    });

    it('засевает ровно шесть разделов с уникальными id', () => {
      const ids = SEED_COMMUNITY_SECTIONS.map((s) => s.sectionId);
      expect(ids).toEqual(['market', 'cases', 'law', 'exchange', 'showcase', 'events']);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── Разделы ───────────────────────────────────────────────────────────────

  describe('sections', () => {
    it('возвращает список всех разделов', async () => {
      const mockSections = [
        { sectionId: 'market', name: 'Аналитика', group: 'Общее', order: 1 },
      ] as CommunitySectionDocument[];
      sectionRepo.listAll.mockResolvedValue(mockSections);

      const result = await service.getSections();
      expect(result.sections).toHaveLength(1);
      expect(result.sections![0]!.id).toBe('market');
      expect(sectionRepo.listAll).toHaveBeenCalled();
    });

    it('возвращает раздел по id', async () => {
      const mockSection = {
        sectionId: 'market',
        name: 'Аналитика',
      } as CommunitySectionDocument;
      sectionRepo.findById.mockResolvedValue(mockSection);

      const result = await service.getSection('market');
      expect(result.id).toBe('market');
    });

    it('выбрасывает NOT_FOUND, если раздел не найден', async () => {
      sectionRepo.findById.mockResolvedValue(null);

      await expect(service.getSection('unknown')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });
  });

  // ─── Темы (треды) ──────────────────────────────────────────────────────────

  describe('threads', () => {
    it('возвращает пагинированный список тем', async () => {
      // N-10: caller не проверен под MLS — findPaginated получает
      // excludeTypes:['exchange'], этот тест не про биржу.
      const paginated = { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
      threadRepo.findPaginated.mockResolvedValue(paginated);

      const result = await service.listThreads({ page: 1, pageSize: 20 }, orgId);
      expect(result.items).toEqual([]);
      expect(threadRepo.findPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ excludeTypes: ['exchange'] }),
        'active',
        1,
        20,
      );
    });

    it('получает тему по id и инкрементирует просмотры', async () => {
      const mockThread = {
        threadId: 'thread-1',
        title: 'Test',
        type: 'discussion',
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);

      const result = await service.getThread('thread-1', orgId);
      expect(result.id).toBe('thread-1');
      expect(threadRepo.incrementViews).toHaveBeenCalledWith('thread-1');
    });

    it('выбрасывает NOT_FOUND, если тема не найдена', async () => {
      threadRepo.findById.mockResolvedValue(null);

      await expect(service.getThread('thread-missing', orgId)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    // ─── N-10: биржа MLS видна только проверенным агентствам/риэлторам ──────────

    it('скрывает биржевую тему от неверифицированной организации (NOT_FOUND, не FORBIDDEN)', async () => {
      const mockThread = {
        threadId: 'ex-1',
        type: 'exchange',
        organizationId: new Types.ObjectId(),
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      organizationsService.getOrganizationById.mockResolvedValue({ type: 'agency', mlsVerified: false });

      await expect(service.getThread('ex-1', orgId)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('скрывает биржевую тему от застройщика, даже если бы у него был mlsVerified:true', async () => {
      const mockThread = {
        threadId: 'ex-1',
        type: 'exchange',
        organizationId: new Types.ObjectId(),
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      organizationsService.getOrganizationById.mockResolvedValue({ type: 'developer', mlsVerified: true });

      await expect(service.getThread('ex-1', orgId)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('показывает биржевую тему верифицированному агентству', async () => {
      const mockThread = { threadId: 'ex-1', type: 'exchange', organizationId: orgId } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      organizationsService.getOrganizationById.mockResolvedValue({ type: 'agency', mlsVerified: true });

      const result = await service.getThread('ex-1', orgId);
      expect(result.id).toBe('ex-1');
    });

    it('createThread отклоняет заявку биржи от неверифицированной организации', async () => {
      sectionRepo.findById.mockResolvedValue({ sectionId: 'exchange', name: 'Биржа' });
      organizationsService.getOrganizationById.mockResolvedValue({ type: 'agency', mlsVerified: false });

      await expect(
        service.createThread({
          organizationId: orgId,
          positionId,
          identityId,
          idempotencyKey: 'ex-key',
          data: {
            type: 'exchange',
            sectionId: 'exchange',
            title: 'T',
            excerpt: 'E',
            body: 'B',
          },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(threadRepo.create).not.toHaveBeenCalled();
    });

    it('создаёт тему, проверяет идемпотентность и публикует Outbox событие', async () => {
      sectionRepo.findById.mockResolvedValue({ sectionId: 'market', name: 'Рынок' });
      const mockCreated = {
        threadId: 't-123',
        title: 'Новая тема',
        sectionId: 'market',
        type: 'discussion',
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
      } as unknown as CommunityThreadDocument;
      threadRepo.create.mockResolvedValue(mockCreated);

      const result = await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-key-1',
        data: {
          type: 'discussion',
          sectionId: 'market',
          title: 'Новая тема',
          excerpt: 'Краткое описание',
          body: 'Полный текст темы',
        },
      });

      expect(idempotencyService.checkReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId,
          operation: 'createCommunityThread',
          key: 'idem-key-1',
        }),
      );
      expect(threadRepo.create).toHaveBeenCalled();
      expect(sectionRepo.incrementThreadCount).toHaveBeenCalledWith('market', 1, expect.anything());
      expect(idempotencyService.record).toHaveBeenCalled();
      expect(outboxService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'CommunityThreadCreated',
          aggregateType: 'CommunityThread',
        }),
        expect.anything(),
      );
      expect(result.id).toBe('t-123');
    });

    it('создаёт тему незакреплённой, даже если в теле пришёл pinned', async () => {
      sectionRepo.findById.mockResolvedValue({ sectionId: 'market', name: 'Рынок' });
      threadRepo.create.mockResolvedValue({
        threadId: 't-pin',
        authorIdentityId: identityId,
        organizationId: orgId,
      } as unknown as CommunityThreadDocument);

      await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-pin',
        // В DTO поля больше нет (ValidationPipe отклонит его в HTTP), здесь
        // проверяем, что и сервис его не протащит, если оно всё же дойдёт.
        data: { type: 'announcement', sectionId: 'market', title: 'T', body: 'B', pinned: true } as never,
      });

      expect(threadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ pinned: false }),
        expect.anything(),
      );
    });

    it('без найденной позиции/организации не приписывает автору компанию и сегмент', async () => {
      // beforeEach уже мокает organizationsService на null/null — этот тест
      // фиксирует именно это поведение явно, а не полагается на дефолт мока.
      sectionRepo.findById.mockResolvedValue({ sectionId: 'market', name: 'Рынок' });
      threadRepo.create.mockResolvedValue({
        threadId: 't-author',
        authorIdentityId: identityId,
        organizationId: orgId,
      } as unknown as CommunityThreadDocument);

      await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-author',
        data: { type: 'discussion', sectionId: 'market', title: 'T', body: 'B' },
      });

      expect(organizationsService.getPositionSummary).toHaveBeenCalledWith(positionId, orgId);
      expect(organizationsService.getOrganizationById).toHaveBeenCalledWith(orgId);
      const snapshot = threadRepo.create.mock.calls[0]![0].authorSnapshot;
      expect(snapshot.name).toBe('Участник BAZA');
      // Не not.toHaveProperty: buildAuthorSnapshot всегда кладёт ключ company
      // в объект (значением undefined), Jest считает такой ключ существующим —
      // проверяем то, что реально уходит в ответ и в БД: значение отсутствует.
      expect(snapshot.company).toBeUndefined();
      expect(snapshot.segment).toBeUndefined();
    });

    it('N-08: подписывает тему реальным именем автора и названием организации', async () => {
      sectionRepo.findById.mockResolvedValue({ sectionId: 'market', name: 'Рынок' });
      organizationsService.getPositionSummary.mockResolvedValue({
        fixedRole: 'developer',
        currentOccupantName: 'Никита Девелопер',
      });
      organizationsService.getOrganizationById.mockResolvedValue({ name: 'ГК «Север»', type: 'developer' });
      threadRepo.create.mockResolvedValue({
        threadId: 't-real-author',
        authorIdentityId: identityId,
        organizationId: orgId,
      } as unknown as CommunityThreadDocument);

      await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-real-author',
        data: { type: 'discussion', sectionId: 'market', title: 'T', body: 'B' },
      });

      expect(threadRepo.create.mock.calls[0]![0].authorSnapshot).toEqual({
        name: 'Никита Девелопер',
        company: 'ГК «Север»',
        segment: 'developer',
        role: 'member',
        badges: ['Участник'],
      });
    });

    it('N-08: позиция без явно заданного имени подписывает темой роли, а не выдумкой', async () => {
      // currentOccupantName пуст до первого явного задания (тот же случай,
      // что у только что созданного владельца — team.service.ts) — не должен
      // подменяться дефолтным «Участник BAZA», создающим видимость профиля.
      sectionRepo.findById.mockResolvedValue({ sectionId: 'market', name: 'Рынок' });
      organizationsService.getPositionSummary.mockResolvedValue({ fixedRole: 'owner', currentOccupantName: undefined });
      organizationsService.getOrganizationById.mockResolvedValue({ name: 'Альфа-недвижимость', type: 'agency' });
      threadRepo.create.mockResolvedValue({
        threadId: 't-noname',
        authorIdentityId: identityId,
        organizationId: orgId,
      } as unknown as CommunityThreadDocument);

      await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-noname',
        data: { type: 'discussion', sectionId: 'market', title: 'T', body: 'B' },
      });

      const snapshot = threadRepo.create.mock.calls[0]![0].authorSnapshot;
      expect(snapshot.name).toBe('Участник BAZA');
      expect(snapshot.company).toBe('Альфа-недвижимость');
      expect(snapshot.segment).toBe('broker');
    });

    it('N-08: сбой чтения профиля не блокирует создание темы, откатывается на дефолт', async () => {
      sectionRepo.findById.mockResolvedValue({ sectionId: 'market', name: 'Рынок' });
      organizationsService.getPositionSummary.mockRejectedValue(new Error('Mongo timeout'));
      threadRepo.create.mockResolvedValue({
        threadId: 't-fallback',
        authorIdentityId: identityId,
        organizationId: orgId,
      } as unknown as CommunityThreadDocument);

      const result = await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-fallback',
        data: { type: 'discussion', sectionId: 'market', title: 'T', body: 'B' },
      });

      expect(result.id).toBe('t-fallback');
      expect(threadRepo.create.mock.calls[0]![0].authorSnapshot).toEqual(
        expect.objectContaining({ name: 'Участник BAZA' }),
      );
    });

    it('возвращает сохранённый ответ при повторе idempotencyKey', async () => {
      const cached = { id: 'cached-thread' };
      idempotencyService.checkReplay.mockResolvedValue({ responseBody: cached });

      const result = await service.createThread({
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'dup-key',
        data: {
          type: 'discussion',
          sectionId: 'market',
          title: 'T',
          excerpt: 'E',
          body: 'B',
        },
      });

      expect(result).toEqual(cached);
      expect(threadRepo.create).not.toHaveBeenCalled();
    });

    it('обновляет тему автором', async () => {
      const mockThread = {
        threadId: 't-1',
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      threadRepo.update.mockResolvedValue({ ...mockThread, title: 'Updated' });

      const result = await service.updateThread('t-1', identityId, orgId, positionId, { title: 'Updated' });
      expect(result.title).toBe('Updated');
      expect(policyEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it('запрещает редактировать чужую тему не-модератору', async () => {
      const mockThread = {
        threadId: 't-1',
        authorIdentityId: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);

      await expect(
        service.updateThread('t-1', identityId, orgId, positionId, { title: 'Hacked' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    /**
     * ИСПРАВЛЕНО 13.09.2026 (найдено ревью): раньше совпадения organizationId
     * было достаточно — сотрудник с одним лишь правом community_thread.create
     * мог редактировать чужие темы коллег по своей же организации. Теперь
     * сервис отдельно спрашивает PolicyEvaluatorService про грант 'manage'.
     */
    it('запрещает редактировать чужую тему коллеге по организации БЕЗ гранта manage', async () => {
      const mockThread = {
        threadId: 't-1',
        authorIdentityId: new Types.ObjectId(),
        organizationId: orgId,
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      policyEvaluator.evaluate.mockResolvedValue(false);

      await expect(
        service.updateThread('t-1', identityId, orgId, positionId, { title: 'Hacked' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(policyEvaluator.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'community_thread', action: 'manage', subjectId: positionId }),
      );
    });

    it('разрешает редактировать чужую тему коллеге по организации С грантом manage', async () => {
      const mockThread = {
        threadId: 't-1',
        authorIdentityId: new Types.ObjectId(),
        organizationId: orgId,
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      threadRepo.update.mockResolvedValue({ ...mockThread, title: 'Moderated' });
      policyEvaluator.evaluate.mockResolvedValue(true);

      const result = await service.updateThread('t-1', identityId, orgId, positionId, { title: 'Moderated' });
      expect(result.title).toBe('Moderated');
    });

    it('НЕ даёт грант manage в чужой организации спасти редактирование её темы', async () => {
      const mockThread = {
        threadId: 't-1',
        authorIdentityId: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      policyEvaluator.evaluate.mockResolvedValue(true);

      await expect(
        service.updateThread('t-1', identityId, orgId, positionId, { title: 'Hacked' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(policyEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it('переключает реакцию темы', async () => {
      threadRepo.findById.mockResolvedValue({ threadId: 't-1' });
      threadRepo.toggleReaction.mockResolvedValue({ reactions: 5, hasLiked: true });

      const result = await service.toggleThreadReaction('t-1', identityId);
      expect(result).toEqual({ reactions: 5, hasLiked: true });
    });

    it('закрепляет тему модератором своей организации', async () => {
      const mockThread = {
        threadId: 't-1',
        pinned: true,
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      threadRepo.update.mockResolvedValue(mockThread);

      const result = await service.pinThread('t-1', orgId, true);
      expect(result.pinned).toBe(true);
    });

    it('запрещает закреплять чужую тему', async () => {
      const mockThread = {
        threadId: 't-1',
        organizationId: new Types.ObjectId(),
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);

      await expect(service.pinThread('t-1', orgId, true)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });
  });

  // ─── Ответы (Replies) ────────────────────────────────────────────────────────

  describe('replies', () => {
    it('создаёт ответ и инкрементирует replyCount в теме', async () => {
      threadRepo.findById.mockResolvedValue({ threadId: 't-1', locked: false });
      const mockReply = {
        replyId: 'r-1',
        threadId: 't-1',
        body: 'Ответ',
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
      } as CommunityReplyDocument;
      replyRepo.create.mockResolvedValue(mockReply);

      const result = await service.createReply({
        threadId: 't-1',
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-reply-1',
        data: { body: 'Ответ' },
      });

      expect(replyRepo.create).toHaveBeenCalled();
      expect(threadRepo.incrementReplyCount).toHaveBeenCalledWith('t-1', 1, expect.anything());
      expect(outboxService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'CommunityReplyCreated',
          aggregateType: 'CommunityReply',
        }),
        expect.anything(),
      );
      expect(result.id).toBe('r-1');
    });

    it('N-08: подписывает ответ реальным именем автора и названием организации', async () => {
      threadRepo.findById.mockResolvedValue({ threadId: 't-1', locked: false });
      organizationsService.getPositionSummary.mockResolvedValue({
        fixedRole: 'manager',
        currentOccupantName: 'Мария Ким',
      });
      organizationsService.getOrganizationById.mockResolvedValue({ name: 'Сити Экспресс', type: 'agency' });
      replyRepo.create.mockResolvedValue({
        replyId: 'r-real-author',
        threadId: 't-1',
        body: 'Ответ',
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
      } as CommunityReplyDocument);

      await service.createReply({
        threadId: 't-1',
        organizationId: orgId,
        positionId,
        identityId,
        idempotencyKey: 'idem-reply-real-author',
        data: { body: 'Ответ' },
      });

      expect(replyRepo.create.mock.calls[0]![0].authorSnapshot).toEqual({
        name: 'Мария Ким',
        company: 'Сити Экспресс',
        segment: 'broker',
        role: 'member',
        badges: ['Участник'],
      });
    });

    it('принимает ответ как лучший автором темы', async () => {
      threadRepo.findById.mockResolvedValue({
        threadId: 't-1',
        authorIdentityId: identityId,
      });
      const mockAccepted = {
        replyId: 'r-1',
        threadId: 't-1',
        authorIdentityId: new Types.ObjectId(),
        authorPositionId: new Types.ObjectId(),
        organizationId: orgId,
        isBest: true,
      } as CommunityReplyDocument;
      replyRepo.markAsBest.mockResolvedValue(mockAccepted);
      threadRepo.update.mockResolvedValue({ threadId: 't-1', solved: true });

      const result = await service.acceptReply('t-1', 'r-1', identityId);
      expect(replyRepo.markAsBest).toHaveBeenCalledWith('t-1', 'r-1', expect.anything());
      expect(threadRepo.update).toHaveBeenCalledWith('t-1', { solved: true }, expect.anything());
      expect(result.isBest).toBe(true);
    });

    it('запрещает принимать ответ не-автору темы', async () => {
      threadRepo.findById.mockResolvedValue({
        threadId: 't-1',
        authorIdentityId: new Types.ObjectId(),
      });

      await expect(service.acceptReply('t-1', 'r-1', identityId)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });
  });

  // ─── Биржа MLS (Exchange) ───────────────────────────────────────────────────

  describe('exchange', () => {
    it('обновляет статус сделки и публикует Outbox событие', async () => {
      const mockThread = {
        threadId: 'ex-1',
        authorIdentityId: identityId,
        authorPositionId: positionId,
        organizationId: orgId,
        type: 'exchange',
        exchange: { status: 'open' },
      } as CommunityThreadDocument;
      threadRepo.findById.mockResolvedValue(mockThread);
      threadRepo.updateExchangeStatus.mockResolvedValue({
        ...mockThread,
        exchange: { status: 'closed' },
      });

      const result = await service.updateExchangeStatus('ex-1', identityId, false, 'closed');
      expect(result.exchange?.status).toBe('closed');
      expect(outboxService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ExchangeDealStatusChanged',
          aggregateType: 'CommunityThread',
        }),
        expect.anything(),
      );
    });
  });

  // ─── Мероприятия (Events) ───────────────────────────────────────────────────

  describe('events', () => {
    it('возвращает список мероприятий с флагом участия', async () => {
      eventRepo.findUpcoming.mockResolvedValue({
        items: [
          {
            eventId: 'ev-1',
            attendeeIdentityIds: [identityId],
            attendeeCount: 1,
          },
        ],
        total: 1,
      });

      const result = await service.listEvents({}, identityId);
      expect(result.items![0]!.isAttending).toBe(true);
    });

    it('переключает участие в мероприятии', async () => {
      eventRepo.findById.mockResolvedValue({ eventId: 'ev-1' });
      eventRepo.toggleAttendance.mockResolvedValue({
        attending: true,
        attendeeCount: 10,
      });

      const result = await service.toggleEventAttendance('ev-1', identityId);
      expect(result.attending).toBe(true);
    });
  });

  // ─── Лидерборд ─────────────────────────────────────────────────────────────

  describe('leaderboard', () => {
    it('возвращает пустой список, пока рейтинг не считается из данных', async () => {
      await expect(service.getLeaderboard()).resolves.toEqual([]);
    });
  });
});
