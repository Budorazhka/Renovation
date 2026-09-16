/**
 * Не проверка, а превью: рисует дерево команды ERP в HTML, чтобы посмотреть
 * на него глазами. Запускается только с ERP_TEAM_TREE_PREVIEW=путь.
 */
import { createElement } from 'react'
import { readFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'

const target = process.env.ERP_TEAM_TREE_PREVIEW

const NAMES = [
  'Нино Беридзе', 'Георгий Абашидзе', 'Мариам Кацарава', 'Давид Гелашвили', 'Анна Смирнова', 'Лука Джапаридзе',
  'Тамара Чхеидзе', 'Сандро Микеладзе', 'Екатерина Орлова',
]

describe.skipIf(!target)('превью дерева команды ERP', () => {
  it('пишет HTML', async () => {
    // Язык ERP читается из localStorage: для превью — русский.
    Object.assign(globalThis, { window: { localStorage: { getItem: () => 'ru', setItem: () => {} } } })
    const { ReferralTeamTree } = await import('@/components/referral/ReferralTeamTree')
    const { LanguageProvider } = await import('@/i18n/LanguageProvider')

    const css = readFileSync('src/components/referral/referral-team-tree.css', 'utf8')
    const members = NAMES.map((name, i) => ({
      id: `m${i}`,
      name,
      joinedVia: i % 3 === 0 ? ('admin' as const) : ('invite_link' as const),
      status: i === 2 ? ('on_review' as const) : ('active' as const),
    }))
    const card = (child: ReturnType<typeof createElement>) =>
      createElement('div', { style: { background: '#112d1c', borderRadius: 6, padding: 20 } }, child)
    const markup = renderToStaticMarkup(
      createElement(
        LanguageProvider,
        null,
        createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 24, padding: 24, maxWidth: 1052 } },
          card(createElement(ReferralTeamTree, { curatorName: 'Анна Кураторова', members })),
          card(createElement(ReferralTeamTree, { curatorName: 'Тамара Квирикашвили', members, collapsible: true, teamStatus: 'healthy' })),
        ),
      ),
    )
    const base = 'body{margin:0;background:#06130f;color:#fff;font-family:Montserrat,sans-serif}'
    writeFileSync(target!, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}${base}</style></head><body>${markup}</body></html>`)
  })
})
