import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * Загрузка файла в хранилище платформы по ADR-008: тело файла не ходит через
 * API. Три шага — intent, прямой PUT по presigned URL, подтверждение — и на
 * выходе assetId, который дальше передаётся сущности (аватар позиции,
 * вложение задачи).
 *
 * Тот же поток, что teamApi.uploadAvatar; вынесен сюда, чтобы вложения задач
 * не копировали его третий раз.
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

export type MediaPurpose = 'profile_avatar' | 'task_attachment' | 'agency_document' | 'lead_attachment' | 'note_attachment'

export class MediaUploadError extends Error {
  constructor(
    message: string,
    readonly fileName: string,
  ) {
    super(message)
    this.name = 'MediaUploadError'
  }
}

export const mediaApiV2 = {
  /**
   * Загружает один файл и возвращает id подтверждённого asset'а. Любой сбой —
   * ошибка с именем файла: вызывающий код обязан показать её, а не создать
   * сущность «с вложением», которого нет.
   */
  async uploadFile(file: File, purpose: MediaPurpose): Promise<{ assetId: string }> {
    const { data: intent } = await api.post<{ assetId: string; uploadUrl: string }>('/api/v1/media/upload-intent', {
      declaredMimeType: file.type,
      sizeBytes: file.size,
      purpose,
    })
    if (!intent?.assetId || !intent?.uploadUrl) {
      throw new MediaUploadError('Сервер не выдал адрес для загрузки', file.name)
    }

    // Прямая загрузка в хранилище по presigned URL — не через axios-инстанс
    // `api`: тот несёт cookie и baseURL нашего backend'а, а адрес выдан для
    // другого домена, и credentials туда отправлять не следует.
    const put = await fetch(intent.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!put.ok) {
      throw new MediaUploadError(`Хранилище отклонило файл (${put.status})`, file.name)
    }

    const { data: confirmed } = await api.post<{ status: 'verified' | 'rejected' }>(
      `/api/v1/media/${intent.assetId}/confirm`,
    )
    if (confirmed?.status !== 'verified') {
      throw new MediaUploadError('Файл не прошёл проверку', file.name)
    }

    return { assetId: intent.assetId }
  },
}
