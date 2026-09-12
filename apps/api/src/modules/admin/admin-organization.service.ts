import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AdminContext } from '../../shared/admin/admin-context';
import { AdminPolicyService } from './admin-policy.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { ListAdminOrganizationsQueryDto } from './dto/list-admin-organizations-query.dto';

@Injectable()
export class AdminOrganizationService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly adminPolicyService: AdminPolicyService,
  ) {}

  async list(adminContext: AdminContext, query: ListAdminOrganizationsQueryDto) {
    await this.adminPolicyService.requireGrant({
      adminContext,
      resource: 'organization',
      action: 'read',
    });

    return this.organizationsService.adminListOrganizations(query);
  }

  async getById(adminContext: AdminContext, id: Types.ObjectId) {
    await this.adminPolicyService.requireGrant({
      adminContext,
      resource: 'organization',
      action: 'read',
    });

    return this.organizationsService.adminGetOrganization(id);
  }

  async freeze(
    adminContext: AdminContext,
    params: { id: Types.ObjectId; reason: string; correlationId?: string },
  ) {
    this.adminPolicyService.requireReason(params.reason);
    await this.adminPolicyService.requireGrant({
      adminContext,
      resource: 'organization',
      action: 'freeze',
    });

    return this.organizationsService.adminFreezeOrganization({
      id: params.id,
      reason: params.reason,
      actorId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: params.correlationId,
    });
  }

  async unfreeze(
    adminContext: AdminContext,
    params: { id: Types.ObjectId; reason: string; correlationId?: string },
  ) {
    this.adminPolicyService.requireReason(params.reason);
    await this.adminPolicyService.requireGrant({
      adminContext,
      resource: 'organization',
      action: 'unfreeze',
    });

    return this.organizationsService.adminUnfreezeOrganization({
      id: params.id,
      reason: params.reason,
      actorId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: params.correlationId,
    });
  }

  async verifyMls(
    adminContext: AdminContext,
    params: { id: Types.ObjectId; reason: string; correlationId?: string },
  ) {
    this.adminPolicyService.requireReason(params.reason);
    await this.adminPolicyService.requireGrant({
      adminContext,
      resource: 'organization',
      action: 'verify_mls',
    });

    return this.organizationsService.adminVerifyMls({
      id: params.id,
      reason: params.reason,
      actorId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: params.correlationId,
    });
  }

  async revokeMlsVerification(
    adminContext: AdminContext,
    params: { id: Types.ObjectId; reason: string; correlationId?: string },
  ) {
    this.adminPolicyService.requireReason(params.reason);
    await this.adminPolicyService.requireGrant({
      adminContext,
      resource: 'organization',
      action: 'revoke_mls_verification',
    });

    return this.organizationsService.adminRevokeMlsVerification({
      id: params.id,
      reason: params.reason,
      actorId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: params.correlationId,
    });
  }
}
