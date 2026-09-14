import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Клиент личных заметок менеджера (apps/api/src/modules/notes).
 *
 * - GET    /api/v1/notes?leadId=&cursor=&limit=<1..100>
 * - GET    /api/v1/notes/:noteId
 * - POST   /api/v1/notes                  (заголовок Idempotency-Key)
 * - PATCH  /api/v1/notes/:noteId          body: { expectedVersion, ... }
 * - DELETE /api/v1/notes/:noteId
 * - GET    /api/v1/notes/:noteId/attachments/:assetId/download
 *
 * Сервер отдаёт только заметки автора из сессии — даже владелец организации
 * чужих не видит. Ошибки не проглатываются.
 */

export type NoteCategoryV2 = 'personal' | 'work'

export interface NoteAttachmentV2 {
  assetId: string
  fileName: string
}

export interface NoteV2 {
  id: string
  organizationId: string
  authorPositionId: string
  title: string
  content: string
  isPinned: boolean
  category: NoteCategoryV2
  leadId: string | null
  attachments: NoteAttachmentV2[]
  version: number
  createdAt: string
  updatedAt: string | null
}

export interface CreateNoteV2Payload {
  title: string
  content?: string
  isPinned?: boolean
  category?: NoteCategoryV2
  leadId?: string
  attachments?: NoteAttachmentV2[]
}

export interface UpdateNoteV2Payload {
  title?: string
  content?: string
  isPinned?: boolean
  category?: NoteCategoryV2
  leadId?: string | null
  attachments?: NoteAttachmentV2[]
}

interface ListNotesV2Response {
  items: NoteV2[]
  nextCursor: string | null
}

const NOTES_PER_REQUEST = 100
const MAX_NOTE_PAGES = 10

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function newIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID()
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const notesApiV2 = {
  /** Все заметки автора (дочитывает страницы до MAX_NOTE_PAGES). */
  async listAll(params?: { leadId?: string }): Promise<{ items: NoteV2[]; complete: boolean }> {
    const items: NoteV2[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_NOTE_PAGES; page += 1) {
      const { data } = await api.get<ListNotesV2Response>('/api/v1/notes', {
        params: { ...params, limit: NOTES_PER_REQUEST, cursor },
      })
      items.push(...data.items)
      if (!data.nextCursor) return { items, complete: true }
      cursor = data.nextCursor
    }
    return { items, complete: false }
  },

  async getById(noteId: string): Promise<NoteV2> {
    const { data } = await api.get<NoteV2>(`/api/v1/notes/${noteId}`)
    return data
  },

  async create(payload: CreateNoteV2Payload, idempotencyKey: string = newIdempotencyKey()): Promise<NoteV2> {
    const { data } = await api.post<NoteV2>('/api/v1/notes', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return data
  },

  async update(noteId: string, expectedVersion: number, payload: UpdateNoteV2Payload): Promise<NoteV2> {
    const { data } = await api.patch<NoteV2>(`/api/v1/notes/${noteId}`, { ...payload, expectedVersion })
    return data
  },

  async remove(noteId: string): Promise<void> {
    await api.delete(`/api/v1/notes/${noteId}`)
  },

  /** Временная ссылка на скачивание вложения (живёт несколько минут). */
  async getAttachmentDownloadUrl(noteId: string, assetId: string): Promise<{ url: string; fileName: string }> {
    const { data } = await api.get<{ url: string; fileName: string }>(
      `/api/v1/notes/${noteId}/attachments/${assetId}/download`,
    )
    return data
  },
}
