import { Types } from 'mongoose';
import { CommissionRuleRepository } from './commission-rule.repository';

describe('CommissionRuleRepository', () => {
  describe('create', () => {
    it('создаёт правило комиссии с версией 0', async () => {
      const mockDoc = { id: 'rule-1' };
      const createSpy = jest.fn().mockResolvedValue([mockDoc]);
      const mockModel = { create: createSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      const params = {
        organizationId: new Types.ObjectId(),
        developmentId: new Types.ObjectId(),
        partnerType: 'Агентство-партнёр',
        commissionPercent: 3.5,
      };

      const result = await repository.create(params);

      expect(createSpy).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            ...params,
            version: 0,
          }),
        ],
        { session: undefined },
      );
      expect(result).toBe(mockDoc);
    });
  });

  describe('findByIdForOrganization', () => {
    it('фильтрует по _id и organizationId (tenant isolation)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue(null);
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const mockModel = { findOne: findOneSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      await repository.findByIdForOrganization(id, organizationId);

      expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId });
    });
  });

  describe('listForDevelopment', () => {
    it('фильтрует по developmentId и organizationId со стабильной сортировкой', async () => {
      const developmentId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const sortSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
      const mockModel = { find: findSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      await repository.listForDevelopment(developmentId, organizationId);

      expect(findSpy).toHaveBeenCalledWith({ developmentId, organizationId });
      expect(sortSpy).toHaveBeenCalledWith({ createdAt: 1 });
    });
  });

  describe('updateWithVersionCheck', () => {
    it('выполняет CAS-обновление с проверкой expectedVersion и инкрементом version', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ id: 'updated' });
      const findOneAndUpdateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const mockModel = { findOneAndUpdate: findOneAndUpdateSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      const patch = { partnerType: 'Внутренняя команда', commissionPercent: 5 };

      await repository.updateWithVersionCheck(id, organizationId, 2, patch);

      expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 2 },
        { $set: patch, $inc: { version: 1 } },
        { new: true, session: undefined },
      );
    });

    it('возвращает null при несовпадении версии (конфликт)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue(null);
      const findOneAndUpdateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const mockModel = { findOneAndUpdate: findOneAndUpdateSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      const result = await repository.updateWithVersionCheck(id, organizationId, 1, { commissionPercent: 10 });

      expect(result).toBeNull();
    });
  });

  describe('deleteWithVersionCheck', () => {
    it('удаляет запись с проверкой expectedVersion и возвращает true при успехе', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ deletedCount: 1 });
      const deleteOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const mockModel = { deleteOne: deleteOneSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      const success = await repository.deleteWithVersionCheck(id, organizationId, 0);

      expect(deleteOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 0 },
        { session: undefined },
      );
      expect(success).toBe(true);
    });

    it('возвращает false, если deletedCount === 0 (версия не совпала или запись отсутствует)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ deletedCount: 0 });
      const deleteOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const mockModel = { deleteOne: deleteOneSpy };

      const repository = new CommissionRuleRepository(mockModel as never);
      const success = await repository.deleteWithVersionCheck(id, organizationId, 5);

      expect(success).toBe(false);
    });
  });
});
