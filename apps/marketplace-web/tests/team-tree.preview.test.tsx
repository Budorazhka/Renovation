/**
 * Не проверка, а превью: рисует дерево команды в HTML, чтобы посмотреть на
 * него глазами. Запускается только с TEAM_TREE_PREVIEW=путь.
 */
import React from 'react'
import { readFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'
import { I18nProvider } from '../src/i18n'
import { TeamTree } from '../src/features/referral/components/TeamTree'

const target = process.env.TEAM_TREE_PREVIEW

const NAMES = [
  'Нино Беридзе', 'Георгий Абашидзе', 'Мариам Кацарава', 'Давид Гелашвили', 'Анна Смирнова', 'Лука Джапаридзе',
  'Тамара Чхеидзе', 'Сандро Микеладзе', 'Екатерина Орлова', 'Ираклий Табидзе', 'Софья Лебедева',
]

describe.skipIf(!target)('превью дерева команды', () => {
  it('пишет HTML', () => {
    const css = ['src/styles/tokens.css', 'src/styles/referral-team.css'].map((file) => readFileSync(file, 'utf8')).join('\n')
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <div className="team-page">
          <section className="team-card team-card--tree">
            <TeamTree
              curator={{ id: 'c', name: 'Анна Кураторова' }}
              members={NAMES.map((name, i) => ({ id: `m${i}`, name, joinedVia: i % 3 === 0 ? 'admin' : 'invite_link', status: i === 3 ? 'on_review' : 'active' }))}
            />
          </section>
        </div>
      </I18nProvider>,
    )
    const noAnimation = 'body{margin:0;padding:24px;background:#f1f7eb;font-family:sans-serif}'
    writeFileSync(target!, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}${noAnimation}</style></head><body>${markup}</body></html>`)
  })
})
