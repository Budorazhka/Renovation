import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import type { AdminContext } from '../../shared/admin/admin-context';
import { AuditService } from '../audit/audit.service';
import { CrmService, toPlatformDealReadModel, type PlatformDealReadModel } from '../crm/crm.service';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  ReferralNetworkService,
  type AccrualView,
  type AdminActor,
} from '../referral-network/referral-network.service';
import { CuratorAccrualsService, type AccrualOutcome } from '../referral-network/curator-accruals.service';
import type { ReferralRequestStatus } from '../referral-network/schemas/referral-request.schema';
import { AdminPolicyService } from './admin-policy.service';

/** Сколько сделок в одной выдаче раздела «Комиссии». */
const COMMISSIONS_LIMIT = 300;

export interface AdminCommissionDealView extends PlatformDealReadModel {
  organizationName: string | null;
  agentName: string | null;
  /** Начисление куратору по этой сделке, если оно есть и не отменено. */
  curatorAccrual: AccrualView | null;
}

/**
 * Реферальная сеть и деньги BAZA в админке (решения владельца 16.09.2026).
 *
 * Права — модель админки (AdminPolicyService.requireGrant): суперадмин может
 * всё; обычному администратору нужен индивидуальный грант.
 * - `referral_network.read` / `referral_network.manage` — видеть и править сеть;
 * - `commission.confirm` — менеджер BAZA отмечает пришедшую комиссию;
 * - `curator_payout.mark` — менеджер BAZA отмечает выплату куратору.
 * Сторно уже выплаченного начисления — только суперадмину.
 */
@Injectable()
export class AdminReferralService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly policy: AdminPolicyService,
    private readonly network: ReferralNetworkService,
    private readonly accruals: CuratorAccrualsService,
    private readonly crm: CrmService,
    private readonly organizations: OrganizationsService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Сеть ────────────────────────────────────────────────────────────────

  async tree(adminContext: AdminContext) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'read' });
    return this.network.getAdminTree();
  }

  async findPerson(adminContext: AdminContext, login: string) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'read' });
    return this.network.findPersonByLogin(login);
  }

  async memberHistory(adminContext: AdminContext, identityId: Types.ObjectId) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'read' });
    return { items: await this.network.getMemberHistory(identityId) };
  }

  async listRequests(adminContext: AdminContext, status?: ReferralRequestStatus) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'read' });
    return { items: await this.network.listRequests(status) };
  }

  async appointCurator(adminContext: AdminContext, params: { identityId: Types.ObjectId; reason: string; correlationId: string }) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'manage' });
    await this.network.appointCurator(this.actor(adminContext, params.correlationId), params);
    return this.network.getAdminTree();
  }

  async retireCurator(adminContext: AdminContext, params: { identityId: Types.ObjectId; reason: string; correlationId: string }) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'manage' });
    await this.network.retireCurator(this.actor(adminContext, params.correlationId), params);
    return this.network.getAdminTree();
  }

  async assignMember(
    adminContext: AdminContext,
    params: { memberIdentityId: Types.ObjectId; curatorIdentityId: Types.ObjectId; reason: string; correlationId: string },
  ) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'manage' });
    await this.network.assignMember(this.actor(adminContext, params.correlationId), params);
    return this.network.getAdminTree();
  }

  async removeMember(adminContext: AdminContext, params: { memberIdentityId: Types.ObjectId; reason: string; correlationId: string }) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'manage' });
    await this.network.removeMember(this.actor(adminContext, params.correlationId), params);
    return this.network.getAdminTree();
  }

  async decideRequest(
    adminContext: AdminContext,
    params: { requestId: Types.ObjectId; decision: 'approved' | 'rejected'; comment?: string; correlationId: string },
  ) {
    await this.policy.requireGrant({ adminContext, resource: 'referral_network', action: 'manage' });
    return this.network.decideRequest(this.actor(adminContext, params.correlationId), params);
  }

  // ─── Комиссии ────────────────────────────────────────────────────────────

  async listCommissions(adminContext: AdminContext, received: boolean): Promise<{ items: AdminCommissionDealView[] }> {
    await this.policy.requireGrant({ adminContext, resource: 'commission', action: 'confirm' });
    const deals = await this.crm.listPrimaryDealsForPlatform({ received, limit: COMMISSIONS_LIMIT });
    const [positions, accruals] = await Promise.all([
      this.organizations.describePositions(deals.map((d) => new Types.ObjectId(d.ownerPositionId))),
      this.accruals.liveByDeals(deals.map((d) => new Types.ObjectId(d.id))),
    ]);
    return {
      items: deals.map((deal) => ({
        ...deal,
        organizationName: positions.get(deal.ownerPositionId)?.organizationName ?? null,
        agentName: positions.get(deal.ownerPositionId)?.occupantName ?? null,
        curatorAccrual: accruals.get(deal.id) ?? null,
      })),
    };
  }

  /**
   * Деньги пришли: отметка в сделке и начисление куратору — одной
   * транзакцией. Без куратора (или не первичка) отметка ставится, а ответ
   * говорит, почему начисления нет.
   */
  async markCommissionReceived(
    adminContext: AdminContext,
    params: { dealId: Types.ObjectId; expectedVersion: number; amount: MoneyAmount; receivedAt: Date; correlationId: string },
  ): Promise<{ deal: PlatformDealReadModel; accrual: AccrualOutcome }> {
    await this.policy.requireGrant({ adminContext, resource: 'commission', action: 'confirm' });
    const actor = this.actor(adminContext, params.correlationId);

    return runInTransaction(this.connection, async (session) => {
      const deal = await this.crm.markCommissionReceivedForPlatform(
        { ...params, adminAccountId: actor.adminAccountId },
        session,
      );
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: actor.adminAccountId },
          action: 'deal.commission_received',
          resource: 'deal',
          resourceId: deal._id,
          after: { amount: params.amount, receivedAt: params.receivedAt.toISOString() },
          correlationId: params.correlationId,
        },
        session,
      );
      const accrual = await this.accruals.accrueForDeal(
        actor,
        {
          deal: { id: deal._id, organizationId: deal.organizationId, dealType: deal.dealType, ownerPositionId: deal.ownerPositionId },
          commission: params.amount,
        },
        session,
      );
      return { deal: toPlatformDealReadModel(deal), accrual };
    });
  }

  /** Снять отметку по ошибке: начисление куратору сторнируется. */
  async cancelCommissionReceived(
    adminContext: AdminContext,
    params: { dealId: Types.ObjectId; expectedVersion: number; reason: string; correlationId: string },
  ): Promise<{ deal: PlatformDealReadModel; accrualReversed: boolean }> {
    await this.policy.requireGrant({ adminContext, resource: 'commission', action: 'confirm' });
    const actor = this.actor(adminContext, params.correlationId);

    return runInTransaction(this.connection, async (session) => {
      const { reversed } = await this.accruals.reverseForDeal(
        { ...actor, isSuperAdmin: adminContext.isSuperAdmin },
        { dealId: params.dealId, reason: params.reason },
        session,
      );
      const deal = await this.crm.clearCommissionReceivedForPlatform(
        { dealId: params.dealId, expectedVersion: params.expectedVersion },
        session,
      );
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: actor.adminAccountId },
          action: 'deal.commission_received_cancel',
          resource: 'deal',
          resourceId: deal._id,
          reason: params.reason,
          after: { accrualReversed: reversed },
          correlationId: params.correlationId,
        },
        session,
      );
      return { deal: toPlatformDealReadModel(deal), accrualReversed: reversed };
    });
  }

  // ─── Выплаты ─────────────────────────────────────────────────────────────

  async listPayouts(adminContext: AdminContext) {
    await this.policy.requireGrant({ adminContext, resource: 'curator_payout', action: 'mark' });
    return { items: await this.accruals.listPayouts() };
  }

  async curatorAccruals(adminContext: AdminContext, curatorIdentityId: Types.ObjectId) {
    await this.policy.requireGrant({ adminContext, resource: 'curator_payout', action: 'mark' });
    return this.accruals.listCuratorAccruals(curatorIdentityId);
  }

  async markPaid(
    adminContext: AdminContext,
    params: { curatorIdentityId: Types.ObjectId; accrualIds: Types.ObjectId[]; paidAt: Date; correlationId: string },
  ) {
    await this.policy.requireGrant({ adminContext, resource: 'curator_payout', action: 'mark' });
    const actor = this.actor(adminContext, params.correlationId);
    const result = await runInTransaction(this.connection, (session) => this.accruals.markPaid(actor, params, session));
    return { ...result, ...(await this.accruals.listCuratorAccruals(params.curatorIdentityId)) };
  }

  private actor(adminContext: AdminContext, correlationId: string): AdminActor {
    return { adminAccountId: new Types.ObjectId(adminContext.adminAccountId), correlationId };
  }
}
