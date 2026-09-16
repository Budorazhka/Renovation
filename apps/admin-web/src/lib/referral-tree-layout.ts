/**
 * Раскладка дерева реферальной сети BAZA «сверху вниз» — по исследованию
 * docs/research/2026-09-16-referral-tree-ux.md:
 *
 * - классическое дерево читается надёжнее радиального (Burch и соавт., 2011);
 * - узел — карточка с горизонтальным текстом, как в MLM-«генеалогиях»;
 * - команда куратора — «вешалкой»: рядами не больше четырёх, по двое с
 *   каждой стороны от вертикального стержня (draw.io, Hanger 4). У нас все
 *   участники — листья, поэтому стопка не создаёт пересечений линий;
 * - команды свёрнуты, пока их не раскрыли: на свёрнутом кураторе — счётчик.
 *
 * Чистая функция: координаты карточек и пути связей. Компонент только рисует.
 */

export type TeamStatus = 'recruiting' | 'healthy' | 'time_to_split'
export type MemberStatus = 'active' | 'on_review'
export type CardKind = 'root' | 'curator' | 'member'

export interface MemberInput {
  id: string
  status: MemberStatus
}

export interface CuratorInput {
  id: string
  members: MemberInput[]
}

export interface CardBox {
  key: string
  kind: CardKind
  id: string
  x: number
  y: number
  width: number
  height: number
  parentKey: string | null
}

export interface Connector {
  key: string
  targetKey: string
  path: string
}

export interface TreeLayout {
  cards: CardBox[]
  connectors: Connector[]
  width: number
  height: number
}

export interface TreeSizes {
  root: { width: number; height: number }
  curator: { width: number; height: number }
  member: { width: number; height: number }
  /** Между соседними карточками одной стороны «вешалки». */
  memberGap: number
  /** Между стержнем и ближними карточками — место под линию. */
  stemGap: number
  rowGap: number
  levelGap: number
  groupGap: number
  margin: number
  /** Карточек с каждой стороны стержня: 2 — «вешалка на четыре», 1 — узкий экран. */
  perSide: number
  /** Радиус скругления изломов связей. */
  corner: number
}

export const ADMIN_TREE_SIZES: TreeSizes = {
  root: { width: 300, height: 64 },
  curator: { width: 280, height: 108 },
  member: { width: 204, height: 60 },
  memberGap: 14,
  stemGap: 32,
  rowGap: 12,
  levelGap: 56,
  groupGap: 40,
  margin: 28,
  perSide: 2,
  corner: 8,
}

export const rootKey = 'root'
export const curatorKey = (id: string) => `curator:${id}`
export const memberKey = (id: string) => `member:${id}`

/** Сколько места занимает «вешалка» по горизонтали от стержня до края. */
export function hangerHalfWidth(sizes: TreeSizes): number {
  return sizes.stemGap / 2 + sizes.perSide * sizes.member.width + (sizes.perSide - 1) * sizes.memberGap
}

/**
 * Места участников «вешалкой». Порядок заполнения ряда — от стержня наружу,
 * слева и справа по очереди: маленькая команда остаётся по центру.
 */
export function hangerPlaces(
  count: number,
  stemX: number,
  top: number,
  sizes: TreeSizes,
): Array<{ x: number; y: number; side: 'left' | 'right' }> {
  const perRow = sizes.perSide * 2
  const { width, height } = sizes.member
  const places: Array<{ x: number; y: number; side: 'left' | 'right' }> = []
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow)
    const slot = index % perRow
    const side = slot % 2 === 0 ? 'left' : 'right'
    const depth = Math.floor(slot / 2)
    const offset = sizes.stemGap / 2 + depth * (width + sizes.memberGap)
    const x = side === 'left' ? stemX - offset - width : stemX + offset
    places.push({ x, y: top + row * (height + sizes.rowGap), side })
  }
  return places
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/** Вертикальная линия с горизонтальным ответвлением и скруглённым изломом. */
function elbow(fromX: number, fromY: number, toX: number, toY: number, corner: number): string {
  if (Math.abs(toX - fromX) < 0.5) return `M${round(fromX)},${round(fromY)} V${round(toY)}`
  const r = Math.min(corner, Math.abs(toX - fromX) / 2, Math.abs(toY - fromY) / 2)
  const dir = toX > fromX ? 1 : -1
  return `M${round(fromX)},${round(fromY)} V${round(toY - r)} Q${round(fromX)},${round(toY)} ${round(fromX + dir * r)},${round(toY)} H${round(toX)}`
}

/** Команда под картинкой родителя: стержень и ответвления к каждой карточке. */
function layoutTeamUnder(
  parent: CardBox,
  members: MemberInput[],
  sizes: TreeSizes,
  cards: CardBox[],
  connectors: Connector[],
): number {
  if (members.length === 0) return parent.y + parent.height
  const stemX = parent.x + parent.width / 2
  const top = parent.y + parent.height + sizes.levelGap * 0.6
  const places = hangerPlaces(members.length, stemX, top, sizes)
  let bottom = top

  members.forEach((member, index) => {
    const place = places[index]!
    const key = memberKey(member.id)
    cards.push({
      key,
      kind: 'member',
      id: member.id,
      x: place.x,
      y: place.y,
      width: sizes.member.width,
      height: sizes.member.height,
      parentKey: parent.key,
    })
    const midY = place.y + sizes.member.height / 2
    const edgeX = place.side === 'left' ? place.x + sizes.member.width : place.x
    connectors.push({
      key: `${parent.key}->${key}`,
      targetKey: key,
      path: elbow(stemX, parent.y + parent.height, edgeX, midY, sizes.corner),
    })
    bottom = Math.max(bottom, place.y + sizes.member.height)
  })
  return bottom
}

/**
 * Вся сеть: BAZA сверху, кураторы рядом ниже, команда — «вешалкой» под
 * каждым раскрытым куратором. Ширина блока куратора растёт только когда его
 * команда раскрыта — свёрнутая сеть остаётся компактной.
 */
export function layoutNetwork(curators: CuratorInput[], expanded: ReadonlySet<string>, sizes: TreeSizes = ADMIN_TREE_SIZES): TreeLayout {
  const cards: CardBox[] = []
  const connectors: Connector[] = []
  const curatorsTop = sizes.margin + sizes.root.height + sizes.levelGap
  const teamWidth = hangerHalfWidth(sizes) * 2

  let cursor = sizes.margin
  let bottom = curatorsTop
  const curatorCards: CardBox[] = []

  for (const curator of curators) {
    const open = expanded.has(curator.id) && curator.members.length > 0
    const blockWidth = open ? Math.max(sizes.curator.width, teamWidth) : sizes.curator.width
    const centerX = cursor + blockWidth / 2
    const card: CardBox = {
      key: curatorKey(curator.id),
      kind: 'curator',
      id: curator.id,
      x: centerX - sizes.curator.width / 2,
      y: curatorsTop,
      width: sizes.curator.width,
      height: sizes.curator.height,
      parentKey: rootKey,
    }
    cards.push(card)
    curatorCards.push(card)
    bottom = Math.max(bottom, card.y + card.height)
    if (open) bottom = Math.max(bottom, layoutTeamUnder(card, curator.members, sizes, cards, connectors))
    cursor += blockWidth + sizes.groupGap
  }

  const contentRight = curators.length > 0 ? cursor - sizes.groupGap : sizes.margin + sizes.root.width
  const spanLeft = curatorCards[0] ? curatorCards[0].x + sizes.curator.width / 2 : sizes.margin + sizes.root.width / 2
  const spanRight = curatorCards.at(-1) ? curatorCards.at(-1)!.x + sizes.curator.width / 2 : spanLeft
  const rootCenter = (spanLeft + spanRight) / 2
  const root: CardBox = {
    key: rootKey,
    kind: 'root',
    id: rootKey,
    x: rootCenter - sizes.root.width / 2,
    y: sizes.margin,
    width: sizes.root.width,
    height: sizes.root.height,
    parentKey: null,
  }
  cards.unshift(root)

  // Шина: из BAZA вниз, по горизонтали над кураторами, к каждому — капля вниз.
  const busY = root.y + root.height + sizes.levelGap / 2
  for (const card of curatorCards) {
    const x = card.x + card.width / 2
    connectors.push({
      key: `${rootKey}->${card.key}`,
      targetKey: card.key,
      path: `M${round(rootCenter)},${round(root.y + root.height)} V${round(busY)} H${round(x)} V${round(card.y)}`,
    })
  }

  return {
    cards,
    connectors,
    width: Math.max(contentRight, root.x + root.width) + sizes.margin,
    height: bottom + sizes.margin,
  }
}

/** Одна команда: куратор сверху, участники «вешалкой». Для кабинета куратора. */
export function layoutTeam(curator: CuratorInput, sizes: TreeSizes = ADMIN_TREE_SIZES): TreeLayout {
  const cards: CardBox[] = []
  const connectors: Connector[] = []
  const width = Math.max(sizes.curator.width, curator.members.length > 0 ? hangerHalfWidth(sizes) * 2 : 0) + sizes.margin * 2
  const card: CardBox = {
    key: curatorKey(curator.id),
    kind: 'curator',
    id: curator.id,
    x: width / 2 - sizes.curator.width / 2,
    y: sizes.margin,
    width: sizes.curator.width,
    height: sizes.curator.height,
    parentKey: null,
  }
  cards.push(card)
  const bottom = layoutTeamUnder(card, curator.members, sizes, cards, connectors)
  return { cards, connectors, width, height: bottom + sizes.margin }
}

/** Ключи ветки: карточка, её предок и дети — для подсветки. */
export function branchKeys(layout: TreeLayout, key: string): Set<string> {
  const byKey = new Map(layout.cards.map((card) => [card.key, card]))
  const keys = new Set<string>([key])
  let current = byKey.get(key)
  while (current?.parentKey) {
    keys.add(current.parentKey)
    current = byKey.get(current.parentKey)
  }
  for (const card of layout.cards) if (card.parentKey === key) keys.add(card.key)
  return keys
}

/** Инициалы: «Анна Кураторова» → «АК», почта → первые две буквы. */
export function initials(name: string): string {
  const words = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}
