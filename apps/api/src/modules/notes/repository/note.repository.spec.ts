import { Types } from 'mongoose';
import { NoteRepository } from './note.repository';

describe('NoteRepository', () => {
  describe('create', () => {
    it('creates note document with organizationId, authorPositionId, title and passes session', async () => {
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const createdNote = { _id: new Types.ObjectId(), organizationId, authorPositionId, title: 'Позвонить клиенту' };
      const fakeSession = {} as never;
      const createSpy = jest.fn().mockResolvedValue([createdNote]);
      const repository = new NoteRepository({ create: createSpy } as never);

      const result = await repository.create(
        { organizationId, authorPositionId, title: 'Позвонить клиенту', content: 'Уточнить бюджет' },
        fakeSession,
      );

      expect(createSpy).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            organizationId,
            authorPositionId,
            title: 'Позвонить клиенту',
            content: 'Уточнить бюджет',
          }),
        ],
        { session: fakeSession },
      );
      expect(result).toEqual(createdNote);
    });
  });

  describe('findByIdForOwner', () => {
    it('фильтр включает organizationId И authorPositionId', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ _id: id });
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ findOne: findOneSpy } as never);

      const res = await repository.findByIdForOwner(id, organizationId, authorPositionId);

      expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId, authorPositionId });
      expect(res).toEqual({ _id: id });
    });

    it('передаёт session, если он есть', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ _id: id });
      const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ findOne: findOneSpy } as never);

      await repository.findByIdForOwner(id, organizationId, authorPositionId, fakeSession);

      expect(findOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, authorPositionId },
        null,
        { session: fakeSession },
      );
    });
  });

  describe('listForOwner', () => {
    it('фильтр включает organizationId, authorPositionId, cursor и leadId, newest-first', async () => {
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const cursor = new Types.ObjectId();
      const leadId = new Types.ObjectId();

      const execSpy = jest.fn().mockResolvedValue([]);
      const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
      const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
      const repository = new NoteRepository({ find: findSpy } as never);

      await repository.listForOwner(organizationId, authorPositionId, { leadId, cursor, limit: 51 });

      expect(findSpy).toHaveBeenCalledWith({
        organizationId,
        authorPositionId,
        _id: { $lt: cursor },
        leadId,
      });
      expect(sortSpy).toHaveBeenCalledWith({ _id: -1 });
      expect(limitSpy).toHaveBeenCalledWith(51);
    });

    it('без cursor/leadId — фильтр только по organizationId/authorPositionId', async () => {
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();

      const execSpy = jest.fn().mockResolvedValue([]);
      const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
      const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
      const repository = new NoteRepository({ find: findSpy } as never);

      await repository.listForOwner(organizationId, authorPositionId, { limit: 51 });

      expect(findSpy).toHaveBeenCalledWith({ organizationId, authorPositionId });
    });
  });

  describe('updateWithVersionCheck', () => {
    it('фильтр включает organizationId, authorPositionId И version:expectedVersion (CAS), $inc version:1', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ updateOne: updateOneSpy } as never);

      await repository.updateWithVersionCheck(
        id,
        organizationId,
        authorPositionId,
        3,
        { title: 'Новый заголовок' },
        fakeSession,
      );

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, authorPositionId, version: 3 },
        { $inc: { version: 1 }, $set: { title: 'Новый заголовок' } },
        { session: fakeSession },
      );
    });

    it('leadId:null — $unset leadId, не $set', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ updateOne: updateOneSpy } as never);

      await repository.updateWithVersionCheck(id, organizationId, authorPositionId, 0, { leadId: null });

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, authorPositionId, version: 0 },
        { $inc: { version: 1 }, $unset: { leadId: 1 } },
        { session: undefined },
      );
    });

    it('устаревшая version — modifiedCount:0, не бросает здесь (NotesService решает 409)', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 0 });
      const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ updateOne: updateOneSpy } as never);

      const result = await repository.updateWithVersionCheck(id, organizationId, authorPositionId, 5, { title: 'x' });

      expect(result).toEqual({ modifiedCount: 0 });
    });
  });

  describe('deleteForOwner', () => {
    it('фильтр включает organizationId И authorPositionId', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const fakeSession = {} as never;
      const execSpy = jest.fn().mockResolvedValue({ deletedCount: 1 });
      const deleteOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ deleteOne: deleteOneSpy } as never);

      const result = await repository.deleteForOwner(id, organizationId, authorPositionId, fakeSession);

      expect(deleteOneSpy).toHaveBeenCalledWith(
        { _id: id, organizationId, authorPositionId },
        { session: fakeSession },
      );
      expect(result).toEqual({ deletedCount: 1 });
    });

    it('ничего не удалено — deletedCount:0', async () => {
      const id = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const execSpy = jest.fn().mockResolvedValue({ deletedCount: 0 });
      const deleteOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
      const repository = new NoteRepository({ deleteOne: deleteOneSpy } as never);

      const result = await repository.deleteForOwner(id, organizationId, authorPositionId);

      expect(result).toEqual({ deletedCount: 0 });
    });
  });
});
