import { createContext, useContext, useReducer, type ReactNode, useEffect, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { apiService } from '@/features/crm/services/api/service'
import { TaskPriority } from '@/features/crm/services/api/types'
import { leadsApiV2, newIdempotencyKey } from '@/services/leadsApiV2'
import { teamApi } from '@/services/teamApi'
import {
  mapLeadV2ToPoker,
  mapPokerIdToLeadStageV2,
  POKER_SOURCE_TO_PRODUCT_V2,
} from '@/lib/lead-v2-poker-adapter'
import { useAuth } from '@/context/AuthContext'
import type {
  BuyerRegistration,
  DistributionRule,
  Lead,
  LeadEvent,
  LeadManager,
  LeadPartnerByEmail,
  LeadSource,
  LeadWithHistory,
} from '@/types/leads'
import {
  DEFAULT_DISTRIBUTION_RULE,
} from '@/data/leads-mock'

/** Для round_robin: следующий менеджер по кругу для данной очереди */
function getNextManagerIdRoundRobin(
  leadPool: Lead[],
  leadManagers: LeadManager[],
  source: LeadSource
): string | null {
  const managers = leadManagers
    .filter((m) => m.sourceTypes.includes(source))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (managers.length === 0) return null
  const leadsInSource = leadPool.filter((l) => l.source === source)
  const index = leadsInSource.length % managers.length
  return managers[index].id
}

/** Для by_load: менеджер с наименьшей загрузкой по этой очереди */
function getNextManagerIdByLoad(
  leadPool: Lead[],
  leadManagers: LeadManager[],
  source: LeadSource
): string | null {
  const managers = leadManagers.filter((m) => m.sourceTypes.includes(source))
  if (managers.length === 0) return null
  const countByManager: Record<string, number> = {}
  managers.forEach((m) => { countByManager[m.id] = 0 })
  leadPool.filter((l) => l.source === source).forEach((l) => {
    if (l.managerId && countByManager[l.managerId] !== undefined) {
      countByManager[l.managerId]++
    }
  })
  let minId = managers[0].id
  let minCount = countByManager[minId] ?? 0
  managers.forEach((m) => {
    const c = countByManager[m.id] ?? 0
    if (c < minCount) {
      minCount = c
      minId = m.id
    }
  })
  return minId
}

export interface LeadsState {
  leadPool: Lead[]
  distributionRule: DistributionRule
  manualDistributorId: string | null
  leadManagers: LeadManager[]
  leadPartners: LeadPartnerByEmail[]
  /** История событий по лидам: leadId → события */
  leadHistory: Record<string, LeadEvent[]>
  /** Регистрации покупателей по лидам: leadId → регистрации */
  leadRegistrations: Record<string, BuyerRegistration[]>
  /**
   * version лида на новом backend (apps/api), leadId → version. Не часть
   * публичного контракта Lead/PokerLead (types/leads.ts намеренно не несёт
   * version — см. lib/lead-v2-poker-adapter.ts) — служебный кэш только для
   * optimistic concurrency при PATCH .../stage (CAS, см. dispatchWithSync
   * ниже). Заполняется при каждом чтении лида с backend (список/get/
   * changeStage-ответ), не выставляется наружу через LeadsContextValue.
   */
  leadVersions: Record<string, number>
}

export type LeadsAction =
  | { type: 'ADD_LEAD'; lead: Lead }
  | { type: 'ASSIGN_LEAD'; leadId: string; managerId: string }
  | { type: 'UNASSIGN_LEAD'; leadId: string }
  | { type: 'UPDATE_LEAD_STAGE'; leadId: string; stageId: string; authorId?: string; authorName?: string; fromStageName?: string; toStageName?: string }
  | { type: 'SET_DISTRIBUTION_RULE'; rule: DistributionRule }
  | { type: 'SET_MANUAL_DISTRIBUTOR'; managerId: string | null }
  | { type: 'ADD_LEAD_MANAGER'; manager: LeadManager }
  | { type: 'REMOVE_LEAD_MANAGER'; managerId: string }
  | { type: 'UPDATE_LEAD_MANAGER'; managerId: string; patch: Partial<LeadManager> }
  | { type: 'ADD_LEAD_PARTNER'; partner: LeadPartnerByEmail }
  | { type: 'REMOVE_LEAD_PARTNER'; partnerId: string }
  | { type: 'UPDATE_LEAD_PARTNER'; partnerId: string; patch: Partial<LeadPartnerByEmail> }
  | { type: 'ADD_LEAD_EVENT'; leadId: string; event: LeadEvent }
  | { type: 'ADD_BUYER_REGISTRATION'; leadId: string; registration: BuyerRegistration }
  | { type: 'BULK_REASSIGN_LEADS'; fromManagerId: string; toManagerId: string }
  | { type: 'UPDATE_LEAD_MANAGER_SUBSTITUTE'; managerId: string; patch: { isUnavailable?: boolean; substituteId?: string | null } }
  | { type: 'DELETE_LEAD_EVENT'; leadId: string; eventId: string }
  | { type: 'EDIT_LEAD_EVENT'; leadId: string; eventId: string; patch: { taskName?: string; deadline?: string; eisenhowerUrgent?: boolean; eisenhowerImportant?: boolean } }
  | { type: 'SET_LEADS'; leads: Lead[] }
  | { type: 'SET_LEAD_HISTORY'; historyMap: Record<string, LeadEvent[]> }
  | { type: 'SET_MANAGERS'; managers: LeadManager[] }
  | { type: 'SET_LEAD_VERSIONS'; versions: Record<string, number> }

function leadsReducer(state: LeadsState, action: LeadsAction): LeadsState {
  switch (action.type) {
    case 'SET_MANAGERS':
      return { ...state, leadManagers: action.managers }
    case 'SET_LEAD_HISTORY':
      return { ...state, leadHistory: { ...state.leadHistory, ...action.historyMap } }
    case 'SET_LEADS':
      return { ...state, leadPool: action.leads }
    case 'SET_LEAD_VERSIONS':
      return { ...state, leadVersions: { ...state.leadVersions, ...action.versions } }
    case 'ADD_LEAD': {
      const lead = action.lead
      let managerId: string | null = lead.managerId ?? null
      const rule = state.distributionRule.type
      const noManualDistributor = state.manualDistributorId == null
      if (noManualDistributor && rule === 'round_robin') {
        managerId = getNextManagerIdRoundRobin(state.leadPool, state.leadManagers, lead.source)
      } else if (noManualDistributor && rule === 'by_load') {
        managerId = getNextManagerIdByLoad(state.leadPool, state.leadManagers, lead.source)
      }
      const newLead: Lead = { ...lead, managerId }
      return { ...state, leadPool: [newLead, ...state.leadPool] }
    }
    case 'ASSIGN_LEAD':
      return {
        ...state,
        leadPool: state.leadPool.map((l) =>
          l.id === action.leadId ? { ...l, managerId: action.managerId } : l
        ),
      }
    case 'UNASSIGN_LEAD':
      return {
        ...state,
        leadPool: state.leadPool.map((l) =>
          l.id === action.leadId ? { ...l, managerId: null } : l
        ),
      }
    case 'UPDATE_LEAD_STAGE': {
      const now = new Date().toISOString()
      const prevLead = state.leadPool.find((l) => l.id === action.leadId)
      const stageEvent: LeadEvent = {
        id: `evt-${Date.now()}`,
        type: 'stage_change',
        timestamp: now,
        authorId: action.authorId ?? 'system',
        authorName: action.authorName ?? 'Система',
        payload: {
          fromStage: prevLead?.stageId,
          fromStageName: action.fromStageName,
          toStage: action.stageId,
          toStageName: action.toStageName,
        },
      }
      const prevHistory = state.leadHistory[action.leadId] ?? []
      return {
        ...state,
        leadPool: state.leadPool.map((l) =>
          l.id === action.leadId
            ? { ...l, stageId: action.stageId, updatedAt: now }
            : l
        ),
        leadHistory: {
          ...state.leadHistory,
          [action.leadId]: [...prevHistory, stageEvent],
        },
      }
    }
    case 'SET_DISTRIBUTION_RULE':
      return { ...state, distributionRule: action.rule }
    case 'SET_MANUAL_DISTRIBUTOR':
      return { ...state, manualDistributorId: action.managerId }
    case 'ADD_LEAD_MANAGER':
      return { ...state, leadManagers: [...state.leadManagers, action.manager] }
    case 'REMOVE_LEAD_MANAGER':
      return {
        ...state,
        leadManagers: state.leadManagers.filter((m) => m.id !== action.managerId),
        manualDistributorId:
          state.manualDistributorId === action.managerId ? null : state.manualDistributorId,
      }
    case 'UPDATE_LEAD_MANAGER':
      return {
        ...state,
        leadManagers: state.leadManagers.map((m) =>
          m.id === action.managerId ? { ...m, ...action.patch } : m
        ),
      }
    case 'ADD_LEAD_PARTNER':
      return { ...state, leadPartners: [...state.leadPartners, action.partner] }
    case 'REMOVE_LEAD_PARTNER':
      return {
        ...state,
        leadPartners: state.leadPartners.filter((p) => p.id !== action.partnerId),
      }
    case 'UPDATE_LEAD_PARTNER':
      return {
        ...state,
        leadPartners: state.leadPartners.map((p) =>
          p.id === action.partnerId ? { ...p, ...action.patch } : p
        ),
      }
    case 'ADD_LEAD_EVENT': {
      const prev = state.leadHistory[action.leadId] ?? []
      return {
        ...state,
        leadHistory: { ...state.leadHistory, [action.leadId]: [...prev, action.event] },
      }
    }
    case 'DELETE_LEAD_EVENT': {
      const prev = state.leadHistory[action.leadId] ?? []
      return {
        ...state,
        leadHistory: {
          ...state.leadHistory,
          [action.leadId]: prev.filter((evt) => evt.id !== action.eventId),
        },
      }
    }
    case 'EDIT_LEAD_EVENT': {
      const prev = state.leadHistory[action.leadId] ?? []
      return {
        ...state,
        leadHistory: {
          ...state.leadHistory,
          [action.leadId]: prev.map((evt) =>
            evt.id === action.eventId
              ? { ...evt, payload: { ...evt.payload, ...action.patch } as LeadEvent['payload'] }
              : evt
          ),
        },
      }
    }
    case 'ADD_BUYER_REGISTRATION': {
      const prev = state.leadRegistrations[action.leadId] ?? []
      return {
        ...state,
        leadRegistrations: {
          ...state.leadRegistrations,
          [action.leadId]: [...prev, action.registration],
        },
      }
    }
    case 'BULK_REASSIGN_LEADS':
      return {
        ...state,
        leadPool: state.leadPool.map((l) =>
          l.managerId === action.fromManagerId
            ? { ...l, managerId: action.toManagerId }
            : l
        ),
      }
    case 'UPDATE_LEAD_MANAGER_SUBSTITUTE':
      return {
        ...state,
        leadManagers: state.leadManagers.map((m) =>
          m.id === action.managerId ? { ...m, ...action.patch } : m
        ),
      }
    default:
      return state
  }
}

const initialState: LeadsState = {
  leadPool: [],
  distributionRule: DEFAULT_DISTRIBUTION_RULE,
  manualDistributorId: null,
  leadManagers: [],
  leadPartners: [],
  leadHistory: {},
  leadRegistrations: {},
  leadVersions: {},
}

type LeadsContextValue = {
  state: LeadsState
  dispatch: React.Dispatch<LeadsAction>
  leadManagers: LeadManager[]
  /** Лиды по источнику (очереди) */
  leadsBySource: (source: LeadSource) => Lead[]
  /** Идёт автоназначение (по кругу / по загрузке) без ручного распределителя */
  isAutoDistribution: boolean
  /** Получить лид с историей и регистрациями */
  getLeadWithHistory: (leadId: string) => LeadWithHistory | null
  /** Состояние загрузки данных из CRM */
  isLoading: boolean
  /** Перечитать лиды с сервера (например, после импорта таблицы). */
  refreshLeads: () => Promise<void>
}

const LeadsContext = createContext<LeadsContextValue | null>(null)

export function LeadsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(leadsReducer, initialState)
  const [isLoading, setIsLoading] = useState(false)
  const { currentUser } = useAuth()

  /**
   * Синхронизация с новым backend (apps/api, /api/v1/leads) — лиды
   * карточного стола больше НЕ читаются с легаси api-crm.baza.sale (было до
   * 03.09.2026, см. историю файла). Настройки распределения
   * (getDistributionSettings) и bulk-reassign остаются на легаси backend
   * намеренно: у нового backend нет эквивалента (CrmService докстринг:
   * авто-раздача — "не является стартовым поведением", серверного
   * bulk-reassign нет и не планируется этой фазой) — не пробел, а
   * сознательное разделение источников данных на переходный период.
   */
  const fetchLeads = useCallback(async () => {
    setIsLoading(true)
    try {
      const [leadsResult, positions, settingsRes] = await Promise.all([
        leadsApiV2.listAll(),
        teamApi.list().catch(() => []),
        // Легаси-эндпоинт: на новом backend его нет, отдаёт 404, и без
        // localStorage-фоллбэка getDistributionSettings бросает. Без .catch()
        // падал весь Promise.all и стол оставался пустым при исправном
        // /api/v1/leads — настройка раздачи не должна решать, видны ли лиды.
        apiService.getDistributionSettings().catch(() => null),
      ])

      if (!leadsResult.complete) {
        console.warn('[LeadsContext] Показаны не все лиды — упёрлись в предел страниц (leadsApiV2.listAll)')
      }

      const pokerLeads = leadsResult.items.map(mapLeadV2ToPoker)
      dispatch({ type: 'SET_LEADS', leads: pokerLeads })
      dispatch({
        type: 'SET_LEAD_VERSIONS',
        versions: Object.fromEntries(leadsResult.items.map((l) => [l.id, l.version])),
      })

      // Ростер менеджеров теперь строится из реестра команды (positionId,
      // teamApi.list()), а не из assignedTo, встроенного в лид: LeadV2 не
      // раскрывает имя/почту владельца, только ownerPositionId (opaque id).
      // sourceTypes — честный дефолт "видит все очереди": маршрутизация
      // очередей (первичка/вторичка/аренда/реклама) per-позиция не
      // моделирована на новом backend, тот же дефолт использовался и в
      // легаси-фоллбэке до этой фазы.
      const managers: LeadManager[] = positions
        .filter((p) => !p.vacant)
        .map((p) => ({
          id: p.positionId ?? p.id,
          login: p.email || p.loginEmail || '',
          name: p.name || p.position || 'Без имени',
          sourceTypes: ['primary', 'secondary', 'rent', 'ad_campaigns'],
        }))
      dispatch({ type: 'SET_MANAGERS', managers })

      if (settingsRes?.success && settingsRes.data) {
        dispatch({ type: 'SET_DISTRIBUTION_RULE', rule: { type: settingsRes.data.type } })
        dispatch({ type: 'SET_MANUAL_DISTRIBUTOR', managerId: settingsRes.data.manualDistributorId })
      }
    } catch (err) {
      console.error('[LeadsContext] Failed to fetch leads:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Realtime: новый backend (apps/api) не поднимает WebSocketGateway/
  // socket.io — проверено по исходникам (нет ни одного файла с
  // WebSocketGateway во всём apps/api/src). Легаси-сокет
  // (features/crm/services/socket.ts, api-crm.baza.sale) отправлял события
  // lead:updated/lead:created/task:updated/task:created для ЛЕГАСИ лидов,
  // которых на этом экране больше нет — подписки на них сняты вместе с
  // переходом источника данных. Честный пробел переходного периода (тот же
  // класс, что commissionUsd/taskOverdue в lib/lead-v2-poker-adapter.ts):
  // обновление карточек после этой фазы — по действию пользователя
  // (assign/unassign/changeStage перечитывают свой лид при конфликте) либо
  // по следующему вызову fetchLeads() (маунт экрана / смена пользователя).
  useEffect(() => {
    if (localStorage.getItem('jwt_token') || currentUser) {
      fetchLeads()
    }
  }, [currentUser, fetchLeads])

  /** Обертка над dispatch для синхронизации с API */
  const dispatchWithSync = useCallback(async (action: LeadsAction) => {
    // Сначала обновляем локально (оптимистично)
    dispatch(action)

    try {
      // 1. Смена стадии — CAS через expectedVersion (leadVersions cache).
      if (action.type === 'UPDATE_LEAD_STAGE') {
        const lead = state.leadPool.find((l) => l.id === action.leadId)
        const productType = lead ? POKER_SOURCE_TO_PRODUCT_V2[lead.source] : undefined
        const backendStage = productType ? mapPokerIdToLeadStageV2(action.stageId, productType) : null
        if (backendStage) {
          const expectedVersion = state.leadVersions[action.leadId] ?? 0
          try {
            const result = await leadsApiV2.changeStage(action.leadId, backendStage, expectedVersion)
            if (typeof result.version === 'number') {
              dispatch({ type: 'SET_LEAD_VERSIONS', versions: { [action.leadId]: result.version } })
            }
          } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 409) {
              // Optimistic concurrency: лид изменился с момента, когда клиент
              // прочитал version — оптимистичное изменение стадии выше
              // не подтверждено сервером. Тот же паттерн, что TasksPage:
              // сообщаем пользователю и перечитываем реестр целиком вместо
              // того, чтобы настаивать на своей версии.
              toast.error('Стадию лида изменил кто-то ещё. Карточка обновлена.')
              void fetchLeads()
            }
            throw err
          }
        }
      }

      // 2. Назначение менеджера — managerId это positionId (см.
      // lib/lead-v2-poker-adapter.ts::mapLeadV2ToPoker).
      if (action.type === 'ASSIGN_LEAD') {
        await leadsApiV2.assign(action.leadId, action.managerId)
      }

      // 3. Снятие назначения.
      if (action.type === 'UNASSIGN_LEAD') {
        await leadsApiV2.unassign(action.leadId)
      }

      // 4. Создание лида.
      if (action.type === 'ADD_LEAD') {
        const { lead } = action
        const productType = POKER_SOURCE_TO_PRODUCT_V2[lead.source]
        const created = await leadsApiV2.create(
          {
            requesterName: lead.name,
            requesterPhone: lead.phone,
            productType,
          },
          newIdempotencyKey(),
        )
        // Редьюсер (ADD_LEAD-ветка выше) уже посчитал менеджера — round-robin,
        // by-load или ручной выбор — и это осело в lead.managerId ДО этого
        // dispatch. POST /leads не принимает владельца при создании (см.
        // create-lead.dto.ts), поэтому без явного assign посчитанное
        // распределение никогда не долетало до backend — найдено 03.09.2026
        // внешним ревью: новый лид всегда создавался без владельца, локальный
        // UI показывал назначение только до следующего fetchLeads().
        let ownerPositionId = created.ownerPositionId ?? null
        if (lead.managerId) {
          await leadsApiV2.assign(created.id, lead.managerId)
          ownerPositionId = lead.managerId
        }
        const mapped = mapLeadV2ToPoker({ ...created, ownerPositionId })
        dispatch({ type: 'SET_LEADS', leads: state.leadPool.map((l) => (l.id === lead.id ? mapped : l)) })
        dispatch({ type: 'SET_LEAD_VERSIONS', versions: { [mapped.id]: created.version } })
      }

      // 5. Настройки распределения — легаси backend, нет эквивалента на новом (см. докстринг fetchLeads).
      if (action.type === 'SET_DISTRIBUTION_RULE' || action.type === 'SET_MANUAL_DISTRIBUTOR') {
        const currentType = action.type === 'SET_DISTRIBUTION_RULE' ? action.rule.type : state.distributionRule.type
        const currentManualId = action.type === 'SET_MANUAL_DISTRIBUTOR' ? action.managerId : state.manualDistributorId

        await apiService.updateDistributionSettings({
          type: currentType as any,
          manualDistributorId: currentManualId
        })
      }

      // 6. Массовая передача — серверного bulk-reassign на новом backend
      // нет (см. докстринг fetchLeads), composed из отдельных assign.
      if (action.type === 'BULK_REASSIGN_LEADS') {
        const affected = state.leadPool.filter((l) => l.managerId === action.fromManagerId)
        await Promise.all(affected.map((l) => leadsApiV2.assign(l.id, action.toManagerId)))
      }

      // 7. Создание задач через события истории — ОСТАЁТСЯ на легаси Task
      // API (apiService.createTask). Известный пробел переходного периода:
      // leadId, который получает legacy Task, — id лида из НОВОГО backend
      // (Lead теперь живёт в apps/api, не в api-crm.baza.sale), поэтому
      // связь задача↔лид в легаси хранилище не резолвится ни в одну
      // реальную легаси-запись. Полная миграция задач — вне scope этой
      // фазы (см. план: LeadViewModal и task-флоу мигрируют отдельно).
      if (action.type === 'ADD_LEAD_EVENT') {
        const { event, leadId } = action
        if (event.type === 'task_created' && event.payload.taskName) {
          let priority = TaskPriority.NOT_URGENT_IMPORTANT;
          if (event.payload.eisenhowerUrgent && event.payload.eisenhowerImportant) {
             priority = TaskPriority.URGENT_IMPORTANT;
          } else if (event.payload.eisenhowerUrgent) {
             priority = TaskPriority.URGENT_NOT_IMPORTANT;
          } else if (!event.payload.eisenhowerImportant) {
             priority = TaskPriority.NOT_URGENT_NOT_IMPORTANT;
          }

          await apiService.createTask({
            title: event.payload.taskName,
            leadId: leadId,
            endDate: event.payload.deadline,
            priority,
            assignedTo: currentUser?.id || '',
            // @ts-ignore
            description: `Создано из воронки: ${event.payload.comment || ''}`
          })
        }
      }

    } catch (err) {
      console.error(`[LeadsContext] Sync failed for ${action.type}:`, err)
    }
  }, [state.leadPool, state.leadVersions, state.distributionRule.type, state.manualDistributorId, fetchLeads, currentUser])

  const leadsBySource = (source: LeadSource) =>
    state.leadPool.filter((l) => l.source === source)

  const isAutoDistribution =
    state.distributionRule.type !== 'manual' && state.manualDistributorId == null

  const getLeadWithHistory = (leadId: string): LeadWithHistory | null => {
    const lead = state.leadPool.find((l) => l.id === leadId)
    if (!lead) return null
    return {
      ...lead,
      history: state.leadHistory[leadId] ?? [],
      registrations: state.leadRegistrations[leadId] ?? [],
    }
  }

  return (
    <LeadsContext.Provider
      value={{
        state,
        dispatch: dispatchWithSync as any, // Подменяем обычный dispatch на версию с синхронизацией
        leadManagers: state.leadManagers,
        leadsBySource,
        isAutoDistribution,
        getLeadWithHistory,
        isLoading,
        refreshLeads: fetchLeads,
      }}
    >
      {children}
    </LeadsContext.Provider>
  )
}

export function useLeads() {
  const ctx = useContext(LeadsContext)
  if (!ctx) throw new Error('useLeads must be used within LeadsProvider')
  return ctx
}
