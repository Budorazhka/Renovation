import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotesService } from './notes.service';
import type { NoteRepository } from './repository/note.repository';
import type { CrmService } from '../crm/crm.service';
import type { MediaService } from '../media/media.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import type { NoteDocument } from './schemas/note.schema';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeService(overrides: {
  repository?: Partial<NoteRepository>;
  crmService?: Partial<CrmService>;
  mediaService?: Partial<MediaService>;
  idempotencyService?: Partial<IdempotencyService>;
} = {}) {
  return new NotesService(
    makeMockConnection() as never,
    (overrides.repository ?? {}) as NoteRepository,
    (overrides.crmService ?? { getLeadForOrganization: jest.fn().mockResolvedValue({}) }) as CrmService,
    (overrides.mediaService ?? {}) as MediaService,
    (overrides.idempotencyService ?? { record: jest.fn().mockResolvedValue(undefined) }) as IdempotencyService,
  );
}

function makeDoc(overrides: Partial<NoteDocument> = {}): NoteDocument {
  return {
    _id: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    authorPositionId: new Types.ObjectId(),
    title: 'Заметка',
    content: '',
    isPinned: false,
    category: 'personal',
    attachments: [],
    version: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as NoteDocument;
}

describe('NotesService', () => {
  describe('createNote', () => {
    it('leadId указан, но у вызывающего нет lead.read вовсе — 403, лид не проверяется', async () => {
      const getLeadSpy = jest.fn();
      const service = makeService({ crmService: { getLeadForOrganization: getLeadSpy } });

      await expect(
        service.createNote({
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          title: 'x',
          leadId: new Types.ObjectId(),
          leadScopeAllowed: false,
          idempotencyKey: 'k',
          idempotencyRequestBody: {},
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(getLeadSpy).not.toHaveBeenCalled();
    });

    it('leadId указан, own-scope lead.read — getLeadForOrganization вызван с ownerPositionId вызывающего', async () => {
      const leadOwnerPositionId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const organizationId = new Types.ObjectId();
      const getLeadSpy = jest.fn().mockResolvedValue({});
      const createSpy = jest.fn().mockResolvedValue(makeDoc({ organizationId, leadId }));
      const service = makeService({
        crmService: { getLeadForOrganization: getLeadSpy },
        repository: { create: createSpy },
      });

      await service.createNote({
        organizationId,
        authorPositionId: new Types.ObjectId(),
        actorIdentityId: new Types.ObjectId(),
        title: 'x',
        leadId,
        leadScopeAllowed: true,
        leadOwnerPositionId,
        idempotencyKey: 'k',
        idempotencyRequestBody: {},
      });

      expect(getLeadSpy).toHaveBeenCalledWith(leadId, organizationId, leadOwnerPositionId);
    });

    it('чужой лид — 404 из CrmService.getLeadForOrganization, заметка не создаётся', async () => {
      const createSpy = jest.fn();
      const service = makeService({
        crmService: { getLeadForOrganization: jest.fn().mockRejectedValue(new NotFoundException('Lead not found')) },
        repository: { create: createSpy },
      });

      await expect(
        service.createNote({
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          title: 'x',
          leadId: new Types.ObjectId(),
          leadScopeAllowed: true,
          idempotencyKey: 'k',
          idempotencyRequestBody: {},
        }),
      ).rejects.toThrow(NotFoundException);

      expect(createSpy).not.toHaveBeenCalled();
    });

    it('вложение не подтверждено — 400 (AppException VALIDATION_FAILED)', async () => {
      const assetId = new Types.ObjectId();
      const service = makeService({
        mediaService: {
          getAssetsForOwnerScope: jest.fn().mockResolvedValue(
            new Map([[assetId.toString(), { status: 'pending' } as never]]),
          ),
        },
      });

      await expect(
        service.createNote({
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          title: 'x',
          attachments: [{ assetId, fileName: 'a.pdf' }],
          idempotencyKey: 'k',
          idempotencyRequestBody: {},
        }),
      ).rejects.toThrow('Attachment media asset is not verified yet');
    });

    it('чужой asset (не найден в scope организации) — 404', async () => {
      const assetId = new Types.ObjectId();
      const service = makeService({
        mediaService: { getAssetsForOwnerScope: jest.fn().mockResolvedValue(new Map()) },
      });

      await expect(
        service.createNote({
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
          actorIdentityId: new Types.ObjectId(),
          title: 'x',
          attachments: [{ assetId, fileName: 'a.pdf' }],
          idempotencyKey: 'k',
          idempotencyRequestBody: {},
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('успешное создание записывает idempotency и возвращает NoteView', async () => {
      const organizationId = new Types.ObjectId();
      const authorPositionId = new Types.ObjectId();
      const doc = makeDoc({ organizationId, authorPositionId, title: 'Позвонить' });
      const createSpy = jest.fn().mockResolvedValue(doc);
      const recordSpy = jest.fn().mockResolvedValue(undefined);
      const service = makeService({
        repository: { create: createSpy },
        idempotencyService: { record: recordSpy },
      });

      const result = await service.createNote({
        organizationId,
        authorPositionId,
        actorIdentityId: new Types.ObjectId(),
        title: 'Позвонить',
        idempotencyKey: 'k',
        idempotencyRequestBody: { title: 'Позвонить' },
      });

      expect(result.title).toBe('Позвонить');
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'createNote', responseStatus: 201 }),
        expect.anything(),
      );
    });
  });

  describe('updateNote', () => {
    it('заметка не найдена/чужая — 404, CAS не вызывается', async () => {
      const updateSpy = jest.fn();
      const service = makeService({
        repository: { findByIdForOwner: jest.fn().mockResolvedValue(null), updateWithVersionCheck: updateSpy },
      });

      await expect(
        service.updateNote({
          noteId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
          expectedVersion: 0,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('устаревший expectedVersion — 409 ConflictException', async () => {
      const doc = makeDoc();
      const service = makeService({
        repository: {
          findByIdForOwner: jest.fn().mockResolvedValue(doc),
          updateWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        },
      });

      await expect(
        service.updateNote({
          noteId: doc._id,
          organizationId: doc.organizationId,
          authorPositionId: doc.authorPositionId,
          expectedVersion: 99,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('leadId:null — отвязка лида, getLeadForOrganization не вызывается', async () => {
      const doc = makeDoc();
      const getLeadSpy = jest.fn();
      const updated = makeDoc({ _id: doc._id, organizationId: doc.organizationId, authorPositionId: doc.authorPositionId });
      const service = makeService({
        repository: {
          findByIdForOwner: jest
            .fn()
            .mockResolvedValueOnce(doc)
            .mockResolvedValueOnce(updated),
          updateWithVersionCheck: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        },
        crmService: { getLeadForOrganization: getLeadSpy },
      });

      await service.updateNote({
        noteId: doc._id,
        organizationId: doc.organizationId,
        authorPositionId: doc.authorPositionId,
        expectedVersion: 0,
        leadId: null,
      });

      expect(getLeadSpy).not.toHaveBeenCalled();
    });

    it('leadId указан без lead.read гранта — 403', async () => {
      const doc = makeDoc();
      const service = makeService({
        repository: { findByIdForOwner: jest.fn().mockResolvedValue(doc) },
      });

      await expect(
        service.updateNote({
          noteId: doc._id,
          organizationId: doc.organizationId,
          authorPositionId: doc.authorPositionId,
          expectedVersion: 0,
          leadId: new Types.ObjectId(),
          leadScopeAllowed: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteNote', () => {
    it('deletedCount:0 (не найдена/уже удалена/чужая) — 404', async () => {
      const service = makeService({
        repository: { deleteForOwner: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
      });

      await expect(
        service.deleteNote({
          noteId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('успешное удаление не бросает', async () => {
      const service = makeService({
        repository: { deleteForOwner: jest.fn().mockResolvedValue({ deletedCount: 1 }) },
      });

      await expect(
        service.deleteNote({
          noteId: new Types.ObjectId(),
          organizationId: new Types.ObjectId(),
          authorPositionId: new Types.ObjectId(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getNoteAttachmentDownloadUrl', () => {
    it('assetId не входит в attachments заметки — 404', async () => {
      const doc = makeDoc({ attachments: [] });
      const service = makeService({
        repository: { findByIdForOwner: jest.fn().mockResolvedValue(doc) },
      });

      await expect(
        service.getNoteAttachmentDownloadUrl({
          noteId: doc._id,
          assetId: new Types.ObjectId(),
          organizationId: doc.organizationId,
          authorPositionId: doc.authorPositionId,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('вложение есть, но MediaService не отдаёт ссылку (не verified) — 404', async () => {
      const assetId = new Types.ObjectId();
      const doc = makeDoc({ attachments: [{ assetId, fileName: 'a.pdf' }] });
      const service = makeService({
        repository: { findByIdForOwner: jest.fn().mockResolvedValue(doc) },
        mediaService: { createDownloadUrlForOwnerScope: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.getNoteAttachmentDownloadUrl({
          noteId: doc._id,
          assetId,
          organizationId: doc.organizationId,
          authorPositionId: doc.authorPositionId,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('успех — возвращает url и fileName со связи', async () => {
      const assetId = new Types.ObjectId();
      const doc = makeDoc({ attachments: [{ assetId, fileName: 'договор.pdf' }] });
      const service = makeService({
        repository: { findByIdForOwner: jest.fn().mockResolvedValue(doc) },
        mediaService: { createDownloadUrlForOwnerScope: jest.fn().mockResolvedValue({ url: 'https://signed' }) },
      });

      const result = await service.getNoteAttachmentDownloadUrl({
        noteId: doc._id,
        assetId,
        organizationId: doc.organizationId,
        authorPositionId: doc.authorPositionId,
      });

      expect(result).toEqual({ url: 'https://signed', fileName: 'договор.pdf' });
    });
  });
});
