import { notesApiV2, type NoteCategoryV2, type NoteV2, type UpdateNoteV2Payload } from '@/services/notesApiV2';
import { mediaApiV2 } from '@/services/mediaApiV2';
import type { ApiResponse, CreateNoteDto, Note, PaginatedResult, UpdateNoteDto } from './api';

/**
 * Заметки платформы в легаси-форме, которой пользуется NotesBlock (методы и
 * ответы {success, data} как у старого apiService). Версии для CAS держатся
 * здесь: каждый ответ сервера обновляет их, каждая правка их передаёт.
 * Легаси-категории числовые: 1 — «Личная», 2 — «Рабочая».
 */

const versions = new Map<string, number>();

function toCategory(category: number | undefined): NoteCategoryV2 | undefined {
  if (category === 1) return 'personal';
  if (category === 2) return 'work';
  return undefined;
}

export function mapNoteV2ToCrmNote(note: NoteV2): Note {
  versions.set(note.id, note.version);
  return {
    _id: note.id,
    title: note.title,
    content: note.content,
    isPinned: note.isPinned,
    category: note.category === 'work' ? 2 : 1,
    leadId: note.leadId ?? undefined,
    createdBy: note.authorPositionId,
    // Сервер отдаёт ссылки на файлы (assetId), а не сами файлы: url/размер/тип
    // не резолвятся, скачивание идёт через временную ссылку по assetId.
    files: note.attachments.map((a) => ({ filename: a.assetId, originalName: a.fileName, mimeType: '', size: 0, url: '' })),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt ?? note.createdAt,
  };
}

function toUpdatePayload(data: UpdateNoteDto): UpdateNoteV2Payload {
  return {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.content !== undefined && { content: data.content }),
    ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
    ...(data.category !== undefined && { category: toCategory(data.category) }),
    ...(data.leadId !== undefined && { leadId: data.leadId }),
  };
}

function failure<T>(error: unknown): ApiResponse<T> {
  const err = error as { response?: { data?: { message?: string } }; message?: string };
  return { success: false, message: err.response?.data?.message || err.message || 'Ошибка запроса' };
}

async function update(id: string, payload: UpdateNoteV2Payload): Promise<ApiResponse<Note>> {
  try {
    const updated = await notesApiV2.update(id, versions.get(id) ?? 0, payload);
    return { success: true, data: mapNoteV2ToCrmNote(updated) };
  } catch (error) {
    return failure(error);
  }
}

async function uploadAll(files: File[]) {
  const uploaded: Array<{ assetId: string; fileName: string }> = [];
  for (const file of files) {
    const { assetId } = await mediaApiV2.uploadFile(file, 'note_attachment');
    uploaded.push({ assetId, fileName: file.name });
  }
  return uploaded;
}

export const notesService = {
  async getNotes(params?: { leadId?: string }): Promise<ApiResponse<PaginatedResult<Note>>> {
    try {
      const { items } = await notesApiV2.listAll(params?.leadId ? { leadId: params.leadId } : undefined);
      const notes = items.map(mapNoteV2ToCrmNote);
      return { success: true, data: { items: notes, total: notes.length, page: 1, totalPages: 1 } };
    } catch (error) {
      return failure(error);
    }
  },

  async getNote(id: string): Promise<ApiResponse<Note>> {
    try {
      return { success: true, data: mapNoteV2ToCrmNote(await notesApiV2.getById(id)) };
    } catch (error) {
      return failure(error);
    }
  },

  async createNote(data: CreateNoteDto): Promise<ApiResponse<Note>> {
    try {
      const created = await notesApiV2.create({
        title: data.title,
        ...(data.content !== undefined && { content: data.content }),
        ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
        ...(toCategory(data.category) && { category: toCategory(data.category) }),
        ...(data.leadId && { leadId: data.leadId }),
      });
      return { success: true, data: mapNoteV2ToCrmNote(created) };
    } catch (error) {
      return failure(error);
    }
  },

  updateNote(id: string, data: UpdateNoteDto): Promise<ApiResponse<Note>> {
    return update(id, toUpdatePayload(data));
  },

  pinNote(id: string, isPinned: boolean): Promise<ApiResponse<Note>> {
    return update(id, { isPinned });
  },

  async deleteNote(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      await notesApiV2.remove(id);
      versions.delete(id);
      return { success: true, data: { deleted: true } };
    } catch (error) {
      return failure(error);
    }
  },

  /** Загружает файлы в хранилище и дописывает их к вложениям заметки. */
  async uploadNoteFiles(noteId: string, files: File[]): Promise<ApiResponse<Note>> {
    try {
      const current = await notesApiV2.getById(noteId);
      const uploaded = await uploadAll(files);
      const updated = await notesApiV2.update(noteId, current.version, { attachments: [...current.attachments, ...uploaded] });
      return { success: true, data: mapNoteV2ToCrmNote(updated) };
    } catch (error) {
      return failure(error);
    }
  },

  async deleteNoteFileByIndex(noteId: string, fileIndex: number): Promise<ApiResponse<Note>> {
    try {
      const current = await notesApiV2.getById(noteId);
      const attachments = current.attachments.filter((_, index) => index !== fileIndex);
      const updated = await notesApiV2.update(noteId, current.version, { attachments });
      return { success: true, data: mapNoteV2ToCrmNote(updated) };
    } catch (error) {
      return failure(error);
    }
  },

  /** Временная ссылка на файл заметки по его позиции в списке вложений. */
  async getNoteFileUrl(noteId: string, fileIndex: number): Promise<{ url: string; fileName: string }> {
    const note = await notesApiV2.getById(noteId);
    const attachment = note.attachments[fileIndex];
    if (!attachment) throw new Error('Файл не найден');
    return notesApiV2.getAttachmentDownloadUrl(noteId, attachment.assetId);
  },
};
