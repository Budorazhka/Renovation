import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type { LeadProductTypeV2 } from '@/types/leadsV2'

/**
 * Клиент библиотеки материалов CRM (apps/api/src/modules/library).
 *
 * - GET    /api/v1/library/items?scope=organization&productType=
 * - GET    /api/v1/library/items?scope=personal&folderId=
 * - POST   /api/v1/library/items            (заголовок Idempotency-Key)
 * - DELETE /api/v1/library/items/:itemId
 * - GET    /api/v1/library/items/:itemId/download
 * - GET    /api/v1/library/folders?parentId=
 * - POST   /api/v1/library/folders          (заголовок Idempotency-Key)
 * - DELETE /api/v1/library/folders/:folderId (непустая — 409 LIBRARY_FOLDER_NOT_EMPTY)
 *
 * Общие материалы видят все сотрудники, добавляют руководители; личную
 * библиотеку видит только её владелец. Ошибки не проглатываются.
 */

export type LibraryScopeV2 = 'organization' | 'personal'

export interface LibraryItemV2 {
  id: string
  scope: LibraryScopeV2
  productType: LeadProductTypeV2 | null
  folderId: string | null
  assetId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdByPositionId: string
  createdAt: string
}

export interface LibraryFolderV2 {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface LibraryItemListV2 {
  items: LibraryItemV2[]
  canUpload: boolean
}

export interface CreateLibraryItemV2Payload {
  scope: LibraryScopeV2
  assetId: string
  fileName: string
  productType?: LeadProductTypeV2
  folderId?: string
}

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function idempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID()
  return `library-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const libraryApiV2 = {
  async listOrganization(productType?: LeadProductTypeV2): Promise<LibraryItemListV2> {
    const { data } = await api.get<LibraryItemListV2>('/api/v1/library/items', {
      params: productType ? { scope: 'organization', productType } : { scope: 'organization' },
    })
    return data
  },

  async listPersonal(folderId?: string | null): Promise<LibraryItemListV2> {
    const { data } = await api.get<LibraryItemListV2>('/api/v1/library/items', {
      params: folderId ? { scope: 'personal', folderId } : { scope: 'personal' },
    })
    return data
  },

  async createItem(payload: CreateLibraryItemV2Payload): Promise<LibraryItemV2> {
    const { data } = await api.post<LibraryItemV2>('/api/v1/library/items', payload, {
      headers: { 'Idempotency-Key': idempotencyKey() },
    })
    return data
  },

  async deleteItem(itemId: string): Promise<void> {
    await api.delete(`/api/v1/library/items/${itemId}`)
  },

  async getDownloadUrl(itemId: string): Promise<string> {
    const { data } = await api.get<{ url: string; fileName: string }>(`/api/v1/library/items/${itemId}/download`)
    return data.url
  },

  async listFolders(parentId?: string | null): Promise<LibraryFolderV2[]> {
    const { data } = await api.get<{ folders: LibraryFolderV2[] }>('/api/v1/library/folders', {
      params: parentId ? { parentId } : undefined,
    })
    return data.folders
  },

  async createFolder(name: string, parentId?: string | null): Promise<LibraryFolderV2> {
    const { data } = await api.post<LibraryFolderV2>(
      '/api/v1/library/folders',
      parentId ? { name, parentId } : { name },
      { headers: { 'Idempotency-Key': idempotencyKey() } },
    )
    return data
  },

  async deleteFolder(folderId: string): Promise<void> {
    await api.delete(`/api/v1/library/folders/${folderId}`)
  },
}
