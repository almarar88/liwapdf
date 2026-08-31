import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  PDFFont,
  type PDFImage
} from '@cantoo/pdf-lib'
import { hexToRgb, needsComplexShaping, PAGE_PRESETS, MM_TO_PT, stripExtension } from '../format'
import { rasterizeText } from './text-raster'

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

export async function load(bytes: PdfBytes, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes.slice(), {
      password,
      ignoreEncryption: true,
      updateMetadata: false
    })
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

/** Runs a mutation over a document and returns the fresh bytes. */
export async function edit(
  bytes: PdfBytes,
  password: string | undefined,
  mutate: (document: PDFDocument) => Promise<void> | void
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  await mutate(document)
  return save(document)
}

/* ---------------------------------------------------------- page layout */

export async function reorderPages(
  bytes: PdfBytes,
  order: number[],
  password?: string
): Promise<PdfBytes> {
  const source = await load(bytes, password)
  const target = await PDFDocument.create()
  const copied = await target.copyPages(source, order)
  for (const page of copied) target.addPage(page)
  await carryMetadata(source, target)
  return save(target)
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
  const remaining = document
    .getPageIndices()
    .filter((index) => !indices.includes(index))
  if (remaining.length === 0) throw new Error('cannot-delete-all-pages')
  return reorderPages(bytes, remaining, password)
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
  return reorderPages(bytes, order, password)
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

export async function splitBySize(
  bytes: PdfBytes,
  baseName: string,
  maxBytes: number,
  password?: string
): Promise<NamedBytes[]> {
  const document = await load(bytes, password)
  const total = document.getPageCount()
  const base = stripExtension(baseName)
  const parts: NamedBytes[] = []

  let current: number[] = []
  let lastGood: PdfBytes | null = null

  for (let index = 0; index < total; index += 1) {
    const candidate = [...current, index]
    const rendered = await reorderPages(bytes, candidate, password)
    if (rendered.byteLength > maxBytes && current.length > 0) {
      parts.push({ name: `${base}-part${parts.length + 1}.pdf`, bytes: lastGood! })
      current = [index]
      lastGood = await reorderPages(bytes, current, password)
    } else {
      current = candidate
      lastGood = rendered
    }
  }
  if (current.length > 0 && lastGood) {
    parts.push({ name: `${base}-part${parts.length + 1}.pdf`, bytes: lastGood })
  }
  return parts
}

export async function reversePages(bytes: PdfBytes, password?: string): Promise<PdfBytes> {
  const document = await load(bytes, password)
  return reorderPages(bytes, document.getPageIndices().reverse(), password)
}

/* -------------------------------------------------------- page geometry */

export async function resizePages(
  bytes: PdfBytes,
  target: [number, number],
  password?: string
): Promise<PdfBytes> {
  const source = await load(bytes, password)
  const output = await PDFDocument.create()
  const pages = source.getPages()

  for (let index = 0; index < pages.length; index += 1) {
    const embedded = await output.embedPage(pages[index])
    const page = output.addPage(target)
    const scale = Math.min(
      target[0] / embedded.width,
      target[1] / embedded.height
    )
    const width = embedded.width * scale
    const height = embedded.height * scale
    page.drawPage(embedded, {
      x: (target[0] - width) / 2,
      y: (target[1] - height) / 2,
      width,
      height
    })
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
      const box = page.getMediaBox()
      const left = (box.width * percents.start) / 100
      const right = (box.width * percents.end) / 100
      const top = (box.height * percents.top) / 100
      const bottom = (box.height * percents.bottom) / 100
      const width = Math.max(20, box.width - left - right)
      const height = Math.max(20, box.height - top - bottom)
      page.setCropBox(box.x + left, box.y + bottom, width, height)
      page.setMediaBox(box.x + left, box.y + bottom, width, height)
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
      const embedded = await output.embedPage(pages[start + slot])
      const column = slot % columns
      const row = Math.floor(slot / columns)
      const scale = Math.min(cellWidth / embedded.width, cellHeight / embedded.height)
      const width = embedded.width * scale
      const height = embedded.height * scale
      const x = gap + column * (cellWidth + gap) + (cellWidth - width) / 2
      const y = sheetSize[1] - gap - (row + 1) * cellHeight - row * gap + (cellHeight - height) / 2
      sheet.drawPage(embedded, { x, y, width, height })
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

function anchorPosition(
  anchor: Anchor,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  margin: number
): { x: number; y: number } {
  const horizontal: Record<string, number> = {
    Left: margin,
    Center: (pageWidth - width) / 2,
    Right: pageWidth - width - margin
  }
  const vertical: Record<string, number> = {
    top: pageHeight - height - margin,
    middle: (pageHeight - height) / 2,
    bottom: margin
  }
  const verticalKey = anchor.startsWith('top') ? 'top' : anchor.startsWith('bottom') ? 'bottom' : 'middle'
  const horizontalKey = anchor.endsWith('Left')
    ? 'Left'
    : anchor.endsWith('Right')
      ? 'Right'
      : 'Center'
  return { x: horizontal[horizontalKey], y: vertical[verticalKey] }
}

interface DrawTextArgs {
  document: PDFDocument
  page: PDFPage
  text: string
  fontSize: number
  color: string
  opacity: number
  anchor: Anchor
  margin: number
  rotate?: number
  bold?: boolean
  cache: OverlayCache
}

interface OverlayCache {
  font?: PDFFont
  boldFont?: PDFFont
  images: Map<string, PDFImage>
}

export function newOverlayCache(): OverlayCache {
  return { images: new Map() }
}

/**
 * Draws a label on a page, picking the representation that can actually show
 * the glyphs: vector base-14 text for Latin, a rasterized PNG otherwise.
 */
async function drawLabel(args: DrawTextArgs): Promise<void> {
  const { document, page, text, fontSize, color, opacity, anchor, margin, rotate = 0 } = args
  const width = page.getWidth()
  const height = page.getHeight()

  if (needsComplexShaping(text)) {
    const key = `${text}|${fontSize}|${color}|${args.bold ? 1 : 0}`
    let image = args.cache.images.get(key)
    if (!image) {
      const raster = rasterizeText(text, { fontSize, color, bold: args.bold })
      image = await document.embedPng(raster.png)
      args.cache.images.set(key, image)
    }
    const drawWidth = image.width / 4
    const drawHeight = image.height / 4
    const position = anchorPosition(anchor, width, height, drawWidth, drawHeight, margin)
    page.drawImage(image, {
      ...position,
      width: drawWidth,
      height: drawHeight,
      opacity,
      rotate: degrees(rotate)
    })
    return
  }

  const font =
    args.bold
      ? (args.cache.boldFont ??= await document.embedFont(StandardFonts.HelveticaBold))
      : (args.cache.font ??= await document.embedFont(StandardFonts.Helvetica))
  const textWidth = font.widthOfTextAtSize(text, fontSize)
  const textHeight = font.heightAtSize(fontSize)
  const position = anchorPosition(anchor, width, height, textWidth, textHeight, margin)
  const { r, g, b } = hexToRgb(color)
  page.drawText(text, {
    ...position,
    size: fontSize,
    font,
    color: rgb(r, g, b),
    opacity,
    rotate: degrees(rotate)
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
  const cache = newOverlayCache()

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
        const position = anchorPosition(
          options.anchor,
          width,
          height,
          scaled.width,
          scaled.height,
          options.margin
        )
        page.drawImage(image, {
          ...position,
          width: scaled.width,
          height: scaled.height,
          opacity: options.opacity,
          rotate: degrees(options.rotation)
        })
      }
      continue
    }

    if (!options.text) continue

    if (options.tile) {
      const step = Math.max(120, options.fontSize * 7)
      for (let x = 0; x < width; x += step) {
        for (let y = 0; y < height; y += step) {
          await drawTileText(document, page, options, x, y, cache)
        }
      }
    } else {
      await drawLabel({
        document,
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
  document: PDFDocument,
  page: PDFPage,
  options: WatermarkOptions,
  x: number,
  y: number,
  cache: OverlayCache
): Promise<void> {
  const text = options.text!
  if (needsComplexShaping(text)) {
    const key = `${text}|${options.fontSize}|${options.color}|${options.bold ? 1 : 0}`
    let image = cache.images.get(key)
    if (!image) {
      const raster = rasterizeText(text, {
        fontSize: options.fontSize,
        color: options.color,
        bold: options.bold
      })
      image = await document.embedPng(raster.png)
      cache.images.set(key, image)
    }
    page.drawImage(image, {
      x,
      y,
      width: image.width / 4,
      height: image.height / 4,
      opacity: options.opacity,
      rotate: degrees(options.rotation)
    })
    return
  }
  const font = (cache.font ??= await document.embedFont(
    options.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica
  ))
  const { r, g, b } = hexToRgb(options.color)
  page.drawText(text, {
    x,
    y,
    size: options.fontSize,
    font,
    color: rgb(r, g, b),
    opacity: options.opacity,
    rotate: degrees(options.rotation)
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
  arabicNumerals: boolean
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

function localizeDigits(value: number, arabic: boolean): string {
  const plain = String(value)
  return arabic ? plain.replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)]) : plain
}

export async function addPageNumbers(
  bytes: PdfBytes,
  options: PageNumberOptions,
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  const cache = newOverlayCache()
  const total = options.indices.length

  let counter = options.startAt
  for (const [position, index] of options.indices.entries()) {
    const page = pages[index]
    if (!page) continue
    if (options.skipFirst && position === 0) {
      counter += 1
      continue
    }
    const number = localizeDigits(counter, options.arabicNumerals)
    const totalLabel = localizeDigits(total + options.startAt - 1, options.arabicNumerals)
    const templates: Record<NumberFormat, string> = {
      n: number,
      'n-of-total': `${number} / ${totalLabel}`,
      'page-n': options.arabicNumerals ? `صفحة ${number}` : `Page ${number}`,
      'page-n-of-total': options.arabicNumerals
        ? `صفحة ${number} من ${totalLabel}`
        : `Page ${number} of ${totalLabel}`,
      'dash-n-dash': `- ${number} -`
    }
    await drawLabel({
      document,
      page,
      text: templates[options.format],
      fontSize: options.fontSize,
      color: options.color,
      opacity: 1,
      anchor: options.anchor,
      margin: options.margin,
      bold: options.bold,
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
  const cache = newOverlayCache()
  const anchorFor = (band: 'top' | 'bottom'): Anchor => {
    const suffix = options.align === 'start' ? 'Left' : options.align === 'end' ? 'Right' : 'Center'
    return `${band}${suffix}` as Anchor
  }

  for (const index of options.indices) {
    const page = pages[index]
    if (!page) continue
    if (options.header.trim()) {
      await drawLabel({
        document,
        page,
        text: options.header,
        fontSize: options.fontSize,
        color: options.color,
        opacity: 1,
        anchor: anchorFor('top'),
        margin: options.margin,
        cache
      })
    }
    if (options.footer.trim()) {
      await drawLabel({
        document,
        page,
        text: options.footer,
        fontSize: options.fontSize,
        color: options.color,
        opacity: 1,
        anchor: anchorFor('bottom'),
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
    const width = page.getWidth()
    const height = page.getHeight()
    // Painting behind existing content requires pushing our operators first.
    if (options.color) {
      const { r, g, b } = hexToRgb(options.color)
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: rgb(r, g, b),
        opacity: options.opacity
      })
    }
    if (image) {
      const scale = Math.max(width / image.width, height / image.height)
      page.drawImage(image, {
        x: (width - image.width * scale) / 2,
        y: (height - image.height * scale) / 2,
        width: image.width * scale,
        height: image.height * scale,
        opacity: options.opacity
      })
    }
  }
  return save(document)
}

export interface RedactRegion {
  pageIndex: number
  /** Normalized 0..1 coordinates with the origin at the page's top-left. */
  x: number
  y: number
  width: number
  height: number
}

export async function applyRedactions(
  bytes: PdfBytes,
  regions: RedactRegion[],
  password?: string
): Promise<PdfBytes> {
  return edit(bytes, password, (document) => {
    const pages = document.getPages()
    for (const region of regions) {
      const page = pages[region.pageIndex]
      if (!page) continue
      const width = page.getWidth()
      const height = page.getHeight()
      page.drawRectangle({
        x: region.x * width,
        y: height - (region.y + region.height) * height,
        width: region.width * width,
        height: region.height * height,
        color: rgb(0, 0, 0)
      })
    }
  })
}

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
        return { name, type: 'option', value: field.getSelected().join(', '), options: field.getOptions() }
      }
      if (field instanceof PDFSignature) return { name, type: 'signature', value: '' }
      if (field instanceof PDFButton) return { name, type: 'button', value: '' }
    } catch {
      /* a malformed field should not break the whole listing */
    }
    return { name, type: 'unknown', value: '' }
  })
}

export async function fillFormFields(
  bytes: PdfBytes,
  values: Record<string, string>,
  flatten: boolean,
  password?: string
): Promise<PdfBytes> {
  const document = await load(bytes, password)
  const form = document.getForm()

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
      }
    } catch {
      /* a missing or unsupported field should not abort the whole fill */
    }
  }

  if (flatten) {
    try {
      form.flatten()
    } catch {
      /* some malformed forms cannot be flattened */
    }
  }
  return save(document)
}

export async function flattenForms(bytes: PdfBytes, password?: string): Promise<PdfBytes> {
  return fillFormFields(bytes, {}, true, password)
}

/* ------------------------------------------------------------ optimize */

export async function optimizeDocument(bytes: PdfBytes, password?: string): Promise<PdfBytes> {
  const source = await load(bytes, password)
  const target = await PDFDocument.create()
  const copied = await target.copyPages(source, source.getPageIndices())
  for (const page of copied) target.addPage(page)
  await carryMetadata(source, target)
  return target.save({ useObjectStreams: true, addDefaultPage: false })
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
