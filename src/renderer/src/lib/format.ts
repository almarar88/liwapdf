/** Small formatting and math helpers shared across views. */

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : digits)} ${units[index]}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

export function extensionOf(name: string): string {
  const match = /\.([^./\\]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function formatRelativeTime(timestamp: number, language: 'ar' | 'en'): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  const table: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month']
  ]
  const formatter = new Intl.RelativeTimeFormat(language === 'ar' ? 'ar' : 'en', { numeric: 'auto' })
  let previous = 1
  for (const [limit, unit] of table) {
    if (seconds < limit) return formatter.format(-Math.round(seconds / previous), unit)
    previous = limit
  }
  return formatter.format(-Math.round(seconds / 31557600), 'year')
}

/**
 * Parses a human page range such as `1-3, 5, 8-10` into zero-based indices.
 * Returns every page when the expression is empty.
 */
export function parsePageRange(expression: string, pageCount: number): number[] {
  const trimmed = expression.trim()
  if (!trimmed) return Array.from({ length: pageCount }, (_, index) => index)

  const picked = new Set<number>()
  for (const chunk of trimmed.split(/[,;،]/)) {
    const part = chunk.trim()
    if (!part) continue
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(part)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      const [low, high] = from <= to ? [from, to] : [to, from]
      for (let page = low; page <= high; page += 1) {
        if (page >= 1 && page <= pageCount) picked.add(page - 1)
      }
      continue
    }
    const single = /^(\d+)$/.exec(part)
    if (single) {
      const page = Number(single[1])
      if (page >= 1 && page <= pageCount) picked.add(page - 1)
      continue
    }
    if (/^all$/i.test(part)) {
      for (let index = 0; index < pageCount; index += 1) picked.add(index)
      continue
    }
    throw new Error('invalid-range')
  }
  return [...picked].sort((a, b) => a - b)
}

export function formatPageList(indices: number[]): string {
  if (indices.length === 0) return ''
  const sorted = [...indices].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i]
    if (current !== previous + 1) {
      parts.push(start === previous ? `${start + 1}` : `${start + 1}-${previous + 1}`)
      start = current
    }
    previous = current
  }
  return parts.join(', ')
}

export const MM_TO_PT = 72 / 25.4

export const PAGE_PRESETS: Record<string, [number, number]> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
  Tabloid: [792, 1224]
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Converts `#rrggbb` to the 0..1 triple pdf-lib expects. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim()
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255
  }
}

/**
 * True when the string contains characters the PDF base-14 fonts cannot
 * encode (Arabic, CJK, emoji...). Such text is rasterized instead, which also
 * gives us correct Arabic shaping for free via the browser's text engine.
 */
export function needsComplexShaping(text: string): boolean {
  return /[^ -ÿ]/.test(text)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
