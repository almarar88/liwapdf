import JSZip from 'jszip'
import DOMPurify from 'dompurify'
import { docxToHtml } from '../docx/read'
import { markdownToHtml } from '../markdown'
import { escapeHtml, stripExtension } from '../format'
import { decodeText, detectDirection, normalizeArabicPresentation } from '../text/encoding'
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
      const { html, warnings } = await docxToHtml(bytes)
      const clean = sanitize(html)
      return { ...base, html: clean, warnings, direction: directionOfHtml(clean) }
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
        direction: detectDirection(text)
      }
    }

    case 'csv':
    case 'tsv': {
      const decoded = decodeText(bytes)
      const { sheets, direction } = readDelimited(decoded.text, format === 'tsv' ? '\t' : ',')
      return { ...base, sheets, encoding: decoded.encoding, direction }
    }

    case 'xlsx':
    case 'xls':
    case 'ods': {
      const { sheets, direction } = readWorkbook(bytes)
      return { ...base, sheets, direction }
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
  if (byBytes && byBytes !== 'image') return byBytes
  if (byName) return byName.format
  if (byBytes) return byBytes
  return 'unknown'
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
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:data:image\/[a-z+.-]+;base64,|https?:|mailto:|#)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
    FORBID_ATTR: ['srcset', 'formaction', 'background', 'ping'],
    ADD_ATTR: ['dir', 'colspan', 'rowspan']
  })
}

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
