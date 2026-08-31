/**
 * Text decoding that actually gets Arabic right.
 *
 * Plain-text files carry no encoding declaration, so a naive UTF-8 decode turns
 * every Windows-1256 or ISO-8859-6 Arabic file into mojibake. This module
 * checks for a BOM, validates UTF-8 strictly, and otherwise scores the
 * candidate legacy encodings by how much real script they produce.
 */

export type DetectedEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1256'
  | 'iso-8859-6'
  | 'windows-1252'
  | 'windows-1251'

export interface DecodedText {
  text: string
  encoding: DetectedEncoding
  /** True when a byte-order mark settled the question outright. */
  fromBom: boolean
}

const LEGACY_CANDIDATES: DetectedEncoding[] = [
  'windows-1256',
  'iso-8859-6',
  'windows-1252',
  'windows-1251'
]

export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = detectBom(bytes)
  if (bom) {
    return {
      text: new TextDecoder(bom.encoding).decode(bytes.subarray(bom.length)),
      encoding: bom.encoding,
      fromBom: true
    }
  }

  // UTF-16 without a BOM still shows up as alternating NUL bytes in ASCII text.
  const utf16 = sniffUtf16(bytes)
  if (utf16) {
    return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16, fromBom: false }
  }

  if (isValidUtf8(bytes)) {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', fromBom: false }
  }

  let best: { text: string; encoding: DetectedEncoding; score: number } | null = null
  for (const encoding of LEGACY_CANDIDATES) {
    let text: string
    try {
      text = new TextDecoder(encoding).decode(bytes)
    } catch {
      continue
    }
    const score = scoreText(text) + scriptFitAdjustment(encoding, text)
    if (!best || score > best.score) best = { text, encoding, score }
  }

  return best
    ? { text: best.text, encoding: best.encoding, fromBom: false }
    : { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', fromBom: false }
}

function detectBom(bytes: Uint8Array): { encoding: DetectedEncoding; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 }
  }
  return null
}

function sniffUtf16(bytes: Uint8Array): DetectedEncoding | null {
  const sample = Math.min(bytes.length, 2048)
  if (sample < 8) return null
  let evenNuls = 0
  let oddNuls = 0
  for (let index = 0; index + 1 < sample; index += 2) {
    if (bytes[index] === 0) evenNuls += 1
    if (bytes[index + 1] === 0) oddNuls += 1
  }
  const pairs = Math.floor(sample / 2)
  if (oddNuls / pairs > 0.6 && evenNuls / pairs < 0.1) return 'utf-16le'
  if (evenNuls / pairs > 0.6 && oddNuls / pairs < 0.1) return 'utf-16be'
  return null
}

/** Strict UTF-8 validation — TextDecoder with fatal:true does exactly this. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Scores how plausible a decoding is, judging the *decoding* rather than the
 * script. An earlier version rewarded Arabic and Cyrillic while penalising the
 * whole U+0080-U+00FF block, which made Windows-1252 unwinnable — every
 * accented Western European file decoded as mojibake.
 *
 * The signals that actually separate a right decoding from a wrong one are:
 * replacement characters, C1 control codes (the classic mojibake tell, since
 * no real text contains them), stray control bytes, and words that mix scripts.
 */
function scoreText(text: string): number {
  const sample = text.slice(0, 8000)
  let score = 0

  for (const character of sample) {
    const code = character.codePointAt(0) ?? 0

    if (character === '\uFFFD') {
      score -= 20
    } else if (code >= 0x80 && code <= 0x9f) {
      // C1 controls: valid in no natural text, produced constantly by decoding
      // UTF-8 or CP1256 bytes as Latin-1.
      score -= 10
    } else if (code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t') {
      score -= 10
    } else if (LETTER.test(character)) {
      score += 2
    } else if (SPACE_OR_PUNCTUATION.test(character)) {
      score += 1
    } else {
      score -= 1
    }
  }

  return score - mixedScriptPenalty(sample)
}

/**
 * A codepage exists to carry a particular script. A CP1256 decode that yields
 * no Arabic at all is the wrong codepage even when the bytes happen to produce
 * plausible letters — CP1256 and CP1252 agree on most accented Latin, so
 * without this a French file would be reported as Arabic-encoded.
 */
function scriptFitAdjustment(encoding: DetectedEncoding, text: string): number {
  const sample = text.slice(0, 4000)
  const countIn = (from: number, to: number): number => {
    let total = 0
    for (const character of sample) {
      const code = character.codePointAt(0) ?? 0
      if (code >= from && code <= to) total += 1
    }
    return total
  }

  if (encoding === 'windows-1256' || encoding === 'iso-8859-6') {
    return countIn(0x600, 0x6ff) > 0 ? 0 : -400
  }
  if (encoding === 'windows-1251') {
    return countIn(0x400, 0x4ff) > 0 ? 0 : -400
  }
  return 0
}

const LETTER = /\p{L}|\p{M}/u
const SPACE_OR_PUNCTUATION = /[\s\p{N}\p{P}\p{S}]/u

/**
 * A word whose letters come from two different scripts is almost always a
 * decoding artefact — "Ø§Ù„Ø³" style Latin-1 noise, or Arabic bytes read as
 * Cyrillic. Real bilingual text separates scripts at word boundaries.
 */
function mixedScriptPenalty(text: string): number {
  let penalty = 0
  for (const word of text.split(/[\s\p{P}]+/u).slice(0, 1200)) {
    if (word.length < 2) continue
    const scripts = new Set<string>()
    for (const character of word) {
      const script = scriptOf(character.codePointAt(0) ?? 0)
      if (script) scripts.add(script)
    }
    if (scripts.size > 1) penalty += 6
  }
  return penalty
}

function scriptOf(code: number): string | null {
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 'latin'
  if (code >= 0xc0 && code <= 0x24f) return 'latin'
  if (code >= 0x600 && code <= 0x6ff) return 'arabic'
  if (code >= 0x750 && code <= 0x77f) return 'arabic'
  if (code >= 0x590 && code <= 0x5ff) return 'hebrew'
  if (code >= 0x400 && code <= 0x4ff) return 'cyrillic'
  if (code >= 0x370 && code <= 0x3ff) return 'greek'
  return null
}

const RTL_RANGE = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
const LTR_RANGE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/

/** Picks a base direction from the balance of strong characters in the text. */
export function detectDirection(text: string): 'rtl' | 'ltr' {
  const sample = text.slice(0, 6000)
  let rtl = 0
  let ltr = 0
  for (const character of sample) {
    if (RTL_RANGE.test(character)) rtl += 1
    else if (LTR_RANGE.test(character)) ltr += 1
  }
  return rtl > ltr ? 'rtl' : 'ltr'
}

export function containsArabic(text: string): boolean {
  return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text)
}

/**
 * Normalizes Arabic presentation forms (U+FB50..U+FEFF) back to their base
 * letters. Some PDF and legacy DOC producers emit the shaped glyphs directly,
 * which breaks search, copy and re-layout.
 */
export function normalizeArabicPresentation(text: string): string {
  if (!/[ﭐ-﷿ﹰ-﻿]/.test(text)) return text
  return text.normalize('NFKC').replace(/‏|‎/g, '')
}

/**
 * Folds an Arabic string to a form that compares equal across the spelling
 * variations readers do not distinguish. Without this, searching a PDF for
 * "الاسم" misses "الأسم", and any word carrying tashkeel never matches.
 *
 * Applied to both the query and the haystack, never to stored content.
 */
export function normalizeArabicForSearch(text: string): string {
  return (
    normalizeArabicPresentation(text)
      // Tashkeel (harakat), superscript alef, and the tatweel stretch glyph
      // carry no lexical weight for search.
      .replace(/[ً-ْٰـۖ-ۭ]/g, '')
      // Hamza-carrier and alef variants users type interchangeably.
      .replace(/[آأإٱٲٳ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[ؤ]/g, 'و')
      .replace(/[ئ]/g, 'ي')
      // Arabic-Indic and extended Arabic-Indic digits fold to Western.
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
      .toLowerCase()
  )
}

/** Case- and script-folded form used for all in-app text search. */
export function normalizeForSearch(text: string): string {
  return normalizeArabicForSearch(text).normalize('NFKC')
}
