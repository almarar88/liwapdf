import type { Poem, Verse } from './types'

/**
 * Turning loose text into verses.
 *
 * Poems arrive as text more often than they are typed verse by verse: pasted
 * from a chat, dictated into the phone, copied from an old notebook photo the
 * OCR read. The shape is nearly always recoverable — poets separate the two
 * halves of a verse with a gap, a star, a dash or a line break — so the
 * splitter looks for those first, and only when a line carries no separator
 * at all does it fall back to cutting at the balanced middle of the words.
 */

/** Anything a poet uses to mark the middle of a verse. */
const SEPARATOR = /\s*(?:[*✦✧•·⁂◆◇❖»«|]+|[-–—ـ]{2,}|\t+| {3,})\s*/

const ARABIC = /[؀-ۿ]/

export function splitIntoVerses(text: string, makeId: () => string): Verse[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return []

  const verses: Verse[] = []
  const pending: string[] = []

  const flushPair = (): void => {
    while (pending.length >= 2) {
      const sadr = pending.shift() as string
      const ajuz = pending.shift() as string
      verses.push({ id: makeId(), sadr, ajuz })
    }
  }

  for (const line of lines) {
    const halves = line.split(SEPARATOR).filter((part) => part.trim().length > 0)
    if (halves.length >= 2) {
      // A separator on the line settles it: this line is a whole verse. An
      // odd line before it was a hemistich waiting for its pair, and gets
      // the empty half rather than swallowing the next verse.
      if (pending.length === 1) verses.push({ id: makeId(), sadr: pending.shift() as string, ajuz: '' })
      verses.push({ id: makeId(), sadr: halves[0].trim(), ajuz: halves.slice(1).join(' ').trim() })
      continue
    }
    pending.push(line)
    flushPair()
  }

  if (pending.length === 1) {
    const only = pending[0]
    // A lone long line with no separator is most likely a verse typed in one
    // breath; cut it where the words balance. A short one is a half.
    const words = only.split(/\s+/)
    if (words.length >= 6 && verses.length === 0) {
      const middle = Math.ceil(words.length / 2)
      verses.push({ id: makeId(), sadr: words.slice(0, middle).join(' '), ajuz: words.slice(middle).join(' ') })
    } else {
      verses.push({ id: makeId(), sadr: only, ajuz: '' })
    }
  }

  return verses
}

/**
 * One line per verse, the two halves joined by the star — the form poets
 * paste into chats, and the one the splitter above reads back losslessly.
 */
export function poemToText(poem: Poem, divider = ' ✦ '): string {
  return poem.verses
    .filter((verse) => verse.sadr.trim() || verse.ajuz.trim())
    .map((verse) => `${verse.sadr.trim()}${divider}${verse.ajuz.trim()}`)
    .join('\n')
}

/** The rhyme letter: the last Arabic letter of the ajuz, skipping tashkeel and taa marbuta helpers. */
export function guessRhyme(poem: Poem): string {
  const last = [...poem.verses].reverse().find((verse) => verse.ajuz.trim())
  if (!last) return ''
  const bare = last.ajuz.replace(/[ً-ْٰـ]/g, '').trim()
  const letters = bare.replace(/[^ء-ي]/g, '')
  if (!letters) return ''
  let letter = letters[letters.length - 1]
  // A final alif, waw or ya is usually the vowel carrying the rhyme, so the
  // consonant before it is the rhyme letter poets name.
  if (/[اوىي]/.test(letter) && letters.length >= 2) letter = letters[letters.length - 2]
  return letter
}

export function isArabicPoem(poem: Poem): boolean {
  return poem.verses.some((verse) => ARABIC.test(verse.sadr) || ARABIC.test(verse.ajuz))
}
