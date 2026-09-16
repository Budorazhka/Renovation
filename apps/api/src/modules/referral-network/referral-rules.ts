import { randomBytes } from 'node:crypto';
import type { MoneyAmount } from '@baza/contracts';

/**
 * Правила реферальной сети BAZA — решения владельца 16.09.2026
 * (docs/plans/2026-09-16-mlm-curator-network.md). Здесь только чистые
 * функции: ни базы, ни времени сервера — их удобно проверять и нельзя
 * случайно поменять вместе с хранением.
 */

/** Куратор получает эту долю комиссии агента из своей команды. Копируется в каждое начисление. */
export const CURATOR_RATE_PERCENT = 7;

/** Начисление идёт только со сделок первичного рынка. */
export const ACCRUING_DEAL_TYPE = 'primary';

/** Команда на старте: от 5 человек. */
export const TEAM_SIZE_MIN = 5;

/** Идеальная команда: до 20 человек, дальше — набирать новую. Не запрет, а подсказка. */
export const TEAM_SIZE_IDEAL_MAX = 20;

export type TeamSizeStatus = 'recruiting' | 'healthy' | 'time_to_split';

/**
 * Статус размера команды. Решение владельца: система подсказывает, а не
 * запрещает — 21-го человека добавить можно.
 */
export function teamSizeStatus(size: number): TeamSizeStatus {
  if (size < TEAM_SIZE_MIN) return 'recruiting';
  if (size > TEAM_SIZE_IDEAL_MAX) return 'time_to_split';
  return 'healthy';
}

/**
 * 7% от фактической комиссии, в валюте сделки, до минорной единицы.
 * Округление к ближайшему целому: 3 000,05 $ × 7% = 210,0035 $ → 210,00 $.
 */
export function curatorAccrualAmount(commission: MoneyAmount, ratePercent = CURATOR_RATE_PERCENT): MoneyAmount {
  return {
    amountMinorUnits: Math.round((commission.amountMinorUnits * ratePercent) / 100),
    currency: commission.currency,
  };
}

/** Алфавит кода приглашения без похожих символов (0/O, 1/I/L): код читают вслух и переписывают руками. */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  return code;
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export interface CompanyAffiliation {
  organizationId: string | null;
  organizationType: string | null;
}

/**
 * Решение владельца 16.09: сотрудник агентства не может состоять в команде
 * куратора из другой компании. Независимый риэлтор (своя организация типа
 * independent_realtor) и человек без организации — могут.
 */
export function isCompanyCompatible(member: CompanyAffiliation, curator: CompanyAffiliation): boolean {
  if (member.organizationType !== 'agency') return true;
  return member.organizationId !== null && member.organizationId === curator.organizationId;
}
