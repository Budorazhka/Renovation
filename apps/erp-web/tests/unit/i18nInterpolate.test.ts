import { describe, expect, it } from 'vitest'
import { interpolate } from '@/i18n/interpolate'

describe('i18n interpolate — оба вида плейсхолдеров из словарей', () => {
  it('подставляет {key} и {{key}}', () => {
    expect(interpolate('Планы на {{date}}', { date: '15.09.2026' })).toBe('Планы на 15.09.2026')
    expect(interpolate('Создано: {created}', { created: 3 })).toBe('Создано: 3')
    expect(interpolate('📋 Tasks: {{ count }}', { count: 2 })).toBe('📋 Tasks: 2')
  })

  it('неизвестный ключ остаётся как есть, без параметров текст не меняется', () => {
    expect(interpolate('{{missing}} и {x}', { x: 1 })).toBe('{{missing}} и 1')
    expect(interpolate('Без {{date}}')).toBe('Без {{date}}')
  })
})
