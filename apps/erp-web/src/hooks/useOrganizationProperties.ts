import { useCallback, useEffect, useState } from 'react'
import { propertyAssetsApi } from '@/services/propertyAssetsApi'
import { mapPropertyAssetToUiProperty } from '@/lib/map-property-asset'
import type { Property } from '@/components/management/my-properties/types'

/**
 * Реестр объектов организации — тот же источник, что у экрана «Мои объекты»
 * (propertyAssetsApi.listAllAssetsWithListings + mapPropertyAssetToUiProperty).
 * Нужен виджетам второго экрана: раньше они брали `mockProperties` и показывали
 * собственнику чужие выдуманные квартиры рядом с настоящими цифрами плана.
 *
 * Отказ сервера остаётся отказом: список пустой и `status === 'error'`, чтобы
 * виджет сказал об этом, а не выдал «объектов нет».
 */
export function useOrganizationProperties(): {
  properties: Property[]
  status: 'loading' | 'ready' | 'error'
  reload: () => void
} {
  const [properties, setProperties] = useState<Property[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const { items } = await propertyAssetsApi.listAllAssetsWithListings()
      setProperties(items.map(({ asset, listings }) => mapPropertyAssetToUiProperty(asset, listings)))
      setStatus('ready')
    } catch (error) {
      console.error('[useOrganizationProperties] Не удалось загрузить объекты:', error)
      setProperties([])
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { properties, status, reload: () => void load() }
}
