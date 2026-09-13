import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  MessengerAccountDocument,
  type MessengerPlatform,
  type MessengerAccountType,
  type MessengerAuthStatus,
} from '../schemas/messenger-account.schema';

export interface CreateMessengerAccountParams {
  /**
   * N-12: опциональный предзаданный id. `addTelegramBot` регистрирует
   * webhook URL (со включённым accountId) в Telegram ДО записи документа —
   * id нужен заранее, обычный auto-generated `_id` появился бы только
   * после insert.
   */
  _id?: Types.ObjectId;
  organizationId: Types.ObjectId;
  assignedPositionId?: Types.ObjectId;
  platform: MessengerPlatform;
  accountType?: MessengerAccountType;
  name: string;
  botToken?: string;
  webhookSecret?: string;
  telegramBotUsername?: string;
  phoneNumber?: string;
  /**
   * N-12: верификация у провайдера (Telegram `getMe`) происходит ДО этой
   * записи (сеть — вне транзакции, тот же принцип, что pre-transaction
   * проверки существования в DevelopmentsService) — аккаунт создаётся уже
   * с итоговым статусом, не 'pending' с последующим update. По умолчанию
   * всё ещё 'pending' — WhatsApp (пока без верификации) и любой будущий
   * вызов без явной проверки не должны молча выглядеть подтверждёнными.
   */
  authStatus?: MessengerAuthStatus;
  lastSyncAt?: Date;
}

@Injectable()
export class MessengerAccountRepository {
  constructor(
    @InjectModel(MessengerAccountDocument.name)
    private readonly model: Model<MessengerAccountDocument>,
  ) {}

  async create(params: CreateMessengerAccountParams, session?: ClientSession): Promise<MessengerAccountDocument> {
    // lastSyncAt добавляется в объект, только если реально передан — тест
    // "новый аккаунт... без отметки синхронизации" (messenger-honest-status
    // .spec.ts) проверяет ОТСУТСТВИЕ ключа, не `undefined`-значение: явный
    // `lastSyncAt: undefined` в литерале уже считается "имеющимся" свойством
    // для toHaveProperty.
    const doc: Record<string, unknown> = {
      _id: params._id,
      organizationId: params.organizationId,
      assignedPositionId: params.assignedPositionId,
      platform: params.platform,
      accountType: params.accountType ?? 'bot',
      name: params.name,
      botToken: params.botToken,
      webhookSecret: params.webhookSecret,
      telegramBotUsername: params.telegramBotUsername,
      phoneNumber: params.phoneNumber,
      authStatus: params.authStatus ?? 'pending',
      isActive: true,
    };
    if (params.lastSyncAt) {
      doc.lastSyncAt = params.lastSyncAt;
    }

    const [created] = await this.model.create([doc], { session });
    return created!;
  }

  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<MessengerAccountDocument | null> {
    return this.model.findOne({ _id: id, organizationId }, null, { session }).exec();
  }

  /**
   * N-12, worker-хендлер реальной отправки: система обрабатывает outbox-
   * событие как system actor вне tenant-контекста (тот же принцип, что
   * UnitRepository.findById для worker'а, см. tenant-scope.test.ts) —
   * organizationId для фильтра неоткуда взять, да и не нужен: aggregateId
   * события уже указывает на конкретный, ранее созданный API-процессом
   * документ. `.select('+botToken')` — поле скрыто по умолчанию.
   */
  async findByIdWithToken(id: Types.ObjectId, session?: ClientSession): Promise<MessengerAccountDocument | null> {
    return this.model.findById(id).select('+botToken').session(session ?? null).exec();
  }

  /**
   * N-12, вебхук-контроллер: единственный ключ доступа к аккаунту из
   * запроса Telegram — сам `:accountId` в пути, organizationId в исходном
   * запросе взять неоткуда (внешний, неаутентифицированный вызов). Подлинность
   * подтверждает не фильтр по организации, а сверка `webhookSecret` с
   * заголовком `X-Telegram-Bot-Api-Secret-Token` — тем же принципом, что
   * publicToken у dev-selections/marketplace-selections (энтропия, не
   * organizationId, ограничивает доступ).
   */
  async findByIdWithWebhookSecret(id: Types.ObjectId): Promise<MessengerAccountDocument | null> {
    return this.model.findById(id).select('+webhookSecret').exec();
  }

  async listForOrganization(
    organizationId: Types.ObjectId,
    platform?: MessengerPlatform,
  ): Promise<MessengerAccountDocument[]> {
    const filter: Record<string, unknown> = { organizationId };
    if (platform) filter.platform = platform;
    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  async deleteForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: id, organizationId }, { session }).exec();
    return res.deletedCount > 0;
  }
}
