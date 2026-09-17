/**
 * До 17.09.2026 SecurityTab.tsx держал MOCK_SESSIONS — три захардкоженные
 * сессии с вымышленными IP, городами вроде «Москва, RU» и датой «14 марта
 * 2026 09:41» прямо в JSX. Ловит регресс: если кто-то снова заведёт
 * захардкоженные сессии вместо чтения через platformAuthApi.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const FILE = 'src/components/settings/SecurityTab.tsx'

describe('SecurityTab не содержит вымышленных сессий', () => {
  it('не ссылается на MOCK_SESSIONS', () => {
    const source = readFileSync(resolve(process.cwd(), FILE), 'utf8')
    expect(source).not.toContain('MOCK_SESSIONS')
  })

  it('читает сессии через platformAuthApi', () => {
    const source = readFileSync(resolve(process.cwd(), FILE), 'utf8')
    expect(source).toContain("from '@/services/platformAuthApi'")
    expect(source).toContain('platformAuthApi.listSessions')
    expect(source).toContain('platformAuthApi.revokeSession')
  })
})
