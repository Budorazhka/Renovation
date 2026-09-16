import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomBytes, createHash } from 'node:crypto';
import { ClientSession, Connection, Types } from 'mongoose';
import { runInTransaction, runInTransactionOrReuse } from '../../shared/transactions/run-in-transaction';
import { OrganizationRepository } from './repository/organization.repository';
import { PositionRepository } from './repository/position.repository';
import { PositionProfileRepository } from './repository/position-profile.repository';
import { PositionAssignmentRepository } from './repository/position-assignment.repository';
import { InvitationRepository } from './repository/invitation.repository';
import { SessionService } from '../identity/session.service';
import { AuthService } from '../identity/auth.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { MarketplacePublicationRepository } from '@baza/publication';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { DEFAULT_ROLE_GRANTS } from './default-role-grants';
import type { OrganizationDocument, OrganizationType } from './schemas/organization.schema';
import type { FixedRole, PositionDocument } from './schemas/position.schema';
import type { PermissionScope } from '../authorization/schemas/permission-grant.schema';

/** Человек с его компанией — для экранов, где люди из разных организаций рядом (реферальная сеть). */
export interface PersonSummary {
  identityId: Types.ObjectId;
  login: string;
  name: string;
  positionId: Types.ObjectId | null;
  organizationId: Types.ObjectId | null;
  organizationName: string | null;
  organizationType: OrganizationType | null;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Что регистрация организации пишет в должность владельца: имени человека она не спрашивает. */
export const OWNER_PLACEHOLDER_NAME = 'Owner';

/**
 * Как показать человека в должности. Заглушка владельца — не имя. У независимого
 * риэлтора организация — это он сам («ИП Нино Беридзе»), берём её название; у
 * остальных без имени — null, вызывающий код решает сам (логин, «не назначен»).
 */
export function occupantDisplayName(
  currentOccupantName: string | null | undefined,
  organization: { name: string; type: OrganizationType } | null | undefined,
): string | null {
  const name = currentOccupantName?.trim();
  if (name && name !== OWNER_PLACEHOLDER_NAME) return name;
  if (organization?.type === 'independent_realtor') return organization.name.trim() || null;
  return null;
}

/**
 * Транзакционный command-слой Organizations/Positions/Assignments (ADR-003, C-06).
 * Каждая команда, меняющая более одного документа, выполняется в единой
 * MongoDB-транзакции (ADR-006) — не последовательными независимыми записями.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly organizationRepository: OrganizationRepository,
    private readonly positionRepository: PositionRepository,
    private readonly positionProfileRepository: PositionProfileRepository,
    private readonly positionAssignmentRepository: PositionAssignmentRepository,
    private readonly invitationRepository: InvitationRepository,
    private readonly sessionService: SessionService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly policyEvaluator: PolicyEvaluatorService,
    private readonly publicationRepository: MarketplacePublicationRepository,
  ) {}

  /**
   * permission-matrix.md разд.1: "Роль на Position задаёт СТАРТОВЫЙ набор
   * grants при создании позиции" — найдено реальным E2E-прогоном (не
   * гипотетически), что без этого вызова ни один PermissionGrant никогда
   * не создавался ни для одной Position, deny-by-default PolicyEvaluatorService
   * отклонял ЛЮБОЙ authenticated ERP-запрос даже для владельца организации.
   * ПОСЛЕ коммита транзакции создания Position — тот же принцип, что уже
   * применён к grantErpAccess (permission_grants — коллекция authorization-
   * модуля, ADR-001 модульная граница; риск временного рассинхрона
   * безопаснее в сторону недодоступа, не сверхдоступа).
   */
  private async grantDefaultRolePermissions(
    positionId: Types.ObjectId,
    fixedRole: FixedRole,
    session?: ClientSession,
  ): Promise<void> {
    const defaults = DEFAULT_ROLE_GRANTS[fixedRole];
    // grantMany — один insertMany вместо N последовательных round-trips
    // (second-opinion ревью: до 21 записи для owner).
    await this.policyEvaluator.grantMany(
      defaults.map((grant) => ({
        subjectType: 'position' as const,
        subjectId: positionId,
        resource: grant.resource,
        action: grant.action,
        scope: grant.scope,
      })),
      session,
    );
  }

  /**
   * Единственный способ для ДРУГИХ модулей узнать organization.type/status —
   * ADR-001 модульная граница запрещает импортировать OrganizationRepository
   * напрямую (test/architecture/module-boundaries.test.ts). Например,
   * DevelopmentsService.requireDeveloperOrganization (только застройщики
   * создают/публикуют ЖК).
   */
  async getOrganizationById(id: Types.ObjectId): Promise<OrganizationDocument | null> {
    return this.organizationRepository.findById(id);
  }

  /**
   * Тот же boundary-принцип, что getOrganizationById выше, для Position:
   * другие модули не могут импортировать PositionRepository напрямую
   * (ADR-001). Нужен, чтобы подписать чужой контент (например, тему
   * community) реальным именем автора, а не выдумкой — тот же
   * `currentOccupantName`, что уже показывает TeamService (team.service.ts,
   * TeamUserView.name), а не отдельный «профиль для форума».
   *
   * `null`, если позиция не найдена или чужой организации — вызывающий код
   * сам решает, как откатиться (не бросает NotFoundException: это
   * вспомогательное обогащение, не критичная проверка владения).
   */
  /**
   * Кто эти люди: имя, логин и компания — для реферальной сети BAZA, где
   * куратор и участники состоят в разных организациях. Boundary-метод:
   * репозитории позиций, назначений и Identity наружу не выходят.
   *
   * Имя — см. occupantDisplayName; у кого его нет (владелец агентства,
   * человек только с маркетплейса) — логин.
   */
  async getPeopleSummaries(identityIds: Types.ObjectId[]): Promise<PersonSummary[]> {
    if (identityIds.length === 0) return [];
    const [identities, assignments] = await Promise.all([
      this.authService.findByIds(identityIds),
      this.positionAssignmentRepository.findActiveByIdentities(identityIds),
    ]);
    const positions = await this.positionRepository.findByIds(assignments.map((a) => a.positionId));
    const organizations = await this.organizationRepository.findPublicByIds(assignments.map((a) => a.organizationId));

    const assignmentByIdentity = new Map(assignments.map((a) => [a.identityId.toString(), a]));
    const positionById = new Map(positions.map((p) => [p._id.toString(), p]));
    const organizationById = new Map(organizations.map((o) => [o.id.toString(), o]));

    return identities.map((identity) => {
      const assignment = assignmentByIdentity.get(identity.id.toString());
      const position = assignment ? positionById.get(assignment.positionId.toString()) : undefined;
      const organization = assignment ? organizationById.get(assignment.organizationId.toString()) : undefined;
      return {
        identityId: identity.id,
        login: identity.normalizedLogin,
        name: occupantDisplayName(position?.currentOccupantName, organization) ?? identity.normalizedLogin,
        positionId: assignment?.positionId ?? null,
        organizationId: organization?.id ?? null,
        organizationName: organization?.name ?? null,
        organizationType: organization?.type ?? null,
      };
    });
  }

  /**
   * Кто сидит в должностях и в каких компаниях — для админского раздела
   * «Комиссии», где сделки всех организаций в одном списке.
   */
  async describePositions(
    positionIds: Types.ObjectId[],
  ): Promise<Map<string, { occupantName: string | null; organizationName: string | null }>> {
    const positions = await this.positionRepository.findByIds(positionIds);
    const organizations = await this.organizationRepository.findPublicByIds(positions.map((p) => p.organizationId));
    const organizationById = new Map(organizations.map((o) => [o.id.toString(), o]));
    return new Map(
      positions.map((p) => [
        p._id.toString(),
        {
          occupantName: occupantDisplayName(p.currentOccupantName, organizationById.get(p.organizationId.toString())),
          organizationName: organizationById.get(p.organizationId.toString())?.name ?? null,
        },
      ]),
    );
  }

  /**
   * Сменить человеку имя в его должности — только из админки BAZA (решение
   * владельца 16.09.2026). null — действующей должности нет (человек только с
   * маркетплейса). Аудит пишет вызывающий код в той же транзакции.
   */
  async renameOccupantForPlatform(
    identityId: Types.ObjectId,
    name: string,
    session: ClientSession,
  ): Promise<{ positionId: Types.ObjectId; previousName: string | null } | null> {
    const assignment = await this.positionAssignmentRepository.findActiveByIdentity(identityId, session);
    if (!assignment) return null;
    const previous = await this.positionRepository.renameOccupant(assignment.positionId, assignment.organizationId, name, session);
    if (!previous) return null;
    return { positionId: previous._id, previousName: previous.currentOccupantName ?? null };
  }

  /** Кто сейчас занимает должность — для сделки, у которой известна только должность владельца. */
  async getActiveOccupantIdentityId(positionId: Types.ObjectId): Promise<Types.ObjectId | null> {
    const assignment = await this.positionAssignmentRepository.findActiveByPosition(positionId);
    return assignment?.identityId ?? null;
  }

  async getPositionSummary(
    positionId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<{ fixedRole: FixedRole; currentOccupantName?: string } | null> {
    const position = await this.positionRepository.findByIdForOrganization(positionId, organizationId);
    if (!position) return null;
    return { fixedRole: position.fixedRole, currentOccupantName: position.currentOccupantName };
  }

  /**
   * N-13: resolves the organization a Position belongs to, for a caller that
   * only has a bare positionId and needs it to look up an org-scoped record
   * elsewhere (RealtorReviewsService verifying a deal via
   * CrmService.getDealForOrganization, which requires organizationId
   * up front). System-actor lookup, no org filter here by definition — same
   * principle as MessengerAccountRepository.findByIdWithToken.
   */
  /**
   * Получатели рассылки новости компании (NewsService): люди, которые сейчас
   * занимают позиции этой организации. Boundary-метод, тот же принцип, что
   * getPositionSummary: PositionAssignmentRepository наружу не выходит.
   */
  async listActiveOccupantIdentityIds(organizationId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const assignments = await this.positionAssignmentRepository.findAllActiveByOrganization(organizationId);
    const unique = new Map(assignments.map((assignment) => [assignment.identityId.toString(), assignment.identityId]));
    return [...unique.values()];
  }

  /** Получатели рассылки новости платформы: все, кто сейчас работает в какой-либо организации. */
  async listAllActiveOccupantIdentityIds(): Promise<Types.ObjectId[]> {
    return this.positionAssignmentRepository.findActiveIdentityIds();
  }

  async getPositionOrganizationId(positionId: Types.ObjectId): Promise<Types.ObjectId | null> {
    const position = await this.positionRepository.findById(positionId);
    return position?.organizationId ?? null;
  }

  /**
   * Публичные поля организаций пачкой: id, название, тип.
   *
   * Нужно публичному каталогу marketplace, который показывает имя застройщика
   * или агентства рядом с объектом и умеет фильтровать по нему (решение
   * владельца от 04.09.2026: отдельных страниц компаний не будет, клик по
   * названию ведёт в отфильтрованный каталог).
   *
   * Отдельный метод, а не getOrganizationById в цикле: страница из двадцати
   * карточек стоила бы двадцать запросов. Тот же boundary-принцип, что у
   * getOrganizationById — PublicationModule не может импортировать
   * OrganizationRepository напрямую (ADR-001,
   * test/architecture/module-boundaries.test.ts).
   *
   * Возвращает ровно три поля: публичному контуру документ организации целиком
   * не нужен и не должен быть доступен.
   */
  async listPublicOrganizations(
    ids: Types.ObjectId[],
  ): Promise<Array<{ id: Types.ObjectId; name: string; type: OrganizationType }>> {
    return this.organizationRepository.findPublicByIds(ids);
  }

  /**
   * N-13 (owner decision 14.09.2026): публичная доска риэлторов
   * (PublicRealtorsService) — позиции без tenant-контекста по определению,
   * тот же cross-module boundary принцип, что listPublicOrganizations выше
   * (PositionRepository не экспортируется из этого модуля напрямую).
   * Фильтрация по типу организации/роли — внутри PositionRepository
   * .listPublicRealtors/.findByIdPublicRealtor (агрегация с $lookup).
   */
  async listPublicRealtorPositions(params: { cursor?: Types.ObjectId; city?: string; limit: number }): Promise<PositionDocument[]> {
    return this.positionRepository.listPublicRealtors(params);
  }

  async getPublicRealtorPosition(positionId: Types.ObjectId): Promise<PositionDocument | null> {
    return this.positionRepository.findByIdPublicRealtor(positionId);
  }

  /** Пачкой, тот же принцип, что listPublicOrganizations — страница риэлторов не должна стоить N запросов. */
  async getPositionProfilesByIds(positionIds: Types.ObjectId[]) {
    return this.positionProfileRepository.findByPositionIds(positionIds);
  }

  /**
   * D-05B: единственный способ для ДРУГИХ модулей (CrmService.assignLead)
   * проверить, что Position — реальный, tenant-scoped, назначаемый
   * получатель (не чужая организация, не closed) — тот же boundary-принцип,
   * что getOrganizationById выше. NotFoundException — единый non-disclosure
   * код для "не существует" И "чужая организация" (тот же принцип, что
   * assignOccupant/findByIdForOrganization). vacant/occupied — оба
   * допустимы (занятая позиция — нормальный получатель лида), только
   * closed блокирует — ConflictException, не NotFoundException: позиция
   * реально найдена, просто не в подходящем состоянии (тот же паттерн,
   * что "Position is not vacant"/"Only a vacant position can be closed"
   * ниже по этому файлу).
   */
  async findAssignablePosition(
    positionId: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PositionDocument> {
    const position = await this.positionRepository.findByIdForOrganization(positionId, organizationId, session);
    if (!position) {
      throw new NotFoundException('Position not found');
    }
    if (position.status === 'closed') {
      throw new ConflictException('Position is closed and cannot be assigned');
    }
    return position;
  }

  /**
   * Регистрация организации сразу с owner-позицией, занятой создающей
   * identity — типичный onboarding flow (ERP-002 traceability, вопрос
   * open-decisions.md #1: заявка с ручным одобрением для агентства,
   * invite-only для застройщика — approval workflow здесь не входит,
   * это только техническая механика создания org+position+assignment
   * атомарно, командой более высокого уровня оборачивается при
   * реализации approval-очереди на Этапе 8).
   *
   * fixedRole первой позиции зависит от OrganizationType (ADR-016,
   * 27.08.2026, владелец подтвердил): `type:'developer'` → `fixedRole:
   * 'developer'`, иначе (agency/independent_realtor) → `fixedRole:'owner'`
   * как раньше. До этого фикса ЛЮБАЯ организация (включая developer)
   * получала владельца с `fixedRole:'owner'` — фронтенд-гейт
   * (dashboard-rail.tsx) уже требовал `role==='developer'` для раздела
   * «Девелопмент», значит ни один такой владелец не мог реально попасть в
   * свой собственный раздел через настоящий backend-путь.
   */
  async createOrganizationWithOwner(params: {
    type: OrganizationType;
    name: string;
    ownerIdentityId: Types.ObjectId;
    /** Имя владельца из регистрации; без него — заглушка OWNER_PLACEHOLDER_NAME. */
    ownerName?: string;
  }): Promise<{ organizationId: Types.ObjectId; positionId: Types.ObjectId }> {
    const ownerFixedRole: FixedRole = params.type === 'developer' ? 'developer' : 'owner';

    const result = await runInTransaction(this.connection, async (session) => {
      const organization = await this.organizationRepository.create(
        { type: params.type, name: params.name },
        session,
      );

      const ownerPosition = await this.positionRepository.create(
        { organizationId: organization._id, fixedRole: ownerFixedRole },
        session,
      );

      await this.positionAssignmentRepository.createAssignment(
        {
          identityId: params.ownerIdentityId,
          positionId: ownerPosition._id,
          organizationId: organization._id,
        },
        session,
      );

      await this.positionRepository.markOccupied(ownerPosition._id, params.ownerName?.trim() || OWNER_PLACEHOLDER_NAME, session);

      return { organizationId: organization._id, positionId: ownerPosition._id };
    });

    // ADR-003/ADR-004: тот же принцип, что assignOccupant ниже — owner
    // сразу занимает позицию при регистрации организации (минуя
    // assignOccupant), значит должен получить ProductAccess('erp') тем же
    // путём, иначе не сможет залогиниться в собственный только что
    // созданный ERP.
    await this.authService.grantErpAccess(params.ownerIdentityId);
    await this.grantDefaultRolePermissions(result.positionId, ownerFixedRole);

    return result;
  }

  /**
   * POST /organizations/register (публичный, OrganizationOnboardingController) —
   * реальный HTTP-путь для самостоятельной регистрации организации, которого
   * раньше не существовало (createOrganizationWithOwner вызывался ТОЛЬКО из
   * unit-тестов, найдено реальным E2E-прогоном D-07). Composite-команда:
   * (1) подтверждает владение уже существующей Identity паролем — между
   * POST /auth/register и этим вызовом сессии ещё нет (login с audience:'erp'
   * невозможен без ProductAccess, который этот же вызов и выдаёт), (2)
   * создаёт organization+owner-position+assignment+grants (уже существующая,
   * протестированная createOrganizationWithOwner, транзакционная логика не
   * дублируется), (3) сразу создаёт ERP-сессию — тот же tail, что
   * AuthService.login(), чтобы не заставлять клиента звать /auth/login
   * третьим отдельным шагом сразу после того, как ProductAccess только что
   * появился.
   *
   * Двойная регистрация той же identity (уже есть активный
   * PositionAssignment где-то) — явная, честная проверка ДО транзакции
   * (не полагается только на partial unique index в createAssignment,
   * который тоже сработал бы, но с менее понятным сообщением для этого
   * конкретного вызывающего сценария).
   */
  async registerOrganizationOwner(params: {
    login: string;
    password: string;
    type: OrganizationType;
    name: string;
    ownerName?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    organizationId: Types.ObjectId;
    positionId: Types.ObjectId;
    identityId: Types.ObjectId;
    sessionToken: string;
    sessionExpiresAt: Date;
  }> {
    const identityId = await this.authService.verifyCredentialsForOnboarding(params.login, params.password);

    const existingAssignment = await this.positionAssignmentRepository.findActiveByIdentity(identityId);
    if (existingAssignment) {
      throw new ConflictException('This identity already belongs to an organization');
    }

    const { organizationId, positionId } = await this.createOrganizationWithOwner({
      type: params.type,
      name: params.name,
      ownerIdentityId: identityId,
      ownerName: params.ownerName,
    });

    const session = await this.sessionService.createSession({
      identityId,
      productAudience: 'erp',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return {
      organizationId,
      positionId,
      identityId,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    };
  }

  /**
   * Создание вакантной позиции внутри уже существующей организации
   * (permission-matrix.md 1.4: position.create.organization — owner/director,
   * ⚙ administrator).
   */
  /**
   * `parentPositionId` обязан принадлежать той же организации, что и новая
   * позиция — без этой проверки (найдено 03.09.2026 внешним ревью)
   * аутентифицированный пользователь с правом `position.create` мог
   * передать id позиции из ЧУЖОЙ организации, и она молча становилась
   * родителем в дереве подчинённости своего тенанта — нарушение ADR-002
   * (tenant-escape), тот же принцип, что уже применён к `expectedOrganizationId`
   * в `grantPositionPermission` ниже.
   */
  async createVacantPosition(params: {
    organizationId: Types.ObjectId;
    fixedRole: FixedRole;
    parentPositionId?: Types.ObjectId;
    /** Сессия внешней транзакции: позиция и её стартовые гранты обязаны появляться и исчезать вместе. */
    session?: ClientSession;
  }): Promise<Types.ObjectId> {
    if (params.parentPositionId) {
      const parent = await this.positionRepository.findByIdForOrganization(
        params.parentPositionId,
        params.organizationId,
        params.session,
      );
      if (!parent) {
        throw new NotFoundException('Parent position not found');
      }
    }
    const position = await this.positionRepository.create(params, params.session);
    await this.grantDefaultRolePermissions(position._id, params.fixedRole, params.session);
    return position._id;
  }

  /**
   * permission-matrix.md 1.4 `personal_access.grant.position` (owner/
   * director) — explicit per-position ⚙-toggle grant поверх стартового
   * default-набора (owner decision xlsx #53: manager unit.price.update
   * "тумблер"; xlsx #24: administrator position.*). НЕ bulk-замена всего
   * набора — один grant за вызов, тот же принцип, что
   * AdminAccountService.grantPermission (D-06).
   *
   * expectedOrganizationId (ADR-002 требование 1): tenant-escape prevention
   * — позиция должна реально принадлежать организации вызывающего.
   */
  async grantPositionPermission(params: {
    positionId: Types.ObjectId;
    expectedOrganizationId: Types.ObjectId;
    resource: string;
    action: string;
    scope: PermissionScope;
    scopeValue?: string;
  }): Promise<void> {
    const position = await this.positionRepository.findByIdForOrganization(
      params.positionId,
      params.expectedOrganizationId,
    );
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    await this.policyEvaluator.grant({
      subjectType: 'position',
      subjectId: params.positionId,
      resource: params.resource,
      action: params.action,
      scope: params.scope,
      scopeValue: params.scopeValue,
    });
  }

  /**
   * assignOccupant (ADR-003): занимает вакантную позицию конкретной identity.
   * Транзакционно: создание PositionAssignment + пометка Position occupied +
   * audit-запись + outbox-событие PositionOccupantAssigned — всё в одной
   * MongoDB-транзакции (ADR-006). Partial unique index (ADR-003) физически
   * предотвращает занятие уже занятой позиции или второе назначение той же
   * identity — конфликт всплывает как ConflictException из
   * PositionAssignmentRepository, транзакция откатывается целиком (включая
   * audit/outbox записи — они не "утекают" при откате).
   *
   * permission-matrix.md 1.4: position.assign_occupant.organization —
   * critical action (раздел 4) → audit обязателен, не опционален.
   *
   * expectedOrganizationId (ADR-002 требование 1, tenant escape prevention):
   * вызывающий код (controller) обязан передать organizationId из
   * VerifiedTenantContext — НЕ из URL/body клиента. Эта проверка — не
   * дублирование controller-проверки URL-параметра, а единственная
   * гарантия, реально привязанная к данным: она сверяет заявленный tenant
   * с organizationId, фактически хранящимся на найденной по positionId
   * записи, а не просто с текстом в адресной строке.
   */
  async assignOccupant(params: {
    positionId: Types.ObjectId;
    identityId: Types.ObjectId;
    occupantDisplayName: string;
    actorIdentityId: Types.ObjectId;
    expectedOrganizationId: Types.ObjectId;
    correlationId: string;
    /**
     * Сессия внешней транзакции. Когда она передана, назначение становится
     * шагом более крупной команды (createOccupiedPosition) и не коммитится
     * само по себе, а выдачу ProductAccess делает вызывающий — после
     * коммита, как того требует ADR-001: `product_accesses` принадлежит
     * Identity-модулю и внутри транзакции Organizations ей не место.
     */
    session?: ClientSession;
  }): Promise<Types.ObjectId> {
    const assignmentId = await runInTransactionOrReuse(this.connection, params.session, async (session) => {
      // findByIdForOrganization (не findById) — session-aware чтение внутри
      // транзакции, не рассинхронизированное с последующими write в том же
      // session (second-opinion ревью: findById без session — потенциальный
      // stale-read внутри транзакции).
      const position = await this.positionRepository.findByIdForOrganization(
        params.positionId,
        params.expectedOrganizationId,
        session,
      );
      if (!position) {
        // Один и тот же NOT_FOUND для "не существует" и "существует, но в
        // чужой организации" — не раскрываем cross-tenant существование
        // (error-catalog.md: NOT_FOUND, тот же паттерн, что и controller-
        // проверка URL-параметра выше).
        throw new NotFoundException('Position not found');
      }
      if (position.status !== 'vacant') {
        // Second-opinion ревью нашло реальный пробел: без этой проверки
        // closed-позицию можно было "воскресить" назначением occupant'а —
        // partial unique index на positionId защищает только от повторного
        // занятия УЖЕ occupied позиции (createAssignment ниже упал бы
        // ConflictException), но closed не имеет активного assignment,
        // поэтому индекс её не защищает.
        throw new ConflictException('Position is not vacant');
      }

      const identityExists = (await this.authService.findByIds([params.identityId])).length > 0;
      if (!identityExists) {
        throw new NotFoundException('Identity not found');
      }

      const assignment = await this.positionAssignmentRepository.createAssignment(
        {
          identityId: params.identityId,
          positionId: params.positionId,
          organizationId: position.organizationId,
        },
        session,
      );

      await this.positionRepository.markOccupied(params.positionId, params.occupantDisplayName, session);

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'position.assign_occupant',
          resource: 'position_assignment',
          resourceId: assignment._id,
          after: {
            positionId: params.positionId.toString(),
            identityId: params.identityId.toString(),
            organizationId: position.organizationId.toString(),
          },
          correlationId: params.correlationId,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'PositionOccupantAssigned',
          aggregateType: 'position',
          aggregateId: params.positionId,
          payload: {
            assignmentId: assignment._id.toString(),
            identityId: params.identityId.toString(),
            organizationId: position.organizationId.toString(),
          },
          // Явный ключ: одна и та же позиция может занимать/освобождаться
          // многократно за время жизни системы — deduplicationKey должен
          // включать assignmentId, иначе второе занятие той же позиции
          // (после vacate) молча схлопнется с первым событием по умолчательному
          // ключу `position:{positionId}:PositionOccupantAssigned`.
          deduplicationKey: `position_assignment:${assignment._id.toString()}:PositionOccupantAssigned`,
        },
        session,
      );

      return assignment._id;
    });

    // ADR-003/ADR-004: "создание позиции автоматически подразумевает
    // ProductAccess к ERP для этой identity" — ПОСЛЕ коммита транзакции,
    // не внутри неё. Тот же принцип модульных границ, что уже применён
    // ниже к revokeAllErpSessions в vacatePosition (см. её комментарий):
    // product_accesses — коллекция Identity-модуля, не Organizations,
    // смешивать запись в чужую коллекцию внутри этой транзакции нарушало
    // бы ADR-001. Здесь риск временного рассинхрона даже безопаснее, чем
    // у revoke: если grantErpAccess упадёт после успешного assignOccupant,
    // человек просто ещё на несколько мгновений не сможет залогиниться в
    // ERP — не "получит доступ, которого не должно быть".
    //
    // Внутри внешней транзакции этот шаг пропускается: она ещё не
    // закоммичена, и «после коммита» здесь означало бы «до». Вызывающий
    // делает его сам, когда транзакция завершится.
    if (!params.session) {
      await this.authService.grantErpAccess(params.identityId);
    }

    return assignmentId;
  }

  /**
   * teamApi.ts::assignOccupant(positionId, {name, email, loginEmail, phone?,
   * telegram?}) — email-based invite-flow, обёртка над уже существующим
   * assignOccupant(identityId), не дублирует его транзакционную логику.
   * Identity резолвится ВНЕ транзакции через AuthService.findOrCreatePendingIdentity
   * (создание Identity — коллекция Identity-модуля, ADR-001 модульная
   * граница, тот же принцип, что grantErpAccess ПОСЛЕ коммита в других
   * командах этого файла — здесь ДО, потому что assignOccupant ниже требует
   * уже существующий identityId как обязательный параметр).
   *
   * assignOccupant и (для новой identity) создание Invitation — ОДНОЙ
   * транзакцией: обе коллекции принадлежат Organizations, ADR-001 здесь не
   * нарушается. ИСПРАВЛЕНО 11.09.2026: раньше Invitation создавался вторым,
   * не связанным шагом после уже закоммиченного assignOccupant — падение
   * между ними оставляло занятую позицию с грантами и ERP-доступом, но без
   * Invitation, то есть без способа поставить пароль и войти (тот же класс
   * ошибки, что уже был исправлен для createOccupiedPosition, см.
   * team-user-atomicity.md). Теперь оба шага в одной сессии: либо оба, либо
   * ни одного.
   *
   * Для НОВОЙ identity (isNew:true) — Invitation с одноразовым токеном (TTL
   * 7 дней). Приглашённый получает доступ к позиции сразу (grantErpAccess —
   * после коммита, ниже), но залогиниться не может, пока не поставит пароль
   * через POST /invite/:token/activate (login() отклоняет pending_invite
   * Identity явно, см. auth.service.ts).
   */
  async assignOccupantByEmail(params: {
    positionId: Types.ObjectId;
    name: string;
    email: string;
    loginEmail: string;
    actorIdentityId: Types.ObjectId;
    expectedOrganizationId: Types.ObjectId;
    correlationId: string;
  }): Promise<{ assignmentId: Types.ObjectId; linkedExisting: boolean; inviteToken: string | null; inviteTokenExpiresAt: Date | null }> {
    const { identityId, isNew } = await this.authService.findOrCreatePendingIdentity(params.loginEmail);

    // Сырой токен — только в ответе клиенту (менеджер копирует ссылку) и в
    // теле письма/чата, никогда не в БД (та же причина, что sessionToken/
    // hashed cookie-паттерн в SessionService) — hash сравнивается на
    // activate, не сырой токен. Генерируется до транзакции: чистая функция,
    // не даёт транзакции ничего, кроме повода быть длиннее.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const assignmentId = await runInTransaction(this.connection, async (session) => {
      const id = await this.assignOccupant({
        positionId: params.positionId,
        identityId,
        occupantDisplayName: params.name,
        actorIdentityId: params.actorIdentityId,
        expectedOrganizationId: params.expectedOrganizationId,
        correlationId: params.correlationId,
        session,
      });

      if (isNew) {
        await this.invitationRepository.create(
          {
            organizationId: params.expectedOrganizationId,
            positionId: params.positionId,
            identityId,
            tokenHash,
            email: params.email,
            expiresAt,
          },
          session,
        );
      }

      return id;
    });

    // ProductAccess — коллекция Identity-модуля, поэтому после коммита, а не
    // внутри него (ADR-001). assignOccupant с переданной session этот шаг
    // сама пропускает (см. её комментарий про params.session) и оставляет
    // его вызывающему — тот же паттерн, что createOccupiedPosition.
    await this.authService.grantErpAccess(identityId);

    if (!isNew) {
      return { assignmentId, linkedExisting: true, inviteToken: null, inviteTokenExpiresAt: null };
    }

    return { assignmentId, linkedExisting: false, inviteToken: rawToken, inviteTokenExpiresAt: expiresAt };
  }

  /**
   * POST /invite/:token/activate (публичный, InvitationController) —
   * приглашённый ставит себе пароль впервые. Единый ошибочный код
   * (410 GONE через AppException) для "не найден"/"уже активирован"/
   * "истёк" — не раскрываем гостю, какой из трёх случаев произошёл (тот же
   * non-disclosure принцип, что везде в auth-модуле), кроме единственного
   * различимого случая, где раскрытие безопасно и полезно клиенту
   * (истёкший токен — тот же UI-текст "ссылка недействительна", что и
   * прочие случаи, так что различение здесь не требуется вызывающему коду
   * фронтенда — activateInvite() возвращает только {activated, email}).
   */
  async activateInvitation(rawToken: string, password: string): Promise<{ email: string }> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitation = await this.invitationRepository.findByTokenHash(tokenHash);

    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt.getTime() < Date.now()) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Invitation link is invalid or has expired');
    }

    const { activated } = await this.authService.activatePendingIdentity(invitation.identityId, password);
    if (!activated) {
      // Гонка: другой запрос активировал ту же Identity между проверкой
      // invitation.status выше и этим вызовом — тот же класс TOCTOU, что
      // endAssignment/updateParent в этом файле.
      throw new AppException(ErrorCode.NOT_FOUND, 'Invitation link is invalid or has expired');
    }

    await this.invitationRepository.markActivated(invitation._id);

    return { email: invitation.email };
  }

  /**
   * vacatePosition (ADR-003): закрывает assignment, освобождает позицию,
   * немедленно отзывает все ERP-сессии этой identity — всё в одной
   * транзакции. Лиды/клиенты/задачи, привязанные к ownerPositionId,
   * НЕ трогаются здесь (они остаются на Position согласно ADR-003 —
   * это прямое следствие модели, не отдельное действие этой команды).
   *
   * audit + outbox (ДОБАВЛЕНО, second-opinion ревью): permission-matrix.md
   * помечает position.vacate.organization как ⚙-критичное действие — тот же
   * статус, что assignOccupant, симметрично которому эти записи были
   * пропущены здесь изначально, не намеренно.
   *
   * Revoke сессий выполняется ВНЕ транзакции (после коммита) — то же
   * решение, что и у assignOccupant/grantErpAccess выше по файлу: sessions —
   * коллекция модуля Identity, а не Organizations, смешивать запись в чужую
   * коллекцию внутри транзакции этого модуля нарушало бы ADR-001 модульные
   * границы. Если revoke здесь упадёт после успешного коммита vacatePosition —
   * assignment уже закрыт корректно, но сессия могла остаться активной
   * короткое время; это приемлемый компромисс между модульной изоляцией и
   * строгой атомарностью, задокументированный явно, не случайный пробел.
   */
  async vacatePosition(params: {
    assignmentId: Types.ObjectId;
    identityId: Types.ObjectId;
    positionId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    organizationId: Types.ObjectId;
    correlationId: string;
    handoverNote?: string;
  }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const { matchedCount } = await this.positionAssignmentRepository.endAssignment(
        params.assignmentId,
        params.handoverNote,
        session,
      );
      if (matchedCount === 0) {
        // Конкурентный vacate того же assignment уже завершил его между
        // resolve (vacatePositionByPositionId) и этим вызовом — та же
        // семантика, что ConflictException в других TOCTOU-местах кодовой
        // базы (updatePriceWithVersionCheck и т.п.).
        throw new ConflictException('Assignment already ended');
      }
      await this.positionRepository.markVacant(params.positionId, session);

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'position.vacate',
          resource: 'position_assignment',
          resourceId: params.assignmentId,
          before: { identityId: params.identityId.toString(), positionId: params.positionId.toString() },
          correlationId: params.correlationId,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'PositionVacated',
          aggregateType: 'position',
          aggregateId: params.positionId,
          payload: {
            assignmentId: params.assignmentId.toString(),
            identityId: params.identityId.toString(),
            organizationId: params.organizationId.toString(),
          },
          // Тот же принцип, что PositionOccupantAssigned выше: assignmentId
          // в ключе, не только positionId — позиция может освобождаться
          // многократно за время жизни системы.
          deduplicationKey: `position_assignment:${params.assignmentId.toString()}:PositionVacated`,
        },
        session,
      );
    });

    // Revoke сессий — намеренно ПОСЛЕ коммита транзакции, не внутри неё:
    // sessions — коллекция модуля Identity, а не Organizations; смешивать
    // запись в чужую коллекцию внутри транзакции этого модуля нарушало бы
    // ADR-001 модульные границы (общение между модулями через сервисы,
    // не через совместное участие в одной transaction). Если revoke здесь
    // упадёт после успешного коммита vacatePosition — assignment уже закрыт
    // корректно, но сессия могла остаться активной короткое время; это
    // приемлемый компромисс между модульной изоляцией и строгой атомарностью,
    // задокументированный явно, не случайный пробел.
    await this.sessionService.revokeAllErpSessions(params.identityId);
  }

  /**
   * teamApi.ts::vacate(positionId) — HTTP-контракт фронтенда передаёт
   * только positionId (не знает assignmentId/identityId клиентской
   * стороной), в отличие от уже существующего vacatePosition(), который
   * ожидает все три явно. Эта обёртка резолвит недостающие параметры
   * tenant-scoped запросом, затем делегирует уже существующей
   * (протестированной) команде — не дублирует её транзакционную логику.
   */
  async vacatePositionByPositionId(params: {
    positionId: Types.ObjectId;
    expectedOrganizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
    handoverNote?: string;
  }): Promise<void> {
    const position = await this.positionRepository.findByIdForOrganization(
      params.positionId,
      params.expectedOrganizationId,
    );
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    const assignment = await this.positionAssignmentRepository.findActiveByPosition(params.positionId);
    if (!assignment) {
      throw new NotFoundException('No active assignment for this position');
    }

    await this.vacatePosition({
      assignmentId: assignment._id,
      identityId: assignment.identityId,
      actorIdentityId: params.actorIdentityId,
      organizationId: params.expectedOrganizationId,
      correlationId: params.correlationId,
      positionId: params.positionId,
      handoverNote: params.handoverNote,
    });
  }

  /**
   * teamApi.ts::move(id, managerId) — сменить parentPositionId. null
   * допустим явно (top-level позиция). Защита от self-parent (позиция не
   * может быть родителем самой себя) — прямая, не полный graph-cycle
   * detection (позиция A → B → A транзитивно) — за пределами этой узкой
   * задачи, честно не реализовано, зафиксировано в evidence.
   */
  async changePositionParent(params: {
    positionId: Types.ObjectId;
    newParentPositionId: Types.ObjectId | null;
    expectedOrganizationId: Types.ObjectId;
  }): Promise<void> {
    const position = await this.positionRepository.findByIdForOrganization(
      params.positionId,
      params.expectedOrganizationId,
    );
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    if (params.newParentPositionId && params.newParentPositionId.equals(params.positionId)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Position cannot be its own parent');
    }

    if (params.newParentPositionId) {
      const newParent = await this.positionRepository.findByIdForOrganization(
        params.newParentPositionId,
        params.expectedOrganizationId,
      );
      if (!newParent) {
        throw new NotFoundException('New parent position not found');
      }
    }

    const { matchedCount } = await this.positionRepository.updateParent(
      params.positionId,
      params.newParentPositionId,
    );
    if (matchedCount === 0) {
      throw new NotFoundException('Position not found');
    }
  }

  /**
   * teamApi.ts::remove(id) — Position lifecycle "closed, ТОЛЬКО из vacant"
   * (domain-model.md Module 2). НЕ проверяет и не переносит дочерние
   * позиции (Position.parentPositionId === эта позиция) — если у закрытой
   * позиции остаются "осиротевшие" дочерние записи в оргструктуре, это
   * честно НЕ обработано в этом узком проходе (не запрошено, не входит в
   * scope "удалить пустую позицию").
   */
  async closePosition(params: {
    positionId: Types.ObjectId;
    expectedOrganizationId: Types.ObjectId;
  }): Promise<void> {
    const position = await this.positionRepository.findByIdForOrganization(
      params.positionId,
      params.expectedOrganizationId,
    );
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    if (position.fixedRole === 'owner') {
      // Second-opinion ревью нашло реальный, недокументированный риск:
      // закрытие единственной owner-позиции оставляет организацию без
      // владельца — тупик, поскольку создание новой позиции (position.create.
      // organization) само требует гранта owner/director, которого больше
      // ни у кого нет.
      throw new ConflictException('Owner position cannot be closed');
    }

    const { modifiedCount } = await this.positionRepository.markClosed(params.positionId);
    if (modifiedCount === 0) {
      // Позиция реально существует (только что найдена выше), но не vacant —
      // ConflictException, не NotFoundException (та же семантика, что
      // VERSION_CONFLICT в других optimistic-concurrency местах кодовой
      // базы: запись существует, просто не в том состоянии).
      throw new ConflictException('Only a vacant position can be closed — vacate it first');
    }
  }

  /**
   * ADMIN-ORG: Список организаций для админ-панели с пагинацией и фильтрами.
   */
  async adminListOrganizations(params: {
    type?: OrganizationType;
    status?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      name: string;
      type: OrganizationType;
      status: OrganizationDocument['status'];
      mlsVerified: boolean;
      createdAt: string;
      positionsCount?: number;
    }>;
    nextCursor?: string;
  }> {
    const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
    const cursorId = params.cursor && Types.ObjectId.isValid(params.cursor)
      ? new Types.ObjectId(params.cursor)
      : undefined;

    const docs = await this.organizationRepository.list({
      type: params.type,
      status: params.status,
      search: params.search,
      cursor: cursorId,
      limit: limit + 1,
    });

    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]?._id.toString() : undefined;

    const items = await Promise.all(
      pageDocs.map(async (doc) => {
        const positions = await this.positionRepository.findAllByOrganization(doc._id);
        return {
          id: doc._id.toString(),
          name: doc.name,
          type: doc.type,
          status: doc.status,
          mlsVerified: doc.mlsVerified,
          createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
          positionsCount: positions.length,
        };
      }),
    );

    return { items, nextCursor };
  }

  /**
   * ADMIN-ORG: Получение детальной карточки организации.
   */
  async adminGetOrganization(id: Types.ObjectId): Promise<{
    id: string;
    name: string;
    type: OrganizationType;
    status: OrganizationDocument['status'];
    mlsVerified: boolean;
    createdAt: string;
    positionsCount: number;
    positions: Array<{ id: string; role: FixedRole; status: string }>;
  }> {
    const org = await this.organizationRepository.findById(id);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const positions = await this.positionRepository.findAllByOrganization(org._id);

    return {
      id: org._id.toString(),
      name: org.name,
      type: org.type,
      status: org.status,
      mlsVerified: org.mlsVerified,
      createdAt: org.createdAt ? org.createdAt.toISOString() : new Date().toISOString(),
      positionsCount: positions.length,
      positions: positions.map((p) => ({
        id: p._id.toString(),
        role: p.fixedRole,
        status: p.status,
      })),
    };
  }

  /**
   * ADMIN-ORG: Заморозка организации при окончании подписки или нарушении.
   */
  async adminFreezeOrganization(params: {
    id: Types.ObjectId;
    reason: string;
    actorId: Types.ObjectId;
    correlationId?: string;
  }): Promise<{ id: string; status: 'frozen' }> {
    const org = await this.organizationRepository.findById(params.id);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const previousStatus = org.status;
    let hiddenPublications = 0;
    await runInTransaction(this.connection, async (session) => {
      await this.organizationRepository.updateStatus(params.id, 'frozen', session);
      // Решение владельца 11.09.2026: заморозка убирает объявления с
      // витрины. В той же транзакции, что и смена статуса: иначе возможен
      // отрезок, где организация уже заморожена, а её объявления ещё
      // продаются, и наоборот при откате.
      const { modifiedCount } = await this.publicationRepository.setPublisherFrozenForOrganization(
        params.id,
        true,
        session,
      );
      hiddenPublications = modifiedCount;
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: params.actorId },
          action: 'organization.freeze',
          resource: 'organization',
          resourceId: params.id,
          reason: params.reason,
          before: { status: previousStatus },
          after: { status: 'frozen', hiddenPublications },
          correlationId: params.correlationId ?? '',
        },
        session,
      );
    });

    return { id: params.id.toString(), status: 'frozen' };
  }

  /**
   * ADMIN-ORG: Разморозка организации.
   */
  async adminUnfreezeOrganization(params: {
    id: Types.ObjectId;
    reason: string;
    actorId: Types.ObjectId;
    correlationId?: string;
  }): Promise<{ id: string; status: 'active' }> {
    const org = await this.organizationRepository.findById(params.id);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const previousStatus = org.status;
    let restoredPublications = 0;
    await runInTransaction(this.connection, async (session) => {
      await this.organizationRepository.updateStatus(params.id, 'active', session);
      // Возврат на витрину ровно того, что было опубликовано до заморозки:
      // собственный status публикаций не трогался, поэтому восстанавливать
      // нечего, кроме снятия флага.
      const { modifiedCount } = await this.publicationRepository.setPublisherFrozenForOrganization(
        params.id,
        false,
        session,
      );
      restoredPublications = modifiedCount;
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: params.actorId },
          action: 'organization.unfreeze',
          resource: 'organization',
          resourceId: params.id,
          reason: params.reason,
          before: { status: previousStatus },
          after: { status: 'active', restoredPublications },
          correlationId: params.correlationId ?? '',
        },
        session,
      );
    });

    return { id: params.id.toString(), status: 'active' };
  }

  /**
   * ADMIN-ORG (N-10): верификация MLS — застройщик заявки биржи в любом
   * случае не видит (CommunityService гейтит по organization.type), поэтому
   * верифицировать его MLS-флаг бессмысленно и, скорее всего, ошибка
   * оператора — отклоняем явно, а не молча выставляем флаг без эффекта.
   */
  async adminVerifyMls(params: {
    id: Types.ObjectId;
    reason: string;
    actorId: Types.ObjectId;
    correlationId?: string;
  }): Promise<{ id: string; mlsVerified: true }> {
    const org = await this.organizationRepository.findById(params.id);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    if (org.type === 'developer') {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'MLS verification applies only to agency and independent_realtor organizations',
      );
    }

    await runInTransaction(this.connection, async (session) => {
      await this.organizationRepository.updateMlsVerified(params.id, true, session);
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: params.actorId },
          action: 'organization.mls_verify',
          resource: 'organization',
          resourceId: params.id,
          reason: params.reason,
          before: { mlsVerified: org.mlsVerified },
          after: { mlsVerified: true },
          correlationId: params.correlationId ?? '',
        },
        session,
      );
    });

    return { id: params.id.toString(), mlsVerified: true };
  }

  /** ADMIN-ORG (N-10): отзыв верификации MLS. */
  async adminRevokeMlsVerification(params: {
    id: Types.ObjectId;
    reason: string;
    actorId: Types.ObjectId;
    correlationId?: string;
  }): Promise<{ id: string; mlsVerified: false }> {
    const org = await this.organizationRepository.findById(params.id);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    await runInTransaction(this.connection, async (session) => {
      await this.organizationRepository.updateMlsVerified(params.id, false, session);
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: params.actorId },
          action: 'organization.mls_revoke',
          resource: 'organization',
          resourceId: params.id,
          reason: params.reason,
          before: { mlsVerified: org.mlsVerified },
          after: { mlsVerified: false },
          correlationId: params.correlationId ?? '',
        },
        session,
      );
    });

    return { id: params.id.toString(), mlsVerified: false };
  }
}
