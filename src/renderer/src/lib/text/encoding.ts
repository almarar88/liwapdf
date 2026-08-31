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
    const score = scoreText(text)
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
 * Rewards letters and common punctuation, punishes replacement characters and
 * isolated control bytes. The correct legacy encoding scores highest because
 * the wrong one scatters accented Latin noise through Arabic text.
 */
function scoreText(text: string): number {
  let score = 0
  const sample = text.slice(0, 8000)
  for (const character of sample) {
    const code = character.codePointAt(0) ?? 0
    if (character === '�') {
      score -= 12
    } else if (code >= 0x0600 && code <= 0x06ff) {
      score += 4 // Arabic
    } else if (code >= 0x0590 && code <= 0x05ff) {
      score += 3 // Hebrew
    } else if (code >= 0x0400 && code <= 0x04ff) {
      score += 3 // Cyrillic
    } else if (/[A-Za-z]/.test(character)) {
      score += 2
    } else if (/[\s.,;:!?()[\]{}"'\-–—/@#%&*+=<>|\\0-9]/.test(character)) {
      score += 1
    } else if (code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t') {
      score -= 8
    } else if (code >= 0x80 && code <= 0xff) {
      score -= 2 // stray Latin-1 supplement is the classic mojibake signature
    }
  }
  return score
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
