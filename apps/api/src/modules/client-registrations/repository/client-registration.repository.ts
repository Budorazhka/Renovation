import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ClientRegistrationDocument,
  type ClientRegistrationStatus,
} from '../schemas/client-registration.schema';

export interface CreateClientRegistrationParams {
  organizationId: Types.ObjectId;
  developerOrganizationId?: Types.ObjectId;
  developmentId?: Types.ObjectId;
  developerName: string;
  projectName: string;
  unitLabel?: string;
  clientName: string;
  clientPhone: string;
  clientPhoneNormalized: string;
  leadId?: Types.ObjectId;
  agentPositionId: Types.ObjectId;
  notes?: string;
}

/** Правка заявки агентством: только то, что не меняет её смысл для застройщика. */
export interface ClientRegistrationEdit {
  unitLabel?: string;
  notes?: string;
}

/** Решение по заявке — подтверждение, отказ, завершение или снятие. */
export interface ClientRegistrationDecision {
  status: ClientRegistrationStatus;
  reservedUntil?: Date;
  decidedAt: Date;
  decidedByPositionId: Types.ObjectId;
  decisionNote?: string;
}

const OPTIONAL_CREATE_FIELDS = [
  'developerOrganizationId',
  'developmentId',
  'unitLabel',
  'leadId',
  'notes',
] as const;

/** Статусы, при которых клиент считается занятым: заявка ждёт ответа или закрепление действует. */
const BLOCKING_STATUSES: readonly ClientRegistrationStatus[] = ['pending', 'active'] as const;

/**
 * Фиксация клиентов у застройщиков.
 *
 * ADR-002: у реестра агентства `organizationId` — часть фильтра. У входящих
 * застройщика фильтр идёт по `developerOrganizationId`: запись принадлежит
 * агентству, а читает её вторая сторона сделки, и её собственный
 * `organizationId` в записи не встречается вообще. Это зарегистрировано в
 * исключениях tenant-scope.test.ts — область видимости здесь не шире, а
 * другая: застройщик видит ровно заявки, адресованные ему.
 */
@Injectable()
export class ClientRegistrationRepository {
  constructor(
    @InjectModel(ClientRegistrationDocument.name)
    private readonly model: Model<ClientRegistrationDocument>,
  ) {}

  async create(
    params: CreateClientRegistrationParams,
    session?: ClientSession,
  ): Promise<ClientRegistrationDocument> {
    const docData: Record<string, unknown> = {
      organizationId: params.organizationId,
      developerName: params.developerName,
      projectName: params.projectName,
      clientName: params.clientName,
      clientPhone: params.clientPhone,
      clientPhoneNormalized: params.clientPhoneNormalized,
      agentPositionId: params.agentPositionId,
      status: 'pending',
      version: 0,
    };
    for (const field of OPTIONAL_CREATE_FIELDS) {
      if (params[field] !== undefined) docData[field] = params[field];
    }

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  /** Реестр агентства: свои заявки, свежие первыми. */
  async listForOrganization(
    organizationId: Types.ObjectId,
    filter: { status?: ClientRegistrationStatus; limit: number },
  ): Promise<ClientRegistrationDocument[]> {
    const query: Record<string, unknown> = { organizationId };
    if (filter.status) query.status = filter.status;
    return this.model.find(query).sort({ _id: -1 }).limit(filter.limit).exec();
  }

  /** Входящие застройщика: заявки, адресованные его ЖК. */
  async listForDeveloper(
    developerOrganizationId: Types.ObjectId,
    filter: { status?: ClientRegistrationStatus; limit: number },
  ): Promise<ClientRegistrationDocument[]> {
    const query: Record<string, unknown> = { developerOrganizationId };
    if (filter.status) query.status = filter.status;
    return this.model.find(query).sort({ _id: -1 }).limit(filter.limit).exec();
  }

  async findForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<ClientRegistrationDocument | null> {
    return this.model.findOne({ _id: id, organizationId }).exec();
  }

  async findForDeveloper(
    id: Types.ObjectId,
    developerOrganizationId: Types.ObjectId,
  ): Promise<ClientRegistrationDocument | null> {
    return this.model.findOne({ _id: id, developerOrganizationId }).exec();
  }

  /**
   * Действующая заявка того же клиента в том же ЖК — любой организации.
   * Фильтра по organizationId здесь нет намеренно: смысл фиксации в том и
   * состоит, чтобы второе агентство увидело, что клиент уже закреплён.
   * Наружу отдаётся только срок, без названия агентства.
   */
  async findBlocking(
    developmentId: Types.ObjectId,
    clientPhoneNormalized: string,
    now: Date,
  ): Promise<ClientRegistrationDocument | null> {
    const blockingFilter = {
      developmentId,
      clientPhoneNormalized,
      $or: [{ status: 'pending' }, { status: 'active', reservedUntil: { $gt: now } }],
    };
    return this.model.findOne(blockingFilter).exec();
  }

  /** CAS-правка заявки агентством; null — заявка не найдена или версия устарела. */
  async editForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    edit: ClientRegistrationEdit,
    session?: ClientSession,
  ): Promise<ClientRegistrationDocument | null> {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    for (const field of ['unitLabel', 'notes'] as const) {
      if (edit[field] !== undefined) $set[field] = edit[field];
      else $unset[field] = '';
    }
    return this.model
      .findOneAndUpdate(
        { _id: id, organizationId, version: expectedVersion },
        { $set, $unset, $inc: { version: 1 } },
        { new: true, session },
      )
      .exec();
  }

  /**
   * CAS-решение по заявке. `ownerFilter` задаёт, чья это сторона: агентство
   * фильтруется по `organizationId`, застройщик — по
   * `developerOrganizationId`. `fromStatuses` не даёт подтвердить уже
   * отклонённую или завершённую заявку.
   */
  async decide(
    id: Types.ObjectId,
    ownerFilter: { organizationId: Types.ObjectId } | { developerOrganizationId: Types.ObjectId },
    expectedVersion: number,
    fromStatuses: readonly ClientRegistrationStatus[],
    decision: ClientRegistrationDecision,
    session?: ClientSession,
  ): Promise<ClientRegistrationDocument | null> {
    const $set: Record<string, unknown> = {
      status: decision.status,
      decidedAt: decision.decidedAt,
      decidedByPositionId: decision.decidedByPositionId,
    };
    const $unset: Record<string, ''> = {};
    if (decision.reservedUntil !== undefined) $set.reservedUntil = decision.reservedUntil;
    if (decision.decisionNote !== undefined) $set.decisionNote = decision.decisionNote;
    else $unset.decisionNote = '';

    const decideFilter = { _id: id, ...ownerFilter, version: expectedVersion, status: { $in: [...fromStatuses] } };
    return this.model.findOneAndUpdate(decideFilter, { $set, $unset, $inc: { version: 1 } }, { new: true, session }).exec();
  }

  /** Статусы, при которых клиент считается занятым. Экспортируется для сервиса. */
  static blockingStatuses(): readonly ClientRegistrationStatus[] {
    return BLOCKING_STATUSES;
  }
}
