import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  rgb,
  type PDFDocument,
  type PDFPage
} from '@cantoo/pdf-lib'
import {
  IDENTITY,
  applyMatrix,
  invertMatrix,
  latin1Decode,
  latin1Encode,
  multiply,
  rectsIntersect,
  spliceAll,
  walkContentStream,
  type FontMetrics,
  type Matrix,
  type Rect,
  type Splice
} from './content-stream'
import { normalizeForSearch } from '../text/encoding'
import { load, save, type PdfBytes } from './ops'
import { openForRender } from './pdfjs'
import { foldWithOffsets, renderPageToBytes } from './render'

export interface RedactRegion {
  pageIndex: number
  /** Normalized 0..1 coordinates with the origin at the page's top-left. */
  x: number
  y: number
  width: number
  height: number
}

export interface RedactionReport {
  bytes: PdfBytes
  /** Text runs and images removed from page content streams. */
  removedRuns: number
  /** Annotations (comments, links, form fields) deleted outright. */
  removedAnnotations: number
  /**
   * Pages whose content could not be edited safely and were replaced with a
   * flattened image instead. Their text is gone too, but so is everyone's.
   */
  rasterizedPages: number[]
  /** True when a post-pass confirmed no text survives inside any region. */
  verified: boolean
}

/** How far outside the drawn box a glyph still counts as covered, in points. */
const BLEED = 1.5

/**
 * Removes content from the given regions and then proves it is gone.
 *
 * A black rectangle is not redaction: the characters underneath survive in the
 * content stream and come straight back out of any extractor. So this does the
 * real thing — deletes the text-showing operators and image draws that fall
 * inside each region, drops overlapping annotations and form fields, and only
 * then paints the box.
 *
 * Because a content-stream edit depends on how faithfully we can model the
 * producer's font metrics, the result is verified by re-extracting text with
 * pdf.js. Any page where something survived is flattened to an image, which
 * cannot hide text by construction. The report says exactly which pages that
 * happened to, so the UI never has to overstate what was done.
 */
export async function applyRedactions(
  bytes: PdfBytes,
  regions: RedactRegion[],
  password?: string,
  onProgress?: (fraction: number) => void
): Promise<RedactionReport> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  const byPage = groupByPage(regions)

  let removedRuns = 0
  let removedAnnotations = 0

  let done = 0
  for (const [pageIndex, pageRegions] of byPage) {
    const page = pages[pageIndex]
    if (page) {
      const userRegions = pageRegions.map((region) => toUserSpace(page, region))
      removedRuns += stripPageContent(document, page, userRegions)
      removedAnnotations += stripAnnotations(page, userRegions)
      paintBoxes(page, userRegions)
    }
    done += 1
    onProgress?.((done / byPage.size) * 0.6)
  }

  let output = await save(document)

  const survivors = await findSurvivingText(output, byPage, password)
  onProgress?.(0.8)

  if (survivors.length > 0) {
    output = await rasterizePages(output, survivors, byPage, password)
  }
  onProgress?.(1)

  // Honest by construction: true means the survivor check actually ran and
  // anything it found was flattened, not merely that the edit was attempted.
  const verified = await findSurvivingText(output, byPage, password).then(
    (remaining) => remaining.length === 0,
    () => false
  )

  return {
    bytes: output,
    removedRuns,
    removedAnnotations,
    rasterizedPages: survivors,
    verified
  }
}

export interface TextMatch {
  pageIndex: number
  /** The matched text as it appears in the document. */
  text: string
  /** Enough of the line either side to recognise the hit. */
  context: string
  region: RedactRegion
}

/**
 * Finds every occurrence of a query and returns a redaction region for each.
 *
 * Dragging one box per instance is unusable for an ID number that appears on
 * four hundred pages, which is the case redaction is actually for. Matching
 * goes through the same Arabic folding as the app's search, so a query written
 * without tashkeel still finds the tashkeel'd occurrences.
 */
export async function findTextRegions(
  bytes: PdfBytes,
  query: string,
  options: { regex?: boolean; password?: string; limit?: number } = {}
): Promise<TextMatch[]> {
  const source = query.trim()
  if (!source) return []

  let pattern: RegExp | null = null
  if (options.regex) {
    try {
      pattern = new RegExp(source, 'giu')
    } catch {
      throw new Error('invalid-pattern')
    }
  }
  const needle = pattern ? '' : normalizeForSearch(source)
  if (!pattern && !needle) return []

  const document = await openForRender(bytes, options.password)
  const matches: TextMatch[] = []
  const limit = options.limit ?? 5000

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (matches.length >= limit) break
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()

      interface Piece {
        start: number
        end: number
        x: number
        y: number
        width: number
        height: number
        rtl: boolean
      }
      const pieces: Piece[] = []
      let pageText = ''

      for (const item of content.items) {
        if (!('str' in item)) continue
        const text = item.str
        const [, , , , tx, ty] = item.transform as number[]
        const height = Math.max(item.height, 1)
        if (text.length > 0) {
          pieces.push({
            start: pageText.length,
            end: pageText.length + text.length,
            x: tx,
            y: ty,
            width: Math.max(item.width, 0),
            height,
            rtl: /[؀-ۿ֑-ֿ]/.test(text)
          })
        }
        pageText += text
        if ((item as { hasEOL?: boolean }).hasEOL) pageText += '\n'
      }

      const ranges: [number, number][] = []
      if (pattern) {
        pattern.lastIndex = 0
        let found = pattern.exec(pageText)
        while (found && ranges.length < limit) {
          if (found[0].length > 0) ranges.push([found.index, found.index + found[0].length])
          if (pattern.lastIndex === found.index) pattern.lastIndex += 1
          found = pattern.exec(pageText)
        }
      } else {
        const { folded, offsets } = foldWithOffsets(pageText)
        let cursor = folded.indexOf(needle)
        while (cursor !== -1 && ranges.length < limit) {
          ranges.push([
            offsets[cursor] ?? 0,
            offsets[cursor + needle.length] ?? pageText.length
          ])
          cursor = folded.indexOf(needle, cursor + Math.max(1, needle.length))
        }
      }

      for (const [start, end] of ranges) {
        const covering = pieces.filter((piece) => piece.start < end && piece.end > start)
        if (covering.length === 0) continue

        let left = Infinity
        let right = -Infinity
        let bottom = Infinity
        let top = -Infinity
        for (const piece of covering) {
          const length = Math.max(1, piece.end - piece.start)
          // Narrow to the matched characters only for left-to-right runs; for
          // RTL the reported advance does not map onto logical offsets, and
          // covering the whole run is the safe direction to be wrong in.
          const from = piece.rtl ? 0 : Math.max(0, start - piece.start) / length
          const to = piece.rtl ? 1 : Math.min(length, end - piece.start) / length
          const pad = piece.width / length / 2
          const x0 = piece.x + piece.width * from - pad
          const x1 = piece.x + piece.width * to + pad
          left = Math.min(left, x0)
          right = Math.max(right, x1)
          bottom = Math.min(bottom, piece.y - piece.height * 0.25)
          top = Math.max(top, piece.y + piece.height)
        }

        const corners = viewport.convertToViewportRectangle([left, bottom, right, top]) as number[]
        const x = Math.min(corners[0], corners[2])
        const y = Math.min(corners[1], corners[3])
        matches.push({
          pageIndex: pageNumber - 1,
          text: pageText.slice(start, end),
          context: pageText.slice(Math.max(0, start - 30), end + 30).replace(/\s+/g, ' ').trim(),
          region: {
            pageIndex: pageNumber - 1,
            x: x / viewport.width,
            y: y / viewport.height,
            width: Math.abs(corners[2] - corners[0]) / viewport.width,
            height: Math.abs(corners[3] - corners[1]) / viewport.height
          }
        })
      }
      page.cleanup()
    }
  } finally {
    await document.destroy().catch(() => undefined)
  }

  return matches
}

function groupByPage(regions: RedactRegion[]): Map<number, RedactRegion[]> {
  const grouped = new Map<number, RedactRegion[]>()
  for (const region of regions) {
    const list = grouped.get(region.pageIndex)
    if (list) list.push(region)
    else grouped.set(region.pageIndex, [region])
  }
  return grouped
}

/* ------------------------------------------------------------ geometry */

/**
 * Rebuilds pdf.js's page-to-canvas transform at scale 1, so a rectangle the
 * user drew on the rendered page lands on exactly the same content in the
 * file — including on pages carrying a /Rotate or an offset CropBox.
 */
function displayTransform(page: PDFPage): { matrix: Matrix; width: number; height: number } {
  const box = page.getCropBox?.() ?? page.getMediaBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const x0 = box.x
  const y0 = box.y
  const x1 = box.x + box.width
  const y1 = box.y + box.height
  const centerX = (x0 + x1) / 2
  const centerY = (y0 + y1) / 2

  let a = 1
  let b = 0
  let c = 0
  let d = -1
  if (rotation === 90) {
    a = 0
    b = 1
    c = 1
    d = 0
  } else if (rotation === 180) {
    a = -1
    b = 0
    c = 0
    d = 1
  } else if (rotation === 270) {
    a = 0
    b = -1
    c = -1
    d = 0
  }

  const swapped = a === 0
  const width = swapped ? Math.abs(y1 - y0) : Math.abs(x1 - x0)
  const height = swapped ? Math.abs(x1 - x0) : Math.abs(y1 - y0)
  const offsetX = swapped ? Math.abs(centerY - y0) : Math.abs(centerX - x0)
  const offsetY = swapped ? Math.abs(centerX - x0) : Math.abs(centerY - y0)

  return {
    matrix: {
      a,
      b,
      c,
      d,
      e: offsetX - a * centerX - c * centerY,
      f: offsetY - b * centerX - d * centerY
    },
    width,
    height
  }
}

/** Maps a normalized top-left rectangle from display space into page space. */
function toUserSpace(page: PDFPage, region: RedactRegion): Rect {
  const { matrix, width, height } = displayTransform(page)
  const inverse = invertMatrix(matrix)
  if (!inverse) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const corners = [
    applyMatrix(inverse, region.x * width, region.y * height),
    applyMatrix(inverse, (region.x + region.width) * width, region.y * height),
    applyMatrix(inverse, (region.x + region.width) * width, (region.y + region.height) * height),
    applyMatrix(inverse, region.x * width, (region.y + region.height) * height)
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function paintBoxes(page: PDFPage, regions: Rect[]): void {
  for (const region of regions) {
    page.drawRectangle({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      color: rgb(0, 0, 0),
      opacity: 1,
      borderWidth: 0
    })
  }
}

/* ------------------------------------------------------- content editing */

function contentStreams(document: PDFDocument, page: PDFPage): PDFRawStream[] {
  const contents = page.node.Contents()
  const streams: PDFRawStream[] = []
  const push = (candidate: unknown): void => {
    const resolved =
      candidate instanceof PDFRef ? document.context.lookup(candidate) : (candidate as PDFStream)
    if (resolved instanceof PDFRawStream) streams.push(resolved)
  }
  if (contents instanceof PDFArray) {
    for (let index = 0; index < contents.size(); index += 1) push(contents.get(index))
  } else if (contents) {
    push(contents)
  }
  return streams
}

function decodeStream(stream: PDFRawStream): string {
  try {
    return latin1Decode(decodePDFRawStream(stream).decode())
  } catch {
    return latin1Decode(stream.getContents())
  }
}

function replaceStream(document: PDFDocument, stream: PDFRawStream, source: string): void {
  const bytes = latin1Encode(source)
  stream.dict.delete(PDFName.of('Filter'))
  stream.dict.delete(PDFName.of('DecodeParms'))
  stream.dict.set(PDFName.of('Length'), document.context.obj(bytes.length))
  stream.updateContents(bytes)
}

/**
 * Deletes every drawing operator that touches one of the regions, from the
 * page's own content and from any form XObject it draws.
 */
function stripPageContent(document: PDFDocument, page: PDFPage, regions: Rect[]): number {
  const resources = page.node.Resources()
  let removed = 0

  // Page content streams are concatenated by the renderer, so a `q` in one may
  // be balanced by a `Q` in the next. Joining them into a single stream is both
  // what the spec says a renderer does and what makes the offsets meaningful.
  const streams = contentStreams(document, page)
  if (streams.length === 0) return 0

  const joined = streams.map(decodeStream).join('\n')
  const edited = editSource(document, joined, resources, regions, IDENTITY, 0, (count) => {
    removed += count
  })

  if (edited !== joined) {
    replaceStream(document, streams[0], edited)
    for (const extra of streams.slice(1)) replaceStream(document, extra, '')
  }
  return removed
}

const MAX_FORM_DEPTH = 6

function editSource(
  document: PDFDocument,
  source: string,
  resources: PDFDict | undefined,
  regions: Rect[],
  baseMatrix: Matrix,
  depth: number,
  count: (removed: number) => void
): string {
  const fonts = fontMetricsOf(document, resources)
  const xobjects = xobjectsOf(document, resources)
  const splices: Splice[] = []

  const runs = walkContentStream(source, {
    baseMatrix,
    fontFor: (name) => fonts.get(name),
    isImage: (name) => xobjects.get(name)?.kind === 'image',
    onForm: (name, ctm) => {
      if (depth >= MAX_FORM_DEPTH) return
      const entry = xobjects.get(name)
      if (!entry || entry.kind !== 'form' || !entry.stream) return
      editFormXObject(document, entry, resources, name, regions, ctm, depth, count)
    }
  })

  for (const run of runs) {
    if (!regions.some((region) => rectsIntersect(run.box, region, BLEED))) continue
    splices.push({ start: run.start, end: run.end, replacement: run.neutral })
  }

  count(splices.length)
  return splices.length > 0 ? spliceAll(source, splices) : source
}

interface XObjectEntry {
  kind: 'image' | 'form'
  ref: PDFRef | null
  stream: PDFRawStream | null
}

/**
 * Form XObjects can be shared between pages, so editing one in place would
 * silently redact a page the user never selected. Each form we touch is cloned
 * first and the page's resource entry repointed at the copy.
 */
function editFormXObject(
  document: PDFDocument,
  entry: XObjectEntry,
  resources: PDFDict | undefined,
  name: string,
  regions: Rect[],
  ctm: Matrix,
  depth: number,
  count: (removed: number) => void
): void {
  const stream = entry.stream
  if (!stream || !resources) return

  const matrixArray = stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)
  let base = ctm
  if (matrixArray && matrixArray.size() === 6) {
    const numbers = Array.from({ length: 6 }, (_, index) => {
      const value = matrixArray.lookupMaybe(index, PDFNumber)
      return value ? value.asNumber() : index === 0 || index === 3 ? 1 : 0
    })
    base = multiply(
      { a: numbers[0], b: numbers[1], c: numbers[2], d: numbers[3], e: numbers[4], f: numbers[5] },
      ctm
    )
  }

  const source = decodeStream(stream)
  const formResources = stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources
  const edited = editSource(document, source, formResources, regions, base, depth + 1, count)
  if (edited === source) return

  const clone = stream.clone(document.context)
  replaceStream(document, clone, edited)
  const ref = document.context.register(clone)
  const xobjectDict = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
  xobjectDict?.set(PDFName.of(name), ref)
}

function xobjectsOf(document: PDFDocument, resources: PDFDict | undefined): Map<string, XObjectEntry> {
  const entries = new Map<string, XObjectEntry>()
  const dict = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!dict) return entries

  for (const [key, value] of dict.entries()) {
    const name = key.asString().replace(/^\//, '')
    const ref = value instanceof PDFRef ? value : null
    const resolved = ref ? document.context.lookup(ref) : value
    if (!(resolved instanceof PDFRawStream)) {
      entries.set(name, { kind: 'image', ref, stream: null })
      continue
    }
    const subtype = resolved.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)
    const kind = subtype?.asString() === '/Form' ? 'form' : 'image'
    entries.set(name, { kind, ref, stream: resolved })
  }
  return entries
}

/* --------------------------------------------------------- font metrics */

function fontMetricsOf(document: PDFDocument, resources: PDFDict | undefined): Map<string, FontMetrics> {
  const fonts = new Map<string, FontMetrics>()
  const dict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict)
  if (!dict) return fonts

  for (const [key, value] of dict.entries()) {
    const name = key.asString().replace(/^\//, '')
    const font = value instanceof PDFRef ? document.context.lookup(value) : value
    if (!(font instanceof PDFDict)) continue
    const metrics = readFontMetrics(document, font)
    if (metrics) fonts.set(name, metrics)
  }
  return fonts
}

function readFontMetrics(document: PDFDocument, font: PDFDict): FontMetrics | null {
  const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString()

  if (subtype === '/Type0') {
    const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)
    const first = descendants?.size() ? descendants.lookupMaybe(0, PDFDict) : undefined
    const defaultWidth = first?.lookupMaybe(PDFName.of('DW'), PDFNumber)?.asNumber() ?? 1000
    const widths = readCidWidths(first?.lookupMaybe(PDFName.of('W'), PDFArray))
    // Identity-H/V and every embedded CMap this app is likely to meet use
    // two-byte codes; single-byte CMaps are rare enough that mis-sizing them
    // is caught by the verification pass.
    return {
      twoByte: true,
      widthOf: (code) => (widths.get(code) ?? defaultWidth) / 1000
    }
  }

  const firstChar = font.lookupMaybe(PDFName.of('FirstChar'), PDFNumber)?.asNumber() ?? 0
  const widthsArray = font.lookupMaybe(PDFName.of('Widths'), PDFArray)
  const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  const missing = descriptor?.lookupMaybe(PDFName.of('MissingWidth'), PDFNumber)?.asNumber() ?? 500

  if (!widthsArray || widthsArray.size() === 0) {
    // A base-14 font with no /Widths: the viewer supplies the metrics from its
    // own copy, which we do not have. 0.6 em over-estimates Helvetica's
    // average, and over-estimating is the safe direction.
    return { twoByte: false, widthOf: () => 0.6 }
  }

  const widths: number[] = []
  for (let index = 0; index < widthsArray.size(); index += 1) {
    const entry = widthsArray.lookupMaybe(index, PDFNumber)
    widths.push(entry ? entry.asNumber() : missing)
  }

  return {
    twoByte: false,
    widthOf: (code) => {
      const width = widths[code - firstChar]
      return (width === undefined || Number.isNaN(width) ? missing : width) / 1000
    }
  }
}

/** Reads the CID /W array, whose two forms are `c [w…]` and `cFirst cLast w`. */
function readCidWidths(array: PDFArray | undefined): Map<number, number> {
  const widths = new Map<number, number>()
  if (!array) return widths

  let index = 0
  while (index < array.size()) {
    const first = array.lookupMaybe(index, PDFNumber)
    if (!first) break
    const next = array.lookup(index + 1)
    if (next instanceof PDFArray) {
      const start = first.asNumber()
      for (let position = 0; position < next.size(); position += 1) {
        const width = next.lookupMaybe(position, PDFNumber)
        if (width) widths.set(start + position, width.asNumber())
      }
      index += 2
      continue
    }
    const last = array.lookupMaybe(index + 1, PDFNumber)
    const width = array.lookupMaybe(index + 2, PDFNumber)
    if (!last || !width) break
    const from = first.asNumber()
    const to = Math.min(last.asNumber(), from + 65535)
    for (let code = from; code <= to; code += 1) widths.set(code, width.asNumber())
    index += 3
  }
  return widths
}

/* -------------------------------------------------------- annotations */

/**
 * Annotations carry their own copies of text — a comment's /Contents, a form
 * field's /V, a link's target — none of which live in the content stream and
 * none of which a black rectangle touches.
 */
function stripAnnotations(page: PDFPage, regions: Rect[]): number {
  const annotations = page.node.Annots()
  if (!(annotations instanceof PDFArray)) return 0

  const keep: unknown[] = []
  let removed = 0

  for (let index = 0; index < annotations.size(); index += 1) {
    const entry = annotations.get(index)
    const dict = annotations.lookupMaybe(index, PDFDict)
    const rectArray = dict?.lookupMaybe(PDFName.of('Rect'), PDFArray)
    if (!dict || !rectArray || rectArray.size() < 4) {
      keep.push(entry)
      continue
    }
    const numbers = Array.from({ length: 4 }, (_, position) => {
      const value = rectArray.lookupMaybe(position, PDFNumber)
      return value ? value.asNumber() : 0
    })
    const rect: Rect = {
      x: Math.min(numbers[0], numbers[2]),
      y: Math.min(numbers[1], numbers[3]),
      width: Math.abs(numbers[2] - numbers[0]),
      height: Math.abs(numbers[3] - numbers[1])
    }
    if (regions.some((region) => rectsIntersect(rect, region, BLEED))) {
      removed += 1
      continue
    }
    keep.push(entry)
  }

  if (removed > 0) {
    while (annotations.size() > 0) annotations.remove(annotations.size() - 1)
    for (const entry of keep) annotations.push(entry as never)
  }
  return removed
}

/* ------------------------------------------------------- verification */

/**
 * Re-reads the saved file and asks whether any text still lands inside a
 * region. This is the check that turns "we deleted some operators" into a
 * claim we can stand behind.
 */
async function findSurvivingText(
  bytes: PdfBytes,
  byPage: Map<number, RedactRegion[]>,
  password?: string
): Promise<number[]> {
  const surviving: number[] = []
  let document
  try {
    document = await openForRender(bytes, password)
  } catch {
    // If we cannot verify, we cannot promise — treat every touched page as
    // unproven and let the raster fallback settle it.
    return [...byPage.keys()]
  }

  try {
    for (const [pageIndex, regions] of byPage) {
      const pageNumber = pageIndex + 1
      if (pageNumber > document.numPages) continue
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()

      const boxes = regions.map((region) => ({
        x: region.x * viewport.width,
        y: region.y * viewport.height,
        width: region.width * viewport.width,
        height: region.height * viewport.height
      }))

      let leaked = false
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue
        // pdf.js reports an item's transform in unrotated page space, so the
        // viewport does the conversion — a hand-rolled flip is only correct
        // for /Rotate 0 and would quietly stop verifying rotated pages.
        const [, , , , tx, ty] = item.transform as number[]
        const height = Math.max(item.height, 1)
        const corners = viewport.convertToViewportRectangle([
          tx,
          ty - height * 0.2,
          tx + Math.max(item.width, 1),
          ty + height * 0.8
        ]) as number[]
        const itemBox = {
          x: Math.min(corners[0], corners[2]),
          y: Math.min(corners[1], corners[3]),
          width: Math.abs(corners[2] - corners[0]),
          height: Math.abs(corners[3] - corners[1])
        }
        if (boxes.some((box) => rectsIntersect(itemBox, box))) {
          leaked = true
          break
        }
      }
      page.cleanup()
      if (leaked) surviving.push(pageIndex)
    }
  } finally {
    await document.destroy().catch(() => undefined)
  }

  return surviving
}

/**
 * The guaranteed fallback: replace a page with a picture of itself. Nothing
 * survives that a text extractor can reach, at the cost of selectable text on
 * that page — which is the right trade when the alternative is a false promise.
 */
async function rasterizePages(
  bytes: PdfBytes,
  pageIndexes: number[],
  byPage: Map<number, RedactRegion[]>,
  password?: string
): Promise<PdfBytes> {
  const source = await openForRender(bytes, password)
  const document = await load(bytes, password)
  const pages = document.getPages()

  try {
    for (const pageIndex of pageIndexes) {
      const page = pages[pageIndex]
      if (!page) continue
      const { bytes: png } = await renderPageToBytes(source, pageIndex + 1, 200 / 72, 'image/png')
      const image = await document.embedPng(png)
      const { width, height } = displayTransform(page)

      // Drop the page's own instructions entirely, then draw the picture.
      page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream('')))
      page.node.delete(PDFName.of('Annots'))
      page.setRotation({ type: 'degrees', angle: 0 } as never)
      page.setMediaBox(0, 0, width, height)
      page.setCropBox(0, 0, width, height)
      page.drawImage(image, { x: 0, y: 0, width, height })

      for (const region of byPage.get(pageIndex) ?? []) {
        page.drawRectangle({
          x: region.x * width,
          y: height - (region.y + region.height) * height,
          width: region.width * width,
          height: region.height * height,
          color: rgb(0, 0, 0)
        })
      }
    }
  } finally {
    await source.destroy().catch(() => undefined)
  }

  return save(document)
}
