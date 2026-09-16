import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import type { AdminContext } from '../../shared/admin/admin-context';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { AdminPolicyService } from './admin-policy.service';

export interface AdminPersonView {
  identityId: string;
  name: string;
  login: string;
  organizationName: string | null;
  organizationType: string | null;
}

/**
 * Люди платформы в админке. Имя после регистрации меняет BAZA, не сам человек
 * (решение владельца 16.09.2026): оно видно в команде ERP, сделках, рейтинге
 * риэлторов и реферальной сети, и подмена имени — повод для разбирательства.
 *
 * Право `person.rename`: суперадмин может всегда, обычному администратору
 * нужен индивидуальный грант. Причина обязательна и уходит в аудит вместе со
 * старым и новым именем.
 */
@Injectable()
export class AdminPeopleService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly policy: AdminPolicyService,
    private readonly organizations: OrganizationsService,
    private readonly auditService: AuditService,
  ) {}

  async rename(
    adminContext: AdminContext,
    params: { identityId: Types.ObjectId; name: string; reason: string; correlationId: string },
  ): Promise<AdminPersonView> {
    await this.policy.requireGrant({ adminContext, resource: 'person', action: 'rename' });
    const name = params.name.trim();

    await runInTransaction(this.connection, async (session) => {
      const renamed = await this.organizations.renameOccupantForPlatform(params.identityId, name, session);
      if (!renamed) {
        // Человек только с маркетплейса: должности нет, его показывают по логину.
        throw new AppException(ErrorCode.PERSON_WITHOUT_POSITION, 'Person has no active position to rename');
      }
      await this.auditService.append(
        {
          actor: { type: 'admin_account', id: new Types.ObjectId(adminContext.adminAccountId) },
          action: 'person.rename',
          resource: 'position',
          resourceId: renamed.positionId,
          reason: params.reason.trim(),
          before: { name: renamed.previousName, identityId: params.identityId.toString() },
          after: { name, identityId: params.identityId.toString() },
          correlationId: params.correlationId,
        },
        session,
      );
    });

    const [person] = await this.organizations.getPeopleSummaries([params.identityId]);
    return {
      identityId: params.identityId.toString(),
      name: person?.name ?? name,
      login: person?.login ?? '',
      organizationName: person?.organizationName ?? null,
      organizationType: person?.organizationType ?? null,
    };
  }
}
