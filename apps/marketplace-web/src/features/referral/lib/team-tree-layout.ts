/**
 * Раскладка команды куратора «вешалкой» — по исследованию
 * docs/research/2026-09-16-referral-tree-ux.md: куратор сверху, от него
 * вертикальный стержень, участники рядами по обе стороны. Ряд заполняется
 * от стержня наружу, слева и справа по очереди, — маленькая команда остаётся
 * по центру. На широком экране по двое с каждой стороны, на узком по одному.
 *
 * Чистая функция: только номер ряда и колонки в сетке. Рисует CSS.
 */

export interface HangerPlace {
  /** Ряд, с 1. */
  row: number
  /** Колонка CSS-сетки, с 1; стержень — колонка perSide + 1. */
  column: number
  side: 'left' | 'right'
  /** 0 — рядом со стержнем, 1 — дальше. */
  depth: number
}

export function hangerPlace(index: number, perSide: number): HangerPlace {
  const perRow = perSide * 2
  const slot = index % perRow
  const side = slot % 2 === 0 ? 'left' : 'right'
  const depth = Math.floor(slot / 2)
  const stem = perSide + 1
  return {
    row: Math.floor(index / perRow) + 1,
    column: side === 'left' ? stem - 1 - depth : stem + 1 + depth,
    side,
    depth,
  }
}

export function hangerRows(count: number, perSide: number): number {
  return Math.max(1, Math.ceil(count / (perSide * 2)))
}

/** Инициалы: «Анна Кураторова» → «АК», почта → первые две буквы. */
export function initials(name: string): string {
  const words = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}
