import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import {
  MessengerDialogDocument,
  type DialogLastMessage,
} from '../schemas/messenger-dialog.schema';
import type { MessengerPlatform } from '../schemas/messenger-account.schema';

/**
 * Сортировка списка диалогов — `{pinned: -1, 'lastMessage.sentAt': -1, _id: -1}`
 * (закреплённые сверху, дальше по свежести последнего сообщения) — НЕ
 * совпадает с полем, по которому раньше строился курсор (`_id`). Диалог
 * поднимается в списке при новом сообщении независимо от даты создания, так
 * что порядок по `_id` и порядок по `lastMessage.sentAt` расходятся
 * регулярно, не в редких случаях. Курсор по одному `_id` из-за этого либо
 * терял диалоги (те, что "moved to the next tier" имеют больший `_id`, чем
 * граница страницы), либо дублировал их (11.09.2026).
 *
 * `DialogListCursor` — составной seek-курсор из всех трёх ключей сортировки,
 * `kind: 'legacy'` — обратная совместимость с уже описанным в OpenAPI
 * "для newest принимается legacy ObjectId": голый `_id`, старое (неточное,
 * но не более неточное, чем было) поведение — только для случая, когда
 * клиент прислал именно ObjectId, а не наш непрозрачный курсор.
 */
export type DialogListCursor =
  | { kind: 'seek'; pinned: boolean; lastMessageSentAt: Date | null; id: Types.ObjectId }
  | { kind: 'legacy'; id: Types.ObjectId };

interface DialogSeekCursorPayload {
  pinned: boolean;
  lastMessageSentAt: string | null;
  id: string;
}

function isDialogSeekCursorPayload(value: unknown): value is DialogSeekCursorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.pinned === 'boolean' &&
    (candidate.lastMessageSentAt === null || typeof candidate.lastMessageSentAt === 'string') &&
    typeof candidate.id === 'string' &&
    Types.ObjectId.isValid(candidate.id)
  );
}

export function encodeDialogListCursor(doc: Pick<MessengerDialogDocument, '_id' | 'pinned' | 'lastMessage'>): string {
  const payload: DialogSeekCursorPayload = {
    pinned: doc.pinned,
    lastMessageSentAt: doc.lastMessage ? doc.lastMessage.sentAt.toISOString() : null,
    id: doc._id.toString(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeDialogListCursor(raw: string): DialogListCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (isDialogSeekCursorPayload(parsed)) {
      return {
        kind: 'seek',
        pinned: parsed.pinned,
        lastMessageSentAt: parsed.lastMessageSentAt ? new Date(parsed.lastMessageSentAt) : null,
        id: new Types.ObjectId(parsed.id),
      };
    }
  } catch {
    // не наш base64/JSON — пробуем legacy-формат ниже, иначе 400
  }
  if (Types.ObjectId.isValid(raw)) {
    return { kind: 'legacy', id: new Types.ObjectId(raw) };
  }
  throw new BadRequestException('Некорректный cursor');
}

/**
 * Стандартная seek-пагинация для ORDER BY (pinned DESC, lastMessage.sentAt
 * DESC, _id DESC): "следующий после курсора" = OR из трёх непересекающихся
 * веток (упасть на тир ниже по pinned; тот же pinned, тир ниже по дате; та
 * же пара pinned+дата, _id меньше).
 *
 * `{$lt: null}` в MongoDB не находит документы с отсутствующим полем (это
 * особенность операторов сравнения, не сортировки) — поэтому "меньше
 * cursor-даты, включая отсутствие lastMessage" собрано через
 * `$not: {$gte: cursorDate}}`, а не `$lt`.
 */
function buildDialogSeekCursorClauses(
  cursor: Extract<DialogListCursor, { kind: 'seek' }>,
): FilterQuery<MessengerDialogDocument>[] {
  const clauses: FilterQuery<MessengerDialogDocument>[] = [{ pinned: { $lt: cursor.pinned } }];

  if (cursor.lastMessageSentAt !== null) {
    clauses.push({
      pinned: cursor.pinned,
      'lastMessage.sentAt': { $not: { $gte: cursor.lastMessageSentAt } },
    });
    clauses.push({
      pinned: cursor.pinned,
      'lastMessage.sentAt': cursor.lastMessageSentAt,
      _id: { $lt: cursor.id },
    });
  } else {
    clauses.push({
      pinned: cursor.pinned,
      lastMessage: { $exists: false },
      _id: { $lt: cursor.id },
    });
  }

  return clauses;
}

export interface CreateMessengerDialogParams {
  organizationId: Types.ObjectId;
  accountId: Types.ObjectId;
  assignedPositionId?: Types.ObjectId;
  platform: MessengerPlatform;
  externalChatId: string;
  name: string;
  clientPhone?: string;
  clientHandle?: string;
  clientCity?: string;
  avatarUrl?: string;
  leadId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  dealId?: Types.ObjectId;
  tags?: string[];
}

export interface ListDialogsFilter {
  organizationId: Types.ObjectId;
  assignedPositionId?: Types.ObjectId;
  accountId?: Types.ObjectId;
  platform?: MessengerPlatform;
  leadId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  dealId?: Types.ObjectId;
  search?: string;
  cursor?: DialogListCursor;
  limit: number;
}

@Injectable()
export class MessengerDialogRepository {
  constructor(
    @InjectModel(MessengerDialogDocument.name)
    private readonly model: Model<MessengerDialogDocument>,
  ) {}

  async create(params: CreateMessengerDialogParams, session?: ClientSession): Promise<MessengerDialogDocument> {
    const [doc] = await this.model.create(
      [
        {
          ...params,
          unreadCount: 0,
          pinned: false,
          tags: params.tags ?? [],
          version: 0,
        },
      ],
      { session },
    );
    return doc!;
  }

  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<MessengerDialogDocument | null> {
    return this.model.findOne({ _id: id, organizationId }, null, { session }).exec();
  }

  async findByExternalChatId(
    organizationId: Types.ObjectId,
    accountId: Types.ObjectId,
    externalChatId: string,
    session?: ClientSession,
  ): Promise<MessengerDialogDocument | null> {
    return this.model.findOne({ organizationId, accountId, externalChatId }, null, { session }).exec();
  }

  async listForOrganization(filter: ListDialogsFilter): Promise<MessengerDialogDocument[]> {
    const query: FilterQuery<MessengerDialogDocument> = {
      organizationId: filter.organizationId,
    };

    if (filter.assignedPositionId) query.assignedPositionId = filter.assignedPositionId;
    if (filter.accountId) query.accountId = filter.accountId;
    if (filter.platform) query.platform = filter.platform;
    if (filter.leadId) query.leadId = filter.leadId;
    if (filter.contactId) query.contactId = filter.contactId;
    if (filter.dealId) query.dealId = filter.dealId;

    // search и cursor используют $or независимо друг от друга — оба сразу
    // в query.$or перезаписали бы друг друга, поэтому каждый идёт своей
    // веткой внутри $and.
    const andClauses: FilterQuery<MessengerDialogDocument>[] = [];

    if (filter.search) {
      const sanitized = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(sanitized, 'i');
      andClauses.push({ $or: [{ name: reg }, { clientPhone: reg }, { clientHandle: reg }] });
    }

    if (filter.cursor) {
      if (filter.cursor.kind === 'legacy') {
        query._id = { $lt: filter.cursor.id };
      } else {
        andClauses.push({ $or: buildDialogSeekCursorClauses(filter.cursor) });
      }
    }

    if (andClauses.length > 0) {
      query.$and = andClauses;
    }

    return this.model
      .find(query)
      .sort({ pinned: -1, 'lastMessage.sentAt': -1, _id: -1 })
      .limit(filter.limit)
      .exec();
  }

  async updateLastMessage(
    dialogId: Types.ObjectId,
    organizationId: Types.ObjectId,
    lastMessage: DialogLastMessage,
    incrementUnread: boolean,
    session?: ClientSession,
  ): Promise<MessengerDialogDocument | null> {
    const update: Record<string, unknown> = {
      $set: { lastMessage },
      $inc: { version: 1 },
    };
    if (incrementUnread) {
      update.$inc = { ...(update.$inc as object), unreadCount: 1 };
    }

    return this.model.findOneAndUpdate(
      { _id: dialogId, organizationId },
      update,
      { new: true, session },
    ).exec();
  }

  async markAsRead(
    dialogId: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<MessengerDialogDocument | null> {
    return this.model.findOneAndUpdate(
      { _id: dialogId, organizationId },
      { $set: { unreadCount: 0 }, $inc: { version: 1 } },
      { new: true, session },
    ).exec();
  }

  async linkCrm(
    dialogId: Types.ObjectId,
    organizationId: Types.ObjectId,
    links: { leadId?: Types.ObjectId; contactId?: Types.ObjectId; dealId?: Types.ObjectId },
    session?: ClientSession,
  ): Promise<MessengerDialogDocument | null> {
    const setFields: Record<string, unknown> = {};
    if (links.leadId !== undefined) setFields.leadId = links.leadId;
    if (links.contactId !== undefined) setFields.contactId = links.contactId;
    if (links.dealId !== undefined) setFields.dealId = links.dealId;

    return this.model.findOneAndUpdate(
      { _id: dialogId, organizationId },
      { $set: setFields, $inc: { version: 1 } },
      { new: true, session },
    ).exec();
  }

  async deleteForOrganization(
    dialogId: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: dialogId, organizationId }, { session }).exec();
    return res.deletedCount > 0;
  }

  /**
   * ИСПРАВЛЕНО 11.09.2026: MessengerService.deleteAccount удалял только сам
   * аккаунт — диалоги с уже несуществующим accountId оставались висеть
   * (тот же класс проблемы, что чистка N-02 в community: осиротевшие
   * данные после удаления родителя). Возвращает id удалённых диалогов —
   * вызывающий код каскадом чистит их сообщения (MessengerMessageRepository.
   * deleteByDialogIds).
   */
  async deleteByAccountId(
    organizationId: Types.ObjectId,
    accountId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const dialogs = await this.model.find({ organizationId, accountId }, { _id: 1 }, { session }).lean();
    const dialogIds = dialogs.map((d) => d._id);
    if (dialogIds.length > 0) {
      await this.model.deleteMany({ organizationId, accountId }, { session }).exec();
    }
    return dialogIds;
  }
}
