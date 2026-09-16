import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { dealsApiV2, newIdempotencyKey } from '@/services/dealsApiV2'
import { mapDealV2ToLegacy } from '@/lib/deal-v2-legacy-adapter'
import { useAuth } from '@/context/AuthContext'
import { useLeads } from '@/context/LeadsContext'
import type { Deal } from '@/types/deals'
import type { ChecklistItemInputV2, CreateDealV2Payload, DealTypeV2, DealV2 } from '@/types/dealsV2'

/**
 * Синхронизация с новым backend сделок (apps/api, /api/v1/deals) — до этого
 * прохода `DealsKanbanPage`/`DealCardPage`/отчёты держали сделки ТОЛЬКО в
 * `localStorage` поверх `DEALS_MOCK` (никакого backend позади не было, см.
 * докстринг lib/deal-v2-legacy-adapter.ts). Тот же паттерн источника
 * правды, что `LeadsContext` для лидов: сырые `DealV2` в состоянии,
 * легаси-форма выводится через адаптер на чтении, CAS — через
 * `version` каждой сырой записи (не отдельный кэш: DealV2, в отличие от
 * PokerLead, несёт version прямо в объекте).
 *
 * Вложен внутрь `LeadsProvider` (см. main.tsx) — резолвинг имени владельца
 * сделки переиспользует уже построенный `leadManagers` ростер команды
 * (`teamApi.list()`), без второго независимого запроса.
 */

interface DealsContextValue {
  deals: Deal[]
  isLoading: boolean
  refetch: () => Promise<void>
  changeStage: (dealId: string, stage: string, reason?: string) => Promise<boolean>
  updateChecklist: (dealId: string, items: ChecklistItemInputV2[]) => Promise<boolean>
  /** 'locked' — BAZA уже отметила комиссию, тип зафиксирован (409 DEAL_TYPE_LOCKED). */
  changeType: (dealId: string, dealType: DealTypeV2) => Promise<'saved' | 'locked' | 'failed'>
  addParticipant: (dealId: string, contactId: string, role: string) => Promise<boolean>
  removeParticipant: (dealId: string, contactId: string) => Promise<boolean>
  reassign: (dealId: string, ownerPositionId: string) => Promise<boolean>
  createDeal: (payload: CreateDealV2Payload) => Promise<Deal | null>
}

const DealsContext = createContext<DealsContextValue | null>(null)

export function DealsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth()
  const { leadManagers } = useLeads()
  const [rawDeals, setRawDeals] = useState<DealV2[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const managerNameById = useMemo(() => {
    const map = new Map<string, string>()
    leadManagers.forEach((m) => map.set(m.id, m.name))
    return map
  }, [leadManagers])

  const fetchDeals = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await dealsApiV2.listAll()
      if (!result.complete) {
        console.warn('[DealsContext] Показаны не все сделки — упёрлись в предел страниц (dealsApiV2.listAll)')
      }
      setRawDeals(result.items)
    } catch (err) {
      console.error('[DealsContext] Failed to fetch deals:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (localStorage.getItem('jwt_token') || currentUser) {
      void fetchDeals()
    }
  }, [currentUser, fetchDeals])

  const deals = useMemo(
    () => rawDeals.map((d) => mapDealV2ToLegacy(d, managerNameById)),
    [rawDeals, managerNameById],
  )

  const getVersion = useCallback(
    (dealId: string) => rawDeals.find((d) => d.id === dealId)?.version ?? 0,
    [rawDeals],
  )

  const replaceDeal = useCallback((updated: DealV2) => {
    setRawDeals((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
  }, [])

  /** Общая обработка CAS-конфликта (409) — тот же принцип, что LeadsContext.dispatchWithSync: сообщаем пользователю и перечитываем реестр вместо настаивания на своей версии. */
  const handleConflict = useCallback(
    (err: unknown, fallbackMessage: string) => {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        toast.error('Сделку изменил кто-то ещё. Список обновлён.')
        void fetchDeals()
      } else {
        toast.error(fallbackMessage)
      }
    },
    [fetchDeals],
  )

  const changeStage = useCallback(
    async (dealId: string, stage: string, reason?: string) => {
      try {
        const updated = await dealsApiV2.changeStage(dealId, stage, getVersion(dealId), reason)
        replaceDeal(updated)
        return true
      } catch (err) {
        handleConflict(err, 'Не удалось изменить этап сделки')
        return false
      }
    },
    [getVersion, replaceDeal, handleConflict],
  )

  const updateChecklist = useCallback(
    async (dealId: string, items: ChecklistItemInputV2[]) => {
      try {
        const updated = await dealsApiV2.updateChecklist(dealId, getVersion(dealId), items)
        replaceDeal(updated)
        return true
      } catch (err) {
        handleConflict(err, 'Не удалось обновить чеклист сделки')
        return false
      }
    },
    [getVersion, replaceDeal, handleConflict],
  )

  const changeType = useCallback(
    async (dealId: string, dealType: DealTypeV2) => {
      try {
        const updated = await dealsApiV2.update(dealId, { expectedVersion: getVersion(dealId), dealType })
        replaceDeal(updated)
        return 'saved' as const
      } catch (err) {
        const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
        if (code === 'DEAL_TYPE_LOCKED') {
          void fetchDeals()
          return 'locked' as const
        }
        handleConflict(err, 'Не удалось сохранить тип сделки')
        return 'failed' as const
      }
    },
    [getVersion, replaceDeal, handleConflict, fetchDeals],
  )

  const addParticipant = useCallback(
    async (dealId: string, contactId: string, role: string) => {
      try {
        const updated = await dealsApiV2.addParticipant(dealId, getVersion(dealId), contactId, role)
        replaceDeal(updated)
        return true
      } catch (err) {
        handleConflict(err, 'Не удалось добавить участника сделки')
        return false
      }
    },
    [getVersion, replaceDeal, handleConflict],
  )

  const removeParticipant = useCallback(
    async (dealId: string, contactId: string) => {
      try {
        const updated = await dealsApiV2.removeParticipant(dealId, contactId, getVersion(dealId))
        replaceDeal(updated)
        return true
      } catch (err) {
        handleConflict(err, 'Не удалось убрать участника сделки')
        return false
      }
    },
    [getVersion, replaceDeal, handleConflict],
  )

  const reassign = useCallback(
    async (dealId: string, ownerPositionId: string) => {
      try {
        const updated = await dealsApiV2.reassign(dealId, getVersion(dealId), ownerPositionId)
        replaceDeal(updated)
        return true
      } catch (err) {
        handleConflict(err, 'Не удалось передать сделку другому агенту')
        return false
      }
    },
    [getVersion, replaceDeal, handleConflict],
  )

  const createDeal = useCallback(
    async (payload: CreateDealV2Payload) => {
      try {
        const created = await dealsApiV2.create(payload, newIdempotencyKey())
        setRawDeals((prev) => [created, ...prev])
        return mapDealV2ToLegacy(created, managerNameById)
      } catch (err) {
        console.error('[DealsContext] Failed to create deal:', err)
        toast.error('Не удалось создать сделку')
        return null
      }
    },
    [managerNameById],
  )

  return (
    <DealsContext.Provider
      value={{
        deals,
        isLoading,
        refetch: fetchDeals,
        changeStage,
        updateChecklist,
        changeType,
        addParticipant,
        removeParticipant,
        reassign,
        createDeal,
      }}
    >
      {children}
    </DealsContext.Provider>
  )
}

export function useDeals() {
  const ctx = useContext(DealsContext)
  if (!ctx) throw new Error('useDeals must be used within DealsProvider')
  return ctx
}
