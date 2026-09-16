/** Тип сделки. Куратору реферальной сети начисляется 7% только с первички (решение владельца 16.09.2026). */
export const DEAL_TYPES = ['primary', 'secondary', 'rental', 'assignment'] as const;
export type DealType = (typeof DEAL_TYPES)[number];
