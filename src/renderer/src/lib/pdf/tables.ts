import type { PDFDocumentProxy } from './pdfjs'
import { detectDirection } from '../text/encoding'
import { inferCell, type SheetData } from '../documents/sheets'

/**
 * Recovers tables from a PDF's text as spreadsheet rows.
 *
 * A PDF has no notion of a table: it has words at coordinates. What a
 * reader sees as columns is words whose left (or, in Arabic, right) edges
 * line up down the page. So: group the words into lines by their baseline,
 * fuse neighbouring words into cells where the gap is no wider than a
 * couple of characters, then cluster the cell edges of every multi-cell line
 * into column positions and snap each cell to the nearest. A line with a
 * single cell — a title, a note — stays as one cell in the first column.
 *
 * It is a heuristic and says so: a page without at least two lines that
 * split into columns yields nothing rather than a sheet of nonsense.
 */

interface Word {
  x: number
  right: number
  y: number
  text: string
  charWidth: number
}

interface Cell {
  x: number
  right: number
  text: string
}

export async function extractTables(
  document_: PDFDocumentProxy,
  pages?: number[],
  onProgress?: (done: number, total: number) => void
): Promise<SheetData[]> {
  const wanted =
    pages && pages.length > 0
      ? pages.filter((page) => page >= 1 && page <= document_.numPages)
      : Array.from({ length: document_.numPages }, (_, index) => index + 1)
  const sheets: SheetData[] = []

  for (const [index, pageNumber] of wanted.entries()) {
    onProgress?.(index, wanted.length)
    const page = await document_.getPage(pageNumber)
    const content = await page.getTextContent()
    const words: Word[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const transform = item.transform as number[]
      const width = item.width || 0
      words.push({
        x: transform[4],
        right: transform[4] + width,
        y: transform[5],
        text: item.str,
        charWidth: item.str.length > 0 ? width / item.str.length : 4
      })
    }
    page.cleanup()
    const rows = tableRows(words)
    if (rows) sheets.push({ name: `${pageNumber}`, rows: rows.map((row) => row.map((text) => inferCell(text))) })
  }
  onProgress?.(wanted.length, wanted.length)
  return sheets
}

function tableRows(words: Word[]): string[][] | null {
  if (words.length === 0) return null
  const rightToLeft = detectDirection(words.map((word) => word.text).join(' ')) === 'rtl'

  // Lines by baseline, with a tolerance of a few points for superscripts
  // and slightly misaligned runs.
  const lines: Word[][] = []
  for (const word of [...words].sort((a, b) => b.y - a.y)) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - word.y) <= 3) line.push(word)
    else lines.push([word])
  }

  // Words into cells: a gap wider than two characters is a column break.
  const cellLines: Cell[][] = lines.map((line) => {
    const sorted = [...line].sort((a, b) => a.x - b.x)
    const cells: Cell[] = []
    for (const word of sorted) {
      const last = cells[cells.length - 1]
      const gapLimit = Math.max(6, word.charWidth * 2.2)
      if (last && word.x - last.right <= gapLimit) {
        last.text = rightToLeft ? `${word.text} ${last.text}` : `${last.text} ${word.text}`
        last.right = Math.max(last.right, word.right)
      } else {
        cells.push({ x: word.x, right: word.right, text: word.text })
      }
    }
    return cells
  })

  const multi = cellLines.filter((cells) => cells.length >= 2)
  if (multi.length < 2) return null

  // Column anchors from the aligned edge of every cell in a multi-cell line.
  const edges = multi.flatMap((cells) => cells.map((cell) => (rightToLeft ? cell.right : cell.x))).sort((a, b) => a - b)
  const anchors: number[] = []
  let cluster: number[] = []
  for (const edge of edges) {
    if (cluster.length > 0 && edge - cluster[cluster.length - 1] > 14) {
      anchors.push(cluster.reduce((a, b) => a + b, 0) / cluster.length)
      cluster = []
    }
    cluster.push(edge)
  }
  if (cluster.length > 0) anchors.push(cluster.reduce((a, b) => a + b, 0) / cluster.length)
  if (anchors.length < 2) return null

  // Columns read in the page's direction: the first column is the rightmost
  // one for Arabic, so the sheet reads the way the page does.
  const ordered = rightToLeft ? [...anchors].reverse() : anchors

  const rows: string[][] = []
  for (const cells of cellLines) {
    const row: string[] = Array.from({ length: ordered.length }, () => '')
    if (cells.length === 1) {
      row[0] = cells[0].text.trim()
    } else {
      for (const cell of cells) {
        const edge = rightToLeft ? cell.right : cell.x
        let best = 0
        for (let i = 1; i < ordered.length; i += 1) {
          if (Math.abs(ordered[i] - edge) < Math.abs(ordered[best] - edge)) best = i
        }
        row[best] = row[best] ? `${row[best]} ${cell.text.trim()}` : cell.text.trim()
      }
    }
    rows.push(row)
  }
  return rows
}
