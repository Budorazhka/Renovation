/**
 * Открывает файл в новой вкладке. Прямой `url` открывается сразу; иначе
 * вкладка открывается синхронно (браузер блокирует window.open после await)
 * и получает адрес, когда сервер выдаст временную ссылку. Если вкладку
 * открыть не дали, файл открывается в текущей.
 */
export async function openSignedFile(getUrl: () => Promise<string>, directUrl?: string | null): Promise<void> {
  if (directUrl) {
    window.open(directUrl, '_blank', 'noopener')
    return
  }
  const tab = window.open('', '_blank')
  try {
    const url = await getUrl()
    if (tab) {
      // Без обнуления opener: в Chromium после `tab.opener = null` вкладка
      // остаётся на about:blank. Ссылка ведёт на наше хранилище, не на чужой сайт.
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (error) {
    tab?.close()
    throw error
  }
}

/** Что принимает хранилище платформы (apps/api media.constants.ts ALLOWED_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES). */
export const UPLOAD_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
export const UPLOAD_MAX_SIZE_BYTES = 20 * 1024 * 1024
export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'

/** Первый файл, который хранилище не примет, — чтобы сказать об этом до загрузки, а не после отказа сервера. */
export function findRejectedUpload(files: File[]): File | null {
  return files.find((file) => !UPLOAD_ALLOWED_MIME_TYPES.has(file.type) || file.size > UPLOAD_MAX_SIZE_BYTES) ?? null
}
