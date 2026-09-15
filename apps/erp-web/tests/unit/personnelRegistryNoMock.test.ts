/**
 * Реестр команды (TEAM-001) переведён с `personnel-mock`/localStorage на
 * Platform API — см. docs/operations/erp-tasks-mock-debt-closed.md для
 * аналогичного закрытия по задачам. Этот тест ловит регресс: если кто-то
 * снова заимпортирует `data/personnel-mock` (или его мок-массив
 * `MOCK_EMPLOYEES`) в один из файлов реестра, сборка данных для карточек
 * сотрудников снова начнёт молча подмешивать вымышленных людей.
 *
 * Типы `Employee`/`EmployeeRole` и справочные таблицы `ROLE_LABELS`/
 * `ROLE_COLORS` вынесены в `@/types/personnel` ровно для того, чтобы этим
 * файлам не приходилось трогать «мок»-модуль ради одних только типов.
 *
 * `WidgetTeam.tsx` в список не входит: он не использует `personnel-mock`
 * вообще (его источник мока — `leads-mock`, отдельная нерешённая задача
 * миграции лидов, см. комментарий в самом файле).
 * `MyReportPage.tsx`/`SetPlansModal.tsx` тоже не входят: личный KPI
 * пока на моке отдельной задачей этапа 6 мастер-плана. Отчёт по команде
 * (бывший TeamReportPage) с 15.09.2026 — «Аналитика» на /crm/reports.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REGISTRY_FILES = [
  'src/services/teamApi.ts',
  'src/components/personnel/PersonnelPage.tsx',
  'src/data/personnel-permissions.ts',
]

describe('реестр команды не импортирует personnel-mock', () => {
  it.each(REGISTRY_FILES)('%s не ссылается на data/personnel-mock', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    expect(source).not.toContain('personnel-mock')
    expect(source).not.toContain('MOCK_EMPLOYEES')
  })

  it('personnel-mock.ts хранит MOCK_EMPLOYEES только как фикстуру для KPI-контура, не как экспорт для реестра', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/data/personnel-mock.ts'), 'utf8')
    expect(source).toContain('MOCK_EMPLOYEES')
    // Типы больше не определяются здесь — только реэкспортируются из non-mock модуля.
    expect(source).toContain("from '@/types/personnel'")
  })
})
