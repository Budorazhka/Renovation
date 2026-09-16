import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../audit/audit.service';
import { DevelopmentsService } from '../developments/developments.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PublicationService } from '../publication/publication.service';
import { ClientRegistrationRepository } from './repository/client-registration.repository';
import {
  CLIENT_RESERVATION_MONTHS,
  type ClientRegistrationDocument,
  type ClientRegistrationStatus,
} from './schemas/client-registration.schema';

/** Потолок одной выдачи реестра: экран листает свежие заявки, архив за годы ему не нужен. */
export const CLIENT_REGISTRATION_LIST_LIMIT = 200;

export interface ClientRegistrationView {
  id: string;
  developmentId: string | null;
  developerName: string;
  projectName: string;
  unitLabel: string | null;
  clientName: string;
  clientPhone: string;
  leadId: string | null;
  agentPositionId: string;
  status: ClientRegistrationStatus;
  /**
   * Срок закрепления истёк. Считается на чтении из `reservedUntil` и статуса
   * — сервер не хранит отдельный статус `expired`, иначе тот же факт
   * отвечался бы дважды и по-разному.
   */
  isExpired: boolean;
  /** Ждёт ответа застройщика на платформе. У внешнего застройщика false: отвечать некому. */
  awaitsDeveloper: boolean;
  reservedUntil: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  notes: string | null;
  createdAt: string;
  version: number;
}

export interface CreateClientRegistrationInput {
  developmentId?: string;
  /** Адрес карточки ЖК на витрине — им комплекс адресует каталог платформы. */
  developmentSlug?: string;
  developerName?: string;
  projectName?: string;
  unitLabel?: string;
  clientName: string;
  clientPhone: string;
  leadId?: string;
  notes?: string;
}

export interface IdempotencyParams {
  actorIdentityId: Types.ObjectId;
  key: string;
  requestBody: Record<string, unknown>;
}

/**
 * Телефон без разделителей: «+995 555 12-34-56» и «995555123456» — один
 * человек, и проверка «клиент уже закреплён» обязана видеть это одинаково.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Дата окончания закрепления: решение владельца 16.09.2026 — шесть месяцев. */
export function reservationEnd(from: Date, months = CLIENT_RESERVATION_MONTHS): Date {
  const end = new Date(from.getTime());
  end.setMonth(end.getMonth() + months);
  return end;
}

export function isExpiredReservation(doc: ClientRegistrationDocument, now: Date): boolean {
  return doc.status === 'active' && doc.reservedUntil !== undefined && doc.reservedUntil.getTime() <= now.getTime();
}

function toView(doc: ClientRegistrationDocument, now: Date): ClientRegistrationView {
  return {
    id: doc._id.toString(),
    developmentId: doc.developmentId?.toString() ?? null,
    developerName: doc.developerName,
    projectName: doc.projectName,
    unitLabel: doc.unitLabel ?? null,
    clientName: doc.clientName,
    clientPhone: doc.clientPhone,
    leadId: doc.leadId?.toString() ?? null,
    agentPositionId: doc.agentPositionId.toString(),
    status: doc.status,
    isExpired: isExpiredReservation(doc, now),
    awaitsDeveloper: doc.status === 'pending' && doc.developerOrganizationId !== undefined,
    reservedUntil: doc.reservedUntil?.toISOString() ?? null,
    decidedAt: doc.decidedAt?.toISOString() ?? null,
    decisionNote: doc.decisionNote ?? null,
    notes: doc.notes ?? null,
    createdAt: doc.createdAt.toISOString(),
    version: doc.version,
  };
}

/** Что застройщик видит во входящей заявке: плюс агентство, минус заметки агентства для себя. */
export interface IncomingClientRegistrationView extends ClientRegistrationView {
  agencyOrganizationId: string;
}

@Injectable()
export class ClientRegistrationsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly registrations: ClientRegistrationRepository,
    private readonly developments: DevelopmentsService,
    private readonly organizations: OrganizationsService,
    private readonly publication: PublicationService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async listForOrganization(
    organizationId: Types.ObjectId,
    filter: { status?: ClientRegistrationStatus },
  ): Promise<ClientRegistrationView[]> {
    const docs = await this.registrations.listForOrganization(organizationId, {
      status: filter.status,
      limit: CLIENT_REGISTRATION_LIST_LIMIT,
    });
    const now = new Date();
    return docs.map((doc) => toView(doc, now));
  }

  async listIncoming(
    developerOrganizationId: Types.ObjectId,
    filter: { status?: ClientRegistrationStatus },
  ): Promise<IncomingClientRegistrationView[]> {
    const docs = await this.registrations.listForDeveloper(developerOrganizationId, {
      status: filter.status,
      limit: CLIENT_REGISTRATION_LIST_LIMIT,
    });
    const now = new Date();
    return docs.map((doc) => ({
      ...toView(doc, now),
      agencyOrganizationId: doc.organizationId.toString(),
    }));
  }

  /**
   * Подать заявку. ЖК на платформе задаёт застройщика: его организация
   * выводится из комплекса, а не приходит от клиента — иначе агентство
   * могло бы адресовать заявку любой чужой организации.
   */
  async create(params: {
    organizationId: Types.ObjectId;
    agentPositionId: Types.ObjectId;
    input: CreateClientRegistrationInput;
    idempotency: IdempotencyParams;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    const now = new Date();
    const target = await this.resolveTarget(params.input);
    const clientPhoneNormalized = normalizePhone(params.input.clientPhone);
    if (clientPhoneNormalized.length < 5) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Client phone is not a phone number');
    }

    if (target.developmentId) {
      const blocking = await this.registrations.findBlocking(target.developmentId, clientPhoneNormalized, now);
      if (blocking) {
        // Название агентства-конкурента не раскрывается: заявителю нужно
        // знать, что клиент занят и до какого числа, а не у кого именно.
        throw new AppException(
          ErrorCode.CLIENT_ALREADY_REGISTERED,
          blocking.reservedUntil
            ? `Client is already registered in this development until ${blocking.reservedUntil.toISOString()}`
            : 'Client is already registered in this development',
        );
      }
    }

    const created = await runInTransaction(this.connection, async (session) => {
      const doc = await this.registrations.create(
        {
          organizationId: params.organizationId,
          developerOrganizationId: target.developerOrganizationId,
          developmentId: target.developmentId,
          developerName: target.developerName,
          projectName: target.projectName,
          unitLabel: params.input.unitLabel,
          clientName: params.input.clientName,
          clientPhone: params.input.clientPhone,
          clientPhoneNormalized,
          leadId: params.input.leadId ? new Types.ObjectId(params.input.leadId) : undefined,
          agentPositionId: params.agentPositionId,
          notes: params.input.notes,
        },
        session,
      );

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.idempotency.actorIdentityId },
          action: 'client_registration.create',
          resource: 'client_registration',
          resourceId: doc._id,
          after: {
            developerName: doc.developerName,
            projectName: doc.projectName,
            clientName: doc.clientName,
            developmentId: doc.developmentId?.toString() ?? null,
          },
          correlationId: params.correlationId,
        },
        session,
      );

      await this.idempotencyService.record(
        {
          identityId: params.idempotency.actorIdentityId,
          operation: 'createClientRegistration',
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 201,
          responseBody: toView(doc, now) as unknown as Record<string, unknown>,
        },
        session,
      );
      return doc;
    });

    return toView(created, now);
  }

  /** Правка своей заявки: лот и заметка. Клиент и застройщик не меняются — это другая заявка. */
  async edit(params: {
    registrationId: Types.ObjectId;
    organizationId: Types.ObjectId;
    expectedVersion: number;
    unitLabel?: string;
    notes?: string;
  }): Promise<ClientRegistrationView> {
    const updated = await this.registrations.editForOrganization(
      params.registrationId,
      params.organizationId,
      params.expectedVersion,
      { unitLabel: params.unitLabel, notes: params.notes },
    );
    if (!updated) await this.explainMissedUpdate(params.registrationId, params.organizationId);
    return toView(updated!, new Date());
  }

  /** Застройщик подтверждает: клиент закрепляется за агентством на шесть месяцев. */
  async accept(params: {
    registrationId: Types.ObjectId;
    developerOrganizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    const now = new Date();
    return this.decideAsDeveloper({
      ...params,
      now,
      status: 'active',
      reservedUntil: reservationEnd(now),
      action: 'client_registration.accept',
    });
  }

  /** Застройщик отказывает — с причиной: агентству нужна причина, а не только статус. */
  async reject(params: {
    registrationId: Types.ObjectId;
    developerOrganizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    reason: string;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    return this.decideAsDeveloper({
      ...params,
      now: new Date(),
      status: 'rejected',
      decisionNote: params.reason,
      action: 'client_registration.reject',
    });
  }

  /**
   * Ручное подтверждение для застройщика вне платформы: менеджер отмечает
   * заявку подтверждённой, когда получил ответ по почте. Для ЖК на
   * платформе запрещено — там подтверждает застройщик.
   */
  async confirmExternal(params: {
    registrationId: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    const existing = await this.requireOwn(params.registrationId, params.organizationId);
    if (existing.developerOrganizationId) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Registration is addressed to a developer on the platform and is confirmed by them',
      );
    }
    const now = new Date();
    return this.decideAsAgency({
      ...params,
      now,
      status: 'active',
      reservedUntil: reservationEnd(now),
      fromStatuses: ['pending'],
      action: 'client_registration.confirm_external',
    });
  }

  /** Сделка состоялась: закрепление отработало. */
  async complete(params: {
    registrationId: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    return this.decideAsAgency({
      ...params,
      now: new Date(),
      status: 'completed',
      fromStatuses: ['active'],
      action: 'client_registration.complete',
    });
  }

  /** Агентство сняло заявку — клиент освобождается для других сразу. */
  async cancel(params: {
    registrationId: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    return this.decideAsAgency({
      ...params,
      now: new Date(),
      status: 'cancelled',
      fromStatuses: ['pending', 'active'],
      action: 'client_registration.cancel',
    });
  }

  private async decideAsDeveloper(params: {
    registrationId: Types.ObjectId;
    developerOrganizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    now: Date;
    status: ClientRegistrationStatus;
    reservedUntil?: Date;
    decisionNote?: string;
    action: string;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    const updated = await runInTransaction(this.connection, async (session) => {
      const doc = await this.registrations.decide(
        params.registrationId,
        { developerOrganizationId: params.developerOrganizationId },
        params.expectedVersion,
        ['pending'],
        {
          status: params.status,
          reservedUntil: params.reservedUntil,
          decidedAt: params.now,
          decidedByPositionId: params.decidedByPositionId,
          decisionNote: params.decisionNote,
        },
        session,
      );
      if (!doc) return null;
      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: params.action,
          resource: 'client_registration',
          resourceId: doc._id,
          after: { status: doc.status, reservedUntil: doc.reservedUntil?.toISOString() ?? null },
          correlationId: params.correlationId,
        },
        session,
      );
      return doc;
    });

    if (!updated) {
      const existing = await this.registrations.findForDeveloper(params.registrationId, params.developerOrganizationId);
      if (!existing) throw new NotFoundException('Client registration not found');
      if (existing.status !== 'pending') {
        throw new AppException(ErrorCode.VALIDATION_FAILED, `Registration is already ${existing.status}`);
      }
      throw new AppException(ErrorCode.VERSION_CONFLICT, 'Client registration was changed by someone else');
    }
    return toView(updated, params.now);
  }

  private async decideAsAgency(params: {
    registrationId: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    decidedByPositionId: Types.ObjectId;
    expectedVersion: number;
    now: Date;
    status: ClientRegistrationStatus;
    reservedUntil?: Date;
    fromStatuses: readonly ClientRegistrationStatus[];
    action: string;
    correlationId: string;
  }): Promise<ClientRegistrationView> {
    const updated = await runInTransaction(this.connection, async (session) => {
      const doc = await this.registrations.decide(
        params.registrationId,
        { organizationId: params.organizationId },
        params.expectedVersion,
        params.fromStatuses,
        {
          status: params.status,
          reservedUntil: params.reservedUntil,
          decidedAt: params.now,
          decidedByPositionId: params.decidedByPositionId,
        },
        session,
      );
      if (!doc) return null;
      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: params.action,
          resource: 'client_registration',
          resourceId: doc._id,
          after: { status: doc.status, reservedUntil: doc.reservedUntil?.toISOString() ?? null },
          correlationId: params.correlationId,
        },
        session,
      );
      return doc;
    });

    if (!updated) {
      const existing = await this.requireOwn(params.registrationId, params.organizationId);
      if (!params.fromStatuses.includes(existing.status)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, `Registration is ${existing.status}`);
      }
      throw new AppException(ErrorCode.VERSION_CONFLICT, 'Client registration was changed by someone else');
    }
    return toView(updated, params.now);
  }

  /**
   * ЖК на платформе или застройщик вне её. Комплекс читается без привязки к
   * организации-читателю намеренно: агентство фиксирует клиента у ЧУЖОГО
   * застройщика и обязано увидеть имя комплекса и его владельца.
   * Неопубликованный комплекс не отдаётся — иначе по id можно было бы
   * узнавать о чужих черновиках.
   */
  private async resolveTarget(input: CreateClientRegistrationInput): Promise<{
    developerOrganizationId?: Types.ObjectId;
    developmentId?: Types.ObjectId;
    developerName: string;
    projectName: string;
  }> {
    // Каталог витрины адресует комплекс slug'ом — идентификатора у карточки
    // нет, поэтому агентство присылает то, что у него есть.
    const developmentId = input.developmentId
      ? new Types.ObjectId(input.developmentId)
      : input.developmentSlug
        ? await this.publication.findPublishedDevelopmentIdBySlug(input.developmentSlug)
        : null;
    if (input.developmentSlug && !developmentId) {
      throw new NotFoundException('Development not found');
    }

    if (developmentId) {
      const development = await this.developments.getPublishedDevelopmentSummary(developmentId);
      const developer = await this.organizations.getOrganizationById(development.organizationId);
      return {
        developerOrganizationId: development.organizationId,
        developmentId: development.id,
        // Имя застройщика — снимок названия его организации; если её
        // почему-то нет, имя ЖК честнее пустой строки.
        developerName: developer?.name?.trim() || development.name,
        projectName: development.name,
      };
    }

    const developerName = input.developerName?.trim();
    const projectName = input.projectName?.trim();
    if (!developerName || !projectName) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Either developmentId or both developerName and projectName are required',
      );
    }
    return { developerName, projectName };
  }

  private async requireOwn(
    registrationId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<ClientRegistrationDocument> {
    const existing = await this.registrations.findForOrganization(registrationId, organizationId);
    if (!existing) throw new NotFoundException('Client registration not found');
    return existing;
  }

  /** Правка не нашла запись: либо её нет, либо версия устарела — это разные ответы. */
  private async explainMissedUpdate(
    registrationId: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<never> {
    await this.requireOwn(registrationId, organizationId);
    throw new AppException(ErrorCode.VERSION_CONFLICT, 'Client registration was changed by someone else');
  }
}
