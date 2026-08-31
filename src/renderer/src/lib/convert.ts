import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import type { PdfPrintOptions } from '@shared/types'
import { sanitizeForPrint } from './documents/sanitize'
import { openForRender } from './pdf/pdfjs'
import { extractText, renderPageToBytes, scaleForDpi } from './pdf/render'
import { imagesToPdf as buildPdfFromImages, type NamedBytes } from './pdf/ops'
import { docxToHtml, docxToText } from './docx/read'
import { buildPlainTextHtml, buildPrintableHtml } from './docx/print'
import { markdownToHtml } from './markdown'
import { stripExtension, needsComplexShaping } from './format'
import { normalizeImage } from './files'

export type Progress = (done: number, total: number) => void

/* ----------------------------------------------------------- PDF exports */

export interface PdfToImagesOptions {
  dpi: number
  format: 'png' | 'jpg'
  quality: number
  pages?: number[]
}

export async function pdfToImages(
  bytes: Uint8Array,
  baseName: string,
  options: PdfToImagesOptions,
  password?: string,
  onProgress?: Progress
): Promise<NamedBytes[]> {
  const document_ = await openForRender(bytes, password)
  const base = stripExtension(baseName)
  const scale = scaleForDpi(options.dpi)
  const pages = options.pages ?? Array.from({ length: document_.numPages }, (_, index) => index)
  const mime = options.format === 'jpg' ? 'image/jpeg' : 'image/png'
  const output: NamedBytes[] = []

  for (const [position, index] of pages.entries()) {
    onProgress?.(position, pages.length)
    const rendered = await renderPageToBytes(
      document_,
      index + 1,
      scale,
      mime as 'image/png' | 'image/jpeg',
      options.quality
    )
    output.push({
      name: `${base}-${String(index + 1).padStart(3, '0')}.${options.format}`,
      bytes: rendered.bytes
    })
  }
  onProgress?.(pages.length, pages.length)
  await document_.destroy()
  return output
}

export async function pdfToPlainText(
  bytes: Uint8Array,
  password?: string,
  separatePages = true
): Promise<string> {
  const document_ = await openForRender(bytes, password)
  const pages = await extractText(document_)
  await document_.destroy()
  return pages
    .map((page) =>
      separatePages ? `--- ${page.pageNumber} ---\n${page.lines.join('\n')}` : page.lines.join('\n')
    )
    .join('\n\n')
}

/**
 * Rebuilds PDF text as a real .docx. Lines that look like headings (short,
 * title-ish) are promoted so the result is genuinely editable rather than one
 * long wall of paragraphs.
 */
export async function pdfToDocx(
  bytes: Uint8Array,
  title: string,
  password?: string,
  onProgress?: Progress
): Promise<Uint8Array> {
  const document_ = await openForRender(bytes, password)
  const pages = await extractText(document_)
  await document_.destroy()

  const rightToLeft = pages.some((page) => page.lines.some((line) => needsComplexShaping(line)))
  const children: Paragraph[] = []

  pages.forEach((page, index) => {
    onProgress?.(index, pages.length)
    for (const line of page.lines) {
      const heading = looksLikeHeading(line)
      children.push(
        new Paragraph({
          heading: heading ? HeadingLevel.HEADING_2 : undefined,
          bidirectional: rightToLeft,
          children: [new TextRun({ text: line, rightToLeft, bold: heading })]
        })
      )
    }
    if (index < pages.length - 1) {
      children.push(new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }))
    }
  })
  onProgress?.(pages.length, pages.length)

  if (children.length === 0) throw new Error('no-text-found')

  const file = new Document({
    title: stripExtension(title),
    creator: 'Alcode Editor',
    styles: {
      default: {
        document: {
          run: { font: rightToLeft ? 'Arial' : 'Calibri', size: 22 },
          paragraph: { spacing: { after: 140, line: 300 } }
        }
      }
    },
    sections: [{ children }]
  })
  const blob = await Packer.toBlob(file)
  return new Uint8Array(await blob.arrayBuffer())
}

function looksLikeHeading(line: string): boolean {
  if (line.length > 70 || line.length < 3) return false
  if (/[.!?،؛]$/.test(line)) return false
  const words = line.split(/\s+/).length
  return words <= 9
}

/* ----------------------------------------------------------- PDF imports */

export async function imagesToPdf(
  files: { name: string; bytes: Uint8Array }[],
  pageSize: [number, number] | null,
  fit: 'contain' | 'cover' | 'actual',
  marginPt: number,
  onProgress?: Progress
): Promise<Uint8Array> {
  const prepared: { bytes: Uint8Array; type: 'png' | 'jpg' }[] = []
  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length)
    prepared.push(await normalizeImage(file.name, file.bytes))
  }
  onProgress?.(files.length, files.length)
  return buildPdfFromImages(prepared, pageSize, fit, marginPt)
}

export interface HtmlPdfSettings extends PdfPrintOptions {
  rightToLeft: boolean
  title?: string
}

export async function htmlToPdf(html: string, settings: HtmlPdfSettings): Promise<Uint8Array> {
  // The HTML converter hands over a user-picked .html file verbatim, so this
  // is the last point before it becomes a live page. Remote references are
  // dropped as well as scripts: a generated PDF must not phone home.
  const page = buildPrintableHtml(sanitizeForPrint(html), {
    title: settings.title,
    rightToLeft: settings.rightToLeft
  })
  return window.alcode.print.html(page, {
    landscape: settings.landscape,
    pageSize: settings.pageSize,
    marginsMm: settings.marginsMm,
    printBackground: settings.printBackground ?? true
  })
}

export async function wordToPdf(
  bytes: Uint8Array,
  name: string,
  settings: Omit<HtmlPdfSettings, 'rightToLeft' | 'title'>
): Promise<Uint8Array> {
  const { html } = await docxToHtml(bytes)
  const rightToLeft = needsComplexShaping(html.replace(/<[^>]+>/g, ' ').slice(0, 4000))
  return htmlToPdf(html, { ...settings, rightToLeft, title: stripExtension(name) })
}

export async function textFileToPdf(
  text: string,
  name: string,
  settings: Omit<HtmlPdfSettings, 'rightToLeft' | 'title'>,
  asMarkdown: boolean
): Promise<Uint8Array> {
  const rightToLeft = needsComplexShaping(text.slice(0, 4000))
  const page = asMarkdown
    ? buildPrintableHtml(sanitizeForPrint(markdownToHtml(text)), {
        title: stripExtension(name),
        rightToLeft
      })
    : buildPlainTextHtml(text, { title: stripExtension(name), rightToLeft })

  return window.alcode.print.html(page, {
    landscape: settings.landscape,
    pageSize: settings.pageSize,
    marginsMm: settings.marginsMm,
    printBackground: settings.printBackground ?? true
  })
}

export async function wordToHtmlDocument(bytes: Uint8Array, name: string): Promise<string> {
  const { html } = await docxToHtml(bytes)
  const rightToLeft = needsComplexShaping(html.replace(/<[^>]+>/g, ' ').slice(0, 4000))
  return buildPrintableHtml(html, { title: stripExtension(name), rightToLeft })
}

export async function wordToPlainText(bytes: Uint8Array): Promise<string> {
  return docxToText(bytes)
}

/* ------------------------------------------------------------- comparing */

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

/** Longest-common-subsequence diff over lines, used by the compare tool. */
export function diffLines(left: string[], right: string[]): DiffLine[] {
  const rows = left.length
  const columns = right.length
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0))

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const output: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (left[i] === right[j]) {
      output.push({ kind: 'same', text: left[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      output.push({ kind: 'removed', text: left[i] })
      i += 1
    } else {
      output.push({ kind: 'added', text: right[j] })
      j += 1
    }
  }
  while (i < rows) {
    output.push({ kind: 'removed', text: left[i] })
    i += 1
  }
  while (j < columns) {
    output.push({ kind: 'added', text: right[j] })
    j += 1
  }
  return output
}

export async function documentTextLines(
  name: string,
  bytes: Uint8Array,
  password?: string
): Promise<string[]> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) {
    const text = await pdfToPlainText(bytes, password, false)
    return text.split('\n').map((line) => line.trim()).filter(Boolean)
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    const text = await docxToText(bytes)
    return text.split('\n').map((line) => line.trim()).filter(Boolean)
  }
  return new TextDecoder()
    .decode(bytes)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
