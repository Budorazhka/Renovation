// Словари используют оба вида плейсхолдеров — {count} и {{count}}.
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, (match, doubleKey: string | undefined, singleKey: string | undefined) => {
    const key = doubleKey ?? singleKey ?? ''
    return params[key] !== undefined ? String(params[key]) : match
  })
}
