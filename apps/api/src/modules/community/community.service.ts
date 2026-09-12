import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { OutboxService } from '../outbox/outbox.service';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { OrganizationType } from '../organizations/schemas/organization.schema';
import { CommunitySectionRepository } from './repository/community-section.repository';
import { CommunityThreadRepository } from './repository/community-thread.repository';
import { CommunityReplyRepository } from './repository/community-reply.repository';
import { CommunityEventRepository } from './repository/community-event.repository';
import {
  CreateCommunityThreadDto,
  UpdateCommunityThreadDto,
  CreateCommunityReplyDto,
  UpdateCommunityReplyDto,
  ListCommunityThreadsQueryDto,
  ListCommunityRepliesQueryDto,
  ListCommunityEventsQueryDto,
} from './dto/community.dto';
import {
  RETIRED_SEED_EVENT_IDS,
  RETIRED_SEED_THREAD_IDS,
  SEED_COMMUNITY_SECTIONS,
} from './community-seed-data';
import type { CommunitySectionDocument } from './schemas/community-section.schema';
import type {
  CommunityThreadDocument,
  AuthorSnapshot,
  ExchangeStatus,
} from './schemas/community-thread.schema';
import type { CommunityReplyDocument } from './schemas/community-reply.schema';
import type { CommunityEventDocument } from './schemas/community-event.schema';

const DEFAULT_AUTHOR_SNAPSHOT: AuthorSnapshot = {
  name: 'Участник BAZA',
  role: 'member',
  badges: ['Участник'],
};

/**
 * Тип организации (Organization.type) в сегмент форума. Не совпадает с
 * ERP-ролью автора (owner/manager/…) — тот же принцип, что и раньше:
 * `role` в AuthorSnapshot остаётся 'member', сегмент говорит только «кто
 * это» (застройщик/агентство/частный риэлтор), не должность внутри неё.
 */
const SEGMENT_BY_ORGANIZATION_TYPE: Record<OrganizationType, string> = {
  developer: 'developer',
  agency: 'broker',
  independent_realtor: 'agent',
};

export function toCommunitySectionDto(doc: CommunitySectionDocument) {
  return {
    id: doc.sectionId,
    name: doc.name,
    kind: doc.kind,
    group: doc.group ?? undefined,
    icon: doc.icon,
    description: doc.description,
    threads: doc.threadCount,
  };
}

export function toCommunityThreadDto(doc: CommunityThreadDocument) {
  return {
    id: doc.threadId,
    type: doc.type,
    sectionId: doc.sectionId,
    title: doc.title,
    excerpt: doc.excerpt,
    body: doc.body,
    authorId: doc.authorIdentityId ? doc.authorIdentityId.toHexString() : 'system',
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
    views: doc.views,
    reactionCount: doc.reactions,
    replyCount: doc.replyCount,
    tags: doc.tags ?? [],
    pinned: doc.pinned ?? false,
    solved: doc.solved ?? false,
    locked: doc.locked ?? false,
    exchange: doc.exchange ?? null,
    author: doc.authorSnapshot,
  };
}

export function toCommunityReplyDto(doc: CommunityReplyDocument) {
  return {
    id: doc.replyId,
    threadId: doc.threadId,
    authorId: doc.authorIdentityId ? doc.authorIdentityId.toHexString() : 'system',
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
    reactionCount: doc.reactions,
    isBest: doc.isBest ?? false,
    body: doc.body,
    author: doc.authorSnapshot,
  };
}

export function toCommunityEventDto(doc: CommunityEventDocument, currentIdentityId?: Types.ObjectId) {
  const isAttending = currentIdentityId
    ? (doc.attendeeIdentityIds ?? []).some((id) => id.equals(currentIdentityId))
    : false;
  return {
    id: doc.eventId,
    title: doc.title,
    description: doc.description,
    date: doc.date,
    location: doc.location,
    format: doc.format,
    attendees: doc.attendeeCount,
    isAttending,
  };
}

@Injectable()
export class CommunityService implements OnModuleInit {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly sectionRepository: CommunitySectionRepository,
    private readonly threadRepository: CommunityThreadRepository,
    private readonly replyRepository: CommunityReplyRepository,
    private readonly eventRepository: CommunityEventRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly outboxService: OutboxService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * ИСПРАВЛЕНО 13.09.2026 (найдено ревью): раньше "модератор" внутри
   * updateThread/updateReply значил просто "тот же organizationId", без
   * проверки самого гранта — любой сотрудник с правом community_thread
   * .create (открывающим доступ к PATCH-эндпоинту вообще) мог поэтому
   * редактировать чужой контент коллег по организации. Теперь модератор —
   * это ещё и грант 'manage' у САМОЙ этой позиции; сверка организации
   * остаётся (community — межорганизационная площадка, 'manage' — грант
   * роли внутри своей организации, не полномочие над чужим контентом
   * другой организации).
   */
  private async canModerate(callerPositionId: Types.ObjectId, resource: 'community_thread' | 'community_reply') {
    return this.policyEvaluator.evaluate({
      subjectType: 'position',
      subjectId: callerPositionId,
      resource,
      action: 'manage',
    });
  }

  /**
   * N-10 (roadmap-2026-09.md, решение владельца 11.09.2026): биржу MLS
   * (`type:'exchange'`) видят и создают только проверенные агентства и
   * риэлторы. Застройщик не проходит вообще, независимо от
   * `mlsVerified` — решение владельца называет только «агентства и
   * риэлторы», без исключений. Несуществующая организация (не должно
   * происходить — organizationId всегда из проверенного tenantContext)
   * трактуется как неподходящая, не бросает — тот же принцип, что
   * buildAuthorSnapshot: это проверка права видеть контент, а не сама
   * попытка прочитать организацию.
   */
  private async isMlsEligible(organizationId: Types.ObjectId): Promise<boolean> {
    const organization = await this.organizationsService.getOrganizationById(organizationId);
    if (!organization || organization.type === 'developer') {
      return false;
    }
    return organization.mlsVerified;
  }

  async onModuleInit(): Promise<void> {
    await this.seedDefaultsIfEmpty();
  }

  /**
   * N-08 (11.09.2026): контроллер не передаёт снимок профиля вовсе, поэтому
   * каждая тема и ответ до этого коммита подписывались одним и тем же
   * DEFAULT_AUTHOR_SNAPSHOT — «Участник BAZA» без имени, даже у застройщика.
   * Здесь автор получает имя из `Position.currentOccupantName` (тот же
   * денормализованный источник, что показывает «Команда» в ERP,
   * team.service.ts::toView) и компанию из названия организации.
   *
   * Не бросает и не блокирует создание темы при сбое чтения — это
   * обогащение подписи, не проверка права публиковать. Пустое или ещё не
   * заполненное имя позиции (`currentOccupantName` пуст до первого явного
   * задания — тот же случай, что у только что созданного владельца
   * организации, team.service.ts) не должно подменяться дефолтным
   * «Участник BAZA», который создаёт видимость профиля: честнее оставить
   * компанию известной, а имя — общей подписью роли.
   */
  private async buildAuthorSnapshot(
    organizationId: Types.ObjectId,
    positionId: Types.ObjectId,
  ): Promise<AuthorSnapshot> {
    try {
      const [position, organization] = await Promise.all([
        this.organizationsService.getPositionSummary(positionId, organizationId),
        this.organizationsService.getOrganizationById(organizationId),
      ]);

      const name = position?.currentOccupantName?.trim();
      return {
        name: name && name.length > 0 ? name : DEFAULT_AUTHOR_SNAPSHOT.name,
        company: organization?.name,
        segment: organization ? SEGMENT_BY_ORGANIZATION_TYPE[organization.type] : undefined,
        role: DEFAULT_AUTHOR_SNAPSHOT.role,
        badges: DEFAULT_AUTHOR_SNAPSHOT.badges,
      };
    } catch (error) {
      this.logger.warn(`buildAuthorSnapshot failed, falling back to default: ${(error as Error).message}`);
      return DEFAULT_AUTHOR_SNAPSHOT;
    }
  }

  /**
   * Засевается только структура — разделы. Темы и мероприятия появляются от
   * настоящих участников; выдуманные записи прежнего засева удаляются по
   * фиксированным id (см. RETIRED_SEED_* в community-seed-data.ts). Обе
   * операции идемпотентны, поэтому без транзакции: прерванный старт доделает
   * следующий.
   */
  async seedDefaultsIfEmpty(): Promise<void> {
    try {
      await this.sectionRepository.seedSystemSectionsIfEmpty(SEED_COMMUNITY_SECTIONS);

      const retiredThreads = await this.threadRepository.deleteByThreadIds(RETIRED_SEED_THREAD_IDS);
      const retiredReplies = await this.replyRepository.deleteByThreadIds(RETIRED_SEED_THREAD_IDS);
      const retiredEvents = await this.eventRepository.deleteByEventIds(RETIRED_SEED_EVENT_IDS);
      if (retiredThreads + retiredReplies + retiredEvents > 0) {
        this.logger.log(
          `Removed fabricated seed content: threads=${retiredThreads}, replies=${retiredReplies}, events=${retiredEvents}`,
        );
      }
    } catch (error) {
      // ИСПРАВЛЕНО 10.09.2026: было catch {} — молча глушило любую ошибку,
      // включая реальные сбои сидирования в проде, не только штатный случай
      // неинициализированной реплики в юнит-тестах.
      this.logger.warn(`seedDefaultsIfEmpty failed, skipping: ${(error as Error).message}`);
    }
  }

  // ─── Разделы форума ──────────────────────────────────────────────────────────

  async getSections() {
    const sections = await this.sectionRepository.listAll();
    const groups = Array.from(
      new Set(
        sections
          .map((s) => s.group)
          .filter((g): g is string => typeof g === 'string' && g.length > 0),
      ),
    );
    return {
      sections: sections.map(toCommunitySectionDto),
      groups,
    };
  }

  async getSection(sectionId: string) {
    const section = await this.sectionRepository.findById(sectionId);
    if (!section) {
      throw new AppException(ErrorCode.NOT_FOUND, `Section '${sectionId}' not found`);
    }
    return toCommunitySectionDto(section);
  }

  // ─── Темы (треды) ──────────────────────────────────────────────────────────

  async listThreads(query: ListCommunityThreadsQueryDto, callerOrganizationId: Types.ObjectId) {
    const mlsEligible = await this.isMlsEligible(callerOrganizationId);

    // Явный запрос биржи от неподходящей организации — пустая страница, не
    // ошибка: тот же принцип, что и скрытие через NOT_FOUND у getThread,
    // просто для списка нет одного ресурса, которого "не существует".
    if (!mlsEligible && query.type === 'exchange') {
      const pageSize = query.pageSize ?? 20;
      return { items: [], total: 0, page: query.page ?? 1, pageSize, hasMore: false };
    }

    const result = await this.threadRepository.findPaginated(
      {
        sectionId: query.section,
        type: query.type,
        tag: query.tag,
        search: query.search,
        exchangeIntent: query.exchangeIntent,
        exchangeSide: query.exchangeSide,
        exchangeStatus: query.exchangeStatus,
        // Без явного type-фильтра список смешивает разделы — исключаем
        // exchange отдельно, иначе неподходящая организация увидела бы
        // заявки биржи в общей ленте/поиске в обход фильтра выше.
        excludeTypes: mlsEligible ? undefined : ['exchange'],
      },
      query.sort ?? 'active',
      query.page ?? 1,
      query.pageSize ?? 20,
    );

    return {
      items: result.items.map(toCommunityThreadDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    };
  }

  async getThread(threadId: string, callerOrganizationId: Types.ObjectId) {
    const thread = await this.threadRepository.findById(threadId);
    // NOT_FOUND единый для "не существует" и "биржа скрыта организации" —
    // тот же принцип, что тенантная изоляция в других модулях (не
    // раскрывать чужому существование записи через отдельный код ошибки).
    if (!thread || (thread.type === 'exchange' && !(await this.isMlsEligible(callerOrganizationId)))) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }
    // Async view increment
    this.threadRepository.incrementViews(threadId).catch(() => {});
    return toCommunityThreadDto(thread);
  }

  async createThread(params: {
    organizationId: Types.ObjectId;
    positionId: Types.ObjectId;
    identityId: Types.ObjectId;
    idempotencyKey?: string;
    data: CreateCommunityThreadDto;
    authorSnapshot?: AuthorSnapshot;
  }) {
    if (!params.idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const replay = await this.idempotencyService.checkReplay({
      identityId: params.identityId,
      operation: 'createCommunityThread',
      key: params.idempotencyKey,
      requestBody: params.data as unknown as Record<string, unknown>,
    });
    if (replay) {
      return replay.responseBody;
    }

    const section = await this.sectionRepository.findById(params.data.sectionId);
    if (!section) {
      throw new AppException(ErrorCode.NOT_FOUND, `Section '${params.data.sectionId}' not found`);
    }

    // N-10: кто не видит биржу — не может и публиковать в неё, иначе
    // застройщик или непроверенное агентство писало бы заявки, которые
    // сами не увидят, но которые всё равно попадут перед проверенными
    // организациями.
    if (params.data.type === 'exchange' && !(await this.isMlsEligible(params.organizationId))) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'MLS exchange is available only to verified agencies and independent realtors',
      );
    }

    const threadId = `th-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const excerpt =
      params.data.excerpt ||
      params.data.body.slice(0, 160).replace(/[#*_`]/g, '').trim();

    // N-08: имя и компания берутся из реальной позиции/организации автора
    // (buildAuthorSnapshot), не из выдуманного «Агентство недвижимости /
    // broker» — то накрутило бы профиль даже застройщику. params.authorSnapshot
    // остаётся seam'ом для тестов; в контроллере не передаётся ни разу.
    const snapshot: AuthorSnapshot =
      params.authorSnapshot ?? (await this.buildAuthorSnapshot(params.organizationId, params.positionId));

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const created = await this.threadRepository.create(
        {
          threadId,
          type: params.data.type,
          sectionId: params.data.sectionId,
          title: params.data.title,
          excerpt,
          body: params.data.body,
          authorIdentityId: params.identityId,
          authorPositionId: params.positionId,
          organizationId: params.organizationId,
          authorSnapshot: snapshot,
          tags: params.data.tags ?? [],
          pinned: false,
          exchange: params.data.exchange
            ? {
                intent: params.data.exchange.intent,
                side: params.data.exchange.side,
                dealKind: params.data.exchange.dealKind,
                location: params.data.exchange.location,
                amount: params.data.exchange.amount,
                commission: params.data.exchange.commission,
                deadline: params.data.exchange.deadline,
                status: params.data.exchange.status ?? 'open',
              }
            : undefined,
        },
        session,
      );

      await this.sectionRepository.incrementThreadCount(params.data.sectionId, 1, session);

      const response = toCommunityThreadDto(created);

      await this.idempotencyService.record(
        {
          identityId: params.identityId,
          operation: 'createCommunityThread',
          key: params.idempotencyKey!,
          requestBody: params.data as unknown as Record<string, unknown>,
          responseStatus: 201,
          responseBody: response as unknown as Record<string, unknown>,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'CommunityThreadCreated',
          aggregateType: 'CommunityThread',
          aggregateId: created._id,
          payload: {
            threadId: created.threadId,
            type: created.type,
            sectionId: created.sectionId,
            title: created.title,
            authorIdentityId: params.identityId.toHexString(),
            organizationId: params.organizationId.toHexString(),
          },
          deduplicationKey: `CommunityThread:${created.threadId}:created`,
        },
        session,
      );

      return response;
    });
  }

  async updateThread(
    threadId: string,
    identityId: Types.ObjectId,
    callerOrganizationId: Types.ObjectId,
    callerPositionId: Types.ObjectId,
    data: UpdateCommunityThreadDto,
  ) {
    const thread = await this.threadRepository.findById(threadId);
    if (!thread) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }

    const isAuthor = thread.authorIdentityId.equals(identityId);
    const sameOrg = thread.organizationId.equals(callerOrganizationId);
    const isModerator = !isAuthor && sameOrg && (await this.canModerate(callerPositionId, 'community_thread'));
    if (!isAuthor && !isModerator) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only author or moderator can update thread');
    }

    const patch: Partial<Pick<CommunityThreadDocument, 'title' | 'excerpt' | 'body' | 'tags' | 'pinned' | 'solved' | 'locked' | 'exchange'>> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.body !== undefined) patch.body = data.body;
    if (data.excerpt !== undefined) patch.excerpt = data.excerpt;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.solved !== undefined) patch.solved = data.solved;
    if (isModerator) {
      if (data.pinned !== undefined) patch.pinned = data.pinned;
      if (data.locked !== undefined) patch.locked = data.locked;
    }
    if (data.exchange !== undefined) {
      patch.exchange = {
        intent: data.exchange.intent,
        side: data.exchange.side,
        dealKind: data.exchange.dealKind,
        location: data.exchange.location,
        amount: data.exchange.amount,
        commission: data.exchange.commission,
        deadline: data.exchange.deadline,
        status: data.exchange.status ?? 'open',
      };
    }

    const updated = await this.threadRepository.update(threadId, patch);
    return toCommunityThreadDto(updated!);
  }

  async deleteThread(threadId: string, identityId: Types.ObjectId, callerOrganizationId: Types.ObjectId) {
    const thread = await this.threadRepository.findById(threadId);
    if (!thread) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }

    const isAuthor = thread.authorIdentityId.equals(identityId);
    const isModerator = thread.organizationId.equals(callerOrganizationId);
    if (!isAuthor && !isModerator) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only author or moderator can delete thread');
    }

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const deleted = await this.threadRepository.delete(threadId, session);
      if (deleted) {
        await this.sectionRepository.incrementThreadCount(thread.sectionId, -1, session);
      }
      return { deleted };
    });
  }

  async toggleThreadReaction(threadId: string, identityId: Types.ObjectId) {
    const thread = await this.threadRepository.findById(threadId);
    if (!thread) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }
    return this.threadRepository.toggleReaction(threadId, identityId.toHexString());
  }

  async pinThread(threadId: string, callerOrganizationId: Types.ObjectId, pinned: boolean) {
    const thread = await this.threadRepository.findById(threadId);
    if (!thread) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }
    if (!thread.organizationId.equals(callerOrganizationId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only your own organization threads can be pinned');
    }
    const updated = await this.threadRepository.update(threadId, { pinned });
    if (!updated) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }
    return toCommunityThreadDto(updated);
  }

  // ─── Ответы (Replies) ────────────────────────────────────────────────────────

  async listReplies(
    threadId: string,
    query: ListCommunityRepliesQueryDto,
    callerOrganizationId: Types.ObjectId,
  ) {
    // Ответы биржевой заявки несут тот же PII-риск, что и сама заявка
    // (N-10) — без этой проверки неподходящая организация не видела бы
    // тему в списке/по id, но могла бы прочитать её ответы напрямую, зная
    // threadId.
    const thread = await this.threadRepository.findById(threadId);
    if (!thread || (thread.type === 'exchange' && !(await this.isMlsEligible(callerOrganizationId)))) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }

    const result = await this.replyRepository.findPaginatedByThread(
      threadId,
      query.sort ?? 'best_first',
      query.page ?? 1,
      query.pageSize ?? 20,
    );

    return {
      items: result.items.map(toCommunityReplyDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    };
  }

  async createReply(params: {
    threadId: string;
    organizationId: Types.ObjectId;
    positionId: Types.ObjectId;
    identityId: Types.ObjectId;
    idempotencyKey?: string;
    data: CreateCommunityReplyDto;
    authorSnapshot?: AuthorSnapshot;
  }) {
    if (!params.idempotencyKey) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required');
    }

    const replay = await this.idempotencyService.checkReplay({
      identityId: params.identityId,
      operation: 'createCommunityReply',
      key: params.idempotencyKey,
      requestBody: { threadId: params.threadId, ...params.data } as Record<string, unknown>,
    });
    if (replay) {
      return replay.responseBody;
    }

    const thread = await this.threadRepository.findById(params.threadId);
    // N-10: тот же принцип, что listReplies/getThread — не отвечать в
    // биржевую заявку тому, кому она вообще не показывается (NOT_FOUND, а
    // не FORBIDDEN — не подтверждаем существование чужой заявки).
    if (!thread || (thread.type === 'exchange' && !(await this.isMlsEligible(params.organizationId)))) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${params.threadId}' not found`);
    }
    if (thread.locked) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Thread is locked for new replies');
    }

    const replyId = `rep-${Date.now()}-${randomUUID().slice(0, 8)}`;
    // N-08: тот же реальный снимок, что createThread — см. его комментарий выше.
    const snapshot: AuthorSnapshot =
      params.authorSnapshot ?? (await this.buildAuthorSnapshot(params.organizationId, params.positionId));

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const created = await this.replyRepository.create(
        {
          replyId,
          threadId: params.threadId,
          authorIdentityId: params.identityId,
          authorPositionId: params.positionId,
          organizationId: params.organizationId,
          authorSnapshot: snapshot,
          body: params.data.body,
        },
        session,
      );

      await this.threadRepository.incrementReplyCount(params.threadId, 1, session);

      const response = toCommunityReplyDto(created);

      await this.idempotencyService.record(
        {
          identityId: params.identityId,
          operation: 'createCommunityReply',
          key: params.idempotencyKey!,
          requestBody: { threadId: params.threadId, ...params.data } as Record<string, unknown>,
          responseStatus: 201,
          responseBody: response as unknown as Record<string, unknown>,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'CommunityReplyCreated',
          aggregateType: 'CommunityReply',
          aggregateId: created._id,
          payload: {
            replyId: created.replyId,
            threadId: created.threadId,
            authorIdentityId: params.identityId.toHexString(),
            organizationId: params.organizationId.toHexString(),
          },
          deduplicationKey: `CommunityReply:${created.replyId}:created`,
        },
        session,
      );

      return response;
    });
  }

  async updateReply(
    replyId: string,
    identityId: Types.ObjectId,
    callerOrganizationId: Types.ObjectId,
    callerPositionId: Types.ObjectId,
    data: UpdateCommunityReplyDto,
  ) {
    const reply = await this.replyRepository.findById(replyId);
    if (!reply) {
      throw new AppException(ErrorCode.NOT_FOUND, `Reply '${replyId}' not found`);
    }

    const isAuthor = reply.authorIdentityId.equals(identityId);
    const sameOrg = reply.organizationId.equals(callerOrganizationId);
    const isModerator = !isAuthor && sameOrg && (await this.canModerate(callerPositionId, 'community_reply'));
    if (!isAuthor && !isModerator) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only author or moderator can update reply');
    }

    const updated = await this.replyRepository.update(replyId, data.body);
    return toCommunityReplyDto(updated!);
  }

  async deleteReply(replyId: string, identityId: Types.ObjectId, callerOrganizationId: Types.ObjectId) {
    const reply = await this.replyRepository.findById(replyId);
    if (!reply) {
      throw new AppException(ErrorCode.NOT_FOUND, `Reply '${replyId}' not found`);
    }

    const isAuthor = reply.authorIdentityId.equals(identityId);
    const isModerator = reply.organizationId.equals(callerOrganizationId);
    if (!isAuthor && !isModerator) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only author or moderator can delete reply');
    }

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const deleted = await this.replyRepository.delete(replyId, session);
      if (deleted) {
        await this.threadRepository.incrementReplyCount(reply.threadId, -1, session);
      }
      return { deleted };
    });
  }

  async toggleReplyReaction(replyId: string, identityId: Types.ObjectId) {
    const reply = await this.replyRepository.findById(replyId);
    if (!reply) {
      throw new AppException(ErrorCode.NOT_FOUND, `Reply '${replyId}' not found`);
    }
    return this.replyRepository.toggleReaction(replyId, identityId.toHexString());
  }

  async acceptReply(threadId: string, replyId: string, identityId: Types.ObjectId) {
    const thread = await this.threadRepository.findById(threadId);
    if (!thread) {
      throw new AppException(ErrorCode.NOT_FOUND, `Thread '${threadId}' not found`);
    }

    const isAuthor = thread.authorIdentityId.equals(identityId);
    if (!isAuthor) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only thread author can accept answer');
    }

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const accepted = await this.replyRepository.markAsBest(threadId, replyId, session);
      if (!accepted) {
        throw new AppException(ErrorCode.NOT_FOUND, `Reply '${replyId}' not found`);
      }
      await this.threadRepository.update(threadId, { solved: true }, session);
      return toCommunityReplyDto(accepted);
    });
  }

  // ─── Биржа сделок MLS (Exchange) ─────────────────────────────────────────────

  async listExchangeDeals(query: ListCommunityThreadsQueryDto, callerOrganizationId: Types.ObjectId) {
    const exchangeQuery: ListCommunityThreadsQueryDto = {
      ...query,
      type: 'exchange',
    };
    return this.listThreads(exchangeQuery, callerOrganizationId);
  }

  async updateExchangeStatus(
    threadId: string,
    identityId: Types.ObjectId,
    isModerator: boolean,
    status: ExchangeStatus,
  ) {
    const thread = await this.threadRepository.findById(threadId);
    if (!thread || thread.type !== 'exchange') {
      throw new AppException(ErrorCode.NOT_FOUND, `Exchange deal '${threadId}' not found`);
    }

    const isAuthor = thread.authorIdentityId.equals(identityId);
    if (!isAuthor && !isModerator) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only author or moderator can update exchange status');
    }

    return runInTransaction(this.connection, async (session: ClientSession) => {
      const updated = await this.threadRepository.updateExchangeStatus(threadId, status, session);

      await this.outboxService.publish(
        {
          eventType: 'ExchangeDealStatusChanged',
          aggregateType: 'CommunityThread',
          aggregateId: thread._id,
          payload: {
            threadId,
            status,
            previousStatus: thread.exchange?.status ?? 'open',
            updatedByIdentityId: identityId.toHexString(),
          },
          deduplicationKey: `ExchangeDeal:${threadId}:${status}`,
        },
        session,
      );

      return toCommunityThreadDto(updated!);
    });
  }

  // ─── Мероприятия (Events) ────────────────────────────────────────────────────

  async listEvents(query: ListCommunityEventsQueryDto, currentIdentityId?: Types.ObjectId) {
    const { items, total } = await this.eventRepository.findUpcoming(
      query.page ?? 1,
      query.pageSize ?? 20,
    );

    return {
      items: items.map((ev) => toCommunityEventDto(ev, currentIdentityId)),
      total,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };
  }

  async getEvent(eventId: string, currentIdentityId?: Types.ObjectId) {
    const ev = await this.eventRepository.findById(eventId);
    if (!ev) {
      throw new AppException(ErrorCode.NOT_FOUND, `Event '${eventId}' not found`);
    }
    return toCommunityEventDto(ev, currentIdentityId);
  }

  async toggleEventAttendance(eventId: string, currentIdentityId: Types.ObjectId) {
    const ev = await this.eventRepository.findById(eventId);
    if (!ev) {
      throw new AppException(ErrorCode.NOT_FOUND, `Event '${eventId}' not found`);
    }
    return this.eventRepository.toggleAttendance(eventId, currentIdentityId);
  }

  // ─── Лидерборд и статистика ──────────────────────────────────────────────────

  /**
   * Рейтинга пока нет: до 11.09.2026 здесь отдавались три выдуманных человека
   * («Алексей Смирнов, Grand Realty, индекс доверия 98» и т.д.) всем
   * организациям как настоящий топ. Пустой список честнее, пока метрики
   * (решённые вопросы, со-брокинг) не считаются из данных.
   */
  async getLeaderboard(): Promise<never[]> {
    return [];
  }
}
