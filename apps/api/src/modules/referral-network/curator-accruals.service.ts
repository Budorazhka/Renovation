import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ReferralCuratorRepository } from './repository/referral-curator.repository';
import { ReferralMembershipRepository } from './repository/referral-membership.repository';
import { CuratorAccrualRepository } from './repository/curator-accrual.repository';
import {
  ACCRUING_DEAL_TYPE,
  CURATOR_RATE_PERCENT,
  curatorAccrualAmount,
  isCompanyCompatible,
} from './referral-rules';
import {
  ReferralNetworkService,
  totalsFromRows,
  type AccrualView,
  type AdminActor,
  type AdminPersonView,
  type MoneyTotalsView,
} from './referral-network.service';

/** Сделка глазами начисления: только то, что нужно, чтобы решить, кому и сколько. */
export interface AccruingDeal {
  id: Types.ObjectId;
  organizationId: Types.ObjectId;
  dealType?: string;
  ownerPositionId: Types.ObjectId;
}

/**
 * Почему по сделке не начислено. Отказ не ошибка: отметка о деньгах ставится
 * по любой сделке, а куратору положено не по каждой.
 */
export type AccrualSkipReason =
  | 'not_primary'
  | 'no_occupant'
  | 'not_in_team'
  | 'membership_on_review'
  | 'company_mismatch'
  | 'curator_retired';

export type AccrualOutcome =
  | { accrued: true; accrualId: string; curatorIdentityId: string; amount: MoneyAmount }
  | { accrued: false; reason: AccrualSkipReason };

export interface CuratorPayoutView {
  curator: AdminPersonView;
  inviteCode: string | null;
  totals: MoneyTotalsView;
}

/**
 * Начисления куратору: 7% от фактической комиссии агента из его команды по
 * сделке первички, когда менеджер BAZA отметил, что деньги пришли. Платит
 * BAZA (решения владельца 16.09.2026).
 *
 * Все мутации принимают сессию вызывающего: начисление пишется в той же
 * транзакции, что и отметка «Комиссия получена», — иначе отметка без
 * начисления или начисление без отметки были бы возможны.
 */
@Injectable()
export class CuratorAccrualsService {
  constructor(
    private readonly curators: ReferralCuratorRepository,
    private readonly memberships: ReferralMembershipRepository,
    private readonly accruals: CuratorAccrualRepository,
    private readonly organizations: OrganizationsService,
    private readonly network: ReferralNetworkService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Начислить куратору по сделке. Кто агент — тот, кто занимает должность
   * владельца сделки в момент поступления денег; кто куратор — его куратор в
   * тот же момент. Если агент оказался в агентстве другой компании, чем
   * куратор, связь уходит под вопрос и начисление не пишется, пока BAZA не
   * решит.
   */
  async accrueForDeal(
    actor: AdminActor,
    params: { deal: AccruingDeal; commission: MoneyAmount },
    session: ClientSession,
  ): Promise<AccrualOutcome> {
    if (params.deal.dealType !== ACCRUING_DEAL_TYPE) return { accrued: false, reason: 'not_primary' };

    const memberIdentityId = await this.organizations.getActiveOccupantIdentityId(params.deal.ownerPositionId);
    if (!memberIdentityId) return { accrued: false, reason: 'no_occupant' };

    const membership = await this.memberships.findOpenByMember(memberIdentityId, session);
    if (!membership) return { accrued: false, reason: 'not_in_team' };
    if (membership.status === 'on_review') return { accrued: false, reason: 'membership_on_review' };

    const curator = await this.curators.findActiveByIdentity(membership.curatorIdentityId, session);
    if (!curator) return { accrued: false, reason: 'curator_retired' };

    const people = await this.network.peopleById([memberIdentityId, membership.curatorIdentityId]);
    const affiliation = (id: Types.ObjectId) => {
      const person = people.get(id.toString());
      return { organizationId: person?.organizationId?.toString() ?? null, organizationType: person?.organizationType ?? null };
    };
    if (!isCompanyCompatible(affiliation(memberIdentityId), affiliation(membership.curatorIdentityId))) {
      await this.memberships.markOnReview(memberIdentityId, session);
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: actor.adminAccountId },
          action: 'referral_network.membership_on_review',
          resource: 'referral_membership',
          resourceId: membership._id,
          reason: 'Участник работает в агентстве другой компании, чем куратор',
          after: { dealId: params.deal.id.toString() },
          correlationId: actor.correlationId,
        },
        session,
      );
      return { accrued: false, reason: 'company_mismatch' };
    }

    const amount = curatorAccrualAmount(params.commission, CURATOR_RATE_PERCENT);
    const accrual = await this.accruals.create(
      {
        curatorIdentityId: membership.curatorIdentityId,
        memberIdentityId,
        dealId: params.deal.id,
        dealOrganizationId: params.deal.organizationId,
        commission: params.commission,
        ratePercent: CURATOR_RATE_PERCENT,
        amount,
      },
      session,
    );
    await this.auditService.append(
      {
        actor: { type: 'admin_account', id: actor.adminAccountId },
        action: 'curator_accrual.accrue',
        resource: 'curator_accrual',
        resourceId: accrual._id,
        after: {
          dealId: params.deal.id.toString(),
          curatorIdentityId: membership.curatorIdentityId.toString(),
          memberIdentityId: memberIdentityId.toString(),
          commission: params.commission,
          ratePercent: CURATOR_RATE_PERCENT,
          amount,
        },
        correlationId: actor.correlationId,
      },
      session,
    );
    return { accrued: true, accrualId: accrual._id.toString(), curatorIdentityId: membership.curatorIdentityId.toString(), amount };
  }

  /**
   * Сторно начисления, когда отметку о деньгах сняли. Выплаченное сторнирует
   * только суперадмин: иначе BAZA потеряла бы след переплаты.
   */
  async reverseForDeal(
    actor: AdminActor & { isSuperAdmin: boolean },
    params: { dealId: Types.ObjectId; reason: string },
    session: ClientSession,
  ): Promise<{ reversed: boolean }> {
    const live = await this.accruals.findLiveByDeal(params.dealId, session);
    if (!live) return { reversed: false };
    if (live.status === 'paid' && !actor.isSuperAdmin) {
      throw new AppException(
        ErrorCode.CURATOR_ACCRUAL_ALREADY_PAID,
        'The curator has already been paid for this deal: only a super admin can reverse it',
      );
    }
    const reversed = await this.accruals.reverseLiveByDeal(
      params.dealId,
      { reversedByAdminId: actor.adminAccountId, reverseReason: params.reason, allowPaid: actor.isSuperAdmin },
      session,
    );
    if (reversed) {
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: actor.adminAccountId },
          action: 'curator_accrual.reverse',
          resource: 'curator_accrual',
          resourceId: reversed._id,
          reason: params.reason,
          before: { status: live.status },
          after: { status: 'reversed' },
          correlationId: actor.correlationId,
        },
        session,
      );
    }
    return { reversed: reversed !== null };
  }

  /** Выплаты: у кого сколько начислено, выплачено и к выплате. */
  async listPayouts(): Promise<CuratorPayoutView[]> {
    const tree = await this.network.getAdminTree();
    return tree.curators.map((node) => ({ curator: node.person, inviteCode: node.inviteCode, totals: node.totals }));
  }

  async listCuratorAccruals(curatorIdentityId: Types.ObjectId): Promise<{ totals: MoneyTotalsView; accruals: AccrualView[] }> {
    const [rows, accruals] = await Promise.all([
      this.accruals.totalsByCurators([curatorIdentityId]),
      this.accruals.listByCurator(curatorIdentityId, 500),
    ]);
    return { totals: totalsFromRows(rows), accruals: await this.network.toAccrualViews(accruals) };
  }

  /** Живое начисление по сделкам — для строки «Куратору начислено» в разделе комиссий. */
  async liveByDeals(dealIds: Types.ObjectId[]): Promise<Map<string, AccrualView>> {
    const accruals = await this.accruals.listLiveByDeals(dealIds);
    const views = await this.network.toAccrualViews(accruals);
    return new Map(views.map((view) => [view.dealId, view]));
  }

  async markPaid(
    actor: AdminActor,
    params: { curatorIdentityId: Types.ObjectId; accrualIds: Types.ObjectId[]; paidAt: Date },
    session: ClientSession,
  ): Promise<{ paid: number }> {
    const paid = await this.accruals.markPaid(
      params.curatorIdentityId,
      params.accrualIds,
      { paidByAdminId: actor.adminAccountId, paidAt: params.paidAt },
      session,
    );
    if (paid === 0) throw new NotFoundException('No accrued items to pay for this curator');
    await this.auditService.append(
      {
        actor: { type: 'admin_account', id: actor.adminAccountId },
        action: 'curator_accrual.mark_paid',
        resource: 'referral_curator',
        resourceId: params.curatorIdentityId,
        after: { accrualIds: params.accrualIds.map((id) => id.toString()), paid, paidAt: params.paidAt.toISOString() },
        correlationId: actor.correlationId,
      },
      session,
    );
    return { paid };
  }
}
