import { Types } from 'mongoose';
import { NotesController } from './notes.controller';
import type { NotesService } from './notes.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';

/** Повторов в этих тестах нет, если явно не переопределено. */
const noReplay = () => ({ checkReplay: jest.fn().mockResolvedValue(null) }) as unknown as IdempotencyService;

function makeRequest(organizationId: Types.ObjectId, positionId: Types.ObjectId) {
  return {
    tenantContext: {
      organizationId: organizationId.toString(),
      positionId: positionId.toString(),
      identityId: new Types.ObjectId().toString(),
    },
  };
}

describe('NotesController', () => {
  describe('listNotes', () => {
    it('фильтрует по organizationId и authorPositionId вызывающего (всегда own — не запрашивает scope у PolicyEvaluator)', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const listNotes = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
      const matchingScopes = jest.fn();
      const controller = new NotesController(
        { listNotes } as unknown as NotesService,
        { matchingScopes } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.listNotes(makeRequest(organizationId, positionId) as never, {
        leadId: leadId.toString(),
        limit: 50,
      });

      expect(listNotes).toHaveBeenCalledWith({
        organizationId,
        authorPositionId: positionId,
        leadId,
        cursor: undefined,
        limit: 50,
      });
      expect(matchingScopes).not.toHaveBeenCalled();
    });
  });

  describe('getNote', () => {
    it('передаёт organizationId и authorPositionId вызывающего', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const noteId = new Types.ObjectId();
      const getNote = jest.fn().mockResolvedValue({ id: noteId.toString() });
      const controller = new NotesController(
        { getNote } as unknown as NotesService,
        {} as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.getNote(makeRequest(organizationId, positionId) as never, noteId);

      expect(getNote).toHaveBeenCalledWith({ noteId, organizationId, authorPositionId: positionId });
    });
  });

  describe('downloadAttachment', () => {
    it('передаёт noteId/assetId/organizationId/authorPositionId', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const noteId = new Types.ObjectId();
      const assetId = new Types.ObjectId();
      const getNoteAttachmentDownloadUrl = jest.fn().mockResolvedValue({ url: 'https://signed', fileName: 'a.pdf' });
      const controller = new NotesController(
        { getNoteAttachmentDownloadUrl } as unknown as NotesService,
        {} as PolicyEvaluatorService,
        noReplay(),
      );

      const result = await controller.downloadAttachment(
        makeRequest(organizationId, positionId) as never,
        noteId,
        assetId,
      );

      expect(getNoteAttachmentDownloadUrl).toHaveBeenCalledWith({
        noteId,
        assetId,
        organizationId,
        authorPositionId: positionId,
      });
      expect(result).toEqual({ url: 'https://signed', fileName: 'a.pdf' });
    });
  });

  describe('createNote', () => {
    it('без Idempotency-Key — IDEMPOTENCY_KEY_REQUIRED, сервис не вызывается', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const createNote = jest.fn();
      const controller = new NotesController(
        { createNote } as unknown as NotesService,
        {} as PolicyEvaluatorService,
        noReplay(),
      );

      await expect(
        controller.createNote(makeRequest(organizationId, positionId) as never, { title: 'x' } as never),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      expect(createNote).not.toHaveBeenCalled();
    });

    it('replay найден — возвращает сохранённый ответ, сервис не вызывается', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const createNote = jest.fn();
      const checkReplay = jest.fn().mockResolvedValue({ responseStatus: 201, responseBody: { id: 'cached' } });
      const controller = new NotesController(
        { createNote } as unknown as NotesService,
        {} as PolicyEvaluatorService,
        { checkReplay } as unknown as IdempotencyService,
      );

      const result = await controller.createNote(
        makeRequest(organizationId, positionId) as never,
        { title: 'x' } as never,
        'key-1',
      );

      expect(result).toEqual({ id: 'cached' });
      expect(createNote).not.toHaveBeenCalled();
    });

    it('leadId отсутствует — PolicyEvaluator не вызывается, leadScopeAllowed undefined', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const createNote = jest.fn().mockResolvedValue({ id: 'n-1' });
      const matchingScopes = jest.fn();
      const controller = new NotesController(
        { createNote } as unknown as NotesService,
        { matchingScopes } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.createNote(makeRequest(organizationId, positionId) as never, { title: 'x' } as never, 'key-1');

      expect(matchingScopes).not.toHaveBeenCalled();
      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: undefined, leadScopeAllowed: undefined, leadOwnerPositionId: undefined }),
      );
    });

    it('leadId указан, lead.read own-scope — leadScopeAllowed:true, leadOwnerPositionId = вызывающая позиция', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const createNote = jest.fn().mockResolvedValue({ id: 'n-1' });
      const matchingScopes = jest.fn().mockResolvedValue(['own']);
      const controller = new NotesController(
        { createNote } as unknown as NotesService,
        { matchingScopes } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.createNote(
        makeRequest(organizationId, positionId) as never,
        { title: 'x', leadId: leadId.toString() } as never,
        'key-1',
      );

      expect(matchingScopes).toHaveBeenCalledWith({
        subjectType: 'position',
        subjectId: positionId,
        resource: 'lead',
        action: 'read',
      });
      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({ leadId, leadScopeAllowed: true, leadOwnerPositionId: positionId }),
      );
    });

    it('leadId указан, lead.read organization-scope — leadOwnerPositionId не сужает (undefined)', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const createNote = jest.fn().mockResolvedValue({ id: 'n-1' });
      const controller = new NotesController(
        { createNote } as unknown as NotesService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.createNote(
        makeRequest(organizationId, positionId) as never,
        { title: 'x', leadId: leadId.toString() } as never,
        'key-1',
      );

      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({ leadId, leadScopeAllowed: true, leadOwnerPositionId: undefined }),
      );
    });

    it('leadId указан, у позиции нет lead.read вовсе — leadScopeAllowed:false (сервис решит 403)', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const createNote = jest.fn().mockResolvedValue({ id: 'n-1' });
      const controller = new NotesController(
        { createNote } as unknown as NotesService,
        { matchingScopes: jest.fn().mockResolvedValue([]) } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.createNote(
        makeRequest(organizationId, positionId) as never,
        { title: 'x', leadId: leadId.toString() } as never,
        'key-1',
      );

      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({ leadId, leadScopeAllowed: false, leadOwnerPositionId: undefined }),
      );
    });
  });

  describe('updateNote', () => {
    it('передаёт expectedVersion и остальные поля', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const noteId = new Types.ObjectId();
      const updateNote = jest.fn().mockResolvedValue({ id: noteId.toString() });
      const controller = new NotesController(
        { updateNote } as unknown as NotesService,
        {} as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.updateNote(makeRequest(organizationId, positionId) as never, noteId, {
        expectedVersion: 2,
        title: 'Новый заголовок',
      } as never);

      expect(updateNote).toHaveBeenCalledWith(
        expect.objectContaining({
          noteId,
          organizationId,
          authorPositionId: positionId,
          expectedVersion: 2,
          title: 'Новый заголовок',
          leadId: undefined,
        }),
      );
    });

    it('leadId:null — передаёт null (отвязка), PolicyEvaluator не вызывается', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const noteId = new Types.ObjectId();
      const updateNote = jest.fn().mockResolvedValue({ id: noteId.toString() });
      const matchingScopes = jest.fn();
      const controller = new NotesController(
        { updateNote } as unknown as NotesService,
        { matchingScopes } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.updateNote(makeRequest(organizationId, positionId) as never, noteId, {
        expectedVersion: 2,
        leadId: null,
      } as never);

      expect(matchingScopes).not.toHaveBeenCalled();
      expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ leadId: null }));
    });

    it('leadId указан — резолвит scope и передаёт new ObjectId', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const noteId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const updateNote = jest.fn().mockResolvedValue({ id: noteId.toString() });
      const controller = new NotesController(
        { updateNote } as unknown as NotesService,
        { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
        noReplay(),
      );

      await controller.updateNote(makeRequest(organizationId, positionId) as never, noteId, {
        expectedVersion: 0,
        leadId: leadId.toString(),
      } as never);

      expect(updateNote).toHaveBeenCalledWith(
        expect.objectContaining({ leadId, leadScopeAllowed: true, leadOwnerPositionId: positionId }),
      );
    });
  });

  describe('deleteNote', () => {
    it('передаёт organizationId и authorPositionId вызывающего', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const noteId = new Types.ObjectId();
      const deleteNote = jest.fn().mockResolvedValue(undefined);
      const controller = new NotesController(
        { deleteNote } as unknown as NotesService,
        {} as PolicyEvaluatorService,
        noReplay(),
      );

      const result = await controller.deleteNote(makeRequest(organizationId, positionId) as never, noteId);

      expect(deleteNote).toHaveBeenCalledWith({ noteId, organizationId, authorPositionId: positionId });
      expect(result).toBeUndefined();
    });
  });
});
