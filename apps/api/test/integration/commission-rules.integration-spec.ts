import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DevelopmentRepository } from '@baza/development';
import { DevelopmentsModule } from '../../src/modules/developments/developments.module';
import { DevelopmentsService } from '../../src/modules/developments/developments.service';
import { CommissionRuleRepository } from '../../src/modules/developments/repository/commission-rule.repository';

describe('CommissionRules — integration tests (real MongoDB & transactions)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let developmentsService: DevelopmentsService;
  let developmentRepository: DevelopmentRepository;
  let commissionRuleRepository: CommissionRuleRepository;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();

    process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY ??= 'test-access-key';
    process.env.MINIO_SECRET_KEY ??= 'test-secret-key';
    process.env.MINIO_BUCKET_PRIVATE ??= 'test-private';
    process.env.MINIO_BUCKET_PUBLIC ??= 'test-public';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), MongooseModule.forRoot(uri), DevelopmentsModule],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    developmentsService = moduleRef.get(DevelopmentsService);
    developmentRepository = moduleRef.get(DevelopmentRepository);
    commissionRuleRepository = moduleRef.get(CommissionRuleRepository);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  afterEach(async () => {
    await connection.collection('developments').deleteMany({});
    await connection.collection('commission_rules').deleteMany({});
    await connection.collection('idempotency_records').deleteMany({});
  });

  async function seedDevelopment(organizationId: Types.ObjectId) {
    return developmentRepository.create({
      organizationId,
      name: 'ЖК Батуми Резиденс',
      location: {
        country: 'GE',
        city: 'Batumi',
        address: 'Rustaveli 1',
        geo: { type: 'Point', coordinates: [41.6, 41.6] },
      },
      contact: { phone: '+995555123456' },
    });
  }

  describe('createCommissionRule & idempotency', () => {
    it('создаёт правило комиссии с версией 0 и сохраняет idempotency record', async () => {
      const orgId = new Types.ObjectId();
      const identityId = new Types.ObjectId();
      const dev = await seedDevelopment(orgId);

      const rule = await developmentsService.createCommissionRule({
        developmentId: dev._id,
        organizationId: orgId,
        partnerType: 'Агентство-партнёр',
        commissionPercent: 3.5,
        idempotency: {
          identityId,
          operation: 'devCreateCommissionRule',
          key: 'key-1',
          requestBody: { partnerType: 'Агентство-партнёр' },
        },
      });

      expect(rule).toBeDefined();
      expect(rule.partnerType).toBe('Агентство-партнёр');
      expect(rule.commissionPercent).toBe(3.5);
      expect(rule.version).toBe(0);

      // Повторный checkCreateReplay с тем же ключом возвращает записанный ответ
      const replay = await developmentsService.checkCreateReplay(
        identityId,
        'devCreateCommissionRule',
        'key-1',
        { partnerType: 'Агентство-партнёр' },
      );
      expect(replay).not.toBeNull();
      expect(replay!.responseStatus).toBe(201);
    });

    it('отклоняет создание, если ЖК не существует или принадлежит чужой организации', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const devA = await seedDevelopment(orgA);

      await expect(
        developmentsService.createCommissionRule({
          developmentId: devA._id,
          organizationId: orgB, // чужая организация
          partnerType: 'Попытка взлома',
          commissionPercent: 50,
          idempotency: {
            identityId: new Types.ObjectId(),
            operation: 'devCreateCommissionRule',
            key: 'hack-key',
            requestBody: {},
          },
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listCommissionRules & multi-tenant isolation', () => {
    it('возвращает только правила своей организации для данного ЖК', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const devA = await seedDevelopment(orgA);

      await developmentsService.createCommissionRule({
        developmentId: devA._id,
        organizationId: orgA,
        partnerType: 'Агентство-партнёр',
        commissionPercent: 3,
        idempotency: {
          identityId: new Types.ObjectId(),
          operation: 'devCreateCommissionRule',
          key: 'k-a1',
          requestBody: {},
        },
      });

      await developmentsService.createCommissionRule({
        developmentId: devA._id,
        organizationId: orgA,
        partnerType: 'Внутренняя команда',
        commissionPercent: 5,
        idempotency: {
          identityId: new Types.ObjectId(),
          operation: 'devCreateCommissionRule',
          key: 'k-a2',
          requestBody: {},
        },
      });

      const rulesA = await developmentsService.listCommissionRules(devA._id, orgA);
      expect(rulesA).toHaveLength(2);
      expect(rulesA.map((r) => r.partnerType).sort()).toEqual(['Агентство-партнёр', 'Внутренняя команда'].sort());

      // Чужая организация orgB не может прочитать правила ЖК devA
      await expect(developmentsService.listCommissionRules(devA._id, orgB)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateCommissionRule & optimistic concurrency', () => {
    it('успешно обновляет поля и инкрементирует версию при совпадении expectedVersion', async () => {
      const orgId = new Types.ObjectId();
      const identityId = new Types.ObjectId();
      const dev = await seedDevelopment(orgId);

      const created = await developmentsService.createCommissionRule({
        developmentId: dev._id,
        organizationId: orgId,
        partnerType: 'Агентство-партнёр',
        commissionPercent: 3,
        idempotency: {
          identityId,
          operation: 'devCreateCommissionRule',
          key: 'k-upd-1',
          requestBody: {},
        },
      });

      expect(created.version).toBe(0);

      const updated = await developmentsService.updateCommissionRule({
        id: created._id,
        developmentId: dev._id,
        organizationId: orgId,
        expectedVersion: 0,
        patch: { partnerType: 'Внутренняя команда', commissionPercent: 4.5 },
        idempotency: {
          identityId,
          operation: 'devUpdateCommissionRule',
          key: 'k-upd-2',
          requestBody: {},
        },
      });

      expect(updated.partnerType).toBe('Внутренняя команда');
      expect(updated.commissionPercent).toBe(4.5);
      expect(updated.version).toBe(1);

      // Вторая попытка с устаревшей expectedVersion: 0 выбрасывает ConflictException (409)
      await expect(
        developmentsService.updateCommissionRule({
          id: created._id,
          developmentId: dev._id,
          organizationId: orgId,
          expectedVersion: 0,
          patch: { commissionPercent: 99 },
          idempotency: {
            identityId,
            operation: 'devUpdateCommissionRule',
            key: 'k-upd-conflict',
            requestBody: {},
          },
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteCommissionRule & version conflict', () => {
    it('удаляет правило при совпадении expectedVersion и блокирует повторное/устаревшее удаление', async () => {
      const orgId = new Types.ObjectId();
      const identityId = new Types.ObjectId();
      const dev = await seedDevelopment(orgId);

      const created = await developmentsService.createCommissionRule({
        developmentId: dev._id,
        organizationId: orgId,
        partnerType: 'Удаляемое правило',
        commissionPercent: 2,
        idempotency: {
          identityId,
          operation: 'devCreateCommissionRule',
          key: 'k-del-1',
          requestBody: {},
        },
      });

      // Попытка удалить с неверной версией (например, 1 вместо 0) -> 409
      await expect(
        developmentsService.deleteCommissionRule({
          id: created._id,
          developmentId: dev._id,
          organizationId: orgId,
          expectedVersion: 1,
          idempotency: {
            identityId,
            operation: 'devDeleteCommissionRule',
            key: 'k-del-wrong-ver',
            requestBody: {},
          },
        }),
      ).rejects.toThrow(ConflictException);

      // Удаление с верной версией (0)
      await developmentsService.deleteCommissionRule({
        id: created._id,
        developmentId: dev._id,
        organizationId: orgId,
        expectedVersion: 0,
        idempotency: {
          identityId,
          operation: 'devDeleteCommissionRule',
          key: 'k-del-ok',
          requestBody: {},
        },
      });

      // Правило больше не находится в БД
      const inDb = await commissionRuleRepository.findByIdForOrganization(created._id, orgId);
      expect(inDb).toBeNull();
    });
  });
});
