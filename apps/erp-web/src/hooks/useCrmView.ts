import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export type CrmView = 'poker' | 'list' | 'classic'

const STORAGE_KEY = 'erp.crmView'

function parseView(value: string | null): CrmView | null {
  return value === 'poker' || value === 'list' || value === 'classic' ? value : null
}

function readStoredView(): CrmView | null {
  try {
    return parseView(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

/** Вид CRM живёт в адресе (?view=), чтобы ссылкой можно было открыть нужный; последний выбор запоминается. */
export function useCrmView(): [CrmView, (next: CrmView) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseView(searchParams.get('view')) ?? readStoredView() ?? 'poker'

  const setView = useCallback(
    (next: CrmView) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // приватный режим или заблокированное хранилище — вид всё равно останется в адресе
      }
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set('view', next)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return [view, setView]
}
