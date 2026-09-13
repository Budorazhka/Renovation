import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  MessengerMessageDocument,
  type MessageAuthor,
  type MessageType,
  type MessageStatus,
  type MessageMedia,
} from '../schemas/messenger-message.schema';

export interface CreateMessengerMessageParams {
  organizationId: Types.ObjectId;
  dialogId: Types.ObjectId;
  externalMessageId?: string;
  author: MessageAuthor;
  senderPositionId?: Types.ObjectId;
  text: string;
  messageType?: MessageType;
  status?: MessageStatus;
  sentAt?: Date;
  media?: MessageMedia;
}

export interface ListMessagesFilter {
  organizationId: Types.ObjectId;
  dialogId: Types.ObjectId;
  cursor?: Types.ObjectId;
  limit: number;
}

@Injectable()
export class MessengerMessageRepository {
  constructor(
    @InjectModel(MessengerMessageDocument.name)
    private readonly model: Model<MessengerMessageDocument>,
  ) {}

  async create(params: CreateMessengerMessageParams, session?: ClientSession): Promise<MessengerMessageDocument> {
    const [doc] = await this.model.create(
      [
        {
          ...params,
          messageType: params.messageType ?? 'text',
          // Исходящее без явного статуса — queued: отправлять его пока некому.
          status: params.status ?? (params.author === 'agent' ? 'queued' : 'delivered'),
          sentAt: params.sentAt ?? new Date(),
        },
      ],
      { session },
    );
    return doc!;
  }

  /**
   * N-12, worker-хендлер: system actor, без organizationId-фильтра (тот же
   * принцип, что MessengerAccountRepository.findByIdWithToken) — читается
   * ПЕРЕД реальной отправкой ровно для того, чтобы проверить, не отправлено
   * ли сообщение уже (см. EventHandler docstring: at-least-once доставка
   * outbox обязывает каждый handler быть безопасным к повторному вызову).
   */
  async findById(id: Types.ObjectId, session?: ClientSession): Promise<MessengerMessageDocument | null> {
    return this.model.findById(id).session(session ?? null).exec();
  }

  /**
   * N-12, входящий вебхук: Telegram может доставить один и тот же апдейт
   * повторно (собственная retry-логика провайдера при неответе/таймауте) —
   * дедуп по (dialogId, externalMessageId) ДО создания, а не полагание на
   * уникальный индекс (composite unique на этой паре не заведён — сообщения
   * без externalMessageId, исходящие 'queued', valid и не должны падать на
   * дубле null).
   */
  async findByExternalMessageId(
    dialogId: Types.ObjectId,
    externalMessageId: string,
    session?: ClientSession,
  ): Promise<MessengerMessageDocument | null> {
    return this.model.findOne({ dialogId, externalMessageId }).session(session ?? null).exec();
  }

  async listForDialog(filter: ListMessagesFilter): Promise<MessengerMessageDocument[]> {
    const query: Record<string, unknown> = {
      organizationId: filter.organizationId,
      dialogId: filter.dialogId,
    };

    if (filter.cursor) {
      query._id = { $lt: filter.cursor };
    }

    return this.model
      .find(query)
      .sort({ sentAt: -1, _id: -1 })
      .limit(filter.limit)
      .exec();
  }

  /**
   * N-12: `queued` -> `sent` после подтверждения Telegram Bot API.
   * Условие `status: 'queued'` в фильтре — атомарный CAS: конкурентный
   * повторный вызов (at-least-once outbox delivery) на уже помеченном
   * сообщении просто ничего не находит, а не перезаписывает
   * `externalMessageId` вторым (тем же) значением поверх первого.
   */
  async markSent(
    id: Types.ObjectId,
    externalMessageId: string,
    session?: ClientSession,
  ): Promise<MessengerMessageDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'queued' },
        { $set: { status: 'sent', externalMessageId } },
        { new: true, session },
      )
      .exec();
  }

  /** N-12: постоянная ошибка отправки — терминальный статус, не вечный `queued`. */
  async markFailed(id: Types.ObjectId, session?: ClientSession): Promise<MessengerMessageDocument | null> {
    return this.model
      .findOneAndUpdate({ _id: id, status: 'queued' }, { $set: { status: 'failed' } }, { new: true, session })
      .exec();
  }

  async markDeliveredOrRead(
    dialogId: Types.ObjectId,
    organizationId: Types.ObjectId,
    status: 'delivered' | 'read',
    session?: ClientSession,
  ): Promise<number> {
    const res = await this.model.updateMany(
      {
        dialogId,
        organizationId,
        author: 'client',
        status: { $ne: 'read' },
      },
      { $set: { status } },
      { session },
    ).exec();
    return res.modifiedCount;
  }

  /**
   * ИСПРАВЛЕНО 11.09.2026: каскад из MessengerService.deleteAccount — см.
   * MessengerDialogRepository.deleteByAccountId. dialogIds может быть
   * пустым (аккаунт без единого диалога) — тогда deleteMany с пустым $in
   * просто ничего не находит, отдельная проверка не нужна.
   */
  async deleteByDialogIds(
    organizationId: Types.ObjectId,
    dialogIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<number> {
    const res = await this.model.deleteMany({ organizationId, dialogId: { $in: dialogIds } }, { session }).exec();
    return res.deletedCount;
  }
}
