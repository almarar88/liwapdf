import { openForRender } from './pdfjs'
import { renderPage } from './render'

/**
 * Compares two PDFs by what they look like, page by page.
 *
 * The text comparison cannot see a moved logo, a changed signature, a
 * re-flowed table or a stamp — anything that is not a line of text. This
 * renders each page of both files at the same scale and counts the pixels
 * that differ, painting them red over a faded copy of the first file so the
 * eye goes straight to the change. A page present in only one file counts
 * as fully changed.
 */

export interface PageDiff {
  page: number
  /** Share of pixels that differ, 0–1. */
  changed: number
  /** PNG of the overlay, when asked for. */
  image?: string
}

export interface VisualDiffOptions {
  scale?: number
  withImages?: boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  passwordA?: string
  passwordB?: string
}

export interface VisualDiffResult {
  pages: PageDiff[]
  pageCountA: number
  pageCountB: number
  /** Pages with any visible change. */
  changedPages: number
}

export async function visualDiff(a: Uint8Array, b: Uint8Array, options: VisualDiffOptions = {}): Promise<VisualDiffResult> {
  const scale = options.scale ?? 0.8
  const left = await openForRender(a, options.passwordA)
  const right = await openForRender(b, options.passwordB)
  try {
    const total = Math.max(left.numPages, right.numPages)
    const pages: PageDiff[] = []
    const canvasA = document.createElement('canvas')
    const canvasB = document.createElement('canvas')

    for (let page = 1; page <= total; page += 1) {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      options.onProgress?.(page - 1, total)
      if (page > left.numPages || page > right.numPages) {
        pages.push({ page, changed: 1 })
        continue
      }
      const [ra, rb] = await Promise.all([
        renderPage(left, page, scale, canvasA),
        renderPage(right, page, scale, canvasB)
      ])
      pages.push(diffCanvases(page, ra.canvas, rb.canvas, options.withImages ?? false))
      // Let the busy veil paint between pages.
      await new Promise((next) => setTimeout(next, 0))
    }
    options.onProgress?.(total, total)
    return {
      pages,
      pageCountA: left.numPages,
      pageCountB: right.numPages,
      changedPages: pages.filter((entry) => entry.changed > 0.0005).length
    }
  } finally {
    await Promise.all([left.destroy().catch(() => undefined), right.destroy().catch(() => undefined)])
  }
}

function diffCanvases(page: number, a: HTMLCanvasElement, b: HTMLCanvasElement, withImage: boolean): PageDiff {
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const contextA = a.getContext('2d', { willReadFrequently: true })!
  const contextB = b.getContext('2d', { willReadFrequently: true })!
  const pixelsA = contextA.getImageData(0, 0, a.width, a.height)
  const pixelsB = contextB.getImageData(0, 0, b.width, b.height)

  const out = withImage ? new ImageData(width, height) : null
  let differing = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const la = luminance(pixelsA, x, y)
      const lb = luminance(pixelsB, x, y)
      const differs = Math.abs(la - lb) > 40
      if (differs) differing += 1
      if (out) {
        const i = (y * width + x) * 4
        if (differs) {
          out.data[i] = 229
          out.data[i + 1] = 72
          out.data[i + 2] = 77
        } else {
          // The first file, faded, as the ground the change sits on.
          const faded = 160 + (la * 95) / 255
          out.data[i] = out.data[i + 1] = out.data[i + 2] = faded
        }
        out.data[i + 3] = 255
      }
    }
  }

  const result: PageDiff = { page, changed: differing / (width * height) }
  if (out) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.putImageData(out, 0, 0)
    result.image = canvas.toDataURL('image/png')
  }
  return result
}

/** Luminance of a pixel, or white for a point outside the smaller page. */
function luminance(pixels: ImageData, x: number, y: number): number {
  if (x >= pixels.width || y >= pixels.height) return 255
  const i = (y * pixels.width + x) * 4
  return 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]
}
