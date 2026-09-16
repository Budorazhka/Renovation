/**
 * Подборки вторичного рынка (N-27) переведены с localStorage/моков
 * (`data/selections-mock`, `data/selection-catalog-mock`, `lib/selections-storage`)
 * на реальный API `/api/v1/selections` через `useDevSelectionsStore`/`devSelectionsApiV2`
 * (те же клиентские подборки, что у новостроек — различаются только
 * `targetType` элемента). Ловит регресс: если кто-то снова заимпортирует один
 * из мок-источников в список/карточку/форму создания подборки вторички или в
 * панель подборок чатов, экран опять начнёт молча показывать вымышленные
 * подборки вместо реальных данных организации.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const DEAD_MOCK_MARKERS = ['SELECTIONS_MOCK', 'selections-storage', 'selection-catalog-mock']

const REGISTRY_FILES = [
  'src/components/selections/SelectionsListPage.tsx',
  'src/components/selections/SelectionsNewPage.tsx',
  'src/components/selections/SelectionCardPage.tsx',
]

describe('подборки вторички ERP не импортируют мок-источники', () => {
  it.each(REGISTRY_FILES)('%s не ссылается на мок-хранилище подборок', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    for (const marker of DEAD_MOCK_MARKERS) {
      expect(source).not.toContain(marker)
    }
  })

  it.each(REGISTRY_FILES)('%s читает данные через useDevSelectionsStore', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    expect(source).toContain("from '@/store/useDevSelectionsStore'")
  })

  it('панель подборок вторички в ChatsPage не ссылается на мок-хранилище', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/modules/ChatsPage.tsx'), 'utf8')
    for (const marker of DEAD_MOCK_MARKERS) {
      expect(source).not.toContain(marker)
    }
  })
})
