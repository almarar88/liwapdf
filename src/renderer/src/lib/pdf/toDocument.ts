import { extractParagraphs, type Paragraph } from './paragraphs'

/**
 * Turns a PDF into a document the editor can work on.
 *
 * A PDF is a picture of a finished document: positioned runs, no paragraphs
 * and no styles. Reading it back into editable text means recovering the
 * structure — paragraphs from the runs, headings from the sizes, alignment
 * from where the block sits on the page, direction from the script — and
 * writing it as HTML the rich editor already understands. It is a
 * conversion, not a round trip: the layout becomes a flowing document, which
 * is what "edit this like Word" actually asks for.
 */

export interface PdfToDocumentResult {
  html: string
  direction: 'rtl' | 'ltr'
  /** Paragraphs found, across all pages. */
  blocks: number
  pages: number
}

export interface PdfToDocumentOptions {
  password?: string
  /** Pages to read, 1-based; all of them when omitted. */
  pages?: number[]
  onProgress?: (done: number, total: number) => void
}

export async function pdfToDocument(
  bytes: Uint8Array,
  pageCount: number,
  options: PdfToDocumentOptions = {}
): Promise<PdfToDocumentResult> {
  const wanted = options.pages && options.pages.length > 0 ? options.pages : Array.from({ length: pageCount }, (_, i) => i + 1)
  const parts: string[] = []
  let rtlChars = 0
  let ltrChars = 0
  let blocks = 0

  for (const [index, pageNumber] of wanted.entries()) {
    options.onProgress?.(index, wanted.length)
    const paragraphs = await extractParagraphs(bytes, pageNumber - 1, options.password)
    if (index > 0 && paragraphs.length > 0) {
      // A page break the editor and the exporters both understand.
      parts.push('<p style="page-break-before:always"></p>')
    }
    const body = bodySizeOf(paragraphs)
    const column = columnOf(paragraphs)
    for (const paragraph of paragraphs) {
      blocks += 1
      const letters = paragraph.text.replace(/[^\p{L}]/gu, '').length
      if (paragraph.rtl) rtlChars += letters
      else ltrChars += letters
      parts.push(blockHtml(paragraph, body, column))
    }
  }
  options.onProgress?.(wanted.length, wanted.length)

  return {
    html: parts.join('\n') || '<p></p>',
    direction: rtlChars > ltrChars ? 'rtl' : 'ltr',
    blocks,
    pages: wanted.length
  }
}

/**
 * The body size is the one most of the document's text is set in, not the
 * middle of the list of sizes: a page of three headings and one paragraph
 * would otherwise call a heading "normal".
 */
function bodySizeOf(paragraphs: Paragraph[]): number {
  const weight = new Map<number, number>()
  for (const paragraph of paragraphs) {
    const key = Math.round(paragraph.size * 2) / 2
    weight.set(key, (weight.get(key) ?? 0) + paragraph.text.replace(/\s/g, '').length)
  }
  let best = 12
  let most = -1
  for (const [size, letters] of weight) {
    if (letters > most) {
      most = letters
      best = size
    }
  }
  return best || 12
}

/**
 * The text column: the page's width less its margin. The margin is the
 * smaller of the two gaps the text leaves, because a page whose blocks all
 * start at the same left edge still has a right margin no block reaches.
 */
function columnOf(paragraphs: Paragraph[]): { left: number; right: number } {
  if (paragraphs.length === 0) return { left: 0, right: 1 }
  const pageWidth = paragraphs[0].pageWidth || 1
  const left = Math.min(...paragraphs.map((paragraph) => paragraph.x))
  const right = Math.max(...paragraphs.map((paragraph) => paragraph.x + paragraph.width))
  const margin = Math.max(0, Math.min(left, pageWidth - right))
  return { left: margin, right: pageWidth - margin }
}

function blockHtml(paragraph: Paragraph, bodySize: number, column: { left: number; right: number }): string {
  const ratio = paragraph.size / bodySize
  // Bigger than the body text and short: a heading, the way a reader reads it.
  const heading = ratio >= 1.6 ? 1 : ratio >= 1.32 ? 2 : ratio >= 1.15 ? 3 : 0
  const tag = heading > 0 && paragraph.lines.length <= 3 ? `h${heading}` : 'p'
  const align = alignOf(paragraph, column)
  const styles: string[] = []
  if (tag === 'p') styles.push(`font-size:${Math.round(paragraph.size * 10) / 10}pt`)
  if (align) styles.push(`text-align:${align}`)
  const text = paragraph.text
    .split('\n')
    .map((line) => escapeHtml(line.trim()))
    .filter(Boolean)
    .join(' ')
  return `<${tag} dir="${paragraph.rtl ? 'rtl' : 'ltr'}"${styles.length > 0 ? ` style="${styles.join(';')}"` : ''}>${text || '<br>'}</${tag}>`
}

/**
 * Where the block sits tells how it was aligned: a narrow block centred in
 * the column was centred, one hugging the far edge was end-aligned. Blocks
 * that fill the column keep the paragraph's own direction and need no rule.
 */
function alignOf(paragraph: Paragraph, column: { left: number; right: number }): string | null {
  const width = column.right - column.left
  if (width <= 0) return null
  const fill = paragraph.width / width
  if (fill > 0.86) return null
  const leftGap = paragraph.x - column.left
  const rightGap = column.right - (paragraph.x + paragraph.width)
  const tolerance = Math.max(6, paragraph.size * 0.8)
  if (Math.abs(leftGap - rightGap) < tolerance) return 'center'
  if (leftGap < rightGap) return paragraph.rtl ? 'left' : null
  return paragraph.rtl ? null : 'right'
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
