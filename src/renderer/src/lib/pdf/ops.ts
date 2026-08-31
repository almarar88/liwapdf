import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFInvalidObject,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  PDFFont,
  type PDFImage
} from '@cantoo/pdf-lib'
import { hexToRgb, PAGE_PRESETS, MM_TO_PT, stripExtension } from '../format'
import {
  drawSmartText,
  isRtlText,
  measureSmartText,
  prepareFonts,
  toArabicIndicDigits,
  type FontSet
} from './typography'

export type PdfBytes = Uint8Array

export interface NamedBytes {
  name: string
  bytes: PdfBytes
}

export class PdfPasswordError extends Error {
  constructor() {
    super('pdf-password-required')
    this.name = 'PdfPasswordError'
  }
}

/* -------------------------------------------------------------- loading */

/**
 * Removes what is left of a document's encryption after pdf-lib has decrypted
 * it, so the file it writes can actually be opened again.
 *
 * Deleting `trailerInfo.Encrypt` is not enough — pdf-lib has already cleared
 * that by the time `load` returns. What survives is the standard security
 * handler dictionary and the carcass of the original cross-reference stream,
 * which the writer emits verbatim because its skip rule only recognises an
 * xref that parsed as a raw stream. Reload the result and the parser merges
 * that carcass back into the trailer, resurrects /Encrypt, resolves it to the
 * still-present handler, and tries to AES-decrypt plaintext: "Password
 * incorrect" on a file the app itself just wrote.
 *
 * Only ever run on the decrypt path, so a `/Filter /Standard` entry in an
 * unencrypted file can never be mistaken for a security handler.
 */
function stripSecurityRemnants(document: PDFDocument): void {
  const context = document.context
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    let drop = false
    if (object instanceof PDFInvalidObject) {
      const bytes = new Uint8Array(object.sizeInBytes())
      object.copyBytesInto(bytes, 0)
      drop = latin1(bytes).includes('/XRef')
    } else if (object instanceof PDFRawStream) {
      drop = object.dict.get(PDFName.of('Type'))?.toString() === '/XRef'
    } else if (object instanceof PDFDict) {
      drop = object.get(PDFName.of('Filter'))?.toString() === '/Standard'
    }
    if (drop) context.delete(ref)
  }
  const trailer = context.trailerInfo as { Encrypt?: unknown }
  delete trailer.Encrypt
}

function latin1(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index])
  return text
}

export async function load(bytes: PdfBytes, password?: string): Promise<PDFDocument> {
  try {
    const document = await PDFDocument.load(bytes.slice(), {
      password,
      // Only bypass the encryption check when a password was actually given.
      // Otherwise an encrypted file must raise, not load as ciphertext.
      ignoreEncryption: password !== undefined,
      updateMetadata: false
    })

    if (password !== undefined) stripSecurityRemnants(document)

    return document
  } catch (error) {
    const message = String((error as Error)?.message ?? '')
    if (/password|encrypt/i.test(message)) throw new PdfPasswordError()
    throw error
  }
}

export async function save(document: PDFDocument): Promise<PdfBytes> {
  return document.save({ useObjectStreams: true })
}

export async function create(): Promise<PDFDocument> {
  return PDFDocument.create()
}

/**
 * Runs a mutation over a document and returns the fresh bytes.
 *
 * Editing a protected file necessarily decrypts it: pdf-lib cannot mutate
 * ciphertext in place. The output is therefore unprotected, which callers must
 * surface rather than silently writing over the user's confidential original.
 */
export async function edit(
  bytes: PdfBytes,
  password: string | undefined,
  mutate: (document: PDFDocument) => Promise<void> | void
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  await mutate(document)
  return save(document)
}

/**
 * True when this document came off disk encrypted.
 *
 * Determined by trying to open it *without* a password: pdf-lib clears both
 * `trailerInfo.Encrypt` and `isEncrypted` before a successful decrypt returns,
 * so inspecting a decrypted document tells you nothing.
 */
export async function isProtected(bytes: PdfBytes): Promise<boolean> {
  try {
    await PDFDocument.load(bytes.slice(), { ignoreEncryption: false, updateMetadata: false })
    return false
  } catch {
    return true
  }
}

/* ---------------------------------------------------------- page layout */

/**
 * Re-hangs a document's existing page leaves off its page tree in a new order.
 *
 * Reordering, extracting, deleting, duplicating and reversing are all the same
 * operation: choose which page objects the tree points at, and in what order.
 * Doing it this way keeps the document's own catalog — its bookmarks, form,
 * attachments, page labels and structure tree all survive.
 *
 * The obvious alternative, copying pages into a blank document, throws every
 * one of those away: pdf-lib's copier clones a page and what it references and
 * never visits the catalog. Two of this app's own tools *create* bookmarks and
 * attachments, so a drag-reorder in Organize was quietly undoing them.
 */
function rehangPages(document: PDFDocument, order: number[]): void {
  const refs = document.getPages().map((page) => page.ref)
  if (order.some((index) => index < 0 || index >= refs.length)) {
    throw new Error('invalid-page-order')
  }

  const kept = new Set<string>()
  const resolved: PDFRef[] = []
  for (const index of order) {
    const ref = refs[index]
    if (!kept.has(ref.tag)) {
      kept.add(ref.tag)
      resolved.push(ref)
      continue
    }
    // A page listed twice must become two objects: a page dictionary carries
    // its own /Parent, so one object cannot hang in the tree twice.
    const original = document.context.lookup(ref, PDFDict)
    resolved.push(document.context.register(original.clone(document.context)))
  }

  for (let index = refs.length - 1; index >= 0; index -= 1) {
    document.catalog.removeLeafNode(index)
  }
  resolved.forEach((ref, position) => document.catalog.insertLeafNode(ref, position))
  for (const ref of refs) if (!kept.has(ref.tag)) document.context.delete(ref)

  // pdf-lib caches the page count and the flattened page list.
  const internals = document as unknown as {
    pageCount: number
    pageCache: { invalidate(): void }
  }
  internals.pageCount = resolved.length
  internals.pageCache.invalidate()
}

export async function reorderPages(
  bytes: PdfBytes,
  order: number[],
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  rehangPages(document, order)
  return save(document)
}

export async function extractPages(
  bytes: PdfBytes,
  indices: number[],
  password?: string
): Promise<PdfBytes> {
  if (indices.length === 0) throw new Error('no-pages-selected')
  return reorderPages(bytes, indices, password)
}

export async function deletePages(
  bytes: PdfBytes,
  indices: number[],
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const remaining = document.getPageIndices().filter((index) => !indices.includes(index))
  if (remaining.length === 0) throw new Error('cannot-delete-all-pages')
  rehangPages(document, remaining)
  return save(document)
}

export async function duplicatePages(
  bytes: PdfBytes,
  indices: number[],
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const order: number[] = []
  for (const index of document.getPageIndices()) {
    order.push(index)
    if (indices.includes(index)) order.push(index)
  }
  rehangPages(document, order)
  return save(document)
}

export async function rotatePages(
  bytes: PdfBytes,
  indices: number[],
  delta: number,
  password?: string
): Promise<PdfBytes> {
  return edit(bytes, password, (document) => {
    const pages = document.getPages()
    for (const index of indices) {
      const page = pages[index]
      if (!page) continue
      const next = (((page.getRotation().angle + delta) % 360) + 360) % 360
      page.setRotation(degrees(next))
    }
  })
}

export async function insertBlankPage(
  bytes: PdfBytes,
  atIndex: number,
  size: [number, number] | null,
  password?: string
): Promise<PdfBytes> {
  return edit(bytes, password, (document) => {
    const reference = document.getPages()[Math.max(0, Math.min(atIndex, document.getPageCount() - 1))]
    const dimensions: [number, number] = size ?? [
      reference?.getWidth() ?? PAGE_PRESETS.A4[0],
      reference?.getHeight() ?? PAGE_PRESETS.A4[1]
    ]
    document.insertPage(atIndex, dimensions)
  })
}

export async function insertDocument(
  bytes: PdfBytes,
  insertBytes: PdfBytes,
  atIndex: number,
  password?: string
): Promise<PdfBytes> {
  const target = await load(bytes, password)
  const source = await load(insertBytes)
  const copied = await target.copyPages(source, source.getPageIndices())
  copied.forEach((page, offset) => target.insertPage(atIndex + offset, page))
  return save(target)
}

export async function mergeDocuments(files: NamedBytes[]): Promise<PdfBytes> {
  const target = await PDFDocument.create()
  for (const file of files) {
    const source = await load(file.bytes)
    const copied = await target.copyPages(source, source.getPageIndices())
    for (const page of copied) target.addPage(page)
  }
  target.setProducer('Alcode Editor')
  target.setCreator('Alcode Editor')
  return save(target)
}

export type SplitMode = 'ranges' | 'count' | 'each'

export async function splitDocument(
  bytes: PdfBytes,
  baseName: string,
  mode: SplitMode,
  options: { ranges?: number[][]; every?: number },
  password?: string
): Promise<NamedBytes[]> {
  const document = await load(bytes, password)
  const total = document.getPageCount()
  const base = stripExtension(baseName)

  let groups: number[][] = []
  if (mode === 'each') {
    groups = Array.from({ length: total }, (_, index) => [index])
  } else if (mode === 'count') {
    const size = Math.max(1, options.every ?? 1)
    for (let start = 0; start < total; start += size) {
      groups.push(
        Array.from({ length: Math.min(size, total - start) }, (_, offset) => start + offset)
      )
    }
  } else {
    groups = (options.ranges ?? []).filter((group) => group.length > 0)
  }

  const output: NamedBytes[] = []
  for (const [index, group] of groups.entries()) {
    const part = await reorderPages(bytes, group, password)
    const label = group.length === 1 ? `${group[0] + 1}` : `${group[0] + 1}-${group[group.length - 1] + 1}`
    output.push({ name: `${base}-${String(index + 1).padStart(2, '0')}-p${label}.pdf`, bytes: part })
  }
  return output
}

/**
 * Splits a document into parts that each fit inside a byte budget.
 *
 * The obvious loop — "add a page, save the whole thing, check the size" —
 * re-parses and re-serialises the entire source once per page, which is
 * 45,150 page copies on a 300-page file where 300 would do. Instead each page
 * is priced once on its own, the parts are packed from those prices, and only
 * the finished parts are serialised. Sharing (a font used by every page) makes
 * the per-page price an over-estimate, so a packed part can only come out
 * smaller than predicted; the one case that needs correcting is a part that
 * still overshoots, which is walked back a page at a time.
 */
export async function splitBySize(
  bytes: PdfBytes,
  baseName: string,
  maxBytes: number,
  password?: string,
  onProgress?: (fraction: number) => void
): Promise<NamedBytes[]> {
  const source = await load(bytes, password)
  const total = source.getPageCount()
  const base = stripExtension(baseName)
  if (total === 0) return []

  const prices: number[] = []
  for (let index = 0; index < total; index += 1) {
    const probe = await PDFDocument.create()
    const [page] = await probe.copyPages(source, [index])
    probe.addPage(page)
    prices.push((await probe.save({ useObjectStreams: true })).byteLength)
    onProgress?.((index / total) * 0.5)
  }

  const groups: number[][] = []
  let current: number[] = []
  let running = 0
  for (let index = 0; index < total; index += 1) {
    if (current.length > 0 && running + prices[index] > maxBytes) {
      groups.push(current)
      current = []
      running = 0
    }
    current.push(index)
    running += prices[index]
  }
  if (current.length > 0) groups.push(current)

  const parts: NamedBytes[] = []
  const queue = [...groups]
  let rendered = 0
  while (queue.length > 0) {
    const group = queue.shift()!
    const output = await PDFDocument.create()
    const copied = await output.copyPages(source, group)
    for (const page of copied) output.addPage(page)
    await carryMetadata(source, output)
    const saved = await save(output)

    // Over budget with room to shed: put the tail back and try again.
    if (saved.byteLength > maxBytes && group.length > 1) {
      const keep = Math.max(1, Math.floor(group.length * (maxBytes / saved.byteLength)))
      queue.unshift(group.slice(0, keep), group.slice(keep))
      continue
    }
    parts.push({ name: `${base}-part${parts.length + 1}.pdf`, bytes: saved })
    rendered += 1
    onProgress?.(0.5 + Math.min(1, rendered / Math.max(groups.length, 1)) * 0.5)
  }
  return parts
}

export async function reversePages(bytes: PdfBytes, password?: string): Promise<PdfBytes> {
  const document = await load(bytes, password)
  rehangPages(document, document.getPageIndices().reverse())
  return save(document)
}

/* -------------------------------------------------------- page geometry */

/**
 * Where and how to stamp a source page inside a target rectangle so it comes
 * out the way a reader saw it.
 *
 * Embedding a page copies its content stream, which is stored *unrotated*: a
 * scanner's landscape page carries /Rotate 90 and portrait content. Ignoring
 * that turns every scan sideways, so the placement re-applies the rotation and
 * measures the fit against the displayed dimensions.
 */
interface Placement {
  x: number
  y: number
  width: number
  height: number
  rotate: number
  /** Maps source user space to target page space, for annotation rectangles. */
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number }
}

function placePage(
  page: PDFPage,
  embedded: { width: number; height: number },
  cell: { x: number; y: number; width: number; height: number }
): Placement {
  const box = page.getCropBox?.() ?? page.getMediaBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const swapped = rotation === 90 || rotation === 270

  const displayWidth = swapped ? embedded.height : embedded.width
  const displayHeight = swapped ? embedded.width : embedded.height
  const scale = Math.min(cell.width / displayWidth, cell.height / displayHeight)
  const contentWidth = embedded.width * scale
  const contentHeight = embedded.height * scale
  const outWidth = displayWidth * scale
  const outHeight = displayHeight * scale
  const px = cell.x + (cell.width - outWidth) / 2
  const py = cell.y + (cell.height - outHeight) / 2

  let x = px
  let y = py
  let rotate = 0
  let a = 1
  let b = 0
  let c = 0
  let d = 1
  if (rotation === 90) {
    x = px
    y = py + contentWidth
    rotate = -90
    a = 0
    b = -1
    c = 1
    d = 0
  } else if (rotation === 180) {
    x = px + contentWidth
    y = py + contentHeight
    rotate = 180
    a = -1
    b = 0
    c = 0
    d = -1
  } else if (rotation === 270) {
    x = px + contentHeight
    y = py
    rotate = 90
    a = 0
    b = 1
    c = -1
    d = 0
  }

  // Source user space -> normalized content space -> rotated -> placed.
  const s = scale
  return {
    x,
    y,
    width: contentWidth,
    height: contentHeight,
    rotate,
    matrix: {
      a: s * a,
      b: s * b,
      c: s * c,
      d: s * d,
      e: x - box.x * s * a - box.y * s * c,
      f: y - box.x * s * b - box.y * s * d
    }
  }
}

function boundingBoxOf(page: PDFPage): { left: number; bottom: number; right: number; top: number } {
  const box = page.getCropBox?.() ?? page.getMediaBox()
  return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }
}

/**
 * Carries a page's annotations onto its resized copy, rectangles transformed
 * to match. Without this, resizing silently drops every link, comment and
 * highlight in the document.
 *
 * Widgets are left behind on purpose: a form field without the AcroForm
 * plumbing that owns it is worse than no field at all.
 */
function transferAnnotations(
  source: PDFDocument,
  output: PDFDocument,
  from: PDFPage,
  to: PDFPage,
  placement: Placement
): void {
  const annots = from.node.Annots()
  if (!(annots instanceof PDFArray) || annots.size() === 0) return

  const copier = PDFObjectCopier.for(source.context, output.context)
  const carried: PDFRef[] = []

  for (let index = 0; index < annots.size(); index += 1) {
    const dict = annots.lookupMaybe(index, PDFDict)
    const rect = dict?.lookupMaybe(PDFName.of('Rect'), PDFArray)
    if (!dict || !rect || rect.size() < 4) continue
    if (dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() === '/Widget') continue

    const numbers = Array.from({ length: 4 }, (_, position) => {
      const value = rect.lookupMaybe(position, PDFNumber)
      return value ? value.asNumber() : 0
    })
    const m = placement.matrix
    const corners = [
      [numbers[0], numbers[1]],
      [numbers[2], numbers[1]],
      [numbers[2], numbers[3]],
      [numbers[0], numbers[3]]
    ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f])
    const xs = corners.map((point) => point[0])
    const ys = corners.map((point) => point[1])

    let copied: PDFDict
    try {
      copied = copier.copy(dict) as PDFDict
    } catch {
      continue
    }
    copied.set(
      PDFName.of('Rect'),
      output.context.obj([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
    )
    copied.delete(PDFName.of('P'))
    carried.push(output.context.register(copied))
  }

  if (carried.length > 0) to.node.set(PDFName.of('Annots'), output.context.obj(carried))
}

export async function resizePages(
  bytes: PdfBytes,
  target: [number, number],
  password?: string
): Promise<PdfBytes> {
  const source = await load(bytes, password)
  const output = await PDFDocument.create()
  const pages = source.getPages()

  for (const sourcePage of pages) {
    const embedded = await output.embedPage(sourcePage, boundingBoxOf(sourcePage))
    const page = output.addPage(target)
    const placement = placePage(sourcePage, embedded, {
      x: 0,
      y: 0,
      width: target[0],
      height: target[1]
    })
    page.drawPage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: degrees(placement.rotate)
    })
    transferAnnotations(source, output, sourcePage, page, placement)
  }
  await carryMetadata(source, output)
  return save(output)
}

export interface CropPercents {
  top: number
  bottom: number
  start: number
  end: number
}

export async function cropPages(
  bytes: PdfBytes,
  percents: CropPercents,
  indices: number[],
  password?: string
): Promise<PdfBytes> {
  return edit(bytes, password, (document) => {
    const pages = document.getPages()
    for (const index of indices) {
      const page = pages[index]
      if (!page) continue
      // Crop percentages are what the user saw, so they are measured against
      // the visible box and then rotated back into the page's own axes.
      const box = page.getCropBox?.() ?? page.getMediaBox()
      const rotation = ((page.getRotation().angle % 360) + 360) % 360
      const trim = [
        (percents.start ?? 0) / 100,
        (percents.top ?? 0) / 100,
        (percents.end ?? 0) / 100,
        (percents.bottom ?? 0) / 100
      ]
      // Rotate the [left, top, right, bottom] fractions by the display angle.
      const shift = rotation / 90
      const [left, top, right, bottom] = [
        trim[(0 + shift) % 4],
        trim[(1 + shift) % 4],
        trim[(2 + shift) % 4],
        trim[(3 + shift) % 4]
      ]
      const width = Math.max(20, box.width * (1 - left - right))
      const height = Math.max(20, box.height * (1 - top - bottom))
      page.setCropBox(box.x + box.width * left, box.y + box.height * bottom, width, height)
      page.setMediaBox(box.x + box.width * left, box.y + box.height * bottom, width, height)
    }
  })
}

export async function nUpPages(
  bytes: PdfBytes,
  perSheet: 2 | 4 | 6 | 9,
  sheetSize: [number, number],
  password?: string
): Promise<PdfBytes> {
  const source = await load(bytes, password)
  const output = await PDFDocument.create()
  const pages = source.getPages()

  const layout: Record<number, [number, number]> = {
    2: [1, 2],
    4: [2, 2],
    6: [2, 3],
    9: [3, 3]
  }
  const [columns, rows] = layout[perSheet]
  const gap = 8

  for (let start = 0; start < pages.length; start += perSheet) {
    const sheet = output.addPage(sheetSize)
    const cellWidth = (sheetSize[0] - gap * (columns + 1)) / columns
    const cellHeight = (sheetSize[1] - gap * (rows + 1)) / rows

    for (let slot = 0; slot < perSheet && start + slot < pages.length; slot += 1) {
      const sourcePage = pages[start + slot]
      const embedded = await output.embedPage(sourcePage, boundingBoxOf(sourcePage))
      const column = slot % columns
      const row = Math.floor(slot / columns)
      const placement = placePage(sourcePage, embedded, {
        x: gap + column * (cellWidth + gap),
        y: sheetSize[1] - gap - (row + 1) * cellHeight - row * gap,
        width: cellWidth,
        height: cellHeight
      })
      sheet.drawPage(embedded, {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotate: degrees(placement.rotate)
      })
    }
  }
  await carryMetadata(source, output)
  return save(output)
}

/* ------------------------------------------------------------- overlays */

export type Anchor =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'middleLeft'
  | 'center'
  | 'middleRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'

/**
 * The page area a reader actually sees: the MediaBox offset by its own origin
 * and, when /Rotate is 90 or 270, with its width and height swapped. Overlays
 * computed against getWidth()/getHeight() alone land off a rotated or offset
 * page, which is what every scanner produces.
 */
export interface VisibleBox {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export function visibleBox(page: PDFPage): VisibleBox {
  const box = page.getCropBox?.() ?? page.getMediaBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const swapped = rotation === 90 || rotation === 270
  return {
    x: box.x,
    y: box.y,
    width: swapped ? box.height : box.width,
    height: swapped ? box.width : box.height,
    rotation
  }
}

/**
 * Places a label of the given size inside the visible box, then maps the point
 * back into unrotated page space so pdf-lib draws it where the reader sees it.
 */
function anchorPosition(
  anchor: Anchor,
  box: VisibleBox,
  width: number,
  height: number,
  margin: number
): { x: number; y: number; rotate: number } {
  const horizontal: Record<string, number> = {
    Left: margin,
    Center: (box.width - width) / 2,
    Right: box.width - width - margin
  }
  const vertical: Record<string, number> = {
    top: box.height - height - margin,
    middle: (box.height - height) / 2,
    bottom: margin
  }
  const verticalKey = anchor.startsWith('top') ? 'top' : anchor.startsWith('bottom') ? 'bottom' : 'middle'
  const horizontalKey = anchor.endsWith('Left')
    ? 'Left'
    : anchor.endsWith('Right')
      ? 'Right'
      : 'Center'

  const vx = horizontal[horizontalKey]
  const vy = vertical[verticalKey]

  // Undo the page rotation: a point (vx, vy) in reader space maps to these
  // coordinates in the page's own space, and the label must be counter-rotated
  // by the same angle to read upright.
  switch (box.rotation) {
    case 90:
      return { x: box.x + vy, y: box.y + box.width - vx - width, rotate: -90 }
    case 180:
      return { x: box.x + box.width - vx - width, y: box.y + box.height - vy - height, rotate: 180 }
    case 270:
      return { x: box.x + box.height - vy - height, y: box.y + vx, rotate: 90 }
    default:
      return { x: box.x + vx, y: box.y + vy, rotate: 0 }
  }
}

interface DrawTextArgs {
  page: PDFPage
  text: string
  fontSize: number
  color: string
  opacity: number
  anchor: Anchor
  margin: number
  rotate?: number
  bold?: boolean
  /** Base direction; inferred from the text when omitted. */
  rtl?: boolean
  cache: OverlayCache
}

export interface OverlayCache {
  fonts: FontSet
  images: Map<string, PDFImage>
}

export async function newOverlayCache(document: PDFDocument): Promise<OverlayCache> {
  return { fonts: await prepareFonts(document), images: new Map() }
}

/**
 * Draws a label on a page as real, selectable, searchable vector text — in any
 * script. Arabic used to be rasterized to a PNG here; it is now shaped through
 * an embedded font subset with proper bidirectional run ordering.
 *
 * The label is anchored inside the page's *visible* box and counter-rotated so
 * it reads upright on a rotated page. Rotation pivots about the label's centre,
 * so an anchored + rotated watermark stays where the anchor put it.
 */
async function drawLabel(args: DrawTextArgs): Promise<void> {
  const { page, text, fontSize, color, opacity, anchor, margin, rotate = 0 } = args
  if (!text.trim()) return

  const box = visibleBox(page)
  const rtl = args.rtl ?? isRtlText(text)
  const measured = await measureSmartText(args.cache.fonts, text, {
    size: fontSize,
    color,
    bold: args.bold,
    rtl
  })

  // A rotated label occupies a larger axis-aligned box; anchor against that so
  // it cannot overhang the page edge.
  const radians = (rotate * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const boxWidth = measured.width * cos + measured.height * sin
  const boxHeight = measured.width * sin + measured.height * cos

  const placed = anchorPosition(anchor, box, boxWidth, boxHeight, margin)
  const totalRotation = rotate + placed.rotate

  // Rotate about the centre rather than the bottom-left corner pdf-lib uses.
  const centreX = placed.x + boxWidth / 2
  const centreY = placed.y + boxHeight / 2
  const total = (totalRotation * Math.PI) / 180
  const originX = centreX - (measured.width / 2) * Math.cos(total) + (measured.height / 2) * Math.sin(total)
  const originY = centreY - (measured.width / 2) * Math.sin(total) - (measured.height / 2) * Math.cos(total)

  await drawSmartText(page, args.cache.fonts, text, originX, originY, {
    size: fontSize,
    color,
    opacity,
    bold: args.bold,
    rotate: totalRotation,
    rtl
  })
}

export interface WatermarkOptions {
  text?: string
  imageBytes?: Uint8Array
  imageType?: 'png' | 'jpg'
  fontSize: number
  color: string
  opacity: number
  rotation: number
  anchor: Anchor
  margin: number
  scale: number
  tile: boolean
  bold: boolean
  indices: number[]
}

export async function addWatermark(
  bytes: PdfBytes,
  options: WatermarkOptions,
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  const cache = await newOverlayCache(document)

  let image: PDFImage | undefined
  if (options.imageBytes) {
    image =
      options.imageType === 'jpg'
        ? await document.embedJpg(options.imageBytes)
        : await document.embedPng(options.imageBytes)
  }

  for (const index of options.indices) {
    const page = pages[index]
    if (!page) continue
    const width = page.getWidth()
    const height = page.getHeight()

    if (image) {
      const scaled = image.scale((options.scale / 100) * (width / image.width))
      if (options.tile) {
        for (let x = 0; x < width; x += scaled.width + 40) {
          for (let y = 0; y < height; y += scaled.height + 40) {
            page.drawImage(image, {
              x,
              y,
              width: scaled.width,
              height: scaled.height,
              opacity: options.opacity,
              rotate: degrees(options.rotation)
            })
          }
        }
      } else {
        const placed = anchorPosition(
          options.anchor,
          visibleBox(page),
          scaled.width,
          scaled.height,
          options.margin
        )
        page.drawImage(image, {
          x: placed.x,
          y: placed.y,
          width: scaled.width,
          height: scaled.height,
          opacity: options.opacity,
          rotate: degrees(options.rotation + placed.rotate)
        })
      }
      continue
    }

    if (!options.text) continue

    if (options.tile) {
      const step = Math.max(120, options.fontSize * 7)
      for (let x = 0; x < width; x += step) {
        for (let y = 0; y < height; y += step) {
          await drawTileText(page, options, x, y, cache)
        }
      }
    } else {
      await drawLabel({
        page,
        text: options.text,
        fontSize: options.fontSize,
        color: options.color,
        opacity: options.opacity,
        anchor: options.anchor,
        margin: options.margin,
        rotate: options.rotation,
        bold: options.bold,
        cache
      })
    }
  }
  return save(document)
}

async function drawTileText(
  page: PDFPage,
  options: WatermarkOptions,
  x: number,
  y: number,
  cache: OverlayCache
): Promise<void> {
  const text = options.text!
  await drawSmartText(page, cache.fonts, text, x, y, {
    size: options.fontSize,
    color: options.color,
    opacity: options.opacity,
    bold: options.bold,
    rotate: options.rotation
  })
}

export type NumberFormat = 'n' | 'n-of-total' | 'page-n' | 'page-n-of-total' | 'dash-n-dash'

export interface PageNumberOptions {
  format: NumberFormat
  startAt: number
  anchor: Anchor
  margin: number
  fontSize: number
  color: string
  bold: boolean
  skipFirst: boolean
  indices: number[]
  /** Digit glyphs to use — independent of the template language. */
  numerals: 'western' | 'arabic-indic'
  /** Language of the words around the number, e.g. "Page" vs "صفحة". */
  templateLanguage: 'ar' | 'en'
}

const NUMBER_TEMPLATES: Record<'ar' | 'en', Record<NumberFormat, string>> = {
  ar: {
    n: '{n}',
    'n-of-total': '{n} / {total}',
    'page-n': 'صفحة {n}',
    'page-n-of-total': 'صفحة {n} من {total}',
    'dash-n-dash': '- {n} -'
  },
  en: {
    n: '{n}',
    'n-of-total': '{n} / {total}',
    'page-n': 'Page {n}',
    'page-n-of-total': 'Page {n} of {total}',
    'dash-n-dash': '- {n} -'
  }
}

export async function addPageNumbers(
  bytes: PdfBytes,
  options: PageNumberOptions,
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  const cache = await newOverlayCache(document)
  const total = options.indices.length
  const localize = (value: number): string =>
    options.numerals === 'arabic-indic' ? toArabicIndicDigits(value) : String(value)

  let counter = options.startAt
  for (const [position, index] of options.indices.entries()) {
    const page = pages[index]
    if (!page) continue
    if (options.skipFirst && position === 0) {
      counter += 1
      continue
    }

    const label = NUMBER_TEMPLATES[options.templateLanguage][options.format]
      .replace('{n}', localize(counter))
      .replace('{total}', localize(total + options.startAt - 1))

    await drawLabel({
      page,
      text: label,
      fontSize: options.fontSize,
      color: options.color,
      opacity: 1,
      anchor: options.anchor,
      margin: options.margin,
      bold: options.bold,
      rtl: options.templateLanguage === 'ar',
      cache
    })
    counter += 1
  }
  return save(document)
}

export interface HeaderFooterOptions {
  header: string
  footer: string
  fontSize: number
  color: string
  margin: number
  /** Logical alignment: "start" is the right edge for right-to-left text. */
  align: 'start' | 'center' | 'end'
  indices: number[]
}

export async function addHeaderFooter(
  bytes: PdfBytes,
  options: HeaderFooterOptions,
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  const cache = await newOverlayCache(document)

  // "start" and "end" are logical: they must resolve against the direction of
  // the text being placed, not against the physical page edges.
  const anchorFor = (band: 'top' | 'bottom', text: string): Anchor => {
    if (options.align === 'center') return `${band}Center` as Anchor
    const rtl = isRtlText(text)
    const atStart = options.align === 'start'
    const physical = atStart === rtl ? 'Right' : 'Left'
    return `${band}${physical}` as Anchor
  }

  for (const index of options.indices) {
    const page = pages[index]
    if (!page) continue
    if (options.header.trim()) {
      await drawLabel({
        page,
        text: options.header,
        fontSize: options.fontSize,
        color: options.color,
        opacity: 1,
        anchor: anchorFor('top', options.header),
        margin: options.margin,
        cache
      })
    }
    if (options.footer.trim()) {
      await drawLabel({
        page,
        text: options.footer,
        fontSize: options.fontSize,
        color: options.color,
        opacity: 1,
        anchor: anchorFor('bottom', options.footer),
        margin: options.margin,
        cache
      })
    }
  }
  return save(document)
}

export interface BackgroundOptions {
  color?: string
  imageBytes?: Uint8Array
  imageType?: 'png' | 'jpg'
  opacity: number
  indices: number[]
}

export async function addBackground(
  bytes: PdfBytes,
  options: BackgroundOptions,
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  let image: PDFImage | undefined
  if (options.imageBytes) {
    image =
      options.imageType === 'jpg'
        ? await document.embedJpg(options.imageBytes)
        : await document.embedPng(options.imageBytes)
  }

  for (const index of options.indices) {
    const page = pages[index]
    if (!page) continue
    const box = page.getCropBox?.() ?? page.getMediaBox()

    drawBehind(document, page, () => {
      if (options.color) {
        const { r, g, b } = hexToRgb(options.color)
        page.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          color: rgb(r, g, b),
          opacity: options.opacity
        })
      }
      if (image) {
        const scale = Math.max(box.width / image.width, box.height / image.height)
        page.drawImage(image, {
          x: box.x + (box.width - image.width * scale) / 2,
          y: box.y + (box.height - image.height * scale) / 2,
          width: image.width * scale,
          height: image.height * scale,
          opacity: options.opacity
        })
      }
    })
  }
  return save(document)
}

/**
 * Runs a drawing callback and then moves what it drew underneath the page's
 * existing content.
 *
 * pdf-lib always appends, so a "background" drawn the ordinary way paints over
 * the document — at full opacity it erases the page. Content streams are
 * concatenated in array order, so putting the new stream first is exactly what
 * "behind" means, and pdf-lib already brackets its own operators in q/Q so the
 * original content still starts from a clean graphics state.
 */
function drawBehind(document: PDFDocument, page: PDFPage, draw: () => void): void {
  const existing = contentRefs(page)
  draw()
  const after = contentRefs(page)
  if (after.length <= existing.length) return
  const added = after.slice(existing.length)
  page.node.set(PDFName.of('Contents'), document.context.obj([...added, ...existing]))
}

function contentRefs(page: PDFPage): PDFRef[] {
  const contents = page.node.get(PDFName.of('Contents'))
  if (contents instanceof PDFRef) return [contents]
  if (contents instanceof PDFArray) {
    const refs: PDFRef[] = []
    for (let index = 0; index < contents.size(); index += 1) {
      const entry = contents.get(index)
      if (entry instanceof PDFRef) refs.push(entry)
    }
    return refs
  }
  return []
}

// Redaction destroys content rather than drawing over it, so it lives in
// ./redact.ts — importing it here would make this module and that one circular.

/* ------------------------------------------------------------ metadata */

export interface DocumentMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  creationDate?: Date
  modificationDate?: Date
  pageCount: number
  encrypted: boolean
}

export async function readMetadata(bytes: PdfBytes, password?: string): Promise<DocumentMetadata> {
  const document = await load(bytes, password)
  return {
    title: document.getTitle() ?? '',
    author: document.getAuthor() ?? '',
    subject: document.getSubject() ?? '',
    keywords: (document.getKeywords() ?? '').toString(),
    creator: document.getCreator() ?? '',
    producer: document.getProducer() ?? '',
    creationDate: document.getCreationDate(),
    modificationDate: document.getModificationDate(),
    pageCount: document.getPageCount(),
    encrypted: document.isEncrypted
  }
}

export async function writeMetadata(
  bytes: PdfBytes,
  metadata: Partial<DocumentMetadata>,
  password?: string
): Promise<PdfBytes> {
  return edit(bytes, password, (document) => {
    if (metadata.title !== undefined) document.setTitle(metadata.title)
    if (metadata.author !== undefined) document.setAuthor(metadata.author)
    if (metadata.subject !== undefined) document.setSubject(metadata.subject)
    if (metadata.keywords !== undefined) {
      document.setKeywords(
        metadata.keywords
          .split(/[,;]/)
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      )
    }
    if (metadata.creator !== undefined) document.setCreator(metadata.creator)
    if (metadata.producer !== undefined) document.setProducer(metadata.producer)
    document.setModificationDate(new Date())
  })
}

async function carryMetadata(source: PDFDocument, target: PDFDocument): Promise<void> {
  try {
    const title = source.getTitle()
    const author = source.getAuthor()
    const subject = source.getSubject()
    if (title) target.setTitle(title)
    if (author) target.setAuthor(author)
    if (subject) target.setSubject(subject)
  } catch {
    /* metadata is optional */
  }
  target.setProducer('Alcode Editor')
  target.setModificationDate(new Date())
}

/* ------------------------------------------------------------ security */

export interface PermissionSet {
  printing: boolean
  modifying: boolean
  copying: boolean
  annotating: boolean
  fillingForms: boolean
  contentAccessibility: boolean
  documentAssembly: boolean
}

export async function encryptDocument(
  bytes: PdfBytes,
  userPassword: string,
  ownerPassword: string,
  permissions: PermissionSet,
  currentPassword?: string
): Promise<PdfBytes> {
  const document = await load(bytes, currentPassword)
  document.encrypt({
    userPassword: userPassword || undefined,
    ownerPassword: ownerPassword || userPassword || undefined,
    algorithm: 'AES-256',
    permissions: {
      printing: permissions.printing ? 'highResolution' : undefined,
      modifying: permissions.modifying,
      copying: permissions.copying,
      annotating: permissions.annotating,
      fillingForms: permissions.fillingForms,
      contentAccessibility: permissions.contentAccessibility,
      documentAssembly: permissions.documentAssembly
    }
  })
  return save(document)
}

export async function decryptDocument(bytes: PdfBytes, password: string): Promise<PdfBytes> {
  // Re-copying every page into a fresh document drops the security handler.
  const source = await load(bytes, password)
  const target = await PDFDocument.create()
  const copied = await target.copyPages(source, source.getPageIndices())
  for (const page of copied) target.addPage(page)
  await carryMetadata(source, target)
  return save(target)
}

/* --------------------------------------------------------------- forms */

export interface FormField {
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'option' | 'button' | 'signature' | 'unknown'
  value: string
  options?: string[]
  /** Every current selection, for a multi-select option list. */
  selected?: string[]
}

export async function readFormFields(bytes: PdfBytes, password?: string): Promise<FormField[]> {
  const document = await load(bytes, password)
  const form = document.getForm()

  // Field types are matched with `instanceof`, never `constructor.name`:
  // class names do not survive the production bundle's minifier.
  return form.getFields().map((field) => {
    const name = field.getName()
    try {
      if (field instanceof PDFTextField) {
        return { name, type: 'text', value: field.getText() ?? '' }
      }
      if (field instanceof PDFCheckBox) {
        return { name, type: 'checkbox', value: field.isChecked() ? 'true' : 'false' }
      }
      if (field instanceof PDFDropdown) {
        return {
          name,
          type: 'dropdown',
          value: field.getSelected()[0] ?? '',
          options: field.getOptions()
        }
      }
      if (field instanceof PDFRadioGroup) {
        return { name, type: 'radio', value: field.getSelected() ?? '', options: field.getOptions() }
      }
      if (field instanceof PDFOptionList) {
        // Joining the selection into one string produced a value that matches
        // no option, so handing it back on save threw on every list field.
        return {
          name,
          type: 'option',
          value: field.getSelected()[0] ?? '',
          selected: field.getSelected(),
          options: field.getOptions()
        }
      }
      if (field instanceof PDFSignature) return { name, type: 'signature', value: '' }
      if (field instanceof PDFButton) return { name, type: 'button', value: '' }
    } catch {
      /* a malformed field should not break the whole listing */
    }
    return { name, type: 'unknown', value: '' }
  })
}

export interface FormFillResult {
  bytes: PdfBytes
  /** Fields that could not be written, and why. */
  skipped: { name: string; reason: string }[]
  /** True only when flattening was asked for *and* it worked. */
  flattened: boolean
}

/**
 * Writes values into a form, optionally locking it.
 *
 * Every failure is reported rather than swallowed: a user who ticks "flatten",
 * is told it applied, and ships a PDF whose fields are still live and editable
 * has been actively misled — which is the whole point of flattening.
 */
export async function fillFormFields(
  bytes: PdfBytes,
  values: Record<string, string>,
  flatten: boolean,
  password?: string
): Promise<FormFillResult> {
  const document = await load(bytes, password)
  const form = document.getForm()
  const skipped: { name: string; reason: string }[] = []

  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getField(name)
      if (field instanceof PDFTextField) {
        field.setText(value)
      } else if (field instanceof PDFCheckBox) {
        if (value === 'true') field.check()
        else field.uncheck()
      } else if (field instanceof PDFDropdown) {
        if (value) field.select(value)
      } else if (field instanceof PDFOptionList) {
        if (value) field.select(value)
      } else if (field instanceof PDFRadioGroup) {
        if (value) field.select(value)
      } else if (field instanceof PDFSignature || field instanceof PDFButton) {
        // Not writable by design; not a failure worth reporting either.
        continue
      } else {
        skipped.push({ name, reason: 'unsupported-field-type' })
      }
    } catch (error) {
      skipped.push({ name, reason: (error as Error)?.message ?? 'field-write-failed' })
    }
  }

  let flattened = false
  if (flatten) {
    try {
      form.flatten()
      flattened = true
    } catch (error) {
      skipped.push({ name: '', reason: (error as Error)?.message ?? 'flatten-failed' })
    }
  }
  return { bytes: await save(document), skipped, flattened }
}

export async function flattenForms(bytes: PdfBytes, password?: string): Promise<FormFillResult> {
  return fillFormFields(bytes, {}, true, password)
}

/* ------------------------------------------------------------ optimize */

/**
 * Rewrites the file compactly without rebuilding it.
 *
 * Copying the pages into a blank document was the obvious way to drop orphaned
 * objects — and it also dropped the bookmarks, the form, the attachments, the
 * page labels and the accessibility structure tree, because `copyPages` clones
 * a page and what it references and never visits the catalog. Two sibling
 * tools in this app *create* exactly those things, so "optimize" was quietly
 * undoing them and reporting a size saving for it.
 *
 * A full non-incremental rewrite of the loaded document gets the same win —
 * object streams, no stale revisions — while keeping the catalog intact.
 */
export async function optimizeDocument(bytes: PdfBytes, password?: string): Promise<PdfBytes> {
  const document = await load(bytes, password)
  return document.save({ useObjectStreams: true, addDefaultPage: false, rewrite: true })
}

export async function attachFiles(
  bytes: PdfBytes,
  files: NamedBytes[],
  password?: string
): Promise<PdfBytes> {
  return edit(bytes, password, async (document) => {
    for (const file of files) {
      await document.attach(file.bytes, file.name, {
        mimeType: 'application/octet-stream',
        creationDate: new Date(),
        modificationDate: new Date()
      })
    }
  })
}

/* --------------------------------------------------------------- pages */

export async function imagesToPdf(
  images: { bytes: Uint8Array; type: 'png' | 'jpg' }[],
  pageSize: [number, number] | null,
  fit: 'contain' | 'cover' | 'actual',
  marginPt: number
): Promise<PdfBytes> {
  const document = await PDFDocument.create()
  for (const item of images) {
    const image = item.type === 'jpg' ? await document.embedJpg(item.bytes) : await document.embedPng(item.bytes)
    if (fit === 'actual' || !pageSize) {
      const page = document.addPage([image.width + marginPt * 2, image.height + marginPt * 2])
      page.drawImage(image, { x: marginPt, y: marginPt, width: image.width, height: image.height })
      continue
    }
    const page = document.addPage(pageSize)
    const available = [pageSize[0] - marginPt * 2, pageSize[1] - marginPt * 2]
    const scale =
      fit === 'cover'
        ? Math.max(available[0] / image.width, available[1] / image.height)
        : Math.min(available[0] / image.width, available[1] / image.height)
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, {
      x: (pageSize[0] - width) / 2,
      y: (pageSize[1] - height) / 2,
      width,
      height
    })
  }
  document.setProducer('Alcode Editor')
  return save(document)
}

export function mmToPoints(millimetres: number): number {
  return millimetres * MM_TO_PT
}
