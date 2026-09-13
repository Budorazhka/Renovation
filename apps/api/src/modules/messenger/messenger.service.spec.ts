import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { MessengerService } from './messenger.service';
import {
  MessengerAccountRepository,
  MessengerDialogRepository,
  MessengerMessageRepository,
  TelegramBotClient,
  TelegramApiError,
} from '@baza/messenger';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { CrmService } from '../crm/crm.service';
import { MediaService } from '../media/media.service';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';

describe('MessengerService', () => {
  let service: MessengerService;
  let accountRepo: jest.Mocked<Partial<MessengerAccountRepository>>;
  let dialogRepo: jest.Mocked<Partial<MessengerDialogRepository>>;
  let messageRepo: jest.Mocked<Partial<MessengerMessageRepository>>;
  let auditService: jest.Mocked<Partial<AuditService>>;
  let outboxService: jest.Mocked<Partial<OutboxService>>;
  let crmService: jest.Mocked<Partial<CrmService>>;
  let mediaService: jest.Mocked<Partial<MediaService>>;
  let idempotencyService: jest.Mocked<Partial<IdempotencyService>>;
  let telegramBotClient: jest.Mocked<Partial<TelegramBotClient>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  const fakeSession = {
    withTransaction: jest.fn().mockImplementation((cb) => cb(fakeSession as never)),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const fakeConnection = {
    startSession: jest.fn().mockResolvedValue(fakeSession),
  };

  beforeEach(async () => {
    accountRepo = {
      create: jest.fn(),
      listForOrganization: jest.fn(),
      findByIdForOrganization: jest.fn(),
      findByIdWithToken: jest.fn().mockResolvedValue(null),
      findByIdWithWebhookSecret: jest.fn(),
      deleteForOrganization: jest.fn(),
    };

    dialogRepo = {
      create: jest.fn(),
      listForOrganization: jest.fn(),
      findByIdForOrganization: jest.fn(),
      findByExternalChatId: jest.fn(),
      updateLastMessage: jest.fn(),
      markAsRead: jest.fn(),
      linkCrm: jest.fn(),
      deleteForOrganization: jest.fn(),
      deleteByAccountId: jest.fn().mockResolvedValue([]),
    };

    messageRepo = {
      create: jest.fn(),
      findByExternalMessageId: jest.fn(),
      listForDialog: jest.fn(),
      markDeliveredOrRead: jest.fn(),
      deleteByDialogIds: jest.fn().mockResolvedValue(0),
    };

    auditService = {
      append: jest.fn().mockResolvedValue(undefined),
    };

    outboxService = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    crmService = {
      createTask: jest.fn().mockResolvedValue({ id: 'task-123' } as never),
    };

    mediaService = {
      getAssetForOwnerScope: jest.fn(),
    };

    idempotencyService = {
      record: jest.fn().mockResolvedValue(undefined),
      checkReplay: jest.fn().mockResolvedValue(null),
    };

    telegramBotClient = {
      getMe: jest.fn().mockResolvedValue({ id: 1, isBot: true, username: 'sales_bot', firstName: 'Sales' }),
      setWebhook: jest.fn().mockResolvedValue(undefined),
      deleteWebhook: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn(),
    };

    configService = {
      getOrThrow: jest.fn().mockReturnValue('https://api.baza.sale'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessengerService,
        { provide: getConnectionToken(), useValue: fakeConnection },
        { provide: MessengerAccountRepository, useValue: accountRepo },
        { provide: MessengerDialogRepository, useValue: dialogRepo },
        { provide: MessengerMessageRepository, useValue: messageRepo },
        { provide: AuditService, useValue: auditService },
        { provide: OutboxService, useValue: outboxService },
        { provide: CrmService, useValue: crmService },
        { provide: MediaService, useValue: mediaService },
        { provide: IdempotencyService, useValue: idempotencyService },
        { provide: TelegramBotClient, useValue: telegramBotClient },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MessengerService>(MessengerService);
  });

  it('adds telegram bot account with audit trail', async () => {
    const orgId = new Types.ObjectId();
    const fakeDoc = {
      _id: new Types.ObjectId(),
      organizationId: orgId,
      platform: 'telegram',
      accountType: 'bot',
      name: 'Sales Bot',
      authStatus: 'pending',
      isActive: true,
      createdAt: new Date(),
    };
    (accountRepo.create as jest.Mock).mockResolvedValue(fakeDoc);

    const result = await service.addTelegramBot({
      organizationId: orgId,
      actorIdentityId: new Types.ObjectId(),
      name: 'Sales Bot',
      botToken: '12345:token',
      correlationId: 'cor-1',
    });

    expect(result.name).toBe('Sales Bot');
    expect(result.platform).toBe('telegram');
    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'messenger_account.create',
        resource: 'messenger_account',
      }),
      fakeSession,
    );
  });

  describe('deleteAccount: каскад на диалоги и сообщения', () => {
    // ИСПРАВЛЕНО 11.09.2026: раньше удалялся только сам аккаунт — диалоги и
    // сообщения оставались висеть с указателем на уже несуществующий
    // accountId (тот же класс проблемы, что была у community-сидов до
    // чистки N-02).
    it('аккаунт без диалогов — каскад не находит ничего, но всё равно вызывается', async () => {
      const orgId = new Types.ObjectId();
      const accountId = new Types.ObjectId();
      (accountRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        name: 'Sales Bot',
        platform: 'telegram',
      });
      (accountRepo.deleteForOrganization as jest.Mock).mockResolvedValue(true);

      const result = await service.deleteAccount({
        organizationId: orgId,
        accountId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'cor-del-1',
      });

      expect(result).toBe(true);
      expect(dialogRepo.deleteByAccountId).toHaveBeenCalledWith(orgId, accountId, fakeSession);
      expect(messageRepo.deleteByDialogIds).toHaveBeenCalledWith(orgId, [], fakeSession);
    });

    it('аккаунт с диалогами — сообщения удаляются по id удалённых диалогов, счётчики попадают в аудит', async () => {
      const orgId = new Types.ObjectId();
      const accountId = new Types.ObjectId();
      const dialogIdA = new Types.ObjectId();
      const dialogIdB = new Types.ObjectId();
      (accountRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        name: 'Sales Bot',
        platform: 'telegram',
      });
      (accountRepo.deleteForOrganization as jest.Mock).mockResolvedValue(true);
      (dialogRepo.deleteByAccountId as jest.Mock).mockResolvedValue([dialogIdA, dialogIdB]);
      (messageRepo.deleteByDialogIds as jest.Mock).mockResolvedValue(7);

      await service.deleteAccount({
        organizationId: orgId,
        accountId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'cor-del-2',
      });

      expect(messageRepo.deleteByDialogIds).toHaveBeenCalledWith(orgId, [dialogIdA, dialogIdB], fakeSession);
      expect(auditService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'messenger_account.delete',
          before: expect.objectContaining({ dialogsDeleted: 2, messagesDeleted: 7 }),
        }),
        fakeSession,
      );
    });

    it('аккаунт не найден — NotFoundException, каскад не запускается', async () => {
      (accountRepo.findByIdForOrganization as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteAccount({
          organizationId: new Types.ObjectId(),
          accountId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'cor-del-3',
        }),
      ).rejects.toThrow('Учётная запись мессенджера не найдена');
      expect(dialogRepo.deleteByAccountId).not.toHaveBeenCalled();
      expect(messageRepo.deleteByDialogIds).not.toHaveBeenCalled();
    });
  });

  describe('listMessages: {items, nextCursor} вместо голого массива', () => {
    // ИСПРАВЛЕНО 11.09.2026: контракт по OpenAPI — MessengerMessageListResponse
    // {items, nextCursor}, тот же "+1 трюк", что у listDialogs.
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();

    function fakeMessage() {
      return {
        _id: new Types.ObjectId(),
        organizationId: orgId,
        dialogId,
        author: 'agent',
        text: 'привет',
        messageType: 'text',
        status: 'queued',
        sentAt: new Date(),
      };
    }

    beforeEach(() => {
      (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
        _id: dialogId,
        organizationId: orgId,
        accountId: new Types.ObjectId(),
        platform: 'telegram',
        externalChatId: 'chat-1',
        name: 'Клиент',
        unreadCount: 0,
        pinned: false,
        version: 0,
      });
    });

    it('репозиторий вернул limit+1 — страница обрезается до limit, nextCursor не пуст', async () => {
      const docs = [fakeMessage(), fakeMessage(), fakeMessage()];
      (messageRepo.listForDialog as jest.Mock).mockResolvedValue(docs);

      const res = await service.listMessages({ organizationId: orgId, dialogId, limit: 2 });

      expect(messageRepo.listForDialog).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
      expect(res.items).toHaveLength(2);
      expect(res.items.map((m) => m.id)).toEqual([docs[0]!._id.toString(), docs[1]!._id.toString()]);
      expect(res.nextCursor).toBe(docs[1]!._id.toString());
    });

    it('репозиторий вернул меньше limit+1 — страница вся целиком, nextCursor null', async () => {
      const docs = [fakeMessage()];
      (messageRepo.listForDialog as jest.Mock).mockResolvedValue(docs);

      const res = await service.listMessages({ organizationId: orgId, dialogId, limit: 50 });

      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBeNull();
    });
  });

  it('sends text message and updates dialog lastMessage', async () => {
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();
    const fakeDialog = {
      _id: dialogId,
      organizationId: orgId,
      accountId: new Types.ObjectId(),
      platform: 'telegram',
      externalChatId: 'chat-99',
    };
    (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue(fakeDialog);

    const fakeMessage = {
      _id: new Types.ObjectId(),
      organizationId: orgId,
      dialogId,
      author: 'agent',
      text: 'Добрый день!',
      messageType: 'text',
      status: 'queued',
      sentAt: new Date(),
    };
    (messageRepo.create as jest.Mock).mockResolvedValue(fakeMessage);

    const res = await service.sendTextMessage({
      organizationId: orgId,
      dialogId,
      text: 'Добрый день!',
    });

    expect(res.text).toBe('Добрый день!');
    // Транспорта нет — «отправлено» платформа сказать не может.
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued' }),
      fakeSession,
    );
    expect(res.status).toBe('queued');
    expect(dialogRepo.updateLastMessage).toHaveBeenCalled();
    expect(outboxService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'MessengerMessageSent',
        aggregateId: dialogId,
      }),
      fakeSession,
    );
  });

  it('sends media message as queued, not sent', async () => {
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();
    (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
      _id: dialogId,
      organizationId: orgId,
      accountId: new Types.ObjectId(),
      platform: 'telegram',
      externalChatId: 'chat-99',
    });
    (messageRepo.create as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(),
      organizationId: orgId,
      dialogId,
      author: 'agent',
      text: '[Файл: plan.pdf]',
      messageType: 'document',
      status: 'queued',
      sentAt: new Date(),
    });

    await service.sendMediaMessage({
      organizationId: orgId,
      dialogId,
      media: { fileName: 'plan.pdf', url: 'https://example.test/plan.pdf' },
    });

    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', messageType: 'document' }),
      fakeSession,
    );
  });

  describe('sendMediaMessage: assetId проверяется на существование и принадлежность организации', () => {
    // ИСПРАВЛЕНО 11.09.2026: раньше assetId писался в сообщение как есть —
    // можно было приложить к диалогу asset чужой организации, подобрав
    // ObjectId (тот же класс, что был у link-crm leadId/contactId/dealId).
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();

    beforeEach(() => {
      (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
        _id: dialogId,
        organizationId: orgId,
        accountId: new Types.ObjectId(),
        platform: 'telegram',
        externalChatId: 'chat-77',
      });
    });

    it('assetId из чужой организации (или несуществующий) — NotFoundException, сообщение не создаётся', async () => {
      (mediaService.getAssetForOwnerScope as jest.Mock).mockResolvedValue(null);

      await expect(
        service.sendMediaMessage({
          organizationId: orgId,
          dialogId,
          media: { assetId: new Types.ObjectId(), fileName: 'plan.pdf' },
        }),
      ).rejects.toThrow('Media asset not found');
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('assetId существует, но ещё не verified — BadRequestException, сообщение не создаётся', async () => {
      (mediaService.getAssetForOwnerScope as jest.Mock).mockResolvedValue({
        status: 'pending',
        variants: [],
        bucket: 'private',
      });

      await expect(
        service.sendMediaMessage({
          organizationId: orgId,
          dialogId,
          media: { assetId: new Types.ObjectId(), fileName: 'plan.pdf' },
        }),
      ).rejects.toThrow('Media asset is not verified yet');
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('assetId из своей организации и verified — сообщение создаётся', async () => {
      (mediaService.getAssetForOwnerScope as jest.Mock).mockResolvedValue({
        status: 'verified',
        variants: [],
        bucket: 'private',
      });
      (messageRepo.create as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
        organizationId: orgId,
        dialogId,
        author: 'agent',
        text: '[Файл: plan.pdf]',
        messageType: 'document',
        status: 'queued',
        sentAt: new Date(),
      });

      const assetId = new Types.ObjectId();
      await service.sendMediaMessage({
        organizationId: orgId,
        dialogId,
        media: { assetId, fileName: 'plan.pdf' },
      });

      expect(mediaService.getAssetForOwnerScope).toHaveBeenCalledWith(assetId, {
        type: 'organization',
        organizationId: orgId,
      });
      expect(messageRepo.create).toHaveBeenCalled();
    });
  });

  it('creates crm task directly from dialog context', async () => {
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const fakeDialog = {
      _id: dialogId,
      organizationId: orgId,
      name: 'Иван Клиент',
      platform: 'whatsapp',
      leadId,
    };
    (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue(fakeDialog);

    const res = await service.createTaskFromDialog({
      organizationId: orgId,
      dialogId,
      actorIdentityId: new Types.ObjectId(),
      actorPositionId: new Types.ObjectId(),
      title: 'Перезвонить клиенту из WhatsApp',
      correlationId: 'cor-task',
      idempotencyKey: 'idemp-1',
      idempotencyRequestBody: { title: 'Перезвонить клиенту из WhatsApp' },
    });

    expect(res).toEqual({ id: 'task-123' });
    expect(crmService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Перезвонить клиенту из WhatsApp',
        leadId,
        // ИСПРАВЛЕНО 11.09.2026: своё имя операции идемпотентности,
        // отличное от 'createTask' у POST /tasks — иначе общий
        // Idempotency-Key на двух эндпоинтах давал ложный 409.
        idempotencyOperation: 'createTaskFromDialog',
      }),
    );
  });

  describe('listDialogs: составной seek-курсор вместо курсора по одному _id', () => {
    // ИСПРАВЛЕНО 11.09.2026: сортировка — pinned, затем свежесть последнего
    // сообщения, затем _id; курсор раньше фильтровал только по _id, из-за
    // чего терял и дублировал диалоги. Сама Mongo-семантика курсора
    // проверена на настоящей базе (messenger-dialogs-pagination.integration-
    // spec.ts) — здесь только "+1 трюк" сервисного слоя (limit+1 → hasMore →
    // nextCursor), который не требует реальной Mongo.
    const orgId = new Types.ObjectId();

    function fakeDialog(pinned: boolean, sentAt: Date | undefined) {
      return {
        _id: new Types.ObjectId(),
        organizationId: orgId,
        accountId: new Types.ObjectId(),
        platform: 'telegram',
        externalChatId: `chat-${new Types.ObjectId().toString()}`,
        name: 'Клиент',
        unreadCount: 0,
        pinned,
        version: 0,
        lastMessage: sentAt ? { text: 'привет', sentAt, fromMe: false, author: 'client' } : undefined,
      };
    }

    it('репозиторий вернул limit+1 — страница обрезается до limit, nextCursor не пуст', async () => {
      const docs = [fakeDialog(true, new Date('2026-09-10T10:00:00Z')), fakeDialog(false, undefined), fakeDialog(false, undefined)];
      (dialogRepo.listForOrganization as jest.Mock).mockResolvedValue(docs);

      const res = await service.listDialogs({ organizationId: orgId, limit: 2 });

      expect(dialogRepo.listForOrganization).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
      expect(res.items).toHaveLength(2);
      expect(res.items.map((d) => d.id)).toEqual([docs[0]!._id.toString(), docs[1]!._id.toString()]);
      expect(res.nextCursor).not.toBeNull();
    });

    it('репозиторий вернул меньше limit+1 — страница вся целиком, nextCursor null', async () => {
      const docs = [fakeDialog(true, undefined)];
      (dialogRepo.listForOrganization as jest.Mock).mockResolvedValue(docs);

      const res = await service.listDialogs({ organizationId: orgId, limit: 50 });

      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBeNull();
    });

    it('входной cursor — легаси ObjectId — декодируется и уходит в репозиторий как {kind: "legacy"}', async () => {
      (dialogRepo.listForOrganization as jest.Mock).mockResolvedValue([]);
      const legacyId = new Types.ObjectId();

      await service.listDialogs({ organizationId: orgId, limit: 10, cursor: legacyId.toString() });

      expect(dialogRepo.listForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { kind: 'legacy', id: legacyId } }),
      );
    });

    it('битый cursor — BadRequestException, репозиторий не вызывается', async () => {
      await expect(service.listDialogs({ organizationId: orgId, limit: 10, cursor: 'мусор' })).rejects.toThrow();
      expect(dialogRepo.listForOrganization).not.toHaveBeenCalled();
    });
  });

  describe('own-scope на запись: чужой диалог не даёт писать/перепривязывать/создавать задачу', () => {
    // ИСПРАВЛЕНО 11.09.2026: раньше assignedPositionId проверялся только на
    // чтение (getDialog/listMessages/markDialogRead) — эти четыре метода
    // мутировали любой диалог организации независимо от own-scope.
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();
    const otherPositionId = new Types.ObjectId();

    function mockDialog(assignedPositionId: Types.ObjectId | undefined) {
      (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
        _id: dialogId,
        organizationId: orgId,
        accountId: new Types.ObjectId(),
        platform: 'telegram',
        externalChatId: 'chat-99',
        name: 'Иван Клиент',
        assignedPositionId,
      });
    }

    it('sendTextMessage: диалог назначен другой позиции — NotFoundException, сообщение не создаётся', async () => {
      mockDialog(ownerPositionId);

      await expect(
        service.sendTextMessage({
          organizationId: orgId,
          dialogId,
          assignedPositionId: otherPositionId,
          text: 'Попытка обхода',
        }),
      ).rejects.toThrow('Диалог не найден');
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('sendTextMessage: свой диалог — own-scope не мешает отправить', async () => {
      mockDialog(ownerPositionId);
      (messageRepo.create as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
        organizationId: orgId,
        dialogId,
        author: 'agent',
        text: 'Добрый день!',
        messageType: 'text',
        status: 'queued',
        sentAt: new Date(),
      });

      const res = await service.sendTextMessage({
        organizationId: orgId,
        dialogId,
        assignedPositionId: ownerPositionId,
        text: 'Добрый день!',
      });

      expect(res.text).toBe('Добрый день!');
    });

    it('sendTextMessage: диалог ещё не взят в работу (assignedPositionId не задан) — own-scope не блокирует', async () => {
      mockDialog(undefined);
      (messageRepo.create as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
        organizationId: orgId,
        dialogId,
        author: 'agent',
        text: 'Здравствуйте!',
        messageType: 'text',
        status: 'queued',
        sentAt: new Date(),
      });

      await expect(
        service.sendTextMessage({
          organizationId: orgId,
          dialogId,
          assignedPositionId: otherPositionId,
          text: 'Здравствуйте!',
        }),
      ).resolves.toMatchObject({ text: 'Здравствуйте!' });
    });

    it('sendMediaMessage: диалог назначен другой позиции — NotFoundException', async () => {
      mockDialog(ownerPositionId);

      await expect(
        service.sendMediaMessage({
          organizationId: orgId,
          dialogId,
          assignedPositionId: otherPositionId,
          media: { fileName: 'plan.pdf', url: 'https://example.test/plan.pdf' },
        }),
      ).rejects.toThrow('Диалог не найден');
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('linkDialogToCrm: диалог назначен другой позиции — NotFoundException, привязка не меняется', async () => {
      mockDialog(ownerPositionId);

      await expect(
        service.linkDialogToCrm({
          organizationId: orgId,
          dialogId,
          assignedPositionId: otherPositionId,
          leadId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'cor-link',
        }),
      ).rejects.toThrow('Диалог не найден');
      expect(dialogRepo.linkCrm).not.toHaveBeenCalled();
    });

    it('createTaskFromDialog: диалог назначен другой позиции — NotFoundException, задача не создаётся', async () => {
      mockDialog(ownerPositionId);

      await expect(
        service.createTaskFromDialog({
          organizationId: orgId,
          dialogId,
          assignedPositionId: otherPositionId,
          actorIdentityId: new Types.ObjectId(),
          actorPositionId: otherPositionId,
          title: 'Попытка обхода',
          correlationId: 'cor-task-2',
          idempotencyKey: 'idemp-2',
          idempotencyRequestBody: {},
        }),
      ).rejects.toThrow('Диалог не найден');
      expect(crmService.createTask).not.toHaveBeenCalled();
    });
  });

  describe('linkDialogToCrm: leadId/contactId/dealId проверяются на существование и принадлежность организации', () => {
    // ИСПРАВЛЕНО 11.09.2026: раньше leadId/contactId/dealId писались в
    // dialogRepository.linkCrm как есть, без единой проверки — диалог
    // можно было привязать к CRM-записи чужой организации, подобрав
    // произвольный ObjectId. Own-scope конкретной записи (например лида,
    // назначенного другому менеджеру) сюда намеренно не входит — это
    // отдельный вопрос, см. messenger-skeleton.md.
    const orgId = new Types.ObjectId();
    const dialogId = new Types.ObjectId();
    const ownerPositionId = new Types.ObjectId();

    beforeEach(() => {
      (dialogRepo.findByIdForOrganization as jest.Mock).mockResolvedValue({
        _id: dialogId,
        organizationId: orgId,
        platform: 'telegram',
        externalChatId: 'chat-77',
        name: 'Мария Клиент',
        assignedPositionId: ownerPositionId,
      });

      crmService.getLeadForOrganization = jest.fn();
      crmService.getContactForOrganization = jest.fn();
      crmService.getDealForOrganization = jest.fn();
    });

    it('leadId из чужой организации (или несуществующий) — NotFoundException, привязка не меняется', async () => {
      (crmService.getLeadForOrganization as jest.Mock).mockRejectedValue(new NotFoundException('Lead not found'));

      await expect(
        service.linkDialogToCrm({
          organizationId: orgId,
          dialogId,
          assignedPositionId: ownerPositionId,
          leadId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'cor-link-lead',
        }),
      ).rejects.toThrow('Lead not found');
      expect(dialogRepo.linkCrm).not.toHaveBeenCalled();
    });

    it('contactId из чужой организации (или несуществующий) — NotFoundException, привязка не меняется', async () => {
      (crmService.getContactForOrganization as jest.Mock).mockRejectedValue(
        new NotFoundException('Contact not found'),
      );

      await expect(
        service.linkDialogToCrm({
          organizationId: orgId,
          dialogId,
          assignedPositionId: ownerPositionId,
          contactId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'cor-link-contact',
        }),
      ).rejects.toThrow('Contact not found');
      expect(dialogRepo.linkCrm).not.toHaveBeenCalled();
    });

    it('dealId из чужой организации (или несуществующий) — NotFoundException, привязка не меняется', async () => {
      (crmService.getDealForOrganization as jest.Mock).mockRejectedValue(new NotFoundException('Deal not found'));

      await expect(
        service.linkDialogToCrm({
          organizationId: orgId,
          dialogId,
          assignedPositionId: ownerPositionId,
          dealId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'cor-link-deal',
        }),
      ).rejects.toThrow('Deal not found');
      expect(dialogRepo.linkCrm).not.toHaveBeenCalled();
    });

    it('свои leadId/contactId/dealId — проходят проверку, привязка выполняется', async () => {
      const leadId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const dealId = new Types.ObjectId();
      (crmService.getLeadForOrganization as jest.Mock).mockResolvedValue({ _id: leadId } as never);
      (crmService.getContactForOrganization as jest.Mock).mockResolvedValue({ _id: contactId } as never);
      (crmService.getDealForOrganization as jest.Mock).mockResolvedValue({ _id: dealId } as never);
      (dialogRepo.linkCrm as jest.Mock).mockResolvedValue({
        _id: dialogId,
        organizationId: orgId,
        accountId: new Types.ObjectId(),
        platform: 'telegram',
        externalChatId: 'chat-77',
        name: 'Мария Клиент',
        assignedPositionId: ownerPositionId,
        unreadCount: 0,
        pinned: false,
        leadId,
        contactId,
        dealId,
      });

      const res = await service.linkDialogToCrm({
        organizationId: orgId,
        dialogId,
        assignedPositionId: ownerPositionId,
        leadId,
        contactId,
        dealId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'cor-link-ok',
      });

      expect(crmService.getLeadForOrganization).toHaveBeenCalledWith(leadId, orgId);
      expect(crmService.getContactForOrganization).toHaveBeenCalledWith(contactId, orgId);
      expect(crmService.getDealForOrganization).toHaveBeenCalledWith(dealId, orgId);
      expect(res.leadId).toBe(leadId.toString());
      expect(res.contactId).toBe(contactId.toString());
      expect(res.dealId).toBe(dealId.toString());
    });
  });

  describe('addTelegramBot: верификация у Telegram (N-12)', () => {
    it('невалидный токен (getMe бросает TelegramApiError) — BadRequestException, аккаунт не создаётся', async () => {
      (telegramBotClient.getMe as jest.Mock).mockRejectedValue(new TelegramApiError('Unauthorized', 401, true));

      await expect(
        service.addTelegramBot({
          organizationId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          name: 'Sales Bot',
          botToken: 'invalid-token',
          correlationId: 'cor-bad-token',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(accountRepo.create).not.toHaveBeenCalled();
      expect(telegramBotClient.setWebhook).not.toHaveBeenCalled();
    });

    it('токен верный, но setWebhook падает — BadRequestException, аккаунт не создаётся', async () => {
      (telegramBotClient.setWebhook as jest.Mock).mockRejectedValue(
        new TelegramApiError('Bad webhook URL', 400, true),
      );

      await expect(
        service.addTelegramBot({
          organizationId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          name: 'Sales Bot',
          botToken: '12345:token',
          correlationId: 'cor-bad-webhook',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(accountRepo.create).not.toHaveBeenCalled();
    });

    it('успешная верификация — аккаунт создаётся сразу authenticated, с telegramBotUsername и webhookSecret', async () => {
      (accountRepo.create as jest.Mock).mockImplementation(async (params: Record<string, unknown>) => ({
        _id: new Types.ObjectId(),
        ...params,
        createdAt: new Date(),
      }));

      const result = await service.addTelegramBot({
        organizationId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        name: 'Sales Bot',
        botToken: '12345:token',
        correlationId: 'cor-ok',
      });

      expect(telegramBotClient.getMe).toHaveBeenCalledWith('12345:token');
      expect(telegramBotClient.setWebhook).toHaveBeenCalledWith(
        '12345:token',
        expect.stringContaining('/api/v1/public/messenger/telegram/'),
        expect.any(String),
      );
      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authStatus: 'authenticated',
          telegramBotUsername: 'sales_bot',
          webhookSecret: expect.any(String),
        }),
        fakeSession,
      );
      expect(result.authStatus).toBe('authenticated');
    });
  });

  describe('handleTelegramUpdate: входящее сообщение возвращается в диалог (N-12)', () => {
    const accountId = new Types.ObjectId();
    const orgId = new Types.ObjectId();
    const webhookSecret = 'a'.repeat(64);

    function textUpdate(overrides: Partial<{ chatId: number; messageId: number; text: string }> = {}) {
      return {
        update_id: 1,
        message: {
          message_id: overrides.messageId ?? 501,
          date: 1_700_000_000,
          chat: { id: overrides.chatId ?? 555, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Иван', username: 'ivan_client' },
          text: overrides.text ?? 'Здравствуйте, интересует квартира',
        },
      };
    }

    it('неверный секрет — молча ничего не делает (не создаёт ни диалог, ни сообщение)', async () => {
      (accountRepo.findByIdWithWebhookSecret as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        platform: 'telegram',
        webhookSecret,
      });

      await service.handleTelegramUpdate({ accountId, secretToken: 'wrong-secret', update: textUpdate() });

      expect(dialogRepo.findByExternalChatId).not.toHaveBeenCalled();
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('неизвестный accountId — молча ничего не делает', async () => {
      (accountRepo.findByIdWithWebhookSecret as jest.Mock).mockResolvedValue(null);

      await service.handleTelegramUpdate({ accountId, secretToken: webhookSecret, update: textUpdate() });

      expect(dialogRepo.findByExternalChatId).not.toHaveBeenCalled();
    });

    it('апдейт без message.text (фото/стикер) — игнорируется', async () => {
      (accountRepo.findByIdWithWebhookSecret as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        platform: 'telegram',
        webhookSecret,
      });

      await service.handleTelegramUpdate({
        accountId,
        secretToken: webhookSecret,
        update: { update_id: 2 },
      });

      expect(dialogRepo.findByExternalChatId).not.toHaveBeenCalled();
    });

    it('новый chat — создаёт диалог и сообщение, увеличивает unreadCount', async () => {
      (accountRepo.findByIdWithWebhookSecret as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        platform: 'telegram',
        webhookSecret,
      });
      (dialogRepo.findByExternalChatId as jest.Mock).mockResolvedValue(null);
      const newDialogId = new Types.ObjectId();
      (dialogRepo.create as jest.Mock).mockResolvedValue({ _id: newDialogId });
      (messageRepo.findByExternalMessageId as jest.Mock).mockResolvedValue(null);

      await service.handleTelegramUpdate({ accountId, secretToken: webhookSecret, update: textUpdate() });

      expect(dialogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          accountId,
          externalChatId: '555',
          name: 'Иван',
          clientHandle: '@ivan_client',
        }),
        fakeSession,
      );
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          dialogId: newDialogId,
          author: 'client',
          externalMessageId: '501',
          text: 'Здравствуйте, интересует квартира',
        }),
        fakeSession,
      );
      expect(dialogRepo.updateLastMessage).toHaveBeenCalledWith(newDialogId, orgId, expect.any(Object), true, fakeSession);
    });

    it('существующий chat — переиспользует диалог, не создаёт новый', async () => {
      (accountRepo.findByIdWithWebhookSecret as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        platform: 'telegram',
        webhookSecret,
      });
      const existingDialogId = new Types.ObjectId();
      (dialogRepo.findByExternalChatId as jest.Mock).mockResolvedValue({ _id: existingDialogId });
      (messageRepo.findByExternalMessageId as jest.Mock).mockResolvedValue(null);

      await service.handleTelegramUpdate({ accountId, secretToken: webhookSecret, update: textUpdate() });

      expect(dialogRepo.create).not.toHaveBeenCalled();
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ dialogId: existingDialogId }),
        fakeSession,
      );
    });

    it('повторная доставка того же апдейта (тот же externalMessageId) — не дублирует сообщение', async () => {
      (accountRepo.findByIdWithWebhookSecret as jest.Mock).mockResolvedValue({
        _id: accountId,
        organizationId: orgId,
        platform: 'telegram',
        webhookSecret,
      });
      const existingDialogId = new Types.ObjectId();
      (dialogRepo.findByExternalChatId as jest.Mock).mockResolvedValue({ _id: existingDialogId });
      (messageRepo.findByExternalMessageId as jest.Mock).mockResolvedValue({ _id: new Types.ObjectId() });

      await service.handleTelegramUpdate({ accountId, secretToken: webhookSecret, update: textUpdate() });

      expect(messageRepo.create).not.toHaveBeenCalled();
      expect(dialogRepo.updateLastMessage).not.toHaveBeenCalled();
    });
  });
});
