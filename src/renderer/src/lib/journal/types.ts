/**
 * A day, written down.
 *
 * The journal is deliberately plain: a day, a title if one comes, the text,
 * how the day felt, a few tags, where it was. Anything more structured
 * gets in the way of the one thing a journal needs, which is to be opened
 * and written in without ceremony. A poem said that day is linked, not
 * copied, so the memoir can print it in its place.
 */

export interface JournalEntry {
  id: string
  /** ISO date, YYYY-MM-DD, in the writer's local time. */
  day: string
  title: string
  body: string
  /** One of MOODS, or empty. */
  mood: string
  tags: string[]
  place: string
  poemIds: string[]
  createdAt: number
  updatedAt: number
  /** Set instead of deleting, so the deletion reaches the other devices. */
  deletedAt: number | null
  /** Sync bookkeeping, local only: the updatedAt the cloud last saw. */
  syncedAt?: number
}

export const MOODS = [
  { key: 'joy', glyph: '😊' },
  { key: 'calm', glyph: '😌' },
  { key: 'grateful', glyph: '🤲' },
  { key: 'tired', glyph: '😴' },
  { key: 'sad', glyph: '😔' },
  { key: 'anxious', glyph: '😟' },
  { key: 'angry', glyph: '😠' },
  { key: 'inspired', glyph: '✨' }
] as const

export type MoodKey = (typeof MOODS)[number]['key']

export function todayIso(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function emptyEntry(id: string, day = todayIso()): JournalEntry {
  const now = Date.now()
  return {
    id,
    day,
    title: '',
    body: '',
    mood: '',
    tags: [],
    place: '',
    poemIds: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  }
}

export function entryHasContent(entry: JournalEntry): boolean {
  return Boolean(entry.title.trim() || entry.body.trim() || entry.mood || entry.poemIds.length > 0)
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** The first line of the body, for a list. */
export function entryExcerpt(entry: JournalEntry, limit = 120): string {
  const line = entry.body.trim().split('\n').find((part) => part.trim()) ?? ''
  return line.length > limit ? `${line.slice(0, limit).trimEnd()}…` : line
}
