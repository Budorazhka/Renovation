import { Types } from 'mongoose';
import { TaskRepository } from './task.repository';

describe('TaskRepository', () => {
  describe('create', () => {
    it('creates task document with organizationId, title, status and passes session', async () => {
      const organizationId = new Types.ObjectId();
      const createdTask = { _id: new Types.ObjectId(), organizationId, title: 'Call client', status: 'open' };
      const fakeSession = {} as never;
      const createSpy = jest.fn().mockResolvedValue([createdTask]);
      const repository = new TaskRepository({ create: createSpy } as never);

      const result = await repository.create(
        {
          organizationId,
          title: 'Call client',
          description: 'Discuss options',
          status: 'open',
        },
        fakeSession,
      );

      expect(createSpy).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            organizationId,
            title: 'Call client',
            description: 'Discuss options',
            status: 'open',
          }),
        ],
        { session: fakeSession },
      );
      expect(result).toEqual(createdTask);
    });

    it('передаёт taskType в docData, только если оно пришло', async () => {
      const organizationId = new Types.ObjectId();
      const createdTask = { _id: new Types.ObjectId(), organizationId, title: 'Call client', status: 'open' };
      const createSpy = jest.fn().mockResolvedValue([createdTask]);
      const repository = new TaskRepository({ create: createSpy } as never);

      await repository.create({ organizationId, title: 'Call client', taskType: 'meeting' });

      expect(createSpy).toHaveBeenCalledWith(
        [expect.objectContaining({ taskType: 'meeting' })],
        { session: undefined },
      );
    });
  });

  describe('findByIdForOrganization', () => {
    it('applies organizationId in filter for tenant isolation', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ _id: id });
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ findOne: findOneSpy } as never);

      const res = await repository.findByIdForOrganization(id, organizationId);

      expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId });
      expect(res).toEqual({ _id: id });
    });

    it('applies assignedPositionId in filter for own-scope scoping', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const assignedPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ _id: id });
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ findOne: findOneSpy } as never);

      await repository.findByIdForOrganization(id, organizationId, assignedPositionId);

      expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId, assignedPositionId });
    });

    it('passes session to findOne when provided', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ _id: id });
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ findOne: findOneSpy } as never);

      await repository.findByIdForOrganization(id, organizationId, undefined, fakeSession);

      expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId }, null, { session: fakeSession });
    });

    // ИСПРАВЛЕНО 11.09.2026 (task-model-audit-followup.md): callerPositionId
    // — новый необязательный последний параметр, не передаётся путями записи
    // (только getTask) — см. докстринг у самого метода.
    it('applies personal-task visibility $or only when callerPositionId is passed', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const callerPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ _id: id });
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ findOne: findOneSpy } as never);

      await repository.findByIdForOrganization(id, organizationId, undefined, undefined, callerPositionId);

      expect(findOneSpy).toHaveBeenCalledWith({
        _id: id,
        organizationId,
        $or: [{ taskCategory: { $ne: 'personal' } }, { assignedPositionId: callerPositionId }],
      });
    });
  });

  describe('listForOrganization', () => {
    it('applies filters, cursor and limit with newest-first sort', async () => {
      const organizationId = new Types.ObjectId();
      const cursor = new Types.ObjectId();
      const assignedPositionId = new Types.ObjectId();
      const callerPositionId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const dueBefore = new Date();

      const execSpy = jest.fn().mockResolvedValue([]);
      const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
      const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
      const repository = new TaskRepository({ find: findSpy } as never);

      await repository.listForOrganization(organizationId, {
        assignedPositionId,
        callerPositionId,
        leadId,
        status: 'open',
        dueBefore,
        cursor,
        limit: 21,
      });

      expect(findSpy).toHaveBeenCalledWith({
        organizationId,
        _id: { $lt: cursor },
        status: 'open',
        assignedPositionId,
        leadId,
        dueAt: { $lte: dueBefore },
        $or: [{ taskCategory: { $ne: 'personal' } }, { assignedPositionId: callerPositionId }],
      });
      expect(sortSpy).toHaveBeenCalledWith({ _id: -1 });
      expect(limitSpy).toHaveBeenCalledWith(21);
    });

    // ИСПРАВЛЕНО 11.09.2026 (task-model-audit-followup.md, седьмое
    // наблюдение аудита): личные задачи чужого исполнителя видимы не были —
    // сервер отдавал их целиком, видимость держал только клиент.
    it('исключает чужие personal-задачи даже без own-scope сужения (organization-scope грант)', async () => {
      const organizationId = new Types.ObjectId();
      const callerPositionId = new Types.ObjectId();

      const execSpy = jest.fn().mockResolvedValue([]);
      const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
      const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
      const repository = new TaskRepository({ find: findSpy } as never);

      // Нет assignedPositionId — organization-scope грант, весь список
      // организации без own-сужения.
      await repository.listForOrganization(organizationId, { callerPositionId, limit: 50 });

      expect(findSpy).toHaveBeenCalledWith({
        organizationId,
        $or: [{ taskCategory: { $ne: 'personal' } }, { assignedPositionId: callerPositionId }],
      });
    });
  });

  describe('updateTask', () => {
    it('фильтр включает organizationId И version:expectedVersion (CAS), $inc version:1', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 3, { title: 'Новое название' }, fakeSession);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 3 },
        { $inc: { version: 1 }, $set: { title: 'Новое название' } },
        { session: fakeSession },
      );
    });

    it('устаревшая version — modifiedCount:0, не бросает здесь (CrmService решает 409)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 0 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      const result = await repository.updateTask(id, organizationId, 5, { title: 'x' });

      expect(result).toEqual({ modifiedCount: 0 });
    });

    it('isUrgent/isImportant/taskCategory/taskType/attachments — прямой $set', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const assetId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, {
        isUrgent: true,
        isImportant: false,
        taskCategory: 'personal',
        taskType: 'call',
        attachments: [{ assetId, fileName: 'file.pdf' }],
      });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        {
          $inc: { version: 1 },
          $set: {
            isUrgent: true,
            isImportant: false,
            taskCategory: 'personal',
            taskType: 'call',
            attachments: [{ assetId, fileName: 'file.pdf' }],
          },
        },
        { session: undefined },
      );
    });

    it('colorHex:null — $set напрямую (default схемы — null, не $unset)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, { colorHex: null });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        { $inc: { version: 1 }, $set: { colorHex: null } },
        { session: undefined },
      );
    });

    it('colorHex:значение — $set напрямую', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, { colorHex: '#ff0000' });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        { $inc: { version: 1 }, $set: { colorHex: '#ff0000' } },
        { session: undefined },
      );
    });

    it('startAt:null — $unset (нет default в схеме)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, { startAt: null });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        { $inc: { version: 1 }, $unset: { startAt: 1 } },
        { session: undefined },
      );
    });

    it('startAt:значение — $set', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const startAt = new Date();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, { startAt });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        { $inc: { version: 1 }, $set: { startAt } },
        { session: undefined },
      );
    });

    it('leadId:null и contactId:null — оба $unset (отвязка лида)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, { leadId: null, contactId: null });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        { $inc: { version: 1 }, $unset: { leadId: 1, contactId: 1 } },
        { session: undefined },
      );
    });

    it('leadId и contactId заданы — оба $set (привязка лида)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const contactId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.updateTask(id, organizationId, 1, { leadId, contactId });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 1 },
        { $inc: { version: 1 }, $set: { leadId, contactId } },
        { session: undefined },
      );
    });
  });

  describe('reassignTask', () => {
    it('assignedPositionId задан — $set + $inc version', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const assignedPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.reassignTask(id, organizationId, 2, assignedPositionId);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 2 },
        { $set: { assignedPositionId }, $inc: { version: 1 } },
        { session: undefined },
      );
    });

    it('assignedPositionId:null — $unset + $inc version (снятие назначения)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      await repository.reassignTask(id, organizationId, 2, null);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 2 },
        { $unset: { assignedPositionId: 1 }, $inc: { version: 1 } },
        { session: undefined },
      );
    });
  });

  describe('completeTask', () => {
    it('фильтр включает version:expectedVersion (CAS), устанавливает status/completedAt/completedByPositionId, $inc version', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const completedByPositionId = new Types.ObjectId();
      const fakeSession = {} as never;

      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ updateOne: updateOneSpy } as never);

      const res = await repository.completeTask(id, organizationId, 4, completedByPositionId, fakeSession);

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, version: 4 },
        {
          $set: {
            status: 'completed',
            completedAt: expect.any(Date),
            completedByPositionId,
          },
          $inc: { version: 1 },
        },
        { session: fakeSession },
      );
      expect(res).toEqual({ modifiedCount: 1 });
    });
  });

  describe('countOpenForLead', () => {
    it('считает незавершённые задачи лида: и открытые, и взятые в работу', async () => {
      const organizationId = new Types.ObjectId();
      const leadId = new Types.ObjectId();

      const execSpy = jest.fn().mockResolvedValue(2);
      const countDocumentsSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ countDocuments: countDocumentsSpy } as never);

      const count = await repository.countOpenForLead(organizationId, leadId);

      // Именно оба статуса: задача, за которую взялись, остаётся следующим
      // действием лида — иначе признак гас бы при начале работы над ней.
      expect(countDocumentsSpy).toHaveBeenCalledWith({
        organizationId,
        leadId,
        status: { $in: ['open', 'in_progress'] },
      });
      expect(count).toBe(2);
    });
  });

  describe('distinctLeadIdsWithOpenTask', () => {
    it('пустой leadIds — [] без похода в базу', async () => {
      const organizationId = new Types.ObjectId();
      const distinctSpy = jest.fn();
      const repository = new TaskRepository({ distinct: distinctSpy } as never);

      const result = await repository.distinctLeadIdsWithOpenTask(organizationId, []);

      expect(result).toEqual([]);
      expect(distinctSpy).not.toHaveBeenCalled();
    });

    it('фильтр включает organizationId, leadId:{$in} и оба незавершённых статуса', async () => {
      const organizationId = new Types.ObjectId();
      const leadIds = [new Types.ObjectId(), new Types.ObjectId()];
      const execSpy = jest.fn().mockResolvedValue([leadIds[0]]);
      const distinctSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new TaskRepository({ distinct: distinctSpy } as never);

      const result = await repository.distinctLeadIdsWithOpenTask(organizationId, leadIds);

      expect(distinctSpy).toHaveBeenCalledWith('leadId', {
        organizationId,
        leadId: { $in: leadIds },
        status: { $in: ['open', 'in_progress'] },
      });
      expect(result).toEqual([leadIds[0]]);
    });
  });
});
