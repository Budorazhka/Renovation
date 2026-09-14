import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CrmService } from '../crm/crm.service';
import { MediaService } from '../media/media.service';
import { NoteRepository } from './repository/note.repository';
import type { NoteDocument, NoteCategory } from './schemas/note.schema';

export interface NoteView {
  id: string;
  organizationId: string;
  authorPositionId: string;
  title: string;
  content: string;
  isPinned: boolean;
  category: NoteCategory;
  leadId: string | null;
  attachments: Array<{ assetId: string; fileName: string }>;
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

export function toNoteReadModel(note: NoteDocument): NoteView {
  return {
    id: note._id.toString(),
    organizationId: note.organizationId.toString(),
    authorPositionId: note.authorPositionId.toString(),
    title: note.title,
    content: note.content ?? '',
    isPinned: Boolean(note.isPinned),
    category: note.category ?? 'personal',
    leadId: note.leadId ? note.leadId.toString() : null,
    attachments: (note.attachments ?? []).map((item) => ({
      assetId: item.assetId.toString(),
      fileName: item.fileName,
    })),
    version: note.version ?? 0,
    createdAt: note.createdAt ? note.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: note.updatedAt ? note.updatedAt.toISOString() : null,
  };
}

/**
 * Command/query-слой личного блокнота менеджера (легаси-блок «Заметки» в
 * ERP, раньше писал в старый сервер чужого продукта). Отдельный модуль от
 * `crm` (ADR-001) — ссылается на Lead только через CrmService.
 * getLeadForOrganization, не через LeadRepository напрямую.
 *
 * Аудит и outbox-события НЕ пишутся: permission-matrix.md §4 требует их
 * только для критических действий (блокировки/редактуры, влияющие на
 * отчётность/других пользователей) — личная заметка видна и меняется
 * только своим автором, тот же прецедент, что SelectionsService/
 * DevSelectionRepository (подборки клиента тоже без аудита).
 */
@Injectable()
export class NotesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repository: NoteRepository,
    private readonly crmService: CrmService,
    private readonly mediaService: MediaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  private async validateAttachments(
    attachments: Array<{ assetId: Types.ObjectId; fileName: string }> | undefined,
    organizationId: Types.ObjectId,
  ): Promise<void> {
    if (!attachments || attachments.length === 0) return;

    const found = await this.mediaService.getAssetsForOwnerScope(
      attachments.map((item) => item.assetId),
      { type: 'organization', organizationId },
    );
    for (const item of attachments) {
      const asset = found.get(item.assetId.toString());
      if (!asset) {
        throw new NotFoundException('Attachment media asset not found');
      }
      if (asset.status !== 'verified') {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Attachment media asset is not verified yet');
      }
    }
  }

  async listNotes(params: {
    organizationId: Types.ObjectId;
    authorPositionId: Types.ObjectId;
    leadId?: Types.ObjectId;
    cursor?: Types.ObjectId;
    limit: number;
  }): Promise<{ items: NoteView[]; nextCursor: string | null }> {
    const rows = await this.repository.listForOwner(params.organizationId, params.authorPositionId, {
      leadId: params.leadId,
      cursor: params.cursor,
      limit: params.limit + 1,
    });
    const hasMore = rows.length > params.limit;
    const notes = hasMore ? rows.slice(0, params.limit) : rows;
    const nextCursor = hasMore ? notes[notes.length - 1]!._id.toString() : null;

    return { items: notes.map(toNoteReadModel), nextCursor };
  }

  /** GET /notes/:noteId. Чужая заметка (другой автор либо другая организация) — 404, non-disclosure. */
  async getNote(params: {
    noteId: Types.ObjectId;
    organizationId: Types.ObjectId;
    authorPositionId: Types.ObjectId;
  }): Promise<NoteView> {
    const note = await this.repository.findByIdForOwner(params.noteId, params.organizationId, params.authorPositionId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return toNoteReadModel(note);
  }

  async getNoteAttachmentDownloadUrl(params: {
    noteId: Types.ObjectId;
    assetId: Types.ObjectId;
    organizationId: Types.ObjectId;
    authorPositionId: Types.ObjectId;
  }): Promise<{ url: string; fileName: string }> {
    const note = await this.getNote(params);
    const attachment = note.attachments.find((item) => item.assetId === params.assetId.toString());
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }
    const download = await this.mediaService.createDownloadUrlForOwnerScope(params.assetId, {
      type: 'organization',
      organizationId: params.organizationId,
    });
    if (!download) {
      throw new NotFoundException('Attachment not found');
    }
    return { url: download.url, fileName: attachment.fileName };
  }

  /**
   * POST /notes. `leadScopeAllowed`/`leadOwnerPositionId` — уже вычислены
   * контроллером через PolicyEvaluatorService.matchingScopes('lead','read')
   * ДО вызова (тот же паттерн, что TaskController.ownerFilterForAction):
   * `leadScopeAllowed:false` означает "у позиции нет lead.read вовсе" —
   * сервис бросает 403 при попытке привязать лид, не молча игнорирует leadId.
   */
  async createNote(params: {
    organizationId: Types.ObjectId;
    authorPositionId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    title: string;
    content?: string;
    isPinned?: boolean;
    category?: NoteCategory;
    leadId?: Types.ObjectId;
    leadScopeAllowed?: boolean;
    leadOwnerPositionId?: Types.ObjectId;
    attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
    idempotencyKey: string;
    idempotencyRequestBody: Record<string, unknown>;
  }): Promise<NoteView> {
    await this.validateAttachments(params.attachments, params.organizationId);

    if (params.leadId) {
      if (!params.leadScopeAllowed) {
        throw new ForbiddenException('Caller has no lead.read permission — cannot attach a lead to a note');
      }
      await this.crmService.getLeadForOrganization(params.leadId, params.organizationId, params.leadOwnerPositionId);
    }

    return runInTransaction(this.connection, async (session) => {
      const note = await this.repository.create(
        {
          organizationId: params.organizationId,
          authorPositionId: params.authorPositionId,
          title: params.title,
          content: params.content,
          isPinned: params.isPinned,
          category: params.category,
          leadId: params.leadId,
          attachments: params.attachments,
        },
        session,
      );

      const readModel = toNoteReadModel(note);

      await this.idempotencyService.record(
        {
          identityId: params.actorIdentityId,
          operation: 'createNote',
          key: params.idempotencyKey,
          requestBody: params.idempotencyRequestBody,
          responseStatus: 201,
          responseBody: readModel as unknown as Record<string, unknown>,
        },
        session,
      );

      return readModel;
    });
  }

  /**
   * PATCH /notes/:noteId. CAS по expectedVersion (conventions.md разд.5) —
   * находит заметку ДО обновления (404, если чужая/не существует), затем
   * атомарный updateOne с version в фильтре: modifiedCount:0 после
   * пройденной проверки владения означает только устаревший expectedVersion
   * (409), тот же принцип disambiguation, что TaskRepository.updateTask.
   */
  async updateNote(params: {
    noteId: Types.ObjectId;
    organizationId: Types.ObjectId;
    authorPositionId: Types.ObjectId;
    expectedVersion: number;
    title?: string;
    content?: string;
    isPinned?: boolean;
    category?: NoteCategory;
    leadId?: Types.ObjectId | null;
    leadScopeAllowed?: boolean;
    leadOwnerPositionId?: Types.ObjectId;
    attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
  }): Promise<NoteView> {
    const existing = await this.repository.findByIdForOwner(params.noteId, params.organizationId, params.authorPositionId);
    if (!existing) {
      throw new NotFoundException('Note not found');
    }

    await this.validateAttachments(params.attachments, params.organizationId);

    if (params.leadId) {
      if (!params.leadScopeAllowed) {
        throw new ForbiddenException('Caller has no lead.read permission — cannot attach a lead to a note');
      }
      await this.crmService.getLeadForOrganization(params.leadId, params.organizationId, params.leadOwnerPositionId);
    }

    return runInTransaction(this.connection, async (session) => {
      const { modifiedCount } = await this.repository.updateWithVersionCheck(
        params.noteId,
        params.organizationId,
        params.authorPositionId,
        params.expectedVersion,
        {
          title: params.title,
          content: params.content,
          isPinned: params.isPinned,
          category: params.category,
          leadId: params.leadId,
          attachments: params.attachments,
        },
        session,
      );
      if (modifiedCount === 0) {
        throw new ConflictException('Note was modified by another request — refresh and retry');
      }

      const updated = await this.repository.findByIdForOwner(
        params.noteId,
        params.organizationId,
        params.authorPositionId,
        session,
      );
      return toNoteReadModel(updated!);
    });
  }

  /** DELETE /notes/:noteId — удаление по id, идемпотентно: повторный вызов на уже удалённой заметке — 404, не второй side-effect. */
  async deleteNote(params: {
    noteId: Types.ObjectId;
    organizationId: Types.ObjectId;
    authorPositionId: Types.ObjectId;
  }): Promise<void> {
    const { deletedCount } = await this.repository.deleteForOwner(
      params.noteId,
      params.organizationId,
      params.authorPositionId,
    );
    if (deletedCount === 0) {
      throw new NotFoundException('Note not found');
    }
  }
}
