import { describe, expect, it } from 'vitest'
import {
  ADMIN_TREE_SIZES,
  branchKeys,
  hangerHalfWidth,
  hangerPlaces,
  initials,
  layoutNetwork,
  layoutTeam,
  type CardBox,
  type CuratorInput,
} from '../src/lib/referral-tree-layout'

function curator(id: string, members: number): CuratorInput {
  return { id, members: Array.from({ length: members }, (_, i) => ({ id: `${id}-${i}`, status: 'active' as const })) }
}

function overlaps(a: CardBox, b: CardBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function expectNoOverlaps(cards: CardBox[]) {
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) expect(overlaps(cards[i]!, cards[j]!), `${cards[i]!.key} / ${cards[j]!.key}`).toBe(false)
  }
}

describe('дерево сети сверху вниз', () => {
  it('пустая сеть — только BAZA', () => {
    const layout = layoutNetwork([], new Set())
    expect(layout.cards).toHaveLength(1)
    expect(layout.cards[0]).toMatchObject({ kind: 'root', parentKey: null })
    expect(layout.connectors).toHaveLength(0)
  })

  it('свёрнутые команды не рисуются: кураторы в ряд под BAZA, BAZA над серединой ряда', () => {
    const layout = layoutNetwork([curator('a', 3), curator('b', 6), curator('c', 0)], new Set())
    const curators = layout.cards.filter((c) => c.kind === 'curator')
    const root = layout.cards.find((c) => c.kind === 'root')!

    expect(layout.cards.filter((c) => c.kind === 'member')).toHaveLength(0)
    expect(new Set(curators.map((c) => c.y)).size).toBe(1)
    expect(curators[0]!.y).toBeGreaterThan(root.y + root.height)
    const firstCenter = curators[0]!.x + curators[0]!.width / 2
    const lastCenter = curators.at(-1)!.x + curators.at(-1)!.width / 2
    expect(root.x + root.width / 2).toBeCloseTo((firstCenter + lastCenter) / 2, 5)
    expect(layout.connectors.map((c) => c.targetKey)).toEqual(['curator:a', 'curator:b', 'curator:c'])
    expectNoOverlaps(layout.cards)
  })

  it('раскрытая команда висит под своим куратором и не наезжает на соседей', () => {
    const layout = layoutNetwork([curator('a', 9), curator('b', 22), curator('c', 2)], new Set(['a', 'b', 'c']))
    const members = layout.cards.filter((c) => c.kind === 'member')

    expect(members).toHaveLength(33)
    expect(layout.connectors).toHaveLength(36)
    for (const member of members) {
      const parent = layout.cards.find((c) => c.key === member.parentKey)!
      expect(member.y).toBeGreaterThan(parent.y + parent.height)
    }
    expectNoOverlaps(layout.cards)
    for (const card of layout.cards) {
      expect(card.x).toBeGreaterThanOrEqual(0)
      expect(card.x + card.width).toBeLessThanOrEqual(layout.width)
      expect(card.y + card.height).toBeLessThanOrEqual(layout.height)
    }
  })

  it('«вешалка»: ряд заполняется от стержня наружу, по perSide с каждой стороны', () => {
    const stemX = 1000
    const wide = { ...ADMIN_TREE_SIZES, perSide: 2 }
    const places = hangerPlaces(5, stemX, 0, wide)
    expect(places.map((p) => p.side)).toEqual(['left', 'right', 'left', 'right', 'left'])
    expect(places[0]!.x + ADMIN_TREE_SIZES.member.width).toBeLessThan(stemX)
    expect(places[1]!.x).toBeGreaterThan(stemX)
    expect(places[2]!.x).toBeLessThan(places[0]!.x)
    expect(places[4]!.y).toBeGreaterThan(places[0]!.y)
    for (const place of places) {
      expect(Math.abs(place.x + (place.side === 'left' ? wide.member.width : 0) - stemX)).toBeLessThanOrEqual(hangerHalfWidth(wide))
    }

    const narrow = { ...ADMIN_TREE_SIZES, perSide: 1 }
    const rows = new Set(hangerPlaces(4, stemX, 0, narrow).map((p) => p.y))
    expect(rows.size).toBe(2)
  })

  it('одна команда для кабинета: куратор сверху по центру', () => {
    const layout = layoutTeam(curator('me', 7))
    const top = layout.cards[0]!
    expect(top.kind).toBe('curator')
    expect(top.x + top.width / 2).toBeCloseTo(layout.width / 2, 5)
    expect(layout.cards.filter((c) => c.kind === 'member')).toHaveLength(7)
    expectNoOverlaps(layout.cards)
  })

  it('ветка карточки — она сама, предки и дети', () => {
    const layout = layoutNetwork([curator('a', 2), curator('b', 1)], new Set(['a', 'b']))
    expect([...branchKeys(layout, 'curator:a')].sort()).toEqual(['curator:a', 'member:a-0', 'member:a-1', 'root'])
    expect(branchKeys(layout, 'member:b-0')).toEqual(new Set(['member:b-0', 'curator:b', 'root']))
  })

  it('инициалы из имени и из почты', () => {
    expect(initials('Анна Кураторова')).toBe('АК')
    expect(initials('anna.k@example.test')).toBe('AK')
    expect(initials('Борис')).toBe('БО')
  })
})
