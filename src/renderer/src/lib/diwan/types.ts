/**
 * The Diwan: a poet's own book inside the document studio.
 *
 * A poem is not a paragraph. It is a sequence of verses, each verse two
 * hemistichs — the sadr and the ajuz — that sit side by side on a printed
 * page and must be entered, stored and laid out as a pair. Everything below
 * exists because a plain text field cannot hold that shape.
 */

export interface Verse {
  /** Stable identity: versions and keyboard navigation key off it. */
  id: string
  /** الصدر — the first hemistich. */
  sadr: string
  /** العجز — the second hemistich. */
  ajuz: string
}

/**
 * One earlier wording of a verse. A poet swaps a word, sleeps on it, and
 * wants the old line back the next morning — so the editor keeps the last
 * few forms of each verse rather than only the current one.
 */
export interface VerseVersion {
  verseId: string
  sadr: string
  ajuz: string
  savedAt: number
}

export type PoemForm = 'nabati' | 'fusha' | 'free'

export interface Poem {
  id: string
  title: string
  /** Nabati (colloquial), classical (fusha) or free verse. */
  form: PoemForm
  /** The meter or the melody: مسحوب، هجيني، الطويل… free text over a suggestion list. */
  meter: string
  /** The poetic purpose: غزل، مدح، رثاء… */
  purpose: string
  /** The rhyme letter or syllable, when the poet wants it noted. */
  rhyme: string
  /** The story behind the poem — the occasion. */
  occasion: string
  place: string
  /** ISO date the poem was said, chosen by the poet; empty when unknown. */
  saidOn: string
  verses: Verse[]
  versions: VerseVersion[]
  /** True when a recording is stored under the poem's id. */
  hasRecording: boolean
  recordingSeconds: number
  createdAt: number
  updatedAt: number
}

/** The meters and melodies a poet in the Gulf and the wider Arab world reaches for. */
export const NABATI_MELODIES = [
  'مسحوب',
  'هجيني',
  'صخري',
  'هلالي',
  'ونّة',
  'ردحة',
  'تغرودة',
  'سامري',
  'عرضة',
  'لعبوني',
  'حداء',
  'قلطة'
] as const

export const FUSHA_METERS = [
  'الطويل',
  'البسيط',
  'الكامل',
  'الوافر',
  'الرمل',
  'الخفيف',
  'المتقارب',
  'الرجز',
  'السريع',
  'المديد',
  'الهزج',
  'المنسرح',
  'المجتث',
  'المقتضب',
  'المضارع',
  'المتدارك'
] as const

export const PURPOSES = ['غزل', 'مدح', 'رثاء', 'حكمة', 'وصف', 'فخر', 'هجاء', 'وطني', 'ديني', 'شكوى', 'عتاب', 'حنين'] as const

export function newVerse(id: string, sadr = '', ajuz = ''): Verse {
  return { id, sadr, ajuz }
}

export function emptyPoem(id: string, verseId: string): Poem {
  const now = Date.now()
  return {
    id,
    title: '',
    form: 'nabati',
    meter: '',
    purpose: '',
    rhyme: '',
    occasion: '',
    place: '',
    saidOn: '',
    verses: [newVerse(verseId)],
    versions: [],
    hasRecording: false,
    recordingSeconds: 0,
    createdAt: now,
    updatedAt: now
  }
}

/** A verse counts once either half has words in it. */
export function filledVerses(poem: Poem): Verse[] {
  return poem.verses.filter((verse) => verse.sadr.trim() || verse.ajuz.trim())
}

/** The first non-empty hemistich, for a poem that was never titled. */
export function poemLabel(poem: Poem, fallback: string): string {
  if (poem.title.trim()) return poem.title.trim()
  const first = filledVerses(poem)[0]
  if (!first) return fallback
  return (first.sadr.trim() || first.ajuz.trim()).split(/\s+/).slice(0, 5).join(' ')
}
