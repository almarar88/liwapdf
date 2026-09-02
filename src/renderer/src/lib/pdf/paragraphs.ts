import { rgb } from '@cantoo/pdf-lib'
import { openForRender } from './pdfjs'
import { load, save } from './ops'
import { drawSmartText, isRtlText, measureSmartText, prepareFonts, wrapSmartText } from './typography'
import { scrubPage } from './replace'

/**
 * Paragraph editing inside a PDF, the way a desktop editor does it.
 *
 * A PDF page has no paragraphs, only positioned runs of glyphs. This
 * recovers them: runs on one baseline make a line, lines spaced like body
 * text and stacked over one another make a paragraph. The user rewrites the
 * paragraph as text; the old block is painted over and struck from the
 * content stream, and the new text is wrapped to the block's own width at
 * the block's own size and leading, right-aligned for Arabic, and written
 * back as real text. When the rewrite runs longer than the block, the size
 * comes down a little first and only then does the block grow downward,
 * and the caller is told either way.
 */

export interface ParagraphLine {
  text: string
  /** Baseline, PDF space. */
  y: number
  x: number
  width: number
  size: number
  /** The runs the line was assembled from, for striking them out later. */
  runs: string[]
}

export interface Paragraph {
  id: number
  pageIndex: number
  text: string
  lines: ParagraphLine[]
  /** Block box in PDF space: left, bottom baseline of last line, width, and top-to-bottom span. */
  x: number
  y: number
  width: number
  height: number
  size: number
  leading: number
  rtl: boolean
  /** Free space under the block before the next text in its column, PDF points. */
  roomBelow: number
}

/** Groups the page's text runs into paragraphs, in reading order top to bottom. */
export async function extractParagraphs(bytes: Uint8Array, pageIndex: number, password?: string): Promise<Paragraph[]> {
  const source = await openForRender(bytes, password)
  try {
    const page = await source.getPage(pageIndex + 1)
    const content = await page.getTextContent()
    interface Run {
      text: string
      x: number
      y: number
      width: number
      size: number
    }
    const runs: Run[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [a, b, , , tx, ty] = item.transform as number[]
      // Rotated text is not a paragraph anyone edits in place.
      if (Math.abs(b) > 0.01 && Math.abs(a) < 0.99) continue
      runs.push({ text: item.str, x: tx, y: ty, width: Math.max(item.width, 0.5), size: Math.max(item.height, 3) })
    }
    page.cleanup()

    // Lines: runs whose baselines agree within a fraction of the size.
    const lines: ParagraphLine[] = []
    for (const run of runs) {
      const line = lines.find((candidate) => Math.abs(candidate.y - run.y) < Math.max(candidate.size, run.size) * 0.35)
      if (line) {
        line.runs.push(run.text)
        const left = Math.min(line.x, run.x)
        const right = Math.max(line.x + line.width, run.x + run.width)
        line.x = left
        line.width = right - left
        line.size = Math.max(line.size, run.size)
        line.text = joinRuns(line, run)
      } else {
        lines.push({ text: run.text, y: run.y, x: run.x, width: run.width, size: run.size, runs: [run.text] })
      }
    }
    lines.sort((first, second) => second.y - first.y)

    // Paragraphs: consecutive lines with body-text leading and overlapping columns.
    const paragraphs: Paragraph[] = []
    let current: ParagraphLine[] = []
    const flush = (): void => {
      if (current.length === 0) return
      const size = median(current.map((line) => line.size))
      const gaps = current.slice(1).map((line, index) => current[index].y - line.y)
      const leading = gaps.length > 0 ? median(gaps) : size * 1.25
      const left = Math.min(...current.map((line) => line.x))
      const right = Math.max(...current.map((line) => line.x + line.width))
      const text = current.map((line) => line.text.trim()).join('\n')
      paragraphs.push({
        id: paragraphs.length,
        pageIndex,
        text,
        lines: current,
        x: left,
        y: current[current.length - 1].y,
        width: right - left,
        height: current[0].y - current[current.length - 1].y + size,
        size,
        leading,
        rtl: isRtlText(text),
        roomBelow: 0
      })
      current = []
    }
    for (const line of lines) {
      const previous = current[current.length - 1]
      if (previous) {
        const gap = previous.y - line.y
        const overlap = Math.min(previous.x + previous.width, line.x + line.width) - Math.max(previous.x, line.x)
        const similar = Math.abs(previous.size - line.size) <= Math.max(previous.size, line.size) * 0.25
        if (gap > Math.max(previous.size, line.size) * 2.2 || overlap <= 0 || !similar) flush()
      }
      current.push(line)
    }
    flush()
    // How far each block may grow before it runs into the next one below.
    for (const paragraph of paragraphs) {
      const below = paragraphs.filter(
        (other) =>
          other !== paragraph &&
          other.lines[0].y < paragraph.y &&
          Math.min(other.x + other.width, paragraph.x + paragraph.width) > Math.max(other.x, paragraph.x)
      )
      const nextTop = below.length > 0 ? Math.max(...below.map((other) => other.lines[0].y + other.size)) : 36
      paragraph.roomBelow = Math.max(0, paragraph.y - nextTop - paragraph.size * 0.4)
    }
    return paragraphs
  } finally {
    await source.destroy().catch(() => undefined)
  }
}

function joinRuns(line: ParagraphLine, run: { text: string; x: number; width: number }): string {
  // Runs arrive in content order; a visible gap between them is a space the
  // PDF never wrote down.
  const gap = run.x - (line.x + line.width)
  const needsSpace = !line.text.endsWith(' ') && !run.text.startsWith(' ') && gap > line.size * 0.15
  return line.text + (needsSpace ? ' ' : '') + run.text
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export interface RewriteOptions {
  paragraph: Paragraph
  text: string
  color?: string
  password?: string
}

export interface RewriteResult {
  bytes: Uint8Array
  /** Lines the new text needed. */
  lines: number
  /** Size actually used, when it had to come down to fit. */
  size: number
  /** True when the block still had to grow below its old bottom. */
  overflowed: boolean
  /** Original runs that could only be painted over, not struck from the file. */
  covered: number
}

export async function rewriteParagraph(bytes: Uint8Array, options: RewriteOptions): Promise<RewriteResult> {
  const { paragraph } = options
  const document = await load(bytes, options.password)
  const fonts = await prepareFonts(document)
  const page = document.getPages()[paragraph.pageIndex]
  if (!page) throw new Error('page-missing')

  const originals = paragraph.lines.flatMap((line) => line.runs)
  const scrubbed = scrubPage(document, page.node, originals, false)

  // The block's box: descender room below the last baseline, ascender room above the first.
  const pad = paragraph.size * 0.3
  page.drawRectangle({
    x: paragraph.x - 1,
    y: paragraph.y - pad,
    width: paragraph.width + 2,
    height: paragraph.height + pad * 0.6,
    color: rgb(1, 1, 1)
  })

  const color = options.color ?? '#000000'
  const rtl = isRtlText(options.text) || (paragraph.rtl && !options.text.trim())
  const available = paragraph.lines.length
  let size = paragraph.size
  let lines = await wrapSmartText(fonts, options.text, paragraph.width, { size, color, rtl })
  // Lines the block can hold once it grows into the free space under it.
  const roomFor = (leading: number): number =>
    Math.max(available, Math.floor((paragraph.height - paragraph.size + paragraph.roomBelow) / leading) + 1)
  let leading = paragraph.leading
  // Shrink by steps down to 70% before letting the block spill over.
  while (lines.length > roomFor(leading) && size > paragraph.size * 0.7) {
    size = Math.round((size - paragraph.size * 0.05) * 100) / 100
    leading = paragraph.leading * (size / paragraph.size)
    lines = await wrapSmartText(fonts, options.text, paragraph.width, { size, color, rtl })
  }
  const top = paragraph.lines[0].y
  const overflowed = lines.length > roomFor(leading)
  // The grown block is painted white too, but only within the room that is free.
  const grown = Math.min((lines.length - 1) * leading, paragraph.height - paragraph.size + paragraph.roomBelow)
  if (grown > paragraph.height - paragraph.size) {
    page.drawRectangle({
      x: paragraph.x - 1,
      y: top - grown - pad,
      width: paragraph.width + 2,
      height: grown - (paragraph.height - paragraph.size) + pad,
      color: rgb(1, 1, 1)
    })
  }
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const y = top - index * leading
    const measured = await measureSmartText(fonts, line, { size, color, rtl })
    const x = rtl ? paragraph.x + paragraph.width - measured.width : paragraph.x
    await drawSmartText(page, fonts, line, x, y, { size, color, rtl })
  }

  return {
    bytes: await save(document),
    lines: lines.length,
    size,
    overflowed,
    covered: Math.max(0, originals.length - scrubbed)
  }
}
