import JSZip from 'jszip'
import { docxToHtml } from '../docx/read'
import { markdownToHtml } from '../markdown'
import { escapeHtml, stripExtension } from '../format'
import { decodeText, detectDirection, normalizeArabicPresentation } from '../text/encoding'
import { sanitize } from './sanitize'
import {
  epubToHtml,
  legacyDocToHtml,
  mimeFromName,
  odtToHtml,
  pptxToHtml
} from './office'
import { rtfToHtml } from './rtf'
import { readDelimited, readWorkbook, type SheetData } from './sheets'
import {
  formatFromBytes,
  formatFromName,
  formatInfo,
  isZipContainer,
  type DocumentFormat,
  type DocumentKind
} from './formats'

export interface LoadedDocument {
  name: string
  path: string | null
  format: DocumentFormat
  kind: DocumentKind
  /** Rich and slide documents. */
  html?: string
  /** Spreadsheet documents. */
  sheets?: SheetData[]
  /** Code and plain-text documents. */
  text?: string
  /** Image documents. */
  imageDataUrl?: string
  direction: 'rtl' | 'ltr'
  encoding?: string
  /** Line endings as they were on disk, so a save-in-place keeps them. */
  eol?: 'lf' | 'crlf'
  /**
   * True when the reader could not represent the whole file. Save-in-place is
   * refused for such a document so the original is never overwritten with a
   * partial copy.
   */
  truncated?: boolean
  /** Non-fatal notes worth showing the user, e.g. "text only". */
  warnings: string[]
  originalBytes: Uint8Array
}

/**
 * Opens any supported file into the editor's document model.
 *
 * Detection prefers the extension but falls back to magic bytes, and ZIP
 * containers are probed by their entry names so a mislabelled .docx still
 * lands in the right reader.
 */
export async function readDocument(
  name: string,
  bytes: Uint8Array,
  path: string | null
): Promise<LoadedDocument> {
  // Normalising here rather than inside each reader is the point: it used to
  // be applied to .txt and .md only, so a Word file carrying shaped glyphs —
  // the common case, and the one people actually hit — opened with every
  // Arabic letter standing apart. A central pass cannot be forgotten by the
  // next format added.
  return unshapeArabic(await readByFormat(name, bytes, path))
}

/**
 * Folds Arabic presentation forms in whatever the reader produced.
 *
 * The check inside normalizeArabicPresentation returns the string untouched
 * when it holds no shaped glyphs, so this costs one regex test per document
 * that does not need it.
 */
function unshapeArabic(document_: LoadedDocument): LoadedDocument {
  const fixed: LoadedDocument = { ...document_ }
  if (fixed.html !== undefined) fixed.html = normalizeArabicPresentation(fixed.html)
  if (fixed.text !== undefined) fixed.text = normalizeArabicPresentation(fixed.text)
  if (fixed.sheets) {
    fixed.sheets = fixed.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) =>
        row.map((cell) => {
          const text = normalizeArabicPresentation(cell.text)
          return text === cell.text ? cell : { ...cell, text }
        })
      )
    }))
  }
  return fixed
}

async function readByFormat(
  name: string,
  bytes: Uint8Array,
  path: string | null
): Promise<LoadedDocument> {
  const format = await detectFormat(name, bytes)
  const info = formatInfo(format)
  const kind: DocumentKind = info?.kind ?? 'code'

  const base: Omit<LoadedDocument, 'direction'> = {
    name,
    path,
    format,
    kind,
    warnings: [],
    originalBytes: bytes
  }

  switch (format) {
    case 'docx': {
      // The OOXML reader keeps fonts, sizes, colours and alignment as Word
      // set them; mammoth is the fallback for a file it cannot make sense of.
      try {
        const { docxToRichHtml } = await import('../docx/ooxml')
        const rich = await docxToRichHtml(bytes)
        return { ...base, html: sanitize(rich.html), warnings: rich.warnings, direction: rich.direction }
      } catch {
        const { html, warnings } = await docxToHtml(bytes)
        const clean = sanitize(html)
        return { ...base, html: clean, warnings, direction: directionOfHtml(clean) }
      }
    }

    case 'doc': {
      const { html, warnings } = legacyDocToHtml(bytes)
      const clean = sanitize(html)
      return { ...base, html: clean, warnings, direction: directionOfHtml(clean) }
    }

    case 'rtf': {
      const { html, direction } = rtfToHtml(bytes)
      return { ...base, html: sanitize(html), direction }
    }

    case 'odt': {
      const { html, warnings } = await odtToHtml(bytes)
      const clean = sanitize(html)
      return { ...base, html: clean, warnings, direction: directionOfHtml(clean) }
    }

    case 'pptx': {
      const { html, warnings } = await pptxToHtml(bytes)
      const clean = sanitize(html)
      return { ...base, html: clean, warnings, direction: directionOfHtml(clean) }
    }

    case 'epub': {
      const { html, warnings } = await epubToHtml(bytes)
      const clean = sanitize(html)
      return { ...base, html: clean, warnings, direction: directionOfHtml(clean) }
    }

    case 'html': {
      const decoded = decodeText(bytes)
      const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(decoded.text)?.[1] ?? decoded.text
      const clean = sanitize(body)
      return {
        ...base,
        html: clean,
        encoding: decoded.encoding,
        direction: directionOfHtml(clean)
      }
    }

    case 'md': {
      const decoded = decodeText(bytes)
      const text = normalizeArabicPresentation(decoded.text)
      const clean = sanitize(markdownToHtml(text))
      return {
        ...base,
        html: clean,
        encoding: decoded.encoding,
        direction: detectDirection(text)
      }
    }

    case 'txt': {
      const decoded = decodeText(bytes)
      const text = normalizeArabicPresentation(decoded.text)
      return {
        ...base,
        html: plainTextToHtml(text),
        encoding: decoded.encoding,
        eol: /\r\n/.test(decoded.text) ? 'crlf' : 'lf',
        direction: detectDirection(text)
      }
    }

    case 'csv':
    case 'tsv': {
      const decoded = decodeText(bytes)
      const { sheets, direction, truncated } = readDelimited(decoded.text, format === 'tsv' ? '\t' : ',')
      return {
        ...base,
        sheets,
        encoding: decoded.encoding,
        direction,
        truncated,
        warnings: truncated ? ['sheet-truncated'] : []
      }
    }

    case 'xlsx':
    case 'xls':
    case 'ods': {
      const { sheets, direction, truncated } = readWorkbook(bytes)
      // A truncated grid must never be written back over the original.
      return {
        ...base,
        sheets,
        direction,
        truncated,
        warnings: truncated ? ['sheet-truncated'] : []
      }
    }

    case 'json':
    case 'xml':
    case 'code': {
      const decoded = decodeText(bytes)
      const text = decoded.text
      return {
        ...base,
        text: format === 'json' ? prettyJson(text) : text,
        encoding: decoded.encoding,
        direction: 'ltr'
      }
    }

    case 'image': {
      const dataUrl = `data:${mimeFromName(name)};base64,${bytesToBase64(bytes)}`
      return { ...base, imageDataUrl: dataUrl, direction: 'ltr' }
    }

    case 'pdf':
      // PDFs are handled by the dedicated PDF workspace, not the text editor.
      return { ...base, direction: 'ltr' }

    default: {
      const decoded = decodeText(bytes)
      return {
        ...base,
        format: 'code',
        kind: 'code',
        text: decoded.text,
        encoding: decoded.encoding,
        direction: detectDirection(decoded.text),
        warnings: ['unknown-format-as-text']
      }
    }
  }
}

async function detectFormat(name: string, bytes: Uint8Array): Promise<DocumentFormat> {
  const byName = formatFromName(name)

  if (isZipContainer(bytes)) {
    // All the OOXML/ODF/EPUB formats are ZIPs; the entry names disambiguate.
    const probed = await probeZip(bytes)
    if (probed) return probed
    return byName?.format ?? 'unknown'
  }

  const byBytes = formatFromBytes(bytes)

  // .doc, .xls and .ppt are all OLE2 compound files with identical magic
  // bytes, so the signature alone cannot tell them apart — the extension is
  // the only cheap discriminator, and probing the CFB streams is the fallback.
  if (byBytes === 'doc') {
    if (byName && ['xls', 'xlsx', 'ods', 'doc', 'pptx'].includes(byName.format)) return byName.format
    return probeOle2(bytes)
  }

  if (byBytes && byBytes !== 'image') return byBytes
  if (byName) return byName.format
  if (byBytes) return byBytes
  return 'unknown'
}

/**
 * Distinguishes an OLE2 container by the stream names in its root directory.
 * A BIFF workbook holds "Workbook" or "Book"; Word holds "WordDocument".
 */
function probeOle2(bytes: Uint8Array): DocumentFormat {
  // Stream names are UTF-16LE in the directory sector; a byte scan is enough
  // to tell the three apart without implementing the CFB layout.
  const text = new TextDecoder('utf-16le', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 1 << 16))
  )
  if (text.includes('Workbook') || text.includes('Book')) return 'xls'
  if (text.includes('PowerPoint')) return 'unknown'
  return 'doc'
}

async function probeZip(bytes: Uint8Array): Promise<DocumentFormat | null> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files)

    if (names.includes('word/document.xml')) return 'docx'
    if (names.some((entry) => entry.startsWith('ppt/slides/slide'))) return 'pptx'
    if (names.includes('xl/workbook.xml')) return 'xlsx'
    if (names.includes('META-INF/container.xml')) return 'epub'

    const mimetype = zip.file('mimetype')
    if (mimetype) {
      const declared = (await mimetype.async('string')).trim()
      if (declared.includes('opendocument.text')) return 'odt'
      if (declared.includes('opendocument.spreadsheet')) return 'ods'
      if (declared.includes('opendocument.presentation')) return 'pptx'
      if (declared.includes('epub')) return 'epub'
    }
    return null
  } catch {
    return null
  }
}

/**
 * Documents come from outside the app, so their markup is untrusted. Stripping
 * scripts, event handlers and remote references keeps a hostile file from doing
 * anything when it lands in the contenteditable surface.
 */
export { sanitize, sanitizeForPrint } from './sanitize'

function plainTextToHtml(text: string): string {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  return (
    blocks
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
      .join('') || '<p><br /></p>'
  )
}

function directionOfHtml(html: string): 'rtl' | 'ltr' {
  const container = document.createElement('div')
  container.innerHTML = html
  return detectDirection((container.textContent ?? '').slice(0, 6000))
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function documentTitle(document_: LoadedDocument): string {
  return stripExtension(document_.name)
}
