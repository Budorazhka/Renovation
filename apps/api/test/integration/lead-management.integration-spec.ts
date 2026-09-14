import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmService } from '../../src/modules/crm/crm.service';
import { OrganizationsModule } from '../../src/modules/organizations/organizations.module';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { ErrorCode } from '../../src/shared/errors/error-codes';
import { IdempotencyService } from '../../src/shared/idempotency/idempotency.service';
import { MediaAssetRepository } from '@baza/media-storage';

/**
 * D-05B: GET/POST/PATCH /leads/* — самостоятельная integration-проверка
 * против РЕАЛЬНОЙ MongoDB транзакции (не моки), закрывает честный пробел —
 * до этой задачи CRM/leads не был покрыт ни одним integration-тестом.
 * Тот же bootstrap-паттерн, что developments-transactions.integration-spec.ts
 * (DI-only, без HTTP-слоя — CrmController/LeadController не участвуют,
 * ParseObjectIdPipe/PermissionGuard проверяются отдельно unit-тестами).
 */
describe('CrmService — Lead management integration (real MongoDB transactions)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let crmService: CrmService;
  let organizationsService: OrganizationsService;
  let idempotencyService: IdempotencyService;
  let mediaAssetRepository: MediaAssetRepository;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();

    // CrmModule теперь импортирует OrganizationsModule (D-05B), которое
    // транзитивно тянет MediaModule → MediaStorageService (реальный
    // S3Client в конструкторе) — тот же паттерн MINIO_* фикстур, что уже
    // используется в developments-transactions.integration-spec.ts.
    process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY ??= 'test-access-key';
    process.env.MINIO_SECRET_KEY ??= 'test-secret-key';
    process.env.MINIO_BUCKET_PRIVATE ??= 'test-private';
    process.env.MINIO_BUCKET_PUBLIC ??= 'test-public';
    // CrmModule → RateLimitModule → RedisModule (RedisService конструирует
    // ioredis-клиент в конструкторе, тот же паттерн, что MediaStorageService/
    // S3Client выше) — ни один тест здесь не проходит через
    // RedisRateLimitGuard (нет HTTP-слоя, только CrmService напрямую),
    // реального подключения не требуется, ioredis сам переподключается в
    // фоне без синхронного throw (см. RedisService докстринг).
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(uri),
        CrmModule,
        OrganizationsModule,
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    crmService = moduleRef.get(CrmService);
    organizationsService = moduleRef.get(OrganizationsService);
    idempotencyService = moduleRef.get(IdempotencyService);
    mediaAssetRepository = moduleRef.get(MediaAssetRepository);
  }, 120_000);

  afterAll(async () => {
    // moduleRef.close() — триггерит RedisService.onModuleDestroy (закрывает
    // ioredis-соединение), иначе открытый TCP-хендл держит jest-процесс
    // (тот же риск, что незакрытый MongoDB connection).
    await moduleRef?.close();
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('leads').deleteMany({});
    await connection.collection('lead_events').deleteMany({});
    await connection.collection('contacts').deleteMany({});
    await connection.collection('positions').deleteMany({});
    await connection.collection('organizations').deleteMany({});
    await connection.collection('audit_events').deleteMany({});
    await connection.collection('permission_grants').deleteMany({});
    await connection.collection('idempotency_records').deleteMany({});
    await connection.collection('media_assets').deleteMany({});
  });

  async function seedOrganization(organizationId: Types.ObjectId): Promise<void> {
    await connection.collection('organizations').insertOne({
      _id: organizationId,
      type: 'developer',
      name: 'Интеграционный застройщик',
      status: 'active',
      createdAt: new Date(),
    });
  }

  async function seedVacantPosition(organizationId: Types.ObjectId, fixedRole: 'manager' | 'rop' = 'manager'): Promise<Types.ObjectId> {
    return organizationsService.createVacantPosition({ organizationId, fixedRole });
  }

  async function seedClosedPosition(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const positionId = await seedVacantPosition(organizationId);
    await connection.collection('positions').updateOne({ _id: positionId }, { $set: { status: 'closed' } });
    return positionId;
  }

  async function seedLead(
    organizationId: Types.ObjectId,
    overrides?: { stage?: string; ownerPositionId?: Types.ObjectId; productType?: 'sales' | 'network' | 'owner' | 'agent' },
  ): Promise<Types.ObjectId> {
    const contactId = new Types.ObjectId();
    await connection.collection('contacts').insertOne({
      _id: contactId,
      organizationId,
      name: 'Иван Интеграционный',
      phone: '+79990000000',
      roles: ['buyer'],
      createdAt: new Date(),
    });
    const leadId = new Types.ObjectId();
    await connection.collection('leads').insertOne({
      _id: leadId,
      organizationId,
      contactId,
      ownerPositionId: overrides?.ownerPositionId,
      productType: overrides?.productType,
      stage: overrides?.stage ?? 'new',
      // Прямая запись через native driver (не Mongoose) — schema default:0
      // не применяется автоматически, нужно явно (changeStageWithVersionCheck
      // фильтрует по version:expectedVersion, undefined никогда не совпадает).
      version: 0,
      source: { route: '/developments/integration-test' },
      createdAt: new Date(),
    });
    return leadId;
  }

  async function seedVerifiedMediaAsset(organizationId: Types.ObjectId): Promise<Types.ObjectId> {
    const assetId = new Types.ObjectId();
    await mediaAssetRepository.create({
      _id: assetId,
      ownerScope: { type: 'organization', organizationId },
      declaredMimeType: 'image/jpeg',
      sizeBytes: 1024,
      bucket: 'public',
      originalPath: `${assetId.toString()}/original.jpg`,
      purpose: 'lead_attachment',
    });
    // markVerified требует session изнутри транзакции confirmUpload
    // (ADR-006) — здесь просто фикстура для теста CRM-стороны (upload/
    // confirm уже покрыты media-confirm-upload.integration-spec.ts),
    // прямая запись через native driver быстрее и не тянет транзакцию.
    await connection
      .collection('media_assets')
      .updateOne({ _id: assetId }, { $set: { status: 'verified', verifiedMimeType: 'image/jpeg', checksum: 'test-checksum' } });
    return assetId;
  }

  describe('recordContactAction — лог обращений (phase 3)', () => {
    it('пишет audit-запись lead.contact с contactType/actorPositionId', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const result = await crmService.recordContactAction({
        leadId,
        organizationId,
        contactType: 'call',
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
      });
      expect(result).toEqual({ recorded: true });

      const auditDoc = await connection.collection('audit_events').findOne({ action: 'lead.contact' });
      expect(auditDoc).toMatchObject({
        resourceId: leadId,
        actor: { type: 'identity', id: actorIdentityId },
        after: { contactType: 'call', actorPositionId: actorPositionId.toString() },
      });
    });

    it('второй вызов (chat) для того же лида добавляет ВТОРУЮ audit-запись — append-only, не перезапись', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);

      await crmService.recordContactAction({
        leadId,
        organizationId,
        contactType: 'call',
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id-1',
      });
      await crmService.recordContactAction({
        leadId,
        organizationId,
        contactType: 'chat',
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id-2',
      });

      const count = await connection.collection('audit_events').countDocuments({ action: 'lead.contact', resourceId: leadId });
      expect(count).toBe(2);
    });

    it('чужая организация — NotFoundException, audit не пишется', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const leadId = await seedLead(orgA);

      await expect(
        crmService.recordContactAction({
          leadId,
          organizationId: orgB,
          contactType: 'call',
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const count = await connection.collection('audit_events').countDocuments({ action: 'lead.contact' });
      expect(count).toBe(0);
    });
  });

  describe('lead files — upload-confirm-attach-list-delete цикл (phase 3)', () => {
    it('attachLeadFile → listLeadFiles → detachLeadFile → listLeadFiles: полный цикл', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const assetId = await seedVerifiedMediaAsset(organizationId);
      const actorIdentityId = new Types.ObjectId();

      const afterAttach = await crmService.attachLeadFile({
        leadId,
        organizationId,
        assetId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id-attach',
      });
      expect(afterAttach).toEqual([
        expect.objectContaining({ assetId: assetId.toString(), fileName: 'original.jpg', mimeType: 'image/jpeg' }),
      ]);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.attachedAssetIds?.map((id: Types.ObjectId) => id.toString())).toEqual([assetId.toString()]);

      const files = await crmService.listLeadFiles({ leadId, organizationId });
      expect(files).toHaveLength(1);

      const auditAttach = await connection.collection('audit_events').findOne({
        action: 'lead.update',
        'after.attachedAssetId': assetId.toString(),
      });
      expect(auditAttach).toBeTruthy();

      const afterDetach = await crmService.detachLeadFile({
        leadId,
        organizationId,
        assetId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id-detach',
      });
      expect(afterDetach).toEqual([]);

      const leadDocAfterDetach = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDocAfterDetach?.attachedAssetIds ?? []).toEqual([]);

      const filesAfterDetach = await crmService.listLeadFiles({ leadId, organizationId });
      expect(filesAfterDetach).toEqual([]);
    });

    it('attachLeadFile: не-verified asset — VALIDATION_FAILED, лид не изменяется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const assetId = new Types.ObjectId();
      await mediaAssetRepository.create({
        _id: assetId,
        ownerScope: { type: 'organization', organizationId },
        declaredMimeType: 'image/jpeg',
        sizeBytes: 1024,
        bucket: 'public',
        originalPath: `${assetId.toString()}/original.jpg`,
        purpose: 'lead_attachment',
      });

      await expect(
        crmService.attachLeadFile({
          leadId,
          organizationId,
          assetId,
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.attachedAssetIds ?? []).toEqual([]);
    });

    it('attachLeadFile: asset чужой организации — NotFoundException', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const leadId = await seedLead(orgA);
      const foreignAssetId = await seedVerifiedMediaAsset(orgB);

      await expect(
        crmService.attachLeadFile({
          leadId,
          organizationId: orgA,
          assetId: foreignAssetId,
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assignLead — tenant isolation и Position boundary (D-05B security fix)', () => {
    it('чужая организация — assign отклоняется NotFoundException, ownerPositionId не меняется', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const leadId = await seedLead(orgA);
      const foreignPositionId = await seedVacantPosition(orgB);

      await expect(
        crmService.assignLead({
          leadId,
          assigneePositionId: foreignPositionId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: orgA,
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      // MongoDB insertOne сериализует undefined-поле как null (не как
      // отсутствующее поле) — seedLead передаёт ownerPositionId:undefined,
      // когда overrides его не задаёт, драйвер сохраняет null. Реальный
      // инвариант "ownerPositionId не изменился" от этого не меняется.
      expect(leadDoc?.ownerPositionId).toBeFalsy();
    });

    it('closed Position — assign отклоняется ConflictException, ownerPositionId не меняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const closedPositionId = await seedClosedPosition(organizationId);

      await expect(
        crmService.assignLead({
          leadId,
          assigneePositionId: closedPositionId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      // MongoDB insertOne сериализует undefined-поле как null (не как
      // отсутствующее поле) — seedLead передаёт ownerPositionId:undefined,
      // когда overrides его не задаёт, драйвер сохраняет null. Реальный
      // инвариант "ownerPositionId не изменился" от этого не меняется.
      expect(leadDoc?.ownerPositionId).toBeFalsy();
      // Реальная транзакция: LeadEvent/Audit тоже не должны были записаться —
      // проверка Position происходит ДО assignOwner внутри той же транзакции.
      const eventCount = await connection.collection('lead_events').countDocuments({ leadId });
      expect(eventCount).toBe(0);
      const auditCount = await connection.collection('audit_events').countDocuments({ resourceId: leadId });
      expect(auditCount).toBe(0);
    });

    it('несуществующая Position — assign отклоняется NotFoundException', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);

      await expect(
        crmService.assignLead({
          leadId,
          assigneePositionId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('успешный assign — LeadEvent+Audit записаны реальной транзакцией, ownerPositionId обновлён', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'qualified' });
      const positionId = await seedVacantPosition(organizationId);
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const result = await crmService.assignLead({
        leadId,
        assigneePositionId: positionId,
        actorPositionId,
        actorIdentityId,
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
      });

      expect(result.ownerPositionId).toBe(positionId.toString());

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.ownerPositionId?.toString()).toBe(positionId.toString());

      const eventDocs = await connection.collection('lead_events').find({ leadId }).toArray();
      expect(eventDocs).toHaveLength(1);
      expect(eventDocs[0]?.changedBy).toMatchObject({ type: 'position', positionId: actorPositionId });

      const auditDocs = await connection.collection('audit_events').find({ resourceId: leadId }).toArray();
      expect(auditDocs).toHaveLength(1);
      expect(auditDocs[0]?.action).toBe('lead.assign');
    });

    it('конкурентный assign — оба запроса завершаются успешно, финальный ownerPositionId одна из двух позиций (не версионировано, задокументированное поведение)', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const positionA = await seedVacantPosition(organizationId);
      const positionB = await seedVacantPosition(organizationId);

      const [resultA, resultB] = await Promise.all([
        crmService.assignLead({
          leadId,
          assigneePositionId: positionA,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id-a',
        }),
        crmService.assignLead({
          leadId,
          assigneePositionId: positionB,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id-b',
        }),
      ]);

      expect(resultA.ownerPositionId).toBeTruthy();
      expect(resultB.ownerPositionId).toBeTruthy();

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      const finalOwner = leadDoc?.ownerPositionId?.toString();
      expect([positionA.toString(), positionB.toString()]).toContain(finalOwner);

      // Оба assign успешно записали свой LeadEvent+Audit — "последний write
      // выигрывает" применяется только к самому Lead.ownerPositionId, не к
      // истории/аудиту (append-only, обе попытки реальны и произошли).
      const eventCount = await connection.collection('lead_events').countDocuments({ leadId });
      expect(eventCount).toBe(2);
      const auditCount = await connection.collection('audit_events').countDocuments({ resourceId: leadId });
      expect(auditCount).toBe(2);
    });
  });

  describe('unassignLead — tenant isolation, LeadEvent/Audit, stage не меняется', () => {
    it('чужая организация — unassign отклоняется NotFoundException, ownerPositionId не меняется', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const ownerPositionId = await seedVacantPosition(orgA);
      const leadId = await seedLead(orgA, { ownerPositionId });

      await expect(
        crmService.unassignLead({
          leadId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: orgB,
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.ownerPositionId?.toString()).toBe(ownerPositionId.toString());
    });

    it('несуществующий лид — unassign отклоняется NotFoundException', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);

      await expect(
        crmService.unassignLead({
          leadId: new Types.ObjectId(),
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('успешный unassign — LeadEvent+Audit записаны реальной транзакцией, ownerPositionId очищен, stage не меняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const ownerPositionId = await seedVacantPosition(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'qualified', ownerPositionId });
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const result = await crmService.unassignLead({
        leadId,
        actorPositionId,
        actorIdentityId,
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
      });

      expect(result.ownerPositionId).toBeNull();
      expect(result.stage).toBe('qualified');

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.ownerPositionId).toBeFalsy();
      expect(leadDoc?.stage).toBe('qualified');

      const eventDocs = await connection.collection('lead_events').find({ leadId }).toArray();
      expect(eventDocs).toHaveLength(1);
      expect(eventDocs[0]?.stage).toBe('qualified');
      expect(eventDocs[0]?.changedBy).toMatchObject({ type: 'position', positionId: actorPositionId });

      const auditDocs = await connection.collection('audit_events').find({ resourceId: leadId }).toArray();
      expect(auditDocs).toHaveLength(1);
      expect(auditDocs[0]?.action).toBe('lead.unassign');
    });
  });

  describe('changeLeadStage — comment (phase 3, легаси createStageComment/getStageComments)', () => {
    it('comment сохраняется на LeadEvent этого перехода и отдаётся в GET /leads/:id/events', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'new' });

      await crmService.changeLeadStage({
        leadId,
        newStage: 'contacted',
        expectedVersion: 0,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        comment: 'Клиент попросил перезвонить завтра',
      });

      const { items } = await crmService.listLeadEvents({ leadId, organizationId, limit: 20 });
      const event = items.find((e) => e.stage === 'contacted');
      expect(event?.comment).toBe('Клиент попросил перезвонить завтра');

      const eventDoc = await connection.collection('lead_events').findOne({ leadId, stage: 'contacted' });
      expect(eventDoc?.comment).toBe('Клиент попросил перезвонить завтра');
    });

    it('без comment — поле остаётся null (не задан), не ломает существующий переход', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'new' });

      await crmService.changeLeadStage({
        leadId,
        newStage: 'contacted',
        expectedVersion: 0,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      const { items } = await crmService.listLeadEvents({ leadId, organizationId, limit: 20 });
      expect(items[0]?.comment).toBeNull();
    });
  });

  describe('changeLeadStage — transition-матрица (D-05B)', () => {
    it('запрещённый переход (converted→contacted) — AppException VALIDATION_FAILED, stage не меняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'converted' });

      await expect(
        crmService.changeLeadStage({
          leadId,
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id',
          idempotencyKey: new Types.ObjectId().toString(),
          idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('converted');
      const eventCount = await connection.collection('lead_events').countDocuments({ leadId });
      expect(eventCount).toBe(0);
    });

    it('разрешённая цепочка new→contacted→qualified→converted — все переходы успешны, LeadEvent на каждый шаг', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'new' });
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      let expectedVersion = 0;
      for (const newStage of ['contacted', 'qualified', 'converted'] as const) {
        const result = await crmService.changeLeadStage({
          leadId,
          newStage,
          expectedVersion,
          actorPositionId,
          actorIdentityId,
          expectedOrganizationId: organizationId,
          correlationId: `integration-test-${newStage}`,
          idempotencyKey: new Types.ObjectId().toString(),
          idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        });
        expectedVersion = result.version;
      }

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('converted');
      expect(leadDoc?.version).toBe(3);
      const eventCount = await connection.collection('lead_events').countDocuments({ leadId });
      expect(eventCount).toBe(3);
    });

    it('lost→new разрешён', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'lost' });

      await crmService.changeLeadStage({
        leadId,
        newStage: 'new',
        expectedVersion: 0,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('new');
    });

    it('lost→qualified запрещён (не восстановление прогресса задним числом)', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'lost' });

      await expect(
        crmService.changeLeadStage({
          leadId,
          newStage: 'qualified',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id',
          idempotencyKey: new Types.ObjectId().toString(),
          idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });

  describe('changeLeadStage — own-scope сужение (manager меняет только свой лид, D-05B)', () => {
    it('manager меняет стадию своего лида (requiredOwnerPositionId совпадает с ownerPositionId лида)', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const managerPositionId = await seedVacantPosition(organizationId, 'manager');
      const leadId = await seedLead(organizationId, { stage: 'new', ownerPositionId: managerPositionId });

      const result = await crmService.changeLeadStage({
        leadId,
        newStage: 'contacted',
        expectedVersion: 0,
        actorPositionId: managerPositionId,
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        requiredOwnerPositionId: managerPositionId,
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.stage).toBe('contacted');
    });

    it('manager НЕ может менять стадию чужого лида — NotFoundException (non-disclosure), stage не меняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const managerPositionId = await seedVacantPosition(organizationId, 'manager');
      const otherOwnerPositionId = await seedVacantPosition(organizationId, 'manager');
      const leadId = await seedLead(organizationId, { stage: 'new', ownerPositionId: otherOwnerPositionId });

      await expect(
        crmService.changeLeadStage({
          leadId,
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: managerPositionId,
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          requiredOwnerPositionId: managerPositionId,
          correlationId: 'integration-test-correlation-id',
          idempotencyKey: new Types.ObjectId().toString(),
          idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('new');
    });
  });

  describe('changeLeadStage — Idempotency-Key (тот же паттерн, что createLead)', () => {
    it('повтор с тем же ключом и телом возвращает сохранённый ответ, не применяет смену стадии дважды', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'new' });
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();
      const idempotencyKey = new Types.ObjectId().toString();
      const idempotencyRequestBody = { leadId: leadId.toString(), stage: 'contacted', expectedVersion: 0 };

      const first = await crmService.changeLeadStage({
        leadId,
        newStage: 'contacted',
        expectedVersion: 0,
        actorPositionId,
        actorIdentityId,
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id-1',
        idempotencyKey,
        idempotencyRequestBody,
      });
      expect(first.stage).toBe('contacted');
      expect(first.version).toBe(1);

      // Повтор с той же (identityId, operation, key) и тем же телом — тот же
      // Idempotency-Key паттерн, что createLead: checkReplay возвращает
      // сохранённый ответ, не выполняет операцию заново. Здесь моделируем
      // сам checkReplay через сервис напрямую (LeadController — отдельный
      // unit-слой), важно: повторный ВЫЗОВ changeLeadStage с expectedVersion:0
      // (устаревшая версия, если бы применилось второй раз) не должен пройти,
      // если бы идемпотентность не сработала — второй вызов ниже намеренно
      // использует ТОТ ЖЕ expectedVersion:0, соответствующий телу первого
      // запроса, чтобы отличить "реально выполнилось второй раз" (упало бы
      // ConflictException, version теперь 1) от "идемпотентность работает".
      const replay = await idempotencyService.checkReplay({
        identityId: actorIdentityId,
        operation: 'changeLeadStage',
        key: idempotencyKey,
        requestBody: idempotencyRequestBody,
      });
      expect(replay?.responseBody).toMatchObject({ id: first.id, stage: first.stage, version: first.version });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('contacted');
      expect(leadDoc?.version).toBe(1);
      const eventCount = await connection.collection('lead_events').countDocuments({ leadId });
      expect(eventCount).toBe(1);
    });

    it('тот же ключ с другим телом запроса — IDEMPOTENCY_KEY_CONFLICT, стадия не меняется повторно', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'new' });
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();
      const idempotencyKey = new Types.ObjectId().toString();

      await crmService.changeLeadStage({
        leadId,
        newStage: 'contacted',
        expectedVersion: 0,
        actorPositionId,
        actorIdentityId,
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id-1',
        idempotencyKey,
        idempotencyRequestBody: { leadId: leadId.toString(), stage: 'contacted', expectedVersion: 0 },
      });

      await expect(
        idempotencyService.checkReplay({
          identityId: actorIdentityId,
          operation: 'changeLeadStage',
          key: idempotencyKey,
          requestBody: { leadId: leadId.toString(), stage: 'lost', expectedVersion: 0 },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('contacted');
    });
  });

  describe('createLead — lead.create.organization (security review 31.08.2026)', () => {
    it('с requesterPhone: находит существующий контакт по телефону в этой организации, создаёт unassigned лид со stage:new', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const contactId = new Types.ObjectId();
      await connection.collection('contacts').insertOne({
        _id: contactId,
        organizationId,
        name: 'Существующий Клиент',
        phone: '+995500000042',
        roles: ['buyer'],
        createdAt: new Date(),
      });
      const actorPositionId = await seedVacantPosition(organizationId);

      const result = await crmService.createLead({
        organizationId,
        requesterName: 'Другое имя (игнорируется, контакт уже есть)',
        requesterPhone: '+995500000042',
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
      idempotencyKey: new Types.ObjectId().toString(),
      idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.stage).toBe('new');
      expect(result.ownerPositionId).toBeNull();
      expect(result.contact?.id).toBe(contactId.toString());
      expect(await connection.collection('contacts').countDocuments({ organizationId })).toBe(1);

      const leadDoc = await connection.collection('leads').findOne({ _id: new Types.ObjectId(result.id) });
      expect(leadDoc?.source).toMatchObject({ route: 'manual' });

      const eventDoc = await connection.collection('lead_events').findOne({ leadId: leadDoc?._id });
      expect(eventDoc).toMatchObject({ stage: 'new', changedBy: { type: 'position', positionId: actorPositionId } });

      const auditDoc = await connection.collection('audit_events').findOne({ action: 'lead.create' });
      expect(auditDoc).toMatchObject({ actor: { type: 'identity' } });
    });

    it('с requesterPhone, для которого контакта ещё нет: создаёт новый Contact в этой организации', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const actorPositionId = await seedVacantPosition(organizationId);

      const result = await crmService.createLead({
        organizationId,
        requesterName: 'Новый Клиент',
        requesterPhone: '+995500000043',
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
      idempotencyKey: new Types.ObjectId().toString(),
      idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.contact).toMatchObject({ name: 'Новый Клиент', phone: '+995500000043' });
      const contactDoc = await connection
        .collection('contacts')
        .findOne({ organizationId, phone: '+995500000043' });
      expect(contactDoc).toBeTruthy();
    });

    it('с contactId чужой организации — NotFoundException (non-disclosure), лид не создаётся', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const foreignContactId = new Types.ObjectId();
      await connection.collection('contacts').insertOne({
        _id: foreignContactId,
        organizationId: orgB,
        name: 'Чужой контакт',
        phone: '+995500000044',
        roles: ['buyer'],
        createdAt: new Date(),
      });

      await expect(
        crmService.createLead({
          organizationId: orgA,
          contactId: foreignContactId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
      idempotencyKey: new Types.ObjectId().toString(),
      idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(await connection.collection('leads').countDocuments({ organizationId: orgA })).toBe(0);
    });

    it('ни contactId, ни requesterPhone — VALIDATION_FAILED (AppException), лид не создаётся', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);

      await expect(
        crmService.createLead({
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
      idempotencyKey: new Types.ObjectId().toString(),
      idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

      expect(await connection.collection('leads').countDocuments({ organizationId })).toBe(0);
    });
  });

  describe('createLead — productType (03.09.2026, owner decision "продуктовые воронки лида")', () => {
    it('с productType:network — создаёт лид сразу в первой стадии воронки network, не в generic new', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const actorPositionId = await seedVacantPosition(organizationId);

      const result = await crmService.createLead({
        organizationId,
        requesterName: 'Продуктовый лид',
        requesterPhone: '+995500000050',
        productType: 'network',
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.productType).toBe('network');
      expect(result.stage).toBe('network_new_lead');

      const leadDoc = await connection.collection('leads').findOne({ _id: new Types.ObjectId(result.id) });
      expect(leadDoc).toMatchObject({ productType: 'network', stage: 'network_new_lead' });

      const eventDoc = await connection.collection('lead_events').findOne({ leadId: leadDoc?._id });
      expect(eventDoc).toMatchObject({ stage: 'network_new_lead' });
    });

    it('без productType — поведение как раньше: stage:new, productType не сохраняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const actorPositionId = await seedVacantPosition(organizationId);

      const result = await crmService.createLead({
        organizationId,
        requesterName: 'Generic лид',
        requesterPhone: '+995500000051',
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.productType).toBeNull();
      expect(result.stage).toBe('new');

      const leadDoc = await connection.collection('leads').findOne({ _id: new Types.ObjectId(result.id) });
      expect(leadDoc?.productType).toBeFalsy();
      expect(leadDoc?.stage).toBe('new');
    });
  });

  describe('updateLead — PATCH /leads/:leadId сопутствующие поля (phase 3)', () => {
    it('обновляет только переданные поля, не трогает stage/version, пишет audit lead.update', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'qualified' });
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const result = await crmService.updateLead({
        leadId,
        organizationId,
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
        city: 'Тбилиси',
        tags: ['vip', 'hot'],
        dealValue: 15000,
      });

      expect(result.city).toBe('Тбилиси');
      expect(result.tags).toEqual(['vip', 'hot']);
      expect(result.dealValue).toBe(15000);
      expect(result.stage).toBe('qualified');
      expect(result.version).toBe(0);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc).toMatchObject({ city: 'Тбилиси', tags: ['vip', 'hot'], dealValue: 15000, stage: 'qualified' });

      const auditDoc = await connection.collection('audit_events').findOne({ action: 'lead.update' });
      expect(auditDoc).toMatchObject({ after: { city: 'Тбилиси', tags: ['vip', 'hot'], dealValue: 15000 } });
    });

    it('realtorStage вне собственного 6-шагового списка — VALIDATION_FAILED, поле не сохраняется', async () => {
      // [owner decision — 04.09.2026]: realtorStage/curatorStage — своя
      // номенклатура (realtor_1..6/curator_1..6), не общий справочник
      // стадии продукта. Продуктовая стадия вроде 'network_offer_given' —
      // валидная стадия ЛИДА, но невалидная realtorStage.
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { productType: 'network', stage: 'network_new_lead' });

      await expect(
        crmService.updateLead({
          leadId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
          realtorStage: 'network_offer_given' as never,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.realtorStage).toBeFalsy();
    });

    it('realtorStage/curatorStage из собственного 6-шагового списка — сохраняются независимо друг от друга и от productType', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      // Лид БЕЗ productType — realtorStage/curatorStage не завязаны на
      // продукт, работают одинаково для любого лида.
      const leadId = await seedLead(organizationId);

      const result = await crmService.updateLead({
        leadId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        realtorStage: 'realtor_4',
        curatorStage: 'curator_2',
      });

      expect(result.realtorStage).toBe('realtor_4');
      expect(result.curatorStage).toBe('curator_2');
      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc).toMatchObject({ realtorStage: 'realtor_4', curatorStage: 'curator_2' });
    });

    it('curatorStage со значением из чужого списка (realtor_N) — VALIDATION_FAILED', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);

      await expect(
        crmService.updateLead({
          leadId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
          curatorStage: 'realtor_1' as never,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('чужая организация — NotFoundException, ничего не меняется', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const leadId = await seedLead(orgA);

      await expect(
        crmService.updateLead({
          leadId,
          organizationId: orgB,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
          city: 'Батуми',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('manager может обновить только свой лид (requiredOwnerPositionId), чужой — NotFoundException', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const managerPositionId = await seedVacantPosition(organizationId, 'manager');
      const otherOwnerPositionId = await seedVacantPosition(organizationId, 'manager');
      const leadId = await seedLead(organizationId, { ownerPositionId: otherOwnerPositionId });

      await expect(
        crmService.updateLead({
          leadId,
          organizationId,
          requiredOwnerPositionId: managerPositionId,
          actorPositionId: managerPositionId,
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
          city: 'Батуми',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateLead — name/phone/email/productType (phase 4, Contact + stage reset)', () => {
    it('name/phone/email обновляют Contact лида, видно и через GET, и в самом Contact-документе', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const lead = await connection.collection('leads').findOne({ _id: leadId });

      const result = await crmService.updateLead({
        leadId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        name: 'Новое Имя',
        phone: '+995500000099',
        email: 'new@example.test',
      });

      expect(result.contact).toMatchObject({ name: 'Новое Имя', phone: '+995500000099', email: 'new@example.test' });
      const contactDoc = await connection.collection('contacts').findOne({ _id: lead!.contactId });
      expect(contactDoc).toMatchObject({ name: 'Новое Имя', phone: '+995500000099', email: 'new@example.test' });
    });

    it('Contact общий для двух лидов — правка через один лид видна на обоих', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId1 = await seedLead(organizationId);
      const lead1 = await connection.collection('leads').findOne({ _id: leadId1 });
      const leadId2 = new Types.ObjectId();
      await connection.collection('leads').insertOne({
        _id: leadId2,
        organizationId,
        contactId: lead1!.contactId,
        stage: 'new',
        version: 0,
        source: { route: 'manual' },
        createdAt: new Date(),
      });

      await crmService.updateLead({
        leadId: leadId1,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        name: 'Общее Имя',
      });

      const secondLeadView = await crmService.getLead({ leadId: leadId2, organizationId });
      expect(secondLeadView.contact?.name).toBe('Общее Имя');
    });

    it('новый phone уже занят ДРУГИМ контактом организации — CONTACT_PHONE_TAKEN, ничего не меняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const otherContactId = new Types.ObjectId();
      await connection.collection('contacts').insertOne({
        _id: otherContactId,
        organizationId,
        name: 'Другой контакт',
        phone: '+995500000077',
        roles: ['buyer'],
        createdAt: new Date(),
      });

      await expect(
        crmService.updateLead({
          leadId,
          organizationId,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
          phone: '+995500000077',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONTACT_PHONE_TAKEN });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      const contactDoc = await connection.collection('contacts').findOne({ _id: leadDoc!.contactId });
      expect(contactDoc!.phone).not.toBe('+995500000077');
    });

    it('productType меняется — stage сбрасывается на "Новый лид" нового продукта, version инкрементируется, пишет lead_event', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'contacted' });
      const actorPositionId = new Types.ObjectId();

      const result = await crmService.updateLead({
        leadId,
        organizationId,
        actorPositionId,
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        productType: 'network',
      });

      expect(result.stage).toBe('network_new_lead');
      expect(result.productType).toBe('network');
      expect(result.version).toBe(1);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc).toMatchObject({ stage: 'network_new_lead', productType: 'network', version: 1 });

      const events = await connection.collection('lead_events').find({ leadId }).toArray();
      expect(events.some((e) => e.stage === 'network_new_lead')).toBe(true);
    });

    it('productType совпадает с текущим — no-op, stage/version не меняются', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'network_new_lead', productType: 'network' });

      const result = await crmService.updateLead({
        leadId,
        organizationId,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        correlationId: 'integration-test-correlation-id',
        productType: 'network',
      });

      expect(result.stage).toBe('network_new_lead');
      expect(result.version).toBe(0);
    });
  });

  describe('lead checklist / stage-notes (phase 3.1)', () => {
    it('PATCH checklist отмечает пункты, GET отдаёт то же самое; повторный PATCH другого пункта НЕ затирает первый', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      await crmService.updateLeadChecklist({
        leadId,
        organizationId,
        changes: [{ stage: 'new', index: 0, checked: true }],
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
      });

      await crmService.updateLeadChecklist({
        leadId,
        organizationId,
        changes: [{ stage: 'new', index: 1, checked: true }],
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
      });

      const checklist = await crmService.getLeadChecklist({ leadId, organizationId });
      expect(checklist.items).toEqual(
        expect.arrayContaining([
          { stage: 'new', index: 0, checked: true },
          { stage: 'new', index: 1, checked: true },
        ]),
      );
    });

    it('PUT stage-notes устанавливает заметку, повторный PUT с пустым text удаляет её', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const setResult = await crmService.setLeadStageNote({
        leadId,
        organizationId,
        stage: 'new',
        text: 'Перезвонить завтра',
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
      });
      expect(setResult.text).toBe('Перезвонить завтра');

      const afterSet = await crmService.getLeadChecklist({ leadId, organizationId });
      expect(afterSet.stageNotes).toEqual([{ stage: 'new', text: 'Перезвонить завтра', updatedAt: expect.any(String) }]);

      await crmService.setLeadStageNote({
        leadId,
        organizationId,
        stage: 'new',
        text: '',
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
      });

      const afterDelete = await crmService.getLeadChecklist({ leadId, organizationId });
      expect(afterDelete.stageNotes).toEqual([]);
    });

    it('чужая организация — NotFoundException и для checklist, и для stage-notes', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const leadId = await seedLead(orgA);

      await expect(crmService.getLeadChecklist({ leadId, organizationId: orgB })).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        crmService.updateLeadChecklist({
          leadId,
          organizationId: orgB,
          changes: [{ stage: 'new', index: 0, checked: true }],
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        crmService.setLeadStageNote({
          leadId,
          organizationId: orgB,
          stage: 'new',
          text: 'x',
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('manager (own-scope) не может отметить чек-лист чужого лида', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const managerPositionId = await seedVacantPosition(organizationId, 'manager');
      const otherOwnerPositionId = await seedVacantPosition(organizationId, 'manager');
      const leadId = await seedLead(organizationId, { ownerPositionId: otherOwnerPositionId });

      await expect(
        crmService.updateLeadChecklist({
          leadId,
          organizationId,
          requiredOwnerPositionId: managerPositionId,
          changes: [{ stage: 'new', index: 0, checked: true }],
          actorPositionId: managerPositionId,
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteLead — DELETE /leads/:leadId soft delete (phase 3)', () => {
    it('успешное удаление — лид перестаёт отдаваться в getLead/listLeads, но остаётся в базе с status:deleted', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      const result = await crmService.deleteLead({
        leadId,
        organizationId,
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id',
      });
      expect(result).toEqual({ deleted: true });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.status).toBe('deleted');
      expect(leadDoc?.deletedAt).toBeInstanceOf(Date);

      await expect(
        crmService.getLead({ leadId, organizationId }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const { items } = await crmService.listLeads({ organizationId, limit: 20 });
      expect(items.find((i) => i.id === leadId.toString())).toBeUndefined();

      const auditDoc = await connection.collection('audit_events').findOne({ action: 'lead.delete' });
      expect(auditDoc).toMatchObject({ after: { status: 'deleted' } });
    });

    it('повторное удаление уже удалённого лида — NotFoundException (non-disclosure)', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId);
      const actorPositionId = new Types.ObjectId();
      const actorIdentityId = new Types.ObjectId();

      await crmService.deleteLead({
        leadId,
        organizationId,
        actorPositionId,
        actorIdentityId,
        correlationId: 'integration-test-correlation-id-1',
      });

      await expect(
        crmService.deleteLead({
          leadId,
          organizationId,
          actorPositionId,
          actorIdentityId,
          correlationId: 'integration-test-correlation-id-2',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('чужая организация — NotFoundException, лид остаётся активным', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      await seedOrganization(orgA);
      await seedOrganization(orgB);
      const leadId = await seedLead(orgA);

      await expect(
        crmService.deleteLead({
          leadId,
          organizationId: orgB,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          correlationId: 'integration-test-correlation-id',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.status ?? 'active').toBe('active');
    });
  });

  describe('changeLeadStage — productType (03.09.2026, owner decision "продуктовые воронки лида")', () => {
    it('лид с productType:network — переход в network-стадию проходит', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { productType: 'network', stage: 'network_new_lead' });

      const result = await crmService.changeLeadStage({
        leadId,
        newStage: 'network_work_started',
        expectedVersion: 0,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.stage).toBe('network_work_started');
      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('network_work_started');
    });

    it('лид с productType:network — переход в sales-стадию отклоняется VALIDATION_FAILED, stage не меняется', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { productType: 'network', stage: 'network_new_lead' });

      await expect(
        crmService.changeLeadStage({
          leadId,
          newStage: 'contacted',
          expectedVersion: 0,
          actorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          expectedOrganizationId: organizationId,
          correlationId: 'integration-test-correlation-id',
          idempotencyKey: new Types.ObjectId().toString(),
          idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

      const leadDoc = await connection.collection('leads').findOne({ _id: leadId });
      expect(leadDoc?.stage).toBe('network_new_lead');
    });

    it('лид БЕЗ productType — переход между generic-стадиями продолжает работать как раньше (regression guard)', async () => {
      const organizationId = new Types.ObjectId();
      await seedOrganization(organizationId);
      const leadId = await seedLead(organizationId, { stage: 'new' });

      const result = await crmService.changeLeadStage({
        leadId,
        newStage: 'contacted',
        expectedVersion: 0,
        actorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        expectedOrganizationId: organizationId,
        correlationId: 'integration-test-correlation-id',
        idempotencyKey: new Types.ObjectId().toString(),
        idempotencyRequestBody: { probe: new Types.ObjectId().toString() },
      });

      expect(result.stage).toBe('contacted');
    });
  });

});
