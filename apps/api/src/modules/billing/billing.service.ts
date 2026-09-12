import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import type { AdminContext } from '../../shared/admin/admin-context';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { IdempotencyService, type IdempotentReplay } from '../../shared/idempotency/idempotency.service';
import { SubscriptionPlanRepository } from './repository/subscription-plan.repository';
import { OrganizationSubscriptionRepository } from './repository/organization-subscription.repository';
import { BillingLedgerRepository } from './repository/billing-ledger.repository';
import type {
  PlanLimits,
  SubscriptionPlanDocument,
  TargetAudience,
} from './schemas/subscription-plan.schema';
import type {
  OrganizationSubscriptionDocument,
  SubscriptionStatus,
} from './schemas/organization-subscription.schema';
import type { BillingAction, BillingLedgerEntryDocument } from './schemas/billing-ledger-entry.schema';

export const DEFAULT_PLANS: Array<{
  code: string;
  name: string;
  targetAudience: TargetAudience;
  limits: PlanLimits;
  pricePerMonth: { amountMinorUnits: number; currency: string };
  isActive: boolean;
}> = [
  {
    code: 'developer_trial',
    name: 'Developer Trial',
    targetAudience: 'developer',
    limits: {
      maxActiveListings: 20,
      maxTeamPositions: 5,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: false,
    },
    pricePerMonth: { amountMinorUnits: 0, currency: 'USD' },
    isActive: true,
  },
  {
    code: 'developer_standard',
    name: 'Developer Standard',
    targetAudience: 'developer',
    limits: {
      maxActiveListings: 100,
      maxTeamPositions: 20,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: true,
    },
    pricePerMonth: { amountMinorUnits: 9900, currency: 'USD' },
    isActive: true,
  },
  {
    code: 'developer_pro',
    name: 'Developer Pro',
    targetAudience: 'developer',
    limits: {
      maxActiveListings: 500,
      maxTeamPositions: 50,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: true,
    },
    pricePerMonth: { amountMinorUnits: 29900, currency: 'USD' },
    isActive: true,
  },
  {
    code: 'agency_trial',
    name: 'Agency Trial',
    targetAudience: 'agency',
    limits: {
      maxActiveListings: 30,
      maxTeamPositions: 5,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: false,
    },
    pricePerMonth: { amountMinorUnits: 0, currency: 'USD' },
    isActive: true,
  },
  {
    code: 'agency_pro',
    name: 'Agency Pro',
    targetAudience: 'agency',
    limits: {
      maxActiveListings: 150,
      maxTeamPositions: 25,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: true,
    },
    pricePerMonth: { amountMinorUnits: 14900, currency: 'USD' },
    isActive: true,
  },
  {
    code: 'realtor_free',
    name: 'Realtor Free',
    targetAudience: 'independent_realtor',
    limits: {
      maxActiveListings: 5,
      maxTeamPositions: 1,
      crmAccess: true,
      chessboardAccess: false,
      landingAccess: false,
    },
    pricePerMonth: { amountMinorUnits: 0, currency: 'USD' },
    isActive: true,
  },
  {
    code: 'realtor_pro',
    name: 'Realtor Pro',
    targetAudience: 'independent_realtor',
    limits: {
      maxActiveListings: 50,
      maxTeamPositions: 3,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: true,
    },
    pricePerMonth: { amountMinorUnits: 4900, currency: 'USD' },
    isActive: true,
  },
];

/**
 * ИСПРАВЛЕНО 11.09.2026: getOrganizationSubscription раньше при первой
 * подписке хардкодил planCode: 'agency_trial' для ЛЮБОЙ организации без
 * подписки, включая застройщика — тот получал targetAudience:'agency' и
 * agency-лимиты (maxActiveListings:30) вместо developer_trial (лимит 20,
 * свой набор фич). independent_realtor соответствия «trial»-плана нет
 * вовсе в каталоге — realtor_free (постоянно бесплатный тариф) ближайший
 * содержательно верный вариант, не выдумка. Длительность триала (сейчас
 * 14 дней для всех, отдельно от выбора кода плана) этой правкой намеренно
 * не тронута — «согласованный 7-дневный trial» из мастер-плана этапа 9
 * расходится с кодом, но это отдельный, не закрытый вопрос (см.
 * billing-manual-subscriptions.md «Что открыто»).
 */
const TRIAL_PLAN_CODE_BY_ORGANIZATION_TYPE: Record<TargetAudience, string> = {
  developer: 'developer_trial',
  agency: 'agency_trial',
  independent_realtor: 'realtor_free',
};

export interface OrganizationSubscriptionOverview {
  subscription: OrganizationSubscriptionDocument;
  plan: SubscriptionPlanDocument | null;
  effectiveLimits: PlanLimits;
}

/**
 * ИСПРАВЛЕНО 11.09.2026: getLedgerForOwner/adminGetBillingOverview отдавали
 * сырые Mongoose-документы — `_id`, не `id`, хотя components.schemas.
 * BillingLedgerEntry в OpenAPI объявляет именно `id` (тот же класс
 * расхождения, что уже чинили в messenger — список сообщений/диалогов).
 * `reason`/`recordedBy` ЗДЕСЬ оставлены как есть намеренно: OpenAPI-схема
 * этого же BillingLedgerEntry уже явно объявляет оба поля как часть
 * контракта tenant-эндпоинта (owner видит, кто из админов и почему менял её
 * тариф) — это не тот же класс проблемы, что _id/id, и не мне решать, что
 * это была ошибка, раз контракт формально уже про это говорит.
 */
export interface BillingLedgerEntryReadModel {
  id: string;
  organizationId: string;
  action: BillingAction;
  amountMinorUnits: number;
  currency: string;
  planCode: string;
  periodDays: number;
  reason: string;
  recordedBy: string;
  correlationId: string;
  createdAt: string;
}

function toBillingLedgerEntryReadModel(doc: BillingLedgerEntryDocument): BillingLedgerEntryReadModel {
  return {
    id: doc._id.toString(),
    organizationId: doc.organizationId.toString(),
    action: doc.action,
    amountMinorUnits: doc.amountMinorUnits,
    currency: doc.currency,
    planCode: doc.planCode,
    periodDays: doc.periodDays,
    reason: doc.reason,
    recordedBy: doc.recordedBy.toString(),
    correlationId: doc.correlationId,
    createdAt: doc.createdAt.toISOString(),
  };
}

export interface AdminBillingOverview extends OrganizationSubscriptionOverview {
  ledger: BillingLedgerEntryReadModel[];
}

@Injectable()
export class BillingService {
  private plansSeeded = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    private readonly organizationSubscriptionRepository: OrganizationSubscriptionRepository,
    private readonly billingLedgerRepository: BillingLedgerRepository,
    private readonly auditService: AuditService,
    private readonly organizationsService: OrganizationsService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * ИСПРАВЛЕНО 10.09.2026: активация тарифа не была защищена
   * Idempotency-Key — повторный запрос (ретрай/двойной клик) продлевал
   * подписку дважды и писал две записи 'plan_renewed' в ledger с суммой.
   * Тот же паттерн, что AdminAccountController.checkCreateReplay.
   */
  checkActivateReplay(
    identityId: Types.ObjectId,
    key: string,
    requestBody: Record<string, unknown>,
  ): Promise<IdempotentReplay | null> {
    return this.idempotencyService.checkReplay({
      identityId,
      operation: 'adminActivateSubscription',
      key,
      requestBody,
    });
  }

  async seedDefaultPlans(): Promise<void> {
    for (const plan of DEFAULT_PLANS) {
      await this.subscriptionPlanRepository.upsertPlan(
        plan as unknown as Partial<SubscriptionPlanDocument> & { code: string },
      );
    }
    this.plansSeeded = true;
  }

  private async ensurePlansSeeded(): Promise<void> {
    if (!this.plansSeeded) {
      const existing = await this.subscriptionPlanRepository.listActive();
      if (existing.length === 0) {
        await this.seedDefaultPlans();
      } else {
        this.plansSeeded = true;
      }
    }
  }

  async listPlans(targetAudience?: TargetAudience): Promise<SubscriptionPlanDocument[]> {
    await this.ensurePlansSeeded();
    return this.subscriptionPlanRepository.listActive(targetAudience);
  }

  async getPlanByCode(code: string): Promise<SubscriptionPlanDocument | null> {
    await this.ensurePlansSeeded();
    return this.subscriptionPlanRepository.findByCode(code);
  }

  async getOrganizationSubscription(
    organizationId: Types.ObjectId,
  ): Promise<OrganizationSubscriptionOverview> {
    await this.ensurePlansSeeded();
    let subscription = await this.organizationSubscriptionRepository.findByOrganizationId(organizationId);

    if (!subscription) {
      const organization = await this.organizationsService.getOrganizationById(organizationId);
      // ИСПРАВЛЕНО 13.09.2026 (найдено ревью): для tenant-эндпоинта
      // organizationId и правда всегда приходит из проверенного
      // tenantContext, но admin/organizations/:organizationId/billing
      // передаёт сюда ID прямо из URL — AdminGuard проверяет только
      // валидность admin-сессии и (после 10-11.09.2026) грант
      // manual_ledger, но НЕ существование организации. Раньше это молча
      // заводило agency_trial-подписку и (при activate) запись биллинга
      // для несуществующей/опечатанной организации — "висячие" данные,
      // которые никто не увидит и не сможет вычистить штатным путём.
      if (!organization) {
        throw new AppException(ErrorCode.NOT_FOUND, `Organization '${organizationId.toHexString()}' not found`);
      }
      const planCode = TRIAL_PLAN_CODE_BY_ORGANIZATION_TYPE[organization.type];

      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
      subscription = await this.organizationSubscriptionRepository.upsertSubscription({
        organizationId,
        planCode,
        status: 'trial',
        startedAt,
        expiresAt,
        gracePeriodEndsAt: null,
        customLimits: null,
        currentUsage: { activeListings: 0, teamPositions: 1 },
      });
    } else {
      // Evaluate status against expiry & grace period
      const now = new Date();
      const isExpired = subscription.expiresAt < now;
      let newStatus: SubscriptionStatus = subscription.status;

      if (isExpired && subscription.status !== 'frozen' && subscription.status !== 'cancelled') {
        const graceEnd =
          subscription.gracePeriodEndsAt ||
          new Date(subscription.expiresAt.getTime() + 3 * 24 * 60 * 60 * 1000);

        if (now <= graceEnd) {
          newStatus = 'grace_period';
        } else {
          newStatus = 'frozen';
        }

        if (newStatus !== subscription.status) {
          const updated = await this.organizationSubscriptionRepository.updateStatus(
            organizationId,
            newStatus,
            graceEnd,
          );
          if (updated) {
            subscription = updated;
          }
        }
      }
    }

    const plan = await this.subscriptionPlanRepository.findByCode(subscription.planCode);
    const fallbackLimits: PlanLimits = {
      maxActiveListings: 20,
      maxTeamPositions: 5,
      crmAccess: true,
      chessboardAccess: true,
      landingAccess: false,
    };

    const effectiveLimits: PlanLimits = subscription.customLimits ?? (plan?.limits || fallbackLimits);

    return {
      subscription: subscription as OrganizationSubscriptionDocument,
      plan,
      effectiveLimits,
    };
  }

  async getLedgerForOwner(
    tenantContext: TenantContext,
    limit = 50,
  ): Promise<BillingLedgerEntryReadModel[]> {
    const entries = await this.billingLedgerRepository.listByOrganizationId(
      new Types.ObjectId(tenantContext.organizationId),
      limit,
    );
    return entries.map(toBillingLedgerEntryReadModel);
  }

  async adminActivateSubscription(
    adminContext: AdminContext,
    params: {
      organizationId: Types.ObjectId;
      planCode: string;
      periodDays?: number;
      amountMinorUnits?: number;
      currency?: string;
      reason: string;
      correlationId?: string;
      idempotency: { identityId: Types.ObjectId; key: string; requestBody: Record<string, unknown> };
    },
  ): Promise<OrganizationSubscriptionDocument> {
    if (!params.reason || params.reason.trim().length < 10) {
      throw new AppException(ErrorCode.ADMIN_REASON_REQUIRED, 'Reason must be at least 10 characters');
    }

    // ИСПРАВЛЕНО 13.09.2026 (найдено ревью) — тот же класс проблемы, что
    // getOrganizationSubscription выше: organizationId здесь берётся прямо
    // из URL admin/organizations/:organizationId/billing/activate, и без
    // этой проверки привилегированный admin мог активировать платный
    // тариф и записать биллинг-ledger для несуществующей организации.
    const organization = await this.organizationsService.getOrganizationById(params.organizationId);
    if (!organization) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Organization '${params.organizationId.toHexString()}' not found`,
      );
    }

    await this.ensurePlansSeeded();
    const plan = await this.subscriptionPlanRepository.findByCode(params.planCode);
    if (!plan) {
      throw new AppException(ErrorCode.NOT_FOUND, `Subscription plan '${params.planCode}' not found`);
    }

    const periodDays = params.periodDays && params.periodDays > 0 ? params.periodDays : 30;
    const amountMinorUnits = params.amountMinorUnits ?? 0;
    const currency = params.currency || 'USD';

    return runInTransaction(this.connection, async (session) => {
      const existing = await this.organizationSubscriptionRepository.findByOrganizationId(
        params.organizationId,
        session,
      );

      const now = new Date();
      let startedAt = now;
      let expiresAt: Date;
      const isRenew =
        existing &&
        existing.planCode === params.planCode &&
        existing.status === 'active' &&
        existing.expiresAt > now;

      if (isRenew) {
        expiresAt = new Date(existing.expiresAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
        startedAt = existing.startedAt;
      } else {
        expiresAt = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
      }

      const subscription = await this.organizationSubscriptionRepository.upsertSubscription(
        {
          organizationId: params.organizationId,
          planCode: params.planCode,
          status: 'active',
          startedAt,
          expiresAt,
          gracePeriodEndsAt: null,
          customLimits: existing?.customLimits ?? null,
          currentUsage: existing?.currentUsage ?? { activeListings: 0, teamPositions: 1 },
        },
        session,
      );

      await this.billingLedgerRepository.appendEntry(
        {
          organizationId: params.organizationId,
          action: isRenew ? 'plan_renewed' : 'plan_activated',
          planCode: params.planCode,
          periodDays,
          amountMinorUnits,
          currency,
          reason: params.reason.trim(),
          recordedBy: new Types.ObjectId(adminContext.adminAccountId),
          correlationId: params.correlationId || '',
        },
        session,
      );

      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: new Types.ObjectId(adminContext.adminAccountId) },
          action: 'billing.subscription.activate',
          resource: 'organization_subscription',
          resourceId: subscription._id as Types.ObjectId,
          reason: params.reason.trim(),
          after: {
            planCode: params.planCode,
            status: 'active',
            periodDays,
            amountMinorUnits,
            currency,
            expiresAt,
          },
          correlationId: params.correlationId || '',
        },
        session,
      );

      await this.idempotencyService.record(
        {
          identityId: params.idempotency.identityId,
          operation: 'adminActivateSubscription',
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 200,
          responseBody: JSON.parse(JSON.stringify(subscription)),
        },
        session,
      );

      return subscription;
    });
  }

  async adminGetBillingOverview(
    _adminContext: AdminContext,
    organizationId: Types.ObjectId,
  ): Promise<AdminBillingOverview> {
    const overview = await this.getOrganizationSubscription(organizationId);
    const ledgerEntries = await this.billingLedgerRepository.listByOrganizationId(organizationId, 50);

    return {
      ...overview,
      ledger: ledgerEntries.map(toBillingLedgerEntryReadModel),
    };
  }
}
