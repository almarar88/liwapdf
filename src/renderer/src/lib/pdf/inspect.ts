import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, PDFHexString } from '@cantoo/pdf-lib'
import { load } from './ops'

/**
 * What a print shop, a court clerk or a publisher asks about a PDF before
 * accepting it: which fonts it uses and whether they travel with the file,
 * how many pictures it carries, what size its pages are, whether it is a
 * scan wearing a PDF's clothes, and what it declares about itself.
 */

export interface FontInfo {
  name: string
  type: string
  embedded: boolean
}

export interface PageSizeInfo {
  widthMm: number
  heightMm: number
  count: number
  /** A4, Letter… when the size is within a millimetre of a standard. */
  label: string | null
}

export interface DocumentReport {
  version: string
  bytes: number
  pages: number
  pageSizes: PageSizeInfo[]
  fonts: FontInfo[]
  images: number
  /** No fonts anywhere but pictures on the pages: almost certainly a scan. */
  scanned: boolean
  formFields: number
  bookmarks: number
  attachments: number
  encrypted: boolean
  title: string | null
  author: string | null
  producer: string | null
  creator: string | null
  created: Date | null
  modified: Date | null
}

const STANDARD_SIZES: [string, number, number][] = [
  ['A3', 297, 420],
  ['A4', 210, 297],
  ['A5', 148, 210],
  ['Letter', 215.9, 279.4],
  ['Legal', 215.9, 355.6],
  ['Tabloid', 279.4, 431.8]
]

export async function inspectDocument(bytes: Uint8Array, password?: string): Promise<DocumentReport> {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 16))
  const version = /%PDF-(\d\.\d)/.exec(header)?.[1] ?? '?'
  let encrypted = false
  try {
    encrypted = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096))).includes('/Encrypt')
  } catch {
    encrypted = false
  }

  const document = await load(bytes, password)
  const context = document.context

  const fonts = new Map<string, FontInfo>()
  let images = 0
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      if (object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) images += 1
      continue
    }
    if (!(object instanceof PDFDict)) continue
    if (object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue
    const subtype = nameOf(object.get(PDFName.of('Subtype')))
    if (subtype === 'Type3') {
      const base = nameOf(object.get(PDFName.of('Name'))) || 'Type3'
      fonts.set(`${base}:Type3`, { name: base, type: 'Type3', embedded: true })
      continue
    }
    const baseFont = nameOf(object.get(PDFName.of('BaseFont'))).replace(/^[A-Z]{6}\+/, '')
    let descriptor = lookupDict(context, object.get(PDFName.of('FontDescriptor')))
    if (!descriptor && subtype === 'Type0') {
      const descendants = context.lookup(object.get(PDFName.of('DescendantFonts')))
      const first = descendants instanceof PDFArray ? lookupDict(context, descendants.get(0)) : null
      descriptor = first ? lookupDict(context, first.get(PDFName.of('FontDescriptor'))) : null
    }
    const embedded = Boolean(
      descriptor &&
        (descriptor.has(PDFName.of('FontFile')) || descriptor.has(PDFName.of('FontFile2')) || descriptor.has(PDFName.of('FontFile3')))
    )
    const key = `${baseFont}:${subtype}`
    if (!fonts.has(key)) fonts.set(key, { name: baseFont || '?', type: subtype || '?', embedded })
  }

  const pages = document.getPages()
  const sizes = new Map<string, PageSizeInfo>()
  for (const page of pages) {
    const { width, height } = page.getSize()
    const widthMm = Math.round((width / 72) * 25.4 * 10) / 10
    const heightMm = Math.round((height / 72) * 25.4 * 10) / 10
    const key = `${widthMm}x${heightMm}`
    const existing = sizes.get(key)
    if (existing) existing.count += 1
    else sizes.set(key, { widthMm, heightMm, count: 1, label: standardLabel(widthMm, heightMm) })
  }

  let formFields = 0
  try {
    formFields = document.getForm().getFields().length
  } catch {
    formFields = 0
  }

  const catalog = document.catalog
  const outlines = lookupDict(context, catalog.get(PDFName.of('Outlines')))
  const countValue = outlines?.get(PDFName.of('Count'))
  const bookmarks = countValue instanceof PDFNumber ? Math.abs(countValue.asNumber()) : outlines ? 1 : 0

  let attachments = 0
  const names = lookupDict(context, catalog.get(PDFName.of('Names')))
  const embedded = names ? lookupDict(context, names.get(PDFName.of('EmbeddedFiles'))) : null
  if (embedded) attachments = countNameTree(context, embedded)

  return {
    version,
    bytes: bytes.byteLength,
    pages: pages.length,
    pageSizes: [...sizes.values()].sort((a, b) => b.count - a.count),
    fonts: [...fonts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    images,
    scanned: fonts.size === 0 && images > 0,
    formFields,
    bookmarks,
    attachments,
    encrypted,
    title: document.getTitle() ?? null,
    author: document.getAuthor() ?? null,
    producer: document.getProducer() ?? null,
    creator: document.getCreator() ?? null,
    created: document.getCreationDate() ?? null,
    modified: document.getModificationDate() ?? null
  }
}

function nameOf(value: unknown): string {
  if (value instanceof PDFName) return value.decodeText()
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function lookupDict(context: { lookup(ref: unknown): unknown }, value: unknown): PDFDict | null {
  if (value === undefined) return null
  const resolved = value instanceof PDFRef ? context.lookup(value) : value
  return resolved instanceof PDFDict ? resolved : null
}

function countNameTree(context: { lookup(ref: unknown): unknown }, node: PDFDict): number {
  const names = context.lookup(node.get(PDFName.of('Names')))
  if (names instanceof PDFArray) return Math.floor(names.size() / 2)
  const kids = context.lookup(node.get(PDFName.of('Kids')))
  if (kids instanceof PDFArray) {
    let total = 0
    for (let i = 0; i < kids.size(); i += 1) {
      const kid = lookupDict(context, kids.get(i))
      if (kid) total += countNameTree(context, kid)
    }
    return total
  }
  return 0
}

function standardLabel(widthMm: number, heightMm: number): string | null {
  for (const [label, w, h] of STANDARD_SIZES) {
    const portrait = Math.abs(widthMm - w) <= 1.5 && Math.abs(heightMm - h) <= 1.5
    const landscape = Math.abs(widthMm - h) <= 1.5 && Math.abs(heightMm - w) <= 1.5
    if (portrait) return label
    if (landscape) return `${label} (أفقي)`
  }
  return null
}
