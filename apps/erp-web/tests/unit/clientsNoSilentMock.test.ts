/**
 * Клиенты ERP (N-20) переведены с `clients-mock`/sessionStorage на
 * CrmService.CrmContactReadModel (GET/POST/PATCH /api/v1/contacts) — тот же
 * принцип, что personnelRegistryNoMock.test.ts для реестра команды. Ловит
 * регресс: если кто-то снова заимпортирует `data/clients-mock` в список,
 * карточку или форму создания клиента, экран опять начнёт молча показывать
 * восемь вымышленных клиентов вместо реальной базы организации.
 *
 * `components/deals/DealCardPage.tsx` в список НЕ входит: там
 * `CLIENTS_MOCK` — защитный fallback внутри легаси-поиска ссылки на лид
 * (`d.clientId`, id вида "cl-1"), недостижимый для сделок с сервера (их
 * `clientId` — настоящий contactId), отдельная задача если понадобится
 * убрать мёртвый код.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REGISTRY_FILES = [
  'src/components/clients/ClientsListPage.tsx',
  'src/components/clients/CreateClientModal.tsx',
  'src/components/clients/ClientCardPage.tsx',
]

describe('клиенты ERP не импортируют clients-mock', () => {
  it.each(REGISTRY_FILES)('%s не ссылается на data/clients-mock', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    expect(source).not.toContain('clients-mock')
    expect(source).not.toContain('CLIENTS_MOCK')
  })

  it.each(REGISTRY_FILES)('%s читает данные через contactsApiV2', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    expect(source).toContain("from '@/services/contactsApiV2'")
  })
})
