import { Types } from 'mongoose';
import { LeadRepository } from './lead.repository';

describe('LeadRepository', () => {
  describe('distinctContactIdsForOwner', () => {
    it('фильтр включает organizationId И ownerPositionId, distinct по contactId', async () => {
      const organizationId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const distinctSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ distinct: distinctSpy } as never);

      await repository.distinctContactIdsForOwner(organizationId, ownerPositionId);

      expect(distinctSpy).toHaveBeenCalledWith('contactId', { organizationId, ownerPositionId });
    });
  });

  describe('assignOwner', () => {
    it('фильтр включает organizationId, не только _id — tenant-escape защита', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.assignOwner(id, organizationId, ownerPositionId);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId },
        { $set: { ownerPositionId } },
        { session: undefined },
      );
    });

    /**
     * Реальный найденный баг (second-opinion ревью): assignLead вызывал
     * assignOwner БЕЗ session внутри runInTransaction — запись владельца
     * лида не откатывалась при откате транзакции, хотя audit/event писались
     * откаченными. Эта проверка защищает от регрессии.
     */
    it('передаёт session дальше в updateOne — write остаётся частью transaction', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.assignOwner(id, organizationId, ownerPositionId, fakeSession);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId },
        { $set: { ownerPositionId } },
        { session: fakeSession },
      );
    });
  });

  describe('changeStageWithVersionCheck', () => {
    it('фильтр включает organizationId, version и allowedFromStages — tenant-escape + optimistic concurrency защита', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.changeStageWithVersionCheck(id, organizationId, 3, 'qualified', ['contacted'], fakeSession);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 3, stage: { $in: ['contacted'] } },
        { $set: { stage: 'qualified' }, $inc: { version: 1 } },
        { session: fakeSession },
      );
    });
  });

  describe('listForOrganization', () => {
    it('без cursor — match без _id, сортировка по _id desc, lookup openTasks', async () => {
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const aggregateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ aggregate: aggregateSpy } as never);

      await repository.listForOrganization(organizationId, { limit: 21 });

      expect(aggregateSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          { $match: { organizationId, status: { $ne: 'deleted' } } },
          { $sort: { _id: -1 } },
          { $limit: 21 },
          expect.objectContaining({ $lookup: expect.anything() }),
        ]),
      );
    });

    it('с cursor — match включает _id: {$lt: cursor}', async () => {
      const organizationId = new Types.ObjectId();
      const cursor = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const aggregateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ aggregate: aggregateSpy } as never);

      await repository.listForOrganization(organizationId, { cursor, limit: 21 });

      expect(aggregateSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          { $match: { organizationId, status: { $ne: 'deleted' }, _id: { $lt: cursor } } },
          { $sort: { _id: -1 } },
        ]),
      );
    });

    it('фильтр stalled:true добавляет match { stalled: true } после вычисления', async () => {
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const aggregateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ aggregate: aggregateSpy } as never);

      await repository.listForOrganization(organizationId, { stalled: true, limit: 21 });

      expect(aggregateSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          { $match: { stalled: true } },
          { $limit: 21 },
        ]),
      );
    });
  });

  describe('findLeadIdsForContact', () => {
    it('returns distinct lead IDs for contact and optional ownerPositionId', async () => {
      const organizationId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const ownerPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const distinctSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ distinct: distinctSpy } as never);

      await repository.findLeadIdsForContact(organizationId, contactId, ownerPositionId);

      expect(distinctSpy).toHaveBeenCalledWith('_id', { organizationId, contactId, ownerPositionId });
    });
  });

  describe('create', () => {
    it('без явного stage — инициализирует stage:new (generic-путь по умолчанию)', async () => {
      const createSpy = jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]);
      const repository = new LeadRepository({ create: createSpy } as never);

      await repository.create({
        organizationId: new Types.ObjectId(),
        contactId: new Types.ObjectId(),
        source: { route: '/developments/zhk-solnechnyy' },
      });

      expect(createSpy).toHaveBeenCalledWith([expect.objectContaining({ stage: 'new' })], { session: undefined });
    });

    it('с явным stage/productType — сохраняет ровно то, что передал вызывающий (продуктовые воронки лида)', async () => {
      const createSpy = jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]);
      const repository = new LeadRepository({ create: createSpy } as never);

      await repository.create({
        organizationId: new Types.ObjectId(),
        contactId: new Types.ObjectId(),
        source: { route: 'manual' },
        productType: 'network',
        stage: 'network_rejected_defective',
      });

      expect(createSpy).toHaveBeenCalledWith(
        [expect.objectContaining({ productType: 'network', stage: 'network_rejected_defective' })],
        { session: undefined },
      );
    });
  });

  describe('aggregateByOwnerPosition', () => {
    it('без from/to — match содержит organizationId и исключает deleted, группировка по (ownerPositionId, stage)', async () => {
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue([]);
      const aggregateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ aggregate: aggregateSpy } as never);

      await repository.aggregateByOwnerPosition(organizationId, {});

      expect(aggregateSpy).toHaveBeenCalledWith([
        { $match: { organizationId, status: { $ne: 'deleted' } } },
        {
          $group: {
            _id: { ownerPositionId: { $ifNull: ['$ownerPositionId', null] }, stage: '$stage' },
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0, ownerPositionId: '$_id.ownerPositionId', stage: '$_id.stage', count: 1 } },
      ]);
    });

    it('from/to собираются в один $match.createdAt', async () => {
      const organizationId = new Types.ObjectId();
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-02-01T00:00:00.000Z');
      const execSpy = jest.fn().mockResolvedValue([]);
      const aggregateSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ aggregate: aggregateSpy } as never);

      await repository.aggregateByOwnerPosition(organizationId, { from, to });

      expect(aggregateSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          { $match: { organizationId, status: { $ne: 'deleted' }, createdAt: { $gte: from, $lte: to } } },
        ]),
      );
    });
  });

  describe('updateFieldsWithProductReset', () => {
    it('фильтр включает organizationId, $set объединяет обычные поля и productType/stage, $inc version:1', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.updateFieldsWithProductReset(
        id,
        organizationId,
        { city: 'Батуми' },
        { productType: 'network', stage: 'network_new_lead' },
        fakeSession,
      );

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $set: { city: 'Батуми', productType: 'network', stage: 'network_new_lead' }, $inc: { version: 1 } },
        { session: fakeSession },
      );
    });
  });

  describe('updateChecklist', () => {
    it('фильтр включает organizationId, каждое изменение — свой dot-path ключ в $set', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.updateChecklist(id, organizationId, [
        { key: 'new:0', checked: true },
        { key: 'contacted:3', checked: false },
      ]);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $set: { 'checklist.new:0': true, 'checklist.contacted:3': false } },
        { session: undefined },
      );
    });
  });

  describe('setStageNote', () => {
    it('note задан — $set по dot-path checklist.stageNotes.<stage>', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const updatedAt = new Date('2026-09-14T10:00:00.000Z');
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.setStageNote(id, organizationId, 'new', { text: 'Перезвонить', updatedAt });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $set: { 'stageNotes.new': { text: 'Перезвонить', updatedAt } } },
        { session: undefined },
      );
    });

    it('note: null — $unset по тому же ключу (удаление заметки)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new LeadRepository({ updateOne: updateOneSpy } as never);

      await repository.setStageNote(id, organizationId, 'new', null);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, status: { $ne: 'deleted' } },
        { $unset: { 'stageNotes.new': '' } },
        { session: undefined },
      );
    });
  });

  describe('create — legacy-base-import поля', () => {
    it('telegram/whatsapp/notes/tags/lastContactAt проходят как есть', async () => {
      const organizationId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const lastContactAt = new Date('2026-01-01T00:00:00.000Z');
      const createSpy = jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]);
      const repository = new LeadRepository({ create: createSpy } as never);

      await repository.create({
        organizationId,
        contactId,
        source: { route: 'import' },
        telegram: '@ivan',
        whatsapp: '+995500000001',
        notes: 'из старой базы',
        tags: ['old_base'],
        lastContactAt,
      });

      expect(createSpy).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            telegram: '@ivan',
            whatsapp: '+995500000001',
            notes: 'из старой базы',
            tags: ['old_base'],
            lastContactAt,
            stage: 'new',
          }),
        ],
        { session: undefined },
      );
    });
  });
});
