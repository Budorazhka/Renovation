import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'

export interface AddressSuggestion {
  id: string
  formattedAddress: string
  street?: string
  housenumber?: string
  city?: string
  country?: string
  coordinates: [number, number]
}

interface AddressAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onSelect: (suggestion: AddressSuggestion) => void
  cityContext?: string
  placeholder?: string
  required?: boolean
  dataTestId?: string
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  cityContext,
  placeholder,
  required = false,
  dataTestId = 'location-input-address',
}: AddressAutocompleteProps) {
  const { t } = useI18n()
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const latestRequestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      isMountedRef.current = false
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const fetchSuggestions = async (query: string) => {
    const trimmed = query.trim()
    if (!isMountedRef.current) return
    if (trimmed.length < 3) {
      if (isMountedRef.current) {
        setSuggestions([])
        setIsOpen(false)
        setIsLoading(false)
      }
      return
    }

    const requestId = ++latestRequestIdRef.current
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    if (isMountedRef.current) setIsLoading(true)
    try {
      const fullQuery = cityContext ? `${trimmed}, ${cityContext}` : trimmed
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(fullQuery)}&limit=5`
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error('Geocoding error')
      const data = await response.json()

      // Ignore stale responses if a newer request has already been dispatched
      if (latestRequestIdRef.current !== requestId || controller.signal.aborted || !isMountedRef.current) {
        return
      }

      if (!Array.isArray(data.features)) {
        setSuggestions([])
        setIsOpen(false)
        return
      }

      const results: AddressSuggestion[] = data.features
        .filter((f: any) => f.geometry && Array.isArray(f.geometry.coordinates))
        .map((f: any, idx: number) => {
          const props = f.properties || {}
          const street = props.street || props.name || ''
          const housenumber = props.housenumber || ''
          const city = props.city || props.town || props.state || ''
          const country = props.country || 'Georgia'

          let formattedAddress = street
          if (housenumber) {
            formattedAddress = `${street} ${housenumber}`
          }
          if (!formattedAddress && props.name) {
            formattedAddress = props.name
          }

          return {
            id: `suggestion-${idx}-${f.geometry.coordinates.join(',')}`,
            formattedAddress: formattedAddress || trimmed,
            street,
            housenumber,
            city,
            country,
            coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as [number, number],
          }
        })

      setSuggestions(results)
      setIsOpen(results.length > 0)
      setActiveIndex(-1)
    } catch {
      // Graceful fallback for offline / geocoder downtime: manual typing is never blocked
      if (latestRequestIdRef.current !== requestId || controller.signal.aborted || !isMountedRef.current) {
        return
      }
      setSuggestions([])
      setIsOpen(false)
    } finally {
      if (latestRequestIdRef.current === requestId && isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(newValue)
    }, 300)
  }

  const handleSelectSuggestion = (suggestion: AddressSuggestion) => {
    onChange(suggestion.formattedAddress)
    onSelect(suggestion)
    setIsOpen(false)
    setSuggestions([])
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < suggestions.length) {
      e.preventDefault()
      handleSelectSuggestion(suggestions[activeIndex]!)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div className="address-autocomplete" ref={wrapperRef}>
      <div className="address-autocomplete__input-wrap">
        <input
          id="loc-address"
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true)
          }}
          placeholder={placeholder ?? t('address.placeholder')}
          required={required}
          autoComplete="off"
          data-testid={dataTestId}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls="address-suggestions-list"
          aria-activedescendant={activeIndex >= 0 && suggestions[activeIndex] ? suggestions[activeIndex]!.id : undefined}
        />
        {isLoading && (
          <span className="address-autocomplete__spinner" aria-hidden="true">
            ⟳
          </span>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          id="address-suggestions-list"
          className="address-autocomplete__dropdown"
          role="listbox"
          aria-label={t('address.suggestionsAria')}
        >
          {suggestions.map((item, index) => (
            <li
              key={item.id}
              role="option"
              aria-selected={index === activeIndex}
              className={`address-autocomplete__item${index === activeIndex ? ' is-active' : ''}`}
              onClick={() => handleSelectSuggestion(item)}
            >
              <div className="address-autocomplete__item-icon" aria-hidden="true">
                📍
              </div>
              <div className="address-autocomplete__item-text">
                <span className="address-autocomplete__item-title">{item.formattedAddress}</span>
                <span className="address-autocomplete__item-subtitle">
                  {[item.city, item.country].filter(Boolean).join(', ')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
