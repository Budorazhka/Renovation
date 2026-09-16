import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../identity/auth.service';
import { OrganizationsService, type PersonSummary } from '../organizations/organizations.service';
import { ReferralCuratorRepository } from './repository/referral-curator.repository';
import { ReferralMembershipRepository } from './repository/referral-membership.repository';
import { ReferralRequestRepository } from './repository/referral-request.repository';
import { CuratorAccrualRepository, type CuratorAccrualTotal } from './repository/curator-accrual.repository';
import type { ReferralCuratorDocument } from './schemas/referral-curator.schema';
import type {
  ReferralJoinedVia,
  ReferralMembershipDocument,
  ReferralMembershipStatus,
} from './schemas/referral-membership.schema';
import type {
  ReferralRequestDocument,
  ReferralRequestStatus,
  ReferralRequestType,
} from './schemas/referral-request.schema';
import type { CuratorAccrualDocument, CuratorAccrualStatus } from './schemas/curator-accrual.schema';
import {
  CURATOR_RATE_PERCENT,
  TEAM_SIZE_IDEAL_MAX,
  TEAM_SIZE_MIN,
  generateInviteCode,
  isCompanyCompatible,
  normalizeInviteCode,
  teamSizeStatus,
  type TeamSizeStatus,
} from './referral-rules';

/** Сколько раз пробуем выдать неповторяющийся код, прежде чем признать сбой. */
const INVITE_CODE_ATTEMPTS = 5;

/** Потолок журнала начислений в одном ответе. */
const ACCRUAL_PAGE_LIMIT = 200;

export interface PersonView {
  identityId: string;
  name: string;
  organizationName: string | null;
  organizationType: string | null;
}

/** Логин — только администратору: участникам сети чужая почта не нужна. */
export interface AdminPersonView extends PersonView {
  login: string;
}

export interface MoneyTotalsView {
  /** Начислено всего, без отменённых: `accrued` + `paid`. */
  earned: MoneyAmount[];
  paid: MoneyAmount[];
  /** К выплате: `accrued`. */
  due: MoneyAmount[];
}

export interface TeamMemberView<P extends PersonView = PersonView> {
  person: P;
  joinedAt: string;
  joinedVia: ReferralJoinedVia;
  status: Exclude<ReferralMembershipStatus, 'ended'>;
}

export interface CuratorNodeView<P extends PersonView = PersonView> {
  person: P;
  appointedAt: string;
  teamSize: number;
  teamStatus: TeamSizeStatus;
  members: TeamMemberView<P>[];
}

export interface AdminCuratorNodeView extends CuratorNodeView<AdminPersonView> {
  inviteCode: string;
  totals: MoneyTotalsView;
}

export interface TeamRulesView {
  ratePercent: number;
  teamSizeMin: number;
  teamSizeIdealMax: number;
}

export interface AdminNetworkTreeView {
  rules: TeamRulesView;
  curators: AdminCuratorNodeView[];
  summary: { curators: number; members: number; membersOnReview: number; pendingRequests: number };
}

export interface OrganizationNetworkView {
  rules: TeamRulesView;
  curators: CuratorNodeView[];
}

export interface AccrualView {
  id: string;
  curator: PersonView;
  member: PersonView;
  dealId: string;
  commission: MoneyAmount;
  ratePercent: number;
  amount: MoneyAmount;
  status: CuratorAccrualStatus;
  accruedAt: string;
  paidAt: string | null;
  reversedAt: string | null;
}

export interface ReferralRequestView {
  id: string;
  type: ReferralRequestType;
  applicant: PersonView;
  targetCurator: PersonView | null;
  reason: string;
  status: ReferralRequestStatus;
  decisionComment: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface MyNetworkView {
  rules: TeamRulesView;
  role: 'curator' | 'member' | 'none';
  curator: {
    inviteCode: string;
    node: CuratorNodeView;
    totals: MoneyTotalsView;
    accruals: AccrualView[];
  } | null;
  membership: {
    curator: PersonView;
    joinedAt: string;
    status: Exclude<ReferralMembershipStatus, 'ended'>;
    /** Начисления куратору с моих сделок — без денег BAZA, только то, что пошло куратору. */
    accruals: AccrualView[];
  } | null;
  requests: ReferralRequestView[];
}

export interface MembershipHistoryView {
  curator: PersonView;
  status: ReferralMembershipStatus;
  joinedAt: string;
  joinedVia: ReferralJoinedVia;
  endedAt: string | null;
  endReason: string | null;
  note: string | null;
}

export interface AdminActor {
  adminAccountId: Types.ObjectId;
  correlationId: string;
}

function toPersonView(person: PersonSummary | undefined, fallbackId: Types.ObjectId): PersonView {
  return {
    identityId: fallbackId.toString(),
    name: person?.name ?? 'Неизвестный пользователь',
    organizationName: person?.organizationName ?? null,
    organizationType: person?.organizationType ?? null,
  };
}

function toAdminPersonView(person: PersonSummary | undefined, fallbackId: Types.ObjectId): AdminPersonView {
  return { ...toPersonView(person, fallbackId), login: person?.login ?? '' };
}

function emptyTotals(): MoneyTotalsView {
  return { earned: [], paid: [], due: [] };
}

function addMoney(bucket: MoneyAmount[], currency: string, amountMinorUnits: number): void {
  const existing = bucket.find((money) => money.currency === currency);
  if (existing) {
    (existing as { amountMinorUnits: number }).amountMinorUnits += amountMinorUnits;
  } else {
    bucket.push({ amountMinorUnits, currency: currency as MoneyAmount['currency'] });
  }
}

/** Итоги из агрегата: `reversed` не считается, `paid` входит и в «начислено», и в «выплачено». */
export function totalsFromRows(rows: CuratorAccrualTotal[]): MoneyTotalsView {
  const totals = emptyTotals();
  for (const row of rows) {
    if (row.status === 'reversed') continue;
    addMoney(totals.earned, row.currency, row.amountMinorUnits);
    if (row.status === 'paid') addMoney(totals.paid, row.currency, row.amountMinorUnits);
    if (row.status === 'accrued') addMoney(totals.due, row.currency, row.amountMinorUnits);
  }
  return totals;
}

const RULES: TeamRulesView = {
  ratePercent: CURATOR_RATE_PERCENT,
  teamSizeMin: TEAM_SIZE_MIN,
  teamSizeIdealMax: TEAM_SIZE_IDEAL_MAX,
};

/**
 * Реферальная сеть BAZA: кураторы и их команды (решения владельца 16.09.2026,
 * docs/plans/2026-09-16-mlm-curator-network.md).
 *
 * Сеть принадлежит платформе и привязана к человеку, а не к должности.
 * Вступить можно по ссылке куратора; всё остальное — назначить куратора,
 * перевести, убрать, решить заявку — делает BAZA в админке.
 */
@Injectable()
export class ReferralNetworkService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly curators: ReferralCuratorRepository,
    private readonly memberships: ReferralMembershipRepository,
    private readonly requests: ReferralRequestRepository,
    private readonly accruals: CuratorAccrualRepository,
    private readonly organizations: OrganizationsService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  rules(): TeamRulesView {
    return RULES;
  }

  // ─── Чтение ────────────────────────────────────────────────────────────────

  /** Вся сеть для админки: кураторы, их команды, деньги, сводка. */
  async getAdminTree(): Promise<AdminNetworkTreeView> {
    const curators = await this.curators.listActive();
    const curatorIds = curators.map((curator) => curator.identityId);
    const [memberships, totals, pending] = await Promise.all([
      this.memberships.listOpenByCurators(curatorIds),
      this.accruals.totalsByCurators(curatorIds),
      this.requests.list('pending', 1000),
    ]);
    const people = await this.peopleById([...curatorIds, ...memberships.map((m) => m.memberIdentityId)]);

    const nodes = curators.map((curator) => {
      const node = this.buildNode(curator, memberships, people, toAdminPersonView);
      const rows = totals.filter((row) => row.curatorIdentityId.equals(curator.identityId));
      return { ...node, inviteCode: curator.inviteCode, totals: totalsFromRows(rows) };
    });

    return {
      rules: RULES,
      curators: nodes,
      summary: {
        curators: nodes.length,
        members: memberships.filter((m) => m.status === 'active').length,
        membersOnReview: memberships.filter((m) => m.status === 'on_review').length,
        pendingRequests: pending.length,
      },
    };
  }

  /**
   * Сеть глазами руководителя агентства: кураторы его компании и их команды.
   * Без денег — начисления это отношения BAZA и куратора, а не агентства.
   */
  async getOrganizationTree(organizationId: Types.ObjectId): Promise<OrganizationNetworkView> {
    const curators = await this.curators.listActive();
    const memberships = await this.memberships.listOpenByCurators(curators.map((c) => c.identityId));
    const people = await this.peopleById([
      ...curators.map((c) => c.identityId),
      ...memberships.map((m) => m.memberIdentityId),
    ]);
    const inOrganization = (identityId: Types.ObjectId) =>
      people.get(identityId.toString())?.organizationId?.equals(organizationId) ?? false;

    const nodes = curators
      .map((curator) => {
        const node = this.buildNode(curator, memberships, people, toPersonView);
        if (inOrganization(curator.identityId)) return node;
        // Куратор из другой компании: показываем только наших людей в его команде.
        const ours = node.members.filter((member) => inOrganization(new Types.ObjectId(member.person.identityId)));
        return ours.length > 0 ? { ...node, members: ours } : null;
      })
      .filter((node): node is CuratorNodeView => node !== null);

    return { rules: RULES, curators: nodes };
  }

  /** Кабинет человека: куратор он, участник или пока ни то ни другое. */
  async getMine(identityId: Types.ObjectId): Promise<MyNetworkView> {
    const [curator, membership, requests] = await Promise.all([
      this.curators.findActiveByIdentity(identityId),
      this.memberships.findOpenByMember(identityId),
      this.requests.listByApplicant(identityId),
    ]);
    const requestViews = await this.toRequestViews(requests);

    if (curator) {
      const [team, totals, accruals] = await Promise.all([
        this.memberships.listOpenByCurators([identityId]),
        this.accruals.totalsByCurators([identityId]),
        this.accruals.listByCurator(identityId, ACCRUAL_PAGE_LIMIT),
      ]);
      const people = await this.peopleById([identityId, ...team.map((m) => m.memberIdentityId)]);
      return {
        rules: RULES,
        role: 'curator',
        curator: {
          inviteCode: curator.inviteCode,
          node: this.buildNode(curator, team, people, toPersonView),
          totals: totalsFromRows(totals),
          accruals: await this.toAccrualViews(accruals),
        },
        membership: null,
        requests: requestViews,
      };
    }

    if (membership) {
      const [people, accruals] = await Promise.all([
        this.peopleById([membership.curatorIdentityId]),
        this.accruals.listByMember(identityId, ACCRUAL_PAGE_LIMIT),
      ]);
      return {
        rules: RULES,
        role: 'member',
        curator: null,
        membership: {
          curator: toPersonView(people.get(membership.curatorIdentityId.toString()), membership.curatorIdentityId),
          joinedAt: membership.joinedAt.toISOString(),
          status: membership.status as Exclude<ReferralMembershipStatus, 'ended'>,
          accruals: await this.toAccrualViews(accruals),
        },
        requests: requestViews,
      };
    }

    return { rules: RULES, role: 'none', curator: null, membership: null, requests: requestViews };
  }

  /** Кто зовёт по ссылке — до регистрации, поэтому только имя куратора. */
  async previewInvite(rawCode: string): Promise<{ curatorName: string }> {
    const curator = await this.curators.findActiveByInviteCode(normalizeInviteCode(rawCode));
    if (!curator) throw new NotFoundException('Invite not found');
    const people = await this.peopleById([curator.identityId]);
    return { curatorName: toPersonView(people.get(curator.identityId.toString()), curator.identityId).name };
  }

  async findPersonByLogin(login: string): Promise<{
    person: AdminPersonView;
    isCurator: boolean;
    membership: { curator: PersonView; status: ReferralMembershipStatus } | null;
  }> {
    const identity = await this.authService.findByLogin(login);
    if (!identity) throw new NotFoundException('Person not found');
    const [curator, membership] = await Promise.all([
      this.curators.findActiveByIdentity(identity.id),
      this.memberships.findOpenByMember(identity.id),
    ]);
    const people = await this.peopleById([identity.id, ...(membership ? [membership.curatorIdentityId] : [])]);
    return {
      person: toAdminPersonView(people.get(identity.id.toString()), identity.id),
      isCurator: curator !== null,
      membership: membership
        ? {
            curator: toPersonView(people.get(membership.curatorIdentityId.toString()), membership.curatorIdentityId),
            status: membership.status,
          }
        : null,
    };
  }

  async getMemberHistory(identityId: Types.ObjectId): Promise<MembershipHistoryView[]> {
    const history = await this.memberships.listHistoryByMember(identityId);
    const people = await this.peopleById(history.map((m) => m.curatorIdentityId));
    return history.map((m) => ({
      curator: toPersonView(people.get(m.curatorIdentityId.toString()), m.curatorIdentityId),
      status: m.status,
      joinedAt: m.joinedAt.toISOString(),
      joinedVia: m.joinedVia,
      endedAt: m.endedAt?.toISOString() ?? null,
      endReason: m.endReason ?? null,
      note: m.note ?? null,
    }));
  }

  async listRequests(status?: ReferralRequestStatus): Promise<ReferralRequestView[]> {
    return this.toRequestViews(await this.requests.list(status, 500));
  }

  // ─── Действия человека ─────────────────────────────────────────────────────

  /**
   * Вступить в команду по ссылке. Решения владельца: один уровень — куратор
   * в чужую команду не вступает; сотрудник агентства не входит в команду
   * куратора из другой компании.
   */
  async joinByInvite(params: { identityId: Types.ObjectId; code: string; correlationId: string }): Promise<MyNetworkView> {
    const curator = await this.curators.findActiveByInviteCode(normalizeInviteCode(params.code));
    if (!curator) throw new NotFoundException('Invite not found');
    if (curator.identityId.equals(params.identityId)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A curator cannot join their own team');
    }
    if (await this.curators.findActiveByIdentity(params.identityId)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A curator cannot join another team: the network has one level');
    }
    const existing = await this.memberships.findOpenByMember(params.identityId);
    if (existing) {
      throw new AppException(
        ErrorCode.REFERRAL_ALREADY_IN_TEAM,
        existing.curatorIdentityId.equals(curator.identityId)
          ? 'Already in this team'
          : 'Already in another team: changing the curator is decided by BAZA on request',
      );
    }
    await this.requireCompanyCompatible(params.identityId, curator.identityId);

    await runInTransaction(this.connection, async (session) => {
      const membership = await this.memberships.create(
        { memberIdentityId: params.identityId, curatorIdentityId: curator.identityId, joinedVia: 'invite_link' },
        session,
      );
      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.identityId },
          action: 'referral_network.join',
          resource: 'referral_membership',
          resourceId: membership._id,
          after: { curatorIdentityId: curator.identityId.toString(), joinedVia: 'invite_link' },
          correlationId: params.correlationId,
        },
        session,
      );
    });
    return this.getMine(params.identityId);
  }

  /** Заявка на решение BAZA: стать куратором, уйти из команды, сменить куратора. */
  async createRequest(params: {
    identityId: Types.ObjectId;
    type: ReferralRequestType;
    reason: string;
    targetInviteCode?: string;
    correlationId: string;
  }): Promise<ReferralRequestView> {
    const isCurator = (await this.curators.findActiveByIdentity(params.identityId)) !== null;
    const membership = await this.memberships.findOpenByMember(params.identityId);
    let targetCuratorIdentityId: Types.ObjectId | undefined;

    if (params.type === 'become_curator' && isCurator) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Already a curator');
    }
    if ((params.type === 'leave_team' || params.type === 'change_curator') && !membership) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Not in a team');
    }
    if (params.type === 'change_curator') {
      if (!params.targetInviteCode) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'The invite code of the new curator is required');
      }
      const target = await this.curators.findActiveByInviteCode(normalizeInviteCode(params.targetInviteCode));
      if (!target) throw new NotFoundException('Invite not found');
      if (membership && target.identityId.equals(membership.curatorIdentityId)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Already in this team');
      }
      await this.requireCompanyCompatible(params.identityId, target.identityId);
      targetCuratorIdentityId = target.identityId;
    }
    if (await this.requests.findPendingByApplicant(params.identityId, params.type)) {
      throw new AppException(ErrorCode.REFERRAL_REQUEST_PENDING, 'A request of this type is already waiting for BAZA');
    }

    const request = await this.requests.create({
      type: params.type,
      applicantIdentityId: params.identityId,
      targetCuratorIdentityId,
      reason: params.reason,
    });
    const [view] = await this.toRequestViews([request]);
    return view!;
  }

  // ─── Действия BAZA ─────────────────────────────────────────────────────────

  /** Назначить куратора. Назначение BAZA и есть проверка «проверенный BAZA». */
  async appointCurator(actor: AdminActor, params: { identityId: Types.ObjectId; reason: string }): Promise<void> {
    await runInTransaction(this.connection, (session) => this.appointInSession(actor, params, session));
  }

  /** Снять куратора; его команда закрывается, начисленное остаётся за ним. */
  async retireCurator(actor: AdminActor, params: { identityId: Types.ObjectId; reason: string }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const retired = await this.curators.retire(
        params.identityId,
        { retiredByAdminId: actor.adminAccountId, retireReason: params.reason },
        session,
      );
      if (!retired) throw new NotFoundException('Curator not found');
      const closed = await this.memberships.endAllForCurator(
        params.identityId,
        { endedByAdminId: actor.adminAccountId, note: params.reason },
        session,
      );
      await this.audit(actor, 'referral_network.retire_curator', 'referral_curator', retired._id, params.reason, {
        identityId: params.identityId.toString(),
        closedMemberships: closed,
      }, session);
    });
  }

  /** Поставить человека в команду куратора — добавить или перевести из другой. */
  async assignMember(
    actor: AdminActor,
    params: { memberIdentityId: Types.ObjectId; curatorIdentityId: Types.ObjectId; reason: string },
  ): Promise<void> {
    await runInTransaction(this.connection, (session) => this.assignInSession(actor, params, session));
  }

  async removeMember(actor: AdminActor, params: { memberIdentityId: Types.ObjectId; reason: string }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const ended = await this.memberships.endOpen(
        params.memberIdentityId,
        { endReason: 'removed', endedByAdminId: actor.adminAccountId, note: params.reason },
        session,
      );
      if (!ended) throw new NotFoundException('Membership not found');
      await this.audit(actor, 'referral_network.remove_member', 'referral_membership', ended._id, params.reason, {
        memberIdentityId: params.memberIdentityId.toString(),
        curatorIdentityId: ended.curatorIdentityId.toString(),
      }, session);
    });
  }

  /** Решить заявку. Одобрение сразу применяет её — в той же транзакции. */
  async decideRequest(
    actor: AdminActor,
    params: { requestId: Types.ObjectId; decision: 'approved' | 'rejected'; comment?: string },
  ): Promise<ReferralRequestView> {
    const request = await this.requests.findById(params.requestId);
    if (!request) throw new NotFoundException('Request not found');

    const decided = await runInTransaction(this.connection, async (session) => {
      const updated = await this.requests.decide(
        params.requestId,
        { status: params.decision, decidedByAdminId: actor.adminAccountId, decisionComment: params.comment },
        session,
      );
      if (!updated) throw new AppException(ErrorCode.VALIDATION_FAILED, 'The request is already decided');

      if (params.decision === 'approved') {
        const reason = params.comment ?? request.reason;
        if (request.type === 'become_curator') {
          await this.appointInSession(actor, { identityId: request.applicantIdentityId, reason }, session);
        } else if (request.type === 'leave_team') {
          const ended = await this.memberships.endOpen(
            request.applicantIdentityId,
            { endReason: 'left', endedByAdminId: actor.adminAccountId, note: reason },
            session,
          );
          if (!ended) throw new AppException(ErrorCode.VALIDATION_FAILED, 'The applicant is no longer in a team');
        } else {
          if (!request.targetCuratorIdentityId) {
            throw new AppException(ErrorCode.VALIDATION_FAILED, 'The request has no target curator');
          }
          await this.assignInSession(
            actor,
            { memberIdentityId: request.applicantIdentityId, curatorIdentityId: request.targetCuratorIdentityId, reason },
            session,
          );
        }
      }

      await this.audit(actor, `referral_network.request_${params.decision}`, 'referral_request', updated._id, params.comment, {
        type: updated.type,
        applicantIdentityId: updated.applicantIdentityId.toString(),
      }, session);
      return updated;
    });

    const [view] = await this.toRequestViews([decided]);
    return view!;
  }

  // ─── Внутреннее ────────────────────────────────────────────────────────────

  private async appointInSession(
    actor: AdminActor,
    params: { identityId: Types.ObjectId; reason: string },
    session: ClientSession,
  ): Promise<void> {
    const [identity] = await this.authService.findByIds([params.identityId]);
    if (!identity) throw new NotFoundException('Person not found');
    if (await this.curators.findActiveByIdentity(params.identityId, session)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Already a curator');
    }

    // Один уровень: назначенный куратор выходит из своей команды.
    await this.memberships.endOpen(
      params.identityId,
      { endReason: 'became_curator', endedByAdminId: actor.adminAccountId, note: params.reason },
      session,
    );

    const curator = await this.curators.create(
      {
        identityId: params.identityId,
        inviteCode: await this.uniqueInviteCode(),
        appointedByAdminId: actor.adminAccountId,
        appointReason: params.reason,
      },
      session,
    );
    await this.audit(actor, 'referral_network.appoint_curator', 'referral_curator', curator._id, params.reason, {
      identityId: params.identityId.toString(),
    }, session);
  }

  private async assignInSession(
    actor: AdminActor,
    params: { memberIdentityId: Types.ObjectId; curatorIdentityId: Types.ObjectId; reason: string },
    session: ClientSession,
  ): Promise<void> {
    if (params.memberIdentityId.equals(params.curatorIdentityId)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A curator cannot be in their own team');
    }
    const curator = await this.curators.findActiveByIdentity(params.curatorIdentityId, session);
    if (!curator) throw new NotFoundException('Curator not found');
    if (await this.curators.findActiveByIdentity(params.memberIdentityId, session)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A curator cannot join another team: the network has one level');
    }
    await this.requireCompanyCompatible(params.memberIdentityId, params.curatorIdentityId);

    const current = await this.memberships.findOpenByMember(params.memberIdentityId, session);
    if (current?.curatorIdentityId.equals(params.curatorIdentityId) && current.status === 'active') {
      throw new AppException(ErrorCode.REFERRAL_ALREADY_IN_TEAM, 'Already in this team');
    }
    if (current) {
      await this.memberships.endOpen(
        params.memberIdentityId,
        { endReason: 'transferred', endedByAdminId: actor.adminAccountId, note: params.reason },
        session,
      );
    }
    const membership = await this.memberships.create(
      {
        memberIdentityId: params.memberIdentityId,
        curatorIdentityId: params.curatorIdentityId,
        joinedVia: 'admin',
        addedByAdminId: actor.adminAccountId,
        note: params.reason,
      },
      session,
    );
    await this.audit(actor, current ? 'referral_network.transfer_member' : 'referral_network.add_member', 'referral_membership', membership._id, params.reason, {
      memberIdentityId: params.memberIdentityId.toString(),
      curatorIdentityId: params.curatorIdentityId.toString(),
      previousCuratorIdentityId: current?.curatorIdentityId.toString() ?? null,
    }, session);
  }

  private async requireCompanyCompatible(memberIdentityId: Types.ObjectId, curatorIdentityId: Types.ObjectId): Promise<void> {
    const people = await this.peopleById([memberIdentityId, curatorIdentityId]);
    const member = people.get(memberIdentityId.toString());
    const curator = people.get(curatorIdentityId.toString());
    const affiliation = (person: PersonSummary | undefined) => ({
      organizationId: person?.organizationId?.toString() ?? null,
      organizationType: person?.organizationType ?? null,
    });
    if (!isCompanyCompatible(affiliation(member), affiliation(curator))) {
      throw new AppException(
        ErrorCode.REFERRAL_COMPANY_MISMATCH,
        'An agency employee cannot join the team of a curator from another company',
      );
    }
  }

  private async uniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
      const code = generateInviteCode();
      if (!(await this.curators.inviteCodeExists(code))) return code;
    }
    throw new Error('Could not generate a unique invite code');
  }

  private buildNode<P extends PersonView>(
    curator: ReferralCuratorDocument,
    memberships: ReferralMembershipDocument[],
    people: Map<string, PersonSummary>,
    view: (person: PersonSummary | undefined, id: Types.ObjectId) => P,
  ): CuratorNodeView<P> {
    const team = memberships.filter((m) => m.curatorIdentityId.equals(curator.identityId));
    const activeSize = team.filter((m) => m.status === 'active').length;
    return {
      person: view(people.get(curator.identityId.toString()), curator.identityId),
      appointedAt: curator.appointedAt.toISOString(),
      teamSize: activeSize,
      teamStatus: teamSizeStatus(activeSize),
      members: team.map((m) => ({
        person: view(people.get(m.memberIdentityId.toString()), m.memberIdentityId),
        joinedAt: m.joinedAt.toISOString(),
        joinedVia: m.joinedVia,
        status: m.status as Exclude<ReferralMembershipStatus, 'ended'>,
      })),
    };
  }

  async toAccrualViews(accruals: CuratorAccrualDocument[]): Promise<AccrualView[]> {
    const people = await this.peopleById(accruals.flatMap((a) => [a.curatorIdentityId, a.memberIdentityId]));
    return accruals.map((a) => ({
      id: a._id.toString(),
      curator: toPersonView(people.get(a.curatorIdentityId.toString()), a.curatorIdentityId),
      member: toPersonView(people.get(a.memberIdentityId.toString()), a.memberIdentityId),
      dealId: a.dealId.toString(),
      commission: a.commission,
      ratePercent: a.ratePercent,
      amount: a.amount,
      status: a.status,
      accruedAt: a.accruedAt.toISOString(),
      paidAt: a.paidAt?.toISOString() ?? null,
      reversedAt: a.reversedAt?.toISOString() ?? null,
    }));
  }

  private async toRequestViews(requests: ReferralRequestDocument[]): Promise<ReferralRequestView[]> {
    const people = await this.peopleById(
      requests.flatMap((r) => [r.applicantIdentityId, ...(r.targetCuratorIdentityId ? [r.targetCuratorIdentityId] : [])]),
    );
    return requests.map((r) => ({
      id: r._id.toString(),
      type: r.type,
      applicant: toPersonView(people.get(r.applicantIdentityId.toString()), r.applicantIdentityId),
      targetCurator: r.targetCuratorIdentityId
        ? toPersonView(people.get(r.targetCuratorIdentityId.toString()), r.targetCuratorIdentityId)
        : null,
      reason: r.reason,
      status: r.status,
      decisionComment: r.decisionComment ?? null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  }

  async peopleById(identityIds: Types.ObjectId[]): Promise<Map<string, PersonSummary>> {
    const unique = [...new Map(identityIds.map((id) => [id.toString(), id])).values()];
    const people = await this.organizations.getPeopleSummaries(unique);
    return new Map(people.map((person) => [person.identityId.toString(), person]));
  }

  private async audit(
    actor: AdminActor,
    action: string,
    resource: string,
    resourceId: Types.ObjectId,
    reason: string | undefined,
    after: Record<string, unknown>,
    session: ClientSession,
  ): Promise<void> {
    await this.auditService.append(
      {
        actor: { type: 'admin_account', id: actor.adminAccountId },
        action,
        resource,
        resourceId,
        reason,
        after,
        correlationId: actor.correlationId,
      },
      session,
    );
  }
}
