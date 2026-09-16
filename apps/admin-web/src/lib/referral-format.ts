import type {
  AccrualSkipReason,
  AccrualStatus,
  MoneyAmount,
  ReferralRequestStatus,
  ReferralRequestType,
  TeamSizeStatus,
} from '../types/referral'

/** Суммы приходят в минорных единицах: 21 000 → «210,00 $». Никаких float в расчётах — только в показе. */
export function formatMoney(money: MoneyAmount): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: money.currency }).format(
    money.amountMinorUnits / 100,
  )
}

/** Итог по валютам: «210,00 $ · 70,00 ₾»; пусто — тире. */
export function formatMoneyList(list: MoneyAmount[]): string {
  return list.length === 0 ? '—' : list.map(formatMoney).join(' · ')
}

/** «2 150,50» → 215050 минорных единиц. null — не число или не больше нуля. */
export function parseMoneyInput(raw: string): number | null {
  const normalized = raw.replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const minor = Math.round(Number(normalized) * 100)
  return minor > 0 ? minor : null
}

export function teamStatusLabel(status: TeamSizeStatus): string {
  if (status === 'recruiting') return 'Идёт набор'
  if (status === 'time_to_split') return 'Пора собирать новую команду'
  return 'В норме'
}

/** Короткая подпись для карточки дерева: полная не помещается рядом со счётчиком. */
export function teamStatusShortLabel(status: TeamSizeStatus): string {
  if (status === 'time_to_split') return 'Пора новую команду'
  return teamStatusLabel(status)
}

export function requestTypeLabel(type: ReferralRequestType): string {
  if (type === 'become_curator') return 'Стать куратором'
  if (type === 'leave_team') return 'Уйти из команды'
  return 'Сменить куратора'
}

export function requestStatusLabel(status: ReferralRequestStatus): string {
  if (status === 'approved') return 'Одобрена'
  if (status === 'rejected') return 'Отклонена'
  return 'Ждёт решения'
}

export function accrualStatusLabel(status: AccrualStatus): string {
  if (status === 'paid') return 'Выплачено'
  if (status === 'reversed') return 'Отменено'
  return 'К выплате'
}

/** Почему по сделке нет начисления — словами для менеджера BAZA. */
export function accrualSkipReasonLabel(reason: AccrualSkipReason): string {
  switch (reason) {
    case 'not_primary':
      return 'сделка не на первичном рынке'
    case 'no_occupant':
      return 'должность агента сейчас пустая'
    case 'not_in_team':
      return 'агент не состоит в команде куратора'
    case 'membership_on_review':
      return 'связь агента с куратором под вопросом — решите её в реферальной сети'
    case 'company_mismatch':
      return 'агент работает в агентстве другой компании, чем куратор; связь поставлена под вопрос'
    case 'curator_retired':
      return 'куратор снят'
  }
}

export function membershipEndReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'left':
      return 'ушёл по заявке'
    case 'transferred':
      return 'переведён к другому куратору'
    case 'removed':
      return 'убран из команды'
    case 'curator_retired':
      return 'куратор снят'
    case 'became_curator':
      return 'сам стал куратором'
    default:
      return 'в команде сейчас'
  }
}

export function organizationTypeShort(type: string | null): string {
  if (type === 'agency') return 'агентство'
  if (type === 'independent_realtor') return 'независимый риэлтор'
  if (type === 'developer') return 'застройщик'
  return 'без компании'
}
