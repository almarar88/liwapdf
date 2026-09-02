import { PDFArray, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, rgb, type PDFDocument } from '@cantoo/pdf-lib'
import { openForRender } from './pdfjs'
import { load, save } from './ops'
import { drawSmartText, isRtlText, measureSmartText, prepareFonts } from './typography'
import { normalizeForSearch } from '../text/encoding'

/**
 * Find and replace inside a PDF's own text.
 *
 * A PDF has no paragraphs to reflow, so this does what a careful hand does
 * with a correction pen: locate each run that contains the phrase, paint
 * the run's own box white, and write the corrected run back at the same
 * baseline in the same size. The rest of the page is untouched, and the new
 * text is real text — searchable, selectable — not a picture of one. Runs
 * longer than the box after the change are set slightly smaller so they
 * never overrun a neighbour.
 *
 * Matches that straddle two runs (a phrase split across a line break) are
 * left alone and counted separately, rather than half-replaced.
 *
 * Painting over a run hides it from the eye but not from search or copy,
 * so the original string is also struck from the page's content stream
 * wherever it can be recognised there — plain-encoded fonts, which is most
 * Latin text. Fonts that show text as glyph indices (most embedded Arabic
 * fonts) cannot be matched byte-for-byte; those runs stay covered rather
 * than removed, and the count of them is reported so the caller can say so.
 */

export interface ReplaceTextOptions {
  find: string
  replace: string
  /** Fold Arabic and case the way search does; off means exact characters. */
  loose?: boolean
  /** Ink colour of the replacement; the original's colour is not recoverable. */
  color?: string
  password?: string
  pages?: number[]
  onProgress?: (done: number, total: number) => void
}

export interface ReplaceTextResult {
  bytes: Uint8Array
  replaced: number
  /** Matches found but skipped because they crossed run boundaries. */
  skipped: number
  /** Replaced runs whose original text is painted over but still in the file. */
  covered: number
}

export async function replaceText(bytes: Uint8Array, options: ReplaceTextOptions): Promise<ReplaceTextResult> {
  const find = options.find
  if (!find) return { bytes, replaced: 0, skipped: 0, covered: 0 }
  const loose = options.loose ?? true
  const needle = loose ? normalizeForSearch(find) : find

  interface Edit {
    pageIndex: number
    x: number
    y: number
    width: number
    height: number
    original: string
    replacement: string
  }
  const edits: Edit[] = []
  let skipped = 0

  const source = await openForRender(bytes, options.password)
  try {
    const wanted = options.pages && options.pages.length > 0 ? options.pages : Array.from({ length: source.numPages }, (_, i) => i)
    for (const [position, pageIndex] of wanted.entries()) {
      options.onProgress?.(position, wanted.length * 2)
      const page = await source.getPage(pageIndex + 1)
      const content = await page.getTextContent()
      let pageText = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        pageText += item.str
        const text = item.str
        const hay = loose ? normalizeForSearch(text) : text
        if (!text.trim() || !hay.includes(needle)) continue
        const [, , , , tx, ty] = item.transform as number[]
        const replacement = replaceAll(text, find, options.replace, loose)
        if (replacement === text) continue
        edits.push({
          pageIndex,
          x: tx,
          y: ty,
          width: Math.max(item.width, 1),
          height: Math.max(item.height, 4),
          original: text,
          replacement
        })
      }
      // Phrases that only exist across run boundaries: found on the page as a
      // whole, not inside any single run.
      const pageHay = loose ? normalizeForSearch(pageText) : pageText
      const total = countOccurrences(pageHay, needle)
      const inRuns = edits
        .filter((edit) => edit.pageIndex === pageIndex)
        .reduce((sum, edit) => sum + countOccurrences(loose ? normalizeForSearch(edit.original) : edit.original, needle), 0)
      skipped += Math.max(0, total - inRuns)
      page.cleanup()
    }
  } finally {
    await source.destroy().catch(() => undefined)
  }

  if (edits.length === 0) return { bytes, replaced: 0, skipped, covered: 0 }

  const document = await load(bytes, options.password)
  const fonts = await prepareFonts(document)
  const pages = document.getPages()
  const color = options.color ?? '#000000'
  const white = rgb(1, 1, 1)

  // Strike the originals from the content streams first, before our own
  // drawing adds streams of its own to the page.
  let scrubbed = 0
  for (const pageIndex of new Set(edits.map((edit) => edit.pageIndex))) {
    const page = pages[pageIndex]
    if (!page) continue
    const originals = edits.filter((edit) => edit.pageIndex === pageIndex).map((edit) => edit.original)
    scrubbed += scrubPage(document, page.node, originals, loose)
  }

  for (const [index, edit] of edits.entries()) {
    options.onProgress?.(edits.length + index, edits.length * 2)
    const page = pages[edit.pageIndex]
    if (!page) continue
    const size = edit.height
    // The run's box: from a little below the baseline (descenders) to the
    // ascender line, and exactly its advance width.
    page.drawRectangle({
      x: edit.x - 0.5,
      y: edit.y - size * 0.25,
      width: edit.width + 1,
      height: size * 1.25,
      color: white
    })
    const rtl = isRtlText(edit.replacement)
    let drawSize = size
    let measured = await measureSmartText(fonts, edit.replacement, { size: drawSize, color, rtl })
    if (measured.width > edit.width && measured.width > 0) {
      drawSize = Math.max(4, (size * edit.width) / measured.width)
      measured = await measureSmartText(fonts, edit.replacement, { size: drawSize, color, rtl })
    }
    // Right-to-left runs keep their right edge; everything else its left.
    const x = rtl ? edit.x + edit.width - measured.width : edit.x
    await drawSmartText(page, fonts, edit.replacement, x, edit.y, { size: drawSize, color, rtl })
  }

  return { bytes: await save(document), replaced: edits.length, skipped, covered: Math.max(0, edits.length - scrubbed) }
}

/**
 * Empties every string operand in the page's content streams whose decoded
 * text is one of `originals`, and returns how many were emptied. Strings are
 * compared as text after PDFDocEncoding escapes, so only fonts whose bytes
 * are the characters (standard and WinAnsi fonts) can match; anything else
 * is left alone rather than guessed at.
 */
export function scrubPage(document: PDFDocument, node: ReturnType<PDFDocument['getPage']>['node'], originals: string[], loose: boolean): number {
  const wanted = new Set(originals.map((text) => textKey(text, loose)).filter(Boolean))
  if (wanted.size === 0) return 0
  const entry = node.get(PDFName.of('Contents'))
  const refs: PDFRef[] = []
  if (entry instanceof PDFRef) refs.push(entry)
  else if (entry instanceof PDFArray) for (const item of entry.asArray()) if (item instanceof PDFRef) refs.push(item)
  let scrubbed = 0
  for (const ref of refs) {
    const stream = document.context.lookup(ref)
    if (!(stream instanceof PDFRawStream)) continue
    let decoded: Uint8Array
    try {
      decoded = decodePDFRawStream(stream).decode()
    } catch {
      continue
    }
    const result = scrubContent(decoded, wanted, loose)
    if (result.scrubbed === 0) continue
    scrubbed += result.scrubbed
    document.context.assign(ref, document.context.flateStream(result.bytes))
  }
  return scrubbed
}

function textKey(text: string, loose: boolean): string {
  return (loose ? normalizeForSearch(text) : text).replace(/\s+/g, '')
}

export function scrubContent(source: Uint8Array, wanted: Set<string>, loose: boolean): { bytes: Uint8Array; scrubbed: number } {
  let text = ''
  for (let i = 0; i < source.length; i += 1) text += String.fromCharCode(source[i])
  const cuts: { start: number; end: number; hex: boolean }[] = []
  let scrubbed = 0
  interface Part {
    start: number
    end: number
    hex: boolean
    text: string
  }
  let array: Part[] | null = null
  const matches = (value: string): boolean => wanted.has(textKey(value, loose))
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '%') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1
      continue
    }
    if (c === '(') {
      const literal = readLiteral(text, i)
      const part: Part = { start: i, end: literal.end, hex: false, text: literal.text }
      if (array) array.push(part)
      else if (matches(part.text)) {
        cuts.push(part)
        scrubbed += 1
      }
      i = literal.end
      continue
    }
    if (c === '<') {
      if (text[i + 1] === '<') {
        i += 2
        continue
      }
      const close = text.indexOf('>', i)
      if (close === -1) break
      const part: Part = { start: i, end: close + 1, hex: true, text: hexToText(text.slice(i + 1, close)) }
      if (array) array.push(part)
      else if (matches(part.text)) {
        cuts.push(part)
        scrubbed += 1
      }
      i = close + 1
      continue
    }
    if (c === '[') {
      array = []
      i += 1
      continue
    }
    if (c === ']') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j += 1
      if (array && array.length > 0 && text.startsWith('TJ', j) && matches(array.map((part) => part.text).join(''))) {
        cuts.push(...array)
        scrubbed += 1
      }
      array = null
      i += 1
      continue
    }
    i += 1
  }
  if (cuts.length === 0) return { bytes: source, scrubbed: 0 }
  cuts.sort((a, b) => a.start - b.start)
  let out = ''
  let last = 0
  for (const cut of cuts) {
    out += text.slice(last, cut.start) + (cut.hex ? '<>' : '()')
    last = cut.end
  }
  out += text.slice(last)
  const bytes = new Uint8Array(out.length)
  for (let k = 0; k < out.length; k += 1) bytes[k] = out.charCodeAt(k) & 0xff
  return { bytes, scrubbed }
}

/** Reads a `(...)` literal starting at `start`; returns the decoded text and the index after the closing paren. */
function readLiteral(text: string, start: number): { text: string; end: number } {
  let depth = 0
  let out = ''
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      const next = text[i + 1]
      if (next === undefined) break
      if (/[0-7]/.test(next)) {
        let octal = ''
        let j = i + 1
        while (j < text.length && octal.length < 3 && /[0-7]/.test(text[j])) octal += text[j++]
        out += winAnsiChar(parseInt(octal, 8) & 0xff)
        i = j
        continue
      }
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
      if (next === '\r') {
        i += text[i + 2] === '\n' ? 3 : 2
        continue
      }
      if (next === '\n') {
        i += 2
        continue
      }
      out += map[next] ?? next
      i += 2
      continue
    }
    if (c === '(') {
      depth += 1
      if (depth > 1) out += c
      i += 1
      continue
    }
    if (c === ')') {
      depth -= 1
      i += 1
      if (depth === 0) return { text: out, end: i }
      out += c
      continue
    }
    out += winAnsiChar(c.charCodeAt(0))
    i += 1
  }
  return { text: out, end: i }
}

function hexToText(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  let out = ''
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2).padEnd(2, '0')
    out += winAnsiChar(parseInt(pair, 16))
  }
  return out
}

/**
 * WinAnsi (cp1252) is what the standard fonts and most simple fonts use;
 * its 0x80–0x9F block holds the dashes and curly quotes that Latin-1 leaves
 * undefined, and pdf.js reports those as their real Unicode characters.
 */
const WIN_ANSI_HIGH = [
  0x20ac, 0x2022, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x2022, 0x017d, 0x2022,
  0x2022, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x2022, 0x017e, 0x0178
]

function winAnsiChar(byte: number): string {
  if (byte >= 0x80 && byte <= 0x9f) return String.fromCharCode(WIN_ANSI_HIGH[byte - 0x80])
  return String.fromCharCode(byte)
}

function replaceAll(text: string, find: string, replacement: string, loose: boolean): string {
  if (!loose) return text.split(find).join(replacement)
  // Loose matching works on the folded string, so the replacement has to be
  // mapped back onto the original characters: walk both in step.
  const needle = normalizeForSearch(find)
  let out = ''
  let i = 0
  while (i < text.length) {
    // Try the shortest original slice whose folded form equals the needle.
    let matched = 0
    for (let length = 1; length <= Math.min(text.length - i, find.length * 3); length += 1) {
      const folded = normalizeForSearch(text.slice(i, i + length))
      if (folded === needle) {
        matched = length
        break
      }
      if (folded.length > needle.length) break
    }
    if (matched > 0) {
      out += replacement
      i += matched
    } else {
      out += text[i]
      i += 1
    }
  }
  return out
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let at = hay.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = hay.indexOf(needle, at + needle.length)
  }
  return count
}
