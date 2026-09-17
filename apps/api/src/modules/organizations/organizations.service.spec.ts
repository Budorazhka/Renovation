import { ConflictException, NotFoundException } from '@nestjs/common';
import { MarketplacePublicationRepository } from '@baza/publication';
import { Types } from 'mongoose';
import { OrganizationsService } from './organizations.service';
import type { OrganizationRepository } from './repository/organization.repository';
import type { PositionRepository } from './repository/position.repository';
import type { PositionProfileRepository } from './repository/position-profile.repository';
import type { PositionAssignmentRepository } from './repository/position-assignment.repository';
import type { InvitationRepository } from './repository/invitation.repository';
import type { SessionService } from '../identity/session.service';
import type { AuthService } from '../identity/auth.service';
import type { AuditService } from '../audit/audit.service';
import type { OutboxService } from '../outbox/outbox.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AppException } from '../../shared/errors/app-exception';

/**
 * Мок Connection: withTransaction выполняет work() напрямую, без реальной
 * MongoDB-транзакции — этого достаточно для unit-проверки командной логики
 * (какие repository-вызовы происходят и в каком порядке). Атомарность
 * самой транзакции проверяется integration-тестом против реального
 * MongoDB replica set, не здесь.
 */
function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

describe('OrganizationsService.assignOccupant', () => {
  /**
   * ADR-002 требование 1 / tenant escape prevention: попытка занять позицию,
   * фактически принадлежащую ДРУГОЙ организации, чем expectedOrganizationId
   * (переданный из VerifiedTenantContext), должна провалиться как
   * NotFoundException — не найти позицию, не выполнить назначение, не
   * вызвать audit/outbox. Один и тот же результат, что и для реально
   * несуществующего positionId (error-catalog.md: не раскрываем cross-tenant
   * существование).
   */
  it('отклоняет назначение, если позиция принадлежит другой организации', async () => {
    // findByIdForOrganization сам фильтрует по organizationId — "чужая
    // организация" в реальном коде возвращает null, не документ с другим
    // organizationId (в отличие от старого findById, который такое
    // возвращал бы, полагаясь на проверку в сервисе).
    const expectedOrganizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();

    const findByIdForOrganizationSpy = jest.fn().mockResolvedValue(null);
    const createAssignmentSpy = jest.fn();
    const markOccupiedSpy = jest.fn();
    const auditAppendSpy = jest.fn();
    const outboxPublishSpy = jest.fn();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as OrganizationRepository,
      { findByIdForOrganization: findByIdForOrganizationSpy, markOccupied: markOccupiedSpy } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: createAssignmentSpy } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: jest.fn(), findByIds: jest.fn() } as unknown as AuthService,
      { append: auditAppendSpy } as unknown as AuditService,
      { publish: outboxPublishSpy } as unknown as OutboxService,
      { grant: jest.fn() } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.assignOccupant({
        positionId,
        identityId: new Types.ObjectId(),
        occupantDisplayName: 'Test User',
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId,
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createAssignmentSpy).not.toHaveBeenCalled();
    expect(markOccupiedSpy).not.toHaveBeenCalled();
    expect(auditAppendSpy).not.toHaveBeenCalled();
    expect(outboxPublishSpy).not.toHaveBeenCalled();
  });

  it('отклоняет назначение, если позиция вообще не найдена', async () => {
    const findByIdForOrganizationSpy = jest.fn().mockResolvedValue(null);
    const createAssignmentSpy = jest.fn();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as OrganizationRepository,
      { findByIdForOrganization: findByIdForOrganizationSpy } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: createAssignmentSpy } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: jest.fn(), findByIds: jest.fn() } as unknown as AuthService,
      { append: jest.fn() } as unknown as AuditService,
      { publish: jest.fn() } as unknown as OutboxService,
      { grant: jest.fn() } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.assignOccupant({
        positionId: new Types.ObjectId(),
        identityId: new Types.ObjectId(),
        occupantDisplayName: 'Test User',
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createAssignmentSpy).not.toHaveBeenCalled();
  });

  /**
   * Реальный найденный пробел (second-opinion ревью): без явной проверки
   * status==='vacant' closed-позицию можно было "воскресить" назначением
   * occupant'а — partial unique index защищает только occupied-случай.
   */
  it('отклоняет назначение на closed-позицию (не только occupied)', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const createAssignmentSpy = jest.fn();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId, status: 'closed' }),
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: createAssignmentSpy } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: jest.fn(), findByIds: jest.fn() } as unknown as AuthService,
      { append: jest.fn() } as unknown as AuditService,
      { publish: jest.fn() } as unknown as OutboxService,
      { grant: jest.fn() } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.assignOccupant({
        positionId,
        identityId: new Types.ObjectId(),
        occupantDisplayName: 'Test User',
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createAssignmentSpy).not.toHaveBeenCalled();
  });

  /**
   * Реальный найденный пробел (second-opinion ревью): identityId никак не
   * проверялся на существование — assignment мог указывать на несуществующую
   * identity (не FK-enforced на уровне Mongo, только ref в схеме).
   */
  it('отклоняет назначение, если identity не существует', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const createAssignmentSpy = jest.fn();
    const findByIdsSpy = jest.fn().mockResolvedValue([]);

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId, status: 'vacant' }),
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: createAssignmentSpy } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: jest.fn(), findByIds: findByIdsSpy } as unknown as AuthService,
      { append: jest.fn() } as unknown as AuditService,
      { publish: jest.fn() } as unknown as OutboxService,
      { grant: jest.fn() } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.assignOccupant({
        positionId,
        identityId: new Types.ObjectId(),
        occupantDisplayName: 'Test User',
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createAssignmentSpy).not.toHaveBeenCalled();
  });

  it('назначает occupant и пишет audit+outbox внутри транзакции, когда организация совпадает', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();

    const findByIdForOrganizationSpy = jest
      .fn()
      .mockResolvedValue({ _id: positionId, organizationId, status: 'vacant' });
    const createAssignmentSpy = jest.fn().mockResolvedValue({ _id: assignmentId });
    const markOccupiedSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);
    const outboxPublishSpy = jest.fn().mockResolvedValue(undefined);
    const grantErpAccessSpy = jest.fn().mockResolvedValue(undefined);
    const findByIdsSpy = jest.fn().mockResolvedValue([{ id: identityId, normalizedLogin: 'test', status: 'active' }]);

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as OrganizationRepository,
      { findByIdForOrganization: findByIdForOrganizationSpy, markOccupied: markOccupiedSpy } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: createAssignmentSpy } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: grantErpAccessSpy, findByIds: findByIdsSpy } as unknown as AuthService,
      { append: auditAppendSpy } as unknown as AuditService,
      { publish: outboxPublishSpy } as unknown as OutboxService,
      { grant: jest.fn() } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    const result = await service.assignOccupant({
      positionId,
      identityId,
      occupantDisplayName: 'Test User',
      actorIdentityId: new Types.ObjectId(),
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
    });

    expect(result).toBe(assignmentId);
    expect(createAssignmentSpy).toHaveBeenCalledTimes(1);
    expect(markOccupiedSpy).toHaveBeenCalledTimes(1);
    expect(auditAppendSpy).toHaveBeenCalledTimes(1);
    expect(outboxPublishSpy).toHaveBeenCalledTimes(1);
    // ADR-003/ADR-004: assignOccupant подразумевает ProductAccess('erp').
    expect(grantErpAccessSpy).toHaveBeenCalledWith(identityId);
  });
});

describe('OrganizationsService.assignOccupantByEmail', () => {
  function makeService(overrides: {
    findOrCreatePendingIdentity: jest.Mock;
    invitationCreateSpy?: jest.Mock;
  }) {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();

    return {
      positionId,
      organizationId,
      assignmentId,
      invitationCreateSpy: overrides.invitationCreateSpy ?? jest.fn().mockResolvedValue(undefined),
      service: new OrganizationsService(
        makeMockConnection() as never,
        {} as unknown as OrganizationRepository,
        {
          findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId, status: 'vacant' }),
          markOccupied: jest.fn().mockResolvedValue(undefined),
        } as unknown as PositionRepository,
        {} as unknown as PositionProfileRepository,
        { createAssignment: jest.fn().mockResolvedValue({ _id: assignmentId }) } as unknown as PositionAssignmentRepository,
        { create: overrides.invitationCreateSpy ?? jest.fn().mockResolvedValue(undefined) } as unknown as InvitationRepository,
        {} as SessionService,
        {
          grantErpAccess: jest.fn().mockResolvedValue(undefined),
          findOrCreatePendingIdentity: overrides.findOrCreatePendingIdentity,
          // assignOccupantByEmail делегирует assignOccupant, которая
          // проверяет существование identity через findByIds (3.2-фикс) —
          // identity, только что резолвленная findOrCreatePendingIdentity,
          // по определению существует.
          findByIds: jest.fn().mockResolvedValue([{ id: new Types.ObjectId(), normalizedLogin: 'x', status: 'active' }]),
        } as unknown as AuthService,
        { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
        { publish: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService,
        { grant: jest.fn() } as unknown as PolicyEvaluatorService,
        { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
      ),
    };
  }

  it('существующая identity: linkedExisting:true, НЕ создаёт Invitation', async () => {
    const linkedIdentityId = new Types.ObjectId();
    const invitationCreateSpy = jest.fn();
    const { service, positionId, organizationId } = makeService({
      findOrCreatePendingIdentity: jest.fn().mockResolvedValue({ identityId: linkedIdentityId, isNew: false }),
      invitationCreateSpy,
    });

    const result = await service.assignOccupantByEmail({
      positionId,
      name: 'Existing Person',
      email: 'existing@example.com',
      loginEmail: 'existing@example.com',
      actorIdentityId: new Types.ObjectId(),
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
    });

    expect(result.linkedExisting).toBe(true);
    expect(result.inviteToken).toBeNull();
    expect(result.inviteTokenExpiresAt).toBeNull();
    expect(invitationCreateSpy).not.toHaveBeenCalled();
  });

  it('новая identity: linkedExisting:false, создаёт Invitation с токеном и TTL 7 дней', async () => {
    const newIdentityId = new Types.ObjectId();
    const invitationCreateSpy = jest.fn().mockResolvedValue(undefined);
    const { service, positionId, organizationId } = makeService({
      findOrCreatePendingIdentity: jest.fn().mockResolvedValue({ identityId: newIdentityId, isNew: true }),
      invitationCreateSpy,
    });

    const before = Date.now();
    const result = await service.assignOccupantByEmail({
      positionId,
      name: 'New Person',
      email: 'new@example.com',
      loginEmail: 'new@example.com',
      actorIdentityId: new Types.ObjectId(),
      expectedOrganizationId: organizationId,
      correlationId: 'test-correlation-id',
    });
    const after = Date.now();

    expect(result.linkedExisting).toBe(false);
    expect(result.inviteToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inviteTokenExpiresAt).toBeInstanceOf(Date);
    const ttlMs = result.inviteTokenExpiresAt!.getTime() - before;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(ttlMs).toBeGreaterThanOrEqual(sevenDaysMs - (after - before));
    expect(ttlMs).toBeLessThanOrEqual(sevenDaysMs + (after - before));

    expect(invitationCreateSpy).toHaveBeenCalledTimes(1);
    const [invitationParams] = invitationCreateSpy.mock.calls[0] as [
      { organizationId: Types.ObjectId; positionId: Types.ObjectId; identityId: Types.ObjectId; tokenHash: string; email: string; expiresAt: Date },
    ];
    expect(invitationParams.identityId).toBe(newIdentityId);
    expect(invitationParams.positionId).toBe(positionId);
    expect(invitationParams.organizationId).toBe(organizationId);
    expect(invitationParams.email).toBe('new@example.com');
    // tokenHash — SHA-256 сырого токена, НЕ равен самому токену (сырой токен не должен утекать в БД).
    expect(invitationParams.tokenHash).not.toBe(result.inviteToken);
    expect(invitationParams.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('OrganizationsService.activateInvitation', () => {
  function makeService(overrides: {
    findByTokenHash: jest.Mock;
    activatePendingIdentity?: jest.Mock;
    markActivated?: jest.Mock;
  }) {
    return new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {} as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {
        findByTokenHash: overrides.findByTokenHash,
        markActivated: overrides.markActivated ?? jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      } as unknown as InvitationRepository,
      {} as SessionService,
      {
        activatePendingIdentity: overrides.activatePendingIdentity ?? jest.fn().mockResolvedValue({ activated: true }),
      } as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );
  }

  it('валидный pending токен: активирует, помечает Invitation activated, возвращает email', async () => {
    const identityId = new Types.ObjectId();
    const markActivatedSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const service = makeService({
      findByTokenHash: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        identityId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        email: 'invited@example.com',
      }),
      markActivated: markActivatedSpy,
    });

    const result = await service.activateInvitation('raw-token', 'new-password-123');

    expect(result).toEqual({ email: 'invited@example.com' });
    expect(markActivatedSpy).toHaveBeenCalledTimes(1);
  });

  it('токен не найден: 404-эквивалент (AppException), не активирует ничего', async () => {
    const activatePendingIdentitySpy = jest.fn();
    const service = makeService({
      findByTokenHash: jest.fn().mockResolvedValue(null),
      activatePendingIdentity: activatePendingIdentitySpy,
    });

    await expect(service.activateInvitation('unknown-token', 'password')).rejects.toBeInstanceOf(AppException);
    expect(activatePendingIdentitySpy).not.toHaveBeenCalled();
  });

  it('истёкший токен: отклоняет, не вызывает activatePendingIdentity', async () => {
    const activatePendingIdentitySpy = jest.fn();
    const service = makeService({
      findByTokenHash: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        identityId: new Types.ObjectId(),
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
        email: 'invited@example.com',
      }),
      activatePendingIdentity: activatePendingIdentitySpy,
    });

    await expect(service.activateInvitation('expired-token', 'password')).rejects.toBeInstanceOf(AppException);
    expect(activatePendingIdentitySpy).not.toHaveBeenCalled();
  });

  it('уже активированный токен (status:activated): отклоняет', async () => {
    const service = makeService({
      findByTokenHash: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        identityId: new Types.ObjectId(),
        status: 'activated',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        email: 'invited@example.com',
      }),
    });

    await expect(service.activateInvitation('already-used-token', 'password')).rejects.toBeInstanceOf(AppException);
  });

  it('гонка (activatePendingIdentity.activated:false): отклоняет, не помечает Invitation', async () => {
    const markActivatedSpy = jest.fn();
    const service = makeService({
      findByTokenHash: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        identityId: new Types.ObjectId(),
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        email: 'invited@example.com',
      }),
      activatePendingIdentity: jest.fn().mockResolvedValue({ activated: false }),
      markActivated: markActivatedSpy,
    });

    await expect(service.activateInvitation('raced-token', 'password')).rejects.toBeInstanceOf(AppException);
    expect(markActivatedSpy).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.createOrganizationWithOwner', () => {
  it('гранты ProductAccess(erp) владельцу после создания организации', async () => {
    const ownerIdentityId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const grantErpAccessSpy = jest.fn().mockResolvedValue(undefined);

    const service = new OrganizationsService(
      makeMockConnection() as never,
      { create: jest.fn().mockResolvedValue({ _id: organizationId }) } as unknown as OrganizationRepository,
      {
        create: jest.fn().mockResolvedValue({ _id: positionId }),
        markOccupied: jest.fn().mockResolvedValue(undefined),
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: grantErpAccessSpy } as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      { grantMany: jest.fn().mockResolvedValue(undefined) } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    const result = await service.createOrganizationWithOwner({
      type: 'agency',
      name: 'Test Agency',
      ownerIdentityId,
    });

    expect(result).toEqual({ organizationId, positionId });
    expect(grantErpAccessSpy).toHaveBeenCalledWith(ownerIdentityId);
  });

  /**
   * Реальный E2E-прогон нашёл: без этих grants deny-by-default
   * PolicyEvaluatorService отклоняет ЛЮБОЙ authenticated ERP-запрос даже
   * для только что созданного owner — прямая регрессионная проверка.
   */
  it('создаёт PermissionGrant для КАЖДОГО дефолтного права роли owner (permission-matrix.md разд.1)', async () => {
    const ownerIdentityId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const grantManySpy = jest.fn().mockResolvedValue(undefined);

    const service = new OrganizationsService(
      makeMockConnection() as never,
      { create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) } as unknown as OrganizationRepository,
      {
        create: jest.fn().mockResolvedValue({ _id: positionId }),
        markOccupied: jest.fn().mockResolvedValue(undefined),
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { createAssignment: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      { grantErpAccess: jest.fn() } as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      { grantMany: grantManySpy } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await service.createOrganizationWithOwner({ type: 'agency', name: 'Test Agency', ownerIdentityId });

    // grantMany (не grant) — один insertMany вместо N round-trips
    // (second-opinion ревью).
    expect(grantManySpy).toHaveBeenCalledTimes(1);
    const [items] = grantManySpy.mock.calls[0];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toMatchObject({ subjectType: 'position', subjectId: positionId });
    }
    // Хотя бы development.edit — owner обязан мочь редактировать ЖК
    // (permission-matrix.md 1.2, прямая проверка не полагается только на
    // "хоть что-то создалось").
    expect(items.some((item: { resource: string; action: string }) => item.resource === 'development' && item.action === 'edit')).toBe(true);
  });
});

describe('OrganizationsService.grantPositionPermission', () => {
  it('создаёт grant для position, принадлежащей организации', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const grantSpy = jest.fn().mockResolvedValue(undefined);

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      { grant: grantSpy } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await service.grantPositionPermission({
      positionId,
      expectedOrganizationId: organizationId,
      resource: 'unit',
      action: 'price.update',
      scope: 'organization',
    });

    expect(grantSpy).toHaveBeenCalledWith({
      subjectType: 'position',
      subjectId: positionId,
      resource: 'unit',
      action: 'price.update',
      scope: 'organization',
      scopeValue: undefined,
    });
  });

  it('бросает NotFoundException для чужой организации, не вызывает grant', async () => {
    const grantSpy = jest.fn();
    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      { findByIdForOrganization: jest.fn().mockResolvedValue(null) } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      { grant: grantSpy } as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.grantPositionPermission({
        positionId: new Types.ObjectId(),
        expectedOrganizationId: new Types.ObjectId(),
        resource: 'unit',
        action: 'price.update',
        scope: 'organization',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(grantSpy).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.listPositionGrants / revokePositionGrant', () => {
  function makeService(overrides: {
    positionRepository?: unknown;
    policyEvaluator?: unknown;
    auditService?: unknown;
  }) {
    return new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      (overrides.positionRepository ?? {}) as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      (overrides.auditService ?? { append: jest.fn().mockResolvedValue(undefined) }) as unknown as AuditService,
      {} as unknown as OutboxService,
      (overrides.policyEvaluator ?? {}) as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );
  }

  it('listPositionGrants: делегирует listAllGrantsForSubject для позиции, принадлежащей организации', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const items = [{ id: new Types.ObjectId(), resource: 'lead', action: 'read', scope: 'organization' as const, version: 1 }];
    const listSpy = jest.fn().mockResolvedValue(items);

    const service = makeService({
      positionRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) },
      policyEvaluator: { listAllGrantsForSubject: listSpy },
    });

    const result = await service.listPositionGrants({ positionId, expectedOrganizationId: organizationId });

    expect(listSpy).toHaveBeenCalledWith('position', positionId);
    expect(result).toBe(items);
  });

  it('listPositionGrants: чужая организация — NotFoundException', async () => {
    const service = makeService({
      positionRepository: { findByIdForOrganization: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.listPositionGrants({ positionId: new Types.ObjectId(), expectedOrganizationId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokePositionGrant: отзывает свой grant, пишет audit', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const grantId = new Types.ObjectId();
    const revokedBy = new Types.ObjectId();
    const grant = {
      _id: grantId,
      subjectType: 'position',
      subjectId: positionId,
      resource: 'lead',
      action: 'read',
      scope: 'organization',
      scopeValue: undefined,
      revokedAt: undefined,
    };
    const revokeSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const appendSpy = jest.fn().mockResolvedValue(undefined);

    const service = makeService({
      positionRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) },
      policyEvaluator: { findGrantById: jest.fn().mockResolvedValue(grant), revokeGrant: revokeSpy },
      auditService: { append: appendSpy },
    });

    await service.revokePositionGrant({
      positionId,
      expectedOrganizationId: organizationId,
      grantId,
      expectedVersion: 1,
      reason: 'ошибочно выдано',
      revokedBy,
      correlationId: 'corr-1',
    });

    expect(revokeSpy).toHaveBeenCalledWith(grantId, 1, { revokedBy, reason: 'ошибочно выдано' });
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it('revokePositionGrant: чужой grant (другая позиция) — NOT_FOUND, revoke не вызывается', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const grantId = new Types.ObjectId();
    const revokeSpy = jest.fn();

    const service = makeService({
      positionRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) },
      policyEvaluator: {
        findGrantById: jest.fn().mockResolvedValue({
          _id: grantId,
          subjectType: 'position',
          subjectId: new Types.ObjectId(),
          resource: 'lead',
          action: 'read',
          scope: 'organization',
        }),
        revokeGrant: revokeSpy,
      },
    });

    await expect(
      service.revokePositionGrant({
        positionId,
        expectedOrganizationId: organizationId,
        grantId,
        expectedVersion: 1,
        reason: 'test',
        revokedBy: new Types.ObjectId(),
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('revokePositionGrant: уже отозванный grant — VERSION_CONFLICT, revoke не вызывается повторно', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const grantId = new Types.ObjectId();
    const revokeSpy = jest.fn();

    const service = makeService({
      positionRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) },
      policyEvaluator: {
        findGrantById: jest.fn().mockResolvedValue({
          _id: grantId,
          subjectType: 'position',
          subjectId: positionId,
          resource: 'lead',
          action: 'read',
          scope: 'organization',
          revokedAt: new Date(),
        }),
        revokeGrant: revokeSpy,
      },
    });

    await expect(
      service.revokePositionGrant({
        positionId,
        expectedOrganizationId: organizationId,
        grantId,
        expectedVersion: 1,
        reason: 'test',
        revokedBy: new Types.ObjectId(),
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VERSION_CONFLICT });
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('revokePositionGrant: modifiedCount 0 (гонка) — VERSION_CONFLICT', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const grantId = new Types.ObjectId();

    const service = makeService({
      positionRepository: { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) },
      policyEvaluator: {
        findGrantById: jest.fn().mockResolvedValue({
          _id: grantId,
          subjectType: 'position',
          subjectId: positionId,
          resource: 'lead',
          action: 'read',
          scope: 'organization',
          revokedAt: undefined,
        }),
        revokeGrant: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      },
    });

    await expect(
      service.revokePositionGrant({
        positionId,
        expectedOrganizationId: organizationId,
        grantId,
        expectedVersion: 1,
        reason: 'test',
        revokedBy: new Types.ObjectId(),
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VERSION_CONFLICT });
  });
});

describe('OrganizationsService.vacatePositionByPositionId', () => {
  it('находит активный assignment по positionId, делегирует vacatePosition, пишет audit+outbox', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const actorIdentityId = new Types.ObjectId();
    const endAssignmentSpy = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const markVacantSpy = jest.fn().mockResolvedValue(undefined);
    const revokeSpy = jest.fn().mockResolvedValue(undefined);
    const auditAppendSpy = jest.fn().mockResolvedValue(undefined);
    const outboxPublishSpy = jest.fn().mockResolvedValue(undefined);

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }),
        markVacant: markVacantSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {
        findActiveByPosition: jest.fn().mockResolvedValue({ _id: assignmentId, identityId }),
        endAssignment: endAssignmentSpy,
      } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      { revokeAllErpSessions: revokeSpy } as unknown as SessionService,
      {} as unknown as AuthService,
      { append: auditAppendSpy } as unknown as AuditService,
      { publish: outboxPublishSpy } as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await service.vacatePositionByPositionId({
      positionId,
      expectedOrganizationId: organizationId,
      actorIdentityId,
      correlationId: 'test-correlation-id',
    });

    expect(endAssignmentSpy).toHaveBeenCalledWith(assignmentId, undefined, expect.anything());
    expect(markVacantSpy).toHaveBeenCalledWith(positionId, expect.anything());
    expect(revokeSpy).toHaveBeenCalledWith(identityId);
    // Реальный найденный пробел (second-opinion ревью): vacatePosition не
    // писал audit/outbox вообще, хотя position.vacate помечен как
    // ⚙-критичное действие в permission-matrix.md, симметрично assignOccupant.
    expect(auditAppendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'position.vacate', resourceId: assignmentId }),
      expect.anything(),
    );
    expect(outboxPublishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PositionVacated', aggregateId: positionId }),
      expect.anything(),
    );
  });

  /**
   * Реальный найденный race (second-opinion ревью): endAssignment раньше
   * фильтровал только по _id, без endedAt:{$exists:false} — конкурентный
   * повторный vacate того же assignment мог перезаписать endedAt. Теперь
   * matchedCount:0 сигнализирует "уже завершён", сервис бросает
   * ConflictException, не тихо перезаписывает.
   */
  it('бросает ConflictException, если assignment уже завершён конкурентным вызовом', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    const identityId = new Types.ObjectId();
    const markVacantSpy = jest.fn();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }),
        markVacant: markVacantSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {
        findActiveByPosition: jest.fn().mockResolvedValue({ _id: assignmentId, identityId }),
        endAssignment: jest.fn().mockResolvedValue({ matchedCount: 0 }),
      } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      { revokeAllErpSessions: jest.fn() } as unknown as SessionService,
      {} as unknown as AuthService,
      { append: jest.fn() } as unknown as AuditService,
      { publish: jest.fn() } as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.vacatePositionByPositionId({
        positionId,
        expectedOrganizationId: organizationId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(markVacantSpy).not.toHaveBeenCalled();
  });

  it('бросает NotFoundException, если нет активного assignment для позиции', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      { findActiveByPosition: jest.fn().mockResolvedValue(null) } as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.vacatePositionByPositionId({
        positionId,
        expectedOrganizationId: organizationId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('бросает NotFoundException для чужой организации', async () => {
    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      { findByIdForOrganization: jest.fn().mockResolvedValue(null) } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.vacatePositionByPositionId({
        positionId: new Types.ObjectId(),
        expectedOrganizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'test-correlation-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrganizationsService.changePositionParent', () => {
  it('меняет parentPositionId, если новый родитель существует в организации', async () => {
    const positionId = new Types.ObjectId();
    const newParentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const updateParentSpy = jest.fn().mockResolvedValue({ matchedCount: 1 });

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest
          .fn()
          .mockResolvedValueOnce({ _id: positionId, organizationId })
          .mockResolvedValueOnce({ _id: newParentId, organizationId }),
        updateParent: updateParentSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await service.changePositionParent({ positionId, newParentPositionId: newParentId, expectedOrganizationId: organizationId });

    expect(updateParentSpy).toHaveBeenCalledWith(positionId, newParentId);
  });

  it('допускает null (позиция становится top-level)', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const updateParentSpy = jest.fn().mockResolvedValue({ matchedCount: 1 });

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }),
        updateParent: updateParentSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await service.changePositionParent({ positionId, newParentPositionId: null, expectedOrganizationId: organizationId });

    expect(updateParentSpy).toHaveBeenCalledWith(positionId, null);
  });

  /**
   * Реальный найденный баг (second-opinion ревью): repository раньше
   * возвращал modifiedCount, а не matchedCount — идемпотентный повторный
   * вызов move с тем же parentId, что уже стоит на записи, MongoDB не
   * считает модификацией (modifiedCount:0), хотя документ реально найден.
   * Сервис ошибочно бросал 404 для логически успешного no-op. Эта проверка
   * защищает от регрессии на уровне сервиса (repository-уровня версия — в
   * position.repository.spec.ts).
   */
  it('не бросает 404 для идемпотентного вызова (тот же parentId уже стоит на записи)', async () => {
    const positionId = new Types.ObjectId();
    const newParentId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    // matchedCount:1 (документ найден), но реального изменения не было —
    // именно то, что MongoDB даёт при no-op $set.
    const updateParentSpy = jest.fn().mockResolvedValue({ matchedCount: 1 });

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest
          .fn()
          .mockResolvedValueOnce({ _id: positionId, organizationId })
          .mockResolvedValueOnce({ _id: newParentId, organizationId }),
        updateParent: updateParentSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.changePositionParent({ positionId, newParentPositionId: newParentId, expectedOrganizationId: organizationId }),
    ).resolves.toBeUndefined();
  });

  it('отклоняет self-parent', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      { findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId }) } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.changePositionParent({ positionId, newParentPositionId: positionId, expectedOrganizationId: organizationId }),
    ).rejects.toMatchObject(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
  });
});

describe('OrganizationsService.closePosition', () => {
  it('закрывает vacant позицию', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const markClosedSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId, status: 'vacant' }),
        markClosed: markClosedSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await service.closePosition({ positionId, expectedOrganizationId: organizationId });

    expect(markClosedSpy).toHaveBeenCalledWith(positionId);
  });

  it('бросает ConflictException, если позиция занята (markClosed вернул modifiedCount:0)', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest.fn().mockResolvedValue({ _id: positionId, organizationId, status: 'occupied' }),
        markClosed: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.closePosition({ positionId, expectedOrganizationId: organizationId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('бросает NotFoundException для чужой организации', async () => {
    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      { findByIdForOrganization: jest.fn().mockResolvedValue(null) } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.closePosition({ positionId: new Types.ObjectId(), expectedOrganizationId: new Types.ObjectId() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * Реальный найденный, недокументированный риск (second-opinion ревью):
   * без этой проверки можно закрыть единственную owner-позицию организации —
   * тупик, создать новую некому (position.create.organization требует
   * owner/director гранта).
   */
  it('бросает ConflictException при попытке закрыть owner-позицию, не вызывает markClosed', async () => {
    const positionId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const markClosedSpy = jest.fn();

    const service = new OrganizationsService(
      makeMockConnection() as never,
      {} as unknown as OrganizationRepository,
      {
        findByIdForOrganization: jest
          .fn()
          .mockResolvedValue({ _id: positionId, organizationId, status: 'vacant', fixedRole: 'owner' }),
        markClosed: markClosedSpy,
      } as unknown as PositionRepository,
      {} as unknown as PositionProfileRepository,
      {} as unknown as PositionAssignmentRepository,
      {} as unknown as InvitationRepository,
      {} as SessionService,
      {} as unknown as AuthService,
      {} as unknown as AuditService,
      {} as unknown as OutboxService,
      {} as unknown as PolicyEvaluatorService,
      { setPublisherFrozenForOrganization: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as unknown as MarketplacePublicationRepository,
    );

    await expect(
      service.closePosition({ positionId, expectedOrganizationId: organizationId }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(markClosedSpy).not.toHaveBeenCalled();
  });
});
