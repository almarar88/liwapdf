import { pdfjs, type PDFDocumentProxy } from './pdfjs'
import { canvasToBlob, blobToBytes } from './text-raster'

export interface RenderedPage {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/** Renders one page into a freshly sized canvas at the requested scale. */
export async function renderPage(
  document_: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  target?: HTMLCanvasElement
): Promise<RenderedPage> {
  const page = await document_.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = target ?? document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('canvas-unavailable')

  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise
  page.cleanup()
  return { canvas, width: canvas.width, height: canvas.height }
}

export async function renderPageToDataUrl(
  document_: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<string> {
  const { canvas } = await renderPage(document_, pageNumber, scale)
  return canvas.toDataURL(type, quality)
}

export async function renderPageToBytes(
  document_: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { canvas, width, height } = await renderPage(document_, pageNumber, scale)
  const blob = await canvasToBlob(canvas, type, quality)
  return { bytes: await blobToBytes(blob), width, height }
}

/** Scale factor that maps a page's natural size to the requested DPI. */
export function scaleForDpi(dpi: number): number {
  return dpi / 72
}

export interface PageText {
  pageNumber: number
  lines: string[]
}

/**
 * Pulls text out of a document, grouping items back into visual lines by
 * their transform's vertical position — pdf.js hands them over unordered.
 */
export async function extractText(document_: PDFDocumentProxy): Promise<PageText[]> {
  const pages: PageText[] = []
  for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
    const page = await document_.getPage(pageNumber)
    const content = await page.getTextContent()
    const rows = new Map<number, { x: number; text: string }[]>()

    for (const item of content.items) {
      if (!('str' in item)) continue
      const text = item.str
      if (!text) continue
      const transform = item.transform as number[]
      const y = Math.round(transform[5] / 3) * 3
      const bucket = rows.get(y) ?? []
      bucket.push({ x: transform[4], text })
      rows.set(y, bucket)
    }

    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.text)
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter((line) => line.length > 0)

    pages.push({ pageNumber, lines })
    page.cleanup()
  }
  return pages
}

export interface ExtractedImage {
  name: string
  bytes: Uint8Array
  width: number
  height: number
  pageNumber: number
}

function objectFromPage(page: unknown, name: string): Promise<unknown> {
  return new Promise((resolve) => {
    const objects = (page as { objs: { get(id: string, cb: (value: unknown) => void): void } }).objs
    try {
      objects.get(name, resolve)
    } catch {
      resolve(null)
    }
    setTimeout(() => resolve(null), 4000)
  })
}

/** Pulls embedded raster images out of every page as PNG bytes. */
export async function extractImages(document_: PDFDocumentProxy): Promise<ExtractedImage[]> {
  const results: ExtractedImage[] = []

  for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
    const page = await document_.getPage(pageNumber)
    const operators = await page.getOperatorList()
    const seen = new Set<string>()

    for (let index = 0; index < operators.fnArray.length; index += 1) {
      const isImage =
        operators.fnArray[index] === pdfjs.OPS.paintImageXObject ||
        operators.fnArray[index] === pdfjs.OPS.paintInlineImageXObject
      if (!isImage) continue

      const argument = operators.argsArray[index]?.[0]
      if (typeof argument !== 'string' || seen.has(argument)) continue
      seen.add(argument)

      const raw = (await objectFromPage(page, argument)) as
        | { width: number; height: number; kind?: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap }
        | null
      if (!raw?.width || !raw.height) continue

      const canvas = document.createElement('canvas')
      canvas.width = raw.width
      canvas.height = raw.height
      const context = canvas.getContext('2d')
      if (!context) continue

      if (raw.bitmap) {
        context.drawImage(raw.bitmap, 0, 0)
      } else if (raw.data) {
        const target = context.createImageData(raw.width, raw.height)
        writePixels(target.data, raw.data, raw.kind ?? 2, raw.width, raw.height)
        context.putImageData(target, 0, 0)
      } else {
        continue
      }

      const blob = await canvasToBlob(canvas, 'image/png')
      results.push({
        name: `page${pageNumber}-image${results.length + 1}.png`,
        bytes: await blobToBytes(blob),
        width: raw.width,
        height: raw.height,
        pageNumber
      })
    }
    page.cleanup()
  }
  return results
}

function writePixels(
  destination: Uint8ClampedArray,
  source: Uint8ClampedArray,
  kind: number,
  width: number,
  height: number
): void {
  const pixels = width * height
  if (kind === 3) {
    destination.set(source.subarray(0, pixels * 4))
    return
  }
  if (kind === 2) {
    for (let index = 0; index < pixels; index += 1) {
      destination[index * 4] = source[index * 3]
      destination[index * 4 + 1] = source[index * 3 + 1]
      destination[index * 4 + 2] = source[index * 3 + 2]
      destination[index * 4 + 3] = 255
    }
    return
  }
  // 1 bit per pixel grayscale, packed MSB-first per row.
  const rowBytes = (width + 7) >> 3
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byte = source[y * rowBytes + (x >> 3)]
      const bit = (byte >> (7 - (x & 7))) & 1
      const value = bit ? 255 : 0
      const offset = (y * width + x) * 4
      destination[offset] = value
      destination[offset + 1] = value
      destination[offset + 2] = value
      destination[offset + 3] = 255
    }
  }
}

export interface OutlineNode {
  title: string
  pageNumber: number | null
  children: OutlineNode[]
}

export async function readOutline(document_: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await document_.getOutline()
  if (!raw) return []

  const convert = async (items: typeof raw): Promise<OutlineNode[]> =>
    Promise.all(
      items.map(async (item) => ({
        title: item.title,
        pageNumber: await resolveDestination(document_, item.dest),
        children: item.items ? await convert(item.items) : []
      }))
    )
  return convert(raw)
}

async function resolveDestination(
  document_: PDFDocumentProxy,
  destination: unknown
): Promise<number | null> {
  try {
    const resolved =
      typeof destination === 'string' ? await document_.getDestination(destination) : destination
    if (!Array.isArray(resolved) || resolved.length === 0) return null
    const index = await document_.getPageIndex(resolved[0] as never)
    return index + 1
  } catch {
    return null
  }
}

export interface SearchHit {
  pageNumber: number
  snippet: string
  index: number
}

export async function searchDocument(
  document_: PDFDocumentProxy,
  query: string
): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const hits: SearchHit[] = []

  for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
    const page = await document_.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
    const haystack = text.toLowerCase()

    let cursor = haystack.indexOf(needle)
    while (cursor !== -1 && hits.length < 400) {
      hits.push({
        pageNumber,
        index: cursor,
        snippet: text.slice(Math.max(0, cursor - 42), cursor + needle.length + 42).trim()
      })
      cursor = haystack.indexOf(needle, cursor + needle.length)
    }
    page.cleanup()
  }
  return hits
}
