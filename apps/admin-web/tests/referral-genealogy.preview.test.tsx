/**
 * Не проверка, а превью: рисует дерево сети на правдоподобных данных в HTML,
 * чтобы посмотреть на него глазами. Запускается только с
 * REFERRAL_TREE_PREVIEW=путь.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'
import { ReferralGenealogy } from '../src/components/ReferralGenealogy'
import type { AdminCuratorNode, TeamSizeStatus } from '../src/types/referral'

const target = process.env.REFERRAL_TREE_PREVIEW

const NAMES = [
  'Нино Беридзе', 'Георгий Абашидзе', 'Мариам Кацарава', 'Давид Гелашвили', 'Анна Смирнова', 'Лука Джапаридзе',
  'Тамара Чхеидзе', 'Сандро Микеладзе', 'Екатерина Орлова', 'Ираклий Табидзе', 'Софья Лебедева', 'Ника Долидзе',
]

function curator(id: string, name: string, org: string, size: number, status: TeamSizeStatus, onReview = 0): AdminCuratorNode {
  const person = (pid: string, pname: string, porg: string | null) => ({
    identityId: pid,
    name: pname,
    login: `${pid}@baza.ge`,
    organizationName: porg,
    organizationType: 'agency',
  })
  return {
    person: person(id, name, org),
    appointedAt: '2026-09-01T10:00:00.000Z',
    teamSize: size - onReview,
    teamStatus: status,
    inviteCode: 'ABCD2345',
    totals: { earned: [], paid: [], due: [] },
    members: Array.from({ length: size }, (_, i) => ({
      person: person(`${id}-${i}`, NAMES[(i * 5 + id.length) % NAMES.length]!, org),
      joinedAt: '2026-09-05T10:00:00.000Z',
      joinedVia: i % 3 === 0 ? ('admin' as const) : ('invite_link' as const),
      status: i < onReview ? ('on_review' as const) : ('active' as const),
    })),
  }
}

describe.skipIf(!target)('превью дерева сети', () => {
  it('пишет HTML', () => {
    const css = readFileSync('src/styles/app.css', 'utf8') + readFileSync('src/styles/referral.css', 'utf8')
    const curators = [
      curator('c1', 'Анна Кураторова', 'Агентство «Батуми Хоум»', 9, 'healthy', 1),
      curator('c2', 'Георгий Мамулашвили', 'Независимый риэлтор', 3, 'recruiting'),
      curator('c3', 'Тамара Квирикашвили', 'Агентство «Морской»', 22, 'time_to_split'),
      curator('c4', 'Давид Церетели', 'Агентство «Батуми Хоум»', 6, 'healthy'),
    ]
    const markup = renderToStaticMarkup(
      <ReferralGenealogy
        curators={curators}
        rules={{ ratePercent: 7, teamSizeMin: 5, teamSizeIdealMax: 20 }}
        expanded={new Set(['c1', 'c2'])}
        onToggle={() => {}}
        selectedKey="member:c1-2"
        onSelect={() => {}}
        focusKey={null}
      />,
    )
    const preview =
      '.genealogy{overflow:visible;display:inline-block}.genealogy__viewport{height:auto!important;min-height:0;overflow:visible}.genealogy__canvas{position:relative;animation:none}.genealogy-card{animation:none!important}body{padding:24px}'
    writeFileSync(target!, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}${preview}</style></head><body>${markup}</body></html>`)
  })
})
