import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib'
import * as fontkit from 'fontkit'
import bidiFactory from 'bidi-js'
import amiriRegularUrl from '../../assets/fonts/Amiri-Regular.ttf?url'
import amiriBoldUrl from '../../assets/fonts/Amiri-Bold.ttf?url'
import {
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText
} from '@cantoo/pdf-lib'
import { hexToRgb, needsComplexShaping } from '../format'

/**
 * Real vector text in generated PDFs, in any script.
 *
 * The base-14 PDF fonts only cover WinAnsi, so Arabic used to be rasterized to
 * a PNG — unsearchable, unselectable, and blurry when zoomed. Instead we embed
 * a subset of Amiri through fontkit, which applies the OpenType Arabic shaper.
 *
 * fontkit shapes and mirrors a pure-RTL run correctly but does not implement
 * the Unicode Bidirectional Algorithm, so a string mixing Arabic with Latin or
 * with Western digits comes out in the wrong order. `layoutRuns` runs UAX#9
 * here and hands fontkit one directional run at a time, which each of them
 * shapes correctly on its own.
 */

const bidi = bidiFactory()

/* ------------------------------------------------------------------ fonts */

let regularBytes: Uint8Array | null = null
let boldBytes: Uint8Array | null = null

async function loadFontBytes(bold: boolean): Promise<Uint8Array> {
  if (bold && boldBytes) return boldBytes
  if (!bold && regularBytes) return regularBytes
  const response = await fetch(bold ? amiriBoldUrl : amiriRegularUrl)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bold) boldBytes = bytes
  else regularBytes = bytes
  return bytes
}

export interface FontSet {
  /** Base-14 Helvetica — compact, but WinAnsi only. */
  latin: PDFFont
  latinBold: PDFFont
  /** Embedded Amiri subset — every script, shaped. Loaded on first need. */
  unicode: () => Promise<PDFFont>
  unicodeBold: () => Promise<PDFFont>
}

/**
 * Prepares the fonts a document may need. The Unicode faces are lazy: a
 * Latin-only job never pays the embed cost, and a document that needs Arabic
 * embeds one subset shared by every label drawn on it.
 */
export async function prepareFonts(document: PDFDocument): Promise<FontSet> {
  const latin = await document.embedFont(StandardFonts.Helvetica)
  const latinBold = await document.embedFont(StandardFonts.HelveticaBold)

  let unicodeFont: PDFFont | null = null
  let unicodeBoldFont: PDFFont | null = null
  let registered = false

  const ensureRegistered = (): void => {
    if (registered) return
    document.registerFontkit(fontkit as never)
    registered = true
  }

  return {
    latin,
    latinBold,
    unicode: async () => {
      if (unicodeFont) return unicodeFont
      ensureRegistered()
      unicodeFont = await document.embedFont(await loadFontBytes(false), { subset: true })
      return unicodeFont
    },
    unicodeBold: async () => {
      if (unicodeBoldFont) return unicodeBoldFont
      ensureRegistered()
      unicodeBoldFont = await document.embedFont(await loadFontBytes(true), { subset: true })
      return unicodeBoldFont
    }
  }
}

/** Picks the narrowest font that can actually render the string. */
export async function fontFor(fonts: FontSet, text: string, bold = false): Promise<PDFFont> {
  if (!needsComplexShaping(text)) return bold ? fonts.latinBold : fonts.latin
  return bold ? fonts.unicodeBold() : fonts.unicode()
}

/* ------------------------------------------------------------------- bidi */

export interface DirectionalRun {
  text: string
  rtl: boolean
}

/**
 * Splits a line into directional runs already ordered left-to-right on the
 * page. Implements the UAX#9 rule L2 reordering over the embedding levels
 * bidi-js resolves.
 */
export function layoutRuns(text: string, baseRtl: boolean): DirectionalRun[] {
  if (!text) return []
  // A single-script line needs no reordering, and skipping bidi keeps the
  // common Latin case free.
  if (!needsComplexShaping(text) && !baseRtl) return [{ text, rtl: false }]

  const { levels } = bidi.getEmbeddingLevels(text, baseRtl ? 'rtl' : 'ltr')

  const runs: { text: string; level: number }[] = []
  let start = 0
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || levels[index] !== levels[start]) {
      runs.push({ text: text.slice(start, index), level: levels[start] })
      start = index
    }
  }

  const maxLevel = Math.max(0, ...levels)
  const oddLevels = Array.from(levels).filter((level) => level % 2 === 1)
  const minOdd = oddLevels.length > 0 ? Math.min(...oddLevels) : maxLevel + 1

  let ordered = runs
  for (let level = maxLevel; level >= minOdd; level -= 1) {
    let index = 0
    while (index < ordered.length) {
      if (ordered[index].level >= level) {
        let end = index
        while (end + 1 < ordered.length && ordered[end + 1].level >= level) end += 1
        ordered = [
          ...ordered.slice(0, index),
          ...ordered.slice(index, end + 1).reverse(),
          ...ordered.slice(end + 1)
        ]
        index = end + 1
      } else {
        index += 1
      }
    }
  }

  return ordered.map((run) => ({ text: run.text, rtl: run.level % 2 === 1 }))
}

/** True when a line reads right-to-left by default. */
export function isRtlText(text: string): boolean {
  return /[֑-߿ࡰ-࢟ࢠ-ࣿיִ-﷿ﹰ-﻿]/.test(text)
}

/** Arabic-Indic and Extended Arabic-Indic digits, which live in the Arabic block. */
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/

/**
 * Puts a run into the character order the shaper expects.
 *
 * pdf-lib calls `font.layout(text, features)` without fontkit's `direction`
 * argument, so fontkit detects the script itself — and Arabic-Indic digits sit
 * in the Arabic block, so a run of nothing but digits is detected as Arabic and
 * shaped right to left. UAX#9 puts those digits at an *even* embedding level
 * inside an Arabic paragraph, precisely because a number reads left to right,
 * so the shaper reverses a run the bidi pass had already ordered correctly:
 * page number \u0661\u0662 came out \u0662\u0661, and a ten-digit ID came out backwards both on
 * the page and in every extractor.
 *
 * Pre-reversing an even-level Arabic-digit run cancels that, which is the only
 * lever available short of forking the embedder. Odd-level runs really are
 * right to left and are left for the shaper to reverse.
 */
function shapedOrder(run: DirectionalRun): string {
  if (run.rtl || !ARABIC_DIGITS.test(run.text)) return run.text
  return [...run.text].reverse().join('')
}

/* --------------------------------------------------------------- drawing */

export interface SmartTextOptions {
  size: number
  color: string
  opacity?: number
  bold?: boolean
  rotate?: number
  /** Base paragraph direction; inferred from the text when omitted. */
  rtl?: boolean
}

export interface MeasuredText {
  width: number
  height: number
}

/**
 * Measures a line as it will actually be drawn, across mixed scripts.
 * A run that the chosen font cannot encode falls back to the Unicode face.
 */
export async function measureSmartText(
  fonts: FontSet,
  text: string,
  options: SmartTextOptions
): Promise<MeasuredText> {
  const runs = layoutRuns(text, options.rtl ?? isRtlText(text))
  let width = 0
  for (const run of runs) {
    const font = await fontFor(fonts, run.text, options.bold)
    width += safeWidth(font, run.text, options.size)
  }
  const font = await fontFor(fonts, text, options.bold)
  return { width, height: font.heightAtSize(options.size) }
}

/**
 * Draws one line of text at (x, y) — the baseline-left corner in PDF space —
 * laying its directional runs out in visual order.
 */
export async function drawSmartText(
  page: PDFPage,
  fonts: FontSet,
  text: string,
  x: number,
  y: number,
  options: SmartTextOptions
): Promise<MeasuredText> {
  const runs = layoutRuns(text, options.rtl ?? isRtlText(text))
  const { r, g, b } = hexToRgb(options.color)
  const rotation = options.rotate ?? 0
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  let advance = 0
  for (const run of runs) {
    const font = await fontFor(fonts, run.text, options.bold)
    const width = safeWidth(font, run.text, options.size)
    if (run.text.trim()) {
      // Rotation is applied per run about the line's origin so a rotated
      // watermark keeps its runs on one baseline.
      page.drawText(shapedOrder(run), {
        x: x + advance * cos,
        y: y + advance * sin,
        size: options.size,
        font,
        color: rgb(r, g, b),
        opacity: options.opacity ?? 1,
        rotate: degrees(rotation)
      })
    }
    advance += width
  }

  const measureFont = await fontFor(fonts, text, options.bold)
  return { width: advance, height: measureFont.heightAtSize(options.size) }
}

/**
 * widthOfTextAtSize throws on a character the font cannot encode. Callers are
 * drawing user-supplied strings, so a missing glyph must degrade, not crash.
 */
function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size)
  } catch {
    return text.length * size * 0.5
  }
}

/** Splits a paragraph into lines that fit `maxWidth`, honouring existing breaks. */
export async function wrapSmartText(
  fonts: FontSet,
  text: string,
  maxWidth: number,
  options: SmartTextOptions
): Promise<string[]> {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    const words = paragraph.split(/(\s+)/)
    let current = ''
    for (const word of words) {
      const candidate = current + word
      const { width } = await measureSmartText(fonts, candidate, options)
      if (width > maxWidth && current.trim()) {
        lines.push(current.trimEnd())
        current = word.trimStart()
      } else {
        current = candidate
      }
    }
    if (current.trim() || paragraph.trim() === '') lines.push(current.trimEnd())
  }
  return lines
}

/* ----------------------------------------------------------------- digits */

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

export function toArabicIndicDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => ARABIC_INDIC[Number(digit)])
}

export function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.codePointAt(0)!
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

/* ------------------------------------------------------------- calendars */

/**
 * Formats a date on the Umm al-Qura Hijri calendar, which Chromium ships with
 * ICU. Used for headers, footers and page-number templates.
 */
export function formatHijri(date: Date, language: 'ar' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(
      language === 'ar' ? 'ar-SA-u-ca-islamic-umalqura' : 'en-US-u-ca-islamic-umalqura',
      { day: 'numeric', month: 'long', year: 'numeric' }
    ).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function formatGregorian(date: Date, language: 'ar' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/**
 * Draws text that is present but not painted — PDF text rendering mode 3.
 *
 * This is how a scanned page becomes searchable: the picture stays exactly as
 * it was, and an invisible layer of the recognised words sits on top of it at
 * the coordinates OCR found them, so selection, search and copy all work while
 * nothing about the page's appearance changes.
 *
 * The box is honoured in both directions: the size comes from its height and
 * the horizontal scaling (Tz) stretches the run to its width, so a text
 * selection lands on the ink the reader is pointing at.
 */
export async function drawInvisibleText(
  page: PDFPage,
  fonts: FontSet,
  text: string,
  box: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed || box.width <= 0 || box.height <= 0) return

  // One showText with one text matrix, so the string has to be in visual order
  // already — and an OCR'd Arabic-Indic number needs the same un-reversal the
  // visible path does, or a search for the ID finds nothing.
  const value = layoutRuns(trimmed, isRtlText(trimmed)).map(shapedOrder).join('') || trimmed

  const font = await fontFor(fonts, value, false)
  // Cap-height rather than the full box: OCR boxes include ascender and
  // descender space, and oversizing pushes the selection past the glyphs.
  const size = Math.max(1, box.height * 0.82)
  const natural = safeWidth(font, value, size)
  const squeeze = natural > 0 ? Math.max(10, Math.min(400, (box.width / natural) * 100)) : 100

  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(page.node.newFontDictionary(font.name, font.ref), size),
    setCharacterSqueeze(squeeze),
    setTextMatrix(1, 0, 0, 1, box.x, box.y),
    showText(font.encodeText(value)),
    endText(),
    popGraphicsState()
  )
}
