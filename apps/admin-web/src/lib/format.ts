import type { PublicationStatus } from '../types/admin'

const STATUS_LABELS: Record<PublicationStatus, string> = {
  publication_pending: 'Готовится к публикации',
  published: 'Опубликовано',
  unpublished: 'Снято с публикации',
  build_failed: 'Ошибка сборки',
}

export function publicationStatusLabel(status: string): string {
  return STATUS_LABELS[status as PublicationStatus] ?? status
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  development: 'ЖК',
  unit: 'Юнит',
  listing: 'Объявление',
}

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}

const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает проверки',
  resolved_upheld: 'Удовлетворена (снято)',
  resolved_dismissed: 'Отклонена',
}

export function complaintStatusLabel(status: string): string {
  return COMPLAINT_STATUS_LABELS[status] ?? status
}

const COMPLAINT_CATEGORY_LABELS: Record<string, string> = {
  not_available: 'Объект недоступен / сдан',
  wrong_info: 'Недостоверная информация',
  scam: 'Мошенничество',
  duplicate: 'Дубликат',
  other: 'Другое',
}

export function complaintCategoryLabel(category: string): string {
  return COMPLAINT_CATEGORY_LABELS[category] ?? category
}

const DUPLICATE_CANDIDATE_STATUS_LABELS: Record<string, string> = {
  detected: 'Обнаружен системой',
  override_not_duplicate: 'Оспорен автором (не дубль)',
  confirmed_duplicate: 'Подтверждён администратором',
}

export function duplicateCandidateStatusLabel(status: string): string {
  return DUPLICATE_CANDIDATE_STATUS_LABELS[status] ?? status
}

const REALTOR_REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает проверки',
  approved: 'Одобрен',
  rejected: 'Отклонён',
}

export function realtorReviewStatusLabel(status: string): string {
  return REALTOR_REVIEW_STATUS_LABELS[status] ?? status
}

const ORGANIZATION_TYPE_LABELS: Record<string, string> = {
  agency: 'Агентство',
  developer: 'Застройщик',
  independent_realtor: 'Частный риелтор',
}

export function organizationTypeLabel(type: string): string {
  return ORGANIZATION_TYPE_LABELS[type] ?? type
}

const ORGANIZATION_STATUS_LABELS: Record<string, string> = {
  active: 'Активна',
  frozen: 'Заморожена',
  archived: 'В архиве',
}

export function organizationStatusLabel(status: string): string {
  return ORGANIZATION_STATUS_LABELS[status] ?? status
}
