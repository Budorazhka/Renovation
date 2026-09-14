import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { NoteDocument, type NoteCategory } from '../schemas/note.schema';

export interface CreateNoteParams {
  organizationId: Types.ObjectId;
  authorPositionId: Types.ObjectId;
  title: string;
  content?: string;
  isPinned?: boolean;
  category?: NoteCategory;
  leadId?: Types.ObjectId;
  attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
}

export interface ListNotesFilter {
  leadId?: Types.ObjectId;
  cursor?: Types.ObjectId;
  limit: number;
}

/** Именованный тип вместо инлайн-объекта в сигнатуре — инлайн-`{...}` в
 * Promise<{...}> ломает разбор границы сигнатуры в tenant-scope.test.ts
 * (regex, ищущий `){` конца метода, не переживает вложенную `{` до неё). */
export interface NoteMutationResult {
  modifiedCount: number;
}

export interface NoteDeleteResult {
  deletedCount: number;
}

export interface UpdateNotePatch {
  title?: string;
  content?: string;
  isPinned?: boolean;
  category?: NoteCategory;
  /** `null` — отвязать лид, `undefined` — не менять. */
  leadId?: Types.ObjectId | null;
  /** Полный новый список, заменяет прежний целиком — тот же принцип, что UpdateTaskParams.subtasks. */
  attachments?: Array<{ assetId: Types.ObjectId; fileName: string }>;
}

/**
 * Repository layer for личных заметок менеджера. Каждый запрос
 * обязательно фильтруется по {organizationId, authorPositionId} прямо в
 * теле метода (tenant-scope.test.ts) — заметка не видна никому, кроме
 * своего автора, даже в пределах одной организации.
 */
@Injectable()
export class NoteRepository {
  constructor(@InjectModel(NoteDocument.name) private readonly model: Model<NoteDocument>) {}

  async create(params: CreateNoteParams, session?: ClientSession): Promise<NoteDocument> {
    const docData: Record<string, unknown> = {
      organizationId: params.organizationId,
      authorPositionId: params.authorPositionId,
      title: params.title,
    };

    if (params.content !== undefined) docData.content = params.content;
    if (params.isPinned !== undefined) docData.isPinned = params.isPinned;
    if (params.category !== undefined) docData.category = params.category;
    if (params.leadId !== undefined) docData.leadId = params.leadId;
    if (params.attachments !== undefined) docData.attachments = params.attachments;

    const [created] = await this.model.create([docData], { session });
    return created!;
  }

  async findByIdForOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    authorPositionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<NoteDocument | null> {
    const filter: FilterQuery<NoteDocument> = { _id: id, organizationId, authorPositionId };
    if (session) {
      return this.model.findOne(filter, null, { session }).exec();
    }
    return this.model.findOne(filter).exec();
  }

  async listForOwner(
    organizationId: Types.ObjectId,
    authorPositionId: Types.ObjectId,
    filter: ListNotesFilter,
  ): Promise<NoteDocument[]> {
    const queryFilter: FilterQuery<NoteDocument> = { organizationId, authorPositionId };

    if (filter.cursor) {
      queryFilter._id = { $lt: filter.cursor };
    }
    if (filter.leadId) {
      queryFilter.leadId = filter.leadId;
    }

    return this.model.find(queryFilter).sort({ _id: -1 }).limit(filter.limit).exec();
  }

  /**
   * conventions.md разд.5 optimistic concurrency — тот же атомарный CAS-
   * паттерн, что TaskRepository.updateTask: {_id, organizationId,
   * authorPositionId, version: expectedVersion} в одном Mongo-фильтре с
   * $inc version, не read-then-write.
   */
  async updateWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    authorPositionId: Types.ObjectId,
    expectedVersion: number,
    patch: UpdateNotePatch,
    session?: ClientSession,
  ): Promise<NoteMutationResult> {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, number> = {};

    if (patch.title !== undefined) $set.title = patch.title;
    if (patch.content !== undefined) $set.content = patch.content;
    if (patch.isPinned !== undefined) $set.isPinned = patch.isPinned;
    if (patch.category !== undefined) $set.category = patch.category;
    if (patch.attachments !== undefined) $set.attachments = patch.attachments;

    if (patch.leadId === null) {
      $unset.leadId = 1;
    } else if (patch.leadId !== undefined) {
      $set.leadId = patch.leadId;
    }

    const updateDoc: Record<string, unknown> = { $inc: { version: 1 } };
    if (Object.keys($set).length > 0) updateDoc.$set = $set;
    if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;

    const result = await this.model.updateOne(
      { _id: id, organizationId, authorPositionId, version: expectedVersion },
      updateDoc,
      { session },
    ).exec();

    return { modifiedCount: result.modifiedCount };
  }

  async deleteForOwner(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    authorPositionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<NoteDeleteResult> {
    const result = await this.model.deleteOne({ _id: id, organizationId, authorPositionId }, { session }).exec();
    return { deletedCount: result.deletedCount ?? 0 };
  }
}
