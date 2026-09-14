import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { en } from '@/i18n/dictionaries/en'
import { ru } from '@/i18n/dictionaries/ru'
import { ka } from '@/i18n/dictionaries/ka'
import { es } from '@/i18n/dictionaries/es'
import { tr } from '@/i18n/dictionaries/tr'
import { applyRuntimeTranslations } from '@/i18n/runtimeTranslations'
import { interpolate } from './interpolate'
import type { Language, Translate, TranslationTree, FormatDate, FormatNumber } from '@/i18n/types'

const LANGUAGE_STORAGE_KEY = 'erp.language'

const dictionaries: Record<Language, TranslationTree> = {
  ru,
  en,
  ka,
  es,
  tr,
}

type I18nContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: Translate
  formatDate: FormatDate
  formatNumber: FormatNumber
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isLanguage(value: string | null): value is Language {
  return value === 'ru' || value === 'en' || value === 'ka' || value === 'es' || value === 'tr'
}

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return isLanguage(stored) ? stored : 'en'
}

function resolveTranslation(dictionary: TranslationTree, key: string): string | undefined {
  const value = key.split('.').reduce<string | TranslationTree | undefined>((current, part) => {
    if (!current || typeof current === 'string') return undefined
    return current[part]
  }, dictionary)

  return typeof value === 'string' ? value : undefined
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage)

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    }
    applyRuntimeTranslations(language)
  }, [language])

  const t: Translate = useCallback(
    (key, paramsOrFallback) => {
      let params: Record<string, string | number> | undefined
      let fallbackOverride: string | undefined
      
      if (typeof paramsOrFallback === 'string') {
        fallbackOverride = paramsOrFallback
      } else {
        params = paramsOrFallback
      }

      const translation = resolveTranslation(dictionaries[language], key as string)
      if (translation !== undefined) return interpolate(translation, params)
      const fallback = resolveTranslation(dictionaries['ru'], key as string)
      return interpolate(fallback !== undefined ? fallback : (fallbackOverride ?? (key as string)), params)
    },
    [language]
  )

  const formatDate: FormatDate = useCallback(
    (date, options) => {
      try {
        return new Intl.DateTimeFormat(language, options).format(new Date(date))
      } catch (e) {
        return String(date)
      }
    },
    [language]
  )

  const formatNumber: FormatNumber = useCallback(
    (value, options) => {
      try {
        return new Intl.NumberFormat(language, options).format(value)
      } catch (e) {
        return String(value)
      }
    },
    [language]
  )

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      formatDate,
      formatNumber,
    }),
    [language, setLanguage, t, formatDate, formatNumber]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within a LanguageProvider')
  }
  return context
}
