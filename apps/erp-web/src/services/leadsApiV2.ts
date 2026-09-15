import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'
import type {
  CreateLeadV2Payload,
  LeadFileV2,
  LeadStageChangeResult,
  LeadStageDefinitionsV2Response,
  LeadV2,
  ListLeadEventsV2Response,
  ListLeadsV2Params,
  ListLeadsV2Response,
  UpdateLeadV2Payload,
} from '@/types/leadsV2'

export * from '@/types/leadsV2'

/**
 * Изолированный клиент к новому API лидов BAZA (apps/api/src/modules/crm/lead.controller.ts).
 *
 * Эндпоинты:
 * - GET /api/v1/leads?stage=<optional>&ownerPositionId=<optional>&stalled=<optional>&cursor=<optional>&limit=<1..100>
 * - GET /api/v1/leads/:leadId
 * - POST /api/v1/leads body: CreateLeadV2Payload (требует заголовок Idempotency-Key)
 * - PATCH /api/v1/leads/:leadId body: UpdateLeadV2Payload — сопутствующие поля, не stage
 * - DELETE /api/v1/leads/:leadId — soft delete
 * - PATCH /api/v1/leads/:leadId/stage body: { stage: string, expectedVersion: number, comment?: string } (требует заголовок Idempotency-Key)
 * - POST /api/v1/leads/:leadId/assign body: { assigneePositionId: string }
 * - POST /api/v1/leads/:leadId/unassign
 * - GET/POST /api/v1/leads/:leadId/files, DELETE /api/v1/leads/:leadId/files/:assetId
 * - POST /api/v1/leads/:leadId/contact-actions body: { contactType: 'call'|'chat' }
 * - GET /api/v1/leads/:leadId/events
 *
 * Авторизация только через cookie (withCredentials: true).
 * Tenant и права проверяются бэкендом (organizationId не передаётся клиентом).
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

/** Предел одного запроса на стороне сервера (MAX_LEAD_LIST_LIMIT). */
const LEADS_PER_REQUEST = 100

/** Тот же предел страниц, что tasksApiV2.listAll — см. её докстринг. */
const MAX_LEAD_PAGES = 20

/**
 * Ключ идемпотентности: повтор отправки той же формы (двойной клик, ретрай
 * после обрыва) не должен создавать вторую сущность. Тот же паттерн, что
 * tasksApiV2.newIdempotencyKey/developmentsApiV2 — локальная копия, не
 * общий хелпер: каждый V2-клиент в erp-web изолирован намеренно.
 */
export function newIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const leadsApiV2 = {
  /** GET /api/v1/leads?stage=<optional>&limit=<1..100> */
  async list(params?: ListLeadsV2Params): Promise<ListLeadsV2Response> {
    const { data } = await api.get<ListLeadsV2Response>('/api/v1/leads', { params })
    return data
  },

  /**
   * Все лиды организации, а не первая страница (сервер отдаёт максимум 100
   * записей за запрос и `nextCursor`) — тот же паттерн, что
   * tasksApiV2.listAll. `complete: false` — упёрлись в предел страниц,
   * показаны не все лиды; это состояние обязано быть видно вызывающему
   * коду, а не молчать.
   */
  async listAll(
    params?: Omit<ListLeadsV2Params, 'cursor'>,
    maxPages = MAX_LEAD_PAGES,
  ): Promise<{ items: LeadV2[]; complete: boolean }> {
    const items: LeadV2[] = []
    let cursor: string | undefined
    let complete = false

    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.list({ ...params, limit: LEADS_PER_REQUEST, cursor })
      items.push(...response.items)
      if (!response.nextCursor) {
        complete = true
        break
      }
      cursor = response.nextCursor
    }

    return { items, complete }
  },

  /** GET /api/v1/leads/:id */
  async getById(id: string): Promise<LeadV2> {
    const { data } = await api.get<LeadV2>(`/api/v1/leads/${id}`)
    return data
  },

  /** POST /api/v1/leads. Заголовок Idempotency-Key обязателен — без него 400. */
  async create(payload: CreateLeadV2Payload, idempotencyKey: string): Promise<LeadV2> {
    const { data } = await api.post<LeadV2>('/api/v1/leads', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return data
  },

  /**
   * PATCH /api/v1/leads/:id/stage. expectedVersion — прочитанная клиентом
   * version лида (см. LeadV2.version) — backend отклонит запрос с 409
   * VERSION_CONFLICT, если лид изменился с момента, когда клиент его читал
   * (optimistic concurrency, 27.08.2026). Вызывающий код должен перечитать
   * лид и повторить попытку с новой version при 409, не считать это фатальной
   * ошибкой.
   *
   * `stage` типизирован как `string`, не `LeadStageV2` — продуктовые лиды
   * (sales/network/owner/agent) используют собственные id стадий (см.
   * lib/lead-v2-poker-adapter.ts), которых нет в generic-пятёрке
   * LeadStageV2; backend валидирует принадлежность стадии продукту лида
   * сам (CrmService.changeLeadStage).
   *
   * `idempotencyKey` опционален — генерируется на каждый вызов (одна
   * попытка смены стадии = один ключ), если вызывающий код не передал свой
   * (тот же паттерн, что tasksApiV2.create, но с дефолтом ради обратной
   * совместимости старых вызовов).
   */
  /**
   * `comment` — `[phase 3]` легаси createStageComment/getStageComments:
   * комментарий, привязанный к ЭТОМУ переходу (см. ChangeLeadStageDto.comment
   * докстринг на бэкенде). Опционален — не каждый переход комментируется;
   * отдаётся обратно через `leadsApiV2.listEvents`.
   */
  async changeStage(
    id: string,
    stage: string,
    expectedVersion: number,
    idempotencyKey: string = newIdempotencyKey(),
    comment?: string,
  ): Promise<LeadStageChangeResult> {
    const { data } = await api.patch<LeadStageChangeResult>(
      `/api/v1/leads/${id}/stage`,
      { stage, expectedVersion, comment },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    return data
  },

  /** POST /api/v1/leads/:id/assign */
  async assign(id: string, assigneePositionId: string): Promise<LeadStageChangeResult> {
    const { data } = await api.post<LeadStageChangeResult>(`/api/v1/leads/${id}/assign`, { assigneePositionId })
    return data
  },

  /** POST /api/v1/leads/:id/unassign — обратное действие assign, не меняет stage. */
  async unassign(id: string): Promise<LeadStageChangeResult> {
    const { data } = await api.post<LeadStageChangeResult>(`/api/v1/leads/${id}/unassign`)
    return data
  },

  /**
   * PATCH /api/v1/leads/:id — сопутствующие поля лида (см. UpdateLeadV2Payload
   * докстринг). НЕ трогает `stage` — им заведует `changeStage` выше. Не
   * версионирован (в отличие от stage): сервер не проверяет expectedVersion
   * для этих полей (LeadRepository.updateFields).
   */
  async update(id: string, patch: UpdateLeadV2Payload): Promise<LeadV2> {
    const { data } = await api.patch<LeadV2>(`/api/v1/leads/${id}`, patch)
    return data
  },

  /** DELETE /api/v1/leads/:id — soft delete (лид пропадает из списков/поиска, из базы не удаляется). */
  async remove(id: string): Promise<{ deleted: true }> {
    const { data } = await api.delete<{ deleted: true }>(`/api/v1/leads/${id}`)
    return data
  },

  /** GET /api/v1/leads/:id/files — легаси getLeadFiles. */
  async listFiles(id: string): Promise<LeadFileV2[]> {
    const { data } = await api.get<LeadFileV2[]>(`/api/v1/leads/${id}/files`)
    return data
  },

  /**
   * POST /api/v1/leads/:id/files — легаси uploadAndRegisterFile. `assetId` —
   * id уже подтверждённого (`status:'verified'`) MediaAsset, полученного
   * двухфазной загрузкой через `mediaApiV2.uploadFile(file, 'lead_attachment')`
   * (тот же паттерн, что вложения задач) либо файла библиотеки материалов.
   * `fileName` — имя для экрана; без него сервер показывает имя из storage
   * key («original.pdf»). Возвращает полный обновлённый список файлов лида.
   */
  async attachFile(id: string, assetId: string, fileName?: string): Promise<LeadFileV2[]> {
    const { data } = await api.post<LeadFileV2[]>(`/api/v1/leads/${id}/files`, fileName ? { assetId, fileName } : { assetId })
    return data
  },

  /** GET /api/v1/leads/:id/files/:assetId/download — временная ссылка на оригинал файла (у PDF и файлов библиотеки нет `url` в списке). */
  async getFileDownloadUrl(id: string, assetId: string): Promise<string> {
    const { data } = await api.get<{ url: string; fileName: string }>(`/api/v1/leads/${id}/files/${assetId}/download`)
    return data.url
  },

  /** DELETE /api/v1/leads/:id/files/:assetId — легаси deleteLeadFileByName (по assetId, не по имени файла). Возвращает обновлённый список файлов лида. */
  async removeFile(id: string, assetId: string): Promise<LeadFileV2[]> {
    const { data } = await api.delete<LeadFileV2[]>(`/api/v1/leads/${id}/files/${assetId}`)
    return data
  },

  /**
   * POST /api/v1/leads/:id/contact-actions — легаси recordLeadContactAction.
   * Fire-and-forget append-only audit-лог: ответ не несёт данных для
   * отображения (не read-модель), вызывающий код не должен пытаться
   * построить из него список прошлых звонков/чатов.
   */
  async recordContactAction(id: string, contactType: 'call' | 'chat'): Promise<{ recorded: true }> {
    const { data } = await api.post<{ recorded: true }>(`/api/v1/leads/${id}/contact-actions`, { contactType })
    return data
  },

  /** GET /api/v1/leads/:id/events — история переходов стадии (включая `comment`, если был передан при смене). Только переходы стадии — НЕ общая лента действий с лидом (задачи и т.п. сюда не попадают). */
  async listEvents(id: string, params?: { cursor?: string; limit?: number }): Promise<ListLeadEventsV2Response> {
    const { data } = await api.get<ListLeadEventsV2Response>(`/api/v1/leads/${id}/events`, { params })
    return data
  },

  /** GET /api/v1/leads/stage-definitions — справочник стадий воронки по всем 4 продуктам, без спецправа (валидной сессии достаточно). */
  async getStageDefinitions(): Promise<LeadStageDefinitionsV2Response> {
    const { data } = await api.get<LeadStageDefinitionsV2Response>('/api/v1/leads/stage-definitions')
    return data
  },

  /**
   * POST /api/v1/leads/import — таблица (.xlsx/.csv) с колонками phone
   * (обязательна), name, whatsapp, telegram, comment, last_contact. С tag =
   * OLD_BASE_TAG каждый созданный лид получает метку старой базы.
   */
  async importLeads(file: File, options?: { tag?: typeof OLD_BASE_TAG }): Promise<LeadImportResultV2> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<{ success: boolean; data: LeadImportResultV2 }>('/api/v1/leads/import', form, {
      params: options?.tag ? { tag: options.tag } : undefined,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data.data
  },
}

/** Чек-лист стадий лида и заметки к стадиям (GET/PATCH /leads/:id/checklist, PUT /leads/:id/stage-notes/:stage). */
export const leadChecklistApiV2 = {
  async get(leadId: string): Promise<LeadChecklistV2> {
    const { data } = await api.get<LeadChecklistV2>(`/api/v1/leads/${leadId}/checklist`)
    return data
  },

  async update(leadId: string, changes: LeadChecklistItemV2[]): Promise<LeadChecklistV2> {
    const { data } = await api.patch<LeadChecklistV2>(`/api/v1/leads/${leadId}/checklist`, { changes })
    return data
  },

  /** Пустой text удаляет заметку стадии. */
  async putStageNote(leadId: string, stage: string, text: string): Promise<LeadStageNoteV2> {
    const { data } = await api.put<LeadStageNoteV2>(
      `/api/v1/leads/${leadId}/stage-notes/${encodeURIComponent(stage)}`,
      { text },
    )
    return data
  },
}

export interface LeadChecklistItemV2 {
  stage: string
  index: number
  checked: boolean
}

export interface LeadStageNoteV2 {
  stage: string
  text: string
  updatedAt: string
}

export interface LeadChecklistV2 {
  items: LeadChecklistItemV2[]
  stageNotes: LeadStageNoteV2[]
}

/** Метка лидов, загруженных из старой базы контактов (импорт с tag=old_base). */
export const OLD_BASE_TAG = 'old_base'

export interface LeadImportResultV2 {
  total: number
  created: number
  failed: number
  errors: Array<{ row: number; message: string }>
}
