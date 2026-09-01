import TurndownService from 'turndown'
import { htmlToDocx } from '../docx/write'
import { htmlToPdf } from '../convert'
import { stripExtension } from '../format'
import { htmlToRtf } from './rtf'
import { htmlToOdt } from './office'
import { htmlToEpub } from './epub'
import { sheetsToHtml, writeDelimited, writeWorkbook, type SheetData } from './sheets'
import type { DocumentFormat } from './formats'
import type { LoadedDocument } from './read'

export interface ExportRequest {
  target: DocumentFormat
  /** Current editor content, which may differ from what was loaded. */
  html?: string
  sheets?: SheetData[]
  text?: string
  name: string
  rightToLeft: boolean
  /**
   * The encoding the file had on disk. A file the app opened *because* it
   * could tell it was Windows-1256 must not come back as UTF-8 — that is how
   * the system that produced it stops being able to read it.
   */
  encoding?: string
  eol?: 'lf' | 'crlf'
  pdf?: { pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal'; landscape?: boolean; marginsMm?: number }
}

export interface ExportResult {
  bytes: Uint8Array
  fileName: string
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*'
})
turndown.addRule('strikethrough', {
  filter: ['del', 's'],
  replacement: (content) => `~~${content}~~`
})
turndown.addRule('keepTables', {
  filter: 'table',
  replacement: (_content, node) => markdownTable(node as HTMLTableElement)
})

/** Renders the current editor state into any format the user picks. */
export async function exportDocument(request: ExportRequest): Promise<ExportResult> {
  const base = stripExtension(request.name)
  const html = request.html ?? (request.sheets ? sheetsToHtml(request.sheets, request.rightToLeft) : '')

  switch (request.target) {
    case 'docx':
      return {
        bytes: await htmlToDocx(html, { title: base, rightToLeft: request.rightToLeft }),
        fileName: `${base}.docx`
      }

    case 'pdf':
      return {
        bytes: await htmlToPdf(bodyFor(request, html), {
          rightToLeft: request.rightToLeft,
          title: base,
          pageSize: request.pdf?.pageSize ?? 'A4',
          landscape: request.pdf?.landscape,
          marginsMm: request.pdf?.marginsMm ?? 18
        }),
        fileName: `${base}.pdf`
      }

    case 'rtf':
      return { bytes: htmlToRtf(html, request.rightToLeft), fileName: `${base}.rtf` }

    case 'odt':
      return { bytes: await htmlToOdt(html, request.rightToLeft), fileName: `${base}.odt` }

    case 'epub':
      return {
        bytes: await htmlToEpub(html, {
          title: base,
          language: request.rightToLeft ? 'ar' : 'en',
          rightToLeft: request.rightToLeft
        }),
        fileName: `${base}.epub`
      }

    case 'html': {
      const page =
        `<!doctype html><html lang="${request.rightToLeft ? 'ar' : 'en'}" dir="${
          request.rightToLeft ? 'rtl' : 'ltr'
        }"><head><meta charset="utf-8"><title>${escapeAttribute(base)}</title>` +
        `<style>body{font-family:system-ui,'Segoe UI',sans-serif;line-height:1.7;max-width:52rem;margin:2rem auto;padding:0 1rem}` +
        `table{border-collapse:collapse;width:100%}th,td{border:1px solid #c8ccd4;padding:.5rem}` +
        `img{max-width:100%}</style></head><body>${bodyFor(request, html)}</body></html>`
      return { bytes: encode(page), fileName: `${base}.html` }
    }

    case 'md': {
      const markdown = request.text ?? turndown.turndown(html)
      return { bytes: encode(markdown, request.encoding, request.eol), fileName: `${base}.md` }
    }

    case 'txt': {
      const text = request.text ?? htmlToPlainText(html)
      return { bytes: encode(text, request.encoding, request.eol), fileName: `${base}.txt` }
    }

    case 'json':
    case 'xml':
    case 'code':
      return {
        bytes: encode(request.text ?? htmlToPlainText(html), request.encoding, request.eol),
        fileName: request.name
      }

    case 'csv':
    case 'tsv': {
      const sheet = request.sheets?.[0]
      if (!sheet) throw new Error('no-sheet-data')
      return {
        bytes: encode(
          writeDelimited(sheet, request.target === 'tsv' ? '\t' : ','),
          request.encoding,
          request.eol
        ),
        fileName: `${base}.${request.target}`
      }
    }

    case 'xlsx':
    case 'ods': {
      if (!request.sheets) throw new Error('no-sheet-data')
      return {
        bytes: writeWorkbook(request.sheets, request.target),
        fileName: `${base}.${request.target}`
      }
    }

    default:
      throw new Error('unsupported-export-target')
  }
}

function bodyFor(request: ExportRequest, html: string): string {
  if (request.text !== undefined && !request.html) {
    return `<pre style="white-space:pre-wrap;word-break:break-word">${escapeText(request.text)}</pre>`
  }
  return html
}

/** Formats a document can be saved back to in place, keeping its own type. */
export function canSaveInPlace(document_: LoadedDocument): boolean {
  // Writing a partially-read document back over the original would destroy the
  // rows or content the reader could not hold.
  if (document_.truncated) return false
  // HTML is read as sanitised body markup: the head, the stylesheets, the
  // scripts and the forms are all gone by the time the editor sees it, so
  // writing it back would replace a real web page with a body shell.
  if (document_.format === 'html') return false
  if (!canWriteEncoding(document_.encoding)) return false
  return ['docx', 'rtf', 'odt', 'txt', 'md', 'csv', 'tsv', 'xlsx', 'ods', 'json', 'xml', 'code'].includes(
    document_.format
  )
}

/** Elements that start a new paragraph — a blank line in the text output. */
const PARAGRAPH_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
])

/** Elements that end a line without ending the paragraph. */
const LINE_TAGS = new Set(['LI', 'DD', 'DT', 'TR'])

/**
 * Flattens markup to text, keeping the line structure.
 *
 * The obvious implementation — set innerHTML on a detached div and read
 * innerText — silently returns textContent instead, because innerText falls
 * back when the element is not being rendered. Every paragraph break and every
 * <br> disappears, so saving a 500-line log file wrote it back as one line.
 *
 * This is the exact inverse of `plainTextToHtml`: a blank line between
 * paragraphs, a single newline for a <br> or a list item.
 */
export function htmlToPlainText(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html

  const blocks: string[][] = []
  let block: string[] = []
  let current = ''

  const endLine = (): void => {
    block.push(current)
    current = ''
  }
  const endBlock = (): void => {
    endLine()
    const kept = block.filter((line, index) => line.trim() !== '' || index < block.length - 1)
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
    if (kept.length > 0) blocks.push(kept)
    block = []
  }

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += (node.textContent ?? '').replace(/[\t\n\r]+/g, ' ')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    if (element.tagName === 'BR') {
      endLine()
      return
    }
    if (PARAGRAPH_TAGS.has(element.tagName)) {
      endBlock()
      for (const child of Array.from(element.childNodes)) walk(child)
      endBlock()
      return
    }
    if (LINE_TAGS.has(element.tagName)) {
      if (current.trim() !== '') endLine()
      for (const child of Array.from(element.childNodes)) walk(child)
      endLine()
      return
    }
    for (const child of Array.from(element.childNodes)) walk(child)
  }

  for (const child of Array.from(container.childNodes)) walk(child)
  endBlock()

  return blocks
    .map((lines) => lines.map((line) => line.replace(/[ \u00a0]+/g, ' ').trimEnd()).join('\n'))
    .join('\n\n')
    .trim()
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

function markdownTable(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''

  const cellsOf = (row: HTMLTableRowElement): string[] =>
    Array.from(row.querySelectorAll('th, td')).map((cell) =>
      (cell.textContent ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
    )

  const header = cellsOf(rows[0] as HTMLTableRowElement)
  const separator = header.map(() => '---')
  const body = rows.slice(1).map((row) => cellsOf(row as HTMLTableRowElement))

  return (
    '\n\n' +
    [header, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n') +
    '\n\n'
  )
}

/**
 * Writes text back in the encoding and line endings it arrived with.
 *
 * TextEncoder only speaks UTF-8, so the single-byte codepages get a table
 * built by inverting the browser's own decoder — which keeps the two sides
 * exactly consistent and costs one 256-entry decode at startup.
 */
function encode(text: string, encoding?: string, eol?: 'lf' | 'crlf'): Uint8Array {
  const body = eol === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text
  const label = (encoding ?? 'utf-8').toLowerCase()

  if (label === 'utf-8' || label.startsWith('utf-16')) {
    // UTF-16 sources are re-emitted as UTF-8: it is a strictly wider encoding
    // and every reader that handled the original handles it.
    return new TextEncoder().encode(body)
  }

  const table = singleByteTable(label)
  if (!table) return new TextEncoder().encode(body)

  const bytes = new Uint8Array(body.length)
  for (let index = 0; index < body.length; index += 1) {
    const mapped = table.get(body[index])
    // A character the codepage cannot hold becomes '?', exactly as every other
    // legacy encoder does; canSaveInPlace is what stops this being a surprise.
    bytes[index] = mapped ?? 0x3f
  }
  return bytes
}

const tables = new Map<string, Map<string, number> | null>()

function singleByteTable(label: string): Map<string, number> | null {
  const cached = tables.get(label)
  if (cached !== undefined) return cached

  let table: Map<string, number> | null = null
  try {
    const decoder = new TextDecoder(label)
    const all = new Uint8Array(256)
    for (let byte = 0; byte < 256; byte += 1) all[byte] = byte
    const decoded = decoder.decode(all)
    if (decoded.length === 256) {
      table = new Map<string, number>()
      for (let byte = 0; byte < 256; byte += 1) {
        // Earlier bytes win, so ASCII keeps its canonical mapping.
        if (!table.has(decoded[byte])) table.set(decoded[byte], byte)
      }
    }
  } catch {
    table = null
  }
  tables.set(label, table)
  return table
}

/** True when a document's text can be written back byte-faithfully. */
export function canWriteEncoding(encoding?: string): boolean {
  const label = (encoding ?? 'utf-8').toLowerCase()
  if (label === 'utf-8') return true
  if (label.startsWith('utf-16')) return false
  return singleByteTable(label) !== null
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
