/**
 * MVP-масштаб (≤40 пользователей, 8ГБ сервер) — консервативные лимиты,
 * не рассчитанные на видео большого объёма. Пересмотреть при появлении
 * реальной потребности в видео-турах объектов (вне текущего scope Stage C).
 */
export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 МБ

/**
 * ADR-008: magic-byte проверка — единственный источник истины для MIME.
 * Allowlist того, что вообще допустимо загружать в систему (не всё, что
 * file-type умеет распознавать) — сужает поверхность атаки до реально
 * нужных на MVP форматов (фото объектов, документы верификации агентств,
 * планы этажей).
 */
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * purpose → bucket: явный whitelist, не произвольная строка от клиента
 * (ADR-008 требует физическое разделение приватного/публичного —
 * маппинг не может быть решением клиента, иначе документ с приватными
 * данными мог бы быть заявлен как "публичный" запросом).
 */
export const MEDIA_PURPOSE_BUCKET: Record<string, 'private' | 'public'> = {
  unit_photo: 'public',
  floor_plan: 'public',
  agency_document: 'private',
  profile_avatar: 'public',
  property_photo: 'public',
  task_attachment: 'private',
  // `[phase 3]` детальная карточка лида, GET /leads/:leadId/files резолвит
  // URL так же, как TeamService резолвит avatarUrl (см. CrmService.
  // listLeadFiles докстринг) — это возможно ТОЛЬКО для 'public' bucket'а
  // (ADR-008, тот же принцип, что unit_photo/property_photo/profile_avatar).
  lead_attachment: 'public',
  // Личная заметка менеджера (модуль `notes`) — приватный бакет, тот же
  // принцип, что task_attachment: вложение видно только автору заметки,
  // не публикуется наружу.
  note_attachment: 'private',
  // Материалы библиотеки CRM (модуль library): общие материалы организации и
  // личная библиотека сотрудника. Приватный бакет, отдаются по временной
  // ссылке GET /library/items/:itemId/download.
  library_file: 'private',
};

