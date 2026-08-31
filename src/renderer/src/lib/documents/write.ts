import TurndownService from 'turndown'
import { htmlToDocx } from '../docx/write'
import { htmlToPdf } from '../convert'
import { stripExtension } from '../format'
import { htmlToRtf } from './rtf'
import { htmlToOdt } from './office'
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
      return { bytes: encode(markdown), fileName: `${base}.md` }
    }

    case 'txt': {
      const text = request.text ?? htmlToPlainText(html)
      return { bytes: encode(text), fileName: `${base}.txt` }
    }

    case 'json':
    case 'xml':
    case 'code':
      return { bytes: encode(request.text ?? htmlToPlainText(html)), fileName: request.name }

    case 'csv':
    case 'tsv': {
      const sheet = request.sheets?.[0]
      if (!sheet) throw new Error('no-sheet-data')
      return {
        bytes: encode(writeDelimited(sheet, request.target === 'tsv' ? '\t' : ',')),
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
  return ['docx', 'rtf', 'odt', 'txt', 'md', 'html', 'csv', 'tsv', 'xlsx', 'ods', 'json', 'xml', 'code'].includes(
    document_.format
  )
}

export function htmlToPlainText(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  return (container.innerText || container.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
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

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
