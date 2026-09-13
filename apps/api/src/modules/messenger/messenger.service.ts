import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { CrmService } from '../crm/crm.service';
import { MediaService } from '../media/media.service';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import {
  MessengerAccountRepository,
  MessengerDialogRepository,
  MessengerMessageRepository,
  decodeDialogListCursor,
  encodeDialogListCursor,
  TelegramBotClient,
  TelegramApiError,
  type MessengerAccountDocument,
  type MessengerPlatform,
  type MessengerDialogDocument,
  type DialogLastMessage,
  type MessengerMessageDocument,
  type MessageType,
  type MessageMedia,
} from '@baza/messenger';
import type { TelegramUpdate } from './telegram-update.types';

export interface MessengerAccountReadModel {
  id: string;
  organizationId: string;
  assignedPositionId: string | null;
  platform: MessengerPlatform;
  accountType: string;
  name: string;
  telegramBotUsername: string | null;
  phoneNumber: string | null;
  authStatus: string;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface MessengerDialogReadModel {
  id: string;
  organizationId: string;
  accountId: string;
  assignedPositionId: string | null;
  platform: MessengerPlatform;
  externalChatId: string;
  name: string;
  clientPhone: string | null;
  clientHandle: string | null;
  clientCity: string | null;
  avatarUrl: string | null;
  unreadCount: number;
  pinned: boolean;
  lastMessage: {
    text: string;
    sentAt: string;
    fromMe: boolean;
    author: 'client' | 'agent';
  } | null;
  leadId: string | null;
  contactId: string | null;
  dealId: string | null;
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessengerDialogListResponse {
  items: MessengerDialogReadModel[];
  nextCursor: string | null;
}

export interface MessengerMessageListResponse {
  items: MessengerMessageReadModel[];
  nextCursor: string | null;
}

export interface MessengerMessageReadModel {
  id: string;
  organizationId: string;
  dialogId: string;
  externalMessageId: string | null;
  author: 'client' | 'agent';
  senderPositionId: string | null;
  text: string;
  messageType: MessageType;
  status: string;
  sentAt: string;
  media: {
    assetId: string | null;
    url: string | null;
    mimeType: string | null;
    fileName: string | null;
  } | null;
}

/**
 * N-12: сравнение `X-Telegram-Bot-Api-Secret-Token` с сохранённым секретом.
 * `timingSafeEqual` требует буферы одинаковой длины — иначе бросает, а не
 * возвращает false, поэтому длины сверяются заранее (несовпадение длины —
 * тоже "неверный секрет", не повод упасть с 500).
 */
function isValidWebhookSecret(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedBuf = Buffer.from(received, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

function toAccountReadModel(doc: MessengerAccountDocument): MessengerAccountReadModel {
  return {
    id: doc._id.toString(),
    organizationId: doc.organizationId.toString(),
    assignedPositionId: doc.assignedPositionId ? doc.assignedPositionId.toString() : null,
    platform: doc.platform,
    accountType: doc.accountType,
    name: doc.name,
    telegramBotUsername: doc.telegramBotUsername ?? null,
    phoneNumber: doc.phoneNumber ?? null,
    authStatus: doc.authStatus,
    isActive: doc.isActive,
    lastSyncAt: doc.lastSyncAt ? doc.lastSyncAt.toISOString() : null,
    createdAt: (doc as unknown as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

function toDialogReadModel(doc: MessengerDialogDocument): MessengerDialogReadModel {
  return {
    id: doc._id.toString(),
    organizationId: doc.organizationId.toString(),
    accountId: doc.accountId.toString(),
    assignedPositionId: doc.assignedPositionId ? doc.assignedPositionId.toString() : null,
    platform: doc.platform,
    externalChatId: doc.externalChatId,
    name: doc.name,
    clientPhone: doc.clientPhone ?? null,
    clientHandle: doc.clientHandle ?? null,
    clientCity: doc.clientCity ?? null,
    avatarUrl: doc.avatarUrl ?? null,
    unreadCount: doc.unreadCount,
    pinned: doc.pinned,
    lastMessage: doc.lastMessage
      ? {
          text: doc.lastMessage.text,
          sentAt: doc.lastMessage.sentAt.toISOString(),
          fromMe: doc.lastMessage.fromMe,
          author: doc.lastMessage.author,
        }
      : null,
    leadId: doc.leadId ? doc.leadId.toString() : null,
    contactId: doc.contactId ? doc.contactId.toString() : null,
    dealId: doc.dealId ? doc.dealId.toString() : null,
    tags: doc.tags ?? [],
    version: doc.version,
    createdAt: (doc as unknown as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

function toMessageReadModel(doc: MessengerMessageDocument): MessengerMessageReadModel {
  return {
    id: doc._id.toString(),
    organizationId: doc.organizationId.toString(),
    dialogId: doc.dialogId.toString(),
    externalMessageId: doc.externalMessageId ?? null,
    author: doc.author,
    senderPositionId: doc.senderPositionId ? doc.senderPositionId.toString() : null,
    text: doc.text,
    messageType: doc.messageType,
    status: doc.status,
    sentAt: doc.sentAt.toISOString(),
    media: doc.media
      ? {
          assetId: doc.media.assetId ? doc.media.assetId.toString() : null,
          url: doc.media.url ?? null,
          mimeType: doc.media.mimeType ?? null,
          fileName: doc.media.fileName ?? null,
        }
      : null,
  };
}

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly accountRepository: MessengerAccountRepository,
    private readonly dialogRepository: MessengerDialogRepository,
    private readonly messageRepository: MessengerMessageRepository,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly crmService: CrmService,
    private readonly mediaService: MediaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly telegramBotClient: TelegramBotClient,
    private readonly configService: ConfigService,
  ) {}

  /** 256 бит энтропии — тот же принцип и то же обоснование, что publicToken у dev-selections. */
  private generateWebhookSecret(): string {
    return randomBytes(32).toString('hex');
  }

  async listAccounts(
    organizationId: Types.ObjectId,
    platform?: MessengerPlatform,
  ): Promise<MessengerAccountReadModel[]> {
    const docs = await this.accountRepository.listForOrganization(organizationId, platform);
    return docs.map(toAccountReadModel);
  }

  /**
   * N-12 (roadmap-2026-09.md): токен проверяется у самого Telegram (`getMe`)
   * ДО сохранения аккаунта — раньше `POST /messenger/accounts/telegram/bot`
   * принимал любую строку 10-120 символов и сразу отвечал успехом, аккаунт
   * навсегда оставался `pending` (messenger-skeleton.md, открытый пункт 1).
   *
   * `getMe`/`setWebhook` — сетевые вызовы, оба выполняются ДО открытия
   * транзакции (тот же принцип, что pre-transaction проверки существования
   * в DevelopmentsService/CommunityService: сеть не должна держать открытой
   * Mongo-транзакцию). `accountId` генерируется заранее (`new Types.
   * ObjectId()`, валидный приём для Mongoose — id не обязан приходить из
   * insert), чтобы webhook URL (со включённым accountId) можно было
   * зарегистрировать в Telegram до самой записи: невалидный токен или сбой
   * setWebhook не должен создавать "недобот" — при ошибке ничего не
   * сохраняется вовсе.
   */
  async addTelegramBot(params: {
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    name: string;
    botToken: string;
    correlationId: string;
    idempotencyKey?: string;
    idempotencyRequestBody?: Record<string, unknown>;
  }): Promise<MessengerAccountReadModel> {
    let verified: { username?: string };
    try {
      verified = await this.telegramBotClient.getMe(params.botToken);
    } catch (error) {
      if (error instanceof TelegramApiError) {
        throw new BadRequestException(`Не удалось подключить бота: ${error.message}`);
      }
      throw error;
    }

    const accountId = new Types.ObjectId();
    const webhookSecret = this.generateWebhookSecret();
    const webhookBaseUrl = this.configService.getOrThrow<string>('TELEGRAM_WEBHOOK_BASE_URL').replace(/\/+$/, '');
    const webhookUrl = `${webhookBaseUrl}/api/v1/public/messenger/telegram/${accountId.toString()}`;

    try {
      await this.telegramBotClient.setWebhook(params.botToken, webhookUrl, webhookSecret);
    } catch (error) {
      if (error instanceof TelegramApiError) {
        throw new BadRequestException(`Токен верный, но не удалось зарегистрировать webhook: ${error.message}`);
      }
      throw error;
    }

    return runInTransaction(this.connection, async (session) => {
      const doc = await this.accountRepository.create(
        {
          _id: accountId,
          organizationId: params.organizationId,
          assignedPositionId: params.assignedPositionId,
          platform: 'telegram',
          accountType: 'bot',
          name: params.name,
          botToken: params.botToken,
          webhookSecret,
          telegramBotUsername: verified.username,
          authStatus: 'authenticated',
          lastSyncAt: new Date(),
        },
        session,
      );

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'messenger_account.create',
          resource: 'messenger_account',
          resourceId: doc._id,
          after: { platform: 'telegram', name: params.name, telegramBotUsername: verified.username },
          correlationId: params.correlationId,
        },
        session,
      );

      const readModel = toAccountReadModel(doc);

      if (params.idempotencyKey && params.idempotencyRequestBody) {
        await this.idempotencyService.record(
          {
            identityId: params.actorIdentityId,
            operation: 'addTelegramBotAccount',
            key: params.idempotencyKey,
            requestBody: params.idempotencyRequestBody,
            responseStatus: 201,
            responseBody: readModel as unknown as Record<string, unknown>,
          },
          session,
        );
      }

      return readModel;
    });
  }

  async addWhatsAppAccount(params: {
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    name: string;
    phoneNumber?: string;
    correlationId: string;
    idempotencyKey?: string;
    idempotencyRequestBody?: Record<string, unknown>;
  }): Promise<MessengerAccountReadModel> {
    return runInTransaction(this.connection, async (session) => {
      const doc = await this.accountRepository.create(
        {
          organizationId: params.organizationId,
          assignedPositionId: params.assignedPositionId,
          platform: 'whatsapp',
          accountType: 'user',
          name: params.name,
          phoneNumber: params.phoneNumber,
        },
        session,
      );

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'messenger_account.create',
          resource: 'messenger_account',
          resourceId: doc._id,
          after: { platform: 'whatsapp', name: params.name },
          correlationId: params.correlationId,
        },
        session,
      );

      const readModel = toAccountReadModel(doc);

      if (params.idempotencyKey && params.idempotencyRequestBody) {
        await this.idempotencyService.record(
          {
            identityId: params.actorIdentityId,
            operation: 'addWhatsAppAccount',
            key: params.idempotencyKey,
            requestBody: params.idempotencyRequestBody,
            responseStatus: 201,
            responseBody: readModel as unknown as Record<string, unknown>,
          },
          session,
        );
      }

      return readModel;
    });
  }

  async deleteAccount(params: {
    organizationId: Types.ObjectId;
    accountId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<boolean> {
    // N-12: botToken нужен ПОСЛЕ транзакции (deleteWebhook — сеть, тот же
    // принцип, что addTelegramBot: сеть не держит открытой Mongo-транзакцию).
    // Читается ДО удаления — после deleteForOrganization токен уже недоступен.
    const withToken =
      (await this.accountRepository.findByIdWithToken(params.accountId)) ?? undefined;
    const shouldDeleteWebhook =
      withToken?.organizationId.equals(params.organizationId) &&
      withToken.platform === 'telegram' &&
      Boolean(withToken.botToken);

    const deleted = await runInTransaction(this.connection, async (session) => {
      const existing = await this.accountRepository.findByIdForOrganization(
        params.accountId,
        params.organizationId,
        session,
      );
      if (!existing) {
        throw new NotFoundException('Учётная запись мессенджера не найдена');
      }

      const deletedInner = await this.accountRepository.deleteForOrganization(
        params.accountId,
        params.organizationId,
        session,
      );

      // Без каскада диалоги/сообщения этого аккаунта оставались бы висеть
      // с указателем на уже несуществующий accountId — тот же класс
      // проблемы, что была у community-сидов до чистки N-02.
      const deletedDialogIds = await this.dialogRepository.deleteByAccountId(
        params.organizationId,
        params.accountId,
        session,
      );
      const deletedMessagesCount = await this.messageRepository.deleteByDialogIds(
        params.organizationId,
        deletedDialogIds,
        session,
      );

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'messenger_account.delete',
          resource: 'messenger_account',
          resourceId: params.accountId,
          before: {
            name: existing.name,
            platform: existing.platform,
            dialogsDeleted: deletedDialogIds.length,
            messagesDeleted: deletedMessagesCount,
          },
          correlationId: params.correlationId,
        },
        session,
      );

      return deletedInner;
    });

    if (deleted && shouldDeleteWebhook && withToken!.botToken) {
      // Best-effort: Telegram продолжит слать апдейты на уже отвязанный
      // URL, пока сам не решит, что webhook недоступен — не блокируем
      // удаление аккаунта, если сеть к Telegram недоступна прямо сейчас.
      try {
        await this.telegramBotClient.deleteWebhook(withToken!.botToken);
      } catch (error) {
        this.logger.warn(`Не удалось отвязать webhook Telegram при удалении аккаунта: ${(error as Error).message}`);
      }
    }

    return deleted;
  }

  async listDialogs(params: {
    organizationId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    accountId?: Types.ObjectId;
    platform?: MessengerPlatform;
    leadId?: Types.ObjectId;
    contactId?: Types.ObjectId;
    dealId?: Types.ObjectId;
    search?: string;
    cursor?: string;
    limit: number;
  }): Promise<MessengerDialogListResponse> {
    const limit = Math.min(params.limit, 100);

    // Берём на одну запись больше лимита — единственный надёжный способ
    // узнать, есть ли следующая страница, не полагаясь на "вернулось меньше
    // limit" (это верно только до тех пор, пока запись не удалили/не
    // перепривязали между страницами).
    const docs = await this.dialogRepository.listForOrganization({
      organizationId: params.organizationId,
      assignedPositionId: params.assignedPositionId,
      accountId: params.accountId,
      platform: params.platform,
      leadId: params.leadId,
      contactId: params.contactId,
      dealId: params.dealId,
      search: params.search,
      cursor: params.cursor ? decodeDialogListCursor(params.cursor) : undefined,
      limit: limit + 1,
    });

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const lastDoc = page[page.length - 1];

    return {
      items: page.map(toDialogReadModel),
      nextCursor: hasMore && lastDoc ? encodeDialogListCursor(lastDoc) : null,
    };
  }

  /**
   * Own-scope сужение для диалога (ADR-002-style non-disclosure: чужой диалог
   * той же организации — тот же `NotFoundException`, что диалог из чужой
   * организации, не отдельный 403, который раскрывал бы сам факт его
   * существования). Диалог без `assignedPositionId` (ещё не взят в работу)
   * own-scope НЕ блокирует — тот же принцип, что у непринятого лида: свободные
   * диалоги открыты любому в организации, пока их не забрал кто-то конкретный.
   *
   * ИСПРАВЛЕНО 11.09.2026: раньше эту проверку делал только getDialog (и
   * то, что вызывает его — listMessages/markDialogRead) — sendTextMessage/
   * sendMediaMessage/linkDialogToCrm/createTaskFromDialog own-scope не
   * проверяли вовсе, хотя каждый из них читает диалог тем же
   * findByIdForOrganization прямо перед мутацией.
   */
  private assertDialogOwnership(dialog: MessengerDialogDocument, assignedPositionId?: Types.ObjectId): void {
    if (assignedPositionId && dialog.assignedPositionId && !dialog.assignedPositionId.equals(assignedPositionId)) {
      throw new NotFoundException('Диалог не найден');
    }
  }

  async getDialog(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
  }): Promise<MessengerDialogReadModel> {
    const doc = await this.dialogRepository.findByIdForOrganization(params.dialogId, params.organizationId);
    if (!doc) {
      throw new NotFoundException('Диалог не найден');
    }
    this.assertDialogOwnership(doc, params.assignedPositionId);
    return toDialogReadModel(doc);
  }

  async listMessages(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    cursor?: Types.ObjectId;
    limit: number;
  }): Promise<MessengerMessageListResponse> {
    await this.getDialog({
      organizationId: params.organizationId,
      dialogId: params.dialogId,
      assignedPositionId: params.assignedPositionId,
    });

    const limit = Math.min(params.limit, 200);

    // Тот же "+1 трюк", что у listDialogs: запрашиваем на одну запись
    // больше лимита — единственный надёжный способ узнать, есть ли
    // следующая страница, не полагаясь на условность "вернулось меньше
    // limit".
    const docs = await this.messageRepository.listForDialog({
      organizationId: params.organizationId,
      dialogId: params.dialogId,
      cursor: params.cursor,
      limit: limit + 1,
    });

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const lastDoc = page[page.length - 1];

    return {
      items: page.map(toMessageReadModel),
      nextCursor: hasMore && lastDoc ? lastDoc._id.toString() : null,
    };
  }

  async sendTextMessage(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    senderPositionId?: Types.ObjectId;
    actorIdentityId?: Types.ObjectId;
    text: string;
    correlationId?: string;
    idempotencyKey?: string;
    idempotencyRequestBody?: Record<string, unknown>;
  }): Promise<MessengerMessageReadModel> {
    return runInTransaction(this.connection, async (session) => {
      const dialog = await this.dialogRepository.findByIdForOrganization(params.dialogId, params.organizationId, session);
      if (!dialog) {
        throw new NotFoundException('Диалог не найден');
      }
      this.assertDialogOwnership(dialog, params.assignedPositionId);

      const now = new Date();
      const message = await this.messageRepository.create(
        {
          organizationId: params.organizationId,
          dialogId: params.dialogId,
          author: 'agent',
          senderPositionId: params.senderPositionId,
          text: params.text,
          messageType: 'text',
          // queued, не sent: транспорта нет, воркер событие только подтверждает.
          status: 'queued',
          sentAt: now,
        },
        session,
      );

      const lastMessage: DialogLastMessage = {
        text: params.text,
        sentAt: now,
        fromMe: true,
        author: 'agent',
      };

      await this.dialogRepository.updateLastMessage(params.dialogId, params.organizationId, lastMessage, false, session);

      await this.outboxService.publish(
        {
          eventType: 'MessengerMessageSent',
          aggregateType: 'messenger_dialog',
          aggregateId: params.dialogId,
          payload: {
            dialogId: params.dialogId.toString(),
            messageId: message._id.toString(),
            accountId: dialog.accountId.toString(),
            platform: dialog.platform,
            externalChatId: dialog.externalChatId,
            text: params.text,
            correlationId: params.correlationId,
          },
          deduplicationKey: `msg:${message._id.toString()}:sent`,
        },
        session,
      );

      const readModel = toMessageReadModel(message);

      if (params.idempotencyKey && params.idempotencyRequestBody && params.actorIdentityId) {
        await this.idempotencyService.record(
          {
            identityId: params.actorIdentityId,
            operation: 'sendMessengerTextMessage',
            key: params.idempotencyKey,
            requestBody: params.idempotencyRequestBody,
            responseStatus: 201,
            responseBody: readModel as unknown as Record<string, unknown>,
          },
          session,
        );
      }

      return readModel;
    });
  }

  async sendMediaMessage(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    senderPositionId?: Types.ObjectId;
    actorIdentityId?: Types.ObjectId;
    text?: string;
    messageType?: MessageType;
    media?: MessageMedia;
    correlationId?: string;
    idempotencyKey?: string;
    idempotencyRequestBody?: Record<string, unknown>;
  }): Promise<MessengerMessageReadModel> {
    return runInTransaction(this.connection, async (session) => {
      const dialog = await this.dialogRepository.findByIdForOrganization(params.dialogId, params.organizationId, session);
      if (!dialog) {
        throw new NotFoundException('Диалог не найден');
      }
      this.assertDialogOwnership(dialog, params.assignedPositionId);

      // Без этой проверки assetId писался в сообщение как есть — можно было
      // приложить к чужому диалогу asset чужой организации, подобрав
      // ObjectId (тот же класс, что был у link-crm leadId/contactId/dealId).
      // Тот же cross-module accessor, что уже использует TeamService для
      // аватара позиции — единственная точка доступа к MediaAsset для
      // внешних модулей (ADR-001/ADR-002). url без assetId (внешняя ссылка,
      // не наш загруженный файл) этой правкой намеренно не проверяется —
      // отдельный, ещё не закрытый вопрос, см. messenger-skeleton.md.
      if (params.media?.assetId) {
        const asset = await this.mediaService.getAssetForOwnerScope(params.media.assetId, {
          type: 'organization',
          organizationId: params.organizationId,
        });
        if (!asset) {
          throw new NotFoundException('Media asset not found');
        }
        if (asset.status !== 'verified') {
          throw new BadRequestException('Media asset is not verified yet');
        }
      }

      const now = new Date();
      const displayText = params.text || (params.media?.fileName ? `[Файл: ${params.media.fileName}]` : '[Вложение]');

      const message = await this.messageRepository.create(
        {
          organizationId: params.organizationId,
          dialogId: params.dialogId,
          author: 'agent',
          senderPositionId: params.senderPositionId,
          text: displayText,
          messageType: params.messageType ?? 'document',
          media: params.media,
          // queued, не sent: транспорта нет, воркер событие только подтверждает.
          status: 'queued',
          sentAt: now,
        },
        session,
      );

      const lastMessage: DialogLastMessage = {
        text: displayText,
        sentAt: now,
        fromMe: true,
        author: 'agent',
      };

      await this.dialogRepository.updateLastMessage(params.dialogId, params.organizationId, lastMessage, false, session);

      await this.outboxService.publish(
        {
          eventType: 'MessengerMessageSent',
          aggregateType: 'messenger_dialog',
          aggregateId: params.dialogId,
          payload: {
            dialogId: params.dialogId.toString(),
            messageId: message._id.toString(),
            accountId: dialog.accountId.toString(),
            platform: dialog.platform,
            externalChatId: dialog.externalChatId,
            text: displayText,
            correlationId: params.correlationId,
          },
          deduplicationKey: `msg:${message._id.toString()}:sent`,
        },
        session,
      );

      const readModel = toMessageReadModel(message);

      if (params.idempotencyKey && params.idempotencyRequestBody && params.actorIdentityId) {
        await this.idempotencyService.record(
          {
            identityId: params.actorIdentityId,
            operation: 'sendMessengerMediaMessage',
            key: params.idempotencyKey,
            requestBody: params.idempotencyRequestBody,
            responseStatus: 201,
            responseBody: readModel as unknown as Record<string, unknown>,
          },
          session,
        );
      }

      return readModel;
    });
  }

  async markDialogRead(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
  }): Promise<boolean> {
    await this.getDialog({
      organizationId: params.organizationId,
      dialogId: params.dialogId,
      assignedPositionId: params.assignedPositionId,
    });

    const updated = await this.dialogRepository.markAsRead(params.dialogId, params.organizationId);
    return Boolean(updated);
  }

  async linkDialogToCrm(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    leadId?: Types.ObjectId;
    contactId?: Types.ObjectId;
    dealId?: Types.ObjectId;
    expectedVersion: number;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<MessengerDialogReadModel> {
    return runInTransaction(this.connection, async (session) => {
      const dialog = await this.dialogRepository.findByIdForOrganization(params.dialogId, params.organizationId, session);
      if (!dialog) {
        throw new NotFoundException('Диалог не найден');
      }
      this.assertDialogOwnership(dialog, params.assignedPositionId);
      if ((dialog.version ?? 0) !== params.expectedVersion) {
        throw new ConflictException('Dialog was modified by another request — refresh and retry');
      }

      // Без этих проверок leadId/contactId/dealId писались в диалог как
      // есть, без подтверждения, что запись вообще существует и
      // принадлежит организации вызывающего (11.09.2026): диалог можно
      // было привязать к CRM-записи чужой организации, подобрав чужой
      // ObjectId. `assignedPositionId` (14.09.2026, закрывает
      // messenger-skeleton.md "Что открыто" п.2) сужает и эту проверку до
      // own-scope конкретной записи: manager с own-scope grant на
      // link_crm не может привязать диалог к лиду/сделке/контакту,
      // назначенным другому менеджеру той же организации — `undefined`
      // для organization/global scope (owner/director/rop) оставляет
      // проверку на уровне всей организации, как раньше.
      if (params.leadId) {
        await this.crmService.getLeadForOrganization(params.leadId, params.organizationId, params.assignedPositionId);
      }
      if (params.contactId) {
        await this.crmService.getContactForOrganization(params.contactId, params.organizationId, params.assignedPositionId);
      }
      if (params.dealId) {
        await this.crmService.getDealForOrganization(params.dealId, params.organizationId, params.assignedPositionId);
      }

      const updated = await this.dialogRepository.linkCrm(
        params.dialogId,
        params.organizationId,
        params.expectedVersion,
        { leadId: params.leadId, contactId: params.contactId, dealId: params.dealId },
        session,
      );
      if (!updated) {
        // CAS-промах: между чтением диалога выше и этим update'ом версия
        // успела измениться (конкурентный вызов) — тот же принцип, что
        // changeStageWithVersionCheck у Lead.
        throw new ConflictException('Dialog was modified by another request — refresh and retry');
      }

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'messenger_dialog.link_crm',
          resource: 'messenger_dialog',
          resourceId: params.dialogId,
          before: { leadId: dialog.leadId?.toString(), contactId: dialog.contactId?.toString(), dealId: dialog.dealId?.toString() },
          after: { leadId: params.leadId?.toString(), contactId: params.contactId?.toString(), dealId: params.dealId?.toString() },
          correlationId: params.correlationId,
        },
        session,
      );

      return toDialogReadModel(updated);
    });
  }

  async createTaskFromDialog(params: {
    organizationId: Types.ObjectId;
    dialogId: Types.ObjectId;
    assignedPositionId?: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    actorPositionId: Types.ObjectId;
    title: string;
    description?: string;
    dueAt?: Date;
    isUrgent?: boolean;
    isImportant?: boolean;
    correlationId: string;
    idempotencyKey: string;
    idempotencyRequestBody: Record<string, unknown>;
  }) {
    const dialog = await this.dialogRepository.findByIdForOrganization(params.dialogId, params.organizationId);
    if (!dialog) {
      throw new NotFoundException('Диалог не найден');
    }
    this.assertDialogOwnership(dialog, params.assignedPositionId);

    const descWithDialog = [
      params.description?.trim(),
      `[Создано из диалога ${dialog.name} (${dialog.platform})]`,
    ].filter(Boolean).join('\n\n');

    return this.crmService.createTask({
      organizationId: params.organizationId,
      actorIdentityId: params.actorIdentityId,
      actorPositionId: params.actorPositionId,
      title: params.title,
      description: descWithDialog,
      dueAt: params.dueAt,
      assignedPositionId: dialog.assignedPositionId ?? params.actorPositionId,
      leadId: dialog.leadId,
      contactId: dialog.contactId,
      isUrgent: params.isUrgent,
      isImportant: params.isImportant,
      taskCategory: 'work',
      correlationId: params.correlationId,
      idempotencyKey: params.idempotencyKey,
      idempotencyRequestBody: params.idempotencyRequestBody,
      // ИСПРАВЛЕНО 11.09.2026: отдельное имя операции от POST /tasks
      // (task.controller.ts передаёт 'createTask') — иначе один и тот же
      // Idempotency-Key на двух разных эндпоинтах даёт ложный 409
      // IDEMPOTENCY_KEY_CONFLICT, см. docstring CrmService.createTask.
      idempotencyOperation: 'createTaskFromDialog',
    });
  }

  /**
   * N-12: вебхук Telegram — «сообщение... возвращается в диалог»
   * (roadmap-2026-09.md). Единственный путь, которым внешний, полностью
   * неаутентифицированный HTTP-вызов достигает этого сервиса —
   * TelegramWebhookController публичный (без TenantGuard/PermissionGuard).
   * Секрет вебхука (`webhookSecret`) — единственная проверка подлинности;
   * при её провале метод молча возвращает управление (не бросает), чтобы
   * не превращать ответ в оракул "аккаунт существует/не существует" или
   * "секрет верный/неверный" для стороннего вызывающего.
   *
   * Обрабатываются только текстовые `message` — другие типы апдейтов
   * (edited_message, callback_query, фото/видео без текста) молча
   * игнорируются: расширение на них — отдельная, ещё не начатая работа.
   *
   * Идемпотентность: Telegram может доставить один апдейт повторно
   * (собственный retry на таймауте/5xx с нашей стороны) — дедуп по
   * (dialogId, externalMessageId) ДО создания сообщения.
   */
  async handleTelegramUpdate(params: {
    accountId: Types.ObjectId;
    secretToken: string | undefined;
    update: TelegramUpdate;
  }): Promise<void> {
    const account = await this.accountRepository.findByIdWithWebhookSecret(params.accountId);
    if (!account || account.platform !== 'telegram' || !account.webhookSecret) {
      this.logger.warn(`Telegram webhook: аккаунт ${params.accountId.toString()} не найден или не настроен`);
      return;
    }

    if (!isValidWebhookSecret(params.secretToken, account.webhookSecret)) {
      this.logger.warn(`Telegram webhook: неверный секрет для аккаунта ${params.accountId.toString()}`);
      return;
    }

    const message = params.update.message;
    if (!message || !message.text) {
      // Не текст (фото/стикер/служебный апдейт) — вне текущего объёма N-12.
      return;
    }
    // Присваивание в отдельный const: TS не сохраняет сужение `message.text`
    // из проверки выше внутри замыкания runInTransaction ниже.
    const text = message.text;

    const externalChatId = message.chat.id.toString();
    const externalMessageId = message.message_id.toString();
    const clientName =
      [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ').trim() || 'Telegram';
    const clientHandle = message.from?.username ? `@${message.from.username}` : undefined;

    await runInTransaction(this.connection, async (session) => {
      let dialog = await this.dialogRepository.findByExternalChatId(
        account.organizationId,
        params.accountId,
        externalChatId,
        session,
      );

      if (!dialog) {
        dialog = await this.dialogRepository.create(
          {
            organizationId: account.organizationId,
            accountId: params.accountId,
            assignedPositionId: account.assignedPositionId,
            platform: 'telegram',
            externalChatId,
            name: clientName,
            clientHandle,
          },
          session,
        );
      }

      const existingMessage = await this.messageRepository.findByExternalMessageId(
        dialog._id,
        externalMessageId,
        session,
      );
      if (existingMessage) {
        // Уже записан при предыдущей доставке того же апдейта — не дублируем.
        return;
      }

      const sentAt = new Date(message.date * 1000);
      await this.messageRepository.create(
        {
          organizationId: account.organizationId,
          dialogId: dialog._id,
          externalMessageId,
          author: 'client',
          text,
          sentAt,
        },
        session,
      );

      const lastMessage: DialogLastMessage = {
        text,
        sentAt,
        fromMe: false,
        author: 'client',
      };
      await this.dialogRepository.updateLastMessage(dialog._id, account.organizationId, lastMessage, true, session);
    });
  }
}
